import { ProviderRegistry, type ModelPrice } from '@monsters/providers';
import { defineTool, type LogEvent, type MonstersTool } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createCoreServices,
  DeferredTools,
  parseAgentConfig,
  runAgent,
  TOOL_SEARCH,
  TOOL_SEARCH_DEFAULT,
  ToolSetMemory,
  type AgentRunResult,
  type KeptTools,
  type CoreServices,
} from '../src/index.ts';
import {
  anthropicOn,
  firstDifference,
  layersOf,
  marksOf,
  openRouterOn,
  startsWith,
  wire,
  type Wire,
  type WireStep,
} from './cache-wire.ts';
import { anteikuToolDefs } from './fixtures/fake-anteiku-server.ts';
import { tempHome } from './helpers.ts';

/*
 * The prompt cache on the API-key path (D-168). The real OpenRouter and Anthropic providers talk
 * to a fake wire that records the exact bodies; the prompt caches read the tools first, then the
 * system prompt, then the messages, so a request is a hit when each of them starts with the
 * previous request's. These tests are that comparison, for the steps of a run (a deferred tool
 * loaded in the middle) and for the turns of a conversation.
 */

const opened: CoreServices[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.db.close();
});

const PROJECT = '00000000-0000-4000-8200-000000000001';

/** The Anteiku tools as the core makes them from the server (`mcp__anteiku__…`). */
function anteikuTools(): MonstersTool[] {
  return anteikuToolDefs().map((d) =>
    defineTool({
      name: `mcp__anteiku__${d.name}`,
      description: `[External tool, MCP server "anteiku"] ${d.description}`,
      inputSchema: z.record(z.string(), z.unknown()),
      inputJsonSchema: d.inputSchema,
      readOnly: d.readOnly,
      destructive: d.destructive,
      execute: () => Promise.resolve('ok'),
    }),
  );
}

type Format = 'openrouter' | 'anthropic';

interface Env {
  services: CoreServices;
  wire: Wire;
  providers: ProviderRegistry;
  memory: ToolSetMemory;
  turn: (
    task: string,
    options?: {
      history?: { role: 'user' | 'assistant'; content: string }[];
      price?: ModelPrice;
      remember?: boolean;
    },
  ) => Promise<AgentRunResult>;
  runId: () => string;
}

function setup(format: Format, model: string, steps: WireStep[]): Env {
  const services = createCoreServices({ home: tempHome() });
  opened.push(services);
  const w = wire(format, model, steps);
  const provider = format === 'openrouter' ? openRouterOn(w) : anthropicOn(w);
  const providers = new ProviderRegistry().register(provider);
  const memory = new ToolSetMemory();
  const agent = {
    config: parseAgentConfig({
      id: 'rhea',
      name: 'Rhea',
      role: 'ricerche',
      color: '#4f8df7',
      models: [{ provider: provider.id, model }],
      tools: [],
      limits: { maxSteps: 8 },
    }),
    instructions: '# Rhea',
  };
  let last = '';
  return {
    services,
    wire: w,
    providers,
    memory,
    runId: () => last,
    turn: async (task, options = {}) => {
      const run = services.runs.startRun({ agent: 'rhea' });
      last = run.id;
      return runAgent({
        agent,
        task,
        tools: [],
        extraTools: anteikuTools(),
        signal: run.signal,
        log: services.log,
        runId: run.id,
        providers,
        ...(options.remember === false ? {} : { toolMemory: memory }),
        ...(options.history ? { history: options.history } : {}),
        ...(options.price ? { price: () => options.price } : {}),
      });
    },
  };
}

const toolNames = (body: Record<string, unknown>): string[] =>
  ((body['tools'] as { name?: string; function?: { name: string } }[] | undefined) ?? []).map(
    (t) => t.function?.name ?? t.name ?? '',
  );

/** Turn 1: a search loads `ore_registra` in the middle; turn 2: two steps. */
const SCRIPT: WireStep[] = [
  { tool: { name: TOOL_SEARCH, input: { query: 'registra ore' } } },
  { tool: { name: 'mcp__anteiku__anteiku_ore_registra', input: { ore: 2, progetto_id: PROJECT } } },
  { text: 'Ore registrate.' },
  { tool: { name: 'mcp__anteiku__anteiku_ore_registra', input: { ore: 1, progetto_id: PROJECT } } },
  { text: 'Fatto anche questo.' },
];

const ROUTES: [Format, string][] = [
  ['openrouter', 'anthropic/claude-haiku-4.5'],
  ['anthropic', 'claude-haiku-4-5'],
];

/** The request must start with everything the earlier one had, mark aside. */
function expectPrefix(earlier: Record<string, unknown>, later: Record<string, unknown>): void {
  const a = layersOf(earlier);
  const b = layersOf(later);
  expect(startsWith(b.tools, a.tools), `tools differ at ${firstDifference(a.tools, b.tools)}`).toBe(
    true,
  );
  // The system prompt is the same to the byte, whatever tools were added after it was written.
  expect(b.system).toEqual(a.system);
  expect(
    startsWith(b.messages, a.messages),
    `messages differ at ${firstDifference(a.messages, b.messages)}`,
  ).toBe(true);
}

describe.each(ROUTES)('prompt cache, %s route (%s)', (format, model) => {
  it('the steps of a run: tools only appended, system and history byte-identical', async () => {
    const env = setup(format, model, SCRIPT);
    const result = await env.turn('Crea in Anteiku la task "Chiamare Rossi"');
    expect(result.status).toBe('completed');
    const [s0, s1, s2] = env.wire.bodies;
    expect(env.wire.bodies).toHaveLength(3);
    // The search loaded a tool between the first and the second request: appended, the earlier
    // ones keep their place and their bytes.
    const first = toolNames(s0!);
    const second = toolNames(s1!);
    expect(first.at(-1)).toBe(TOOL_SEARCH);
    expect(second.slice(0, first.length)).toEqual(first);
    const added = second.slice(first.length);
    expect(added).toContain('mcp__anteiku__anteiku_ore_registra');
    expect(added).toEqual([...added].sort());
    expect(toolNames(s2!)).toEqual(second);
    expectPrefix(s0!, s1!);
    expectPrefix(s1!, s2!);
    // The system prompt carries nothing of the turn: no time, no run id, no request.
    const system = layersOf(s0!).system.join('');
    expect(system).not.toContain(env.runId());
    expect(system).not.toContain('Chiamare Rossi');
  });

  it('the turns of a conversation: the next turn starts with the tools of the last one', async () => {
    const env = setup(format, model, SCRIPT);
    const t1 = await env.turn('Crea in Anteiku la task "Chiamare Rossi"');
    const t2 = await env.turn('Registra un’ora di lavoro sul progetto', {
      history: [
        { role: 'user', content: 'Crea in Anteiku la task "Chiamare Rossi"' },
        { role: 'assistant', content: t1.finalText },
      ],
    });
    expect(t2.status).toBe('completed');
    expect(env.wire.bodies).toHaveLength(5);
    const lastOfTurn1 = env.wire.bodies[2]!;
    const firstOfTurn2 = env.wire.bodies[3]!;
    // The words of turn 2 point at the hours: the tool turn 1 loaded is still there, in its
    // place, and the system prompt did not move.
    const before = toolNames(lastOfTurn1);
    const after = toolNames(firstOfTurn2);
    expect(after.slice(0, before.length)).toEqual(before);
    const a = layersOf(lastOfTurn1);
    const b = layersOf(firstOfTurn2);
    expect(b.system).toEqual(a.system);
    // And the first message of turn 1 is still the first of turn 2.
    expect(b.messages[0]).toBe(layersOf(env.wire.bodies[0]!).messages[0]);
    expectPrefix(env.wire.bodies[3]!, env.wire.bodies[4]!);
  });

  it('a turn whose words point at other tools appends them: the list only grows', async () => {
    const env = setup(format, model, [{ text: 'Uno.' }, { text: 'Due.' }]);
    await env.turn('Crea in Anteiku la task "Chiamare Rossi"');
    await env.turn('Elenca i clienti di Anteiku', {
      history: [
        { role: 'user', content: 'Crea in Anteiku la task "Chiamare Rossi"' },
        { role: 'assistant', content: 'Uno.' },
      ],
    });
    const one = toolNames(env.wire.bodies[0]!);
    const two = toolNames(env.wire.bodies[1]!);
    expect(two.slice(0, one.length)).toEqual(one);
    expect(two.length).toBeGreaterThan(one.length);
    expect(two).toContain('mcp__anteiku__anteiku_clienti_elenca');
    expect(layersOf(env.wire.bodies[1]!).system).toEqual(layersOf(env.wire.bodies[0]!).system);
  });

  it('tools_search says the same thing whatever the turn preloaded', async () => {
    const env = setup(format, model, [{ text: 'Uno.' }, { text: 'Due.' }]);
    await env.turn('Crea in Anteiku la task "Chiamare Rossi"', { remember: false });
    await env.turn('Elenca i clienti di Anteiku', { remember: false });
    const search = (i: number) =>
      JSON.stringify(
        ((env.wire.bodies[i]!['tools'] as Record<string, unknown>[]) ?? []).find(
          (t) =>
            (((t['function'] as { name?: string } | undefined)?.name ?? t['name']) as string) ===
            TOOL_SEARCH,
        ),
      );
    // Without the memory the preloads differ (the tools array does), the search tool does not.
    expect(toolNames(env.wire.bodies[0]!)).not.toEqual(toolNames(env.wire.bodies[1]!));
    expect(search(1)).toBe(search(0));
  });
});

describe('where the cache breakpoints are', () => {
  it('Anthropic with a key: the system prompt, the last message and the previous step', async () => {
    const env = setup('anthropic', 'claude-haiku-4-5', SCRIPT);
    await env.turn('Crea in Anteiku la task "Chiamare Rossi"');
    const [s0, s1, s2] = env.wire.bodies.map(marksOf);
    // The first request: the system prompt and the task.
    expect(s0).toEqual(['$.system[0]', '$.messages[0].content[0]']);
    // The next ones add the end of the previous step, never more than four in all.
    expect(s1).toEqual(['$.system[0]', '$.messages[0].content[0]', '$.messages[2].content[0]']);
    expect(s2).toEqual(['$.system[0]', '$.messages[2].content[0]', '$.messages[4].content[0]']);
    for (const m of [s0, s1, s2]) expect(m!.length).toBeLessThanOrEqual(4);
  });

  it('Claude on OpenRouter: the same marks, before the tools are the cached prefix', async () => {
    const env = setup('openrouter', 'anthropic/claude-haiku-4.5', SCRIPT);
    await env.turn('Crea in Anteiku la task "Chiamare Rossi"');
    for (const body of env.wire.bodies) {
      const marks = marksOf(body);
      expect(marks.length).toBeGreaterThanOrEqual(2);
      expect(marks.length).toBeLessThanOrEqual(4);
      // The system prompt is always marked, and so is the end of the conversation.
      expect(marks).toContain('$.messages[0].content[0]');
    }
    const last = marksOf(env.wire.bodies[2]!);
    expect(last.at(-1)).toBe('$.messages[5]');
  });

  it('another model on OpenRouter: no marker at all, the providers cache by prefix', async () => {
    const env = setup('openrouter', 'deepseek/deepseek-v3.2', SCRIPT);
    await env.turn('Crea in Anteiku la task "Chiamare Rossi"');
    expect(env.wire.bodies).toHaveLength(3);
    for (const [i, raw] of env.wire.raw.entries()) {
      expect(raw, `request ${i}`).not.toContain('cache_control');
    }
    // Their stable prefix is what counts: the same comparison holds.
    expectPrefix(env.wire.bodies[0]!, env.wire.bodies[1]!);
    expectPrefix(env.wire.bodies[1]!, env.wire.bodies[2]!);
  });
});

describe('what the cache costs and saves, as the log counts it', () => {
  const steps = (usage: WireStep['usage']): WireStep[] => [{ text: 'Fatto.', usage }];
  const usageOf = (env: Env): LogEvent<'provider_usage'>['data'][] =>
    env.services.log
      .query({ runId: env.runId(), type: 'provider_usage' })
      .map((e) => (e as LogEvent<'provider_usage'>).data);

  it('OpenRouter: cache reads and writes are logged, the cost it reports is the cost', async () => {
    const env = setup(
      'openrouter',
      'anthropic/claude-haiku-4.5',
      steps({ prompt: 5000, completion: 40, cacheRead: 4000, cacheWrite: 800, cost: 0.0123 }),
    );
    await env.turn('Ciao');
    expect(usageOf(env)).toMatchObject([
      {
        inputTokens: 5000,
        outputTokens: 40,
        cachedInputTokens: 4000,
        cacheWriteTokens: 800,
        costUsd: 0.0123,
      },
    ]);
  });

  it('Anthropic with a key: cache reads and writes are counted at the cache prices', async () => {
    const price: ModelPrice = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };
    const env = setup(
      'anthropic',
      'claude-haiku-4-5',
      steps({ prompt: 5000, completion: 40, cacheRead: 4000, cacheWrite: 800 }),
    );
    await env.turn('Ciao', { price });
    const [u] = usageOf(env);
    // The input is the whole prompt: what was neither read nor written, plus both.
    expect(u).toMatchObject({
      inputTokens: 5000,
      outputTokens: 40,
      cachedInputTokens: 4000,
      cacheWriteTokens: 800,
      estimated: true,
    });
    // (200 plain × 1 + 4000 read × 0.1 + 800 written × 1.25 + 40 out × 5) per million.
    expect(u!.costUsd).toBeCloseTo((200 + 400 + 1000 + 200) / 1_000_000, 10);
  });

  it('a request read from the cache does not count against the token limit', async () => {
    const env = setup(
      'anthropic',
      'claude-haiku-4-5',
      steps({ prompt: 9000, completion: 10, cacheRead: 8000 }),
    );
    const added: number[] = [];
    const budget = {
      limits: {},
      addStep: (fresh: number) => void added.push(fresh),
      exhausted: () => null,
      exhaustedBy: () => null,
      stepsLeft: () => 100,
    };
    const run = env.services.runs.startRun({ agent: 'rhea' });
    const agent = {
      config: parseAgentConfig({
        id: 'rhea',
        name: 'Rhea',
        role: 'ricerche',
        color: '#4f8df7',
        models: [{ provider: 'anthropic', model: 'claude-haiku-4-5' }],
        tools: [],
        limits: { maxSteps: 4 },
      }),
      instructions: '# Rhea',
    };
    await runAgent({
      agent,
      task: 'Ciao',
      tools: [],
      signal: run.signal,
      log: env.services.log,
      runId: run.id,
      providers: env.providers,
      budget: budget as never,
    });
    // 1000 not read from the cache plus 10 written: not the 9010 of the whole prompt.
    expect(added).toEqual([1010]);
  });
});

describe('ToolSetMemory and the tools a run starts with', () => {
  const own = (name: string): MonstersTool =>
    defineTool({
      name,
      description: `The tool ${name}.`,
      inputSchema: z.object({}),
      readOnly: true,
      execute: () => Promise.resolve('ok'),
    });
  const config = { ...TOOL_SEARCH_DEFAULT, threshold: 2, preload: 2, maxLoaded: 6 };
  const words = ['alfa', 'bravo', 'carlo', 'delta', 'eco', 'foxtrot', 'golf', 'hotel'];
  const all = words.map((n) => own(`mcp__srv__${n}_item`));
  const names = (list: string[]) => list.map((n) => `mcp__srv__${n}_item`);
  const plan = (kept?: KeptTools, query = '') =>
    DeferredTools.plan(all, config, () => [], new Map(), query, kept)!;

  it('remembers for the life of the cache, then forgets', () => {
    let now = 0;
    const memory = new ToolSetMemory({ ttlMs: 1000, now: () => now });
    memory.set('rhea', { preload: ['a'], loaded: ['b'] });
    expect(memory.get('rhea')).toEqual({ preload: ['a'], loaded: ['b'] });
    expect(memory.get('anna')).toBeUndefined();
    now = 1001;
    expect(memory.get('rhea')).toBeUndefined();
  });

  it('never holds more agents than it is told to', () => {
    const memory = new ToolSetMemory({ max: 2 });
    for (const id of ['a', 'b', 'c']) memory.set(id, { preload: [id], loaded: [] });
    expect(memory.get('a')).toBeUndefined();
    expect(memory.get('c')).toBeDefined();
  });

  it('the next run starts with the last one’s list, then adds what its words point at', () => {
    const first = plan(undefined, 'alfa');
    first.load(names(['eco']));
    const kept = first.kept();
    const sent = first.activeNames();
    // The same words again: exactly the same list, in the same order.
    expect(plan(kept, 'alfa').activeNames()).toEqual(sent);
    // Other words: what the last run sent first, the new tools after, none moved or dropped.
    const next = plan(kept, 'golf').activeNames();
    expect(next.slice(0, sent.length)).toEqual(sent);
    expect(next.length).toBeGreaterThan(sent.length);
    expect(next.at(-1)).toContain('golf');
    expect(new Set(next).size).toBe(next.length);
  });

  it('a tool of the memory that the run no longer has is skipped, the rest keeps its order', () => {
    const kept = { preload: names(['alfa', 'bravo']), loaded: names(['xray', 'eco']) };
    const next = plan(kept).activeNames();
    expect(next).toEqual([...names(['alfa', 'bravo']), TOOL_SEARCH, ...names(['eco'])]);
  });

  it('a list that grew past twice the preload starts over from the turn’s words', () => {
    const kept = {
      preload: names(['alfa', 'bravo']),
      loaded: names(['carlo', 'delta', 'eco', 'foxtrot']),
    };
    const next = plan(kept, 'golf');
    expect(next.activeNames()).not.toContain(names(['eco'])[0]);
    expect(next.activeNames().filter((n) => n !== TOOL_SEARCH).length).toBeLessThanOrEqual(2);
  });

  it('what a run carried over does not eat the loads a search may still make', () => {
    const kept = { preload: names(['alfa', 'bravo']), loaded: names(['carlo', 'delta']) };
    const d = plan(kept);
    d.load(names(['eco', 'foxtrot', 'golf', 'hotel']));
    expect(d.loaded).toEqual(names(['carlo', 'delta', 'eco', 'foxtrot', 'golf', 'hotel']));
  });
});
