import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fake } from '@monsters/providers/testing';
import type { FileMeta, LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrations.ts';
import { openDb } from '../src/db/sqlite.ts';
import { extractTextIsolated, extractWorkerStats } from '../src/files/extract-run.ts';
import { docxText, extractText, htmlText, slideText, xlsxText } from '../src/files/extract.ts';
import { cleanName, FileStore, filesMigrations, MAX_NAME_BYTES } from '../src/files/store.ts';
import { readZipEntries, ZIP_ENTRY_MAX_BYTES } from '../src/files/zip.ts';
import { INERT_HTML_CSP } from '../src/server/file-headers.ts';
import { lockDownHtml, renameFrameTags } from '../src/server/html-lockdown.ts';
import { Turns } from '../src/server/routes/files.ts';
import { docx } from './file-fixtures.ts';
import { tempHome } from './helpers.ts';
import { startTestHub } from './hub-helpers.ts';

/*
 * Regressions of the security review of 16/10 on files and pages (D-085):
 * quadratic parsers, zip bombs by repetition, extraction off the event loop,
 * names, pages of tainted runs served without scripts.
 */

function store() {
  const root = tempHome();
  mkdirSync(root, { recursive: true });
  const db = openDb(':memory:');
  migrate(db, 'files', filesMigrations);
  return { files: new FileStore({ db, root }), root, db };
}

/** A zip whose central directory may point many entries at the same local data (bomb.ts). */
function zipOf(files: [string, Buffer][], repeat: { name: string; times: number } | null = null) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let off = 0;
  const central = (name: string, comp: Buffer, size: number, at: number) => {
    const nb = Buffer.from(name);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(nb.length, 28);
    ch.writeUInt32LE(at, 42);
    centrals.push(ch, nb);
  };
  let count = 0;
  for (const [name, data] of files) {
    const comp = deflateRawSync(data);
    const nb = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nb.length, 26);
    locals.push(lh, nb, comp);
    const times = repeat?.name === name ? repeat.times : 1;
    for (let i = 0; i < times; i++) central(name, comp, data.length, off);
    count += times;
    off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(count, 8);
  e.writeUInt16LE(count, 10);
  e.writeUInt32LE(cd.length, 12);
  e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}

const timed = <T>(f: () => T): [T, number] => {
  const t = performance.now();
  const out = f();
  return [out, performance.now() - t];
};

describe('the parsers are linear (review: 26 s on a 1.4 KB docx)', () => {
  // redos.mjs of the review: n = 200 000 took seconds with each old regex.
  const n = 200_000;
  it('open tags without their closing one', () => {
    for (const [what, run] of [
      ['docx <w:t>', () => docxText('<w:t>'.repeat(n / 5))],
      ['slide <a:t>', () => slideText('<a:t>'.repeat(n / 5))],
      ['html <script>', () => htmlText('<script>'.repeat(n / 8))],
      ['html <<<', () => htmlText('<'.repeat(n))],
      ['html spaces', () => htmlText(`${' '.repeat(n)}x`)],
      [
        'xlsx <row>',
        () => xlsxText(new Map([['xl/worksheets/sheet1.xml', Buffer.from('<row>'.repeat(n / 5))]])),
      ],
      [
        'xlsx <c>',
        () =>
          xlsxText(
            new Map([['xl/worksheets/sheet1.xml', Buffer.from(`<row>${'<c>'.repeat(n / 3)}`)]]),
          ),
      ],
      ['docx spaces', () => docxText(`<w:t>${' '.repeat(n)}x</w:t>`)],
    ] as const) {
      const [, ms] = timed(run);
      expect(ms, what).toBeLessThan(500);
    }
  });

  it('still reads what it read before', () => {
    expect(
      docxText(
        '<w:p><w:r><w:t xml:space="preserve">Ciao </w:t></w:r><w:r><w:tab/><w:t>Anna</w:t></w:r></w:p>' +
          '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>a &amp; b</w:t><w:br/><w:t>c</w:t></w:r>' +
          '<w:del><w:r><w:delText>via</w:delText></w:r></w:del></w:p>',
      ),
    ).toBe('Ciao \tAnna\na & b\nc');
    expect(
      slideText('<a:p><a:r><a:t>Titolo</a:t></a:r></a:p><a:p><a:r><a:t>Due</a:t></a:r></a:p>'),
    ).toBe('Titolo\nDue');
    const sheet = new Map([
      [
        'xl/sharedStrings.xml',
        Buffer.from(
          '<sst><si><t>Nome</t></si><si><r><t>Pi</t></r><r><t>ù</t></r><rPh><t>x</t></rPh></si></sst>',
        ),
      ],
      [
        'xl/workbook.xml',
        Buffer.from('<sheets><sheet name="Conti &amp; spese" sheetId="1"/></sheets>'),
      ],
      [
        'xl/worksheets/sheet1.xml',
        Buffer.from(
          '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
            '<row r="2"><c r="A2"><v>42</v></c><c r="B2" t="inlineStr"><is><t>in riga</t></is></c><c r="C2"/></row></sheetData>',
        ),
      ],
    ]);
    expect(xlsxText(sheet)).toBe('## Conti & spese\nNome\tPiù\n42\tin riga');
    expect(
      htmlText(
        '<html><head><style>p{}</style><script>var a="</p>"</script></head><body><!-- x --><h1>Titolo</h1><p>uno<br>due</p><SCRIPT>x</SCRIPT></body></html>',
      ),
    ).toBe('Titolo\nuno\ndue');
  });
});

describe('zip bombs', () => {
  it('5000 entries pointing at the same bomb are not inflated 5000 times', () => {
    // bomb.ts of the review: each entry passes the ceiling, and the failed ones never counted.
    const bomb = Buffer.alloc(ZIP_ENTRY_MAX_BYTES + 1024, 0x61);
    const z = zipOf(
      [
        ['[Content_Types].xml', Buffer.from('<x/>')],
        ['ppt/slides/slide1.xml', bomb],
      ],
      { name: 'ppt/slides/slide1.xml', times: 4999 },
    );
    expect(z.length).toBeLessThan(400_000);
    const [out, ms] = timed(() => readZipEntries(z, (name) => name.startsWith('ppt/slides/')));
    expect(out.size).toBe(0);
    expect(ms).toBeLessThan(2_000);
  });

  it('small entries repeated stop at the total ceiling', () => {
    const piece = Buffer.alloc(1024 * 1024, 0x62);
    const z = zipOf([['word/document.xml', piece]], { name: 'word/document.xml', times: 500 });
    const out = readZipEntries(z, () => true);
    expect(out.get('word/document.xml')?.length).toBe(piece.length);
  });
});

describe('extraction in a worker, with a time limit', () => {
  it('reads the text in the worker', async () => {
    const out = await extractTextIsolated(docx(['Dal worker']), 'docx');
    expect(out).toEqual({ text: 'Dal worker', truncated: false });
  });

  it('a worker past its time is stopped: no text, the core goes on', async () => {
    const big = Buffer.from(`%PDF-1.4\n${'0 0 obj\n'.repeat(200_000)}`);
    const t = performance.now();
    expect(await extractTextIsolated(big, 'pdf', { timeoutMs: 50 })).toBeNull();
    expect(performance.now() - t).toBeLessThan(2_000);
  });

  it('save answers before the text; ready waits for it; a hostile docx costs the worker', async () => {
    const { files } = store();
    const hostile = zipOf([
      ['[Content_Types].xml', Buffer.from('<x/>')],
      ['word/document.xml', Buffer.from('<w:t>'.repeat(80_000))],
    ]);
    const t = performance.now();
    const meta = await files.save({
      bytes: hostile,
      name: 'a.docx',
      source: 'user',
      maxBytes: 1e6,
    });
    expect(performance.now() - t).toBeLessThan(500);
    expect(meta.hasText).toBe(false);
    await files.ready([meta.id]);
    expect(files.get(meta.id)?.hasText).toBe(false);
  });

  it('the time limit and the signal count from the call, also while waiting for a slot (B11)', async () => {
    const big = Buffer.from(`%PDF-1.4\n${'0 0 obj\n'.repeat(200_000)}`);
    // Two slow files (about 3 s each) take both slots for 1.5 s.
    const slow = Buffer.from(`%PDF-1.4\n${'0 0 obj\n'.repeat(2_000_000)}`);
    const busy = [0, 1].map(() => extractTextIsolated(slow, 'pdf', { timeoutMs: 1_500 }));
    const t = performance.now();
    expect(await extractTextIsolated(big, 'pdf', { timeoutMs: 100 })).toBeNull();
    expect(performance.now() - t).toBeLessThan(800);
    const ac = new AbortController();
    const waited = extractTextIsolated(big, 'pdf', { signal: ac.signal });
    const t2 = performance.now();
    setTimeout(() => ac.abort(), 50);
    expect(await waited).toBeNull();
    expect(performance.now() - t2).toBeLessThan(800);
    await Promise.all(busy);
  });

  it('a slot frees only after the previous worker has exited (B11)', async () => {
    const big = Buffer.from(`%PDF-1.4\n${'0 0 obj\n'.repeat(200_000)}`);
    await new Promise((r) => setTimeout(r, 300));
    extractWorkerStats(true);
    // The first two are stopped at 100 ms, the others start as their slot frees.
    await Promise.all(
      [100, 100, 500, 500, 500].map((ms) => extractTextIsolated(big, 'pdf', { timeoutMs: ms })),
    );
    expect(extractWorkerStats().peak).toBeLessThanOrEqual(2);
  });

  it('the old in-process function is the same parser', async () => {
    expect(await extractText(docx(['x']), 'docx')).toEqual({ text: 'x', truncated: false });
  });
});

describe('names', () => {
  it('at most MAX_NAME_BYTES in UTF-8, never a character cut in two', () => {
    const name = cleanName(`${'日本語'.repeat(40)}.txt`, 'txt');
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(MAX_NAME_BYTES - 8);
    expect(name.endsWith('.txt')).toBe(true);
    expect(name).not.toContain('�');
    const emoji = cleanName(`${'😀'.repeat(80)}.png`, 'png');
    expect(Buffer.byteLength(emoji)).toBeLessThanOrEqual(MAX_NAME_BYTES);
    expect([...emoji.slice(0, -4)].every((c) => c === '😀')).toBe(true);
  });

  it('Windows device names also with an extension or superscript digits', () => {
    expect(cleanName('CON.x.txt', 'txt')).toBe('CON file.x.txt');
    expect(cleanName('con.txt', 'txt')).toBe('con file.txt');
    expect(cleanName('COM¹.png', 'png')).toBe('COM¹ file.png');
    expect(cleanName('LPT².doc.pdf', 'pdf')).toBe('LPT² file.doc.pdf');
    expect(cleanName('CONSOLE.txt', 'txt')).toBe('CONSOLE.txt');
  });

  it('no bidi, zero-width or control characters', () => {
    expect(cleanName('fattura‮fdp.exe.pdf', 'pdf')).toBe('fatturafdp.exe.pdf');
    expect(cleanName('a​b﻿c⁦d\u0085e.txt', 'txt')).toBe('abcd e.txt');
  });

  it('a long name saved twice fits the disk (no ENAMETOOLONG)', async () => {
    const { files } = store();
    const long = `${'è'.repeat(150)}.txt`;
    const a = await files.save({
      bytes: Buffer.from('a'),
      name: long,
      source: 'user',
      maxBytes: 10,
    });
    const b = await files.save({
      bytes: Buffer.from('b'),
      name: long,
      source: 'user',
      maxBytes: 10,
    });
    expect(b.name).not.toBe(a.name);
    expect(Buffer.byteLength(b.name)).toBeLessThanOrEqual(MAX_NAME_BYTES);
  });
});

describe('the files folder changed (marker removed)', () => {
  it('an old File/… path is handled: no path for the harness, delete keeps the user’s file', async () => {
    const { files, root, db } = store();
    const meta = await files.save({
      bytes: Buffer.from('x'),
      name: 'a.txt',
      source: 'user',
      maxBytes: 10,
    });
    // The marker goes, the folder is the user's now: the store of the next start is elsewhere.
    rmSync(join(root, 'File', '.monsters'));
    const moved = new FileStore({ db, root, dirName: 'File di Monsters' });
    expect(moved.absPath(meta)).toBeNull();
    expect(moved.read(meta)).toBeNull();
    expect(moved.delete(meta.id)).toBe(true);
    expect(moved.get(meta.id)).toBeUndefined();
  });
});

describe('uploads take turns', () => {
  it('at most so many at once', async () => {
    const turns = new Turns(3);
    let top = 0;
    const work = () =>
      turns.run(async () => {
        top = Math.max(top, turns.running);
        await new Promise((r) => setTimeout(r, 5));
      });
    await Promise.all(Array.from({ length: 10 }, work));
    expect(top).toBe(3);
  });
});

describe('the lockdown of the pages', () => {
  it('renames every frame tag, also with an XML prefix, and XML entities', () => {
    expect(renameFrameTags('<IFRAME srcdoc=x></iframe><object data=x><embed/><frameset>')).toBe(
      '<monsters-blocked-IFRAME srcdoc=x></monsters-blocked-iframe><monsters-blocked-object data=x><monsters-blocked-embed/><monsters-blocked-frameset>',
    );
    expect(renameFrameTags('<h:iframe xmlns:h="x"/>')).toBe(
      '<h:monsters-blocked-iframe xmlns:h="x"/>',
    );
    expect(renameFrameTags('<!DOCTYPE r [<!ENTITY e "x">]>')).toBe(
      '<!DOCTYPE r [<!X-ENTITY e "x">]>',
    );
    expect(renameFrameTags('<iframes><frameborder><objective>')).toBe(
      '<iframes><frameborder><objective>',
    );
  });

  it('puts the script after the doctype (standards mode), first otherwise', () => {
    expect(lockDownHtml('<!doctype html><p>a')).toMatch(/^<!doctype html><script>\(function/);
    expect(lockDownHtml('<p>a')).toMatch(/^<script>\(function/);
    const js = /<script>([\s\S]*)<\/script>/.exec(lockDownHtml('x'))![1]!;
    // Valid JavaScript.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    expect(() => new Function(js)).not.toThrow();
    for (const api of [
      'RTCPeerConnection',
      'WebTransport',
      'sendBeacon',
      'createElement',
      'trustedTypes',
    ]) {
      expect(js).toContain(api);
    }
  });
});

describe('pages of a run that read third-party text (D-085)', () => {
  const html =
    '<!doctype html><html><body><h1>Prezzi</h1><script>document.title="x"</script></body></html>';

  it('are saved inert, never open by themselves, and run scripts only after the user’s click', async () => {
    const t = await startTestHub({
      rhea: [
        fake.toolCall('web_search', { query: 'prezzi' }),
        fake.toolCall('artifact_create', { name: 'prezzi', html, title: 'Prezzi' }),
        fake.text('Fatto.'),
      ],
    });
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', {
      text: 'cerca i prezzi e fammi una pagina',
      to: 'rhea',
    });
    await t.runEnded(sent.runId);
    const event = t.events(sent.runId).find((e): e is LogEvent<'file'> => e.type === 'file');
    expect(event?.data).toMatchObject({ kind: 'html', inert: true });
    const meta = t.core.hub.files.get(event!.data.id)!;
    expect(meta.inert).toBe(true);
    const content = await t.api('GET', `/api/files/${meta.id}/content`);
    expect(content.headers.get('content-security-policy')).toBe(INERT_HTML_CSP);
    expect(await content.text()).toBe(html);

    // "Attiva gli script": the user's request, logged.
    const on = await t.json<FileMeta>('POST', `/api/files/${meta.id}/scripts`);
    expect(on.inert).toBeUndefined();
    const scripted = await t.api('GET', `/api/files/${meta.id}/content`);
    expect(scripted.headers.get('content-security-policy')).toMatch(/^sandbox allow-scripts;/);
    expect(await scripted.text()).toMatch(/^<!doctype html><script>\(function/);
    expect(t.events().some((e) => e.type === 'file' && e.data.action === 'updated')).toBe(true);
    const thumb = await t.api('POST', `/api/files/${'0'.repeat(26)}/scripts`);
    expect(thumb.status).toBe(404);
  });

  it('a run that read nothing from outside keeps its scripts', async () => {
    const t = await startTestHub({
      titan: [fake.toolCall('artifact_create', { name: 'prezzi', html }), fake.text('Fatto.')],
    });
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', {
      text: 'fammi una pagina',
    });
    await t.runEnded(sent.runId);
    const event = t.events(sent.runId).find((e): e is LogEvent<'file'> => e.type === 'file');
    expect(event?.data.inert).toBeUndefined();
    expect(t.core.hub.files.get(event!.data.id)?.inert).toBeUndefined();
  });
});

// The thumbnail is served with nosniff too.
describe('thumbnails', () => {
  it('nosniff', async () => {
    const t = await startTestHub({});
    const { png, webp } = await import('./file-fixtures.ts');
    const f = new FormData();
    f.set('file', new Blob([new Uint8Array(png())]), 'a.png');
    f.set('thumb', new Blob([new Uint8Array(webp())]), 't.webp');
    const { readFileSync } = await import('node:fs');
    const token = readFileSync(t.core.paths.cliToken, 'utf8').trim();
    const res = await fetch(`${t.core.url}/api/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: f,
    });
    const meta = (await res.json()) as FileMeta;
    const thumb = await t.api('GET', `/api/files/${meta.id}/thumb`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
