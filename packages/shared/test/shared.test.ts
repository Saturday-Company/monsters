import { describe, expect, it } from 'vitest';
import {
  AgentIdSchema,
  EventInputSchema,
  LogEventSchema,
  monotonicUlidFactory,
  ulid,
  ULID_REGEX,
  ulidTime,
} from '../src/index.ts';

describe('ulid', () => {
  it('generates valid, sortable ids', () => {
    const ids = Array.from({ length: 1000 }, () => ulid());
    for (const id of ids) expect(id).toMatch(ULID_REGEX);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stays monotonic within the same millisecond and when the clock goes back', () => {
    const next = monotonicUlidFactory();
    const a = next(1_000);
    const b = next(1_000);
    const c = next(999);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
    expect(ulidTime(a)).toBe(1_000);
  });

  it('round-trips the timestamp', () => {
    const now = Date.now();
    expect(ulidTime(ulid(now))).toBe(now);
  });
});

describe('ids', () => {
  it('accepts slugs and rejects other strings', () => {
    expect(AgentIdSchema.safeParse('rhea').success).toBe(true);
    expect(AgentIdSchema.safeParse('social-writer_2').success).toBe(true);
    expect(AgentIdSchema.safeParse('Rhea').success).toBe(false);
    expect(AgentIdSchema.safeParse('').success).toBe(false);
    expect(AgentIdSchema.safeParse('../etc').success).toBe(false);
  });
});

describe('event schemas', () => {
  it('validates an input event per type', () => {
    const ok = EventInputSchema.safeParse({
      agent: 'titan',
      type: 'tool_call',
      data: { callId: 'c1', tool: 'vault_search', input: { q: 'x' } },
    });
    expect(ok.success).toBe(true);

    const bad = EventInputSchema.safeParse({
      agent: 'titan',
      type: 'question',
      data: { questionId: 'q', question: 'x?', options: [{ id: 'a', label: 'A' }], blocking: true },
    });
    expect(bad.success).toBe(false);

    const unknownType = EventInputSchema.safeParse({ agent: 'titan', type: 'nope', data: {} });
    expect(unknownType.success).toBe(false);
  });

  it('validates a stored event', () => {
    const parsed = LogEventSchema.parse({
      id: ulid(),
      ts: Date.now(),
      agent: 'system',
      runId: null,
      parentId: null,
      type: 'kill',
      data: { scope: 'global', by: 'cli' },
    });
    expect(parsed.type).toBe('kill');
  });
});
