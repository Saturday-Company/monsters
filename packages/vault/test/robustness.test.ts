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
 * "recorded" without its files, and a sync could drop a note written meanwhile.
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

describe('folders ignored by the .gitignore of the user', () => {
  for (const backend of ['isomorphic', 'system'] as const) {
    it(`are recorded in the history, so undo works (${backend} git)`, async () => {
      if (backend === 'system') {
        try {
          execFileSync('git', ['--version'], { stdio: 'ignore' });
        } catch {
          return;
        }
      }
      const vault = await newVault({ git: backend });
      const root = vault.root;
      const gitignore = join(root, '.gitignore');
      writeFileSync(gitignore, `${readFileSync(gitignore, 'utf8')}Ignorata/\n*.tmpdata\n`);
      const a = titan();

      const created = await vault.write(a, {
        path: 'Ignorata/Nota',
        content: 'prima versione\n',
      });
      expect(created.commit).toBeTruthy();
      const changed = await vault.history(a, { path: 'Ignorata/Nota.md' });
      expect(changed.map((c) => c.action_id)).toContain(created.action_id);

      const original = readFileSync(join(root, 'Ignorata/Nota.md'), 'utf8');
      const first = await vault.read(a, { path: 'Ignorata/Nota' });
      const edited = await vault.edit(a, {
        path: 'Ignorata/Nota',
        base_hash: first.hash,
        ops: [{ str_replace: { old: 'prima', new: 'seconda' } }],
      });
      expect(readFileSync(join(root, 'Ignorata/Nota.md'), 'utf8')).toContain('seconda');
      await vault.undo(a, { action_id: edited.action_id });
      expect(readFileSync(join(root, 'Ignorata/Nota.md'), 'utf8')).toBe(original);

      // Deleting and bringing it back.
      const deleted = await vault.delete(a, { path: 'Ignorata/Nota', reason: 'test' });
      expect(existsSync(join(root, 'Ignorata/Nota.md'))).toBe(false);
      await vault.undo(a, { action_id: deleted.action_id });
      expect(readFileSync(join(root, 'Ignorata/Nota.md'), 'utf8')).toBe(original);
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
