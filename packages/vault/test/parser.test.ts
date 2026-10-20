import { describe, expect, it } from 'vitest';
import {
  applyOps,
  findSection,
  lineDiff,
  parseNote,
  readFrontmatter,
  scanMarkdown,
  updateFrontmatter,
} from '../src/index.ts';

describe('links', () => {
  it('extracts wikilinks with alias, heading, block and embeds', () => {
    const text = [
      'Vedi [[Marco Rossi]] e [[Progetti/Monsters|il progetto]].',
      'Sezione: [[Budget#Q4]], blocco: [[Budget#^abc-1]], breve: [[Budget^xyz]].',
      'Immagine: ![[logo.png|300]] e nota inclusa ![[Riassunto]].',
      'Self: [[#Titolo]]. Tabella: [[Persone/Anna\\|Anna]].',
    ].join('\n');
    const links = parseNote('Nota.md', text).links;
    expect(links.map((l) => [l.target, l.heading, l.block, l.alias, l.embed])).toEqual([
      ['Marco Rossi', null, null, null, false],
      ['Progetti/Monsters', null, null, 'il progetto', false],
      ['Budget', 'Q4', null, null, false],
      ['Budget', null, 'abc-1', null, false],
      ['Budget', null, 'xyz', null, false],
      ['logo.png', null, null, '300', true],
      ['Riassunto', null, null, null, true],
      ['', 'Titolo', null, null, false],
      ['Persone/Anna', null, null, 'Anna', false],
    ]);
    const first = links[0]!;
    expect(text.slice(first.targetStart, first.targetEnd)).toBe('Marco Rossi');
    const table = links[8]!;
    expect(text.slice(table.targetStart, table.targetEnd)).toBe('Persone/Anna');
  });

  it('extracts Markdown links to notes, not URLs', () => {
    const text =
      'Leggi [la nota](Risorse/Guida%20rapida.md#Inizio) e [sito](https://x.it) e [rel](../A.md).';
    const links = parseNote('Cartella/Nota.md', text).links;
    expect(links.map((l) => [l.kind, l.target, l.heading])).toEqual([
      ['markdown', 'Risorse/Guida rapida.md', 'Inizio'],
      ['markdown', '../A.md', null],
    ]);
    expect(text.slice(links[0]!.targetStart, links[0]!.targetEnd)).toBe(
      'Risorse/Guida%20rapida.md',
    );
  });

  it('ignores links and tags inside code, comments and inline code', () => {
    const text = [
      '# Titolo',
      'Testo con [[Vero]] e #vero.',
      '```js',
      'const x = "[[Falso]] #falso";',
      '```',
      '~~~',
      '[[AncheFalso]]',
      '~~~',
      'Inline `[[NoInline]] #noinline` e ``doppio ` [[No]]``.',
      '<!-- [[Commento]] #commento -->',
      '%% [[Obsidian]] %%',
      'Dopo [[Ultimo]].',
    ].join('\n');
    const note = parseNote('A.md', text);
    expect(note.links.map((l) => l.target)).toEqual(['Vero', 'Ultimo']);
    expect(note.tags).toEqual(['vero']);
  });

  it('treats an unclosed fence as code until the end', () => {
    const note = parseNote('A.md', 'Prima [[Si]]\n```\n[[No]]\n');
    expect(note.links.map((l) => l.target)).toEqual(['Si']);
  });

  it('reads links written in frontmatter properties', () => {
    const note = parseNote('A.md', '---\nrel: "[[Marco]]"\n---\nCorpo [[B]]\n');
    expect(note.links.map((l) => [l.target, l.inProperty])).toEqual([
      ['Marco', true],
      ['B', false],
    ]);
  });
});

describe('tags and aliases', () => {
  it('merges frontmatter and inline tags, lowercase and hierarchical', () => {
    const text = [
      '---',
      'tags: [Progetto/Monsters, "#ai"]',
      'aliases: Mostri, Monsters app',
      '---',
      '# Titolo',
      'Testo #Area/Salute e #2026 (solo numeri, no) e email a#b.it e url http://x.it/#frammento.',
      '[[Nota#Sezione]] non è un tag.',
    ].join('\n');
    const note = parseNote('A.md', text);
    expect(note.tags.sort()).toEqual(['ai', 'area/salute', 'progetto/monsters']);
    expect(note.aliases).toEqual(['Mostri', 'Monsters app']);
  });

  it('accepts tags as a list or a string', () => {
    expect(parseNote('A.md', '---\ntags:\n  - uno\n  - due\n---\n').tags).toEqual(['uno', 'due']);
    expect(parseNote('A.md', '---\ntags: uno\n---\n').tags).toEqual(['uno']);
  });
});

describe('frontmatter round-trip', () => {
  const original = [
    '---',
    '# commento in testa',
    'title: Prova   # commento in linea',
    'tags: [a, b]',
    'nested:',
    '  key: value',
    'zeta: 1',
    '---',
    '# Corpo',
    '',
    'Testo invariato.',
    '',
  ].join('\n');

  it('keeps order, comments and the body when setting and removing properties', () => {
    const out = updateFrontmatter(original, {
      set: { status: 'done', zeta: 2 },
      remove: ['nested'],
    });
    expect(out).toContain('# commento in testa');
    expect(out).toContain('title: Prova # commento in linea');
    expect(out).toContain('tags: [ a, b ]');
    expect(out.indexOf('title')).toBeLessThan(out.indexOf('zeta: 2'));
    expect(out.indexOf('zeta: 2')).toBeLessThan(out.indexOf('status: done'));
    expect(out).not.toContain('nested');
    expect(out.endsWith('---\n# Corpo\n\nTesto invariato.\n')).toBe(true);
  });

  it('does not touch the frontmatter when nothing changes', () => {
    const out = updateFrontmatter(original, { setIfMissing: { title: 'Altro' }, set: { zeta: 1 } });
    expect(readFrontmatter(out).data.title).toBe('Prova');
    expect(out.split('---\n# Corpo')[1]).toBe(original.split('---\n# Corpo')[1]);
  });

  it('creates the block when missing and quotes links', () => {
    const out = updateFrontmatter('Solo testo\n', { set: { rel: '[[Marco]]' } });
    expect(out).toBe('---\nrel: "[[Marco]]"\n---\nSolo testo\n');
    expect(parseNote('A.md', out).links[0]?.target).toBe('Marco');
  });

  it('refuses to rewrite invalid YAML', () => {
    expect(() => updateFrontmatter('---\na: [1,\n---\n', { set: { b: 1 } })).toThrow(
      /not valid YAML/,
    );
    expect(parseNote('A.md', '---\na: [1,\n---\nx').frontmatterError).toBeDefined();
  });
});

describe('scan and sections', () => {
  it('finds headings outside code and section ranges', () => {
    const text = '# T\nintro\n## A\na1\n```\n## finto\n```\n### A1\nx\n## B\nb\n';
    const scan = scanMarkdown(text);
    expect(scan.headings.map((h) => `${h.level}:${h.text}`)).toEqual(['1:T', '2:A', '3:A1', '2:B']);
    const a = findSection(scan, '## a')!;
    expect(text.slice(a.contentStart, a.end)).toBe('a1\n```\n## finto\n```\n### A1\nx\n');
  });
});

describe('edit ops', () => {
  const note =
    '---\nid: X\n---\n# Titolo\n\nRiassunto.\n\n## Agenti\n- 10:00 uno\n\n## Note\nfine\n';

  it('applies str_replace, append to a section, prepend and replace_section', () => {
    const out = applyOps(note, [
      { str_replace: { old: 'Riassunto.', new: 'Riassunto nuovo.' } },
      { append: { text: '- 11:00 due', section: 'Agenti' } },
      { prepend: { text: '> in cima' } },
      { replace_section: { heading: 'Note', text: 'sostituito' } },
      { append: { text: 'nuova sezione', section: 'Extra' } },
      { set_props: { status: 'done' } },
    ]);
    expect(out).toBe(
      '---\nid: X\nstatus: done\n---\n# Titolo\n\n> in cima\n\nRiassunto nuovo.\n\n## Agenti\n- 10:00 uno\n- 11:00 due\n\n## Note\nsostituito\n\n## Extra\nnuova sezione\n',
    );
  });

  it('is all-or-nothing and requires a unique str_replace', () => {
    expect(() =>
      applyOps(note, [{ set_props: { a: 1 } }, { str_replace: { old: 'non esiste', new: 'x' } }]),
    ).toThrow(/op 2: str_replace: text not found/);
    expect(() => applyOps('a a', [{ str_replace: { old: 'a', new: 'b' } }])).toThrow(/2 times/);
    expect(() => applyOps(note, [{ set_props: { id: 'Y' } }])).toThrow(/managed by the system/);
  });

  it('diffs lines', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nB\nc\n')).toBe(' a\n-b\n+B\n c');
    expect(lineDiff('x', 'x')).toBe('');
  });
});
