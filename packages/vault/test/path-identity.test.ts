import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { ToolError } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { KeyedMutex } from '../src/concurrency.ts';
import { probePathIdentity } from '../src/fsutil.ts';
import { EXACT_PATHS, lockKeyOf, pathId, type PathIdentity } from '../src/paths.ts';
import { VaultService } from '../src/index.ts';
import { actor, newVault, tempDir, track } from './helpers.ts';

/*
 * Review of 28/10 (vault, D-219): on macOS and Windows `Idee.md` and `idee.md` (and an NFC and
 * an NFD name) are one file, but the index and the locks compared the spelling, so two monsters
 * writing the two spellings had two rows and two locks and one edit was lost. The identity of a
 * path comes from the file system under the vault (probed), not from the platform. These tests
 * run on Linux: the case-insensitive volume is injected (`pathIdentity`), and one test probes
 * the real file system.
 */

const titan = () => actor('titan');
const FOLDING: PathIdentity = { foldCase: true, foldUnicode: true };

async function foldingVault(identity: PathIdentity = FOLDING): Promise<VaultService> {
  return newVault({ pathIdentity: identity });
}

/** Rows of the index, as their paths. */
function rows(vault: VaultService, like: string): string[] {
  return vault.index.db
    .all<{ path: string }>('SELECT path FROM vault_notes WHERE path LIKE ? ORDER BY path', like)
    .map((r) => r.path);
}

describe('identity of a path', () => {
  it('is NFC, and lower case where the file system folds case', () => {
    const nfd = 'Città.md'.normalize('NFD');
    expect(pathId('Idee.md', EXACT_PATHS)).toBe('Idee.md');
    expect(pathId('Idee.md', { foldCase: true, foldUnicode: false })).toBe('idee.md');
    expect(pathId(nfd, { foldCase: false, foldUnicode: true })).toBe(nfd.normalize('NFC'));
    expect(pathId('Cità.md', FOLDING)).toBe(pathId('CITÀ.md', FOLDING).toLowerCase());
    // The lock key is wider: NFC always.
    expect(lockKeyOf(nfd, EXACT_PATHS)).toBe(nfd.normalize('NFC'));
  });

  it('is shared by the locks: two spellings wait for each other', async () => {
    const mutex = new KeyedMutex((k) => lockKeyOf(k, FOLDING));
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = mutex.withLocks(['Idee.md'], async () => {
      order.push('first in');
      await gate;
      order.push('first out');
    });
    const second = mutex.withLocks(['idee.md'], () => {
      order.push('second');
      return Promise.resolve();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(['first in']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first in', 'first out', 'second']);
  });
});

describe('a vault on a file system that ignores case and accents', () => {
  it('writes `idee.md` into the note `Idee.md`: one file, one row', async () => {
    const vault = await foldingVault();
    const created = await vault.write(titan(), { path: 'Inbox/Idee.md', content: 'uno' });
    const second = await vault.write(titan(), {
      path: 'inbox/idee.md',
      content: 'due',
      mode: 'overwrite',
      base_hash: created.hash,
    });
    expect(second.path).toBe('Inbox/Idee.md');
    expect(readFileSync(join(vault.root, 'Inbox/Idee.md'), 'utf8')).toContain('due');
    expect(rows(vault, '%dee.md')).toEqual(['Inbox/Idee.md']);
    expect(readdirSync(join(vault.root, 'Inbox'))).not.toContain('idee.md');
    // The row is found by any spelling and shows the real one.
    expect(vault.index.get('INBOX/IDEE.MD')?.path).toBe('Inbox/Idee.md');
  });

  it('refuses to create `idee.md` when `Idee.md` is there, and reads either spelling', async () => {
    const vault = await foldingVault();
    await vault.write(titan(), { path: 'Inbox/Idee.md', content: 'uno' });
    await expect(
      vault.write(titan(), { path: 'Inbox/idee.md', content: 'x' }),
    ).rejects.toMatchObject({ code: 'EXISTS' });
    const read = await vault.read(titan(), { path: 'Inbox/idee' });
    expect(read.path).toBe('Inbox/Idee.md');
    expect((await vault.read(titan(), { path: 'inbox/IDEE.md' })).path).toBe('Inbox/Idee.md');
  });

  it('serializes two monsters writing the two spellings: one edit wins, the other conflicts', async () => {
    const vault = await foldingVault();
    const created = await vault.write(titan(), { path: 'Inbox/Idee.md', content: 'uno' });
    const edits = await Promise.allSettled(
      ['Inbox/Idee.md', 'Inbox/idee.md', 'inbox/IDEE.md', 'Inbox/Idee.md'].map((path, i) =>
        vault.write(titan(), {
          path,
          content: `versione ${i}`,
          mode: 'overwrite',
          base_hash: created.hash,
        }),
      ),
    );
    expect(edits.filter((e) => e.status === 'fulfilled')).toHaveLength(1);
    for (const e of edits) {
      if (e.status === 'rejected') expect((e.reason as ToolError).code).toBe('CONFLICT');
    }
    expect(rows(vault, '%dee.md')).toEqual(['Inbox/Idee.md']);
  });

  it('keeps the spelling of the folders that exist', async () => {
    const vault = await foldingVault();
    await vault.write(titan(), { path: 'Progetti/Alfa/Nota.md', content: 'uno' });
    const written = await vault.write(titan(), { path: 'progetti/ALFA/Altra.md', content: 'due' });
    expect(written.path).toBe('Progetti/ALFA/Altra.md'.replace('ALFA', 'Alfa'));
    expect(existsSync(join(vault.root, 'Progetti/Alfa/Altra.md'))).toBe(true);
    expect(existsSync(join(vault.root, 'progetti'))).toBe(false);
    // A part that does not exist yet keeps the spelling asked for.
    const deeper = await vault.write(titan(), {
      path: 'progetti/alfa/Nuova/Nota.md',
      content: 'x',
    });
    expect(deeper.path).toBe('Progetti/Alfa/Nuova/Nota.md');
  });

  it('finds a note on disk that the index does not know (the folder is walked)', async () => {
    const vault = await foldingVault();
    writeFileSync(join(vault.root, 'Inbox/Fuori.md'), 'scritta da Obsidian');
    // Not indexed yet: the spelling comes from the folder, so the existing note is met.
    const err = await vault
      .write(titan(), { path: 'inbox/fuori.md', content: 'x' })
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('EXISTS');
    expect((err as ToolError).message).toContain('Inbox/Fuori.md');
    expect(readdirSync(join(vault.root, 'Inbox'))).not.toContain('fuori.md');
  });

  it('treats NFC and NFD names as one note', async () => {
    const vault = await foldingVault();
    const nfc = 'Inbox/Città.md';
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    const created = await vault.write(titan(), { path: nfc, content: 'uno' });
    const second = await vault.write(titan(), {
      path: nfd,
      content: 'due',
      mode: 'overwrite',
      base_hash: created.hash,
    });
    expect(second.path).toBe(nfc);
    expect(rows(vault, 'Inbox/Citt%')).toHaveLength(1);
    await expect(vault.write(titan(), { path: nfd, content: 'x' })).rejects.toMatchObject({
      code: 'EXISTS',
    });
  });

  it('a sync takes the spelling the file really has now, without a second row', async () => {
    const vault = await foldingVault();
    await vault.write(titan(), { path: 'Inbox/Idee.md', content: 'uno' });
    const nid = vault.index.get('Inbox/Idee.md')?.nid;
    renameSync(join(vault.root, 'Inbox/Idee.md'), join(vault.root, 'Inbox/idee.md'));
    const result = await vault.sync();
    expect(result.removed).toBe(0);
    expect(rows(vault, '%dee.md')).toEqual(['Inbox/idee.md']);
    expect(vault.index.get('Inbox/Idee.md')?.nid).toBe(nid);
    // The next sync has nothing to do.
    expect((await vault.sync()).indexed).toBe(0);
  });

  it('moves into an existing folder under its real spelling, and explains a case-only rename', async () => {
    const vault = await foldingVault();
    await vault.write(titan(), { path: 'Progetti/Alfa/Nota.md', content: 'uno' });
    await vault.write(titan(), { path: 'Inbox/Spostata.md', content: 'due' });
    const moved = await vault.move(titan(), {
      from: 'Inbox/Spostata.md',
      to: 'progetti/alfa/Spostata.md',
    });
    expect(moved.path).toBe('Progetti/Alfa/Spostata.md');
    expect(rows(vault, '%postata.md')).toEqual(['Progetti/Alfa/Spostata.md']);

    const err = await vault
      .move(titan(), { from: 'Progetti/Alfa/Spostata.md', to: 'Progetti/Alfa/spostata.md' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe('INVALID_INPUT');
    expect((err as ToolError).hint).toContain('temporary name');
    // Nothing was touched, and the two steps work.
    expect(existsSync(join(vault.root, 'Progetti/Alfa/Spostata.md'))).toBe(true);
    await vault.move(titan(), { from: 'Progetti/Alfa/Spostata.md', to: 'Progetti/Alfa/Tmp.md' });
    const back = await vault.move(titan(), {
      from: 'Progetti/Alfa/Tmp.md',
      to: 'Progetti/Alfa/spostata.md',
    });
    expect(back.path).toBe('Progetti/Alfa/spostata.md');
    expect(rows(vault, '%postata.md')).toEqual(['Progetti/Alfa/spostata.md']);
  });

  it('rebuilds the index when the answer of the file system changes, keeping one row per file', async () => {
    const dir = tempDir();
    const root = join(dir, 'Vault');
    mkdirSync(join(root, 'Inbox'), { recursive: true });
    writeFileSync(join(root, 'Inbox/Idee.md'), 'uno');
    const indexPath = join(dir, 'index.sqlite');
    const exact = track(
      await VaultService.open({ root, indexPath, git: false, pathIdentity: EXACT_PATHS }),
    );
    expect(exact.index.get('Inbox/idee.md')).toBeUndefined();
    await exact.close();

    const folding = track(
      await VaultService.open({ root, indexPath, git: false, pathIdentity: FOLDING }),
    );
    expect(folding.index.get('Inbox/idee.md')?.path).toBe('Inbox/Idee.md');
    expect(folding.index.count()).toBe(1);
  });
});

describe('a file system that tells names apart (Linux)', () => {
  it('keeps `Idee.md` and `idee.md` as two notes', async () => {
    const vault = await newVault({ pathIdentity: EXACT_PATHS });
    await vault.write(titan(), { path: 'Inbox/Idee.md', content: 'uno' });
    await vault.write(titan(), { path: 'Inbox/idee.md', content: 'due' });
    expect(rows(vault, '%dee.md')).toEqual(['Inbox/Idee.md', 'Inbox/idee.md']);
  });
});

describe('probing the real file system', () => {
  it('says what the file system under a folder does, and leaves nothing behind', async () => {
    const dir = tempDir();
    const identity = await probePathIdentity(dir);
    // Asked independently: a file with letters of both cases and an accent, looked up by others.
    writeFileSync(join(dir, 'ProbeAbé'), '');
    expect(identity.foldCase).toBe(existsSync(join(dir, 'probeabé')));
    expect(identity.foldUnicode).toBe(existsSync(join(dir, 'ProbeAbé'.normalize('NFD'))));
    expect(readdirSync(dir)).toEqual(['ProbeAbé']);
  });

  it('is what a vault opened without a hint uses', async () => {
    const vault = await newVault();
    const probed = await probePathIdentity(vault.root);
    expect(vault.index.identity).toEqual(probed);
    expect(readdirSync(vault.root).filter((n) => n.startsWith('.monsters-names'))).toEqual([]);
  });

  it('falls back to the platform when the folder cannot be written', async () => {
    const identity = await probePathIdentity(join(tempDir(), 'does', 'not', 'exist'));
    const linux = process.platform !== 'darwin' && process.platform !== 'win32';
    expect(identity).toEqual(linux ? EXACT_PATHS : expect.objectContaining({ foldCase: true }));
  });
});
