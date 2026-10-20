import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolError } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { actor, newVault } from './helpers.ts';

/* Fixes from the review of the notes view (M2.8, D-034): trash, broken properties, renames. */

const user = () => actor('user');
const tail = (s: string) => s.trimEnd().split('\n').at(-1);

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

describe('trash entries', () => {
  it('restores the entry asked for when the same path was deleted twice', async () => {
    const vault = await newVault();
    const a = user();
    await vault.write(a, { path: 'Note/a.md', content: 'VERSIONE UNO\n' });
    await vault.delete(a, { path: 'Note/a.md', reason: 'x' });
    await vault.write(a, { path: 'Note/a.md', content: 'VERSIONE DUE\n' });
    await vault.delete(a, { path: 'Note/a.md', reason: 'y' });

    const items = await vault.trash(a);
    expect(items.map((i) => [i.trash_path, i.original_path]).sort()).toEqual([
      ['.trash/a 1.md', 'Note/a.md'],
      ['.trash/a.md', 'Note/a.md'],
    ]);

    // The first one (VERSIONE UNO), not the last deleted.
    const first = await vault.restore(a, { trash_path: '.trash/a.md' });
    expect(first.path).toBe('Note/a.md');
    expect(tail(readFileSync(join(vault.root, 'Note/a.md'), 'utf8'))).toBe('VERSIONE UNO');
    expect(existsSync(join(vault.root, '.trash/a.md'))).toBe(false);

    // The other entry still knows where it was and comes back next to it.
    const left = await vault.trash(a);
    expect(left.map((i) => [i.trash_path, i.original_path])).toEqual([
      ['.trash/a 1.md', 'Note/a.md'],
    ]);
    const second = await vault.restore(a, { trash_path: '.trash/a 1.md' });
    expect(second.path).toBe('Note/a (2).md');
    expect(tail(readFileSync(join(vault.root, 'Note/a (2).md'), 'utf8'))).toBe('VERSIONE DUE');
    expect(tail(readFileSync(join(vault.root, 'Note/a.md'), 'utf8'))).toBe('VERSIONE UNO');
    expect(await vault.trash(a)).toEqual([]);
    expect(a.events.at(-1)).toMatchObject({
      type: 'vault_change',
      data: { action: 'restore', path: 'Note/a (2).md' },
    });
  });

  it('knows where a note was when a new note took its path, and does not overwrite it', async () => {
    const vault = await newVault();
    const a = user();
    await vault.write(a, { path: 'Note/b.md', content: 'B1\n' });
    const del = await vault.delete(a, { path: 'Note/b.md', reason: 'x' });
    await vault.write(a, { path: 'Note/b.md', content: 'B2\n' });

    const [item] = await vault.trash(a);
    expect(item).toMatchObject({
      trash_path: '.trash/b.md',
      original_path: 'Note/b.md',
      deleted_by: 'user',
      action_id: del.action_id,
    });
    const restored = await vault.restore(a, { trash_path: '.trash/b.md' });
    expect(restored.path).toBe('Note/b (2).md');
    expect(tail(readFileSync(join(vault.root, 'Note/b (2).md'), 'utf8'))).toBe('B1');
    expect(tail(readFileSync(join(vault.root, 'Note/b.md'), 'utf8'))).toBe('B2');
  });

  it('refuses paths that are not an entry of the trash', async () => {
    const vault = await newVault();
    const a = user();
    await vault.write(a, { path: 'Note/x.md', content: 'x\n' });
    await expectToolError(vault.restore(a, { trash_path: 'Note/x.md' }), 'INVALID_INPUT');
    await expectToolError(vault.restore(a, { trash_path: '.trash/../Note/x.md' }), 'INVALID_INPUT');
    await expectToolError(vault.restore(a, { trash_path: '.trash/nessuna.md' }), 'NOT_FOUND');
    // Moved to the trash outside Monsters: where it was is unknown.
    mkdirSync(join(vault.root, '.trash'), { recursive: true });
    writeFileSync(join(vault.root, '.trash', 'Da Obsidian.md'), 'ciao\n');
    await expectToolError(
      vault.restore(a, { trash_path: '.trash/Da Obsidian.md' }),
      'INVALID_INPUT',
    );
  });
});

describe('notes whose properties are not valid YAML', () => {
  it('keeps the broken block as it was when the text is saved', async () => {
    const vault = await newVault();
    const a = user();
    const broken = '---\ntags: [x\ntitle: y\n---\n';
    writeFileSync(join(vault.root, 'Rotta.md'), `${broken}corpo b\n`);
    await vault.sync();
    const note = await vault.read(a, { path: 'Rotta.md' });
    expect(note.frontmatter_error).toBeTruthy();
    expect(note.content).toBe('corpo b\n');

    await vault.write(a, {
      path: 'Rotta.md',
      content: 'corpo b\nriga\n',
      mode: 'overwrite',
      base_hash: note.hash,
    });
    expect(readFileSync(join(vault.root, 'Rotta.md'), 'utf8')).toBe(`${broken}corpo b\nriga\n`);

    // Changing the properties is refused: they cannot be merged.
    const again = await vault.read(a, { path: 'Rotta.md' });
    await expectToolError(
      vault.write(a, {
        path: 'Rotta.md',
        content: 'x\n',
        frontmatter: { tags: ['y'] },
        mode: 'overwrite',
        base_hash: again.hash,
      }),
      'INVALID_INPUT',
    );
    // A whole note with a valid block repairs it.
    await vault.write(a, {
      path: 'Rotta.md',
      content: '---\ntags: [x]\n---\ncorpo\n',
      mode: 'overwrite',
      base_hash: again.hash,
    });
    const fixed = await vault.read(a, { path: 'Rotta.md' });
    expect(fixed.frontmatter_error).toBeUndefined();
    expect(fixed.frontmatter).toMatchObject({ tags: ['x'] });
  });
});

describe('history across renames', () => {
  it('follows a moved note back to its first version; diff and restore work there', async () => {
    const vault = await newVault();
    const a = user();
    const created = await vault.write(a, { path: 'Note/c.md', content: 'C1\n' });
    const edited = await vault.write(a, {
      path: 'Note/c.md',
      content: 'C2\n',
      mode: 'overwrite',
      base_hash: created.hash,
    });
    const moved = await vault.move(a, { from: 'Note/c.md', to: 'Altro/c2.md' });

    const history = await vault.history(a, { path: 'Altro/c2.md' });
    expect(history.map((e) => e.commit)).toEqual([moved.commit, edited.commit, created.commit]);
    expect(history.map((e) => e.message.split(':')[0])).toEqual([
      'vault_move',
      'vault_write',
      'vault_write',
    ]);

    // The move itself changed no text; the edit before it is shown on the old path.
    const move = await vault.version(a, { path: 'Altro/c2.md', commit: moved.commit! });
    expect(move.before).not.toBeNull();
    expect(move.diff).toBe('');
    const edit = await vault.version(a, { path: 'Altro/c2.md', commit: edited.commit! });
    expect(edit.diff).toContain('-C1');
    expect(edit.diff).toContain('+C2');

    await vault.restore(a, { path: 'Altro/c2.md', commit: created.commit! });
    expect(tail(readFileSync(join(vault.root, 'Altro/c2.md'), 'utf8'))).toBe('C1');
    expect(existsSync(join(vault.root, 'Note/c.md'))).toBe(false);
  });
});
