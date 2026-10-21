import { afterEach, describe, expect, it } from 'vitest';
import {
  appLang,
  appLocale,
  formatDate,
  formatList,
  formatNumber,
  onAppLang,
  pick,
  resolveLang,
  setAppLang,
  systemLang,
} from '../src/i18n.ts';

afterEach(() => setAppLang('en'));

describe('app language (D-153)', () => {
  it('resolves language tags, English when none is ours', () => {
    expect(resolveLang('it-IT')).toBe('it');
    expect(resolveLang('it_IT.UTF-8')).toBe('it');
    expect(resolveLang(['fr-FR', 'it'])).toBe('it');
    expect(resolveLang(['de-DE'])).toBe('en');
    expect(resolveLang(undefined)).toBe('en');
    expect(resolveLang('EN-gb')).toBe('en');
  });

  it('reads the system language: MONSTERS_LANG, then the POSIX variables', () => {
    expect(systemLang({ MONSTERS_LANG: 'it', LANG: 'en_US.UTF-8' })).toBe('it');
    expect(systemLang({ LANG: 'it_IT.UTF-8' })).toBe('it');
    expect(systemLang({ LC_ALL: 'en_GB.UTF-8', LANG: 'it_IT.UTF-8' })).toBe('en');
    expect(systemLang({ LANGUAGE: 'it:en', LANG: 'en_US.UTF-8' })).toBe('it');
    expect(['en', 'it']).toContain(systemLang({ LANG: 'C.UTF-8' }));
  });

  it('formats in the language in use, with the region of the same language only', () => {
    setAppLang('it');
    expect(formatNumber(12345.5)).toBe('12.345,5');
    expect(formatList(['A', 'B', 'C'])).toBe('A, B e C');
    setAppLang('en', 'en_GB.UTF-8');
    expect(appLocale()).toBe('en-GB');
    expect(formatDate(new Date(2026, 9, 21), { day: 'numeric', month: 'long' })).toBe('21 October');
    setAppLang('en', 'it_IT.UTF-8');
    expect(appLocale()).toBe('en-US');
    expect(formatList(['A', 'B'])).toBe('A and B');
  });

  it('pins Italian to it-IT whatever the system region is (it-CH has other separators)', () => {
    setAppLang('it', 'it_CH.UTF-8');
    expect(appLocale()).toBe('it-IT');
    expect(formatNumber(12345.5)).toBe('12.345,5');
  });

  it('picks the dictionary and tells the listeners of a change', () => {
    const seen: string[] = [];
    const off = onAppLang((l) => seen.push(l));
    setAppLang('it');
    setAppLang('it');
    expect(appLang()).toBe('it');
    expect(pick({ en: 'Settings', it: 'Impostazioni' })).toBe('Impostazioni');
    off();
    setAppLang('en');
    expect(seen).toEqual(['it']);
  });
});
