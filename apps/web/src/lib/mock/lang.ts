import { appLang, isLang, type Lang } from '@monsters/shared';

/*
 * The language of the mock core (D-153): `?lang=` of the page (e2e and demos), else the app's at
 * start. Fake content is built (and scripted replies are written) in the language in use; data
 * already seeded stays in the language the mock started with until the page reloads.
 */

let current: Lang | null = null;

/** The language the mock starts in: `?lang=` of the page, else the app's. */
export function startLang(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get('lang');
    if (isLang(q)) return q;
  } catch {
    // no window (tests)
  }
  return appLang();
}

/** Sets the language of the mock (at start, and when the settings change it). */
export function setMockLang(lang: Lang): void {
  current = lang;
}

/** The language of the mock core in use. */
export function mockLang(): Lang {
  return current ?? startLang();
}

/** The text of the mock's language: `tr('English', 'Italiano')`. */
export function tr<T>(en: T, it: T): T {
  return mockLang() === 'it' ? it : en;
}
