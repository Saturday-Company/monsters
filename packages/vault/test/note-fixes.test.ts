import { describe, expect, it } from 'vitest';
import { fixAgentEditOps, fixAgentWrite, linkBareSources, linkText } from '../src/index.ts';

/* Bare URLs in the sources of a note (M2.0): Rhea wrote "[1] https://…" instead of [title](url). */

describe('linkBareSources', () => {
  const titles: Record<string, string> = {
    'https://it.wikipedia.org/wiki/Ribollita': 'Ribollita',
  };
  const titleOf = (url: string) => titles[url];

  it('turns source lines made of a bare URL into Markdown links', () => {
    const text = [
      '# Menu autunnale toscano',
      '',
      '## Fonti',
      '[1] https://it.wikipedia.org/wiki/Ribollita  ',
      '[2] https://it.wikipedia.org/wiki/Pappardelle_al_cinghiale',
      '- https://www.comune.impruneta.fi.it/storia/peposo.html',
      '1. Wikipedia: https://it.wikipedia.org/wiki/Castagnaccio.',
      '- **Fonte:** https://example.com/a1b2c3d4e5f6a7b8c9d0',
      '[^3]: <https://example.org/tortelli-di-zucca>',
    ].join('\n');
    const r = linkBareSources(text, titleOf);
    expect(r.fixed).toBe(6);
    expect(r.text.split('\n').slice(3)).toEqual([
      '[1] [Ribollita](https://it.wikipedia.org/wiki/Ribollita)  ',
      '[2] [Pappardelle al cinghiale (it.wikipedia.org)](https://it.wikipedia.org/wiki/Pappardelle_al_cinghiale)',
      '- [Peposo (comune.impruneta.fi.it)](https://www.comune.impruneta.fi.it/storia/peposo.html)',
      '1. Wikipedia: [Castagnaccio (it.wikipedia.org)](https://it.wikipedia.org/wiki/Castagnaccio).',
      '- **Fonte:** [example.com](https://example.com/a1b2c3d4e5f6a7b8c9d0)',
      '[^3]: [Tortelli di zucca (example.org)](https://example.org/tortelli-di-zucca)',
    ]);
  });

  it('turns a source cited at the end of a line ("Fonte: …") into a Markdown link', () => {
    const text = [
      '- **Ribollita**: piatto povero. Fonte: Wikipedia – Ribollita (https://it.wikipedia.org/wiki/Ribollita)',
      '- **Peposo**: dei fornacini. **Fonte:** https://it.wikipedia.org/wiki/Peposo.',
      'Castagnaccio. Fonti: Wikipedia – Castagnaccio (https://it.wikipedia.org/wiki/Castagnaccio) – consultato ieri; ' +
        'Gazzetta – Storia, origini (https://www.gazzetta.example/castagnaccio/), https://it.wikipedia.org/wiki/Peposo_(cucina).  ',
    ].join('\n');
    const r = linkBareSources(text, titleOf);
    expect(r.fixed).toBe(5);
    expect(r.text.split('\n')).toEqual([
      '- **Ribollita**: piatto povero. Fonte: [Wikipedia – Ribollita](https://it.wikipedia.org/wiki/Ribollita)',
      '- **Peposo**: dei fornacini. **Fonte:** [Peposo (it.wikipedia.org)](https://it.wikipedia.org/wiki/Peposo).',
      'Castagnaccio. Fonti: [Wikipedia – Castagnaccio](https://it.wikipedia.org/wiki/Castagnaccio) – consultato ieri; ' +
        '[Gazzetta – Storia, origini](https://www.gazzetta.example/castagnaccio/), ' +
        '[Peposo (cucina) (it.wikipedia.org)](https://it.wikipedia.org/wiki/Peposo_(cucina)).  ',
    ]);
    const done = 'Fonte: [Ribollita](https://it.wikipedia.org/wiki/Ribollita)';
    expect(linkBareSources(done)).toEqual({ text: done, fixed: 0 });
    const prose = 'Fonte: la nonna, che lo racconta su https://lapo.example/storia ogni domenica';
    expect(linkBareSources(prose)).toEqual({ text: prose, fixed: 0 });
    // A link closed by a bracket of another script keeps the bracket out of the address (D-073).
    expect(linkBareSources('Fonte: https://www.osteriafiore.it/menu】').text).toBe(
      'Fonte: [Menu (osteriafiore.it)](https://www.osteriafiore.it/menu)】',
    );
  });

  it('leaves prose, links, code, frontmatter and reference definitions alone', () => {
    const text = [
      '---',
      'source: https://example.com/front',
      '---',
      'La ribollita nasce nelle campagne https://example.com/prosa',
      'Prenota su https://lapo.example/menu e passa a trovarci',
      '- [Ribollita](https://it.wikipedia.org/wiki/Ribollita)',
      '- [[Menu autunnale]]',
      '```',
      'https://example.com/code',
      '```',
      '`https://example.com/inline`',
      '[1]: https://example.com/definition',
      '| Fonte | https://example.com/table |',
      'Vedi https://a.example/x, https://b.example/y',
    ].join('\n');
    expect(linkBareSources(text)).toEqual({ text, fixed: 0 });
  });

  it('keeps parentheses that belong to the URL and drops the ones that close the sentence', () => {
    expect(linkBareSources('- https://it.wikipedia.org/wiki/Peposo_(cucina)').text).toBe(
      '- [Peposo (cucina) (it.wikipedia.org)](https://it.wikipedia.org/wiki/Peposo_(cucina))',
    );
    expect(linkBareSources('- https://example.com/a(b').text).toBe(
      '- [example.com](<https://example.com/a(b>)',
    );
  });

  it('names a link by its known title, its readable path or its site', () => {
    expect(linkText('https://it.wikipedia.org/wiki/Ribollita', titleOf)).toBe('Ribollita');
    expect(linkText('https://x.example/p', () => '  Una [pagina]\n lunga ')).toBe(
      'Una pagina lunga',
    );
    expect(linkText('https://www.trattoria.example/')).toBe('trattoria.example');
    expect(linkText('https://news.example/2026/10/12345678')).toBe('news.example');
    expect(linkText('https://x.example/ricette/peposo%20all%27imprunetina')).toBe(
      "Peposo all'imprunetina (x.example)",
    );
  });

  it('is part of the corrections of vault_write and vault_edit, with the titles when given', () => {
    const write = fixAgentWrite(
      {
        path: 'Risorse/Ricerche/Ribollita',
        content: '## Fonti\n[1] https://it.wikipedia.org/wiki/Ribollita\n',
      },
      { titleOf },
    );
    expect(write.input.content).toBe(
      '## Fonti\n[1] [Ribollita](https://it.wikipedia.org/wiki/Ribollita)\n',
    );
    expect(write.corrected).toEqual([expect.stringContaining('1 bare link in the sources')]);

    const edit = fixAgentEditOps([{ append: { text: '- https://example.com/castagne' } }]);
    expect(edit.ops).toEqual([
      { append: { text: '- [Castagne (example.com)](https://example.com/castagne)' } },
    ]);
    expect(edit.corrected).toEqual([expect.stringContaining('1 bare link in the sources')]);
  });
});
