import { appLang, isLang, resolveLang, setAppLang, type Lang } from '@monsters/shared';
import { create } from 'zustand';
import { desktop } from './desktop.ts';

/*
 * The app's language in the web UI (D-153). The core says it (`/api/setup-status`,
 * `/api/settings`), the Settings change it; until the core answers, the last one
 * this browser saw or the browser's own. Every visible text lives in a
 * `*.strings.ts` file next to the code that shows it:
 *
 *   const en = { title: 'Settings', notes: (n: number) => (n === 1 ? '1 note' : `${n} notes`) };
 *   const it: typeof en = { title: 'Impostazioni', notes: (n) => (n === 1 ? '1 nota' : `${n} note`) };
 *   export const settingsStrings = defineStrings({ en, it });
 *
 * and the code calls `settingsStrings()` where it needs them. The Italian
 * dictionary has the English one's type, so a missing key or a parameter of the
 * wrong type fails the typecheck. A change of language remounts the whole UI
 * (`LangRoot`), so a text picked while rendering never stays in the old language;
 * a text kept outside React (a store, a cache) must be picked again when shown.
 */

const KEY = 'monsters-lang';

function browserTags(): readonly string[] {
  return typeof navigator === 'undefined' ? [] : navigator.languages;
}

function region(): string | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.language;
}

function initial(): Lang {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {
    // private mode: the browser's language
  }
  return resolveLang(browserTags());
}

export const useLang = create<{ lang: Lang }>()(() => ({ lang: appLang() }));

let sent: Lang | null = null;

/**
 * Applies a language: texts, `<html lang>`, this browser's memory and the desktop app. A guess
 * (`initLang`, before the core answers) stays in the page: the desktop app keeps its own
 * language until the core's or the user's choice arrives, so its menus never flip for a moment.
 */
export function applyLang(lang: Lang, guess = false): void {
  setAppLang(lang, region());
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  if (guess) {
    if (useLang.getState().lang !== lang) useLang.setState({ lang });
    return;
  }
  try {
    window.localStorage.setItem(KEY, lang);
  } catch {
    // private mode
  }
  const d = desktop();
  if (d?.setLanguage && sent !== lang) {
    sent = lang;
    try {
      d.setLanguage(lang);
    } catch {
      // an older app: its menus stay as they are
    }
  }
  if (useLang.getState().lang !== lang) useLang.setState({ lang });
}

/** At start, before the first paint. */
export function initLang(): void {
  applyLang(initial(), true);
}

/** A dictionary per language; the function returns the one of the language in use. */
export function defineStrings<T>(dicts: Record<Lang, T>): () => T {
  return () => dicts[appLang()];
}

/** The language in use, for components that keep texts in a memo (`useMemo(…, [lang])`). */
export function useAppLang(): Lang {
  return useLang((s) => s.lang);
}

/** Each language by its own name, the same in every language (the picker of the settings). */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', it: 'Italiano' };
