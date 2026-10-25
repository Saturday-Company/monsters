import { z } from 'zod';

/*
 * Limits of each job (D-064): the safety net that stops a job that runs away. One job is a
 * run of the lead and of every monster it delegates to. The numbers apply to the requests served
 * by models paid per use (`maxRunSteps`, `maxRunTokens`, `maxRunCostUsd`, `maxSubagentTokens`) and,
 * apart, to those served by a subscription harness (`plan`: Claude Code, Codex), whose cost is
 * notional but uses the plan's quota.
 *
 *   GET    /api/settings/limits   → RunLimitsView ({ limits, defaults })
 *   PUT    /api/settings/limits   RunLimitsUpdate → RunLimitsView (what is not sent stays)
 *   DELETE /api/settings/limits   → RunLimitsView (back to the defaults)
 *
 * New jobs use the saved values at once, no restart.
 */

/** The limits the settings show (the core keeps a few more that stay at their defaults). */
export const RunLimitsValuesSchema = z.object({
  /** Model steps of a job, every monster included (API models). */
  maxRunSteps: z.number().int(),
  /** Fresh input + output tokens of a job (API models). */
  maxRunTokens: z.number().int(),
  /** Dollars a job may spend, as the providers report them. */
  maxRunCostUsd: z.number(),
  /** Fresh tokens of one delegated monster in one task (API models). */
  maxSubagentTokens: z.number().int(),
  /** Delegations of a whole job. */
  maxDelegationsPerRun: z.number().int(),
  /** The same caps for requests served by a subscription harness. */
  plan: z.object({
    maxRunSteps: z.number().int(),
    maxRunTokens: z.number().int(),
    maxSubagentTokens: z.number().int(),
  }),
});
export type RunLimitsValues = z.infer<typeof RunLimitsValuesSchema>;

export const RunLimitsViewSchema = z.object({
  limits: RunLimitsValuesSchema,
  defaults: RunLimitsValuesSchema,
});
export type RunLimitsView = z.infer<typeof RunLimitsViewSchema>;

/** Bounds of what the settings accept: wide enough to never be in the way, narrow enough to be a net. */
export const RUN_LIMIT_BOUNDS = {
  steps: { min: 1, max: 100_000 },
  tokens: { min: 1_000, max: 1_000_000_000 },
  costUsd: { min: 0.01, max: 10_000 },
  delegations: { min: 1, max: 500 },
} as const;

const steps = z.number().int().min(RUN_LIMIT_BOUNDS.steps.min).max(RUN_LIMIT_BOUNDS.steps.max);
const tokens = z.number().int().min(RUN_LIMIT_BOUNDS.tokens.min).max(RUN_LIMIT_BOUNDS.tokens.max);

export const RunLimitsUpdateSchema = z.object({
  maxRunSteps: steps.optional(),
  maxRunTokens: tokens.optional(),
  maxRunCostUsd: z
    .number()
    .min(RUN_LIMIT_BOUNDS.costUsd.min)
    .max(RUN_LIMIT_BOUNDS.costUsd.max)
    .optional(),
  maxSubagentTokens: tokens.optional(),
  maxDelegationsPerRun: z
    .number()
    .int()
    .min(RUN_LIMIT_BOUNDS.delegations.min)
    .max(RUN_LIMIT_BOUNDS.delegations.max)
    .optional(),
  plan: z
    .object({
      maxRunSteps: steps.optional(),
      maxRunTokens: tokens.optional(),
      maxSubagentTokens: tokens.optional(),
    })
    .optional(),
});
export type RunLimitsUpdate = z.infer<typeof RunLimitsUpdateSchema>;

/**
 * The three presets of the "Safety net" row (C2): Careful, Normal, Generous. Each is a set of values
 * of the fields above, derived from the core's defaults (Normal IS the defaults), so a change of the
 * defaults moves the presets with it. The plan's own caps stay at their defaults in every preset: they
 * protect a subscription's quota and are not something a person dials up and down.
 */
export const RUN_LIMIT_PRESETS = ['careful', 'normal', 'generous'] as const;
export type RunLimitPreset = (typeof RUN_LIMIT_PRESETS)[number];

/** What each preset multiplies the defaults by. */
const PRESET_FACTOR: Record<RunLimitPreset, number> = { careful: 0.5, normal: 1, generous: 3 };

const within = (n: number, b: { min: number; max: number }) => Math.min(b.max, Math.max(b.min, n));

/** The values of a preset: whole steps and delegations, tokens in thousands, cost in cents. */
export function runLimitsPreset(
  preset: RunLimitPreset,
  defaults: RunLimitsValues,
): RunLimitsValues {
  const f = PRESET_FACTOR[preset];
  const out = structuredClone(defaults);
  if (f === 1) return out;
  const whole = (n: number, b: { min: number; max: number }) => within(Math.round(n * f), b);
  const thousands = (n: number) =>
    within(Math.round((n * f) / 1000) * 1000, RUN_LIMIT_BOUNDS.tokens);
  out.maxRunSteps = whole(defaults.maxRunSteps, RUN_LIMIT_BOUNDS.steps);
  out.maxRunTokens = thousands(defaults.maxRunTokens);
  out.maxSubagentTokens = thousands(defaults.maxSubagentTokens);
  out.maxRunCostUsd = within(
    Math.round(defaults.maxRunCostUsd * f * 100) / 100,
    RUN_LIMIT_BOUNDS.costUsd,
  );
  out.maxDelegationsPerRun = whole(defaults.maxDelegationsPerRun, RUN_LIMIT_BOUNDS.delegations);
  return out;
}

/** The preset the limits equal, field by field; `custom` when they match none (a value was typed). */
export function matchRunLimitsPreset(
  limits: RunLimitsValues,
  defaults: RunLimitsValues,
): RunLimitPreset | 'custom' {
  const same = (a: RunLimitsValues, b: RunLimitsValues) =>
    a.maxRunSteps === b.maxRunSteps &&
    a.maxRunTokens === b.maxRunTokens &&
    a.maxSubagentTokens === b.maxSubagentTokens &&
    a.maxDelegationsPerRun === b.maxDelegationsPerRun &&
    Math.abs(a.maxRunCostUsd - b.maxRunCostUsd) < 1e-9 &&
    a.plan.maxRunSteps === b.plan.maxRunSteps &&
    a.plan.maxRunTokens === b.plan.maxRunTokens &&
    a.plan.maxSubagentTokens === b.plan.maxSubagentTokens;
  return RUN_LIMIT_PRESETS.find((p) => same(limits, runLimitsPreset(p, defaults))) ?? 'custom';
}

/** The fields a preset changes in `limits` (an update; empty when it already matches). */
export function runLimitsUpdateFor(
  preset: RunLimitPreset,
  limits: RunLimitsValues,
  defaults: RunLimitsValues,
): RunLimitsUpdate {
  const to = runLimitsPreset(preset, defaults);
  const update: RunLimitsUpdate = {};
  for (const k of [
    'maxRunSteps',
    'maxRunTokens',
    'maxRunCostUsd',
    'maxSubagentTokens',
    'maxDelegationsPerRun',
  ] as const) {
    if (limits[k] !== to[k]) update[k] = to[k];
  }
  const plan: NonNullable<RunLimitsUpdate['plan']> = {};
  for (const k of ['maxRunSteps', 'maxRunTokens', 'maxSubagentTokens'] as const) {
    if (limits.plan[k] !== to.plan[k]) plan[k] = to.plan[k];
  }
  if (Object.keys(plan).length > 0) update.plan = plan;
  return update;
}
