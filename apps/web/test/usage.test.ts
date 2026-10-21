import type { LogEvent, UsageContext } from '@monsters/shared';
import { runOwnersOf } from '@monsters/shared';
import { setAppLang } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  contextAmount,
  contextNow,
  formatCount,
  formatTokens,
  latestContext,
  partName,
  percentText,
  segmentsOf,
  thresholdAt,
  USAGE_REFRESH_MIN_MS,
  usageRefreshDelay,
  usageStamp,
} from '../src/components/usage/model.ts';

/* Consumi (D-075): the lineette of the context and the numbers on the instrument. */

describe('context bar', () => {
  const parts = [
    { part: 'instructions' as const, tokens: 2000 },
    { part: 'tools' as const, tokens: 6000 },
    { part: 'memory' as const, tokens: 100 },
    { part: 'current' as const, tokens: 200 },
  ];

  it('lights one segment per 1/count of the window, in the order of the prompt', () => {
    const s = segmentsOf(parts, 8300, 32_768, 20);
    expect(s.filter(Boolean)).toHaveLength(5);
    // Every part that exists is seen, in prompt order; the free space stays unlit.
    expect(s.slice(0, 5)).toEqual(['instructions', 'memory', 'tools', 'tools', 'current']);
    expect(s.slice(5).every((x) => x === null)).toBe(true);
  });

  it('few lit segments go to the biggest parts; nothing lit without a window', () => {
    const s = segmentsOf(parts, 8300, 200_000, 20);
    expect(s.filter(Boolean)).toEqual(['tools']);
    expect(segmentsOf(parts, 8300, null, 20).every((x) => x === null)).toBe(true);
    // Never more than the bar.
    expect(segmentsOf(parts, 90_000, 32_768, 20).filter(Boolean)).toHaveLength(20);
  });

  it('marks the compaction at 75% and says the numbers', () => {
    expect(thresholdAt(20)).toBe(15);
    expect(thresholdAt(40)).toBe(30);
    expect(percentText(100, 200_000)).toBe('<1%');
    expect(percentText(8300, 32_768)).toBe('25%');
    expect(percentText(8300, null)).toBeNull();
    expect(formatTokens(820)).toBe('820');
    expect(formatTokens(8400)).toBe('8.4K');
    expect(formatTokens(65_536)).toBe('66K');
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatCount(12_345)).toBe('12,345');
    setAppLang('it');
    expect(formatTokens(8400)).toBe('8,4K');
    expect(formatCount(12_345)).toBe('12.345');
    expect(partName('base', 'codex')).toBe('Base di Codex');
    setAppLang('en');
    expect(partName('base', 'codex')).toBe('Codex base');
    expect(contextAmount(null)).toBe('0%');
  });
});

describe('latest context from the stream', () => {
  let n = 0;
  const ev = (e: Partial<LogEvent> & Pick<LogEvent, 'type' | 'agent' | 'data'>): LogEvent => ({
    id: `01K${String(++n).padStart(23, '0')}`,
    ts: n,
    runId: null,
    parentId: null,
    ...e,
  });
  const usage = (agent: string, runId: string, total: number) =>
    ev({
      type: 'provider_usage',
      agent,
      runId,
      data: {
        provider: 'openrouter',
        model: 'x:free',
        inputTokens: total,
        context: { total, window: 65_536, parts: { tools: total }, source: 'measured' },
      },
    });

  it('takes the monster’s own steps in its own chat, until a new conversation', () => {
    const events = [
      ev({ type: 'run', agent: 'titan', runId: 'r1', data: { status: 'started' } }),
      usage('titan', 'r1', 4000),
      // Dione working for Titan: not Dione's chat.
      usage('dione', 'r1', 9000),
      ev({ type: 'run', agent: 'dione', runId: 'r2', data: { status: 'started' } }),
      usage('dione', 'r2', 3000),
    ];
    const owners = runOwnersOf(events);
    expect(latestContext(events, 'titan', owners)?.total).toBe(4000);
    expect(latestContext(events, 'dione', owners)).toMatchObject({
      total: 3000,
      window: 65_536,
      parts: [{ part: 'tools', tokens: 3000 }],
    });
    const after = [...events, ev({ type: 'new_conversation', agent: 'user', data: {} })];
    expect(latestContext(after, 'titan', runOwnersOf(after))).toBeNull();
    expect(usageStamp(after)).toBe(after.at(-1)!.id);
    expect(usageStamp([])).toBe('');
  });
});

describe('refresh of the open panel (D-079)', () => {
  it('waits for the debounce and never reads twice within 2 s', () => {
    expect(usageRefreshDelay(null, 1000)).toBe(250);
    expect(usageRefreshDelay(1000, 1100)).toBe(USAGE_REFRESH_MIN_MS - 100);
    expect(usageRefreshDelay(1000, 2900)).toBe(250);
    expect(usageRefreshDelay(1000, 9000)).toBe(250);
  });
});

describe('the context key after a change of model (D-086)', () => {
  const step: UsageContext = {
    total: 16_000,
    window: 32_000,
    threshold: 0.75,
    parts: [{ part: 'conversation', tokens: 16_000 }],
    source: 'measured',
    provider: 'openrouter',
    model: 'qwen/qwen-2.5-7b-instruct',
    ts: 1000,
    runId: 'r1',
  };
  const big = { provider: 'openrouter', model: 'qwen/qwen3.7-flash' };

  it('keeps the step while its model is in the chain (a fallback too)', () => {
    expect(contextNow(step, null, [{ provider: 'openrouter', model: step.model }])).toBe(step);
    expect(contextNow(step, null, [big, { provider: 'openrouter', model: step.model }])).toBe(step);
    expect(contextNow(step, null, null)).toBe(step);
    expect(contextAmount(step)).toBe('50%');
  });

  it('never the old share: a dash until the core gives the new window', () => {
    const pending = contextNow(step, null, [big])!;
    expect(pending).toMatchObject({ model: big.model, window: null });
    expect(pending.measuredWith).toEqual({ provider: 'openrouter', model: step.model });
    expect(contextAmount(pending)).toBe('–');
    // The core's read against the new window (same step).
    const fetched: UsageContext = {
      ...step,
      ...big,
      window: 1_000_000,
      measuredWith: { provider: 'openrouter', model: step.model },
    };
    expect(contextAmount(contextNow(step, fetched, [big]))).toBe('2%');
    // Before the first event of this session, the panel's data alone.
    expect(contextAmount(contextNow(null, fetched, [big]))).toBe('2%');
    expect(contextAmount(contextNow(null, step, [big]))).toBe('–');
  });
});
