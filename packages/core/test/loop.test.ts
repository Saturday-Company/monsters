import { ProviderRegistry, type SessionOptions } from '@monsters/providers';
import { fake, FakeProvider, type FakeScript } from '@monsters/providers/testing';
import { defineTool, ToolError, type LogEvent, type MonstersTool } from '@monsters/shared';
import type { ModelMessage } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  agentTokenLimit,
  compactToolResults,
  contextLimitsFor,
  filtersOf,
  RESULT_READ,
  RunContext,
  createCoreServices,
  finalStepNote,
  parseAgentConfig,
  RunBudget,
  RunLimitsSchema,
  runAgent,
  withInjected,
  wrapExternalData,
  type AgentConfigInput,
  type AgentDefinition,
  type CoreServices,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { inLang } from './prompt-lang.ts';

/* The loop of one agent after D-064 (AG-03, 04, 14-18, 21, 23). */

const opened: CoreServices[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.db.close();
});

function setup(models: Record<string, FakeScript>, session: SessionOptions = {}) {
  const services = createCoreServices({ home: tempHome() });
  opened.push(services);
  const provider = new FakeProvider({ models });
  const providers = new ProviderRegistry().register(provider);
  return { ...services, provider, providers, session };
}

function agent(overrides: Partial<AgentConfigInput> = {}): AgentDefinition {
  return {
    config: parseAgentConfig({
      id: 'rhea',
      name: 'Rhea',
      role: 'ricerche online',
      color: '#4f8df7',
      models: [{ provider: 'fake', model: 'a' }],
      tools: ['lookup', 'save'],
      limits: { maxSteps: 4 },
      ...overrides,
    }),
    instructions: '# Rhea',
  };
}

let lookups = 0;
const lookup = defineTool({
  name: 'lookup',
  description: 'Looks up a moon of Saturn.',
  inputSchema: z.object({ q: z.string().min(1), max_results: z.number().int().optional() }),
  readOnly: true,
  execute: ({ q }) => {
    lookups++;
    if (q === 'boom') return Promise.reject(new ToolError('UNAVAILABLE', 'lookup is down'));
    return Promise.resolve({ text: `${q}: luna di Saturno (${lookups})` });
  },
});
const saved: string[] = [];
const save = defineTool({
  name: 'save',
  description: 'Saves a note.',
  inputSchema: z.object({ text: z.string(), tags: z.array(z.string()).optional() }),
  execute: ({ text }) => {
    saved.push(text);
    return Promise.resolve({ ok: true });
  },
});

type Env = ReturnType<typeof setup>;

async function run(
  env: Env,
  options: Partial<Parameters<typeof runAgent>[0]> & { agent?: AgentDefinition } = {},
) {
  const r = env.runs.startRun({ agent: 'rhea' });
  const session = env.providers.session((options.agent ?? agent()).config.models, env.session);
  const result = await runAgent({
    agent: agent(),
    task: 'Cerca Rea',
    tools: [lookup, save],
    signal: r.signal,
    log: env.log,
    runId: r.id,
    session,
    ...options,
  });
  r.finish();
  return { result, events: env.log.query({ runId: r.id, limit: 1000 }) };
}

const promptOf = (env: Env, i: number) =>
  env.provider.calls[i]!.options.prompt as { role: string; content: unknown }[];
const text = (v: unknown) => JSON.stringify(v);

describe('the last step writes the report (AG-03)', () => {
  it('has no tools and asks for the report, so an agent that keeps calling tools ends with a text', async () => {
    const env = setup({
      a: [
        fake.toolCall('lookup', { q: 'rea' }),
        fake.toolCall('lookup', { q: 'teti' }),
        fake.toolCall('lookup', { q: 'dione' }),
        fake.text('Rapporto: Rea, Teti e Dione trovate; manca Giapeto.'),
      ],
    });
    const { result, events } = await run(env);
    expect(result).toMatchObject({
      status: 'max_steps',
      text: expect.stringContaining('Rapporto: Rea, Teti e Dione') as unknown,
      finalText: 'Rapporto: Rea, Teti e Dione trovate; manca Giapeto.',
      steps: 4,
    });
    const last = env.provider.calls[3]!.options;
    expect(last.tools ?? []).toHaveLength(0);
    expect(last.toolChoice).toEqual({ type: 'none' });
    expect(text(last.prompt)).toContain(finalStepNote().slice(0, 30));
    // The earlier steps had their tools.
    expect(env.provider.calls[2]!.options.tools?.length).toBe(3);
    const stop = events.find((e): e is LogEvent<'error'> => e.type === 'error');
    expect(stop?.data).toMatchObject({
      code: 'max_steps',
      limit: { kind: 'agent_steps', value: 4 },
    });
    expect(result.limit).toEqual({ kind: 'agent_steps', value: 4 });
    expect(stop?.data.message).toContain('report written at the last step');
  });

  it('also when the run budget runs out', async () => {
    const env = setup({
      a: [
        fake.toolCall('lookup', { q: 'rea' }),
        fake.toolCall('lookup', { q: 'teti' }),
        fake.text('Rapporto: Rea e Teti, il resto no.'),
      ],
    });
    const budget = new RunBudget(RunLimitsSchema.parse({ maxRunSteps: 3 }));
    const { result, events } = await run(env, {
      agent: agent({ limits: { maxSteps: 20 } }),
      budget,
    });
    expect(result).toMatchObject({
      status: 'run_limit',
      finalText: 'Rapporto: Rea e Teti, il resto no.',
      limit: { kind: 'steps', value: 3 },
    });
    expect(events.find((e) => e.type === 'error')?.data).toMatchObject({
      code: 'run_limit',
      limit: { kind: 'steps', value: 3 },
    });
    expect(env.provider.calls).toHaveLength(3);
    expect(env.provider.calls[2]!.options.toolChoice).toEqual({ type: 'none' });
  });

  it('and when the run is out of dollars (AG-23)', async () => {
    const env = setup({
      a: [fake.toolCall('lookup', { q: 'rea' }), fake.text('Rapporto: solo Rea.')],
    });
    const budget = new RunBudget(RunLimitsSchema.parse({ maxRunCostUsd: 0.1 }));
    budget.addStep(10, 0.2);
    // Spent before the agent started: it does not start.
    const { result } = await run(env, { budget });
    expect(result).toMatchObject({
      status: 'run_limit',
      steps: 0,
      limit: { kind: 'cost', value: 0.1 },
    });
    expect(result.error).toContain('0.1 $');
  });
});

describe('cost limits (AG-23)', () => {
  it('RunBudget counts the dollars the providers report', () => {
    const budget = new RunBudget(RunLimitsSchema.parse({ maxRunCostUsd: 0.5 }));
    budget.addStep(1000, 0.3);
    budget.addStep(1000);
    expect(budget.exhausted()).toBeNull();
    budget.addStep(1000, 0.25);
    expect(budget.usage.costUsd).toBeCloseTo(0.55);
    expect(budget.exhausted()).toContain('0.5 $');
    expect(RunLimitsSchema.parse({}).maxRunCostUsd).toBe(0.5);
  });

  it('a paid search a tool logs counts in the dollars, not in the steps (D-071)', async () => {
    const env = setup({
      a: [fake.toolCall('lookup', { q: 'rea' }), fake.text('Rapporto: Rea.')],
    });
    const paid = defineTool({
      name: 'lookup',
      description: 'Looks up a moon, for a fee.',
      inputSchema: z.object({ q: z.string() }),
      readOnly: true,
      execute: (_input, ctx) => {
        ctx.emit({
          type: 'provider_usage',
          data: { provider: 'web_search', model: 'openrouter/parallel-fast', costUsd: 0.2 },
        });
        return Promise.resolve({ text: 'Rea' });
      },
    });
    const budget = new RunBudget(RunLimitsSchema.parse({ maxRunCostUsd: 0.5 }));
    await run(env, { tools: [paid, save], budget });
    expect(budget.usage.costUsd).toBeCloseTo(0.2);
    expect(budget.usage.steps).toBe(2);
  });

  it('a delegated agent without its own token limit gets the run default', () => {
    const limits = RunLimitsSchema.parse({});
    expect(agentTokenLimit({ kind: 'subagent', limits: {} }, limits)).toBe(400_000);
    expect(agentTokenLimit({ kind: 'subagent', limits: { maxTotalTokens: 5000 } }, limits)).toBe(
      5000,
    );
    expect(agentTokenLimit({ kind: 'orchestrator', limits: {} }, limits)).toBeUndefined();
  });

  it('the dollars of a step reach the budget from the provider metadata', async () => {
    const env = setup({ a: [fake.text('ok')] });
    const budget = new RunBudget();
    // The fake reports no cost: the budget counts 0 $, never a made-up price.
    await run(env, { budget });
    expect(budget.usage).toMatchObject({ steps: 1, costUsd: 0 });
  });
});

describe('time limits and broken streams (AG-04, AG-21)', () => {
  it('a model that stops after the first token: the step is asked again once, then the run fails readably', async () => {
    const env = setup(
      { a: () => fake.text('Ecco la risposta', { chunkSize: 5, delayMs: 200 }) },
      { idleChunkMs: 40 },
    );
    const started = Date.now();
    const { result, events } = await run(env, { tools: [] });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/stopped halfway through its answer: no data for 0 s/);
    const codes = events.filter((e) => e.type === 'error').map((e) => e.data.code);
    expect(codes).toEqual(['stream_retry', 'agent_failed']);
    expect(env.provider.calls).toHaveLength(2);
  });

  it('a stream broken halfway is retried without running the tool calls of the steps before', async () => {
    lookups = 0;
    const env = setup({
      a: [
        fake.toolCall('lookup', { q: 'rea' }),
        fake.toolCall('save', { text: 'nota su Rea' }),
        fake.text('Rea è la seconda', { breakWith: { message: 'connection reset', code: 502 } }),
        fake.text('Rea è la seconda luna di Saturno.'),
      ],
    });
    saved.length = 0;
    const { result, events } = await run(env);
    expect(result).toMatchObject({
      status: 'completed',
      text: 'Rea è la seconda luna di Saturno.',
      finalText: 'Rea è la seconda luna di Saturno.',
    });
    expect(lookups).toBe(1);
    expect(saved).toEqual(['nota su Rea']);
    expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(2);
    const retry = events.find((e): e is LogEvent<'error'> => e.type === 'error');
    expect(retry?.data).toMatchObject({ code: 'stream_retry' });
    // The retry is the same step: the conversation it sends ends with the tool result.
    expect(promptOf(env, 3).at(-1)?.role).toBe('tool');
  });
});

describe('messages that arrive while the agent works (AG-15)', () => {
  it('stay in the conversation when an answer that only repeats the task is asked again', async () => {
    const task = 'Cerca Rea, la seconda luna di Saturno';
    const env = setup({
      a: [
        fake.toolCall('lookup', { q: 'rea' }),
        fake.text(task),
        fake.text('Fatto, e ho visto il tuo messaggio.'),
      ],
    });
    let delivered = false;
    const inbox = () => {
      if (delivered) return [];
      delivered = true;
      return ['Aggiungi anche Teti, per favore'];
    };
    const { result } = await run(env, { inbox, task });
    expect(result).toMatchObject({
      status: 'completed',
      text: 'Fatto, e ho visto il tuo messaggio.',
    });
    // The echo was asked again: the message is still there, after the tool result it followed.
    expect(env.provider.calls).toHaveLength(3);
    expect(text(promptOf(env, 2))).toContain('Aggiungi anche Teti, per favore');
    const roles = promptOf(env, 2).map((m) => m.role);
    expect(roles.slice(-2)).toEqual(['tool', 'user']);
  });

  it('withInjected puts each message after the response messages that came before it', () => {
    const u = (t: string): ModelMessage => ({ role: 'user', content: t });
    const a = (t: string): ModelMessage => ({ role: 'assistant', content: t });
    const out = withInjected(
      [u('task')],
      [a('r0'), a('r1'), a('r2')],
      [
        { after: 2, message: u('m1') },
        { after: 3, message: u('m2') },
      ],
    );
    expect(out.map((m) => m.content)).toEqual(['task', 'r0', 'r1', 'm1', 'r2', 'm2']);
  });
});

describe('repeated calls and failures in a row (AG-16)', () => {
  it('the same read-only call is answered from the cache, the third time refused', async () => {
    inLang('it');
    lookups = 0;
    const env = setup({
      a: [
        fake.toolCall('lookup', { q: 'rea' }),
        fake.toolCall('lookup', { q: 'rea' }),
        fake.toolCall('lookup', { q: 'rea' }),
        fake.text('Rea.'),
      ],
    });
    const { result, events } = await run(env, { agent: agent({ limits: { maxSteps: 6 } }) });
    expect(result.status).toBe('completed');
    expect(lookups).toBe(1);
    const results = events.filter((e): e is LogEvent<'tool_result'> => e.type === 'tool_result');
    expect(results.map((r) => [r.data.ok, r.data.repeated ?? false])).toEqual([
      [true, false],
      [true, true],
      [false, false],
    ]);
    expect(results[2]!.data.error).toMatch(/^REPEATED_CALL/);
    expect(text(promptOf(env, 3))).toContain('Hai già questo risultato');
  });

  it('a write in between makes the read run again', async () => {
    lookups = 0;
    const env = setup({
      a: [
        fake.toolCall('lookup', { q: 'rea' }),
        fake.toolCall('save', { text: 'x' }),
        fake.toolCall('lookup', { q: 'rea' }),
        fake.text('Rea.'),
      ],
    });
    await run(env, { agent: agent({ limits: { maxSteps: 6 } }) });
    expect(lookups).toBe(2);
  });

  it('after three failures in a row a reminder, after four another model', async () => {
    inLang('it');
    const boom = fake.toolCall('lookup', { q: 'boom' });
    const env = setup({
      a: [
        boom,
        fake.toolCall('lookup', { q: 'boom', max_results: 1 }),
        fake.toolCall('lookup', { q: 'boom', max_results: 2 }),
        fake.toolCall('lookup', { q: 'boom', max_results: 3 }),
      ],
      b: [fake.text('Il servizio non risponde: ecco cosa so.')],
    });
    const { result, events } = await run(env, {
      agent: agent({
        limits: { maxSteps: 8 },
        models: [
          { provider: 'fake', model: 'a' },
          { provider: 'fake', model: 'b' },
        ],
      }),
    });
    expect(result).toMatchObject({ status: 'completed', model: { model: 'b' } });
    expect(text(promptOf(env, 3))).toContain('Le ultime 3 chiamate agli strumenti sono fallite');
    const streaks = events.filter(
      (e): e is LogEvent<'error'> => e.type === 'error' && e.data.code === 'tool_error_streak',
    );
    expect(streaks.map((e) => e.data.message)).toEqual([
      'Rhea: 3 errori di fila negli strumenti',
      'Rhea: 4 errori di fila negli strumenti, provo il modello successivo',
    ]);
  });
});

describe('malformed calls are repaired, not paid with a step (AG-17)', () => {
  it('a tool name in another case and JSON with text around it', async () => {
    lookups = 0;
    const env = setup({
      a: [
        {
          kind: 'tool-calls',
          calls: [{ name: 'Lookup', input: null, rawInput: 'Ecco: {"q": "rea",} fine' }],
        },
        fake.text('Rea.'),
      ],
    });
    const { result, events } = await run(env);
    expect(result.status).toBe('completed');
    expect(lookups).toBe(1);
    const call = events.find((e): e is LogEvent<'tool_call'> => e.type === 'tool_call');
    expect(call?.data).toMatchObject({ tool: 'lookup', input: { q: 'rea' } });
    expect(call?.data.repaired).toEqual(['name', 'json']);
  });

  it('keys in camelCase and a list passed as a JSON string', async () => {
    saved.length = 0;
    const env = setup({
      a: [
        fake.toolCall('save', { Text: 'x', tags: '["a","b"]' }),
        fake.toolCall('lookup', { q: 'rea', maxResults: '3' }),
        fake.text('ok'),
      ],
    });
    const { events } = await run(env);
    const calls = events.filter((e): e is LogEvent<'tool_call'> => e.type === 'tool_call');
    expect(calls.map((c) => c.data.repaired)).toEqual([
      ['keys', 'values'],
      ['keys', 'values'],
    ]);
    const results = events.filter((e): e is LogEvent<'tool_result'> => e.type === 'tool_result');
    expect(results.every((r) => r.data.ok)).toBe(true);
    expect(saved).toEqual(['x']);
  });

  it('what cannot be repaired gets an INVALID_INPUT in Italian with the arguments of the tool', async () => {
    inLang('it');
    const env = setup({ a: [fake.toolCall('lookup', { query: 42 }), fake.text('ok')] });
    const { events } = await run(env);
    const failed = events.find((e): e is LogEvent<'tool_result'> => e.type === 'tool_result');
    expect(failed?.data.error).toMatch(/^INVALID_INPUT: argomenti non validi per lookup/);
    const seen = text(promptOf(env, 1));
    expect(seen).toContain('Argomenti di lookup: { q: string, max_results?: integer }');
  });
});

describe('context: offload and masking (C.2)', () => {
  const toolMessage = (id: string, value: string, toolName = 'web_fetch'): ModelMessage => ({
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId: id, toolName, output: { type: 'text', value } }],
  });
  const valueOf = (m: ModelMessage | undefined, part = 0) => {
    const c = m?.content as { output: { value: string } }[];
    return c[part]!.output.value;
  };
  const steps = (n: number, size = 1000) =>
    Array.from({ length: n }, (_, i) => toolMessage(`c${i}`, `${i} `.padEnd(size, 'x')));
  const noCtx = {} as never;

  it('a long result shows its head in its envelope; the rest is read again by reference', async () => {
    inLang('it');
    const ctx = new RunContext();
    const body = Array.from({ length: 2000 }, (_, i) => `riga ${i}`).join('\n');
    const wrapped = `${wrapExternalData('web_fetch https://example.com', body)}\n[Monsters] Avviso.`;
    const out = ctx.compact([toolMessage('1', wrapped)]);
    const shown = valueOf(out[0]);
    expect(shown.length).toBeLessThan(6400);
    expect(shown).toMatch(/^<dati_esterni fonte="web_fetch https:\/\/example.com">\nriga 0\n/);
    // The envelope is closed, the notices stay, the note of the system comes after the data.
    expect(shown).toMatch(
      /\n<\/dati_esterni>\n\[Monsters\] Avviso\.\n\[Monsters\] Risultato lungo/,
    );
    expect(shown).toContain('result_read {"ref":"r1","offset":6000}');
    // Idempotent: the same messages again give the same array.
    expect(ctx.compact(out)).toBe(out);
    const read = ctx.tool();
    const page = await read.execute({ ref: 'r1', offset: 6000, length: 7000 }, noCtx);
    expect(page).toMatch(/^<dati_esterni fonte="web_fetch https:\/\/example.com">\n/);
    expect(page).toContain(body.slice(6000, 6100));
    expect(page).toMatch(
      /<\/dati_esterni>\n\[Monsters\] r1 \(web_fetch\): caratteri 6000-13000 di \d+; il resto con offset 13000\.$/,
    );
    const end = await read.execute({ ref: 'r1', offset: body.length - 10, length: 6000 }, noCtx);
    expect(end).toContain('fino alla fine');
    await expect(read.execute({ ref: 'r9', offset: 0, length: 6000 }, noCtx)).rejects.toThrow(
      /no stored result/,
    );
    // A slice read again is short: never offloaded once more.
    expect(valueOf(ctx.compact([...out, toolMessage('2', page, RESULT_READ)])[1])).toBe(page);
  });

  it('a big window reads in bigger pieces; the note names the filters; reads of one result stop (D-163)', async () => {
    inLang('it');
    expect(contextLimitsFor(undefined)).toEqual({});
    expect(contextLimitsFor(100_000)).toEqual({});
    expect(contextLimitsFor(131_072)).toMatchObject({ offloadChars: 16_000, readChars: 12_000 });
    expect(contextLimitsFor(1_000_000)).toMatchObject({ offloadChars: 32_000, readChars: 24_000 });
    const list = defineTool({
      name: 'mcp__anteiku__anteiku_clienti_elenca',
      description: 'Elenca i clienti',
      inputSchema: z.object({
        testo: z.string().optional(),
        stato: z.enum(['attivo', 'tutti']).optional(),
        cliente_id: z.string().optional(),
        chiave_idempotenza: z.string().optional(),
      }),
      readOnly: true,
      execute: () => Promise.resolve('x'),
    });
    expect(filtersOf([list])(list.name)).toEqual(['testo', 'stato']);
    const ctx = new RunContext(
      { ...contextLimitsFor(1_000_000), readsPerResult: 2 },
      filtersOf([list]),
    );
    const body = 'cliente '.repeat(10_000);
    const shown = valueOf(ctx.compact([toolMessage('1', body, list.name)])[0]);
    expect(shown.length).toBeGreaterThan(24_000);
    expect(shown).toContain('result_read {"ref":"r1","offset":24000}');
    expect(shown).toContain(
      'Se te ne serve solo una parte, richiama mcp__anteiku__anteiku_clienti_elenca con i suoi filtri (testo, stato)',
    );
    const read = ctx.tool();
    const page = await read.execute({ ref: 'r1', offset: 24_000, length: 24_000 }, noCtx);
    expect(page).toContain('caratteri 24000-48000');
    await read.execute({ ref: 'r1', offset: 48_000, length: 24_000 }, noCtx);
    await expect(
      read.execute({ ref: 'r1', offset: 72_000, length: 24_000 }, noCtx),
    ).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
  });

  it('old steps become one line, in chunks: the prefix stays the same between moves', () => {
    inLang('it');
    const ctx = new RunContext({ recentToolResultChars: 1_000_000 });
    // 7 steps: 4 recent + 3, boundary at 0 (it moves 4 at a time).
    expect(ctx.compact(steps(7))).toEqual(steps(7));
    const eight = ctx.compact(steps(8));
    expect(valueOf(eight[0])).toBe(
      '[Monsters] Risultato di web_fetch tolto dal contesto per fare spazio (1000 caratteri). Se ti serve ancora: result_read {"ref":"r1"}.',
    );
    expect(valueOf(eight[3])).toMatch(/tolto dal contesto/);
    expect(valueOf(eight[4])).toBe(valueOf(steps(8)[4]));
    // Steps 9-11: the same masked prefix, nothing else changes.
    for (const n of [9, 10, 11]) {
      const out = ctx.compact(steps(n));
      expect(out.slice(0, 8).map((m) => valueOf(m))).toEqual(eight.map((m) => valueOf(m)));
    }
    const twelve = ctx.compact(steps(12));
    expect(valueOf(twelve[7])).toMatch(/tolto dal contesto/);
    expect(valueOf(twelve[8])).not.toMatch(/tolto dal contesto/);
  });

  it('a budget for the recent results: the oldest go until half is free, the last step stays', () => {
    inLang('it');
    const ctx = new RunContext({ recentToolResultChars: 10_000 });
    const page = (n: number) => `pagina ${n} `.repeat(500);
    const last: ModelMessage = {
      role: 'tool',
      content: [1, 2, 3].map((n) => ({
        type: 'tool-result' as const,
        toolCallId: `n${n}`,
        toolName: 'web_fetch',
        output: { type: 'text' as const, value: page(n) },
      })),
    };
    const out = ctx.compact([toolMessage('a', page(10)), toolMessage('b', page(11)), last]);
    // The last step: never masked, even over the budget.
    expect([0, 1, 2].map((p) => valueOf(out[2], p))).toEqual([1, 2, 3].map(page));
    expect(valueOf(out[0])).toMatch(/tolto dal contesto/);
    expect(valueOf(out[1])).toMatch(/tolto dal contesto/);
    // What is masked stays masked, also when the budget would allow it again.
    const later = ctx.compact([toolMessage('a', page(10)), toolMessage('b', page(11))]);
    expect(valueOf(later[0])).toMatch(/tolto dal contesto/);
    expect(ctx.maskedCount).toBe(2);
  });

  it('short results and errors: never a line longer than them, errors stay errors', () => {
    inLang('it');
    const ctx = new RunContext({ recentSteps: 1, maskChunk: 1 });
    const err: ModelMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'e',
          toolName: 'mcp__x__y',
          output: { type: 'error-text', value: 'errore '.repeat(200) },
        },
      ],
    };
    const out = ctx.compact([toolMessage('s', 'ok'), err, toolMessage('z', 'fine')]);
    expect(valueOf(out[0])).toBe('ok');
    expect((out[1]!.content as { output: { type: string } }[])[0]!.output.type).toBe('error-text');
    expect(valueOf(out[1])).toMatch(/tolto dal contesto/);
    // The helper without a run: one pass with the same rules.
    expect(compactToolResults([toolMessage('s', 'ok')])).toEqual([toolMessage('s', 'ok')]);
  });
});

describe('provider usage (AG-09, AG-20)', () => {
  it('logs the input tokens read from the prompt cache', async () => {
    const env = setup({
      a: [
        fake.text('ok', {
          usage: {
            inputTokens: { total: 1000, noCache: 100, cacheRead: 900, cacheWrite: undefined },
            outputTokens: { total: 7, text: 7, reasoning: undefined },
          },
        }),
      ],
    });
    const { events } = await run(env, { tools: [] as MonstersTool[] });
    const usage = events.find((e): e is LogEvent<'provider_usage'> => e.type === 'provider_usage');
    expect(usage?.data).toMatchObject({ inputTokens: 1000, cachedInputTokens: 900 });
  });
});

describe('the ChatGPT plan is a subscription for the caps (C-5)', () => {
  function chatgptEnv(models: Record<string, FakeScript>) {
    const services = createCoreServices({ home: tempHome() });
    opened.push(services);
    const provider = new FakeProvider({ id: 'chatgpt', models });
    return {
      ...services,
      provider,
      providers: new ProviderRegistry().register(provider),
      session: {},
    };
  }
  const onChatgpt = () =>
    agent({ models: [{ provider: 'chatgpt', model: 'a' }], limits: { maxSteps: 20 } });

  it('its requests count against the plan’s caps, not the pay-per-use ones', async () => {
    const env = chatgptEnv({
      a: [
        fake.toolCall('lookup', { q: 'rea' }),
        fake.toolCall('lookup', { q: 'teti' }),
        fake.text('Rapporto: Rea e Teti.'),
      ],
    });
    const budget = new RunBudget(RunLimitsSchema.parse({ plan: { maxRunSteps: 2 } }));
    const { result } = await run(env, { agent: onChatgpt(), budget });
    expect(budget.usage).toMatchObject({ steps: 0, tokens: 0, planSteps: 3 });
    expect(budget.usage.planTokens).toBeGreaterThan(0);
    expect(result).toMatchObject({
      status: 'run_limit',
      limit: { kind: 'steps', value: 2, plan: true },
    });
  });

  it('a delegated monster on the plan is held to the plan’s token cap', async () => {
    const big = {
      inputTokens: { total: 1500, noCache: 1500, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 7, text: 7, reasoning: undefined },
    };
    const env = chatgptEnv({
      a: [{ ...fake.toolCall('lookup', { q: 'rea' }), usage: big }, fake.text('Rapporto.')],
    });
    const limits = RunLimitsSchema.parse({
      maxSubagentTokens: 1_000_000,
      plan: { maxSubagentTokens: 1000 },
    });
    const { result } = await run(env, { agent: onChatgpt(), budget: new RunBudget(limits) });
    expect(result).toMatchObject({
      status: 'token_limit',
      limit: { kind: 'agent_tokens', value: 1000, plan: true },
    });
  });
});
