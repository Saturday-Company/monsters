import { z } from 'zod';
import { planLimitStrings } from './plan-limits.strings.ts';

/*
 * Utilizzo del piano (D-111): the limits of the plans the user already pays
 * for (Claude, ChatGPT/Codex), as the official programs report them while a
 * monster works on that plan. Read only from what the harness already prints
 * (Claude Code's `rate_limit_event`, Codex's `account/rateLimits/updated`):
 * Monsters asks no endpoint of its own and reads no credential file. So the
 * numbers are as old as the last run on that plan.
 *
 *   GET /api/subscriptions        → SubscriptionsResponse.limits (PlanLimitsResponse)
 *   GET /api/agents/:id/usage     → AgentUsageView.planLimits (the monster's plan, or null)
 */

export const PLAN_LIMIT_IDS = ['claude', 'chatgpt'] as const;
export const PlanLimitIdSchema = z.enum(PLAN_LIMIT_IDS);
export type PlanLimitId = z.infer<typeof PlanLimitIdSchema>;

/** From 80% a window warns, from 95% it is nearly out. */
export const PLAN_WARN_AT = 80;
export const PLAN_HIGH_AT = 95;

/** What a harness reported for one window (`usedPercent` already 0-100, `resetsAt` in ms). */
export const PlanWindowReadingSchema = z.object({
  /** Claude: `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`. Codex: `primary`, `secondary`. */
  id: z.string().min(1).max(40),
  usedPercent: z.number().min(0).max(10_000),
  resetsAt: z.number().nullable(),
  /** Length of the window when the harness says it. */
  windowMinutes: z.number().positive().nullable().optional(),
});
export type PlanWindowReading = z.infer<typeof PlanWindowReadingSchema>;

/** A reading of the plan: `partial` = it updates only the windows it names (Claude), else it replaces all (Codex). */
export const PlanLimitsReadingSchema = z.object({
  plan: PlanLimitIdSchema,
  windows: z.array(PlanWindowReadingSchema).min(1),
  partial: z.boolean(),
});
export type PlanLimitsReading = z.infer<typeof PlanLimitsReadingSchema>;

/** What the core keeps (and persists): the latest reading of each window, with the time it was observed. */
export const PlanWindowSnapshotSchema = PlanWindowReadingSchema.extend({ observedAt: z.number() });
export type PlanWindowSnapshot = z.infer<typeof PlanWindowSnapshotSchema>;

export const PlanLimitsSnapshotSchema = z.object({
  plan: PlanLimitIdSchema,
  windows: z.array(PlanWindowSnapshotSchema),
});
export type PlanLimitsSnapshot = z.infer<typeof PlanLimitsSnapshotSchema>;

export const PlanWindowViewSchema = z.object({
  id: z.string(),
  /** "Sessione", "Settimana", "Opus settimana", "5 ore"… */
  label: z.string(),
  /** 0-100 (above 100 when the plan allows going past); 0 once the window has reset. */
  usedPercent: z.number().min(0),
  resetsAt: z.number().nullable(),
  /** The reset time has passed since the reading: shown as "azzerato", refreshed at the next use. */
  reset: z.boolean(),
  tone: z.enum(['ok', 'warn', 'high']),
  observedAt: z.number(),
});
export type PlanWindowView = z.infer<typeof PlanWindowViewSchema>;

export const PlanLimitsViewSchema = z.object({
  plan: PlanLimitIdSchema,
  windows: z.array(PlanWindowViewSchema),
  /** The latest reading of any window. */
  observedAt: z.number(),
});
export type PlanLimitsView = z.infer<typeof PlanLimitsViewSchema>;

export const PlanLimitsResponseSchema = z.object({
  claude: PlanLimitsViewSchema.nullable(),
  chatgpt: PlanLimitsViewSchema.nullable(),
});
export type PlanLimitsResponse = z.infer<typeof PlanLimitsResponseSchema>;

const CLAUDE_ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];
const CLAUDE_LABELS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'] as const;
const CLAUDE_MINUTES: Record<string, number> = { five_hour: 300, seven_day: 10_080 };

/** A window named by its length: 300 → "5 hours", 10080 → "Week", 1440 → "Day" (Italian: "5 ore", "Settimana", "Giorno"). */
export function windowLengthLabel(minutes: number | null | undefined): string | null {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return null;
  const t = planLimitStrings();
  const m = Math.round(minutes);
  if (m === 10_080) return t.week;
  if (m === 1440) return t.day;
  if (m >= 1440 && m % 1440 === 0) return t.days(m / 1440);
  if (m >= 60 && m % 60 === 0) return t.hours(m / 60);
  if (m >= 60) return t.hoursDecimal(Math.round((m / 60) * 10) / 10);
  return t.minutes(m);
}

export function planWindowLabel(
  plan: PlanLimitId,
  id: string,
  windowMinutes?: number | null,
): string {
  const t = planLimitStrings();
  if (plan === 'claude' && (CLAUDE_LABELS as readonly string[]).includes(id)) {
    return t[id as (typeof CLAUDE_LABELS)[number]];
  }
  return windowLengthLabel(windowMinutes) ?? (id === 'secondary' ? t.secondWindow : t.window);
}

export function planWindowTone(percent: number): 'ok' | 'warn' | 'high' {
  return percent >= PLAN_HIGH_AT ? 'high' : percent >= PLAN_WARN_AT ? 'warn' : 'ok';
}

/** One window as it reads at `now`: past its reset time it is 0% and marked `reset`. */
export function planWindowView(
  plan: PlanLimitId,
  w: PlanWindowSnapshot,
  now: number,
): PlanWindowView {
  const reset = w.resetsAt !== null && w.resetsAt <= now;
  const usedPercent = reset ? 0 : Math.max(0, Math.round(w.usedPercent));
  return {
    id: w.id,
    label: planWindowLabel(
      plan,
      w.id,
      w.windowMinutes ?? (plan === 'claude' ? CLAUDE_MINUTES[w.id] : null),
    ),
    usedPercent,
    resetsAt: w.resetsAt,
    reset,
    tone: planWindowTone(usedPercent),
    observedAt: w.observedAt,
  };
}

/** The windows in display order: Claude's by kind, Codex's by length (the short one first). */
export function planLimitsView(
  snapshot: PlanLimitsSnapshot | null | undefined,
  now: number,
): PlanLimitsView | null {
  if (!snapshot || snapshot.windows.length === 0) return null;
  const rank = (w: PlanWindowSnapshot) => {
    if (snapshot.plan === 'claude') {
      const i = CLAUDE_ORDER.indexOf(w.id);
      return i < 0 ? CLAUDE_ORDER.length : i;
    }
    return w.windowMinutes ?? (w.id === 'primary' ? 0 : 1_000_000);
  };
  const windows = [...snapshot.windows]
    .sort((a, b) => rank(a) - rank(b))
    .map((w) => planWindowView(snapshot.plan, w, now));
  return {
    plan: snapshot.plan,
    windows,
    observedAt: Math.max(...snapshot.windows.map((w) => w.observedAt)),
  };
}

/** The highest window of a plan, for a small indicator (null when none, or all reset). */
export function planPeak(view: PlanLimitsView | null | undefined): PlanWindowView | null {
  let peak: PlanWindowView | null = null;
  for (const w of view?.windows ?? []) {
    if (!peak || w.usedPercent > peak.usedPercent) peak = w;
  }
  return peak;
}

/**
 * Merges a reading into the snapshot: a partial reading (Claude) updates the
 * windows it names, a complete one (Codex) replaces them all.
 */
export function mergePlanReading(
  prev: PlanLimitsSnapshot | null | undefined,
  reading: PlanLimitsReading,
  now: number,
): PlanLimitsSnapshot {
  const windows = new Map<string, PlanWindowSnapshot>();
  if (reading.partial) for (const w of prev?.windows ?? []) windows.set(w.id, w);
  for (const r of reading.windows) {
    windows.set(r.id, {
      id: r.id,
      usedPercent: r.usedPercent,
      resetsAt: r.resetsAt,
      ...(r.windowMinutes ? { windowMinutes: r.windowMinutes } : {}),
      observedAt: now,
    });
  }
  return { plan: reading.plan, windows: [...windows.values()] };
}
