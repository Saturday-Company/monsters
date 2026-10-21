import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  claudePlanFallback,
  ProviderRegistry,
  RateBudget,
  type HarnessProvider,
  type HarnessTask,
} from '@monsters/providers';
import { fake, FakeProvider, type FakeScript } from '@monsters/providers/testing';
import {
  autoChain,
  type AgentModels,
  type LogEvent,
  type ProvidersResponse,
  type Receipt,
} from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import type { DecisionPort, SystemOneAnswer } from '../src/index.ts';
import { startTestHub } from './hub-helpers.ts';

/*
 * "Automatica" (D-093) in the real core: the chain written from a base with
 * its tiers, kept by every save; the radiografia's level choosing the model of
 * the Claude harness at each request; the model that served the run pinned;
 * Opus at the plan's limit going down to Sonnet; the receipt saying why.
 */

type Sent = { runId: string };

/** A Claude harness that records the model of every run; `opus` may be at the plan's limit. */
function claudeHarness(opts: { opusLimited?: boolean } = {}): HarnessProvider & {
  tasks: HarnessTask[];
} {
  const tasks: HarnessTask[] = [];
  return {
    id: 'claude-agent',
    kind: 'harness',
    auth: 'external-login',
    budget: new RateBudget({ id: 'claude-agent', windows: [], limitScope: 'account' }),
    tasks,
    listModels: () => Promise.resolve([]),
    // eslint-disable-next-line @typescript-eslint/require-await
    async *run(task) {
      tasks.push(task);
      if (opts.opusLimited && task.model === 'opus') {
        yield { type: 'done', reason: 'error', error: 'usage limit reached', code: 'usage_limit' };
        return;
      }
      yield { type: 'usage', model: task.model ?? 'sonnet', inTok: 100, outTok: 10 };
      yield { type: 'done', reason: 'stop', text: `Fatto (${task.model}).` };
    },
  };
}

/**
 * The radiografia answers with this tier score (cuts 0.3 / 1.0), "finito davvero" yes. A
 * function scores each text asked (the request, or the subtask of a delegation, D-109);
 * it may throw, as a failed engine does.
 */
function jev(tier: number | ((text: string) => number)): DecisionPort {
  return {
    id: 'jev',
    decide: (request) => {
      const asked = (request.state as { richiesta?: unknown }).richiesta;
      const text = typeof asked === 'string' ? asked : '';
      const answers: SystemOneAnswer[] = request.questions.map((q) => {
        const value =
          q.id === 'tier'
            ? typeof tier === 'number'
              ? tier
              : tier(text)
            : q.type === 'choice'
              ? typeof q.options[0] === 'string'
                ? q.options[0]
                : q.options[0]!.label
              : q.id === 'done'
                ? 0.95
                : 0.5;
        return { id: q.id, value, confidence: 0.9 };
      });
      return Promise.resolve({ answers, model: 'jev-1.13.0' });
    },
  };
}

async function hubWith(
  scripts: Record<string, FakeScript>,
  harness: HarnessProvider,
  tier: number | ((text: string) => number) | null,
) {
  const provider = new FakeProvider({ models: scripts });
  const providers = new ProviderRegistry().register(provider).register(harness);
  const t = await startTestHub(scripts, {
    hub: {
      providers,
      ...(tier !== null
        ? { decisionPort: jev(tier), settings: { instinct: { engine: 'jev' } } }
        : {}),
    },
  });
  // The plan is not enabled in the subscriptions of this home: the test puts the harness back.
  if (!providers.has(harness.id)) providers.register(harness);
  return { ...t, provider };
}

/** The Media chain before D-110 (Haiku for the simple ones): monsters saved so keep working. */
const LEGACY_MEDIUM = [
  { provider: 'claude-agent', model: 'sonnet' },
  { provider: 'claude-agent', model: 'haiku', tier: 'light' as const },
  { provider: 'claude-agent', model: 'opus', tier: 'strong' as const },
];
const EFFORT = { hard: 'high', medium: 'medium', simple: 'medium' } as const;

const tierEvents = (events: LogEvent[]) =>
  events.filter(
    (e): e is LogEvent<'instinct'> => e.type === 'instinct' && e.data.action === 'tier',
  );

describe('"Automatica" on the Claude plan (D-093)', () => {
  it('a save writes the chain of the base with its tiers, and the view shows the mode', async () => {
    const t = await hubWith({}, claudeHarness(), null);
    const saved = await t.json<AgentModels>('PUT', '/api/agents/rhea/models', {
      models: [{ provider: 'fake', model: 'ignored' }],
      auto: { base: 'medium' },
    });
    expect(saved.models).toEqual(autoChain('medium'));
    expect(saved.auto).toEqual({ base: 'medium' });
    const yaml = readFileSync(join(t.home, 'agents', 'rhea', 'agent.yaml'), 'utf8');
    expect(yaml).toContain('autoModels:');
    // D-110: Sonnet for Semplice and Media, Opus for Difficile; no Haiku, no light link.
    expect(yaml).not.toContain('haiku');
    expect(yaml).not.toContain('tier: light');
    expect(yaml).toContain('tier: strong');

    // A manual chain with tiers keeps them; the automatic mode goes.
    const manual = await t.json<AgentModels>('PUT', '/api/agents/rhea/models', {
      models: [
        { provider: 'claude-agent', model: 'sonnet', tier: 'light' },
        { provider: 'claude-agent', model: 'opus', tier: 'strong' },
      ],
    });
    expect(manual.models.map((m) => m.tier)).toEqual(['light', 'strong']);
    expect(manual.auto).toBeUndefined();
    expect(readFileSync(join(t.home, 'agents', 'rhea', 'agent.yaml'), 'utf8')).not.toContain(
      'autoModels',
    );

    // The base each monster starts from (D-110): Media for everyone, the capo squadra too.
    const view = await t.json<ProvidersResponse>('GET', '/api/providers');
    const base = Object.fromEntries(view.agents.map((a) => [a.id, a.suggestedBase]));
    expect(base).toMatchObject({ titan: 'medium', rhea: 'medium', dione: 'medium' });
    expect(view.agents.find((a) => a.id === 'rhea')!.models[1]!.tier).toBe('strong');
  });

  it('refuses "Automatica" without the Claude plan', async () => {
    const t = await startTestHub({});
    const res = await t.api('PUT', '/api/agents/rhea/models', {
      models: [{ provider: 'fake', model: 'rhea' }],
      auto: { base: 'strong' },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('not_configured');
  });

  for (const [score, level, model] of [
    [1.4, 'hard', 'opus'],
    [0.1, 'simple', 'sonnet'],
    [0.6, 'medium', 'sonnet'],
  ] as const) {
    it(`a ${level} request goes to ${model} on the base Media (Sonnet Medio, Opus Alto), and the receipt says why`, async () => {
      const harness = claudeHarness();
      const t = await hubWith({}, harness, score);
      await t.json('PUT', '/api/agents/titan/models', {
        models: autoChain('medium'),
        auto: { base: 'medium' },
      });
      const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Una richiesta' });
      expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
      expect(harness.tasks.map((x) => x.model)).toEqual([model]);
      // The effort goes to Claude Code with the model (D-110).
      expect(harness.tasks.map((x) => x.effort)).toEqual([EFFORT[level]]);
      const tiers = tierEvents(t.events(sent.runId));
      expect(tiers.map((e) => e.data.details)).toEqual([
        expect.objectContaining({
          level,
          model: `claude-agent:${model}`,
          effort: EFFORT[level],
        }),
      ]);
      const [receipt] = await t.json<Receipt[]>('GET', `/api/runs/${sent.runId}/receipts`);
      expect(receipt!.models).toEqual([
        { agent: 'titan', model: `claude-agent:${model}`, level, effort: EFFORT[level] },
      ]);
    });
  }

  it('without Jev the base stays (no tier asked, no event)', async () => {
    const harness = claudeHarness();
    const t = await hubWith({}, harness, null);
    await t.json('PUT', '/api/agents/titan/models', {
      models: autoChain('strong'),
      auto: { base: 'strong' },
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Ciao' });
    await t.runEnded(sent.runId);
    expect(harness.tasks.map((x) => x.model)).toEqual(['opus']);
    expect(tierEvents(t.events(sent.runId))).toEqual([]);
  });

  it('delegations take the level of their subtask; Opus at the limit goes to Sonnet, which then stays pinned', async () => {
    const harness = claudeHarness({ opusLimited: true });
    const t = await hubWith(
      {
        titan: [
          fake.toolCall('delegate', { agent: 'Rhea', goal: 'Prima ricerca' }),
          fake.toolCall('delegate', { agent: 'Rhea', goal: 'Seconda ricerca' }),
          fake.text('Fatto.'),
        ],
      },
      harness,
      1.4,
    );
    await t.json('PUT', '/api/agents/rhea/models', {
      models: autoChain('medium'),
      auto: { base: 'medium' },
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Due ricerche difficili' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    // First delegation: hard → Opus, at the limit → Sonnet (same plan). Second: pinned on Sonnet.
    expect(harness.tasks.map((x) => x.model)).toEqual(['opus', 'sonnet', 'sonnet']);
    // Opus works at Alto, the Sonnet that takes over at Medio (D-110).
    expect(harness.tasks.map((x) => x.effort)).toEqual(['high', 'medium', 'medium']);
    const events = t.events(sent.runId);
    const fallback = events.find(
      (e): e is LogEvent<'error'> => e.type === 'error' && e.data.code === 'provider_fallback',
    );
    expect(fallback?.data.fallback).toEqual({
      from: 'claude-agent:opus',
      to: 'claude-agent:sonnet',
      reason: 'usage_limit',
    });
    // The tier moved Rhea only once: after the fallback the second delegation stays on Sonnet.
    expect(tierEvents(events).filter((e) => e.data.subject === 'rhea')).toHaveLength(1);
    const [receipt] = await t.json<Receipt[]>('GET', `/api/runs/${sent.runId}/receipts`);
    expect(receipt!.models?.find((m) => m.agent === 'rhea')).toEqual({
      agent: 'rhea',
      model: 'claude-agent:sonnet',
      level: 'hard',
      effort: 'medium',
      limited: 'claude-agent:opus',
    });
  });

  describe('each delegation has the level of its own subtask (D-109)', () => {
    /** Hard for the requests and subtasks that say "difficile", simple for the others. */
    const byWords = (text: string) => (/difficil/i.test(text) ? 1.4 : 0.1);
    const delegationsOf = (events: LogEvent[]) =>
      events.filter(
        (e): e is LogEvent<'delegation'> => e.type === 'delegation' && e.data.status !== 'started',
      );

    async function team(scripts: Record<string, FakeScript>, score: Parameters<typeof jev>[0]) {
      const harness = claudeHarness();
      const t = await hubWith(scripts, harness, score);
      for (const id of ['rhea', 'dione']) {
        await t.core.hub.team.setModels(id, LEGACY_MEDIUM, { base: 'medium' });
      }
      return { t, harness };
    }

    it('a hard request with a simple subtask: that member goes to the light model', async () => {
      const { t, harness } = await team(
        {
          titan: [
            fake.toolCall('delegate', { agent: 'Rhea', goal: 'Traduci in inglese una riga' }),
            fake.text('Fatto.'),
          ],
        },
        byWords,
      );
      const sent = await t.json<Sent>('POST', '/api/messages', {
        text: 'Un lavoro difficile: analisi del contratto e traduzione',
      });
      expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
      expect(harness.tasks.map((x) => x.model)).toEqual(['haiku']);
      const events = t.events(sent.runId);
      const [started] = events.filter((e) => e.type === 'delegation');
      const rhea = tierEvents(events).filter((e) => e.data.subject === 'rhea');
      expect(rhea).toHaveLength(1);
      expect(rhea[0]!.parentId).toBe(started!.id);
      expect(rhea[0]!.data.details).toEqual({
        level: 'simple',
        model: 'claude-agent:haiku',
        moved: true,
        delegation: started!.id,
        from: 'subtask',
      });
      expect(rhea[0]!.data.message).toBe('Simple task: Rhea uses haiku.');
      // The question was asked on the subtask, without the user's request (`why` of the brief).
      const asked = events.filter(
        (e): e is LogEvent<'decision'> =>
          e.type === 'decision' && e.data.kind === 'tier' && e.parentId === started!.id,
      );
      expect(asked).toHaveLength(1);
      expect(JSON.stringify(asked[0]!.data)).not.toContain('analisi del contratto');
      // The delegation and the receipt say the level that chose the model.
      expect(delegationsOf(events)[0]!.data).toMatchObject({ level: 'simple', tier: 'light' });
      const [receipt] = await t.json<Receipt[]>('GET', `/api/runs/${sent.runId}/receipts`);
      expect(receipt!.delegations[0]).toMatchObject({
        level: 'simple',
        model: 'claude-agent:haiku',
      });
    });

    it('a simple request with a hard subtask: that member goes to the strong model', async () => {
      const { t, harness } = await team(
        {
          titan: [
            fake.toolCall('delegate', {
              agent: 'Rhea',
              goal: 'Confronta i prezzi dei concorrenti',
              constraints: ['analisi difficile: dieci fonti e i conti del margine'],
            }),
            fake.text('Fatto.'),
          ],
        },
        byWords,
      );
      const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Dammi un’idea veloce' });
      expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
      expect(harness.tasks.map((x) => x.model)).toEqual(['opus']);
      const rhea = tierEvents(t.events(sent.runId)).find((e) => e.data.subject === 'rhea')!;
      expect(rhea.data.details).toMatchObject({ level: 'hard', from: 'subtask' });
    });

    it('Jev fails on the subtask: the delegation takes the level of the request', async () => {
      let calls = 0;
      const { t, harness } = await team(
        {
          titan: [
            fake.toolCall('delegate', { agent: 'Rhea', goal: 'Una ricerca' }),
            fake.text('Fatto.'),
          ],
        },
        // The radiografia of the request answers (hard), the subtask's question fails.
        () => {
          if (++calls > 1) throw new Error('jev down');
          return 1.4;
        },
      );
      const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Una richiesta' });
      expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
      expect(harness.tasks.map((x) => x.model)).toEqual(['opus']);
      const rhea = tierEvents(t.events(sent.runId)).find((e) => e.data.subject === 'rhea')!;
      expect(rhea.data.details).toMatchObject({ level: 'hard', from: 'request' });
      expect(rhea.data.message).toBe('Hard request: Rhea uses opus.');
    });

    it('parallel delegations: each with its own level, the questions asked together', async () => {
      let inFlight = 0;
      let most = 0;
      const port = jev((text) => (/difficil/i.test(text) ? 1.4 : 0.1));
      const slow: DecisionPort = {
        id: 'jev',
        decide: async (request, signal) => {
          inFlight++;
          most = Math.max(most, inFlight);
          await new Promise((r) => setTimeout(r, 50));
          inFlight--;
          return port.decide(request, signal);
        },
      };
      const harness = claudeHarness();
      const provider = new FakeProvider({
        models: {
          titan: [
            fake.toolCalls([
              { name: 'delegate', input: { agent: 'Rhea', goal: 'Ricerca difficile sui bandi' } },
              { name: 'delegate', input: { agent: 'Dione', goal: 'Un titolo per il post' } },
            ]),
            fake.text('Fatto.'),
          ],
        },
      });
      const providers = new ProviderRegistry().register(provider).register(harness);
      const t = await startTestHub(
        {},
        { hub: { providers, decisionPort: slow, settings: { instinct: { engine: 'jev' } } } },
      );
      if (!providers.has(harness.id)) providers.register(harness);
      for (const id of ['rhea', 'dione']) {
        await t.core.hub.team.setModels(id, LEGACY_MEDIUM, { base: 'medium' });
      }
      const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Due lavori' });
      expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
      expect([...harness.tasks.map((x) => x.model)].sort()).toEqual(['haiku', 'opus']);
      const levels = Object.fromEntries<string>(
        tierEvents(t.events(sent.runId)).map((e): [string, string] => [
          e.data.subject ?? '',
          String(e.data.details?.['level']),
        ]),
      );
      expect(levels).toEqual({ rhea: 'hard', dione: 'simple' });
      expect(most).toBeGreaterThanOrEqual(2);
    });

    it('the same monster twice in a run: each delegation its own level', async () => {
      const { t, harness } = await team(
        {
          titan: [
            fake.toolCall('delegate', { agent: 'Rhea', goal: 'Ricerca difficile sui bandi' }),
            fake.toolCall('delegate', { agent: 'Rhea', goal: 'Il link del bando' }),
            fake.text('Fatto.'),
          ],
        },
        byWords,
      );
      const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Due ricerche' });
      expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
      expect(harness.tasks.map((x) => x.model)).toEqual(['opus', 'haiku']);
    });
  });

  describe('Sonnet Medio and Opus Alto, for the request and for each subtask (D-110)', () => {
    const byWords = (text: string) => (/difficil/i.test(text) ? 1.4 : 0.1);

    it('a simple subtask of a hard request stays on Sonnet at Medio; a hard one goes to Opus at Alto', async () => {
      const harness = claudeHarness();
      const t = await hubWith(
        {
          titan: [
            fake.toolCall('delegate', { agent: 'Rhea', goal: 'Traduci in inglese una riga' }),
            fake.toolCall('delegate', { agent: 'Rhea', goal: 'Ricerca difficile sui bandi' }),
            fake.text('Fatto.'),
          ],
        },
        harness,
        byWords,
      );
      await t.json('PUT', '/api/agents/rhea/models', {
        models: autoChain('medium'),
        auto: { base: 'medium' },
      });
      const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Un lavoro difficile' });
      expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
      // Each subtask follows its own level, whatever the request was.
      expect(harness.tasks.map((x) => [x.model, x.effort])).toEqual([
        ['sonnet', 'medium'],
        ['opus', 'high'],
      ]);
      const [receipt] = await t.json<Receipt[]>('GET', `/api/runs/${sent.runId}/receipts`);
      expect(receipt!.delegations.map((d) => [d.level, d.model, d.effort])).toEqual([
        ['simple', 'claude-agent:sonnet', 'medium'],
        ['hard', 'claude-agent:opus', 'high'],
      ]);
    });

    it('a monster outside "Automatica" gets no effort, whatever its model', async () => {
      const harness = claudeHarness();
      const t = await hubWith({}, harness, null);
      await t.json('PUT', '/api/agents/titan/models', {
        models: [{ provider: 'claude-agent', model: 'opus' }],
      });
      const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Ciao' });
      await t.runEnded(sent.runId);
      expect(harness.tasks.map((x) => [x.model, x.effort])).toEqual([['opus', undefined]]);
    });
  });

  it('only Opus goes down, and only to Sonnet', () => {
    expect(['opus', 'claude-opus-5-5', 'sonnet', 'haiku'].map(claudePlanFallback)).toEqual([
      'sonnet',
      'sonnet',
      undefined,
      undefined,
    ]);
  });
});
