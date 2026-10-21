import { formatDate, planWindowTone, timeOptions, type PlanWindowView } from '@monsters/shared';
import { usageStrings } from './usage.strings.ts';

/*
 * Utilizzo del piano (D-111): the texts of a window, in the user's time zone.
 * Pure, so a window that resets while the page is open is recomputed with the
 * clock of the page and not left at the value the core sent.
 */

/** "in 45 min", "in 1 h 32", "in 2 h", or "Wed 16:00" from a day on. */
export function formatResetsIn(resetsAt: number, now: number): string {
  const w = usageStrings().plan;
  const ms = resetsAt - now;
  if (ms < 60_000) return w.resetsLessThanMinute;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return w.resetsInMinutes(minutes);
  if (ms < 24 * 3_600_000) return w.resetsInHours(Math.floor(minutes / 60), minutes % 60);
  return `${formatDate(resetsAt, { weekday: 'short' }).replace(/\.$/, '')} ${formatDate(resetsAt, timeOptions())}`;
}

/** "just now", "20 min ago", "2 h ago", "3 days ago". */
export function formatAgo(observedAt: number, now: number): string {
  const w = usageStrings().plan;
  const ms = Math.max(0, now - observedAt);
  if (ms < 60_000) return w.agoNow;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return w.agoMinutes(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return w.agoHours(hours);
  const days = Math.floor(hours / 24);
  return days === 1 ? w.agoYesterday : w.agoDays(days);
}

/** The window as it reads at `now`: past its reset time it is 0%, "azzerato". */
export function liveWindow(w: PlanWindowView, now: number): PlanWindowView {
  const reset = w.reset || (w.resetsAt !== null && w.resetsAt <= now);
  const usedPercent = reset ? 0 : w.usedPercent;
  return { ...w, reset, usedPercent, tone: planWindowTone(usedPercent) };
}

/** The line under a bar: when it resets, or that it has and will refresh at the next use. */
export function windowNote(w: PlanWindowView, now: number): string {
  const t = usageStrings().plan;
  if (w.reset) return t.resetNote;
  if (w.resetsAt === null) return t.resetUnknown;
  return t.resetsAt(formatResetsIn(w.resetsAt, now));
}

/** Lit segments out of 20 (one per 5%), at least one while anything is used. */
export function litSegments(percent: number, count = 20): number {
  if (percent <= 0) return 0;
  return Math.min(count, Math.max(1, Math.round((percent / 100) * count)));
}

/** The words that carry the colour: nothing below 80%, then two states. */
export function toneNote(w: PlanWindowView): string | null {
  if (w.reset) return null;
  const t = usageStrings().plan;
  if (w.usedPercent >= 100) return t.limitReached;
  if (w.tone === 'high') return t.almostAtLimit;
  if (w.tone === 'warn') return t.runningLow;
  return null;
}
