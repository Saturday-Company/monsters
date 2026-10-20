import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  knownContextWindow,
  ProviderRegistry,
  RateBudget,
  type HarnessEvent,
  type HarnessProvider,
} from '@monsters/providers';
import { fake } from '@monsters/providers/testing';
import {
  CONTEXT_COMPACT_AT,
  conversationUsage,
  type AgentUsageView,
  type ContextParts,
  type LogEvent,
} from '@monsters/shared';
import { tool, jsonSchema, type ModelMessage } from 'ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createContextMeter,
  estimateTokens,
  HarnessContextMeter,
  messageParts,
  scaleParts,
  stepContext,
} from '../src/agents/context-usage.ts';
import { parseAgentConfig } from '../src/agents/definition.ts';
import { HarnessToolSessions } from '../src/agents/harness-tools.ts';
import { runHarnessAgent } from '../src/agents/run-harness.ts';
import { EventLog, coreMigrations, migrate, openDb } from '../src/index.ts';
import { ControlScope } from '../src/kill/control-scope.ts';
import { ModelWindows } from '../src/providers/windows.ts';
import { startTestHub } from './hub-helpers.ts';

/*
 * C.1 of the plan of 16/10 (D-075): the context of every step, part by part,
 * scaled to the real input; the model windows; the Consumi endpoint.
 */

const sum = (p: ContextParts) => Object.values(p).reduce((n, v) => n + (v ?? 0), 0);

describe('context estimate and calibration', () => {
  it('scales the parts to the real total, exactly, keeping the proportions', () => {
    const estimate = { instructions: 1000, memory: 200, tools: 3000, conversation: 0, current: 50 };
    const scaled = scaleParts(estimate, 8513);
    expect(sum(scaled)).toBe(8513);
    expect(scaled.conversation).toBeUndefined();
    expect(scaled.tools! / scaled.instructions!).toBeCloseTo(3, 1);
    // An estimate of nothing puts everything in the conversation; no total, no parts.
    expect(scaleParts({}, 40)).toEqual({ conversation: 40 });
    expect(scaleParts(estimate, 0)).toEqual({});
  });

  it('splits the messages: earlier turns and own steps, tool results, the current message', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Una domanda di ieri '.repeat(20) },
      { role: 'assistant', content: 'La risposta di ieri '.repeat(20) },
      { role: 'user', content: 'Cerca le ricette' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'c1', toolName: 'vault_search', input: { q: 'x' } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'vault_search',
            output: { type: 'text', value: 'risultato '.repeat(300) },
          },
        ],
      },
    ];
    const parts = messageParts(messages, 2);
    expect(parts.tool_results!).toBeGreaterThan(parts.conversation!);
    expect(parts.conversation!).toBeGreaterThan(parts.current!);
    expect(parts.current!).toBeGreaterThan(0);
  });

  it('measures instructions, memory and tools once; no tools on the last step', () => {
    const tools = {
      vault_search: tool({
        description: 'Cerca nelle note',
        inputSchema: jsonSchema({ type: 'object', properties: { query: { type: 'string' } } }),
      }),
    };
    const memory = 'Giulio preferisce le risposte brevi. '.repeat(10);
    const system = `Sei Titan.\n\n## Regole del sistema\n- una\n\n## La tua memoria\n${memory}`;
    const meter = createContextMeter({ system, memory, tools, historyLength: 0 });
    const withTools = meter.measure([{ role: 'user', content: 'ciao' }], true);
    expect(withTools.memory).toBe(estimateTokens(memory.trim()) + 8);
    expect(withTools.tools).toBeGreaterThan(0);
    expect(withTools.instructions).toBeGreaterThan(0);
    expect(meter.measure([{ role: 'user', content: 'ciao' }], false).tools).toBe(0);
  });

  it('a step reports measured parts when the provider counts the input, else the estimate', () => {
    const estimate = { instructions: 300, tools: 500, current: 20 };
    const measured = stepContext(estimate, 1640, 32_768)!;
    expect(measured).toMatchObject({ total: 1640, window: 32_768, source: 'measured' });
    expect(sum(measured.parts)).toBe(1640);
    const guessed = stepContext(estimate, undefined, undefined)!;
    expect(guessed).toEqual({ total: 820, parts: estimate, source: 'estimated' });
    expect(stepContext(null, 100, undefined)).toBeUndefined();
  });

  it('on a harness the base is what the first request holds beyond ours, then the work grows', () => {
    const meter = new HarnessContextMeter({ instructions: 1000, tools: 1500, current: 100 });
    const first = meter.measure(24_600, 200_000)!;
    expect(first.parts).toEqual({ base: 22_000, instructions: 1000, tools: 1500, current: 100 });
    const second = meter.measure(30_600, 200_000)!;
    expect(second.parts).toMatchObject({ base: 22_000, tool_results: 6000 });
    expect(sum(second.parts)).toBe(30_600);
    // Below what we think we sent (the harness compacted): ours scaled, no base.
    const small = meter.measure(1300, undefined)!;
    expect(sum(small.parts)).toBe(1300);
    expect(small.parts.base).toBeUndefined();
  });

  it('a resumed session: the earlier turns are conversation, not base (D-079)', () => {
    const meter = new HarnessContextMeter(
      { instructions: 1000, tools: 1500, current: 100 },
      { resumed: { base: 22_000 } },
    );
    const first = meter.measure(64_600, 200_000)!;
    expect(first.parts).toEqual({
      base: 22_000,
      instructions: 1000,
      tools: 1500,
      conversation: 40_000,
      current: 100,
    });
    const second = meter.measure(70_600, 200_000)!;
    expect(second.parts).toMatchObject({ base: 22_000, conversation: 40_000, tool_results: 6000 });
    expect(sum(second.parts)).toBe(70_600);
    // A base known larger than the excess: all of it is base, no conversation.
    const small = new HarnessContextMeter({ current: 100 }, { resumed: { base: 22_000 } });
    expect(small.measure(10_100, undefined)!.parts).toEqual({ base: 10_000, current: 100 });
  });
});

describe('model windows', () => {
  it('knows the windows the lists do not say', () => {
    expect(knownContextWindow('claude-agent', 'claude-sonnet-5-5')).toBe(1_000_000);
    expect(knownContextWindow('claude-agent', 'claude-sonnet-4-5-20250929')).toBe(200_000);
    expect(knownContextWindow('claude-agent', 'claude-sonnet-4-5[1m]')).toBe(1_000_000);
    expect(knownContextWindow('anthropic', 'claude-haiku-4-5')).toBe(200_000);
    expect(knownContextWindow('anthropic', 'claude-opus-4-6')).toBe(1_000_000);
    expect(knownContextWindow('anthropic', 'claude-3-5-sonnet-20241022')).toBe(200_000);
    expect(knownContextWindow('openai', 'gpt-4o-mini')).toBe(128_000);
    expect(knownContextWindow('openai', 'gpt-4.1')).toBe(1_047_576);
    expect(knownContextWindow('codex', 'gpt-5-codex')).toBe(400_000);
    expect(knownContextWindow('openrouter', 'anthropic/claude-sonnet-4.5')).toBe(200_000);
    expect(knownContextWindow('openrouter', 'meta-llama/llama-3.3-70b-instruct:free')).toBe(
      undefined,
    );
  });

  it("reads the provider's list in the background, the documented values meanwhile", async () => {
    const registry = new ProviderRegistry();
    let calls = 0;
    registry.register({
      id: 'openrouter',
      kind: 'model',
      auth: 'api-key',
      budget: new RateBudget({ id: 'openrouter', windows: [], limitScope: 'account' }),
      listModels: () => {
        calls++;
        return Promise.resolve([
          {
            id: 'meta-llama/llama-3.3-70b-instruct:free',
            tools: true,
            free: true,
            context: 65_536,
          },
        ]);
      },
      model: () => {
        throw new Error('no model in this test');
      },
    });
    const windows = new ModelWindows(registry);
    expect(windows.get('openrouter', 'meta-llama/llama-3.3-70b-instruct:free')).toBeUndefined();
    expect(await windows.resolve('openrouter', 'meta-llama/llama-3.3-70b-instruct:free')).toBe(
      65_536,
    );
    expect(windows.get('openrouter', 'meta-llama/llama-3.3-70b-instruct:free')).toBe(65_536);
    expect(windows.get('openrouter', 'anthropic/claude-opus-4-6')).toBe(1_000_000);
    expect(calls).toBe(1);
    expect(windows.get('unknown', 'x')).toBeUndefined();
  });
});

describe('harness steps', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'monsters-context-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('records the cache split and the context of each Claude Code request', async () => {
    const db = openDb(':memory:');
    migrate(db, 'core', coreMigrations);
    const log = new EventLog(db);
    const events: HarnessEvent[] = [
      {
        type: 'usage',
        model: 'claude-sonnet-5-5',
        inTok: 23_000,
        outTok: 40,
        cacheWriteTok: 22_500,
      },
      {
        type: 'usage',
        model: 'claude-sonnet-5-5',
        inTok: 26_000,
        outTok: 90,
        cacheReadTok: 22_500,
        cacheWriteTok: 3000,
      },
      { type: 'usage', model: 'claude-sonnet-5-5', inTok: 50, outTok: 5, aggregate: true },
      { type: 'done', reason: 'stop', text: 'Fatto' },
    ];
    const harness: HarnessProvider = {
      id: 'claude-agent',
      kind: 'harness',
      auth: 'external-login',
      budget: new RateBudget({ id: 'claude-agent', windows: [], limitScope: 'account' }),
      listModels: () => Promise.resolve([]),
      async *run() {
        for (const e of events) {
          await Promise.resolve();
          yield e;
        }
      },
    };
    const scope = new ControlScope('run', 'r1', null, 100);
    await runHarnessAgent({
      agent: {
        config: parseAgentConfig({
          id: 'nova',
          name: 'Nova',
          role: 'Capo squadra',
          color: '#336699',
          models: [{ provider: 'claude-agent', model: 'sonnet' }],
        }),
        instructions: 'Sei Nova. '.repeat(100),
      },
      harness,
      task: 'puoi creare un mostro?',
      tools: [],
      signal: scope.signal,
      scope,
      log,
      runId: 'r1',
      sessions: new HarnessToolSessions(log),
      mcpUrl: () => 'http://127.0.0.1:1/api/harness/mcp',
      workspace: join(dir, 'ws'),
      scratchRoot: join(dir, 'scratch'),
      systemTools: false,
      memory: 'Giulio lavora a Saturday.',
      contextWindow: (ref) => knownContextWindow(ref.provider, ref.model),
    });
    const usage = log
      .query({ type: 'provider_usage' })
      .map((e) => (e as LogEvent<'provider_usage'>).data);
    expect(usage[0]).toMatchObject({ inputTokens: 23_000, cacheWriteTokens: 22_500 });
    expect(usage[0]!.cachedInputTokens).toBeUndefined();
    expect(usage[1]).toMatchObject({ cachedInputTokens: 22_500, cacheWriteTokens: 3000 });
    const [a, b] = [usage[0]!.context!, usage[1]!.context!];
    expect(a).toMatchObject({ total: 23_000, window: 1_000_000, source: 'measured' });
    expect(a.parts.base!).toBeGreaterThan(20_000);
    expect(sum(a.parts)).toBe(23_000);
    expect(b.parts.base).toBe(a.parts.base);
    expect(b.parts.tool_results).toBe(3000);
    // The rest of a turn's total is no request: no context.
    expect(usage[2]!.context).toBeUndefined();
  });
});

describe('conversation usage (pure)', () => {
  let n = 0;
  const ev = <T extends LogEvent['type']>(
    type: T,
    agent: string,
    runId: string,
    data: Extract<LogEvent, { type: T }>['data'],
    ts: number,
  ): LogEvent =>
    ({
      id: `01K${String(++n).padStart(23, '0')}`,
      ts,
      agent,
      runId,
      parentId: null,
      type,
      data,
    }) as LogEvent;

  it('sums the runs of the monster, by model, with searches, instinct and the latest context', () => {
    const events: LogEvent[] = [
      ev('run', 'titan', 'r1', { status: 'started' }, 1000),
      ev(
        'provider_usage',
        'titan',
        'r1',
        {
          provider: 'anthropic',
          model: 'claude-sonnet-5-5',
          inputTokens: 5000,
          outputTokens: 200,
          cachedInputTokens: 4000,
          costUsd: 0.01,
          context: { total: 5000, parts: { instructions: 1000, tools: 4000 }, source: 'measured' },
        },
        1500,
      ),
      ev('tool_call', 'rhea', 'r1', { callId: 'c', tool: 'web_search', input: {} }, 1600),
      ev(
        'provider_usage',
        'rhea',
        'r1',
        { provider: 'openrouter', model: 'x:free', inputTokens: 900, outputTokens: 50 },
        1700,
      ),
      ev(
        'provider_usage',
        'rhea',
        'r1',
        { provider: 'web_search', model: 'parallel', costUsd: 0.005 },
        1750,
      ),
      ev(
        'decision',
        'titan',
        'r1',
        {
          kind: 'route',
          question: 'q',
          options: [],
          choice: 'a',
          decidedBy: 'model',
          use: 'route_hint',
        },
        1800,
      ),
      ev(
        'provider_usage',
        'titan',
        'r1',
        { provider: 'typesafe', model: 'jev', inputTokens: 400, outputTokens: 4, costUsd: 0.00002 },
        1810,
      ),
      ev('run', 'titan', 'r1', { status: 'completed' }, 4000),
      // Another monster's chat: not here.
      ev('run', 'dione', 'r2', { status: 'started' }, 5000),
      ev(
        'provider_usage',
        'dione',
        'r2',
        { provider: 'anthropic', model: 'claude-sonnet-5-5', inputTokens: 99_999, costUsd: 1 },
        5100,
      ),
    ];
    const u = conversationUsage({ agentId: 'titan', events, usdToEur: 0.86 });
    expect(u.session).toMatchObject({
      runs: 1,
      calls: 2,
      inputTokens: 5900,
      outputTokens: 250,
      cacheReadTokens: 4000,
      durationMs: 3000,
      free: false,
      searches: { count: 1, paid: 1, costUsd: 0.005 },
      instinct: { questions: 1, calls: 1, costUsd: 0.00002 },
    });
    expect(u.session.costUsd).toBeCloseTo(0.01502, 8);
    expect(u.session.costEur).toBeCloseTo(0.01502 * 0.86, 8);
    expect(u.session.models.map((m) => [m.model, m.calls, m.free])).toEqual([
      ['claude-sonnet-5-5', 1, false],
      ['x:free', 1, true],
    ]);
    expect(u.context).toMatchObject({
      total: 5000,
      window: null,
      threshold: CONTEXT_COMPACT_AT,
      parts: [
        { part: 'instructions', tokens: 1000 },
        { part: 'tools', tokens: 4000 },
      ],
    });
  });
});

describe('GET /api/agents/:id/usage', () => {
  it('summarises the current conversation and starts over with it', async () => {
    const usage = {
      inputTokens: { total: 3000, noCache: 1000, cacheRead: 1500, cacheWrite: 500 },
      outputTokens: { total: 80, text: 80, reasoning: undefined },
    };
    const t = await startTestHub({
      titan: [fake.text('Ciao!', { usage }), fake.text('Di nuovo ciao', { usage })],
    });
    const first = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'ciao' });
    await t.runEnded(first.runId);
    const step = t
      .events(first.runId)
      .find((e): e is LogEvent<'provider_usage'> => e.type === 'provider_usage')!;
    expect(step.data.context).toMatchObject({ total: 3000, source: 'measured' });
    expect(sum(step.data.context!.parts)).toBe(3000);
    expect(step.data.context!.parts.instructions).toBeGreaterThan(0);

    const view = await t.json<AgentUsageView>('GET', '/api/agents/titan/usage');
    expect(view).toMatchObject({
      agentId: 'titan',
      since: null,
      subscription: false,
      session: {
        runs: 1,
        calls: 1,
        inputTokens: 3000,
        outputTokens: 80,
        cacheReadTokens: 1500,
        cacheWriteTokens: 500,
      },
      spend: { day: { spentEur: 0 } },
    });
    expect(view.context?.total).toBe(3000);
    expect(view.context?.parts.reduce((n, p) => n + p.tokens, 0)).toBe(3000);

    await t.json('POST', '/api/conversations', { to: 'titan' });
    const fresh = await t.json<AgentUsageView>('GET', '/api/agents/titan/usage');
    expect(fresh.since).not.toBeNull();
    expect(fresh.context).toBeNull();
    expect(fresh.session.calls).toBe(0);

    expect((await t.api('GET', '/api/agents/nessuno/usage')).status).toBe(404);
    const port = new URL(t.core.url).port;
    expect((await fetch(`http://127.0.0.1:${port}/api/agents/titan/usage`)).status).toBe(401);
  });
});
