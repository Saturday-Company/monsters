import { setAppLang, type LogEvent, type VaultNoteSummary } from '@monsters/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { actionLabel, hunkText, splitDiff } from '../src/components/vault/NoteHistory.tsx';
import { folderProblem, titleProblem } from '../src/components/vault/NewNote.tsx';
import { filterNotes, folderLabel, groupByFolder } from '../src/components/vault/NoteList.tsx';
import {
  cleanSnippet,
  isAgentNote,
  lastVaultChange,
  previewText,
  stampDate,
} from '../src/components/vault/shared.tsx';
import { contrastRatio, DOT_SCREEN } from '@monsters/monster-kit';
import { SCREEN_DIFF } from '../src/theme/vault.ts';
import { VaultMarkdown } from '../src/components/vault/VaultMarkdown.tsx';
import { MockVault } from '../src/lib/mock/vault.ts';
import { vaultPath } from '../src/lib/router.ts';
import {
  isAttachment,
  linkIndex,
  prepareNoteMarkdown,
  propertyText,
  safeNoteUrl,
  withoutTitle,
} from '../src/lib/vault-markdown.ts';

/* Vault view (M2.8): note Markdown, links, list helpers and the mock vault. */

const resolve = linkIndex([
  'Risorse/Lisbona.md',
  'Risorse/Tram 28.md',
  'Persone/Sara.md',
  'Archivio/Sara.md',
]);
const render = (text: string) =>
  renderToStaticMarkup(createElement(VaultMarkdown, { text, resolve, onTag: () => {} }));

describe('note Markdown', () => {
  it('turns embeds, wikilinks and tags into links of their own', () => {
    expect(prepareNoteMarkdown('![[Tram 28]] e [[Lisbona|la città]] #viaggi/lisbona')).toBe(
      '[Tram 28](<vault-embed:Tram 28>) e [la città](<nota:Lisbona>) [#viaggi/lisbona](<vault-tag:viaggi/lisbona>)',
    );
  });

  it('leaves headings, numbers, URLs and code alone', () => {
    const md = '# Titolo\n\nIl #1 è qui: https://x.org/#ancora e `#codice`\n\n```\n#nontag\n```';
    expect(prepareNoteMarkdown(md)).toBe(md);
  });

  it('keeps only safe links', () => {
    expect(safeNoteUrl('https://example.org')).toBe('https://example.org');
    expect(safeNoteUrl('vault-embed:Nota')).toBe('vault-embed:Nota');
    expect(safeNoteUrl('vault-tag:viaggi')).toBe('vault-tag:viaggi');
    expect(safeNoteUrl('nota:Nota')).toBe('nota:Nota');
    expect(safeNoteUrl('javascript:alert(1)')).toBe('');
    expect(safeNoteUrl('data:text/html,x')).toBe('');
    expect(safeNoteUrl('//evil.example')).toBe('');
  });

  it('resolves links by path and by name (the first note with that name)', () => {
    expect(resolve('Lisbona')).toBe('Risorse/Lisbona.md');
    expect(resolve('risorse/tram 28')).toBe('Risorse/Tram 28.md');
    expect(resolve('Lisbona#Dove mangiare')).toBe('Risorse/Lisbona.md');
    expect(resolve('Archivio/Sara')).toBe('Archivio/Sara.md');
    expect(resolve('Sara')).toBe('Persone/Sara.md');
    expect(resolve('Nessuna')).toBeNull();
  });

  it('renders no raw HTML, drops bad links, marks missing notes', () => {
    const html = render(
      'Ciao <script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1)) [[Nessuna]] [[Lisbona]]',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('data-testid="vault-link-missing"');
    expect(html).toContain(`href="${vaultPath('Risorse/Lisbona.md')}"`);
  });

  it('renders embeds as cards, attachments as labels, tags as buttons', () => {
    const html = render('![[Tram 28]]\n\n![[Allegati/foto.png]]\n\n#viaggi');
    expect(html).toContain('Embedded note: </span>Tram 28');
    expect(html).toContain('Attachment: foto.png');
    expect(html).toMatch(/<button[^>]*class="vault-tag"[^>]*>#viaggi<\/button>/);
    expect(isAttachment('Allegati/x.PDF')).toBe(true);
    expect(isAttachment('Nota.md')).toBe(false);
  });

  it('drops a first heading equal to the title, and shows properties as text', () => {
    expect(withoutTitle('# Lisbona\n\nTesto', 'Lisbona')).toBe('Testo');
    expect(withoutTitle('# Altro\n\nTesto', 'Lisbona')).toBe('# Altro\n\nTesto');
    expect(propertyText(['a', 2, true])).toBe('a, 2, true');
    expect(propertyText({ a: 1 })).toBe('{"a":1}');
    expect(propertyText(null)).toBe('');
  });

  it('builds vault links in the hash route', () => {
    expect(vaultPath('Risorse/Lisbona, spunti.md')).toBe(
      '#/note?nota=Risorse%2FLisbona%2C%20spunti.md',
    );
    expect(vaultPath(null, 'cestino')).toBe('#/note?vista=cestino');
    expect(vaultPath(null)).toBe('#/note');
  });
});

describe('list helpers', () => {
  const note = (path: string, tags: string[] = []): VaultNoteSummary => ({
    path,
    title: path.split('/').pop()!.replace(/\.md$/, ''),
    type: null,
    author: null,
    updated: '2026-10-14T10:00:00',
    private: false,
    tags,
  });
  const notes = [
    note('LEGGIMI.md'),
    note('Risorse/B.md', ['viaggi/lisbona']),
    note('Risorse/A.md', ['cibo']),
    note('Aree/Salute/Corsa.md'),
  ];

  it('filters by folder and by tag (with sub-tags)', () => {
    expect(filterNotes(notes, { folder: 'Risorse', tags: [] }).map((n) => n.path)).toEqual([
      'Risorse/B.md',
      'Risorse/A.md',
    ]);
    expect(filterNotes(notes, { folder: '', tags: ['viaggi'] }).map((n) => n.path)).toEqual([
      'Risorse/B.md',
    ]);
    expect(filterNotes(notes, { folder: 'Aree', tags: [] })).toHaveLength(1);
  });

  it('hides the monsters’ own notes unless asked for', () => {
    const withAgents = [...notes, note('Agenti/Rhea/MEMORY.md')];
    expect(isAgentNote('Agenti/Rhea/MEMORY.md')).toBe(true);
    expect(isAgentNote('Risorse/Agenti segreti.md')).toBe(false);
    expect(filterNotes(withAgents, { folder: '', tags: [] })).toHaveLength(4);
    expect(filterNotes(withAgents, { folder: '', tags: [], agents: true })).toHaveLength(5);
  });

  it('previews without Markdown marks; snippets keep the marks of the match', () => {
    expect(
      previewText(
        '## Spunti\n- [ ] Giro sul [[Tram 28|tram]] e **pastéis** in [Belém](https://x.org)',
      ),
    ).toBe('Spunti Giro sul tram e pastéis in Belém');
    expect(previewText(null)).toBe('');
    expect(previewText('1. Giro sul [[Tram 28]] presto. 2. Pastéis - [ ] volo')).toBe(
      'Giro sul Tram 28 presto. Pastéis volo',
    );
    expect(cleanSnippet('…# Spunti su **Lisbona** e [[Tram 28]] - [ ] volo')).toBe(
      '…Spunti su **Lisbona** e Tram 28 volo',
    );
    expect(folderLabel('Aree/Salute')).toBe('Aree › Salute');
    expect(folderLabel('')).toBe('Main folder');
  });

  it('checks the name of a new note and of a new folder', () => {
    expect(titleProblem('Porto')).toBeNull();
    expect(titleProblem('Porto: idee')).toMatch(/can’t contain/);
    expect(folderProblem('Viaggi/Portogallo')).toBeNull();
    expect(folderProblem('')).toMatch(/Type the folder/);
    expect(folderProblem('Viaggi?')).toMatch(/can’t contain/);
    expect(folderProblem('.nascosta')).toMatch(/isn’t valid/);
    expect(folderProblem('Agenti/Io')).toMatch(/belongs to the monsters/);
  });

  it('groups by folder, root first, notes by title', () => {
    expect(groupByFolder(notes).map((g) => [g.folder, g.notes.map((n) => n.title)])).toEqual([
      ['', ['LEGGIMI']],
      ['Aree/Salute', ['Corsa']],
      ['Risorse', ['A', 'B']],
    ]);
  });

  it('names the history entries in words', () => {
    expect(actionLabel('vault_edit: Risorse/x.md [agent=rhea action=1]')).toBe('Edited');
    expect(actionLabel('vault_undo: x.md')).toBe('Change undone');
    expect(actionLabel('snapshot: modifiche esterne')).toBe('Edited outside Monsters');
  });

  it('says it in Italian when the app does', () => {
    setAppLang('it');
    try {
      expect(actionLabel('vault_edit: Risorse/x.md [agent=rhea action=1]')).toBe('Modificata');
      expect(actionLabel('vault_undo: x.md')).toBe('Modifica annullata');
      expect(folderLabel('')).toBe('Cartella principale');
      expect(titleProblem('Porto: idee')).toMatch(/non può contenere/);
      expect(folderProblem('')).toMatch(/Scrivi/);
      expect(hunkText('@@ riga 4 @@')).toBe('· riga 4 ·');
    } finally {
      setAppLang('en');
    }
  });

  it('finds the newest vault change among the last events', () => {
    const ev = (id: string, type: string) => ({ id, type }) as unknown as LogEvent;
    expect(lastVaultChange({ events: [] })).toBeNull();
    expect(
      lastVaultChange({
        events: [
          ev('1', 'vault_change'),
          ev('2', 'message'),
          ev('3', 'vault_change'),
          ev('4', 'run'),
        ],
      }),
    ).toBe('3');
  });
});

describe('mock vault', () => {
  const make = () => {
    const logged: unknown[] = [];
    const vault = new MockVault({
      mode: 'demo',
      log: (e) => {
        logged.push(e);
        return e as unknown as LogEvent;
      },
    });
    const call = (method: string, url: string, body?: unknown) => {
      const u = new URL(url, 'http://mock.local');
      return vault.handle(method, u.pathname, u.searchParams, body)!;
    };
    return { vault, call, logged };
  };

  it('refuses paths outside the vault like the core', () => {
    const { call } = make();
    expect(call('GET', '/api/vault/note?path=../segreti').status).toBe(400);
    expect(call('GET', '/api/vault/note?path=.git/config').status).toBe(403);
    expect(call('POST', '/api/vault/delete', { path: '../x' }).status).toBe(400);
  });

  it('trashes and restores a note, logged as the user', () => {
    const { call, logged } = make();
    expect(call('POST', '/api/vault/delete', { path: 'People/Sara.md' }).status).toBe(200);
    const trash = call('GET', '/api/vault/trash').body as { items: { originalPath: string }[] };
    expect(trash.items.map((i) => i.originalPath)).toContain('People/Sara.md');
    expect(call('POST', '/api/vault/restore', { path: 'People/Sara.md' }).status).toBe(200);
    expect(call('GET', '/api/vault/note?path=Sara').status).toBe(200);
    expect(logged).toHaveLength(2);
  });

  it('undoes an action, refusing one with later changes unless forced', () => {
    const { vault } = make();
    expect(vault.undo('act_seed_ideas', false)?.status).toBe(409);
    expect(vault.undo('act_seed_ideas', true)?.status).toBe(200);
    expect(vault.undo('act_seed_ideas', true)?.status).toBe(400);
    expect(vault.undo('nope', false)).toBeNull();
  });

  it('refuses a save on a stale hash', () => {
    const { call } = make();
    const note = call('GET', '/api/vault/note?path=Running').body as { path: string; hash: string };
    const ok = call('PUT', '/api/vault/note', {
      path: note.path,
      content: 'nuovo',
      baseHash: note.hash,
    });
    expect(ok.status).toBe(200);
    const stale = call('PUT', '/api/vault/note', {
      path: note.path,
      content: 'ancora',
      baseHash: note.hash,
    });
    expect(stale.status).toBe(409);
  });
});

describe('instrument details', () => {
  it('stamps a note in Martian Mono order: day, month, year, time', () => {
    expect(stampDate('2026-10-05T09:07:00')).toBe('05.10.2026 · 09:07');
    expect(stampDate(null)).toBe('');
    expect(stampDate('non è una data')).toBe('');
  });

  it('keeps the diff lines readable on the black screen (≥ 4.5:1 on their band)', () => {
    const over = (rgba: string): string => {
      const [r, g, b, a] = rgba.match(/[\d.]+/g)!.map(Number) as [number, number, number, number];
      const base = Number.parseInt(DOT_SCREEN.slice(1), 16);
      const mix = (c: number, shift: number) =>
        Math.round(c * a + ((base >> shift) & 255) * (1 - a));
      return `#${[mix(r, 16), mix(g, 8), mix(b, 0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    };
    expect(contrastRatio(SCREEN_DIFF.addFg, over(SCREEN_DIFF.addBg))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(SCREEN_DIFF.delFg, over(SCREEN_DIFF.delBg))).toBeGreaterThanOrEqual(4.5);
  });

  it('draws [[links]] as plain underlined text, without the chat pill icon', () => {
    const html = render('Vedi [[Lisbona]].');
    expect(html).toContain('class="md-note"');
    expect(html).not.toContain('<svg');
  });
});

describe('the changes of a version, for people (audit UI-24)', () => {
  it('reads the hunk headers as lines, the bare one of the core as a pause', () => {
    expect(hunkText('@@ riga 4 @@')).toBe('· line 4 ·');
    expect(hunkText('@@ -1,3 +7,5 @@')).toBe('· line 7 ·');
    expect(hunkText('@@')).toBe('· · ·');
    expect(hunkText('+@@ non è un blocco')).toBeNull();
  });

  it('folds the properties at the top of the note, keeps the text', () => {
    const diff = [
      '@@ riga 1 @@',
      '+---',
      '+author: rhea',
      '+sources: 3',
      '+---',
      '+# Lisbona',
      '+Giro sul tram.',
    ].join('\n');
    const { body, meta } = splitDiff(diff);
    expect(body).toEqual(['+# Lisbona', '+Giro sul tram.']);
    expect(meta).toEqual(['@@ riga 1 @@', '+---', '+author: rhea', '+sources: 3', '+---']);
  });

  it('a change further down, or a note without properties, stays all text', () => {
    expect(splitDiff('@@ riga 9 @@\n-vecchio\n+nuovo').meta).toEqual([]);
    expect(splitDiff('-# Titolo\n+# Titolo nuovo').body).toEqual(['-# Titolo', '+# Titolo nuovo']);
    // The core's diff from the top of the file: no header, the properties first.
    expect(splitDiff(' ---\n-tags: [a]\n+tags: [a, b]\n ---\n # Nota').body).toEqual([' # Nota']);
  });
});
