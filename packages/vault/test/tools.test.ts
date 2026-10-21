import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolContext, ToolEmittedEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { vaultCoreTools, vaultTools, type VaultService } from '../src/index.ts';
import { actor, newVault } from './helpers.ts';

function ctx(
  agentId: string,
  events: ToolEmittedEvent[] = [],
  signal = new AbortController().signal,
): ToolContext {
  return { agentId, runId: 'run-1', signal, emit: (e) => events.push(e) };
}

function tool(vault: VaultService, name: string) {
  const t = vaultTools(vault).find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

async function call<T = Record<string, unknown>>(
  vault: VaultService,
  name: string,
  input: unknown,
  c: ToolContext,
): Promise<T> {
  const t = tool(vault, name);
  return (await t.execute(t.inputSchema.parse(input), c)) as T;
}

/** Every text a model reads about the tools of a vault: descriptions and the described inputs. */
function modelText(vault: VaultService): string {
  return vaultTools(vault)
    .map((t) => `${t.name}\n${t.description}\n${JSON.stringify(z.toJSONSchema(t.inputSchema))}`)
    .join('\n')
    .replaceAll('\\"', '"');
}

describe('the examples in the tools follow the vault’s layout (C9)', () => {
  it('an Italian vault keeps its examples byte for byte', async () => {
    const text = modelText(await newVault());
    for (const example of [
      'Only inside this folder, e.g. "Progetti"',
      'All of these tags; "progetto" also matches "progetto/x"',
      'e.g. "Inbox/Idea podcast" (.md is added). The file name is the title',
      '"tags": ["progetto/x"]',
      'New path or folder ("Archivio/" keeps the name)',
      'e.g. "progetto" for progetto/*',
      'Lowercase tags like "area/salute".',
    ]) {
      expect(text).toContain(example);
    }
  });

  it('an English vault names English folders and tags, with no Italian example left', async () => {
    const text = modelText(await newVault({ layout: 'en' }));
    for (const example of [
      'Only inside this folder, e.g. "Projects"',
      'All of these tags; "project" also matches "project/x"',
      'e.g. "Inbox/Podcast idea" (.md is added)',
      'New path or folder ("Archive/" keeps the name)',
      'Lowercase tags like "area/health".',
    ]) {
      expect(text).toContain(example);
    }
    expect(text).not.toMatch(/Progetti|progetto|Archivio|salute|Idea podcast/);
  });
});

describe('vault tools', () => {
  it('exposes the full set and the minimal subset', async () => {
    const vault = await newVault();
    expect(vaultTools(vault).map((t) => t.name)).toEqual([
      'vault_search',
      'vault_read',
      'vault_list',
      'vault_write',
      'vault_edit',
      'vault_move',
      'vault_delete',
      'vault_links',
      'vault_tags',
      'vault_history',
      'vault_restore',
      'vault_undo',
      'vault_propose',
      'vault_apply_proposal',
    ]);
    expect(vaultCoreTools(vault).map((t) => t.name)).toEqual([
      'vault_search',
      'vault_read',
      'vault_write',
      'vault_edit',
      'vault_delete',
    ]);
    for (const t of vaultTools(vault)) {
      expect(t.name).toMatch(/^vault_[a-z_]+$/);
      expect(t.description.length).toBeLessThan(300);
    }
    expect(tool(vault, 'vault_read').readOnly).toBe(true);
    expect(tool(vault, 'vault_delete').destructive).toBe(true);
  });

  it('runs a write/read/edit/undo cycle through the tool contract', async () => {
    const vault = await newVault();
    const events: ToolEmittedEvent[] = [];
    const c = ctx('titan', events);

    const write = tool(vault, 'vault_write');
    expect(() =>
      write.inputSchema.parse({ path: 'Inbox/X', content: 'x', mode: 'overwrite' }),
    ).toThrow(/base_hash/);

    const created = await call<{ action_id: string; commit: string; path: string; hash: string }>(
      vault,
      'vault_write',
      {
        path: 'Inbox/Idea',
        content: '# Idea\n\nUn podcast sui mostri.\n',
        frontmatter: { tags: ['idee'] },
      },
      c,
    );
    expect(Object.keys(created).sort()).toEqual(['action_id', 'commit', 'hash', 'path']);
    const read = await call<{ hash: string }>(vault, 'vault_read', { path: 'Idea' }, c);
    expect(read.hash).toBe(created.hash);

    const edited = await call<{ action_id: string; diff: string }>(
      vault,
      'vault_edit',
      {
        path: 'Inbox/Idea.md',
        base_hash: read.hash,
        ops: [{ append: { text: 'Puntata 1: Titan.', section: 'Scaletta' } }],
      },
      c,
    );
    expect(edited.diff).toContain('+## Scaletta');
    expect(() =>
      tool(vault, 'vault_edit').inputSchema.parse({
        path: 'x',
        base_hash: read.hash,
        ops: [{ nope: {} }],
      }),
    ).toThrow();

    const hits = await call<{ path: string }[]>(
      vault,
      'vault_search',
      { query: 'podcast', tags: ['idee'] },
      c,
    );
    expect(hits.map((h) => h.path)).toEqual(['Inbox/Idea.md']);

    await call(vault, 'vault_undo', { action_id: edited.action_id }, c);
    expect(readFileSync(join(vault.root, 'Inbox/Idea.md'), 'utf8')).not.toContain('Scaletta');

    expect(events.map((e) => (e.data as { action: string }).action)).toEqual([
      'create',
      'edit',
      'undo',
    ]);
    for (const e of events) {
      expect(e.type).toBe('vault_change');
      expect(e.data).toMatchObject({ commit: expect.stringMatching(/^[0-9a-f]{40}$/) as unknown });
    }
  });

  it('honours the kill switch signal from the tool context', async () => {
    const vault = await newVault();
    const controller = new AbortController();
    controller.abort();
    await expect(
      call(
        vault,
        'vault_write',
        { path: 'Inbox/Mai', content: 'x' },
        ctx('titan', [], controller.signal),
      ),
    ).rejects.toMatchObject({
      code: 'ABORTED',
    });
    expect(existsSync(join(vault.root, 'Inbox/Mai.md'))).toBe(false);
  });

  it('corrects web links written as wikilinks and file names with underscores', async () => {
    const vault = await newVault();
    const c = ctx('rhea');
    const created = await call<{ path: string; corrected: string[] }>(
      vault,
      'vault_write',
      {
        path: 'Inbox/Autumn_Tuscan_Menu',
        content:
          '# Menu\n\nFonti: [[Cinghiale|https://it.wikipedia.org/wiki/Sus_scrofa]], ' +
          '[[https://example.com/castagne]] e [[profilo]].\n',
      },
      c,
    );
    expect(created.path).toBe('Inbox/Autumn Tuscan Menu.md');
    expect(created.corrected).toHaveLength(2);
    const text = readFileSync(join(vault.root, created.path), 'utf8');
    expect(text).toContain(
      'Fonti: [Cinghiale](https://it.wikipedia.org/wiki/Sus_scrofa), [https://example.com/castagne](https://example.com/castagne) e [[profilo]].',
    );

    const read = await call<{ hash: string }>(vault, 'vault_read', { path: created.path }, c);
    const edited = await call<{ corrected?: string[] }>(
      vault,
      'vault_edit',
      {
        path: created.path,
        base_hash: read.hash,
        ops: [{ append: { text: 'Vedi [[Porcini|https://example.com/porcini]].' } }],
      },
      c,
    );
    expect(edited.corrected).toHaveLength(1);
    expect(readFileSync(join(vault.root, created.path), 'utf8')).toContain(
      'Vedi [Porcini](https://example.com/porcini).',
    );

    // Clean writes report nothing.
    const clean = await call(vault, 'vault_write', { path: 'Inbox/Pulita', content: 'ok' }, c);
    expect(clean).not.toHaveProperty('corrected');
  });

  it('falls back to any word, ranked, when every word together finds nothing', async () => {
    const vault = await newVault();
    const c = ctx('titan');
    await call(
      vault,
      'vault_write',
      { path: 'Risorse/Ricerche/Piatti di stagione', content: 'I piatti del menu in autunno.' },
      c,
    );
    await call(vault, 'vault_write', { path: 'Inbox/Altro', content: 'Una nota sul menu.' }, c);
    const hits = await call<{ path: string; partial?: boolean }[]>(
      vault,
      'vault_search',
      { query: 'menu autunnale' },
      c,
    );
    expect(hits.map((h) => h.path)).toEqual([
      'Risorse/Ricerche/Piatti di stagione.md',
      'Inbox/Altro.md',
    ]);
    expect(hits.every((h) => h.partial)).toBe(true);
    // Every word found: no fallback, no flag.
    const exact = await call<{ partial?: boolean }[]>(
      vault,
      'vault_search',
      { query: 'piatti menu' },
      c,
    );
    expect(exact).toHaveLength(1);
    expect(exact[0]).not.toHaveProperty('partial');
    // One word: nothing to relax.
    expect(await call(vault, 'vault_search', { query: 'zafferano' }, c)).toEqual([]);
  });

  it('returns SETTING_OFF with a hint to sub-agents', async () => {
    const vault = await newVault();
    await expect(
      call(vault, 'vault_write', { path: 'Progetti/X', content: 'x' }, ctx('rhea')),
    ).rejects.toMatchObject({
      code: 'SETTING_OFF',
      hint: expect.stringContaining('vault_propose') as unknown,
    });
  });
});

const systemGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.each([
  { backend: 'isomorphic' as const, run: true },
  { backend: 'system' as const, run: systemGit },
])('git backend: $backend', ({ backend, run }) => {
  it.runIf(run)('records actions, snapshots user edits, restores and undoes', async () => {
    const vault = await newVault({ git: backend });
    expect(vault.gitBackend).toBe(backend);
    const a = actor('titan');
    await vault.write(a, { path: 'Persone/Anna', content: '# Anna\n' });
    const link = await vault.write(a, { path: 'Inbox/Nota', content: 'Con [[Anna]].\n' });

    writeFileSync(
      join(vault.root, 'Inbox/Nota.md'),
      `${readFileSync(join(vault.root, 'Inbox/Nota.md'), 'utf8')}utente\n`,
    );
    const moved = await vault.move(a, { from: 'Anna', to: 'Persone/Anna Bianchi' });
    expect(moved.updated_files).toEqual(['Inbox/Nota.md']);
    const history = await vault.history(a, { path: 'Inbox/Nota.md' });
    expect(history.map((h) => h.author)).toEqual(['titan', 'user', 'titan']);
    expect(history[2]?.action_id).toBe(link.action_id);

    await vault.undo(a, { action_id: moved.action_id });
    expect(existsSync(join(vault.root, 'Persone/Anna.md'))).toBe(true);
    expect(existsSync(join(vault.root, 'Persone/Anna Bianchi.md'))).toBe(false);
    expect(readFileSync(join(vault.root, 'Inbox/Nota.md'), 'utf8')).toContain(
      '[[Anna]].\nutente\n',
    );

    await vault.delete(a, { path: 'Anna', reason: 'prova' });
    expect(existsSync(join(vault.root, '.trash/Anna.md'))).toBe(true);
    await vault.restore(a, { path: 'Persone/Anna' });
    expect(readFileSync(join(vault.root, 'Persone/Anna.md'), 'utf8')).toContain('# Anna');

    const log = await vault.history(a, { limit: 50 });
    expect(log.map((h) => h.message.split(':')[0])).toEqual([
      'vault_restore',
      'vault_delete',
      'vault_undo',
      'vault_move',
      'snapshot utente',
      'vault_write',
      'vault_write',
      'vault_create',
    ]);
    if (systemGit) {
      const status = execFileSync('git', ['status', '--porcelain'], {
        cwd: vault.root,
        encoding: 'utf8',
      });
      expect(status).toBe('');
    }
  });
});
