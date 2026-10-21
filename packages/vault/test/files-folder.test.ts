import { mkdirSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import { join } from 'node:path';
import git from 'isomorphic-git';
import { VAULT_LAYOUTS } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { isFilesPath, VaultService } from '../src/index.ts';
import { actor, PERMISSIONS, tempDir, track } from './helpers.ts';

const FILES_DIR = VAULT_LAYOUTS.it.files;

/*
 * `File/` holds the files of Monsters (D-075): Obsidian sees them, the vault
 * does not. Its own `.gitignore` (written by the core) keeps it out of the
 * history, and the vault never indexes, lists or writes it.
 */

const IGNORE = '# Monsters: i file non entrano nella cronologia delle note\n*\n';

describe('the files folder of Monsters', () => {
  it('is not indexed, listed, read or written, and stays out of the history', async () => {
    const root = join(tempDir(), 'Note');
    mkdirSync(join(root, FILES_DIR, '2026-10'), { recursive: true });
    writeFileSync(join(root, 'Idea.md'), '# Idea\n');
    writeFileSync(join(root, FILES_DIR, '.gitignore'), IGNORE);
    writeFileSync(join(root, FILES_DIR, '2026-10', 'foto.png'), 'png');
    writeFileSync(join(root, FILES_DIR, '2026-10', 'appunti.md'), '# Appunti\n');
    const vault = track(
      await VaultService.open({
        root,
        permissions: PERMISSIONS,
        initGit: true,
        filesDir: FILES_DIR,
      }),
    );
    const user = actor('user');
    const all = await vault.list(user, { folder: '', recursive: true });
    expect(all.files.map((f) => f.path)).toEqual(['Idea.md']);
    expect((await vault.list(user, { folder: '' })).folders).not.toContain(FILES_DIR);
    await expect(vault.read(user, { path: 'File/2026-10/appunti.md' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(vault.list(user, { folder: 'File' })).rejects.toMatchObject({
      code: 'BLOCKED_BY_POLICY',
    });
    await expect(vault.write(user, { path: 'File/nota', content: 'x' })).rejects.toMatchObject({
      code: 'BLOCKED_BY_POLICY',
    });
    // The first commit of the history has the note, not the files.
    const head = await git.resolveRef({ fs, dir: root, ref: 'HEAD' });
    const tracked = await git.listFiles({ fs, dir: root, ref: head });
    expect(tracked).toContain('Idea.md');
    expect(tracked.some((p) => p.startsWith(`${FILES_DIR}/`))).toBe(false);
    expect(await git.isIgnored({ fs, dir: root, filepath: 'File/2026-10/foto.png' })).toBe(true);
  });

  it('tells a path of the files folder from a note called File', () => {
    expect(isFilesPath('File/2026-10/a.png', 'File')).toBe(true);
    expect(isFilesPath('file/x', 'File')).toBe(true);
    expect(isFilesPath('File.md', 'File')).toBe(false);
    expect(isFilesPath('Progetti/File/x.md', 'File')).toBe(false);
    expect(isFilesPath('File/x.md', null)).toBe(false);
    expect(isFilesPath('File di Monsters/x.png', 'File di Monsters')).toBe(true);
  });

  it('without a files folder, a File/ of the user is a folder of notes like any other', async () => {
    const root = join(tempDir(), 'Note');
    mkdirSync(join(root, 'File'), { recursive: true });
    writeFileSync(join(root, 'File', 'Fatture.md'), '# Fatture\n');
    const vault = track(await VaultService.open({ root, permissions: PERMISSIONS, initGit: true }));
    const all = await vault.list(actor('user'), { folder: '', recursive: true });
    expect(all.files.map((f) => f.path)).toEqual(['File/Fatture.md']);
  });
});
