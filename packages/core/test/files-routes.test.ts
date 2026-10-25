import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { fake } from '@monsters/providers/testing';
import { FILE_MAX_BYTES, setAppLang, type FileMeta, type LogEvent } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { HTML_FILE_CSP as HTML_CSP } from '../src/server/file-headers.ts';
import { docx, pdf, png } from './file-fixtures.ts';
import { browserSession, setupUser, tempHome } from './helpers.ts';
import { promptText, startTestHub, toolResultsSeen, type TestHub } from './hub-helpers.ts';

/* `/api/files` (contract in shared/src/files.ts) and files in the chat (D-075). */

type Sent = { runId: string; agent: string };

function form(bytes: Buffer, name: string, extra: Record<string, string | Blob> = {}): FormData {
  const f = new FormData();
  f.set('file', new Blob([new Uint8Array(bytes)]), name);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

async function upload(t: TestHub, body: FormData | Buffer, headers: Record<string, string> = {}) {
  const token = readFileSync(t.core.paths.cliToken, 'utf8').trim();
  return fetch(`${t.core.url}/api/files`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, ...headers },
    body: body instanceof FormData ? body : new Uint8Array(body),
  });
}

describe('/api/files', () => {
  it('uploads a file into the notes folder and serves it back by id only', async () => {
    const t = await startTestHub({});
    const res = await upload(t, form(png(8, 6), '../../segreto.png', { agent: 'rhea' }));
    expect(res.status).toBe(201);
    const meta = (await res.json()) as FileMeta;
    expect(meta).toMatchObject({
      name: 'segreto.png',
      kind: 'image',
      source: 'user',
      agent: 'rhea',
    });
    expect(meta.path).toMatch(/^File\/\d{4}-\d{2}\/segreto\.png$/);
    const root = t.core.hub.vault.root;
    expect(existsSync(join(root, meta.path))).toBe(true);
    expect(existsSync(join(root, 'File', '.gitignore'))).toBe(true);

    const content = await t.api('GET', `/api/files/${meta.id}/content`);
    expect(content.status).toBe(200);
    expect(content.headers.get('content-type')).toBe('image/png');
    expect(content.headers.get('x-content-type-options')).toBe('nosniff');
    expect(content.headers.get('content-disposition')).toMatch(/^inline; filename="segreto\.png"/);
    expect(content.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    expect(content.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(Buffer.from(await content.arrayBuffer()).equals(png(8, 6))).toBe(true);
    const download = await t.api('GET', `/api/files/${meta.id}/content?download=1`);
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/);

    expect(await t.json('GET', `/api/files/${meta.id}`)).toEqual(meta);
    expect(
      (await t.json<{ files: FileMeta[] }>('GET', '/api/files?kind=image')).files,
    ).toHaveLength(1);
    expect(
      (await t.json<{ files: FileMeta[] }>('GET', '/api/files?kind=documents')).files,
    ).toHaveLength(0);
    expect((await t.api('GET', '/api/files/..%2F..%2Fetc%2Fpasswd/content')).status).toBe(404);
    expect((await t.api('GET', `/api/files/${meta.id}/thumb`)).status).toBe(404);

    const del = await t.api('DELETE', `/api/files/${meta.id}`);
    expect(del.status).toBe(200);
    // In the trash for a few seconds (U2-32): gone for everyone, bytes kept for the undo.
    expect(existsSync(join(root, meta.path))).toBe(true);
    expect((await t.api('GET', `/api/files/${meta.id}`)).status).toBe(404);
    expect((await t.api('GET', `/api/files/${meta.id}/content`)).status).toBe(404);
    // The chat asks its files by id together (D-086): a deleted one is absent, not a 404.
    const byIds = await t.api('GET', `/api/files?ids=${meta.id},01ZZZZZZZZZZZZZZZZZZZZZZZZ`);
    expect(byIds.status).toBe(200);
    expect(await byIds.json()).toEqual({ files: [] });
    expect((await t.api('GET', '/api/files?ids=a/b')).status).toBe(400);
    expect(
      t
        .events()
        .some((e) => e.type === 'file' && e.data.action === 'deleted' && e.data.id === meta.id),
    ).toBe(true);
  });

  it('brings a deleted file back with "restore" while it is in the trash (U2-32)', async () => {
    const t = await startTestHub({});
    const meta = (await (await upload(t, form(png(8, 6), 'foto.png'))).json()) as FileMeta;
    const root = t.core.hub.vault.root;
    expect((await t.api('DELETE', `/api/files/${meta.id}`)).status).toBe(200);
    expect((await t.api('GET', `/api/files/${meta.id}`)).status).toBe(404);

    const back = await t.api('POST', `/api/files/${meta.id}/restore`);
    expect(back.status).toBe(200);
    expect(await back.json()).toEqual(meta);
    expect((await t.api('GET', `/api/files/${meta.id}/content`)).status).toBe(200);
    expect(
      (await t.json<{ files: FileMeta[] }>('GET', '/api/files')).files.map((f) => f.id),
    ).toEqual([meta.id]);
    // Not in the trash any more: nothing to bring back.
    expect((await t.api('POST', `/api/files/${meta.id}/restore`)).status).toBe(404);

    // Once the trash is emptied the file is really gone.
    expect((await t.api('DELETE', `/api/files/${meta.id}`)).status).toBe(200);
    expect(t.core.hub.files.purgeTrash(true)).toBe(1);
    expect(existsSync(join(root, meta.path))).toBe(false);
    expect((await t.api('POST', `/api/files/${meta.id}/restore`)).status).toBe(404);
    expect((await t.api('POST', '/api/files/01ZZZZZZZZZZZZZZZZZZZZZZZZ/restore')).status).toBe(404);
  });

  it('refuses unknown types, HTML from the user, and too much', async () => {
    const t = await startTestHub({});
    const exe = await upload(t, form(Buffer.from([0x4d, 0x5a, 0x90, 0, 3]), 'setup.exe'));
    expect(exe.status).toBe(415);
    expect(((await exe.json()) as { error: string }).error).toBe('unsupported_type');
    const html = await upload(
      t,
      form(Buffer.from('<!doctype html><script>fetch("/api/me")</script>'), 'x.html'),
    );
    expect(html.status).toBe(415);
    const big = await upload(t, form(Buffer.alloc(FILE_MAX_BYTES + 1024, 0x61), 'big.txt'));
    expect(big.status).toBe(413);
    expect(((await big.json()) as { error: string }).error).toBe('file_too_large');
    // A declared length past the ceiling is refused before a byte of the body is read.
    const token = readFileSync(t.core.paths.cliToken, 'utf8').trim();
    const declared = await new Promise<number>((resolve, reject) => {
      const req = request(`${t.core.url}/api/files`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'multipart/form-data; boundary=x',
          'content-length': String(FILE_MAX_BYTES * 2),
        },
      });
      req.on('response', (res) => {
        resolve(res.statusCode ?? 0);
        req.destroy();
      });
      req.on('error', reject);
      req.write('--x\r\n');
    });
    expect(declared).toBe(413);
    expect((await upload(t, new FormData())).status).toBe(400);
    expect((await upload(t, form(png(), 'a.png', { agent: 'nessuno' }))).status).toBe(404);
  });

  it('a browser upload needs the session, the anti-CSRF header and the right origin', async () => {
    const t = await startTestHub({});
    const auth = await browserSession(await setupUser(t.core));
    const send = (headers: Record<string, string>) =>
      fetch(`${t.core.url}/api/files`, {
        method: 'POST',
        headers: { ...auth, ...headers },
        body: form(png(), 'a.png'),
      });
    const anonymous = await fetch(`${t.core.url}/api/files`, {
      method: 'POST',
      headers: { 'x-monsters-request': '1' },
      body: form(png(), 'a.png'),
    });
    expect(anonymous.status).toBe(401);
    expect((await send({})).status).toBe(403);
    expect((await send({ 'x-monsters-request': '1', origin: 'https://evil.example' })).status).toBe(
      403,
    );
    expect((await send({ 'x-monsters-request': '1' })).status).toBe(201);
    // Multipart is let through on the upload only.
    const elsewhere = await fetch(`${t.core.url}/api/messages`, {
      method: 'POST',
      headers: { ...auth, 'x-monsters-request': '1' },
      body: form(png(), 'a.png'),
    });
    expect(elsewhere.status).toBe(415);
  });
});

// A test that pins the Italian family restores the English one.
afterEach(() => setAppLang('en'));

describe('files in the chat', () => {
  it('a message carries its files to the model; past ones become a line with the names', async () => {
    setAppLang('it');
    const t = await startTestHub(
      { titan: [fake.text('Visto.'), fake.text('Ok.')] },
      { lang: 'it' },
    );
    const image = (await (await upload(t, form(png(), 'gatto.png'))).json()) as FileMeta;
    const letter = (await (
      await upload(t, form(docx(['Cara Anna, il preventivo è 900 euro']), 'lettera.docx'))
    ).json()) as FileMeta;
    const sent = await t.json<Sent>('POST', '/api/messages', {
      text: 'guarda questi',
      attachments: [image.id, letter.id],
    });
    await t.runEnded(sent.runId);
    const message = t
      .events(sent.runId)
      .find((e): e is LogEvent<'message'> => e.type === 'message' && e.agent === 'user');
    expect(message?.data.attachments).toEqual([image.id, letter.id]);
    expect(t.core.hub.files.get(image.id)?.messageId).toBe(message?.id);
    expect(t.core.hub.files.get(image.id)?.agent).toBe('titan');

    const first = promptText(t.provider.callsTo('titan')[0]!.options.prompt);
    // The fake model does not see: the name and the instruction to say so, never the bytes.
    expect(first).toContain('gatto.png');
    expect(first).toContain('non vede le immagini');
    expect(first).toContain('Cara Anna, il preventivo è 900 euro');

    const again = await t.json<Sent>('POST', '/api/messages', { text: 'e quindi?' });
    await t.runEnded(again.runId);
    const second = promptText(t.provider.callsTo('titan')[1]!.options.prompt);
    expect(second).toContain('[Allegati di questo messaggio: gatto.png (immagine');
    expect(second).not.toContain('Cara Anna');
  });

  it('English family: a message carries its files to the model; past ones become a line (D-153)', async () => {
    const t = await startTestHub({ titan: [fake.text('Seen.'), fake.text('Ok.')] });
    const image = (await (await upload(t, form(png(), 'gatto.png'))).json()) as FileMeta;
    const letter = (await (
      await upload(t, form(docx(['Dear Anna, the quote is 900 euros']), 'lettera.docx'))
    ).json()) as FileMeta;
    const sent = await t.json<Sent>('POST', '/api/messages', {
      text: 'look at these',
      attachments: [image.id, letter.id],
    });
    await t.runEnded(sent.runId);
    const first = promptText(t.provider.callsTo('titan')[0]!.options.prompt);
    expect(first).toContain('gatto.png');
    expect(first).toContain('can’t see images');
    expect(first).toContain('Dear Anna, the quote is 900 euros');
    expect(first).toContain('<attachment name=');
    const again = await t.json<Sent>('POST', '/api/messages', { text: 'so?' });
    await t.runEnded(again.runId);
    const second = promptText(t.provider.callsTo('titan')[1]!.options.prompt);
    expect(second).toContain('[Attachments of this message: gatto.png (image');
    expect(second).toContain('stays valid');
  });

  it('a later turn keeps its answers about a file and reads it again with file_read (review of 16/10)', async () => {
    setAppLang('it');
    const steps = [fake.text('Il preventivo nella lettera è 900 euro.')];
    const t = await startTestHub({ titan: steps }, { lang: 'it' });
    const letter = (await (
      await upload(t, form(docx(['Cara Anna, il preventivo è 900 euro']), 'lettera.docx'))
    ).json()) as FileMeta;
    const stray = (await (
      await upload(t, form(docx(['Non è tuo']), 'altro.docx'))
    ).json()) as FileMeta;
    await t.core.hub.files.ready([letter.id, stray.id]);
    const first = await t.json<Sent>('POST', '/api/messages', {
      text: 'quanto è il preventivo?',
      attachments: [letter.id],
    });
    await t.runEnded(first.runId);
    // The ids are known now: the next turn reads the letter, then a file of no conversation.
    steps.push(
      fake.toolCall('file_read', { file: letter.id }),
      fake.toolCall('file_read', { file: stray.id }),
      fake.text('A Anna.'),
      fake.text('Sole a Milano.'),
    );
    const again = await t.json<Sent>('POST', '/api/messages', {
      text: 'rileggi la lettera: a chi è scritta?',
    });
    expect((await t.runEnded(again.runId)).data.status).toBe('completed');
    const calls = t.provider.callsTo('titan');
    const second = promptText(calls[1]!.options.prompt);
    expect(second).toContain(`file id ${letter.id}`);
    expect(second).toContain('resta valido');
    expect(second).not.toMatch(/Non li hai più davanti|rimandarli/);
    expect((calls[1]!.options.tools ?? []).map((x) => x.name)).toContain('file_read');
    // Its text comes back, as data; a file of another conversation stays closed.
    const seen = toolResultsSeen(calls[3]!.options.prompt);
    expect(seen).toContain('Cara Anna, il preventivo è 900 euro');
    expect(seen).toContain('dati_esterni');
    expect(seen).toContain('BLOCKED_BY_POLICY');
    expect(seen).not.toContain('Non è tuo');
    // A conversation with no files gets no file_read.
    await t.json('POST', '/api/conversations', {});
    const plain = await t.json<Sent>('POST', '/api/messages', { text: 'che tempo fa?' });
    await t.runEnded(plain.runId);
    const last = t.provider.callsTo('titan').at(-1)!;
    expect(promptText(last.options.prompt)).not.toContain('Cara Anna');
    expect((last.options.tools ?? []).map((x) => x.name)).not.toContain('file_read');
  });

  it('a message may be only files; an unknown file is refused', async () => {
    const t = await startTestHub({ titan: [fake.text('Un PDF.')] });
    const doc = (await (
      await upload(t, form(pdf('Fattura 42'), 'fattura.pdf'))
    ).json()) as FileMeta;
    await t.core.hub.files.ready([doc.id]);
    expect(t.core.hub.files.get(doc.id)?.hasText).toBe(true);
    const missing = await t.api('POST', '/api/messages', {
      text: 'x',
      attachments: ['01JXXXXXXXXXXXXXXXXXXXXXXX'],
    });
    expect(missing.status).toBe(404);
    expect((await t.api('POST', '/api/messages', { text: ' ' })).status).toBe(400);
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '', attachments: [doc.id] });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    expect(promptText(t.provider.callsTo('titan')[0]!.options.prompt)).toContain('Fattura 42');
  });

  it('artifact_create saves an HTML page among the files, served in a sandbox', async () => {
    const html =
      '<!doctype html><html><body><h1>Prezzi</h1><script>document.title="x"</script></body></html>';
    const t = await startTestHub({
      titan: [
        fake.toolCall('artifact_create', {
          name: 'confronto prezzi',
          html,
          title: 'Confronto prezzi',
        }),
        fake.text('Ho creato la pagina.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', {
      text: 'fammi una pagina coi prezzi',
    });
    await t.runEnded(sent.runId);
    const event = t.events(sent.runId).find((e): e is LogEvent<'file'> => e.type === 'file');
    expect(event?.agent).toBe('titan');
    expect(event?.data).toMatchObject({
      action: 'created',
      name: 'confronto prezzi.html',
      kind: 'html',
      source: 'agent',
      tool: 'artifact_create',
      title: 'Confronto prezzi',
    });
    const meta = t.core.hub.files.get(event!.data.id)!;
    expect(meta).toMatchObject({ source: 'agent', agent: 'titan', runId: sent.runId });
    const content = await t.api('GET', `/api/files/${meta.id}/content`);
    expect(content.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(content.headers.get('content-security-policy')).toBe(HTML_CSP);
    expect(HTML_CSP).toMatch(/^sandbox allow-scripts;/);
    expect(HTML_CSP).not.toMatch(/allow-same-origin/);
    // The page with the lockdown first (D-085): no network API, no frames.
    const served = await content.text();
    expect(served.startsWith('<!doctype html><script>')).toBe(true);
    expect(served.endsWith(html.slice('<!doctype html>'.length))).toBe(true);
    const download = await t.api('GET', `/api/files/${meta.id}/content?download=1`);
    expect(await download.text()).toBe(html);
    // The tool told the model where the page went.
    expect(promptText(t.provider.callsTo('titan')[1]!.options.prompt)).toContain(
      'confronto prezzi.html',
    );
  });

  it('artifact_create refuses a page over 2 MB', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('artifact_create', {
          name: 'big',
          html: `<!doctype html>${'x'.repeat(2 * 1024 * 1024)}`,
        }),
        fake.text('Troppo grande.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'pagina enorme' });
    await t.runEnded(sent.runId);
    expect(t.core.hub.files.list()).toHaveLength(0);
    expect(promptText(t.provider.callsTo('titan')[1]!.options.prompt)).toContain('at most 2 MB');
  });

  it('a File/ of the user stays notes: the files go to File di Monsters/', async () => {
    const home = tempHome();
    const notes = join(home, 'Monsters Note');
    mkdirSync(join(notes, 'File'), { recursive: true });
    writeFileSync(join(notes, 'File', 'Fatture.md'), '# Fatture\n\nLuce e gas.\n');
    const t = await startTestHub({}, { home });
    const meta = (await (await upload(t, form(png(), 'a.png'))).json()) as FileMeta;
    expect(meta.path).toMatch(/^File di Monsters\//);
    const user = { agentId: 'user' };
    const note = await t.core.hub.vault.read(user, { path: 'File/Fatture.md' });
    expect(note.content).toContain('Luce e gas.');
    const listed = await t.core.hub.vault.list(user, { folder: '' });
    expect(listed.folders).toContain('File');
    expect(listed.folders).not.toContain('File di Monsters');
  });

  it('the vault does not see File/: no notes, no listing, no vault tools', async () => {
    const t = await startTestHub({});
    await upload(t, form(Buffer.from('# appunti'), 'appunti.md'));
    const vault = t.core.hub.vault;
    await vault.sync();
    const user = { agentId: 'user' };
    expect((await vault.list(user, { folder: '' })).folders).not.toContain('File');
    expect(
      (await vault.list(user, { folder: '', recursive: true })).files.map((f) => f.path),
    ).not.toEqual(expect.arrayContaining([expect.stringMatching(/^File\//)]));
    const path = t.core.hub.files.list()[0]!.path;
    await expect(vault.read(user, { path })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(vault.write(user, { path: 'File/nota', content: 'x' })).rejects.toMatchObject({
      code: 'BLOCKED_BY_POLICY',
    });
  });
});
