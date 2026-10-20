import { USD_TO_EUR_DEFAULT } from '@monsters/shared';
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The type scale of styles.css (`--text-*`, docs/design.md): without it
 * tailwind-merge takes `text-body` for a colour and drops it next to `text-ink`.
 */
export const TEXT_SIZES = [
  'micro',
  'caption',
  'footnote',
  'body',
  'large',
  'title3',
  'title2',
  'title1',
  'display',
  'hero',
] as const;

const twMerge = extendTailwindMerge({ extend: { theme: { text: [...TEXT_SIZES] } } });

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const timeFmt = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

export function formatTime(ts: number): string {
  return timeFmt.format(ts);
}

/** "Oggi", "Ieri" or the full date, for grouping the log. */
export function formatDay(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return 'Oggi';
  if (diff === 1) return 'Ieri';
  const s = dayFmt.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const shortDayFmt = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** Like `formatDay` but short, for narrow cards: "Oggi", "Ieri", "ven 16 ott". */
export function formatShortDay(ts: number, now = Date.now()): string {
  const long = formatDay(ts, now);
  return long === 'Oggi' || long === 'Ieri' ? long : shortDayFmt.format(ts).replace(/\./g, '');
}

const weekdayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'short' });
const shortDateFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });

/** Time of the latest message in the chat list: "10:15", "Ieri", "lun", "12 ott". */
export function formatListTime(ts: number, now = Date.now()): string {
  const startOf = (x: number) => {
    const d = new Date(x);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const diff = Math.round((startOf(now) - startOf(ts)) / 86_400_000);
  if (diff <= 0) return timeFmt.format(ts);
  if (diff === 1) return 'Ieri';
  if (diff < 7) return weekdayFmt.format(ts).replace(/\.$/, '');
  return shortDateFmt.format(ts);
}

/** Calendar day of a timestamp, local time ("2026-10-15"), to group messages. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** "a Titan", "ad Atlas": the preposition before a name, with the euphonic d before an "a". */
export function toName(name: string): string {
  return /^[aàAÀ]/.test(name) ? `ad ${name}` : `a ${name}`;
}

/**
 * The words of a model name (no provider, no `:free`): no `-instruct`, words
 * apart, versions with a dot. "claude-sonnet-4-5" → "claude sonnet 4.5",
 * "llama-3.3-70b-instruct" → "llama 3.3 70b". Two numbers join only when the
 * first is not already a dotted version and the second is not a size:
 * "qwen-2.5-7b" → "qwen 2.5 7b", never "2.5.7b".
 */
export function modelWords(name: string): string {
  return name
    .replace(/-(instruct|chat|preview|latest)$/i, '')
    .replace(/(^|[^\d.])(\d+)-(\d{1,2})(?![\d.a-z])/gi, '$1$2.$3')
    .replace(/[-_]+/g, ' ')
    .trim();
}

/** "adesso", "3 min fa", "2 h fa". */
export function formatAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'adesso';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h fa`;
  return formatDay(ts, now);
}

/**
 * A cost in dollars, small ones included: Jev costs about 0,00002 $ a decision,
 * which a fixed number of decimals would show as "0 $". Below a cent the first
 * two significant digits ("0,00002 $", "0,0012 $"), from a cent on up to three
 * decimals ("0,042 $"), from a dollar on two ("1,25 $"). Zero is "0 $": callers
 * say "gratis" where it fits.
 */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '0 $';
  if (usd < 0.000001) return '< 0,000001 $';
  const opts: Intl.NumberFormatOptions =
    usd >= 1
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : usd >= 0.01
        ? { maximumFractionDigits: 3 }
        : { maximumSignificantDigits: 2 };
  return `${usd.toLocaleString('it-IT', opts)} $`;
}

/**
 * Euros first, dollars in brackets: "0,9 € (1,1 $)". The caps are in euros, the
 * providers bill in dollars; at the fixed rate of the settings (default).
 */
export function eurFirst(usd: number, rate = USD_TO_EUR_DEFAULT, decimals = 1): string {
  const eur = Math.round(usd * rate * 10 ** decimals) / 10 ** decimals;
  const n = (x: number) => x.toLocaleString('it-IT', { maximumFractionDigits: decimals });
  return `${n(eur)} € (${n(Math.round(usd * 10 ** decimals) / 10 ** decimals)} $)`;
}

/** A DOM-safe id from React's useId (":r1:" → "r1"). */
export function domId(reactId: string): string {
  return reactId.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** Pretty JSON for the terminal, cut when very long. */
export function prettyJson(value: unknown, max = 4000): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? String(value));
  } catch {
    s = String(value);
  }
  return s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} caratteri in più)` : s;
}

/**
 * A folder path in one spelling, to spot the same folder written twice:
 * `~` expanded when the home is known, one separator, none at the end, and
 * Windows paths (drive letter) without case.
 */
export function folderKey(path: string, home?: string): string {
  let p = path.trim();
  if (home && (p === '~' || p.startsWith('~/') || p.startsWith('~\\'))) p = home + p.slice(1);
  const windows = /^[A-Za-z]:([\\/]|$)/.test(p) || p.startsWith('\\\\');
  p = p.replace(windows ? /[\\/]+/g : /\/+/g, windows ? '\\' : '/');
  if (p.length > 1 && /[\\/]$/.test(p) && !/^[A-Za-z]:[\\/]$/.test(p)) p = p.slice(0, -1);
  return windows ? p.toLowerCase() : p;
}

/**
 * An amount typed in a field, in the Italian way or not: "12,5" and "12.5" are
 * 12.5, "1.000" and "1.000,50" are thousands. Before the collaudo of 17/10 every
 * dot was a thousands separator and "0.43" became 43 € without a word.
 * Empty → null; anything else that is not a number → undefined.
 */
export function parseAmount(text: string): number | null | undefined {
  let t = text.trim().replace(/\s*€$/, '').replace(/\s/g, '');
  if (t === '') return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  return Number(t);
}
