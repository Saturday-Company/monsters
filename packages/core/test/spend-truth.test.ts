import { ProviderRegistry, type ModelPrice, type SessionOptions } from '@monsters/providers';
import { fake, FakeProvider, type FakeScript } from '@monsters/providers/testing';
import type { LogEvent } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCoreServices,
  parseAgentConfig,
  RunBudget,
  runAgent,
  SpendMeter,
  truncatedNote,
  type AgentDefinition,
  type CoreServices,
  type SpendSettings,
  type UsageClass,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { inLang } from './prompt-lang.ts';

/*
 * The spending is true (review of 18/10, F-A4, F-M4, F-B13): every request
 * the provider bills is counted, also when it reports no cost, when its
 * stream breaks, is asked again or is stopped, and a project's spending is
 * what its runs spent.
 */

const opened: CoreServices[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.db.close();
});

/** 3 $ per million tokens in, 15 out: Sonnet's price on a direct key. */
const PRICE: ModelPrice = { input: 3, output: 15 };
const usd = (inTok: number, outTok: number) => (inTok * 3 + outTok * 15) / 1_000_000;

function setup(models: Record<string, FakeScript>, session: SessionOptions = {}) {
  const services = createCoreServices({ home: tempHome() });
  opened.push(services);
  const provider = new FakeProvider({ models });
  const providers = new ProviderRegistry().register(provider);
  return { ...services, provider, providers, session };
}
type Env = ReturnType<typeof setup>;

function agent(models = [{ provider: 'fake', model: 'a' }]): AgentDefinition {
  return {
    config: parseAgentConfig({
      id: 'rhea',
      name: 'Rhea',
      role: 'ricerche online',
      color: '#4f8df7',
      models,
      tools: [],
      limits: { maxSteps: 4 },
    }),
    instructions: '# Rhea',
  };
}

async function run(
  env: Env,
  options: Partial<Parameters<typeof runAgent>[0]> & { def?: AgentDefinition } = {},
) {
  const def = options.def ?? agent();
  const r = env.runs.startRun({ agent: 'rhea' });
  const budget = options.budget ?? new RunBudget();
  const result = await runAgent({
    agent: def,
    task: 'Cerca Rea',
    tools: [],
    signal: r.signal,
    log: env.log,
    runId: r.id,
    session: env.providers.session(def.config.models, env.session),
    price: () => PRICE,
    budget,
    ...options,
  });
  r.finish();
  const events = env.log.query({ runId: r.id, limit: 1000 });
  const usage = events.filter((e): e is LogEvent<'provider_usage'> => e.type === 'provider_usage');
  return { result, events, usage, budget, run: r };
}

describe('the cost of a request without one from the provider (F-A4)', () => {
  it('is the price list’s, marked as estimated, and reaches the run’s budget', async () => {
    const env = setup({ a: [fake.text('Rea è una luna di Saturno.')] });
    const { usage, budget } = await run(env);
    expect(usage).toHaveLength(1);
    expect(usage[0]!.data).toMatchObject({ inputTokens: 12, outputTokens: 7, estimated: true });
    expect(usage[0]!.data.costUsd).toBeCloseTo(usd(12, 7), 12);
    expect(budget.usage.costUsd).toBeCloseTo(usd(12, 7), 12);
  });

  it('a cost the provider reports stays the provider’s', async () => {
    const env = setup({
      a: [fake.text('Rea.', { providerMetadata: { openrouter: { usage: { cost: 0.02 } } } })],
    });
    const { usage } = await run(env);
    expect(usage[0]!.data.costUsd).toBe(0.02);
    expect(usage[0]!.data.estimated).toBeUndefined();
  });

  it('a stream broken halfway and asked again: the broken attempt is billed too', async () => {
    const env = setup({
      a: [
        fake.text('Rea è la seconda', { breakWith: { message: 'connection reset', code: 502 } }),
        fake.text('Rea è la seconda luna di Saturno.'),
      ],
    });
    const { result, usage, budget } = await run(env);
    expect(result.status).toBe('completed');
    expect(usage.map((u) => u.data.partial)).toEqual(['interrupted', undefined]);
    // The broken attempt: input as measured before the step, output from what it sent.
    const broken = usage[0]!.data;
    expect(broken).toMatchObject({
      provider: 'fake',
      model: 'a',
      estimated: true,
      outputTokens: 4,
    });
    expect(broken.inputTokens).toBeGreaterThan(0);
    expect(broken.costUsd).toBeCloseTo(usd(broken.inputTokens!, 4), 12);
    const total = (broken.costUsd ?? 0) + (usage[1]!.data.costUsd ?? 0);
    expect(budget.usage.costUsd).toBeCloseTo(total, 12);
    // One step for the loop's limits, both requests for the tokens.
    expect(budget.usage.steps).toBe(1);
    expect(budget.usage.tokens).toBe(broken.inputTokens! + 4 + 19);
  });

  it('a stream broken twice (no more retries): the run fails, both attempts are billed', async () => {
    const env = setup(
      {
        a: () => fake.text('Ecco la risposta', { chunkSize: 5, delayMs: 200 }),
      },
      { idleChunkMs: 40 },
    );
    const { result, usage } = await run(env);
    expect(result.status).toBe('failed');
    expect(usage.map((u) => u.data.partial)).toEqual(['interrupted', 'interrupted']);
    expect(usage.every((u) => (u.data.costUsd ?? 0) > 0)).toBe(true);
  });

  it('a stream stopped by the kill switch halfway is billed as aborted', async () => {
    const long = 'Rea è la seconda luna più grande di Saturno. '.repeat(10);
    const env = setup({ a: [fake.text(long, { chunkSize: 5, delayMs: 15 })] });
    const seen = new Promise<void>((resolve) => {
      const off = env.log.subscribe((e) => {
        if (e.type === 'message' && e.data.partial) {
          off();
          resolve();
        }
      });
    });
    const running = run(env, { partialFlushMs: 20 });
    await seen;
    await env.runs.kill({ by: 'ui', reason: 'test' });
    const { result, usage } = await running;
    expect(result.status).toBe('aborted');
    expect(usage).toHaveLength(1);
    expect(usage[0]!.data).toMatchObject({ partial: 'aborted', estimated: true });
    expect(usage[0]!.data.outputTokens).toBeGreaterThan(0);
    expect(usage[0]!.data.costUsd).toBeGreaterThan(0);
  });

  it('a model that reasoned and was given up for the next link: its reasoning is billed', async () => {
    const env = setup(
      {
        a: [
          fake.text('troppo tardi', { reasoning: 'Ci penso a lungo. '.repeat(20), delayMs: 300 }),
        ],
        b: [fake.text('Rea è una luna di Saturno.')],
      },
      { idleChunkMs: 40 },
    );
    const def = agent([
      { provider: 'fake', model: 'a' },
      { provider: 'fake', model: 'b' },
    ]);
    const { result, usage } = await run(env, { def });
    expect(result).toMatchObject({ status: 'completed', model: { model: 'b' } });
    expect(usage.map((u) => [u.data.model, u.data.partial])).toEqual([
      ['a', 'abandoned'],
      ['b', undefined],
    ]);
    expect(usage[0]!.data.outputTokens).toBe(Math.ceil('Ci penso a lungo. '.repeat(20).length / 4));
    expect(usage[0]!.data.costUsd).toBeGreaterThan(0);
  });

  it('an empty answer that still finished: the tokens it reported are billed', async () => {
    const env = setup({
      a: [
        fake.text(' ', {
          usage: {
            inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 40, text: 0, reasoning: 40 },
          },
        }),
        fake.text('Rea.'),
      ],
    });
    const { usage } = await run(env);
    expect(usage[0]!.data).toMatchObject({
      partial: 'abandoned',
      inputTokens: 900,
      outputTokens: 40,
    });
    expect(usage[0]!.data.costUsd).toBeCloseTo(usd(900, 40), 12);
  });

  it('without a price (a free model, a key the list does not price) nothing is made up', async () => {
    const env = setup({
      a: [
        fake.text('Rea è la seconda', { breakWith: { message: 'connection reset', code: 502 } }),
        fake.text('Rea.'),
      ],
    });
    const { usage, budget } = await run(env, { price: () => undefined });
    expect(usage).toHaveLength(2);
    expect(usage.every((u) => u.data.costUsd === undefined)).toBe(true);
    expect(budget.usage.costUsd).toBe(0);
  });
});

describe('answers cut short (F-M4)', () => {
  const closed = {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };

  it('a connection closed without a finish (`other`, no usage) is a broken stream, asked again', async () => {
    const env = setup({
      a: [
        fake.text('Rea è la seconda', { finishReason: 'other', usage: closed }),
        fake.text('Rea è la seconda luna di Saturno.'),
      ],
    });
    const { result, events, usage } = await run(env);
    expect(result).toMatchObject({
      status: 'completed',
      text: 'Rea è la seconda luna di Saturno.',
    });
    expect(events.filter((e) => e.type === 'error').map((e) => e.data.code)).toEqual([
      'stream_retry',
    ]);
    expect(usage.map((u) => u.data.partial)).toEqual(['interrupted', undefined]);
  });

  it('an answer cut at the length limit says so to the user and to whoever reads the report', async () => {
    const env = setup({
      a: [fake.text('Le lune di Saturno sono: Mimas, Encelado, Te', { finishReason: 'length' })],
    });
    const { result, events } = await run(env);
    expect(result.status).toBe('completed');
    expect(result.text).toBe(`Le lune di Saturno sono: Mimas, Encelado, Te\n\n${truncatedNote()}`);
    expect(result.finalText).toContain(truncatedNote());
    const notice = events.find((e) => e.type === 'error');
    expect(notice?.data).toMatchObject({ code: 'answer_truncated' });
    const answer = events.filter((e) => e.type === 'message' && !e.data.partial).at(-1);
    expect(answer?.type === 'message' && answer.data.text).toContain('Type “continue”');
  });
});

describe('the spending caps with direct keys (D-114) and the projects (F-B13)', () => {
  function meter(
    s: CoreServices,
    o: {
      classify?: (provider: string, model: string, priced: boolean) => UsageClass;
      members?: () => Record<string, string[]>;
      unpricedModels?: () => { agent: string; provider: string }[];
      caps?: Record<string, { dailyEur?: number }>;
    } = {},
  ) {
    let settings: SpendSettings = { dailyEur: 1, monthlyEur: 100, usdToEur: 1, agents: {} };
    const members = o.members ?? (() => ({ alfa: ['leda'], beta: [] }));
    return new SpendMeter({
      log: s.log,
      state: s.state,
      settings: () => settings,
      save: (next) => (settings = next),
      classify: o.classify ?? (() => 'paid'),
      paidAgent: () => true,
      agents: () => [
        { id: 'titan', name: 'Titan' },
        { id: 'leda', name: 'Leda' },
      ],
      projects: () =>
        Object.entries(members()).map(([id, m]) => ({
          id,
          name: id === 'alfa' ? 'Alfa' : 'Beta',
          members: m,
          caps: o.caps?.[id] ?? {},
        })),
      ...(o.unpricedModels ? { unpricedModels: o.unpricedModels } : {}),
      providerLabel: (p) => (p === 'anthropic' ? 'Anthropic' : p),
    });
  }

  it('a key without a price never stops, and the cap’s card says so before the first request', () => {
    inLang('it');
    const s = createCoreServices({ home: tempHome() });
    opened.push(s);
    const m = meter(s, {
      classify: (provider, _model, priced) =>
        provider === 'anthropic' && !priced ? 'unpriced' : 'paid',
      unpricedModels: () => [{ agent: 'leda', provider: 'anthropic' }],
    });
    // Nothing spent yet: already said.
    expect(m.view().unpriced).toEqual([
      { provider: 'anthropic', label: 'Anthropic', requests: 0, tokens: 0, cachedTokens: 0 },
    ]);
    expect(m.view().agents.find((a) => a.id === 'leda')).toMatchObject({ unpriced: ['Anthropic'] });
    expect(m.projectView('alfa').agents[0]).toMatchObject({ id: 'leda', unpriced: ['Anthropic'] });
    // Many requests without a cost: counted apart, never a stop (D-114: no block).
    for (let i = 0; i < 20; i++) {
      s.log.append({
        agent: 'leda',
        runId: 'r1',
        type: 'provider_usage',
        data: {
          provider: 'anthropic',
          model: 'claude-x',
          inputTokens: 50_000,
          outputTokens: 5_000,
        },
      });
    }
    expect(m.stopReason('leda')).toBeNull();
    expect(m.view().unpriced[0]).toMatchObject({ requests: 20, tokens: 1_100_000 });
    // An estimated cost (a price in the list) counts like a reported one.
    s.log.append({
      agent: 'leda',
      runId: 'r2',
      type: 'provider_usage',
      data: {
        provider: 'anthropic',
        model: 'claude-y',
        inputTokens: 100_000,
        outputTokens: 50_000,
        costUsd: 1.05,
        estimated: true,
      },
    });
    expect(m.stopReason('leda')).toMatch(/tetto di spesa di tutti i mostri/);
    m.close();
  });

  it('a monster moved to another project leaves its spending in the first one', () => {
    const s = createCoreServices({ home: tempHome() });
    opened.push(s);
    let members: Record<string, string[]> = { alfa: ['leda'], beta: [] };
    const m = meter(s, { members: () => members, caps: { beta: { dailyEur: 2 } } });
    const spend = (costUsd: number, project?: string | null) =>
      s.log.append({
        agent: 'leda',
        runId: 'r1',
        type: 'provider_usage',
        data: {
          provider: 'openrouter',
          model: 'x/paid',
          costUsd,
          ...(project !== undefined ? { project } : {}),
        },
      });
    spend(0.6, 'alfa');
    spend(0.3, null); // A run outside any project.
    members = { alfa: [], beta: ['leda'] };
    m.rearm();
    expect(m.projectView('alfa').day.spentEur).toBeCloseTo(0.6);
    expect(m.projectView('beta').day.spentEur).toBe(0);
    spend(0.1, 'beta');
    expect(m.projectView('beta').day.spentEur).toBeCloseTo(0.1);
    // The monster's own and the team's totals keep everything.
    expect(m.view().agents.find((a) => a.id === 'leda')!.day.spentEur).toBeCloseTo(1);
    // The same after a restart: the totals come from the log.
    m.close();
    const again = meter(s, { members: () => members });
    expect(again.projectView('alfa').day.spentEur).toBeCloseTo(0.6);
    expect(again.projectView('beta').day.spentEur).toBeCloseTo(0.1);
    // An older event without `project` still counts by membership, as before.
    spend(0.2);
    expect(again.projectView('beta').day.spentEur).toBeCloseTo(0.3);
    again.close();
  });

  it('a project’s cap stops the monster for that project’s runs only', () => {
    inLang('it');
    const s = createCoreServices({ home: tempHome() });
    opened.push(s);
    let members: Record<string, string[]> = { alfa: ['leda'], beta: [] };
    const m = meter(s, { members: () => members, caps: { alfa: { dailyEur: 0.5 } } });
    s.log.append({
      agent: 'leda',
      runId: 'r1',
      type: 'provider_usage',
      data: { provider: 'openrouter', model: 'x/paid', costUsd: 0.6, project: 'alfa' },
    });
    expect(m.stopReason('leda')).toMatch(/del progetto Alfa/);
    members = { alfa: [], beta: ['leda'] };
    // In Beta now: Alfa's cap is not Leda's any more, and Beta spent nothing.
    expect(m.stopReason('leda')).toBeNull();
    m.close();
  });
});
