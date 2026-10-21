import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  findSettingsPlaces,
  projectPagePath,
  SETTINGS_SECTIONS,
  SETTINGS_TABS,
  setAppLang,
  settingsPath,
  spendCapPath,
  type Lang,
} from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';

/*
 * Every place of the app a monster or a message names is a real one (D-133). The texts built
 * with `settingsPath`/`projectPagePath` are right by construction (the web app's test checks
 * the screens render the same constants); this test reads the sources for the paths still
 * written by hand, in either language, and checks each step against the constants: the review
 * of 19/10 found «Settings (External tools)», «Impostazioni → Permessi → Altri programmi» and
 * «Settings → Collegamenti → "Collega"» given to models.
 */

const PACKAGES = join(import.meta.dirname, '..', '..');
const SOURCES = ['core', 'tools', 'providers', 'vault'].map((p) => join(PACKAGES, p, 'src'));

afterEach(() => setAppLang('en'));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Lines of code (comments say what they like: "Settings → Squad" of a JSDoc is fine). */
function codeLines(path: string): { line: string; at: string }[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line, i) => ({ line, at: `${path.slice(PACKAGES.length + 1)}:${i + 1}` }))
    .filter(({ line }) => !/^\s*(\*|\/\/|\/\*)/.test(line));
}

/** The names of the app in one language. */
function namesIn(lang: Lang) {
  setAppLang(lang);
  return {
    root: settingsPath('squadra').split(' → ')[0]!,
    tabs: new Set<string>(Object.values(SETTINGS_TABS)),
    sections: Object.values(SETTINGS_SECTIONS).map((s) => ({
      tab: SETTINGS_TABS[s.tab],
      label: s.label,
    })),
    // Sub-places under a section, by the name the app shows: the browser in "Other apps".
    under: { [SETTINGS_SECTIONS.altriProgrammi.label]: ['Browser'] } as Record<string, string[]>,
  };
}

describe('the places of the app in the texts (D-133)', () => {
  it('every "Settings → …" written in the code is a tab and a section of the app, in its language', () => {
    const names = { en: namesIn('en'), it: namesIn('it') };
    const wrong: string[] = [];
    let seen = 0;
    for (const file of SOURCES.flatMap(files)) {
      for (const { line, at } of codeLines(file)) {
        for (const lang of ['en', 'it'] as const) {
          const n = names[lang];
          for (const m of line.matchAll(
            new RegExp(`${n.root}((?: → [^.,;:()«»"'\`$\\n“”]+)+)`, 'g'),
          )) {
            seen++;
            const steps = m[1]!
              .split(' → ')
              .slice(1)
              .map((s) => s.trim());
            const [tab, section, under] = steps;
            const sections = n.sections.filter((s) => s.tab === tab).map((s) => s.label);
            if (!n.tabs.has(tab!)) wrong.push(`${at}: «${tab}» is not a tab`);
            else if (section !== undefined && !sections.includes(section)) {
              wrong.push(`${at}: «${section}» is not a section of ${tab}`);
            } else if (under !== undefined && !(n.under[section!] ?? []).includes(under)) {
              wrong.push(`${at}: «${under}» is not under ${section}`);
            }
          }
        }
        // The English names of the settings used in an Italian text are not the app's (B2 of the review of 19/10).
        if (
          /Settings \(External tools\)|Settings → [^'"`]*(Collegamenti|Permessi|Modelli)/.test(line)
        ) {
          wrong.push(`${at}: mixed languages in a place`);
        }
      }
    }
    expect(seen).toBeGreaterThan(5);
    expect(wrong).toEqual([]);
  });

  it('the helpers write the places as the app shows them, in the language in use', () => {
    expect(settingsPath('collegamenti')).toBe('Settings → Connections');
    expect(settingsPath('altriProgrammi')).toBe('Settings → Connections → Other apps');
    expect(settingsPath('altriProgrammi', 'Browser')).toBe(
      'Settings → Connections → Other apps → Browser',
    );
    expect(settingsPath('ilWeb')).toBe('Settings → Permissions → The web');
    expect(settingsPath('abbonamenti')).toBe('Settings → Models → A subscription you already have');
    expect(projectPagePath('Saturday', 'spesa')).toBe('“Saturday” project page, Spending tab');
    // A project's cap is raised on its page, the others in Models (§2.3 of the review).
    expect(spendCapPath('Saturday')).toBe('“Saturday” project page, Spending tab');
    expect(spendCapPath()).toBe('Settings → Models → Spending cap');

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
    expect(spendCapPath('Saturday')).toBe('pagina del progetto «Saturday», scheda Spesa');
    expect(spendCapPath()).toBe('Impostazioni → Modelli → Tetto di spesa');
  });

  it('finds the places in texts written in either language, whatever the language is now', () => {
    const it = 'Collegalo in Impostazioni → Modelli o in Impostazioni → Permessi.';
    const en = 'Connect it in Settings → Models, or in Settings → Connections.';
    expect(findSettingsPlaces(it).map((p) => [p.text, p.tab])).toEqual([
      ['Impostazioni → Modelli', 'modelli'],
      ['Impostazioni → Permessi', 'permessi'],
    ]);
    expect(findSettingsPlaces(en).map((p) => [p.text, p.tab])).toEqual([
      ['Settings → Models', 'modelli'],
      ['Settings → Connections', 'collegamenti'],
    ]);
    setAppLang('it');
    expect(findSettingsPlaces(en)).toHaveLength(2);
    expect(findSettingsPlaces('in Impostazioni → Aspetto')[0]!.tab).toBe('aspetto');
  });
});
