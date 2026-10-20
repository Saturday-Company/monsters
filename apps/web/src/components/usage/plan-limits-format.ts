import { planWindowTone, type PlanWindowView } from '@monsters/shared';

/*
 * Utilizzo del piano (D-111): the texts of a window, in the user's time zone.
 * Pure, so a window that resets while the page is open is recomputed with the
 * clock of the page and not left at the value the core sent.
 */

const WEEKDAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** "tra 45 min", "tra 1 h 32", "tra 2 h", or "mer 16:00" from a day on. */
export function formatResetsIn(resetsAt: number, now: number): string {
  const ms = resetsAt - now;
  if (ms < 60_000) return 'tra meno di un minuto';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `tra ${minutes} min`;
  if (ms < 24 * 3_600_000) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `tra ${h} h` : `tra ${h} h ${m}`;
  }
  const d = new Date(resetsAt);
  return `${WEEKDAYS[d.getDay()]} ${hhmm(d)}`;
}

/** "aggiornato adesso", "20 min fa", "2 h fa", "3 giorni fa". */
export function formatAgo(observedAt: number, now: number): string {
  const ms = Math.max(0, now - observedAt);
  if (ms < 60_000) return 'adesso';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min fa`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h fa`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'ieri' : `${days} giorni fa`;
}

/** The window as it reads at `now`: past its reset time it is 0%, "azzerato". */
export function liveWindow(w: PlanWindowView, now: number): PlanWindowView {
  const reset = w.reset || (w.resetsAt !== null && w.resetsAt <= now);
  const usedPercent = reset ? 0 : w.usedPercent;
  return { ...w, reset, usedPercent, tone: planWindowTone(usedPercent) };
}

/** The line under a bar: when it resets, or that it has and will refresh at the next use. */
export function windowNote(w: PlanWindowView, now: number): string {
  if (w.reset) return 'azzerato · si aggiorna al prossimo uso';
  if (w.resetsAt === null) return 'orario di azzeramento non noto';
  return `si azzera ${formatResetsIn(w.resetsAt, now)}`;
}

/** Lit segments out of 20 (one per 5%), at least one while anything is used. */
export function litSegments(percent: number, count = 20): number {
  if (percent <= 0) return 0;
  return Math.min(count, Math.max(1, Math.round((percent / 100) * count)));
}

/** The words that carry the colour: nothing below 80%, then two states. */
export function toneNote(w: PlanWindowView): string | null {
  if (w.reset) return null;
  if (w.usedPercent >= 100) return 'limite raggiunto';
  if (w.tone === 'high') return 'quasi al limite';
  if (w.tone === 'warn') return 'in esaurimento';
  return null;
}
