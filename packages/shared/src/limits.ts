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
