import type { LogEvent } from '@monsters/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { previewChat } from '../src/components/dock/follow.ts';
import { clampDockWidth, dockMaxWidth, dockMode } from '../src/components/dock/layout.ts';
import {
  downloadHref,
  fileIdOf,
  filesIn,
  formatBytes,
  rendererOf,
  textFlavor,
} from '../src/components/preview/files.ts';
import {
  commentMarks,
  csvSeparator,
  parseCsv,
  prettyJsonText,
  tokenizeLine,
} from '../src/components/preview/text.ts';
import { buildChat, chatThread, runOwners } from '../src/store/derive.ts';
import { MAX_ITEMS, usePreview } from '../src/store/preview.ts';

/* The right-hand pane (D-075): its store, its place in the window, what Anteprima reads. */

const reset = () =>
  usePreview.setState({ visible: false, tab: 'preview', items: [], active: 0, focusNonce: 0 });

describe('the store of the pane', () => {
  beforeEach(reset);

  it('opens an item once, focusing it when it is already there', () => {
    const s = usePreview.getState();
    s.open({ kind: 'file', fileId: 'a' });
    s.open({ kind: 'note', path: 'Idee.md' });
    s.open({ kind: 'file', fileId: 'a' });
    const now = usePreview.getState();
    expect(now.items).toHaveLength(2);
    expect(now.active).toBe(0);
    expect(now.visible).toBe(true);
    expect(now.tab).toBe('preview');
  });

  it('counts the opens that take the focus, not those of a monster', () => {
    const s = usePreview.getState();
    s.open({ kind: 'file', fileId: 'a' });
    s.open({ kind: 'file', fileId: 'b' }, { focus: false });
    expect(usePreview.getState().focusNonce).toBe(1);
    s.showTab('terminal', { focus: false });
    expect(usePreview.getState().focusNonce).toBe(1);
    s.toggle();
    expect(usePreview.getState().visible).toBe(false);
    s.toggle();
    expect(usePreview.getState().focusNonce).toBe(2);
  });

  it('closing items keeps the right one active, the last one hides Anteprima', () => {
    const s = usePreview.getState();
    for (const id of ['a', 'b', 'c']) s.open({ kind: 'file', fileId: id });
    s.select(2);
    s.closeItem(0);
    expect(usePreview.getState().items.map((i) => (i.kind === 'file' ? i.fileId : ''))).toEqual([
      'b',
      'c',
    ]);
    expect(usePreview.getState().active).toBe(1);
    s.closeItem(1);
    s.closeItem(0);
    expect(usePreview.getState().visible).toBe(false);
    // Out of range: nothing changes.
    s.closeItem(5);
    expect(usePreview.getState().items).toHaveLength(0);
  });

  it('the terminal tab stays open without items', () => {
    const s = usePreview.getState();
    s.open({ kind: 'file', fileId: 'a' });
    s.showTab('terminal');
    s.closeItem(0);
    expect(usePreview.getState().visible).toBe(true);
  });

  it('keeps the latest items only', () => {
    const s = usePreview.getState();
    for (let i = 0; i < MAX_ITEMS + 3; i++) s.open({ kind: 'file', fileId: `f${i}` });
    const { items, active } = usePreview.getState();
    expect(items).toHaveLength(MAX_ITEMS);
    expect(items[0]).toEqual({ kind: 'file', fileId: 'f3' });
    expect(active).toBe(MAX_ITEMS - 1);
  });
});

describe('where the pane sits', () => {
  it('phone, sheet, column', () => {
    expect(dockMode(390)).toBe('phone');
    expect(dockMode(900)).toBe('sheet');
    expect(dockMode(1100)).toBe('side');
  });

  it('the width stays between 380 and the room the window has', () => {
    expect(clampDockWidth(520, 1440)).toBe(520);
    expect(clampDockWidth(200, 1440)).toBe(380);
    // ~60% of the window, and the content keeps its minimum beside the sidebar.
    expect(dockMaxWidth(1440)).toBe(Math.min(864, 1440 - 300 - 400 - 24));
    expect(clampDockWidth(5000, 2400)).toBe(1440);
    expect(clampDockWidth(5000, 1100)).toBe(380);
    expect(clampDockWidth(700, 390)).toBe(390);
    expect(clampDockWidth(5000, 900)).toBe(900 - 24 - 120);
  });
});

describe('«Scarica» (review of 19/10, n. 13)', () => {
  it('is a link where the plain address works, a button where it needs a ticket', () => {
    // A browser's session: no address that a new tab or a copied link would open without its ticket.
    expect(downloadHref('F1', 'download', true)).toBeUndefined();
    expect(downloadHref('F1', 'content', true)).toBeUndefined();
  });
});

describe('files named in messages and tool results', () => {
  it('reads the id of the core’s file addresses only', () => {
    expect(fileIdOf('/api/files/01ABC/content')).toBe('01ABC');
    expect(fileIdOf('api/files/f-menu')).toBe('f-menu');
    expect(fileIdOf('/api/files/f-menu/content?x=1')).toBe('f-menu');
    expect(fileIdOf('/api/files/../vault/content')).toBeNull();
    expect(fileIdOf('/api/files/a%2Fb/content')).toBeNull();
    expect(fileIdOf('/api/vault/note')).toBeNull();
    expect(fileIdOf('https://evil.example/api/files/x/content')).toBeNull();
  });

  it('finds the files of a tool result (a screenshot)', () => {
    expect(filesIn({ fileId: 'shot1', saved: 'File/x.png' })).toEqual(['shot1']);
    expect(
      filesIn({ file: { id: 'f2' }, more: ['see /api/files/f3/content', { file_id: 'f2' }] }),
    ).toEqual(['f2', 'f3']);
    expect(filesIn('nothing here')).toEqual([]);
    expect(filesIn({ fileId: '../../etc' })).toEqual([]);
  });

  it('chooses the renderer and the text flavour', () => {
    const f = (kind: string, mime: string, name = 'x') =>
      rendererOf({ kind: kind as 'image', mime, name });
    expect(f('image', 'image/png')).toBe('image');
    expect(f('pdf', 'application/pdf')).toBe('pdf');
    expect(f('html', 'text/html')).toBe('html');
    expect(f('sheet', 'text/csv')).toBe('text');
    expect(
      f('document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('other');
    // An "image" that is not an image type is not drawn as one.
    expect(f('image', 'application/octet-stream')).toBe('other');
    expect(textFlavor({ name: 'a.json', mime: 'application/json' })).toBe('json');
    expect(textFlavor({ name: 'spese.csv', mime: 'text/csv' })).toBe('csv');
    expect(textFlavor({ name: 'x.py', mime: 'text/plain' })).toBe('code');
    expect(textFlavor({ name: 'note.txt', mime: 'text/plain' })).toBe('plain');
  });

  it('says sizes the Italian way', () => {
    expect(formatBytes(512)).toBe('512 byte');
    expect(formatBytes(48_213)).toBe('47 KB');
    expect(formatBytes(2_871)).toBe('2,8 KB');
    expect(formatBytes(18_400_000)).toBe('18 MB');
  });
});

describe('text of Anteprima', () => {
  it('colours strings, numbers, keywords and the comment at the end', () => {
    const t = tokenizeLine('const x = "a // b" + 42; // done', ['//']);
    expect(t.find((p) => p.kind === 'key')?.text).toBe('const');
    expect(t.find((p) => p.kind === 'str')?.text).toBe('"a // b"');
    expect(t.find((p) => p.kind === 'num')?.text).toBe('42');
    expect(t.at(-1)).toEqual({ text: '// done', kind: 'com' });
    expect(t.map((p) => p.text).join('')).toBe('const x = "a // b" + 42; // done');
  });

  it('a hash inside a word is not a comment', () => {
    expect(commentMarks('a.py')).toEqual(['#']);
    const t = tokenizeLine('url = "x" #nota', ['#']);
    expect(t.at(-1)?.kind).toBe('com');
    expect(tokenizeLine('color#fff', ['#']).some((p) => p.kind === 'com')).toBe(false);
  });

  it('CSV with semicolons and quotes', () => {
    const text = 'Data;Voce\n2026-10-01;"Fiori; rose"\n2026-10-02;"Detto ""ciao"""\n';
    expect(csvSeparator(text)).toBe(';');
    const { rows, more } = parseCsv(text);
    expect(rows).toEqual([
      ['Data', 'Voce'],
      ['2026-10-01', 'Fiori; rose'],
      ['2026-10-02', 'Detto "ciao"'],
    ]);
    expect(more).toBe(false);
    expect(parseCsv('a,b\n1,2\n3,4\n5,6\n', 2)).toEqual({
      rows: [
        ['a', 'b'],
        ['1', '2'],
      ],
      more: true,
    });
  });

  it('JSON made readable, or left as it is', () => {
    expect(prettyJsonText('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(prettyJsonText('{nope')).toBe('{nope');
  });
});

describe('what a monster shows', () => {
  const ev = (over: Partial<LogEvent> & Pick<LogEvent, 'id' | 'type' | 'data'>): LogEvent => ({
    ts: 1,
    agent: 'titan',
    runId: null,
    parentId: null,
    ...over,
  });

  it('belongs to the chat of the run’s owner, and to the monster that showed it', () => {
    const events = [
      ev({
        id: '01J00000000000000000000001',
        type: 'run',
        runId: 'r1',
        data: { status: 'started' },
      }),
      ev({
        id: '01J00000000000000000000002',
        agent: 'rhea',
        runId: 'r1',
        type: 'preview',
        data: { item: { kind: 'note', path: 'Idee.md' }, name: 'Idee' },
      }),
    ];
    expect(previewChat(events[1] as never, runOwners(events))).toBe('titan');
    const items = buildChat(events, [], (id) => id);
    const scope = { orchestrator: 'titan', owners: runOwners(events) };
    const row = items.find((i) => i.kind === 'preview');
    expect(row).toMatchObject({ kind: 'preview', agent: 'titan', from: 'rhea' });
    expect(chatThread(items, 'titan', scope).some((i) => i.kind === 'preview')).toBe(true);
    expect(chatThread(items, 'rhea', scope).some((i) => i.kind === 'preview')).toBe(true);
    expect(chatThread(items, 'dione', scope).some((i) => i.kind === 'preview')).toBe(false);
  });
});
