import { describe, expect, it } from 'vitest';
import { EventInputSchema, LogEventSchema, RunLimitsUpdateSchema, ulid } from '../src/index.ts';

describe('which limit stopped a job (data on the error event)', () => {
  it('an error event keeps the limit, an older one without it is still valid', () => {
    const limit = { kind: 'steps', value: 400, plan: true };
    const withLimit = EventInputSchema.parse({
      agent: 'franco',
      type: 'error',
      data: { code: 'run_limit', message: 'Franco stops', limit },
    });
    expect(withLimit.data).toMatchObject({ limit });
    const stored = LogEventSchema.parse({
      id: ulid(),
      ts: 1,
      agent: 'franco',
      runId: null,
      parentId: null,
      type: 'error',
      data: { code: 'run_limit', message: 'x', limit: { kind: 'spend' } },
    });
    expect(stored.data).toMatchObject({ limit: { kind: 'spend' } });
    expect(
      EventInputSchema.safeParse({
        agent: 'franco',
        type: 'error',
        data: { code: 'run_limit', message: 'old event' },
      }).success,
    ).toBe(true);
    expect(
      EventInputSchema.safeParse({
        agent: 'franco',
        type: 'error',
        data: { message: 'x', limit: { kind: 'nope' } },
      }).success,
    ).toBe(false);
  });

  it('a delegation keeps the limit that stopped its agent', () => {
    const parsed = EventInputSchema.parse({
      agent: 'samantha',
      type: 'delegation',
      data: {
        from: 'samantha',
        to: 'franco',
        status: 'failed',
        goal: 'x',
        runStatus: 'run_limit',
        limit: { kind: 'tokens', value: 5_000_000, plan: true },
      },
    });
    expect(parsed.data).toMatchObject({ limit: { kind: 'tokens', plan: true } });
  });
});

describe('the limits of each job: what the settings accept', () => {
  it('takes any of the fields, the plan’s apart', () => {
    expect(RunLimitsUpdateSchema.parse({})).toEqual({});
    expect(
      RunLimitsUpdateSchema.parse({ maxRunSteps: 300, plan: { maxRunTokens: 9_000_000 } }),
    ).toEqual({ maxRunSteps: 300, plan: { maxRunTokens: 9_000_000 } });
  });

  it('refuses numbers out of bounds, and fractions of a step', () => {
    for (const bad of [
      { maxRunSteps: 0 },
      { maxRunSteps: 2.5 },
      { maxRunTokens: 10 },
      { maxRunCostUsd: 0 },
      { maxDelegationsPerRun: 501 },
      { plan: { maxRunSteps: 1_000_000 } },
      { plan: { maxSubagentTokens: 5 } },
    ]) {
      expect(RunLimitsUpdateSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
