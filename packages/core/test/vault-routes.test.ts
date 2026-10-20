import type {
  VaultHistoryEntry,
  VaultNote,
  VaultOverview,
  VaultSearchResponse,
  VaultTrashItem,
  VaultVersion,
  VaultWriteResponse,
} from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { BROWSER_HEADERS, browserSession, setupUser } from './helpers.ts';
import { startTestHub } from './hub-helpers.ts';

/* Vault view of the UI (M2.8): routes under /api/vault used by the web app. */

async function hubWithNotes() {
  const hub = await startTestHub({});
  const vault = hub.core.hub.vault;
  const user = { agentId: 'user' };
  await vault.write(user, {
    path: 'Risorse/Lisbona',
    content: '# Lisbona\n\nTram 28 e [[Pastéis]]. #viaggi\n',
    frontmatter: { tags: ['viaggi'] },
  });
  await vault.write(user, {
    path: 'Risorse/Pastéis',
    content: '# Pastéis\n\nDolci di Belém, vedi [[Lisbona]].\n',
  });
  await vault.write(user, {
    path: 'Privato/Diario segreto',
    content: '# Segreto\n\nSolo per me.\n',
    frontmatter: { private: true },
  });
  return hub;
}

describe('vault routes: guards', () => {
  it('needs a session or a token, the CSRF header and an allowed origin', async () => {
    const { core } = await startTestHub({});
    expect((await fetch(`${core.url}/api/vault/notes`)).status).toBe(401);
    expect((await fetch(`${core.url}/api/vault/trash`)).status).toBe(401);

    const res = await setupUser(core);
    const auth = await browserSession(res);
    expect((await fetch(`${core.url}/api/vault/notes`, { headers: { ...auth } })).status).toBe(200);
    // A state change by cookie without the anti-CSRF header is refused.
    const noCsrf = await fetch(`${core.url}/api/vault/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ path: 'LEGGIMI' }),
    });
    expect(noCsrf.status).toBe(403);
    const foreign = await fetch(`${core.url}/api/vault/restore`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, ...auth, origin: 'https://evil.example' },
      body: JSON.stringify({ path: 'LEGGIMI' }),
    });
    expect(foreign.status).toBe(403);
    const asForm = await fetch(`${core.url}/api/vault/note`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain', 'x-monsters-request': '1', ...auth },
      body: JSON.stringify({ path: 'LEGGIMI', content: 'x', baseHash: 'x' }),
    });
    expect(asForm.status).toBe(415);
    // Nothing was deleted.
    expect((await core.hub.vault.trash({ agentId: 'user' })).length).toBe(0);
  });

  it('refuses paths outside the vault and system folders', async () => {
    const { api } = await startTestHub({});
    const get = (p: string) => api('GET', p);
    expect((await get('/api/vault/note?path=../../etc/passwd')).status).toBe(400);
    expect((await get('/api/vault/note?path=/../secret')).status).toBe(400);
    expect((await get('/api/vault/note?path=.git/config')).status).toBe(403);
    expect((await get('/api/vault/note?path=.obsidian/app.json')).status).toBe(403);
    expect((await get('/api/vault/history?path=../x')).status).toBe(400);
    expect((await get('/api/vault/version?path=../x&commit=abcdef')).status).toBe(400);
    expect((await api('POST', '/api/vault/restore', { path: '../fuori' })).status).toBe(400);
    expect((await api('POST', '/api/vault/restore', { path: '.git/HEAD' })).status).toBe(403);
    expect((await api('POST', '/api/vault/delete', { path: '../../x' })).status).toBe(400);
    expect((await api('POST', '/api/vault/delete', { path: '.trash/x.md' })).status).toBe(403);
    const save = await api('PUT', '/api/vault/note', {
      path: '../evil.md',
      content: 'x',
      baseHash: 'abc',
    });
    expect(save.status).toBe(400);
    const binary = await api('PUT', '/api/vault/note', {
      path: 'Allegati/foto.png',
      content: 'x',
      baseHash: 'abc',
    });
    expect(binary.status).toBe(400);
    expect((await get('/api/vault/note')).status).toBe(400);
    expect((await get('/api/vault/search?mode=telepathy')).status).toBe(400);
  });
});

describe('vault routes: browsing', () => {
  it('lists notes with tags, privacy and links; reads a note with its backlinks', async () => {
    const { json } = await hubWithNotes();
    const overview = await json<VaultOverview>('GET', '/api/vault/notes');
    const paths = overview.notes.map((n) => n.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'Risorse/Lisbona.md',
        'Risorse/Pastéis.md',
        'Privato/Diario segreto.md',
        'LEGGIMI.md',
      ]),
    );
    expect(overview.semantic).toBe('off');
    const lisbon = overview.notes.find((n) => n.path === 'Risorse/Lisbona.md');
    expect(lisbon).toMatchObject({ tags: ['viaggi'], author: 'user', private: false });
    expect(overview.notes.find((n) => n.path === 'Privato/Diario segreto.md')?.private).toBe(true);
    expect(overview.edges).toEqual(
      expect.arrayContaining([
        { from: 'Risorse/Lisbona.md', to: 'Risorse/Pastéis.md', embed: false },
        { from: 'Risorse/Pastéis.md', to: 'Risorse/Lisbona.md', embed: false },
      ]),
    );
    expect(overview.tags).toEqual(expect.arrayContaining([{ tag: 'viaggi', count: 1 }]));

    // By title, like a wikilink.
    const note = await json<VaultNote>(
      'GET',
      `/api/vault/note?path=${encodeURIComponent('Pastéis')}`,
    );
    expect(note).toMatchObject({
      path: 'Risorse/Pastéis.md',
      title: 'Pastéis',
      private: false,
      backlinks: [{ path: 'Risorse/Lisbona.md', title: 'Lisbona' }],
    });
    expect(note.content).toContain('Dolci di Belém');
    const secret = await json<VaultNote>('GET', '/api/vault/note?path=Privato/Diario%20segreto');
    expect(secret.private).toBe(true);
    expect(secret.content).toContain('Solo per me');
  });

  it('searches full-text with filters and finds related notes', async () => {
    const { json, api } = await hubWithNotes();
    const found = await json<VaultSearchResponse>('GET', '/api/vault/search?q=tram&mode=semantic');
    expect(found.mode).toBe('text');
    expect(found.hits.map((h) => h.path)).toEqual(['Risorse/Lisbona.md']);
    const byTag = await json<VaultSearchResponse>('GET', '/api/vault/search?tags=viaggi');
    expect(byTag.hits.map((h) => h.path)).toEqual(['Risorse/Lisbona.md']);
    const inFolder = await json<VaultSearchResponse>(
      'GET',
      '/api/vault/search?q=dolci&folder=Inbox',
    );
    expect(inFolder.hits).toEqual([]);
    const related = await json<VaultSearchResponse>('GET', '/api/vault/related?path=Lisbona');
    expect(related.hits.every((h) => h.path !== 'Risorse/Lisbona.md')).toBe(true);
    expect((await api('GET', '/api/vault/related?path=Nessuna')).status).toBe(404);
  });
});

describe('vault routes: changes by the user', () => {
  it('trashes a note and restores it from the trash, logged as the user', async () => {
    const { json, api, events } = await hubWithNotes();
    const deleted = await json<VaultWriteResponse>('POST', '/api/vault/delete', {
      path: 'Risorse/Pastéis.md',
    });
    expect(deleted).toMatchObject({ ok: true, path: 'Risorse/Pastéis.md' });
    expect((await api('GET', '/api/vault/note?path=Risorse/Pastéis.md')).status).toBe(404);

    const { items } = await json<{ items: VaultTrashItem[] }>('GET', '/api/vault/trash');
    expect(items).toEqual([
      expect.objectContaining({
        trashPath: '.trash/Pastéis.md',
        title: 'Pastéis',
        originalPath: 'Risorse/Pastéis.md',
        deletedBy: 'user',
        actionId: deleted.actionId,
        private: false,
      }),
    ]);

    const restored = await json<VaultWriteResponse>('POST', '/api/vault/restore', {
      path: 'Risorse/Pastéis.md',
    });
    expect(restored.path).toBe('Risorse/Pastéis.md');
    const back = await json<VaultNote>('GET', '/api/vault/note?path=Risorse/Pastéis.md');
    expect(back.content).toContain('Dolci di Belém');
    expect((await json<{ items: VaultTrashItem[] }>('GET', '/api/vault/trash')).items).toEqual([]);

    const changes = events().filter((e) => e.type === 'vault_change' && e.agent === 'user');
    expect(changes.map((e) => (e.data as { action: string }).action).slice(-2)).toEqual([
      'delete',
      'restore',
    ]);
  });

  it('restores the trash entry asked for, also when the path was taken again', async () => {
    const hub = await hubWithNotes();
    const { json, api } = hub;
    const vault = hub.core.hub.vault;
    const user = { agentId: 'user' };
    const path = 'Risorse/Pastéis.md';
    await json('POST', '/api/vault/delete', { path });
    await vault.write(user, { path, content: 'Seconda versione\n' });
    await json('POST', '/api/vault/delete', { path });
    await vault.write(user, { path, content: 'Terza, quella viva\n' });

    const { items } = await json<{ items: VaultTrashItem[] }>('GET', '/api/vault/trash');
    expect(items.map((i) => [i.trashPath, i.originalPath]).sort()).toEqual([
      ['.trash/Pastéis 1.md', path],
      ['.trash/Pastéis.md', path],
    ]);
    // The first deleted (Dolci di Belém), next to the note that took its path.
    const restored = await json<VaultWriteResponse>('POST', '/api/vault/restore', {
      trashPath: '.trash/Pastéis.md',
    });
    expect(restored.path).toBe('Risorse/Pastéis (2).md');
    const back = await json<VaultNote>('GET', `/api/vault/note?path=${restored.path}`);
    expect(back.content).toContain('Dolci di Belém');
    const live = await json<VaultNote>('GET', `/api/vault/note?path=${path}`);
    expect(live.content).toContain('Terza, quella viva');
    const left = await json<{ items: VaultTrashItem[] }>('GET', '/api/vault/trash');
    expect(left.items.map((i) => i.trashPath)).toEqual(['.trash/Pastéis 1.md']);

    expect(
      (await api('POST', '/api/vault/restore', { trashPath: '.trash/Nessuna.md' })).status,
    ).toBe(404);
    expect(
      (await api('POST', '/api/vault/restore', { trashPath: 'Risorse/Lisbona.md' })).status,
    ).toBe(400);
    expect((await api('POST', '/api/vault/restore', {})).status).toBe(400);
  });

  it('saves with the hash read, refuses a stale one, shows history and diff, undoes', async () => {
    const { json, api } = await hubWithNotes();
    const note = await json<VaultNote>('GET', '/api/vault/note?path=Risorse/Lisbona.md');
    const saved = await json<VaultWriteResponse>('PUT', '/api/vault/note', {
      path: note.path,
      content: '# Lisbona\n\nTram 28, Alfama e [[Pastéis]]. #viaggi\n',
      baseHash: note.hash,
    });
    expect(saved.hash).not.toBe(note.hash);
    const stale = await api('PUT', '/api/vault/note', {
      path: note.path,
      content: 'sovrascrivo',
      baseHash: note.hash,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'conflict' });
    // Properties are kept by an edit of the body.
    const after = await json<VaultNote>('GET', '/api/vault/note?path=Risorse/Lisbona.md');
    expect(after.frontmatter).toMatchObject({ tags: ['viaggi'] });

    const { entries } = await json<{ entries: VaultHistoryEntry[] }>(
      'GET',
      '/api/vault/history?path=Risorse/Lisbona.md',
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ author: 'user', actionId: saved.actionId });
    const version = await json<VaultVersion>(
      'GET',
      `/api/vault/version?path=Risorse/Lisbona.md&commit=${entries[0]!.commit.slice(0, 7)}`,
    );
    expect(version.diff).toContain('+Tram 28, Alfama e [[Pastéis]]. #viaggi');
    expect(version.diff).toContain('-Tram 28 e [[Pastéis]]. #viaggi');
    expect(version.before).toContain('Tram 28 e');
    const first = await json<VaultVersion>(
      'GET',
      `/api/vault/version?path=Risorse/Lisbona.md&commit=${entries[1]!.commit}`,
    );
    expect(first.before).toBeNull();
    expect(
      (await api('GET', '/api/vault/version?path=Risorse/Lisbona.md&commit=0000000')).status,
    ).toBe(404);

    // Undo the save with the existing flow (D-024), then restore the saved version.
    await json('POST', '/api/vault/undo', { actionId: saved.actionId });
    const undone = await json<VaultNote>('GET', '/api/vault/note?path=Risorse/Lisbona.md');
    expect(undone.content).toContain('Tram 28 e');
    await json('POST', '/api/vault/restore', {
      path: 'Risorse/Lisbona.md',
      commit: entries[0]!.commit,
    });
    const again = await json<VaultNote>('GET', '/api/vault/note?path=Risorse/Lisbona.md');
    expect(again.content).toContain('Alfama');
  });

  it('creates a new note in a folder as the user, with a commit, never over another', async () => {
    const { json, api, events } = await hubWithNotes();
    const created = await json<VaultWriteResponse>('POST', '/api/vault/note', {
      folder: 'Risorse/',
      title: 'Porto',
      content: 'Vino e [[Lisbona]].\n',
    });
    expect(created).toMatchObject({ ok: true, path: 'Risorse/Porto.md' });
    expect(created.commit).toBeTruthy();
    const note = await json<VaultNote>('GET', '/api/vault/note?path=Risorse/Porto.md');
    expect(note).toMatchObject({ title: 'Porto', author: 'user' });
    expect(note.content).toContain('Vino e [[Lisbona]].');
    const back = await json<VaultNote>('GET', '/api/vault/note?path=Risorse/Lisbona.md');
    expect(back.backlinks.map((b) => b.path)).toContain('Risorse/Porto.md');
    const change = events().find(
      (e) => e.type === 'vault_change' && e.agent === 'user' && e.data.path === 'Risorse/Porto.md',
    );
    expect(change?.data).toMatchObject({ action: 'create', actionId: created.actionId });
    expect((change?.data as { commit?: string } | undefined)?.commit).toBeTruthy();
    // In the main folder, `.md` typed in the title is not doubled.
    expect(
      await json<VaultWriteResponse>('POST', '/api/vault/note', {
        folder: '',
        title: 'Idee.md',
        content: '',
      }),
    ).toMatchObject({ path: 'Idee.md' });

    const taken = await api('POST', '/api/vault/note', {
      folder: 'Risorse',
      title: 'Porto',
      content: 'altro',
    });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: 'exists' });
    const refused = async (folder: string, title: string) =>
      (await api('POST', '/api/vault/note', { folder, title, content: 'x' })).status;
    expect(await refused('Risorse', 'a/b')).toBe(400);
    expect(await refused('Risorse', 'Due: punti')).toBe(400);
    expect(await refused('Risorse', '   ')).toBe(400);
    expect(await refused('../fuori', 'Nota')).toBeGreaterThanOrEqual(400);
    expect(await refused('.obsidian', 'Nota')).toBe(403);
  });
});
