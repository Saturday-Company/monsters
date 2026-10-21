import { z } from 'zod';

/*
 * The language of the app (D-153): English first, Italian as a choice. It is the
 * language of the UI, of the core's messages, of Telegram and of the app's
 * windows. The monsters' own writing language is another setting (the `lingua`
 * answer of the onboarding). Each package keeps its own typed dictionaries; this
 * module holds the language in use and the formatters every package shares.
 */

export const LANGS = ['en', 'it'] as const;
export const LangSchema = z.enum(LANGS);
export type Lang = z.infer<typeof LangSchema>;

export const DEFAULT_LANG: Lang = 'en';

/** The locale of each language when the system gives none of the same language. */
const BASE_LOCALE: Record<Lang, string> = { en: 'en-US', it: 'it-IT' };

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'it';
}

/**
 * The app's language from language tags in order of preference ("it-IT",
 * "en_US.UTF-8", "C"): the first one we have, else English.
 */
export function resolveLang(
  tags: readonly (string | undefined | null)[] | string | undefined,
): Lang {
  const list = typeof tags === 'string' ? [tags] : (tags ?? []);
  for (const tag of list) {
    const base = tag
      ?.trim()
      .toLowerCase()
      .split(/[-_.@]/)[0];
    if (isLang(base)) return base;
  }
  return DEFAULT_LANG;
}

/** The language of this process's environment: `MONSTERS_LANG`, then the POSIX variables, then Intl. */
export function systemLang(env: Record<string, string | undefined> = {}): Lang {
  const explicit = env['MONSTERS_LANG'];
  if (isLang(explicit)) return explicit;
  // LANGUAGE is a list ("it:en"); LC_ALL wins over LC_MESSAGES, which wins over LANG.
  const posix = [
    env['LANGUAGE']?.split(':')[0],
    env['LC_ALL'],
    env['LC_MESSAGES'],
    env['LANG'],
  ].filter((t) => t && t !== 'C' && t !== 'POSIX' && !t.startsWith('C.'));
  if (posix.length) return resolveLang(posix);
  try {
    return resolveLang(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return DEFAULT_LANG;
  }
}

let current: Lang = DEFAULT_LANG;
let regionTag: string | undefined;
const listeners = new Set<(lang: Lang) => void>();

/** The language in use in this process. */
export function appLang(): Lang {
  return current;
}

/**
 * Sets the language in use. `region` is a tag of the same language from the
 * system ("en-GB"), for English dates and numbers; another language's tag is
 * ignored, and Italian is always `it-IT`.
 */
export function setAppLang(lang: Lang, region?: string): void {
  regionTag =
    region && resolveLang(region) === lang ? region.replace('_', '-').split('.')[0] : undefined;
  if (lang === current) return;
  current = lang;
  for (const fn of listeners) fn(lang);
}

/** Called at every change of language; returns the unsubscribe. */
export function onAppLang(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The locale for Intl: English takes the system's region when it is of the same language ("en-GB"),
 * Italian is always `it-IT` (as it was before D-153: "it-CH" would change the separators).
 */
export function appLocale(lang: Lang = current): string {
  if (lang === 'en' && lang === current && regionTag) {
    try {
      return Intl.getCanonicalLocales(regionTag)[0] ?? BASE_LOCALE[lang];
    } catch {
      return BASE_LOCALE[lang];
    }
  }
  return BASE_LOCALE[lang];
}

/**
 * Picks the dictionary of the language in use: `pick({ en, it })`. Dictionaries
 * have the English one's type, so a missing key fails the typecheck.
 */
export function pick<T>(dicts: Record<Lang, T>, lang: Lang = current): T {
  return dicts[lang];
}

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, make: () => T): T {
  let fmt = cache.get(key) as T | undefined;
  if (!fmt) {
    fmt = make();
    cache.set(key, fmt);
  }
  return fmt;
}

/** A number in the language in use ("1,234.5" / "1.234,5"). */
export function formatNumber(
  n: number,
  options: Intl.NumberFormatOptions = {},
  lang?: Lang,
): string {
  const locale = appLocale(lang);
  return cached(
    `n|${locale}|${JSON.stringify(options)}`,
    () => new Intl.NumberFormat(locale, options),
  ).format(n);
}

/** A date or time in the language in use. */
export function formatDate(
  ts: number | Date,
  options: Intl.DateTimeFormatOptions,
  lang?: Lang,
): string {
  const locale = appLocale(lang);
  return cached(
    `d|${locale}|${JSON.stringify(options)}`,
    () => new Intl.DateTimeFormat(locale, options),
  ).format(ts);
}

/**
 * The options of a clock time: Italian keeps the two-digit hour ("09:05", "16:00"),
 * English drops the leading zero ("9:05 AM", "4:00 PM"; a 24-hour locale such as
 * en-GB still pads it by itself).
 */
export function timeOptions(lang: Lang = current): Intl.DateTimeFormatOptions {
  return { hour: lang === 'it' ? '2-digit' : 'numeric', minute: '2-digit' };
}

/** "A", "A and B", "A, B and C" in the language in use. */
export function formatList(items: readonly string[], lang?: Lang): string {
  try {
    return new Intl.ListFormat(appLocale(lang), { type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

/** Compares two strings for sorting in the language in use. */
export function compareText(a: string, b: string, lang?: Lang): number {
  return a.localeCompare(b, appLocale(lang), { sensitivity: 'base', numeric: true });
}
