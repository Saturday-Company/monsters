import { MEMORY_TAINT_MARK, type VaultNote } from '@monsters/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkedMemoryLines } from '../src/components/vault/NoteReader.tsx';

/*
 * Review of the waves 3 and 4, memory: the lines of a monster's memory written after
 * third-party text show in its note with «È mia», which takes the mark away.
 */

const note = (path: string, content: string) =>
  ({ path, title: 'Memoria di Rhea', content, frontmatter: {}, hash: 'h' }) as unknown as VaultNote;

const agents = [{ id: 'rhea', name: 'Rhea' }];

describe('the marked lines of a memory', () => {
  it('each with «È mia», without the mark', () => {
    const html = renderToStaticMarkup(
      createElement(MarkedMemoryLines, {
        note: note(
          'Agenti/Rhea/MEMORY.md',
          `# Memoria di Rhea\n\n- Giulio preferisce i rapporti brevi\n- La NASA ha la pagina più aggiornata ${MEMORY_TAINT_MARK}`,
        ),
        agents,
        onChanged: () => {},
      }),
    );
    expect(html).toContain('data-testid="memory-marked"');
    expect(html).toContain('La NASA ha la pagina più aggiornata');
    expect(html).toContain('È mia');
    expect(html).toContain('aria-label="È mia: La NASA ha la pagina più aggiornata"');
    expect(html).not.toContain(MEMORY_TAINT_MARK);
    expect(html).not.toContain('rapporti brevi');
  });

  it('nothing for a memory without marks, or for another note', () => {
    const plain = note('Agenti/Rhea/MEMORY.md', '# Memoria\n\n- Una riga sua');
    expect(
      renderToStaticMarkup(
        createElement(MarkedMemoryLines, { note: plain, agents, onChanged: () => {} }),
      ),
    ).toBe('');
    const other = note('Inbox/Pagina.md', `- Una riga ${MEMORY_TAINT_MARK}`);
    expect(
      renderToStaticMarkup(
        createElement(MarkedMemoryLines, { note: other, agents, onChanged: () => {} }),
      ),
    ).toBe('');
  });
});
