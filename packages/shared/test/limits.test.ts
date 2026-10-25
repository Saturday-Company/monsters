import { describe, expect, it } from 'vitest';
import {
  EventInputSchema,
  LogEventSchema,
  matchRunLimitsPreset,
  RUN_LIMIT_BOUNDS,
  RUN_LIMIT_PRESETS,
  runLimitsPreset,
  RunLimitsUpdateSchema,
  runLimitsUpdateFor,
  type RunLimitsValues,
  ulid,
} from '../src/index.ts';

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

describe('the presets of the Safety net row', () => {
  const defaults: RunLimitsValues = {
    maxRunSteps: 150,
    maxRunTokens: 1_500_000,
    maxRunCostUsd: 0.5,
    maxSubagentTokens: 400_000,
    maxDelegationsPerRun: 12,
    plan: { maxRunSteps: 400, maxRunTokens: 5_000_000, maxSubagentTokens: 1_500_000 },
  };

  it('Normal is the defaults; Careful and Generous scale them, the plan caps stay', () => {
    expect(runLimitsPreset('normal', defaults)).toEqual(defaults);
    expect(runLimitsPreset('careful', defaults)).toEqual({
      maxRunSteps: 75,
      maxRunTokens: 750_000,
      maxRunCostUsd: 0.25,
      maxSubagentTokens: 200_000,
      maxDelegationsPerRun: 6,
      plan: defaults.plan,
    });
    expect(runLimitsPreset('generous', defaults)).toEqual({
      maxRunSteps: 450,
      maxRunTokens: 4_500_000,
      maxRunCostUsd: 1.5,
      maxSubagentTokens: 1_200_000,
      maxDelegationsPerRun: 36,
      plan: defaults.plan,
    });
  });

  it('every preset is a valid update and stays inside the bounds of the settings', () => {
    for (const p of RUN_LIMIT_PRESETS) {
      const v = runLimitsPreset(p, defaults);
      expect(RunLimitsUpdateSchema.safeParse(v).success).toBe(true);
    }
    // Defaults near the bounds are clamped, never refused.
    const edge: RunLimitsValues = {
      ...defaults,
      maxRunSteps: 1,
      maxRunTokens: 1_000,
      maxRunCostUsd: 0.01,
      maxDelegationsPerRun: 1,
      maxSubagentTokens: 1_000,
    };
    const careful = runLimitsPreset('careful', edge);
    expect(careful.maxRunSteps).toBe(RUN_LIMIT_BOUNDS.steps.min);
    expect(careful.maxRunTokens).toBe(RUN_LIMIT_BOUNDS.tokens.min);
    expect(careful.maxRunCostUsd).toBe(RUN_LIMIT_BOUNDS.costUsd.min);
    expect(careful.maxDelegationsPerRun).toBe(RUN_LIMIT_BOUNDS.delegations.min);
  });

  it('the limits are matched to the preset they equal, and to Custom otherwise', () => {
    for (const p of RUN_LIMIT_PRESETS)
      expect(matchRunLimitsPreset(runLimitsPreset(p, defaults), defaults)).toBe(p);
    expect(matchRunLimitsPreset(defaults, defaults)).toBe('normal');
    expect(matchRunLimitsPreset({ ...defaults, maxRunSteps: 151 }, defaults)).toBe('custom');
    expect(matchRunLimitsPreset({ ...defaults, maxRunCostUsd: 0.51 }, defaults)).toBe('custom');
    // A changed plan cap is a custom value too: the row does not hide it.
    expect(
      matchRunLimitsPreset({ ...defaults, plan: { ...defaults.plan, maxRunSteps: 800 } }, defaults),
    ).toBe('custom');
  });

  it('applying a preset sends only the fields that differ, the plan caps back to their defaults', () => {
    expect(runLimitsUpdateFor('normal', defaults, defaults)).toEqual({});
    expect(
      runLimitsUpdateFor(
        'careful',
        { ...defaults, plan: { ...defaults.plan, maxRunSteps: 800 } },
        defaults,
      ),
    ).toEqual({
      maxRunSteps: 75,
      maxRunTokens: 750_000,
      maxRunCostUsd: 0.25,
      maxSubagentTokens: 200_000,
      maxDelegationsPerRun: 6,
      plan: { maxRunSteps: 400 },
    });
  });
});
