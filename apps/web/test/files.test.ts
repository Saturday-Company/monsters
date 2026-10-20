import { ulid, type EventInput, type LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  fileTag,
  formatSize,
  guessKind,
  pastedName,
  precheck,
  sourceText,
} from '../src/lib/files.ts';
import {
  buildChat,
  describeEvent,
  fileSentence,
  previewText,
  runOwners,
  threadsOf,
  type ChatItem,
} from '../src/store/derive.ts';

/* Files in the web app (D-075): the composer's checks, the chips of the chat. */

let clock = 1_760_000_000_000;
function ev<T extends EventInput>(input: T): LogEvent {
  clock += 1000;
  return {
    id: ulid(clock),
    ts: clock,
    agent: input.agent,
    runId: input.runId ?? null,
    parentId: input.parentId ?? null,
    type: input.type,
    data: input.data,
  } as LogEvent;
}

describe('the composer’s checks', () => {
  it('lets through images, PDF, text and Office files; says why the others stay out', () => {
    expect(precheck({ name: 'a.png', size: 10, type: 'image/png' })).toBeNull();
    expect(precheck({ name: 'image.png', size: 10, type: 'image/png' })).toBeNull();
    expect(precheck({ name: 'c.PDF', size: 10, type: '' })).toBeNull();
    expect(precheck({ name: 'l.docx', size: 10, type: '' })).toBeNull();
    expect(precheck({ name: 'IMG_1.HEIC', size: 10, type: 'image/heic' })).toMatch(/HEIC/);
    expect(precheck({ name: 'x.html', size: 10, type: 'text/html' })).toMatch(/HTML/);
    expect(precheck({ name: 'setup.exe', size: 10, type: '' })).toMatch(/non si allega/);
    expect(precheck({ name: 'big.pdf', size: 26 * 1024 * 1024, type: '' })).toMatch(/25 MB/);
    expect(precheck({ name: 'vuoto.txt', size: 0, type: 'text/plain' })).toMatch(/vuoto/);
  });

  it('names a pasted image and guesses kinds before the core says', () => {
    const file = new File(['x'], 'image.png', { type: 'image/png' });
    expect(pastedName(file, new Date(2026, 9, 16, 9, 5))).toBe('immagine incollata 09.05.png');
    expect(pastedName(new File(['x'], 'foto.jpg', { type: 'image/jpeg' }))).toBe('foto.jpg');
    expect(guessKind({ name: 'a.xlsx', type: '' })).toBe('sheet');
    expect(guessKind({ name: 'a.pptx', type: '' })).toBe('document');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(1.25 * 1024 * 1024)).toBe('1,3 MB');
    expect(fileTag('lettera.docx', 'document')).toBe('DOCX');
    expect(fileTag('pagina', 'html')).toBe('HTML');
  });

  it('says who made a file', () => {
    const nameOf = (id: string) => (id === 'rhea' ? 'Rhea' : id);
    expect(sourceText({ source: 'user', kind: 'image' }, nameOf)).toBe('Da te');
    expect(sourceText({ source: 'tool', kind: 'image', agent: 'rhea' }, nameOf)).toBe(
      'Screenshot di Rhea',
    );
    expect(sourceText({ source: 'agent', kind: 'html', agent: 'rhea' }, nameOf)).toBe(
      'Pagina di Rhea',
    );
  });
});

describe('files in the chat', () => {
  const nameOf = (id: string) => ({ titan: 'Titan', rhea: 'Rhea', dione: 'Dione' })[id] ?? id;

  it('a message keeps its files; the pending bubble waits for it with the same files', () => {
    const sent = ev({
      agent: 'user',
      runId: 'r1',
      type: 'message',
      data: { role: 'user', text: '', to: 'dione', attachments: ['f1'] },
    });
    const items = buildChat(
      [sent],
      [
        { tempId: 'p1', text: '', to: 'dione', ts: 1, attachments: ['f1'] },
        { tempId: 'p2', text: '', to: 'dione', ts: 2, attachments: ['f2'] },
      ],
    );
    expect(items.map((i) => (i.kind === 'user' ? [i.id, i.attachments] : i.kind))).toEqual([
      [sent.id, ['f1']],
      ['p2', ['f2']],
    ]);
  });

  it('a file of a monster is a line of its chat and of the chat where the work started', () => {
    const events = [
      ev({ agent: 'user', runId: 'r1', type: 'message', data: { role: 'user', text: 'cerca' } }),
      ev({ agent: 'titan', runId: 'r1', type: 'run', data: { status: 'started', goal: 'cerca' } }),
      ev({
        agent: 'rhea',
        runId: 'r1',
        type: 'file',
        data: { action: 'created', id: 'f9', name: 's.png', kind: 'image', source: 'tool' },
      }),
      ev({
        agent: 'user',
        type: 'file',
        data: { action: 'deleted', id: 'f9', name: 's.png', kind: 'image', source: 'tool' },
      }),
    ];
    const items = buildChat(events, [], nameOf);
    const file = items.find((i): i is Extract<ChatItem, { kind: 'file' }> => i.kind === 'file')!;
    expect(items.filter((i) => i.kind === 'file')).toHaveLength(1);
    expect(threadsOf(file, { orchestrator: 'titan', owners: runOwners(events) })).toEqual([
      'titan',
      'rhea',
    ]);
    expect(previewText(file, nameOf)).toBe('Rhea ha salvato uno screenshot');
    expect(describeEvent(events[3]!, nameOf)).toBe('Hai eliminato il file s.png');
  });

  it('a page made by a monster says its title', () => {
    expect(
      fileSentence(
        {
          action: 'created',
          id: 'x',
          name: 'p.html',
          kind: 'html',
          source: 'agent',
          title: 'Prezzi',
        },
        'Dione',
      ),
    ).toBe('Dione ha creato una pagina: Prezzi');
  });
});
