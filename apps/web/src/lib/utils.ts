import {
  USD_TO_EUR_DEFAULT,
  appLang,
  formatDate,
  formatNumber,
  timeOptions,
  type Lang,
} from '@monsters/shared';
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { utilsStrings } from './utils.strings.ts';

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

export function formatTime(ts: number): string {
  return formatDate(ts, timeOptions());
}

/** Whole calendar days from `ts` to `now`, local time (0 = today, 1 = yesterday). */
function daysAgo(ts: number, now: number): number {
  const startOf = (x: number) => {
    const d = new Date(x);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  return Math.round((startOf(now) - startOf(ts)) / 86_400_000);
}

/** "Today", "Yesterday" or the full date, for grouping the log. */
export function formatDay(ts: number, now = Date.now()): string {
  const diff = daysAgo(ts, now);
  if (diff === 0) return utilsStrings().today;
  if (diff === 1) return utilsStrings().yesterday;
  const s = formatDate(ts, { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Like `formatDay` but short, for narrow cards: "Today", "Yesterday", "Oct 16" ("ven 16 ott" in
 * Italian: the English line, with the time after it, would not fit with a weekday too).
 */
export function formatShortDay(ts: number, now = Date.now()): string {
  const diff = daysAgo(ts, now);
  if (diff === 0 || diff === 1) return formatDay(ts, now);
  const weekday = appLang() === 'it' ? { weekday: 'short' as const } : {};
  return formatDate(ts, { ...weekday, day: 'numeric', month: 'short' }).replace(/\./g, '');
}

/** Time of the latest message in the chat list: "10:15", "Yesterday", "Mon", "Oct 12". */
export function formatListTime(ts: number, now = Date.now()): string {
  const diff = daysAgo(ts, now);
  if (diff <= 0) return formatTime(ts);
  if (diff === 1) return utilsStrings().yesterday;
  if (diff < 7) return formatDate(ts, { weekday: 'short' }).replace(/\.$/, '');
  return formatDate(ts, { day: 'numeric', month: 'short' });
}

/** Calendar day of a timestamp, local time ("2026-10-15"), to group messages. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * The preposition before a name: "to Titan" in English, "a Titan" / "ad Atlas" in
 * Italian (the euphonic d before an "a"). Each language puts it in its own sentence.
 */
export function toName(name: string): string {
  return utilsStrings().toName(name);
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

/** "just now", "3 min ago", "2 h ago" (adesso, 3 min fa, 2 h fa). */
export function formatAgo(ts: number, now = Date.now()): string {
  const w = utilsStrings();
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return w.now;
  const m = Math.round(s / 60);
  if (m < 60) return w.minutesAgo(m);
  const h = Math.round(m / 60);
  if (h < 24) return w.hoursAgo(h);
  return formatDay(ts, now);
}

/** An amount with its currency symbol where the language puts it: "1,25 $" / "$1.25". */
function withSymbol(amount: string, symbol: string): string {
  return appLang() === 'it' ? `${amount} ${symbol}` : `${symbol}${amount}`;
}

/**
 * A cost in dollars, small ones included: Jev costs about $0.00002 a decision,
 * which a fixed number of decimals would show as "$0". Below a cent the first
 * two significant digits ("$0.00002", "$0.0012"), from a cent on up to three
 * decimals ("$0.042"), from a dollar on two ("$1.25"). Zero is "$0": callers
 * say "free" where it fits. Italian: "0,00002 $", the symbol after. `symbol`
 * writes euros the same way ("0,01 €").
 */
export function formatUsd(usd: number, symbol: '$' | '€' = '$'): string {
  if (!Number.isFinite(usd) || usd <= 0) return withSymbol('0', symbol);
  if (usd < 0.000001)
    return `< ${withSymbol(formatNumber(0.000001, { maximumFractionDigits: 6 }), symbol)}`;
  const opts: Intl.NumberFormatOptions =
    usd >= 1
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : usd >= 0.01
        ? { maximumFractionDigits: 3 }
        : { maximumSignificantDigits: 2 };
  return withSymbol(formatNumber(usd, opts), symbol);
}

/**
 * Euros first, dollars in brackets: "€0.9 ($1.1)", Italian "0,9 € (1,1 $)". The
 * caps are in euros, the providers bill in dollars; at the fixed rate of the
 * settings (default).
 */
export function eurFirst(usd: number, rate = USD_TO_EUR_DEFAULT, decimals = 1): string {
  const eur = Math.round(usd * rate * 10 ** decimals) / 10 ** decimals;
  const n = (x: number) => formatNumber(x, { maximumFractionDigits: decimals });
  const dollars = Math.round(usd * 10 ** decimals) / 10 ** decimals;
  return `${withSymbol(n(eur), '€')} (${withSymbol(n(dollars), '$')})`;
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
  return s.length > max ? `${s.slice(0, max)}\n… (${utilsStrings().moreChars(s.length - max)})` : s;
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
 * A number typed in a field, read by the language of the app: English groups
 * thousands with "," and has "." for decimals ("1,000" is 1000, "12.5" is 12.5);
 * Italian is the other way round ("1.000" is 1000, "12,5" is 12.5). Plain digits
 * always work, and so does a separator that can only be one thing: "12,5" in
 * English is 12.5 (a group is always three digits), "1,000.50" and "1.000,50"
 * are 1000.5 whatever the language. What cannot be read for sure is refused, not
 * guessed: "1.000" in English (a thousand or one?), "1,2,3", "1,00,000".
 * Empty → null; anything else that is not a number → undefined.
 */
export function parseAmount(text: string, lang: Lang = appLang()): number | null | undefined {
  const t = text
    .trim()
    .replace(/\s*[€$]$/, '')
    .replace(/\s/g, '');
  if (t === '') return null;
  if (!/^\d[\d.,]*$/.test(t)) return undefined;
  const marks = [...t].filter((c) => c === '.' || c === ',');
  if (marks.length === 0) return Number(t);
  const grouped = (digits: string) => /^[1-9]\d{0,2}(?:[.,]\d{3})+$/.test(digits);
  const mark = marks[marks.length - 1]!;
  const last = t.lastIndexOf(mark);
  const head = t.slice(0, last);
  const tail = t.slice(last + 1);
  if (!/^\d+$/.test(tail)) return undefined;
  const kinds = new Set(marks);
  // One kind of mark, more than once: grouping ("1,000,000"); a decimal mark never repeats.
  if (kinds.size === 1 && marks.length > 1) {
    return grouped(t) ? Number(t.replaceAll(mark, '')) : undefined;
  }
  // Both kinds: the last one is the decimal mark, once, and the other one groups the rest.
  if (kinds.size === 2) {
    const other = mark === '.' ? ',' : '.';
    if (head.includes(mark) || !(/^\d+$/.test(head.replaceAll(other, '')) && grouped(head))) {
      return undefined;
    }
    return Number(head.replaceAll(other, '') + '.' + tail);
  }
  // One mark, once. Three digits after it may be a group: the app's own group mark says so, the
  // other one is a decimal mark that looks like a group, so it is not guessed.
  if (last === 0) return undefined;
  const looksLikeGroup = tail.length === 3 && /^[1-9]\d{0,2}$/.test(head);
  if (looksLikeGroup) return mark === (lang === 'it' ? ',' : '.') ? undefined : Number(head + tail);
  return Number(head + '.' + tail);
}
