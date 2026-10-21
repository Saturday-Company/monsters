import { describe, expect, it } from 'vitest';
import {
  checkExternalLinks,
  checkWikilinks,
  detectLanguage,
  inventedDishesOf,
  isNaturalFileName,
} from '../eval/metrics.ts';

/* Heuristics of the behaviour eval (packages/core/eval): they must stay predictable. */

describe('eval metrics', () => {
  it('tells Italian from English prose, ignoring links and frontmatter', () => {
    const it_ =
      '---\ntitle: x\n---\n# Menu autunnale\nIl menu della trattoria cambia con la stagione: ci sono i funghi porcini, ' +
      'le castagne e il cinghiale, che sono i piatti più amati dai clienti per la loro storia. [Fonte](https://en.wikipedia.org/wiki/Chestnut)';
    const en =
      '# Autumn menu\nThe menu of the trattoria changes with the season: there are porcini mushrooms, chestnuts and ' +
      'wild boar, which are the most loved dishes for their history and the flavour of the region.';
    expect(detectLanguage(it_)).toBe('it');
    expect(detectLanguage(en)).toBe('en');
    expect(detectLanguage('Breve nota.')).toBe('short');
  });

  it('counts wikilinks to URLs and to missing notes as broken', () => {
    const notes = new Set(['profilo', 'risorse/ricerche/menu autunnale', 'menu autunnale']);
    const text =
      'Vedi [[profilo]], [[Menu autunnale|il menu]], [[Risorse/Ricerche/Menu autunnale#Fonti]], ' +
      '[[Wild boar|https://en.wikipedia.org/wiki/Wild_boar]] e [[Nota che non esiste]].';
    const r = checkWikilinks(text, notes);
    expect(r.total).toBe(5);
    expect(r.broken).toEqual([
      '[[Wild boar|https://en.wikipedia.org/wiki/Wild_boar]]',
      '[[Nota che non esiste]]',
    ]);
  });

  it('classifies external links by form', () => {
    const text =
      '[Castagna](https://it.wikipedia.org/wiki/Castagna), [[Boar|https://example.com/boar]], https://example.com/bare';
    expect(checkExternalLinks(text)).toEqual({ markdown: 1, wikilink: 1, bare: 1 });
  });

  it('accepts natural file names only', () => {
    expect(isNaturalFileName('Risorse/Ricerche/Menu autunnale toscano.md')).toBe(true);
    expect(isNaturalFileName('Inbox/Bozze/Post 1 - Castagnaccio.md')).toBe(true);
    expect(isNaturalFileName('Risorse/Ricerche/Autumn_Tuscan_Menu.md')).toBe(false);
    expect(isNaturalFileName('Inbox/Bozze/post-instagram-1.md')).toBe(false);
  });

  it('counts a dish nobody gave, not a gloss of a given one nor a word inside another', () => {
    const given = 'il menu: pappardelle al cinghiale, peposo, tortelli di zucca, castagnaccio';
    expect(inventedDishesOf('tortelli di zucca — pumpkin-filled ravioli', given)).toEqual([]);
    expect(inventedDishesOf('our tortelli di zucca, pillowy ravioli with pumpkin', given)).toEqual(
      [],
    );
    expect(inventedDishesOf('#toscanatradizionale #peposoallafiorentina', given)).toEqual([]);
    expect(inventedDishesOf('anche la bistecca e i pici, e #porcinitime', given)).toEqual([
      'porcin',
      'pici',
      'bistecca',
    ]);
    // Ravioli that gloss no given dish are a dish of their own.
    expect(inventedDishesOf('pumpkin ravioli', 'ribollita')).toEqual(['ravioli']);
  });
});
