import { setAppLang, ulid, type EventInput, type LogEvent } from '@monsters/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildChat,
  conversationLine,
  formatDuration,
  instrumentationLine,
  modelShort,
  runStatsIndex,
  searchEngineOf,
  sumRuns,
  toolShort,
} from '../src/store/derive.ts';

// The Italian copy is pinned in this file; the English one is in log-strings.test.ts.
beforeAll(() => setAppLang('it'));
afterAll(() => setAppLang('en'));

/* The instrumentation of the chat (docs/design.md, "Strumentazione"): one line per turn. */

let clock = 1_760_000_000_000;
function ev<T extends EventInput>(input: T, after = 1000): LogEvent {
  clock += after;
  return {
    id: ulid(clock),
    ts: clock,
    agent: input.agent,
    runId: input.runId ?? null,
    parentId: input.parentId ?? null,
    type: input.type,
    data: input.data,
  } as LogEvent;
}

const call = (agent: string, runId: string, tool: string, callId = tool) =>
  ev({ agent, runId, type: 'tool_call', data: { callId, tool, input: {} } }, 100);
const usage = (
  agent: string,
  runId: string,
  model: string,
  extra: { costUsd?: number; requestedModel?: string } = {},
) =>
  ev(
    { agent, runId, type: 'provider_usage', data: { provider: 'openrouter', model, ...extra } },
    100,
  );

describe('instrumentation line', () => {
  it('counts the tools of the whole run, with time, "gratis" and the model', () => {
    const t0 = ev({ agent: 'titan', runId: 'r1', type: 'run', data: { status: 'started' } });
    const events = [
      t0,
      call('titan', 'r1', 'delegate', 'a'),
      call('rhea', 'r1', 'web_search', 'b'),
      call('rhea', 'r1', 'web_search', 'c'),
      call('titan', 'r1', 'delegate', 'd'),
      call('rhea', 'r1', 'web_search', 'e'),
      usage('rhea', 'r1', 'google/gemma-3-27b-it:free'),
      usage('titan', 'r1', 'meta-llama/llama-3.3-70b-instruct:free'),
    ];
    const end = ev({ agent: 'titan', runId: 'r1', type: 'run', data: { status: 'completed' } }, 0);
    end.ts = t0.ts + 4100;
    events.push(end);
    const stats = runStatsIndex(events).get('r1');
    expect(instrumentationLine(stats, 'Titan', 'titan')).toBe(
      'Titan › Delega ×2 · Ricerca web ×3 · 4,1 s · gratis · llama 3.3 70b',
    );
    // Another monster of the run: its own model.
    expect(instrumentationLine(stats, 'Rhea', 'rhea')).toMatch(/· gemma 3 27b it$/);
  });

  it('leaves out what it does not know, and says nothing for an empty run', () => {
    const events = [
      ev({ agent: 'dione', runId: 'r2', type: 'run', data: { status: 'started' } }),
      call('dione', 'r2', 'vault_write'),
    ];
    // Still running: no time; no model request: no cost, no model.
    expect(instrumentationLine(runStatsIndex(events).get('r2'), 'Dione')).toBe(
      'Dione › Nota scritta',
    );
    expect(instrumentationLine(undefined, 'Dione')).toBeNull();
    const quiet = [ev({ agent: 'dione', runId: 'r3', type: 'run', data: { status: 'started' } })];
    expect(instrumentationLine(runStatsIndex(quiet).get('r3'), 'Dione')).toBeNull();
  });

  it('says the cost in dollars, Italian style, when a model is paid', () => {
    const events = [
      usage('titan', 'r4', 'anthropic/claude-sonnet-4-5', { costUsd: 0.0123 }),
      usage('titan', 'r4', 'anthropic/claude-sonnet-4-5', { costUsd: 0.03 }),
    ];
    expect(instrumentationLine(runStatsIndex(events).get('r4'), 'Titan')).toBe(
      'Titan › 0,042 $ · claude sonnet 4.5',
    );
    // A reported zero is free too; the free router counts as free.
    const zero = [usage('titan', 'r5', 'openai/gpt-4o-mini', { costUsd: 0 })];
    expect(instrumentationLine(runStatsIndex(zero).get('r5'), 'Titan')).toBe(
      'Titan › gratis · gpt 4o mini',
    );
    const router = [usage('titan', 'r6', 'qwen/qwen3-32b', { requestedModel: 'openrouter/free' })];
    expect(instrumentationLine(runStatsIndex(router).get('r6'), 'Titan')).toBe(
      'Titan › gratis · qwen3 32b',
    );
    // A paid model without a reported cost: no cost at all, never "gratis".
    const unknown = [usage('titan', 'r7', 'openai/gpt-4o')];
    expect(instrumentationLine(runStatsIndex(unknown).get('r7'), 'Titan')).toBe('Titan › gpt 4o');
  });

  it('a paid web search adds its cost, is not the model, and the engine shows (D-071)', () => {
    const result = (runId: string, output: unknown) =>
      ev(
        {
          agent: 'rhea',
          runId,
          type: 'tool_result',
          data: { callId: 'b', tool: 'web_search', ok: true, output },
        },
        100,
      );
    const events = [
      call('rhea', 's1', 'web_search', 'b'),
      ev(
        {
          agent: 'rhea',
          runId: 's1',
          type: 'provider_usage',
          data: { provider: 'web_search', model: 'openrouter/parallel-fast', costUsd: 0.0011 },
        },
        100,
      ),
      result('s1', { query: 'ribollita', backend: 'openrouter-parallel', results: [] }),
      usage('rhea', 's1', 'google/gemma-3-27b-it:free'),
    ];
    expect(instrumentationLine(runStatsIndex(events).get('s1'), 'Rhea', 'rhea')).toBe(
      'Rhea › Ricerca web (OpenRouter) · 0,0011 $ · gemma 3 27b it',
    );
    // A long output is logged as a preview: the engine is still read from it.
    const blocked = [
      call('rhea', 's2', 'web_search', 'b'),
      result('s2', {
        truncated: true,
        preview: '{"query":"x","backend":"wikipedia","results":[',
        chars: 9000,
      }),
    ];
    expect(instrumentationLine(runStatsIndex(blocked).get('s2'), 'Rhea')).toBe(
      'Rhea › Ricerca web (Wikipedia)',
    );
    expect(searchEngineOf({ backend: 'openrouter-parallel, duckduckgo' })).toBe('DuckDuckGo');
  });

  it('names tools and models briefly', () => {
    expect(toolShort('web_fetch')).toBe('Pagina web');
    expect(toolShort('mcp__browser__navigate')).toBe('Browser');
    expect(toolShort('mcp__github__create_issue')).toBe('Github');
    expect(modelShort('openrouter/free')).toBeNull();
    expect(modelShort('meta-llama/llama-3.3-70b-instruct:free')).toBe('llama 3.3 70b');
    expect(formatDuration(800)).toBe('0,8 s');
    expect(formatDuration(41_200)).toBe('41 s');
    expect(formatDuration(125_000)).toBe('2 min 05 s');
    expect(formatDuration(4_320_000)).toBe('1 h 12 min');
  });

  it('sums a conversation for the monitor', () => {
    const events = [
      ev({ agent: 'titan', runId: 'c1', type: 'run', data: { status: 'started' } }),
      call('titan', 'c1', 'delegate'),
      call('rhea', 'c1', 'web_search'),
      usage('titan', 'c1', 'x/y:free'),
      ev({ agent: 'titan', runId: 'c1', type: 'run', data: { status: 'completed' } }, 2300),
      ev({ agent: 'titan', runId: 'c2', type: 'run', data: { status: 'started' } }),
      call('titan', 'c2', 'vault_read'),
      usage('titan', 'c2', 'x/z:free'),
      ev({ agent: 'titan', runId: 'c2', type: 'run', data: { status: 'completed' } }, 1300),
    ];
    const idx = runStatsIndex(events);
    const sum = sumRuns([idx.get('c1')!, idx.get('c2')!]);
    expect(conversationLine(sum)).toBe('3 strumenti · 4,1 s · gratis');
    expect(conversationLine(sumRuns([]))).toBeNull();
  });

  it('keeps the run of a turn on its bubbles', () => {
    const items = buildChat(
      [ev({ agent: 'titan', runId: 'r9', type: 'message', data: { role: 'agent', text: 'Ciao' } })],
      [],
    );
    expect(items[0]).toMatchObject({ kind: 'agent', runId: 'r9' });
  });
});
