import { setAppLang } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { formStrings } from '../src/components/projects/form.strings.ts';
import { sectionsStrings } from '../src/components/projects/sections.strings.ts';

/*
 * The words of a project's first layer (C5 of the usability plan): descriptions of at most about
 * 140 characters (the rest in "Details"), "All monsters" for the top of the cap chain, and the
 * instructions file named by what it is (its file name only in Details or in small mono).
 */

const MAX = 140;

function firstLayer() {
  const f = formStrings();
  const s = sectionsStrings();
  return {
    'form intro': f.intro,
    'form more options': f.more.description,
    'form folder': f.folder.description,
    'form lead': f.lead.description,
    'form first monsters': f.first.description,
    'form apps': f.links.description,
    folder: s.folder.description,
    web: s.links.webDescription,
    'who cannot search': s.links.blocked.description,
    apps: s.links.description,
    spending: s.spend.description,
    'spending per monster': s.spend.perMonsterDescription,
    automations: s.automations.empty,
  };
}

describe.each(['en', 'it'] as const)('project words in %s', (lang) => {
  const run = (check: () => void) => {
    setAppLang(lang);
    try {
      check();
    } finally {
      setAppLang('en');
    }
  };

  it(`keeps every first-layer description to ${MAX} characters`, () => {
    run(() => {
      for (const [where, text] of Object.entries(firstLayer())) {
        expect(text.length, where).toBeLessThanOrEqual(MAX);
      }
    });
  });

  it('keeps the long part of the folder in Details, where its file names may stay', () => {
    run(() => {
      const s = sectionsStrings().folder;
      expect(s.details.length).toBeGreaterThan(MAX);
      expect(s.details).toContain('CLAUDE.md');
      // First layer: no file names, no "terminal".
      for (const [where, text] of Object.entries(firstLayer())) {
        expect(text, where).not.toMatch(/CLAUDE\.md|AGENTS\.md|terminal/i);
      }
      expect(s.docsChangedLead).not.toMatch(/CLAUDE\.md|AGENTS\.md/);
    });
  });

  it('says "All monsters", never "whole squad", and "plan" for a Claude subscription', () => {
    run(() => {
      const s = sectionsStrings();
      const all = lang === 'en' ? 'All monsters' : 'Tutti i mostri';
      expect(s.spend.team).toBe(all);
      // Every text, the functions called with a sample.
      const flat = (v: unknown): string[] =>
        typeof v === 'string'
          ? [v]
          : typeof v === 'function'
            ? flat((v as (...args: unknown[]) => unknown)(1, 1, true))
            : v && typeof v === 'object'
              ? Object.values(v).flatMap(flat)
              : [];
      const everything = [...flat(s), ...flat(formStrings())].join('\n');
      expect(everything).not.toMatch(/whole squad|tutta la squadra|subscription|abbonamento/i);
    });
  });
});
