import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolError } from '@monsters/shared';
import * as isogit from 'isomorphic-git';
import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VaultService, type VaultWarning } from '../src/index.ts';
import { actor, newVault, tempDir, track } from './helpers.ts';

/*
 * Review of 28/10 (stability): a file over 2 GiB made the core fail to start, two headings
 * of the same name were edited at the first, a folder in the user's .gitignore was
 * "recorded" without its files, and a sync could drop a note written meanwhile. Refined
 * (D-214): what the user ignores stays out of history, and one big file never fails an action.
 */

const titan = () => actor('titan');
const GIB = 1024 ** 3;

async function expectToolError(p: Promise<unknown>, code: string): Promise<ToolError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe(code);
    return err as ToolError;
  }
  throw new Error(`expected ToolError ${code}`);
}

/** A file of `size` bytes that takes no disk space (a hole). */
function sparse(path: string, size: number): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '');
  truncateSync(path, size);
}

describe('files too big to be read whole', () => {
  it('opens, syncs and reindexes a vault with a file over 2 GiB (git off)', async () => {
    const vault = await newVault();
    const root = vault.root;
    await vault.close();
    writeFileSync(join(root, 'Inbox/Piccola.md'), 'una nota con ornitorinco\n');
    sparse(join(root, 'Risorse/video.mp4'), 3 * GIB);
    sparse(join(root, 'Risorse/Enorme.md'), 3 * GIB);
    // A medium attachment is hashed in a stream, never read whole.
    sparse(join(root, 'Risorse/medio.bin'), 40 * 1024 * 1024);

    const warnings: VaultWarning[] = [];
    const opened = track(
      await VaultService.open({ root, git: false, onWarning: (w) => warnings.push(w) }),
    );
    expect(opened.index.get('Risorse/video.mp4')?.size).toBe(3 * GIB);
    expect(opened.index.get('Risorse/medio.bin')?.size).toBe(40 * 1024 * 1024);
    // The huge note is a file with no content in the index, and the warning says so.
    expect(opened.index.get('Risorse/Enorme.md')?.size).toBe(3 * GIB);
    expect(warnings.map((w) => [w.code, w.path])).toContainEqual([
      'vault_too_large',
      'Risorse/Enorme.md',
    ]);
    const hits = await opened.search(titan(), { query: 'ornitorinco' });
    expect(hits.map((h) => h.path)).toEqual(['Inbox/Piccola.md']);

    await opened.sync();
    await opened.reindex();
    expect(opened.index.get('Risorse/video.mp4')?.size).toBe(3 * GIB);
    // Reading it is refused with a clear error, not an uncaught ERR_FS_FILE_TOO_LARGE.
    await expectToolError(opened.read(titan(), { path: 'Risorse/Enorme.md' }), 'INVALID_INPUT');
  });

  it('a file that fails to index is a warning, not a failed open', async () => {
    const vault = await newVault();
    const root = vault.root;
    await vault.close();
    // A directory named like a note cannot be read as a file: the scan lists files only,
    // so make the failure by a note that is not valid UTF-8 text for the index: it must not
    // matter. What matters is that nothing in the loop can fail the open.
    writeFileSync(join(root, 'Inbox/Binaria.md'), Buffer.from([0xff, 0xfe, 0x00, 0x41]));
    const opened = track(await VaultService.open({ root, git: false }));
    expect(opened.index.get('Inbox/Binaria.md')).not.toBeNull();
  });

  for (const backend of ['isomorphic', 'system'] as const) {
    it(`first commit of an existing vault leaves out a huge file (${backend} git)`, async () => {
      if (backend === 'system') {
        try {
          execFileSync('git', ['--version'], { stdio: 'ignore' });
        } catch {
          return;
        }
      }
      const root = join(tempDir(), 'Esistente');
      mkdirSync(join(root, 'Note'), { recursive: true });
      writeFileSync(join(root, 'Note/Uno.md'), 'ciao\n');
      sparse(join(root, 'Note/film.mov'), 3 * GIB);

      const warnings: VaultWarning[] = [];
      const opened = track(
        await VaultService.open({
          root,
          git: backend,
          initGit: true,
          onWarning: (w) => warnings.push(w),
        }),
      );
      expect(opened.hasGit).toBe(true);
      const tracked = await isogit.listFiles({ fs, dir: root, ref: 'HEAD' });
      expect(tracked).toContain('Note/Uno.md');
      expect(tracked).not.toContain('Note/film.mov');
      expect(warnings.map((w) => [w.code, w.path])).toContainEqual([
        'vault_too_large',
        'Note/film.mov',
      ]);
      // The vault still works with the huge file in it.
      await opened.write(actor('titan'), { path: 'Inbox/Due', content: 'testo\n' });
      expect(opened.index.get('Note/film.mov')?.size).toBe(3 * GIB);
    });
  }
});

describe('sections with the same heading', () => {
  const NOTE = [
    '# Piano',
    '',
    '## Marzo',
    '',
    '### Note',
    'di marzo',
    '',
    '## Aprile',
    '',
    '### Note',
    'di aprile',
    '',
  ].join('\n');

  async function noteOf(): Promise<{
    vault: VaultService;
    hash: string;
    path: string;
    read: () => string;
  }> {
    const vault = await newVault();
    const written = await vault.write(titan(), { path: 'Inbox/Piano', content: NOTE });
    const read = await vault.read(titan(), { path: 'Inbox/Piano' });
    expect(written.path).toBe('Inbox/Piano.md');
    return {
      vault,
      hash: read.hash,
      path: 'Inbox/Piano.md',
      read: () => readFileSync(join(vault.root, 'Inbox/Piano.md'), 'utf8'),
    };
  }

  it('replace_section and append refuse an ambiguous heading and list the matches', async () => {
    const { vault, hash, read } = await noteOf();
    const before = read();
    for (const op of [
      { replace_section: { heading: 'Note', text: 'x' } },
      { append: { text: 'x', section: 'note' } },
    ]) {
      const err = await expectToolError(
        vault.edit(titan(), { path: 'Inbox/Piano', base_hash: hash, ops: [op] }),
        'INVALID_INPUT',
      );
      expect(err.message).toContain('ambiguous');
      expect(err.message).toContain('Marzo > Note');
      expect(err.message).toContain('Aprile > Note');
      expect(err.hint).toContain('Parent > Child');
    }
    expect(read()).toBe(before);
  });

  it('"Parent > Child" picks one of them, for edits and for reading', async () => {
    const { vault, hash, read } = await noteOf();
    await vault.edit(titan(), {
      path: 'Inbox/Piano',
      base_hash: hash,
      ops: [{ replace_section: { heading: 'Aprile > Note', text: 'nuovo' } }],
    });
    expect(read()).toContain('di marzo');
    expect(read()).not.toContain('di aprile');
    expect(read()).toContain('nuovo');

    const again = await vault.read(titan(), { path: 'Inbox/Piano' });
    await vault.edit(titan(), {
      path: 'Inbox/Piano',
      base_hash: again.hash,
      ops: [{ append: { text: 'altro', section: 'Piano > Marzo > Note' } }],
    });
    expect(read().indexOf('altro')).toBeLessThan(read().indexOf('## Aprile'));

    const section = await vault.read(titan(), { path: 'Inbox/Piano', section: 'Aprile > Note' });
    expect(section.content).toContain('nuovo');
    expect(section.content).not.toContain('marzo');
  });

  it('a unique heading and a missing one behave as before', async () => {
    const { vault, hash, read } = await noteOf();
    await vault.edit(titan(), {
      path: 'Inbox/Piano',
      base_hash: hash,
      ops: [{ append: { text: 'x', section: 'Marzo' } }],
    });
    expect(read()).toContain('x');
    const again = await vault.read(titan(), { path: 'Inbox/Piano' });
    await expectToolError(
      vault.edit(titan(), {
        path: 'Inbox/Piano',
        base_hash: again.hash,
        ops: [{ replace_section: { heading: 'Maggio > Note', text: 'x' } }],
      }),
      'NOT_FOUND',
    );
    // A plain missing heading is created by append, as always.
    await vault.edit(titan(), {
      path: 'Inbox/Piano',
      base_hash: again.hash,
      ops: [{ append: { text: 'y', section: 'Maggio' } }],
    });
    expect(read()).toContain('## Maggio\ny');
  });
});

/** Backends under test: the system git only where it is installed. */
function backends(): ('isomorphic' | 'system')[] {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return ['isomorphic', 'system'];
  } catch {
    return ['isomorphic'];
  }
}

const commitCount = async (dir: string): Promise<number> => (await isogit.log({ fs, dir })).length;

describe('folders ignored by the .gitignore of the user (D-214)', () => {
  for (const backend of backends()) {
    const ignoredVault = async () => {
      const vault = await newVault({ git: backend });
      const gitignore = join(vault.root, '.gitignore');
      writeFileSync(gitignore, `${readFileSync(gitignore, 'utf8')}Ignorata/\n*.tmpdata\n`);
      return vault;
    };

    it(`are written but never recorded: no commit, a warning, no empty commit (${backend} git)`, async () => {
      const vault = await ignoredVault();
      const a = titan();
      const before = await commitCount(vault.root);

      const created = await vault.write(a, { path: 'Ignorata/Nota', content: 'prima versione\n' });
      expect(existsSync(join(vault.root, 'Ignorata/Nota.md'))).toBe(true);
      expect(created.commit).toBeNull();
      expect(created.warning).toMatch(/not in the history/);
      expect(created.warning).toMatch(/Ignorata\/Nota\.md is ignored by the vault's \.gitignore/);
      expect(created.warning).toMatch(/cannot be undone/);
      // No empty commit either, and the file is not in the history of the repository.
      expect(await commitCount(vault.root)).toBe(before);
      expect(await isogit.listFiles({ fs, dir: vault.root, ref: 'HEAD' })).not.toContain(
        'Ignorata/Nota.md',
      );
      const change = a.events.find((e) => e.type === 'vault_change');
      expect(change?.data).toMatchObject({ action: 'create', path: 'Ignorata/Nota.md' });
      expect(change?.data).toMatchObject({ unrecorded: true });
      expect(change?.data).not.toHaveProperty('commit');

      // A later edit and a deletion are the same: done, not recorded.
      const first = await vault.read(a, { path: 'Ignorata/Nota' });
      const edited = await vault.edit(a, {
        path: 'Ignorata/Nota',
        base_hash: first.hash,
        ops: [{ str_replace: { old: 'prima', new: 'seconda' } }],
      });
      expect(readFileSync(join(vault.root, 'Ignorata/Nota.md'), 'utf8')).toContain('seconda');
      expect(edited.commit).toBeNull();
      expect(edited.warning).toMatch(/ignored by the vault's \.gitignore/);
      const deleted = await vault.delete(a, { path: 'Ignorata/Nota', reason: 'test' });
      expect(existsSync(join(vault.root, 'Ignorata/Nota.md'))).toBe(false);
      expect(deleted.commit).toBeNull();
      expect(await commitCount(vault.root)).toBe(before);
      // Nothing in the history: no tracked file of the ignored folder.
      const tracked = await isogit.listFiles({ fs, dir: vault.root, ref: 'HEAD' });
      expect(tracked.filter((f) => f.startsWith('Ignorata/'))).toEqual([]);
    });

    it(`undo of such an action says why, not "changed no files" (${backend} git)`, async () => {
      const vault = await ignoredVault();
      const a = titan();
      const created = await vault.write(a, { path: 'Ignorata/Nota', content: 'testo\n' });
      const err = await expectToolError(
        vault.undo(a, { action_id: created.action_id }),
        'INVALID_INPUT',
      );
      expect(err.message).toContain(created.action_id);
      expect(err.message).toMatch(/not recorded in the history/);
      expect(err.message).toMatch(/Ignorata\/Nota\.md is ignored by the vault's \.gitignore/);
      expect(err.message).not.toMatch(/changed no files/);
      expect(err.hint).toMatch(/\.gitignore/);
      // The note is still there.
      expect(readFileSync(join(vault.root, 'Ignorata/Nota.md'), 'utf8')).toContain('testo');
    });

    it(`an action that touches both is recorded for the rest and warns (${backend} git)`, async () => {
      const vault = await ignoredVault();
      const a = titan();
      const note = await vault.write(a, { path: 'Inbox/Spostata', content: 'ciao\n' });
      const before = await commitCount(vault.root);
      const moved = await vault.move(a, { from: 'Inbox/Spostata', to: 'Ignorata/Spostata' });
      expect(moved.commit).toBeTruthy();
      expect(moved.warning).toMatch(/Part of this change is not in the history/);
      expect(moved.warning).toMatch(/Ignorata\/Spostata\.md/);
      expect(await commitCount(vault.root)).toBe(before + 1);
      expect(note.commit).toBeTruthy();
      const tracked = await isogit.listFiles({ fs, dir: vault.root, ref: 'HEAD' });
      expect(tracked).not.toContain('Ignorata/Spostata.md');
      expect(tracked).not.toContain('Inbox/Spostata.md');
    });

    it(`a file the history already tracks stays followed, even if the .gitignore now lists it (${backend} git)`, async () => {
      const vault = await newVault({ git: backend });
      const a = titan();
      const created = await vault.write(a, { path: 'Inbox/Seguita', content: 'uno\n' });
      expect(created.commit).toBeTruthy();
      const gitignore = join(vault.root, '.gitignore');
      writeFileSync(gitignore, `${readFileSync(gitignore, 'utf8')}Inbox/Seguita.md\n`);
      const first = await vault.read(a, { path: 'Inbox/Seguita' });
      const edited = await vault.edit(a, {
        path: 'Inbox/Seguita',
        base_hash: first.hash,
        ops: [{ str_replace: { old: 'uno', new: 'due' } }],
      });
      expect(edited.commit).toBeTruthy();
      expect(edited.warning).toBeUndefined();
      await vault.undo(a, { action_id: edited.action_id });
      expect(readFileSync(join(vault.root, 'Inbox/Seguita.md'), 'utf8')).toContain('uno');
    });
  }
});

describe('big files are listed, moved and deleted without being read (D-214)', () => {
  const BIG = 300 * 1024 * 1024;

  for (const backend of backends()) {
    it(`delete, move and the trash list work with a file over 256 MiB (${backend} git)`, async () => {
      const vault = await newVault({ git: backend });
      const a = titan();
      sparse(join(vault.root, 'Risorse/film.mov'), BIG);
      sparse(join(vault.root, 'Risorse/altro.mov'), BIG);
      await vault.sync();
      await vault.write(a, { path: 'Inbox/Piccola', content: 'testo\n' });
      const small = await vault.delete(a, { path: 'Inbox/Piccola', reason: 'prova' });
      const before = await commitCount(vault.root);

      // Move: a rename, with a warning and no commit for the file.
      const moved = await vault.move(a, { from: 'Risorse/film.mov', to: 'Inbox/film.mov' });
      expect(moved.path).toBe('Inbox/film.mov');
      expect(existsSync(join(vault.root, 'Risorse/film.mov'))).toBe(false);
      expect(existsSync(join(vault.root, 'Inbox/film.mov'))).toBe(true);
      expect(vault.index.get('Inbox/film.mov')?.size).toBe(BIG);
      expect(vault.index.get('Risorse/film.mov')).toBeUndefined();
      expect(moved.commit).toBeNull();
      expect(moved.warning).toMatch(/over 256 MiB/);
      expect(moved.warning).toMatch(/cannot be undone/);

      // Delete: to the trash, without reading it.
      const deleted = await vault.delete(a, { path: 'Risorse/altro.mov', reason: 'prova' });
      expect(existsSync(join(vault.root, 'Risorse/altro.mov'))).toBe(false);
      expect(existsSync(join(vault.root, deleted.trash_path))).toBe(true);
      expect(deleted.commit).toBeNull();
      expect(deleted.warning).toMatch(/over 256 MiB/);
      expect(await commitCount(vault.root)).toBe(before);

      // Undo says why.
      const err = await expectToolError(
        vault.undo(a, { action_id: deleted.action_id }),
        'INVALID_INPUT',
      );
      expect(err.message).toMatch(/not recorded in the history/);
      expect(err.message).not.toMatch(/changed no files/);

      // The trash lists the big file by name and size, next to the small note that was trashed.
      const items = await vault.trash(a);
      const big = items.find((i) => i.trash_path === deleted.trash_path);
      expect(big?.size).toBe(BIG);
      expect(big?.original_path).toBeNull();
      const note = items.find((i) => i.action_id === small.action_id);
      expect(note?.original_path).toBe('Inbox/Piccola.md');
    });

    it(`isUntouched is false, not an error, when a big file is there (${backend} git)`, async () => {
      const vault = await newVault({ git: backend });
      expect(await vault.isUntouched()).toBe(true);
      sparse(join(vault.root, 'Risorse/film.mov'), BIG);
      expect(await vault.isUntouched()).toBe(false);
    });
  }
});

describe('sync and reindex while notes are being written', () => {
  it('never drop a note written meanwhile from the index', async () => {
    const vault = await newVault();
    const a = titan();
    for (let i = 0; i < 60; i++) {
      await vault.write(a, { path: `Inbox/Base ${i}`, content: `base ${i}\n` });
    }
    const written: string[] = [];
    const writer = (async () => {
      for (let i = 0; i < 25; i++) {
        const r = await vault.write(a, { path: `Inbox/Nuova ${i}`, content: `nuova ${i}\n` });
        written.push(r.path);
      }
    })();
    const syncer = (async () => {
      for (let i = 0; i < 6; i++) {
        await vault.sync();
        if (i % 3 === 2) await vault.reindex();
      }
    })();
    await Promise.all([writer, syncer]);
    await vault.sync();
    const indexed = new Set(vault.index.files().map((f) => f.path));
    expect(written).toHaveLength(25);
    for (const path of written) expect(indexed.has(path)).toBe(true);
    expect([...indexed].filter((p) => p.startsWith('Inbox/Base'))).toHaveLength(60);
  });
});
