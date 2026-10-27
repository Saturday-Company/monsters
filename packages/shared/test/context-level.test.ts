import { describe, expect, it } from 'vitest';
import {
  CONTEXT_COMPACT_AT,
  CONTEXT_LONG_AT,
  contextLevel,
  type UsageContext,
} from '../src/index.ts';

/*
 * "Context in words" (the chat plan of 27/10): the meter only with the technical details, for
 * everyone a sentence when the conversation gets long. One rule, here, for the core's view and
 * the mock's.
 */

const context = (total: number, window: number | null): UsageContext => ({
  total,
  window,
  threshold: CONTEXT_COMPACT_AT,
  parts: [],
  source: 'measured',
  provider: 'fake',
  model: 'm',
  ts: 0,
  runId: null,
});

describe('contextLevel', () => {
  it('ok, long past CONTEXT_LONG_AT, full past the compaction mark', () => {
    expect(contextLevel({ context: null })).toBe('ok');
    expect(contextLevel({ context: context(1000, 10_000) })).toBe('ok');
    expect(contextLevel({ context: context(CONTEXT_LONG_AT * 10_000, 10_000) })).toBe('long');
    expect(contextLevel({ context: context(CONTEXT_COMPACT_AT * 10_000, 10_000) })).toBe('full');
  });

  it('a summary of the older turns is full; without a window only the summary counts', () => {
    const summary = { turns: 12, ts: 0, reason: 'context' as const, chars: 900 };
    expect(contextLevel({ context: context(100, 10_000), summary })).toBe('full');
    expect(contextLevel({ context: context(9_999_999, null) })).toBe('ok');
    expect(contextLevel({ context: context(9_999_999, null), summary })).toBe('full');
  });
});
