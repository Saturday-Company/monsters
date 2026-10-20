import { chmodSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolError } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import type { LaterChange, VaultService } from '../src/index.ts';
import { normalizeNotePath } from '../src/paths.ts';
import { actor, newVault } from './helpers.ts';

/* Fixes from the correctness review of the vault. */

const titan = () => actor('titan');

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

async function gitLog(vault: VaultService): Promise<string[]> {
  return (await vault.history(titan(), { limit: 100 })).map((h) => h.message);
}

describe('note names with dots', () => {
  it('adds .md unless the extension is a known file type', async () => {
    expect(normalizeNotePath('Risorse/Bozze post 14.10.2026')).toBe(
      'Risorse/Bozze post 14.10.2026.md',
    );
    expect(normalizeNotePath('Risorse/Report v1.2')).toBe('Risorse/Report v1.2.md');
    expect(normalizeNotePath('Risorse/Ricerca AI 2.0')).toBe('Risorse/Ricerca AI 2.0.md');
    expect(normalizeNotePath('Allegati/foto.PNG')).toBe('Allegati/foto.PNG');
    expect(normalizeNotePath('Allegati/schema.canvas')).toBe('Allegati/schema.canvas');

    const vault = await newVault();
    const res = await vault.write(titan(), {
      path: 'Risorse/Bozze post 14.10.2026',
      content: '# Bozze\n\nciao #social\n',
    });
    expect(res.path).toBe('Risorse/Bozze post 14.10.2026.md');
    expect((await vault.search(titan(), { tags: ['social'] })).map((h) => h.path)).toEqual([
      'Risorse/Bozze post 14.10.2026.md',
    ]);
    expect((await vault.read(titan(), { path: 'Risorse/Bozze post 14.10.2026' })).path).toBe(
      res.path,
    );
  });
});

describe('names every OS accepts', () => {
  it('refuses Windows device names, final dots or spaces, control characters and long paths', async () => {
    const vault = await newVault();
    const a = titan();
    for (const path of [
      'Risorse/CON',
      'Risorse/nul.md',
      'Risorse/Com1.txt',
      'LPT9/Nota',
      'Risorse/Cartella./Nota',
      'Risorse/Cartella /Nota',
      'Risorse/A\u0007B',
      `Risorse/${'Cartella lunga/'.repeat(15)}Nota`,
    ]) {
      await expectToolError(vault.write(a, { path, content: 'x\n' }), 'INVALID_INPUT');
    }
    const note = await vault.write(a, { path: 'Risorse/Console', content: 'x\n' });
    await expectToolError(vault.move(a, { from: note.path, to: 'Risorse/AUX' }), 'INVALID_INPUT');
    // Names that only contain a reserved word are fine.
    for (const path of ['Risorse/CON 2026', 'Risorse/Nul e void', 'Risorse/COM10']) {
      await vault.write(a, { path, content: 'x\n' });
    }
  });
});

describe('overwrite keeps the existing properties', () => {
  it('merges the frontmatter: passed keys win, the others are kept', async () => {
    const vault = await newVault();
    const t = titan();
    await vault.write(t, {
      path: 'Persone/Marco',
      content: '# Marco\n',
      frontmatter: { type: 'person', tags: ['amico'], aliases: ['Marchino'], private: true },
    });
    const read = await vault.read(t, { path: 'Persone/Marco' });
    await vault.write(t, {
      path: 'Persone/Marco',
      content: '# Marco\n\nnuovo testo\n',
      frontmatter: { tags: ['collega'] },
      mode: 'overwrite',
      base_hash: read.hash,
    });
    const after = await vault.read(t, { path: 'Persone/Marco' });
    expect(after.frontmatter).toMatchObject({
      type: 'person',
      tags: ['collega'],
      aliases: ['Marchino'],
      private: true,
      id: read.frontmatter.id,
      created: read.frontmatter.created,
    });
    expect(after.content).toContain('nuovo testo');
  });

  it('ignores a created date invented by an agent, in the frontmatter or in the content', async () => {
    const vault = await newVault();
    const r = actor('rhea');
    await vault.write(r, {
      path: 'Inbox/Uno',
      content: '# Uno\n',
      frontmatter: { created: '2025-06-18' },
    });
    await vault.write(r, {
      path: 'Inbox/Due',
      content: '---\ncreated: 2025-06-18\ntags: [bozza]\n---\n# Due\n',
    });
    for (const path of ['Inbox/Uno', 'Inbox/Due']) {
      const { frontmatter } = await vault.read(r, { path });
      expect(String(frontmatter.created)).not.toContain('2025-06-18');
      expect(frontmatter.created).toEqual(frontmatter.updated);
    }
    expect((await vault.read(r, { path: 'Inbox/Due' })).frontmatter.tags).toEqual(['bozza']);
  });

  it('keeps properties also when the content brings its own frontmatter block', async () => {
    const vault = await newVault();
    const r = actor('rhea');
    const created = await vault.write(r, {
      path: 'Agenti/Rhea/Piano',
      content: '# Piano\n',
      frontmatter: { tags: ['social'], status: 'draft' },
    });
    await vault.write(r, {
      path: 'Agenti/Rhea/Piano',
      content: '---\nstatus: done\n---\n# Piano\n\nfatto\n',
      mode: 'overwrite',
      base_hash: created.hash,
    });
    expect((await vault.read(r, { path: 'Agenti/Rhea/Piano' })).frontmatter).toMatchObject({
      status: 'done',
      tags: ['social'],
      author: 'rhea',
    });
  });
});

describe('git commit failures', () => {
  /**
   * Makes git unable to record anything: read-only object folders (POSIX) and
   * a read-only `.git/index` (Windows ignores the read-only flag on folders but
   * refuses to overwrite or replace a read-only file).
   */
  function lockObjects(vault: VaultService, mode: number): void {
    const objects = join(vault.root, '.git/objects');
    for (const d of [objects, ...readdirSync(objects).map((d) => join(objects, d))]) {
      chmodSync(d, mode);
    }
    chmodSync(join(vault.root, '.git/index'), mode & 0o666);
  }

  it.skipIf(process.getuid?.() === 0)(
    'puts the files back and reports the error when the commit fails',
    async () => {
      const vault = await newVault();
      const a = titan();
      const note = await vault.write(a, { path: 'Risorse/Esistente', content: 'prima\n' });
      const before = readFileSync(join(vault.root, note.path), 'utf8');
      lockObjects(vault, 0o555);
      try {
        await expectToolError(
          vault.write(a, { path: 'Risorse/Nuova', content: 'testo\n' }),
          'UNAVAILABLE',
        );
        await expectToolError(
          vault.edit(a, {
            path: note.path,
            base_hash: note.hash,
            ops: [{ append: { text: 'dopo' } }],
          }),
          'UNAVAILABLE',
        );
      } finally {
        lockObjects(vault, 0o755);
      }
      expect(existsSync(join(vault.root, 'Risorse/Nuova.md'))).toBe(false);
      expect(vault.index.get('Risorse/Nuova.md')).toBeUndefined();
      expect(readFileSync(join(vault.root, note.path), 'utf8')).toBe(before);
      expect(a.events).toHaveLength(1);
      // Everything works again once git does.
      await vault.write(a, { path: 'Risorse/Nuova', content: 'testo\n' });
    },
  );
});

describe('user snapshot before the base_hash check', () => {
  it('saves an external edit in git even when the agent edit fails with CONFLICT', async () => {
    const vault = await newVault();
    const a = titan();
    const note = await vault.write(a, { path: 'Progetti/Piano', content: 'riga originale\n' });
    const path = join(vault.root, note.path);
    writeFileSync(path, `${readFileSync(path, 'utf8')}RIGA UTENTE\n`);
    await expectToolError(
      vault.edit(a, { path: note.path, base_hash: note.hash, ops: [{ append: { text: 'x' } }] }),
      'CONFLICT',
    );
    expect((await gitLog(vault))[0]).toMatch(/^snapshot utente: Progetti\/Piano\.md/);
  });
});

describe('undo conflicts name what blocks them', () => {
  it('lists the later actions and snapshots in the error', async () => {
    const vault = await newVault();
    const a = titan();
    const created = await vault.write(a, { path: 'Inbox/N', content: 'uno\n' });
    const edited = await vault.edit(a, {
      path: 'Inbox/N',
      base_hash: created.hash,
      ops: [{ append: { text: 'due' } }],
    });
    const err = await expectToolError(vault.undo(a, { action_id: created.action_id }), 'CONFLICT');
    expect(err.message).toContain(edited.action_id);
    const later = (err.details as { later: LaterChange[] }).later;
    expect(later).toEqual([
      expect.objectContaining({
        action_id: edited.action_id,
        agent: 'titan',
        files: ['Inbox/N.md'],
      }),
    ]);

    // An edit made outside Monsters shows up as a snapshot.
    const path = join(vault.root, 'Inbox/N.md');
    writeFileSync(path, `${readFileSync(path, 'utf8')}tre\n`);
    const again = await expectToolError(vault.undo(a, { action_id: edited.action_id }), 'CONFLICT');
    const blocking = (again.details as { later: LaterChange[] }).later;
    expect(blocking[0]).toMatchObject({ action_id: null, agent: 'user', files: ['Inbox/N.md'] });
    expect(again.message).toContain('outside Monsters');
  });
});
