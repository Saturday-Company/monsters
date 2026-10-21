import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  projectPagePath,
  SETTINGS_SECTIONS,
  SETTINGS_TABS,
  setAppLang,
  settingsPath,
  spendCapPath,
} from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';

/*
 * Every place of the app a monster or a message names is a real one (D-133). The texts built
 * with `settingsPath`/`projectPagePath` are right by construction (the web app's test checks
 * the screens render the same constants); this test reads the sources for the paths still
 * written by hand and checks each step against the constants: the review of 19/10 found
 * «Settings (External tools)», «Impostazioni → Permessi → Altri programmi» and
 * «Settings → Collegamenti → "Collega"» given to models.
 */

const PACKAGES = join(import.meta.dirname, '..', '..');
const SOURCES = ['core', 'tools', 'providers', 'vault'].map((p) => join(PACKAGES, p, 'src'));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Lines of code (comments say what they like: "Settings → Squadra" of a JSDoc is fine). */
function codeLines(path: string): { line: string; at: string }[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line, i) => ({ line, at: `${path.slice(PACKAGES.length + 1)}:${i + 1}` }))
    .filter(({ line }) => !/^\s*(\*|\/\/|\/\*)/.test(line));
}

/** Sub-places under a section, by the name the app shows: the browser in Altri programmi. */
const UNDER: Record<string, readonly string[]> = { 'Altri programmi': ['Browser'] };
/** The tabs of the settings in English (docs/i18n.md glossary). */
const ENGLISH_TABS = new Set(['General', 'Squad', 'Models', 'Permissions', 'Connections']);

describe('the places of the app in the texts (D-133)', () => {
  afterEach(() => setAppLang('en'));

  it('every "Impostazioni → …" written in the code is a tab and a section of the app', () => {
    // The Italian places written by hand are checked against the Italian names of the app.
    setAppLang('it');
    const tabs = new Set<string>(Object.values(SETTINGS_TABS));
    const wrong: string[] = [];
    let seen = 0;
    for (const file of SOURCES.flatMap(files)) {
      for (const { line, at } of codeLines(file)) {
        for (const m of line.matchAll(/Impostazioni((?: → [^.,;:()«»"'`$\n]+)+)/g)) {
          seen++;
          const steps = m[1]!
            .split(' → ')
            .slice(1)
            .map((s) => s.trim());
          const [tab, section, under] = steps;
          const sections = Object.values(SETTINGS_SECTIONS)
            .filter((s) => SETTINGS_TABS[s.tab] === tab)
            .map((s) => s.label as string);
          if (!tabs.has(tab!)) wrong.push(`${at}: «${tab}» is not a tab`);
          else if (section !== undefined && !sections.includes(section)) {
            wrong.push(`${at}: «${section}» is not a section of ${tab}`);
          } else if (under !== undefined && !(UNDER[section!] ?? []).includes(under)) {
            wrong.push(`${at}: «${under}» is not under ${section}`);
          }
        }
        // The English names of the settings are not the app's (B2 of the review of 19/10), except
        // in the English dictionaries (`*.strings.ts`, D-153), where the tab is one of the glossary's.
        const english = /Settings((?: → [^.,;:()«»"'`$\n]+)+)/.exec(line);
        if (english && file.endsWith('.strings.ts')) {
          const tab = english[1]!.split(' → ')[1]?.trim();
          if (!ENGLISH_TABS.has(tab ?? '')) wrong.push(`${at}: «${tab}» is not an English tab`);
        } else if (/Settings → |\(External tools\)/.test(line)) wrong.push(`${at}: English place`);
      }
    }
    expect(seen).toBeGreaterThan(10);
    expect(wrong).toEqual([]);
  });

  it('the helpers write the places as the app shows them, in the language in use', () => {
    setAppLang('it');
    expect(settingsPath('collegamenti')).toBe('Impostazioni → Collegamenti');
    expect(settingsPath('altriProgrammi')).toBe('Impostazioni → Collegamenti → Altri programmi');
    expect(settingsPath('altriProgrammi', 'Browser')).toBe(
      'Impostazioni → Collegamenti → Altri programmi → Browser',
    );
    expect(settingsPath('ilWeb')).toBe('Impostazioni → Permessi → Il web');
    expect(settingsPath('abbonamenti')).toBe('Impostazioni → Modelli → Un abbonamento che hai già');
    expect(projectPagePath('Saturday', 'spesa')).toBe(
      'pagina del progetto «Saturday», scheda Spesa',
    );
    // A project's cap is raised on its page, the others in Modelli (§2.3 of the review).
    expect(spendCapPath('Saturday')).toBe('pagina del progetto «Saturday», scheda Spesa');
    expect(spendCapPath()).toBe('Impostazioni → Modelli → Tetto di spesa');

    setAppLang('en');
    expect(settingsPath('collegamenti')).toBe('Settings → Connections');
    expect(settingsPath('altriProgrammi')).toBe('Settings → Connections → Other apps');
    expect(settingsPath('altriProgrammi', 'Browser')).toBe(
      'Settings → Connections → Other apps → Browser',
    );
    expect(settingsPath('ilWeb')).toBe('Settings → Permissions → The web');
    expect(settingsPath('abbonamenti')).toBe('Settings → Models → A subscription you already have');
    expect(projectPagePath('Saturday', 'spesa')).toBe('“Saturday” project page, Spending tab');
    expect(spendCapPath('Saturday')).toBe('“Saturday” project page, Spending tab');
    expect(spendCapPath()).toBe('Settings → Models → Spending cap');
  });
});
