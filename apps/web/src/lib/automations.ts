import {
  compareText,
  describeSchedule,
  formatDate,
  formatNumber,
  localTimeZone,
  type AutomationLimits,
  type AutomationRunState,
  type AutomationRunSummary,
  type AutomationTrigger,
  type AutomationView,
} from '@monsters/shared';
import { Cron } from 'croner';
import { formatDuration } from '../store/derive.ts';
import { automationTextStrings } from './automations.strings.ts';
import { formatUsd } from './utils.ts';

/*
 * The Automazioni section (plan of 17/10 §3 B3, D-094): what the menu says of
 * an automation and of its runs ("giri"), and the friendly schedule of the
 * form (ogni giorno / ogni settimana / ogni mese alle…) as a cron expression
 * and back. The next slots are computed with croner, the library of the core,
 * so the preview of the form is the schedule the core will keep.
 */

export type SchedulePreset = 'daily' | 'weekly' | 'monthly' | 'advanced';

/** The schedule as the form edits it. */
export interface ScheduleForm {
  preset: SchedulePreset;
  /** "23:00" (daily, weekly, monthly). */
  time: string;
  /** Days of the week, 0 = Sunday (weekly). */
  weekdays: number[];
  /** Day of the month, 1-31 (monthly). */
  monthDay: number;
  /** The expression of "Avanzato" (and of the other presets once built). */
  cron: string;
}

/** Days of the week as the form shows them, Monday first. */
export function weekdayKeys(): readonly { day: number; short: string; long: string }[] {
  return automationTextStrings().weekdays;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "23:00" → [23, 0]; null when it is not a time. */
export function parseTime(time: string): [number, number] | null {
  const m = TIME_RE.exec(time.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** The cron expression of the form; null when a field is missing (no day, no time). */
export function cronOfForm(f: ScheduleForm): string | null {
  if (f.preset === 'advanced') return f.cron.trim() || null;
  const t = parseTime(f.time);
  if (!t) return null;
  const [h, m] = t;
  if (f.preset === 'daily') return `${m} ${h} * * *`;
  if (f.preset === 'weekly') {
    if (f.weekdays.length === 0) return null;
    const days = [...new Set(f.weekdays)].sort((a, b) => a - b);
    return `${m} ${h} * * ${days.join(',')}`;
  }
  if (!Number.isInteger(f.monthDay) || f.monthDay < 1 || f.monthDay > 31) return null;
  return `${m} ${h} ${f.monthDay} * *`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The form of an expression: one of the presets when it is one of them
 * (a minute and an hour, every day / some days of the week / one day of the
 * month), else "Avanzato" with the expression as it is.
 */
export function formOfCron(cron: string): ScheduleForm {
  const base: ScheduleForm = {
    preset: 'advanced',
    time: '09:00',
    weekdays: [1],
    monthDay: 1,
    cron: cron.trim(),
  };
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return base;
  const [min, hour, dom, mon, dow] = f as [string, string, string, string, string];
  if (!/^\d{1,2}$/.test(min) || !/^\d{1,2}$/.test(hour) || mon !== '*') return base;
  const m = Number(min);
  const h = Number(hour);
  if (m > 59 || h > 23) return base;
  const time = `${pad(h)}:${pad(m)}`;
  if (dom === '*' && dow === '*') return { ...base, preset: 'daily', time };
  if (dom === '*' && /^\d(,\d)*$/.test(dow)) {
    const days = [...new Set(dow.split(',').map((d) => Number(d) % 7))];
    if (days.some((d) => d > 6)) return base;
    return { ...base, preset: 'weekly', time, weekdays: days };
  }
  if (dow === '*' && /^\d{1,2}$/.test(dom) && Number(dom) >= 1 && Number(dom) <= 31) {
    return { ...base, preset: 'monthly', time, monthDay: Number(dom) };
  }
  return base;
}

/** The time zone of the user (this browser). */
export function userTimeZone(): string {
  return localTimeZone();
}

/**
 * The next `n` slots of an expression in a zone, as croner (the core's library)
 * computes them; null when the expression or the zone is not valid.
 */
export function nextRuns(
  cron: string,
  timezone: string,
  n = 3,
  from = Date.now(),
): number[] | null {
  const expr = cron.trim();
  if (expr.split(/\s+/).length !== 5) return null;
  try {
    const job = new Cron(expr, { timezone, mode: '5-part', paused: true });
    return job.nextRuns(n, new Date(from)).map((d) => d.getTime());
  } catch {
    return null;
  }
}

/** The schedule in words, the zone said only when it is not the user's. */
export function scheduleText(cron: string, timezone: string): string {
  return describeSchedule(cron, { timezone, userTimezone: userTimeZone() });
}

/** "Sun, Oct 19, 11:00 PM" (the user's time). */
export function formatWhen(ts: number): string {
  return formatDate(ts, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(/\./g, '');
}

/** The state of a run in words (the menu, the list). */
export function runStateText(state: AutomationRunState): string {
  return automationTextStrings().runState[state];
}

/** The light of a state: green done, orange something waits or works, red an error. */
export function runStateTone(state: AutomationRunState): 'ok' | 'signal' | 'stop' | undefined {
  switch (state) {
    case 'completed':
      return 'ok';
    case 'running':
    case 'waiting_lead':
    case 'waiting_user':
      return 'signal';
    case 'failed':
    case 'aborted':
      return 'stop';
    case 'skipped':
      return undefined;
  }
}

/** Why the run started, in words. */
export function triggerText(trigger: AutomationTrigger): string {
  return automationTextStrings().trigger[trigger];
}

/** "12 steps · 48,200 tokens · free" (shown in upper case); null when nothing ran. */
export function usageText(
  run: Pick<AutomationRunSummary, 'steps' | 'tokens' | 'costUsd'>,
  /** Tokens are a technical detail: only with "Show technical details" (U-8). */
  withTokens = true,
): string | null {
  if (run.steps === 0 && run.tokens === 0 && run.costUsd === 0) return null;
  const w = automationTextStrings();
  const parts: string[] = [];
  if (run.steps > 0) parts.push(w.steps(run.steps));
  if (withTokens && run.tokens > 0) parts.push(w.tokens(formatNumber(run.tokens)));
  parts.push(run.costUsd > 0 ? formatUsd(run.costUsd) : w.free);
  return parts.join(' · ');
}

/** How long a run took; null while it goes on. */
export function runDuration(
  run: Pick<AutomationRunSummary, 'startedAt' | 'endedAt'>,
): string | null {
  return run.endedAt !== undefined ? formatDuration(run.endedAt - run.startedAt) : null;
}

/** The limits of a run in words; null when it has the limits of every run. */
export function limitsText(l: AutomationLimits): string | null {
  const w = automationTextStrings();
  const parts: string[] = [];
  if (l.maxSteps !== undefined) parts.push(w.limitSteps(l.maxSteps));
  if (l.maxTotalTokens !== undefined) parts.push(w.tokens(formatNumber(l.maxTotalTokens)));
  if (l.maxEur !== undefined) {
    parts.push(w.limitEur(formatNumber(l.maxEur, { maximumFractionDigits: 2 })));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The monsters of an automation: the capo first, then who takes part. */
export function crewOf(a: Pick<AutomationView, 'lead' | 'participants'>): string[] {
  return [a.lead, ...a.participants.filter((p) => p !== a.lead)];
}

/** The name of the squad of the automations with no project (D-097). */
export function personalSquad(): string {
  return automationTextStrings().personalSquad;
}

/** @deprecated Italian only: use `personalSquad()`, which follows the app language. */
export const PERSONAL_SQUAD = 'Squadra personale'; // i18n-ignore: kept until the last callers move to personalSquad()

export interface SquadGroup {
  /** The project's id, or '' for the personal squad. */
  key: string;
  label: string;
  items: AutomationView[];
}

/**
 * The automations by squad: the personal one first, then one group per
 * project; drafts first inside a group (they wait for a "Conferma"), then by name.
 */
export function groupBySquad(
  list: readonly AutomationView[],
  projectName: (id: string) => string = (id) => id,
): SquadGroup[] {
  const groups = new Map<string, SquadGroup>();
  for (const a of list) {
    const key = a.project ?? '';
    let g = groups.get(key);
    if (!g) {
      g = { key, label: key ? projectName(key) : personalSquad(), items: [] };
      groups.set(key, g);
    }
    g.items.push(a);
  }
  const rank = (a: AutomationView) => (a.status === 'draft' ? 0 : 1);
  for (const g of groups.values()) {
    g.items.sort((a, b) => rank(a) - rank(b) || compareText(a.name, b.name));
  }
  return [...groups.values()].sort(
    (a, b) => Number(a.key !== '') - Number(b.key !== '') || compareText(a.label, b.label),
  );
}

/** The state the list shows: the run in progress, else the last one. */
export function shownRun(a: Pick<AutomationView, 'current' | 'last'>): AutomationRunSummary | null {
  return a.current ?? a.last;
}
