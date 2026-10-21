import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProviderRegistry } from '@monsters/providers';
import { lockedPath } from '@monsters/tools';
import { fake, FakeProvider } from '@monsters/providers/testing';
import { setAppLang } from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCoreServices, parseAgentConfig, runAgent } from '../src/index.ts';
import { migrate } from '../src/db/migrations.ts';
import { openDb } from '../src/db/sqlite.ts';
import { detectType, imageSize } from '../src/files/detect.ts';
import { docxText, extractText, htmlText } from '../src/files/extract.ts';
import {
  attachmentParts,
  attachmentsLine,
  harnessAttachments,
  modelSight,
  type AttachmentSource,
} from '../src/files/model-input.ts';
import {
  cleanName,
  FILES_GITIGNORE,
  FileStore,
  FILES_MARKER,
  filesDirFor,
  filesMigrations,
} from '../src/files/store.ts';
import { FILE_READ_PAGE_CHARS, fileReadTool } from '../src/files/tools.ts';
import { readZipEntries, zipEntryNames } from '../src/files/zip.ts';
import { RunTaint } from '../src/team/instinct/taint.ts';
import { readBodyCapped } from '../src/server/routes/files.ts';
import { docx, makeZip, pdf, png, pptx, webp, xlsx } from './file-fixtures.ts';
import { tempHome } from './helpers.ts';
import { inLang } from './prompt-lang.ts';

/* Files of the user and of the monsters (D-075): types, names, storage, text, model input. */

function store(now = () => Date.UTC(2026, 9, 16, 12)) {
  const root = tempHome();
  mkdirSync(root, { recursive: true });
  const db = openDb(':memory:');
  migrate(db, 'files', filesMigrations);
  return { files: new FileStore({ db, root, now }), root };
}

describe('detectType: the bytes decide, not the name', () => {
  it('knows images, PDF and Office files by their magic bytes', () => {
    expect(detectType(png(), 'x.bin')).toMatchObject({ mime: 'image/png', kind: 'image' });
    expect(detectType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'f.jpeg')).toMatchObject({
      mime: 'image/jpeg',
      ext: 'jpeg',
    });
    expect(detectType(Buffer.from('GIF89a......'), 'a.gif')).toMatchObject({ kind: 'image' });
    expect(detectType(webp(), 'a')).toMatchObject({ mime: 'image/webp' });
    expect(detectType(pdf('ciao'), 'foto.png')).toMatchObject({ kind: 'pdf', ext: 'pdf' });
    expect(detectType(docx(['a']), 'x.zip')).toMatchObject({ ext: 'docx', kind: 'document' });
    expect(detectType(xlsx(), 'x')).toMatchObject({ ext: 'xlsx', kind: 'sheet' });
    expect(detectType(pptx(), 'x')).toMatchObject({ ext: 'pptx' });
  });

  it('refuses what it cannot show or read, HTML from the user too', () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic0000')]);
    expect(detectType(heic, 'IMG_1.HEIC')).toEqual({ unsupported: 'heic' });
    expect(detectType(Buffer.from('<!doctype html><script>x</script>'), 'a.txt')).toEqual({
      unsupported: 'html',
    });
    expect(
      detectType(Buffer.from('<html><body>hi'), 'page.html', { allowHtml: true }),
    ).toMatchObject({
      kind: 'html',
    });
    expect(detectType(Buffer.from('<svg onload="x()"/>'), 'a.svg')).toEqual({ unsupported: 'svg' });
    expect(detectType(Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0]), 'setup.exe')).toEqual({
      unsupported: 'exe',
    });
    expect(detectType(makeZip({ 'a.txt': 'x' }), 'a.docx')).toEqual({ unsupported: 'zip' });
  });

  it('tells text types apart by the name, JSON only when it parses', () => {
    expect(detectType(Buffer.from('a,b\n1,2\n'), 'dati.csv')).toMatchObject({
      ext: 'csv',
      kind: 'sheet',
    });
    expect(detectType(Buffer.from('# Titolo'), 'n.md')).toMatchObject({ ext: 'md' });
    expect(detectType(Buffer.from('{"a":1}'), 'd.json')).toMatchObject({ ext: 'json' });
    expect(detectType(Buffer.from('{nope'), 'd.json')).toMatchObject({ ext: 'txt' });
    expect(detectType(Buffer.from('ciao'), 'note')).toMatchObject({ ext: 'txt' });
  });

  it('reads the size of an image from its header', () => {
    expect(imageSize(png(640, 480), 'image/png')).toEqual({ width: 640, height: 480 });
  });
});

describe('the folder of the files', () => {
  it('never takes a File/ of the user: File di Monsters/ instead, kept by its marker', async () => {
    const notes = tempHome();
    mkdirSync(notes, { recursive: true });
    expect(filesDirFor(notes)).toBe('File');
    // The user's own folder of notes called File.
    mkdirSync(join(notes, 'File'));
    writeFileSync(join(notes, 'File', 'Fatture.md'), '# Fatture\n');
    expect(filesDirFor(notes)).toBe('File di Monsters');
    const db = openDb(':memory:');
    migrate(db, 'files', filesMigrations);
    const files = new FileStore({ db, root: notes, dirName: filesDirFor(notes) });
    const meta = await files.save({ bytes: png(), name: 'a.png', source: 'user', maxBytes: 1e6 });
    expect(meta.path).toMatch(/^File di Monsters\/\d{4}-\d{2}\/a\.png$/);
    expect(existsSync(join(notes, 'File di Monsters', FILES_MARKER))).toBe(true);
    expect(readFileSync(join(notes, 'File', 'Fatture.md'), 'utf8')).toBe('# Fatture\n');
    // Next start: the marked folder is ours, the user's stays theirs.
    expect(filesDirFor(notes)).toBe('File di Monsters');
  });

  it('a File/ with the marker is ours', () => {
    const notes = tempHome();
    mkdirSync(join(notes, 'File'), { recursive: true });
    writeFileSync(join(notes, 'File', FILES_MARKER), 'Monsters');
    expect(filesDirFor(notes)).toBe('File');
  });
});

describe('names and paths', () => {
  it('cleans the name: no folders, hidden files, reserved names; the real extension', () => {
    expect(cleanName('../../etc/passwd', 'txt')).toBe('passwd.txt');
    expect(cleanName('C:\\Users\\x\\foto vacanze.PNG', 'png')).toBe('foto vacanze.png');
    expect(cleanName('.bashrc', 'txt')).toBe('bashrc.txt');
    expect(cleanName('CON.png', 'png')).toBe('CON file.png');
    expect(cleanName('fattura.exe', 'pdf')).toBe('fattura.pdf');
    expect(cleanName('a<b>:c|d?.jpeg', 'jpg')).toBe('a b c d.jpeg');
    expect(cleanName('', 'png')).toBe('file.png');
    expect(cleanName(`${'x'.repeat(300)}.pdf`, 'pdf').length).toBeLessThanOrEqual(100);
  });

  it('saves under File/<yyyy-mm>/ with a .gitignore, unique names, and deletes', async () => {
    const { files, root } = store();
    const a = await files.save({ bytes: png(), name: 'foto.png', source: 'user', maxBytes: 1e6 });
    const b = await files.save({ bytes: png(), name: 'FOTO.png', source: 'user', maxBytes: 1e6 });
    expect(a.path).toBe('File/2026-10/foto.png');
    expect(b.name).toBe('FOTO (2).png');
    expect(readFileSync(join(root, 'File', '.gitignore'), 'utf8')).toBe(FILES_GITIGNORE);
    expect(a).toMatchObject({
      kind: 'image',
      width: 4,
      height: 3,
      hasThumb: false,
      source: 'user',
    });
    expect(files.read(a)?.equals(png())).toBe(true);
    expect(files.delete(a.id)).toBe(true);
    expect(existsSync(join(root, a.path))).toBe(false);
    expect(files.get(a.id)).toBeUndefined();
    expect(files.delete(a.id)).toBe(false);
  });

  it('keeps a thumbnail only when it is a real WebP', async () => {
    const { files } = store();
    const good = await files.save({
      bytes: png(),
      name: 'a.png',
      source: 'user',
      thumb: webp(),
      maxBytes: 1e6,
    });
    const bad = await files.save({
      bytes: png(),
      name: 'b.png',
      source: 'user',
      thumb: Buffer.from('<html>'),
      maxBytes: 1e6,
    });
    expect(good.hasThumb).toBe(true);
    expect(files.thumb(good.id)?.subarray(0, 4).toString()).toBe('RIFF');
    expect(bad.hasThumb).toBe(false);
  });

  it('never reads or writes outside File/, whatever the database says', () => {
    const { files, root } = store();
    // Outside the files folder there is no path (a handled null, never a file of the user).
    expect(files.absPath({ path: 'File/../segreto.md' })).toBeNull();
    expect(files.absPath({ path: '../../etc/passwd' })).toBeNull();
    expect(files.read({ path: 'Risorse/nota.md' })).toBeNull();
    expect(files.absPath({ path: 'File/2026-10/a.png' })).toBe(
      join(root, 'File', '2026-10', 'a.png'),
    );
  });

  it('refuses a file over the limit and a type it does not know', async () => {
    const { files } = store();
    await expect(
      files.save({ bytes: png(), name: 'a.png', source: 'user', maxBytes: 10 }),
    ).rejects.toMatchObject({
      code: 'file_too_large',
    });
    await expect(
      files.save({
        bytes: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]),
        name: 'run',
        source: 'user',
        maxBytes: 1e6,
      }),
    ).rejects.toMatchObject({ code: 'unsupported_type' });
  });

  it('does not write through a name already on disk (exclusive create)', async () => {
    const { files, root } = store();
    mkdirSync(join(root, 'File', '2026-10'), { recursive: true });
    symlinkSync('/etc/hostname', join(root, 'File', '2026-10', 'x.png'));
    const meta = await files.save({ bytes: png(), name: 'x.png', source: 'user', maxBytes: 1e6 });
    expect(meta.name).toBe('x (2).png');
  });

  it('moves past a dangling link with the same name', async () => {
    const { files, root } = store();
    mkdirSync(join(root, 'File', '2026-10'), { recursive: true });
    symlinkSync(join(root, 'nowhere'), join(root, 'File', '2026-10', 'y.png'));
    const meta = await files.save({ bytes: png(), name: 'y.png', source: 'user', maxBytes: 1e6 });
    expect(meta.name).toBe('y (2).png');
  });

  it('lists with filters: kind, documents, from the monsters, name', async () => {
    let t = 1000;
    const { files } = store(() => (t += 1000));
    await files.save({ bytes: png(), name: 'gatto.png', source: 'user', maxBytes: 1e6 });
    await files.save({ bytes: pdf('x'), name: 'contratto.pdf', source: 'user', maxBytes: 1e6 });
    files.saveImageSync({
      bytes: png(),
      name: 'screenshot-browser',
      source: 'tool',
      agent: 'rhea',
      maxBytes: 1e6,
    });
    await files.save({
      bytes: Buffer.from('<!doctype html><p>ok'),
      name: 'pagina.html',
      source: 'agent',
      agent: 'dione',
      allowHtml: true,
      maxBytes: 1e6,
    });
    const names = (q: Parameters<FileStore['list']>[0]) => files.list(q).map((f) => f.name);
    expect(names({})).toEqual([
      'pagina.html',
      'screenshot-browser.png',
      'contratto.pdf',
      'gatto.png',
    ]);
    expect(names({ kind: 'image' })).toEqual(['screenshot-browser.png', 'gatto.png']);
    expect(names({ kind: 'documents' })).toEqual(['contratto.pdf']);
    expect(names({ source: 'monsters' })).toEqual(['pagina.html', 'screenshot-browser.png']);
    expect(names({ q: 'GAT' })).toEqual(['gatto.png']);
    expect(names({ q: '%' })).toEqual([]);
    expect(names({ agent: 'dione' })).toEqual(['pagina.html']);
  });

  it('searches the extracted text too, with a snippet around the words (D-086)', async () => {
    let t = 1000;
    const { files } = store(() => (t += 1000));
    const long = `${'parola '.repeat(30)}il preventivo di Lisbona costa 4.200 euro ${'resto '.repeat(60)}`;
    const a = await files.save({
      bytes: Buffer.from(long),
      name: 'appunti.txt',
      source: 'user',
      maxBytes: 1e6,
    });
    const b = await files.save({
      bytes: docx(['Lisbona in breve']),
      name: 'lisbona.docx',
      source: 'user',
      maxBytes: 1e6,
    });
    await files.ready([a.id, b.id]);
    const found = files.list({ q: 'lisbona' });
    expect(found.map((f) => f.name)).toEqual(['lisbona.docx', 'appunti.txt']);
    // Found by its name: no snippet.
    expect(found[0]!.snippet).toBeUndefined();
    const snippet = found[1]!.snippet!;
    expect(snippet).toContain('preventivo di Lisbona costa');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(202);
    // LIKE wildcards are words, not patterns.
    expect(files.list({ q: '4_200' })).toEqual([]);
    expect(files.list({ q: 'nessuna traccia' })).toEqual([]);
  });

  it('gives the files of some ids, the deleted ones absent (D-086)', async () => {
    const { files } = store();
    const a = await files.save({ bytes: png(), name: 'a.png', source: 'user', maxBytes: 1e6 });
    const b = await files.save({ bytes: png(), name: 'b.png', source: 'user', maxBytes: 1e6 });
    files.delete(b.id);
    expect(files.list({ ids: `${a.id},${b.id}` }).map((f) => f.id)).toEqual([a.id]);
  });
});

describe('text of the files', () => {
  it('reads Word, Excel and PowerPoint from their XML', async () => {
    expect((await extractText(docx(['Primo &amp; secondo', 'Riga due']), 'docx'))?.text).toBe(
      'Primo & secondo\nRiga due',
    );
    expect((await extractText(xlsx(), 'xlsx'))?.text).toBe(
      '## Spese\nVoce\tEuro\nAffitto & luce\t850',
    );
    expect((await extractText(pptx(), 'pptx'))?.text).toBe(
      '## Slide 1\nPrima diapositiva\n\n## Slide 2\nSeconda',
    );
    // The Italian family is the one that always was.
    inLang('it');
    expect((await extractText(pptx(), 'pptx'))?.text).toBe(
      '## Diapositiva 1\nPrima diapositiva\n\n## Diapositiva 2\nSeconda',
    );
    expect(docxText('<w:p><w:r><w:t>a</w:t></w:r><w:r><w:tab/><w:t>b</w:t></w:r></w:p>')).toBe(
      'a\tb',
    );
  });

  it('reads a PDF with pdf.js', async () => {
    const out = await extractText(pdf('Preventivo Saturday 2026'), 'pdf');
    expect(out?.text).toContain('Preventivo Saturday 2026');
  });

  it('a damaged file has no text, never an error', async () => {
    expect(await extractText(Buffer.from('%PDF-1.4 rotto'), 'pdf')).toBeNull();
    expect(await extractText(Buffer.from('PK\u0003\u0004 rotto'), 'docx')).toBeNull();
  });

  it('strips scripts and tags from HTML', () => {
    expect(
      htmlText('<style>x{}</style><h1>Titolo</h1><script>alert(1)</script><p>a &lt; b</p>'),
    ).toBe('Titolo\na < b');
  });

  it('stores the text with the file and says it has one', async () => {
    const { files } = store();
    const meta = await files.save({
      bytes: docx(['Ciao']),
      name: 'lettera.docx',
      source: 'user',
      maxBytes: 1e6,
    });
    // The text comes from the worker after the answer (D-085).
    expect(meta.hasText).toBe(false);
    await files.ready([meta.id]);
    expect(files.get(meta.id)?.hasText).toBe(true);
    expect(files.text(meta.id)).toEqual({ text: 'Ciao', truncated: false });
  });
});

describe('zip reader', () => {
  it('lists and inflates entries, with a ceiling against zip bombs', () => {
    const big = Buffer.alloc(2 * 1024 * 1024, 0x61);
    const zip = makeZip({ 'a.txt': 'ciao', 'b.txt': big });
    expect(zipEntryNames(zip)).toEqual(['a.txt', 'b.txt']);
    expect(
      readZipEntries(zip, () => true)
        .get('a.txt')
        ?.toString(),
    ).toBe('ciao');
    const capped = readZipEntries(zip, () => true, 1024);
    expect(capped.has('b.txt')).toBe(false);
    expect(zipEntryNames(Buffer.from('not a zip'))).toBeNull();
  });
});

describe('the upload body', () => {
  const body = (chunks: number, size: number) =>
    new Request('http://x/', {
      method: 'POST',
      body: new ReadableStream({
        pull(c) {
          if (chunks-- <= 0) return c.close();
          c.enqueue(new Uint8Array(size));
        },
      }),
      // Node's fetch needs it for a streamed body.
      ...{ duplex: 'half' },
    });

  it('stops reading as soon as the ceiling is passed', async () => {
    expect((await readBodyCapped(body(3, 100), 1000))?.byteLength).toBe(300);
    expect(await readBodyCapped(body(30, 100), 1000)).toBeNull();
    const declared = new Request('http://x/', {
      method: 'POST',
      body: 'x',
      headers: { 'content-length': '999999' },
    });
    expect(await readBodyCapped(declared, 1000)).toBeNull();
  });
});

describe('files for the models', () => {
  // The Italian family unless a test says otherwise: the assertions are those of before D-153.
  beforeEach(() => setAppLang('it'));
  afterEach(() => setAppLang('en'));

  it('knows which models see images and read PDFs', () => {
    expect(modelSight('anthropic', 'claude-sonnet-4-5')).toEqual({ images: true, pdf: true });
    expect(modelSight('openai', 'gpt-4o-mini')).toEqual({ images: true, pdf: true });
    expect(modelSight('openai', 'gpt-3.5-turbo')).toEqual({ images: false, pdf: false });
    expect(modelSight('openrouter', 'openrouter/free')).toEqual({ images: false, pdf: false });
    expect(modelSight('openrouter', 'meta-llama/llama-3.3-70b-instruct:free')).toEqual({
      images: false,
      pdf: false,
    });
    expect(modelSight('openrouter', 'x/y:free', ['text', 'image'])).toEqual({
      images: true,
      pdf: false,
    });
    expect(modelSight('openrouter', 'anthropic/claude-sonnet-4.5')).toMatchObject({ images: true });
    expect(modelSight('ollama', 'llama3.2')).toEqual({ images: false, pdf: false });
    expect(modelSight('ollama', 'llava:13b')).toMatchObject({ images: true, pdf: false });
    expect(modelSight('chatgpt', 'gpt-5')).toEqual({ images: true, pdf: true });
  });

  const meta = (over: Partial<AttachmentSource['meta']>): AttachmentSource['meta'] => ({
    id: '01J0000000000000000000000A',
    name: 'foto.png',
    mime: 'image/png',
    size: 2048,
    kind: 'image',
    source: 'user',
    path: 'File/2026-10/foto.png',
    hasThumb: false,
    hasText: false,
    createdAt: 0,
    ...over,
  });
  const src = (m: AttachmentSource['meta'], text?: string): AttachmentSource => ({
    meta: m,
    bytes: () => Buffer.from('BYTES'),
    text: () => (text ? { text, truncated: false } : null),
  });

  it('gives an image as an image to a model that sees, and says so to one that does not', () => {
    const image = src(meta({}));
    const sees = attachmentParts([image], { images: true, pdf: false });
    expect(sees.map((p) => p.type)).toEqual(['text', 'file']);
    expect(sees[1]).toMatchObject({ mediaType: 'image/png', filename: 'foto.png' });
    const blind = attachmentParts([image], { images: false, pdf: false });
    expect(blind).toHaveLength(1);
    expect((blind[0] as { text: string }).text).toMatch(/non vede le immagini/);
    expect((blind[0] as { text: string }).text).toMatch(/foto\.png/);
  });

  it('gives a PDF as a file where it can, else its text as user data', () => {
    const doc = src(
      meta({ name: 'c.pdf', kind: 'pdf', mime: 'application/pdf' }),
      'Totale 100 euro',
    );
    expect(attachmentParts([doc], { images: true, pdf: true }).map((p) => p.type)).toEqual([
      'text',
      'file',
    ]);
    const text = attachmentParts([doc], { images: false, pdf: false });
    expect((text[0] as { text: string }).text).toMatch(
      /<allegato nome="c\.pdf">\nTotale 100 euro\n<\/allegato>/,
    );
    expect((text[0] as { text: string }).text).toMatch(/non istruzioni/);
  });

  it('a file without text: the model is told, so it does not invent', () => {
    const doc = src(meta({ name: 'scan.pdf', kind: 'pdf', mime: 'application/pdf' }));
    const parts = attachmentParts([doc], { images: false, pdf: false });
    expect((parts[0] as { text: string }).text).toMatch(/non ne ho potuto leggere il testo/);
  });

  it('a harness reads images and PDFs from their paths, the rest as text', () => {
    const files = [
      src(meta({})),
      src(
        meta({ name: 'c.pdf', kind: 'pdf', mime: 'application/pdf', path: 'File/2026-10/c.pdf' }),
      ),
      src(meta({ name: 'l.docx', kind: 'document', path: 'File/2026-10/l.docx' }), 'Cara Anna'),
    ];
    const abs = (m: { path: string }) => `/home/g/Monsters Note/${m.path}`;
    const claude = harnessAttachments(files, 'claude-agent', abs);
    expect(claude.read).toEqual([
      '/home/g/Monsters Note/File/2026-10/foto.png',
      '/home/g/Monsters Note/File/2026-10/c.pdf',
    ]);
    expect(claude.text).toMatch(/strumento Read/);
    expect(claude.text).toMatch(/Cara Anna/);
    const codex = harnessAttachments(files, 'codex', abs);
    expect(codex.images).toEqual(['/home/g/Monsters Note/File/2026-10/foto.png']);
    expect(codex.read).toEqual([]);
  });

  it('past messages keep a neutral line with names and ids, never the bytes (review of 16/10)', () => {
    const line = attachmentsLine([meta({})], 1);
    expect(line).toBe(
      "[Allegati di questo messaggio: foto.png (immagine, 2 KB, file id 01J0000000000000000000000A), un file poi eliminato dall'utente. Li avevi davanti quando è arrivato: quello che ne hai detto allora resta valido, non serve correggerlo. Se ti serve di nuovo il contenuto, leggilo con `file_read` e il file id, senza chiederlo all’utente.]",
    );
    // Never the words that made a monster take back right answers.
    expect(line).not.toMatch(/non li hai più|rimand|chiedi di/i);
    // Only deleted files: nothing to read again.
    expect(attachmentsLine([], 2)).not.toContain('file_read');
  });

  describe('English family (D-153)', () => {
    beforeEach(() => setAppLang('en'));

    it('says an image cannot be seen, in English, as the Italian one does', () => {
      const blind = attachmentParts([src(meta({}))], { images: false, pdf: false });
      expect((blind[0] as { text: string }).text).toMatch(/can’t see images/);
      expect((blind[0] as { text: string }).text).toMatch(/foto\.png/);
    });

    it('gives the text of a PDF as user data inside <attachment>', () => {
      const doc = src(
        meta({ name: 'c.pdf', kind: 'pdf', mime: 'application/pdf' }),
        'Totale 100 euro',
      );
      const text = attachmentParts([doc], { images: false, pdf: false });
      expect((text[0] as { text: string }).text).toMatch(
        /<attachment name="c\.pdf">\nTotale 100 euro\n<\/attachment>/,
      );
      expect((text[0] as { text: string }).text).toMatch(/not instructions/);
    });

    it('a file without text: the model is told', () => {
      const doc = src(meta({ name: 'scan.pdf', kind: 'pdf', mime: 'application/pdf' }));
      const parts = attachmentParts([doc], { images: false, pdf: false });
      expect((parts[0] as { text: string }).text).toMatch(/I couldn’t read its text/);
    });

    it('a harness reads images and PDFs from their paths', () => {
      const files = [
        src(
          meta({ name: 'c.pdf', kind: 'pdf', mime: 'application/pdf', path: 'File/2026-10/c.pdf' }),
        ),
      ];
      const claude = harnessAttachments(files, 'claude-agent', (m) => `/home/g/${m.path}`);
      expect(claude.text).toMatch(/read them with the Read tool/);
    });

    it('past messages keep a neutral line with names and ids, never the bytes', () => {
      const line = attachmentsLine([meta({})], 1);
      expect(line).toBe(
        '[Attachments of this message: foto.png (image, 2 KB, file id 01J0000000000000000000000A), a file the user deleted afterwards. You had them in front of you when it arrived: what you said about them then stays valid, no need to correct it. If you need the content again, read it with `file_read` and the file id, without asking the user.]',
      );
      expect(attachmentsLine([], 2)).not.toContain('file_read');
    });
  });
});

describe('runAgent with files', () => {
  it('puts the parts of the files after the text of the first message', async () => {
    const services = createCoreServices({ home: tempHome() });
    try {
      const provider = new FakeProvider({ models: { a: [fake.text('Un gatto grigio.')] } });
      const agent = {
        config: parseAgentConfig({
          id: 'rhea',
          name: 'Rhea',
          role: 'ricerche',
          color: '#4f8df7',
          models: [{ provider: 'fake', model: 'a' }],
          tools: [],
        }),
        instructions: '# Rhea',
      };
      const parts = attachmentParts(
        [
          {
            meta: {
              id: 'x',
              name: 'gatto.png',
              mime: 'image/png',
              size: 10,
              kind: 'image',
              source: 'user',
              path: 'File/a/gatto.png',
              hasThumb: false,
              hasText: false,
              createdAt: 0,
            },
            bytes: () => png(),
            text: () => null,
          },
        ],
        { images: true, pdf: false },
      );
      const result = await runAgent({
        agent,
        task: 'cosa vedi?',
        tools: [],
        signal: new AbortController().signal,
        log: services.log,
        runId: 'run-files',
        providers: new ProviderRegistry().register(provider),
        attachments: parts,
      });
      expect(result.status).toBe('completed');
      const prompt = provider.calls[0]!.options.prompt as {
        role: string;
        content: { type: string; text?: string; mediaType?: string }[];
      }[];
      const user = prompt.find((m) => m.role === 'user')!;
      expect(user.content.map((p) => p.type)).toEqual(['text', 'text', 'file']);
      expect(user.content[0]!.text).toBe('cosa vedi?');
      expect(user.content[2]!.mediaType).toBe('image/png');
    } finally {
      services.db.close();
    }
  });
});

describe('the harness reads the attached files', () => {
  it('even with the notes folder inside the data folder (a custom MONSTERS_HOME)', () => {
    const home = tempHome();
    const folder = join(home, 'Monsters Note', 'File', '2026-10');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'foto.png'), png());
    writeFileSync(join(folder, 'altro.png'), png());
    const lock = {
      dataDir: home,
      allowed: [join(home, 'agents', 'rhea', 'workspace'), join(folder, 'foto.png')],
    };
    expect(lockedPath(join(folder, 'foto.png'), home, lock)).toBeNull();
    expect(lockedPath(join(folder, 'altro.png'), home, lock)).not.toBeNull();
    expect(lockedPath(join(home, 'monsters.db'), home, lock)).not.toBeNull();
  });
});

describe('file_read: a file of the conversation read again (review of 16/10)', () => {
  const ctx = (agentId = 'titan', runId = 'run-now') =>
    ({
      agentId,
      runId,
      callEventId: 'e',
      signal: new AbortController().signal,
      emit: () => {},
    }) as never;
  type Read = {
    text?: string;
    page?: number;
    pages?: number;
    more?: string;
    shown?: string;
    note?: string;
    source?: string;
  };

  it('pages the extracted text, finds a file by name, refuses files of others', async () => {
    const { files } = store();
    const long = `${'a'.repeat(FILE_READ_PAGE_CHARS)}FINE`;
    const mine = await files.save({
      bytes: Buffer.from(long),
      name: 'appunti.txt',
      source: 'user',
      agent: 'titan',
      maxBytes: 1e6,
    });
    const other = await files.save({
      bytes: Buffer.from('di Rhea'),
      name: 'rhea.txt',
      source: 'user',
      agent: 'rhea',
      maxBytes: 1e6,
    });
    const made = await files.save({
      bytes: Buffer.from('pagina di oggi'),
      name: 'oggi.txt',
      source: 'agent',
      agent: 'rhea',
      runId: 'run-now',
      maxBytes: 1e6,
    });
    await files.ready([mine.id, other.id, made.id]);
    const tool = fileReadTool({
      files: () => files,
      scope: (c) => ({ agents: [(c as { agentId: string }).agentId], runId: 'run-now' }),
    });
    const one = (await tool.execute({ file: mine.id }, ctx())) as Read;
    expect(one).toMatchObject({ page: 1, pages: 2, source: 'user' });
    expect(one.text).toHaveLength(FILE_READ_PAGE_CHARS);
    expect(one.more).toContain('page 2');
    const two = (await tool.execute({ file: 'appunti.txt', page: 2 }, ctx())) as Read;
    expect(two).toMatchObject({ page: 2, text: 'FINE' });
    expect(two.more).toBeUndefined();
    // Made in this run by another monster: readable; the user's file of another monster: not.
    expect(((await tool.execute({ file: `/api/files/${made.id}` }, ctx())) as Read).text).toBe(
      'pagina di oggi',
    );
    await expect(tool.execute({ file: other.id }, ctx())).rejects.toMatchObject({
      code: 'BLOCKED_BY_POLICY',
    });
    // A deleted file is gone: the monster says so, it does not ask to send it again blindly.
    files.delete(mine.id);
    await expect(tool.execute({ file: mine.id }, ctx())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('an image goes back to a model that sees; otherwise a line to say so', async () => {
    const { files } = store();
    const image = await files.save({
      bytes: png(),
      name: 'gatto.png',
      source: 'user',
      agent: 'titan',
      maxBytes: 1e6,
    });
    const shown: string[] = [];
    const sees = fileReadTool({
      files: () => files,
      scope: () => ({ agents: ['titan'], runId: 'r' }),
      show: (m) => (shown.push(m.id), true),
    });
    expect(((await sees.execute({ file: image.id }, ctx())) as Read).shown).toBeDefined();
    expect(shown).toEqual([image.id]);
    const blind = fileReadTool({
      files: () => files,
      scope: () => ({ agents: ['titan'], runId: 'r' }),
      show: () => false,
    });
    expect(((await blind.execute({ file: image.id }, ctx())) as Read).note).toMatch(/cannot/);
  });

  it("the user's files are the user's data; one a monster or a tool made taints the run", () => {
    const user = new RunTaint();
    user.observe(
      'file_read',
      { file: 'x' },
      {
        name: 'contratto.pdf',
        source: 'user',
        text: 'clausola segreta sul prezzo finale di vendita',
      },
    );
    expect(user.tainted).toBe(false);
    const tool = new RunTaint();
    tool.observe('file_read', { file: 'y' }, { name: 'screenshot.png', source: 'tool' });
    expect(tool.tainted).toBe(true);
    // Once tainted, the user's text does not leave towards an unknown site.
    tool.observe(
      'file_read',
      { file: 'x' },
      {
        name: 'contratto.pdf',
        source: 'user',
        text: 'clausola segreta sul prezzo finale di vendita',
      },
    );
    expect(
      tool.leak('clausola segreta sul prezzo finale di vendita', 'evil.example'),
    ).toMatchObject({
      kind: 'note',
    });
  });
});
