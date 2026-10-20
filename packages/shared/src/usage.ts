import { z } from 'zod';
import {
  CONTEXT_COMPACT_AT,
  CONTEXT_PARTS,
  ContextPartSchema,
  type ContextPart,
} from './context.ts';
import { WEB_SEARCH_USAGE_PROVIDER, type LogEvent } from './events.ts';
import { PlanLimitsViewSchema } from './plan-limits.ts';
import { SpendMeterViewSchema } from './spend.ts';

/*
 * Consumi of one monster (the panel of the plan of 16/10, "1 · Consumi"; D-075):
 *
 *   GET /api/agents/:id/usage → AgentUsageView
 *
 * What its current conversation (since the latest "Nuova conversazione" that
 * applies to it) holds and cost: the context of its latest step, part by part,
 * against the model's window; the totals of the runs of that conversation
 * (tokens, cache, model calls, time, cost by model, web searches, instinct);
 * today and this month against the spending caps. A monster on a subscription
 * (Claude Code, Codex, ChatGPT) shows "incluso nell'abbonamento" instead of money.
 * The panel is live: it reads this again when a `provider_usage`, a `run` or a
 * `new_conversation` of the monster arrives on the stream.
 *
 * Errors: 404 `unknown_agent`.
 */

const Tokens = z.number().int().nonnegative();

export const UsageContextPartSchema = z.object({ part: ContextPartSchema, tokens: Tokens });

export const UsageContextSchema = z.object({
  total: Tokens,
  /** The model's window; null when no provider says it. */
  window: z.number().int().positive().nullable(),
  /** Share of the window where compaction starts (`CONTEXT_COMPACT_AT`). */
  threshold: z.number().min(0).max(1),
  /** Every part with tokens, in `CONTEXT_PARTS` order. */
  parts: z.array(UsageContextPartSchema),
  source: z.enum(['measured', 'estimated']),
  provider: z.string(),
  model: z.string(),
  ts: z.number(),
  runId: z.string().nullable(),
  /**
   * The monster's model changed after the step that measured it (D-086): the
   * share is against the window of the current model (`provider`, `model`),
   * the tokens are those of the step with this one.
   */
  measuredWith: z.object({ provider: z.string(), model: z.string() }).optional(),
});
export type UsageContext = z.infer<typeof UsageContextSchema>;

export const UsageModelSchema = z.object({
  provider: z.string(),
  model: z.string(),
  calls: Tokens,
  inputTokens: Tokens,
  outputTokens: Tokens,
  cacheReadTokens: Tokens,
  cacheWriteTokens: Tokens,
  /** Null when no request of this model reported a cost. */
  costUsd: z.number().nonnegative().nullable(),
  costEur: z.number().nonnegative().nullable(),
  free: z.boolean(),
  subscription: z.boolean(),
});
export type UsageModel = z.infer<typeof UsageModelSchema>;

export const UsageSessionSchema = z.object({
  runs: Tokens,
  /** Requests to the models (the instinct's and the paid searches are apart). */
  calls: Tokens,
  /** Input tokens, cache reads and writes included. */
  inputTokens: Tokens,
  outputTokens: Tokens,
  cacheReadTokens: Tokens,
  cacheWriteTokens: Tokens,
  /** Time of work of the runs (a run still open: up to its latest event). */
  durationMs: z.number().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
  costEur: z.number().nonnegative().nullable(),
  /** Every model request went to a free model. */
  free: z.boolean(),
  models: z.array(UsageModelSchema),
  searches: z.object({
    count: Tokens,
    /** Paid searches (OpenRouter, D-071) and their cost. */
    paid: Tokens,
    costUsd: z.number().nonnegative(),
  }),
  instinct: z.object({
    /** Decisions the instinct took (or was asked about). */
    questions: Tokens,
    /** Calls to its engine that reported a usage (Jev). */
    calls: Tokens,
    costUsd: z.number().nonnegative(),
  }),
  /** The summaries of the older turns (C.3, D-082): requests apart, their cost in `costUsd`. */
  compaction: z
    .object({
      calls: Tokens,
      inputTokens: Tokens,
      outputTokens: Tokens,
      costUsd: z.number().nonnegative(),
    })
    .optional(),
});
export type UsageSession = z.infer<typeof UsageSessionSchema>;

export const UsageSpendSchema = z.object({
  usdToEur: z.number(),
  warnAt: z.number(),
  day: SpendMeterViewSchema,
  month: SpendMeterViewSchema,
  /** The monster's own spending (and its own caps, when set). */
  agent: z.object({ paid: z.boolean(), day: SpendMeterViewSchema, month: SpendMeterViewSchema }),
});
export type UsageSpend = z.infer<typeof UsageSpendSchema>;

/** The latest summary of the older turns of the conversation (C.3, D-082). */
export const UsageSummarySchema = z.object({
  /** Turns it covers (messages of the user and answers of the monster). */
  turns: Tokens,
  ts: z.number(),
  reason: z.enum(['turns', 'context']),
  /** Its length, as the monster reads it. */
  chars: Tokens,
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

export const AgentUsageViewSchema = z.object({
  agentId: z.string(),
  /** When the current conversation started (latest "Nuova conversazione"); null: never. */
  since: z.number().nullable(),
  /** Runs on a plan the user already pays for: "incluso nell'abbonamento", no money. */
  subscription: z.boolean(),
  /** The latest step of this monster in the conversation; null before the first. */
  context: UsageContextSchema.nullable(),
  /** The older turns are summarised (absent: never in this conversation). */
  summary: UsageSummarySchema.nullable().optional(),
  session: UsageSessionSchema,
  spend: UsageSpendSchema,
  /** The limits of the plan the monster works on (D-111); null: not on a plan, or none observed yet. */
  planLimits: PlanLimitsViewSchema.nullable().optional(),
  /**
   * The conversation is older than the latest archive of the log: its usage before this time
   * (epoch ms) left the log and is not counted here (the monthly spending is, in full).
   */
  archivedBefore: z.number().int().nullable().optional(),
});
export type AgentUsageView = z.infer<typeof AgentUsageViewSchema>;

/** How a model request counts (the same classes as the spending meter). */
export type UsageCostClass = 'paid' | 'free' | 'subscription' | 'unpriced';

const HARNESSES = new Set(['claude-agent', 'codex', 'chatgpt']);

/** Default classes when the caller has no better rule (the mock, the tests). */
export function defaultUsageClass(provider: string, model: string): UsageCostClass {
  if (HARNESSES.has(provider)) return 'subscription';
  if (provider === 'ollama' || provider === 'lmstudio') return 'free';
  if (model === 'openrouter/free' || model.endsWith(':free')) return 'free';
  return 'paid';
}

/** The run belongs to this monster's chat: it started it, or the user wrote to it. */
export function runOwnersOf(events: readonly LogEvent[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of events) {
    if (!e.runId || out.has(e.runId)) continue;
    if (e.type === 'run' && e.data.status === 'started') out.set(e.runId, e.agent);
    else if (e.type === 'message' && e.data.role === 'user' && e.data.to)
      out.set(e.runId, e.data.to);
  }
  return out;
}

/** A web search, ours or the harness's own (`claude-agent.WebSearch`, `codex.web_search`). */
function isWebSearch(tool: string): boolean {
  const short = tool.split('.').pop()!;
  return short === 'web_search' || short === 'WebSearch';
}

const round = (n: number) => Math.round(n * 1e8) / 1e8;

export interface ConversationUsageOptions {
  agentId: string;
  /** Events after the start of the conversation, oldest first (any type; others are ignored). */
  events: readonly LogEvent[];
  usdToEur: number;
  classify?: (provider: string, model: string, priced: boolean) => UsageCostClass;
  /** The model's window when the step did not say it. */
  windowOf?: (provider: string, model: string) => number | undefined;
}

/**
 * The context and the totals of one monster's conversation, from the log: pure,
 * shared by the core's endpoint and the mock of the UI.
 */
export function conversationUsage(
  o: ConversationUsageOptions,
): Pick<AgentUsageView, 'context' | 'session' | 'summary'> {
  const classify = o.classify ?? ((p, m) => defaultUsageClass(p, m));
  const owners = runOwnersOf(o.events);
  const mine = new Set([...owners].filter(([, a]) => a === o.agentId).map(([r]) => r));
  const runStart = new Map<string, number>();
  const runEnd = new Map<string, number>();
  const runLast = new Map<string, number>();
  const models = new Map<string, UsageModel & { freeAll: boolean }>();
  const session: UsageSession = {
    runs: 0,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    durationMs: 0,
    costUsd: null,
    costEur: null,
    free: false,
    models: [],
    searches: { count: 0, paid: 0, costUsd: 0 },
    instinct: { questions: 0, calls: 0, costUsd: 0 },
  };
  let context: UsageContext | null = null;
  let summary: UsageSummary | null = null;
  let freeAll = true;
  const addCost = (usd: number) => {
    session.costUsd = round((session.costUsd ?? 0) + usd);
  };

  for (const e of o.events) {
    if (!e.runId || !mine.has(e.runId)) continue;
    const runId = e.runId;
    runLast.set(runId, e.ts);
    switch (e.type) {
      case 'run':
        if (e.data.status === 'started') {
          if (!runStart.has(runId)) runStart.set(runId, e.ts);
          runEnd.delete(runId);
        } else runEnd.set(runId, e.ts);
        break;
      case 'tool_call':
        if (isWebSearch(e.data.tool)) session.searches.count++;
        break;
      case 'decision':
        if (e.data.use !== undefined) session.instinct.questions++;
        break;
      case 'conversation_summary':
        if (e.agent === o.agentId) {
          summary = {
            turns: e.data.turns,
            ts: e.ts,
            reason: e.data.reason,
            chars: e.data.text.length,
          };
        }
        break;
      case 'provider_usage': {
        const d = e.data;
        if (d.purpose === 'compaction') {
          const c = (session.compaction ??= {
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
          });
          c.calls++;
          c.inputTokens += d.inputTokens ?? 0;
          c.outputTokens += d.outputTokens ?? 0;
          c.costUsd = round(c.costUsd + (d.costUsd ?? 0));
          if (d.costUsd !== undefined) addCost(d.costUsd);
          break;
        }
        if (d.provider === 'typesafe') {
          session.instinct.calls++;
          session.instinct.costUsd = round(session.instinct.costUsd + (d.costUsd ?? 0));
          if (d.costUsd !== undefined) addCost(d.costUsd);
          break;
        }
        if (d.provider === WEB_SEARCH_USAGE_PROVIDER) {
          session.searches.paid++;
          session.searches.costUsd = round(session.searches.costUsd + (d.costUsd ?? 0));
          if (d.costUsd !== undefined) addCost(d.costUsd);
          break;
        }
        const cls = classify(d.provider, d.model, d.costUsd !== undefined);
        const free =
          cls === 'free' ||
          (d.requestedModel !== undefined &&
            classify(d.provider, d.requestedModel, false) === 'free');
        freeAll &&= free;
        session.calls++;
        const input = d.inputTokens ?? 0;
        const output = d.outputTokens ?? 0;
        const read = d.cachedInputTokens ?? 0;
        const write = d.cacheWriteTokens ?? 0;
        session.inputTokens += input;
        session.outputTokens += output;
        session.cacheReadTokens += read;
        session.cacheWriteTokens += write;
        if (d.costUsd !== undefined) addCost(d.costUsd);
        const key = `${d.provider}:${d.model}`;
        let m = models.get(key);
        if (!m) {
          m = {
            provider: d.provider,
            model: d.model,
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: null,
            costEur: null,
            free: false,
            subscription: cls === 'subscription',
            freeAll: true,
          };
          models.set(key, m);
        }
        m.calls++;
        m.inputTokens += input;
        m.outputTokens += output;
        m.cacheReadTokens += read;
        m.cacheWriteTokens += write;
        m.freeAll &&= free;
        if (d.costUsd !== undefined) m.costUsd = round((m.costUsd ?? 0) + d.costUsd);
        if (d.context && e.agent === o.agentId) {
          const c = d.context;
          const window = c.window ?? o.windowOf?.(d.provider, d.model) ?? null;
          context = {
            total: c.total,
            window,
            threshold: CONTEXT_COMPACT_AT,
            parts: CONTEXT_PARTS.flatMap((part: ContextPart) => {
              const tokens = c.parts[part] ?? 0;
              return tokens > 0 ? [{ part, tokens }] : [];
            }),
            source: c.source,
            provider: d.provider,
            model: d.model,
            ts: e.ts,
            runId,
          };
        }
        break;
      }
      default:
        break;
    }
  }

  for (const runId of mine) {
    const start = runStart.get(runId);
    if (start === undefined) continue;
    session.runs++;
    const end = runEnd.get(runId) ?? runLast.get(runId) ?? start;
    session.durationMs += Math.max(0, end - start);
  }
  session.free = session.calls > 0 && freeAll;
  if (session.costUsd !== null) session.costEur = round(session.costUsd * o.usdToEur);
  session.models = [...models.values()]
    .map(({ freeAll: f, ...m }) => ({
      ...m,
      free: f,
      costEur: m.costUsd !== null ? round(m.costUsd * o.usdToEur) : null,
    }))
    .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
  return { context, session, summary };
}
