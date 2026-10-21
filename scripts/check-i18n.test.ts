import { describe, expect, it } from 'vitest';
import { checkSource, readsItalian } from './check-i18n.ts';

describe('check-i18n (D-153)', () => {
  it('reads Italian from accents or two function words, not from English', () => {
    expect(readsItalian('Già fermi')).toBe(true);
    expect(readsItalian('Non trovo il file')).toBe(true);
    expect(readsItalian('Annulla')).toBe(false);
    expect(readsItalian('The monsters are working on it')).toBe(false);
    expect(readsItalian('a la carte')).toBe(false);
  });

  it('finds hand-written JSX text and visible attributes, allows names and symbols', () => {
    const src = [
      'export const A = () => (',
      '  <div title="Copy the path" data-id="x">',
      '    Hello',
      '    <span aria-label="Monsters">{name}</span>',
      '    · 3',
      '  </div>',
      ');',
    ].join('\n');
    const found = checkSource('apps/web/src/a.tsx', src);
    expect(found.map((f) => [f.rule, f.line])).toEqual([
      ['jsx-attr', 2],
      ['jsx-text', 3],
    ]);
  });

  it('finds Italian strings anywhere, skips imports and marked lines', () => {
    const src = [
      "import x from './non è un testo.ts';",
      "const a = 'Il lavoro si è fermato';",
      '// i18n-ignore: words of a regex',
      "const b = ['annulla', 'rifiuta', 'già'];",
      'const c = `Non trovo ${x} nella cartella`;',
    ].join('\n');
    const found = checkSource('packages/core/src/a.ts', src);
    expect(found.map((f) => f.line)).toEqual([2, 5]);
  });
});
