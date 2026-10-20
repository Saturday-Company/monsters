import { z } from 'zod';

/*
 * The context of one model request (C.1 of the plan of 16/10, D-075): how many
 * tokens each part of the prompt takes and the model's window. The core
 * estimates every part from the text it sends and scales the estimate to the
 * input the provider reports for that step (cache reads and writes included),
 * so the parts always add up to the real total. Carried by `provider_usage`
 * (`context`): one record per step, next to the tokens it explains.
 */

/**
 * The parts of a prompt, in the order the panel shows them (from the most
 * stable to the most recent, like the prompt itself):
 * - `base`: the harness's own prompt and tools (Claude Code, Codex), not ours;
 * - `instructions`: AGENTS.md and the rules of the system;
 * - `memory`: the user's profile and the monster's MEMORY.md;
 * - `tools`: the definitions of the tools (name, description, JSON schema);
 * - `summary`: the summary of the older turns of the conversation (C.3, D-082);
 * - `conversation`: the earlier turns and the monster's own steps of this turn;
 * - `tool_results`: what the tools returned in this turn;
 * - `current`: the message of this turn (with its brief) and what arrived while it worked.
 */
export const CONTEXT_PARTS = [
  'base',
  'instructions',
  'memory',
  'tools',
  'summary',
  'conversation',
  'tool_results',
  'current',
] as const;
export const ContextPartSchema = z.enum(CONTEXT_PARTS);
export type ContextPart = z.infer<typeof ContextPartSchema>;

/**
 * Share of the window at which the conversation is compacted (plan C.3,
 * research: ~75% for small models; D-082). The panel draws it as a mark; the
 * core summarises the older turns past it.
 */
export const CONTEXT_COMPACT_AT = 0.75;

const Tokens = z.number().int().nonnegative();

export const ContextPartsSchema = z.object({
  base: Tokens.optional(),
  instructions: Tokens.optional(),
  memory: Tokens.optional(),
  tools: Tokens.optional(),
  summary: Tokens.optional(),
  conversation: Tokens.optional(),
  tool_results: Tokens.optional(),
  current: Tokens.optional(),
});
export type ContextParts = z.infer<typeof ContextPartsSchema>;

export const ContextUsageSchema = z.object({
  /** Tokens of the request: the input reported (with the cache), or the estimate. */
  total: Tokens,
  /** The model's context window, when known. */
  window: z.number().int().positive().optional(),
  /** Tokens per part; they add up to `total`. */
  parts: ContextPartsSchema,
  /**
   * `measured`: the estimate scaled to the input the provider reported;
   * `estimated`: no count from the provider, characters only.
   */
  source: z.enum(['measured', 'estimated']),
});
export type ContextUsage = z.infer<typeof ContextUsageSchema>;
