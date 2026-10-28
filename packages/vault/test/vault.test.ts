import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolError } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { VaultService, readFrontmatter } from '../src/index.ts';
import { actor, listAll, newVault, tempDir, track } from './helpers.ts';

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

describe('vault creation and opening', () => {
  it('creates the initial structure with git and an index', async () => {
    const vault = await newVault();
    const root = vault.root;
    for (const folder of [
      'Inbox',
      'Diario',
      'Progetti',
      'Aree',
      'Risorse',
      'Persone',
      'Archivio',
      'Allegati',
    ]) {
      expect(existsSync(join(root, folder))).toBe(true);
    }
    for (const file of [
      'LEGGIMI.md',
      'Modelli/Nota.md',
      'Modelli/Persona.md',
      'Modelli/Progetto.md',
      'Modelli/Diario.md',
      'Agenti/Titan/MEMORY.md',
      'Agenti/Rhea/MEMORY.md',
      'Agenti/Dione/MEMORY.md',
      '.gitignore',
    ]) {
      expect(existsSync(join(root, file)), file).toBe(true);
    }
    const app = JSON.parse(readFileSync(join(root, '.obsidian/app.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(app).toMatchObject({
      trashOption: 'local',
      newLinkFormat: 'shortest',
      attachmentFolderPath: 'Allegati',
    });
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.trash/');
    expect(
      readFrontmatter(readFileSync(join(root, 'Agenti/Rhea/MEMORY.md'), 'utf8')).data,
    ).toMatchObject({
      type: 'memory',
      author: 'rhea',
    });

    expect(vault.hasGit).toBe(true);
    const history = await vault.history(titan(), {});
    expect(history).toHaveLength(1);
    expect(history[0]?.author).toBe('monsters');
    expect(vault.index.count()).toBe(8);
  });

  it('refuses to create a vault in a non-empty folder', async () => {
    const root = tempDir();
    writeFileSync(join(root, 'nota.md'), 'x');
    await expectToolError(VaultService.create({ root }), 'EXISTS');
  });

  it('opens an existing vault without modifying it, and inits git only on request', async () => {
    const root = join(tempDir(), 'Esistente');
    mkdirSync(join(root, '.obsidian'), { recursive: true });
    writeFileSync(join(root, '.obsidian/app.json'), '{"x":1}');
    writeFileSync(join(root, 'Nota.md'), 'Testo con [[Altra]] #tag\n');
    writeFileSync(join(root, 'Altra.md'), '# Altra\n');
    const before = listAll(root).map((p) => [p, readFileSync(join(root, p), 'utf8')]);

    const plain = track(await VaultService.open({ root }));
    expect(plain.hasGit).toBe(false);
    expect(plain.index.count()).toBe(2);
    const read = await plain.read(titan(), { path: 'Nota' });
    expect(read.outlinks).toEqual(['Altra.md']);
    await plain.close();
    expect(listAll(root).map((p) => [p, readFileSync(join(root, p), 'utf8')])).toEqual(before);
    await expectToolError(plain.history(titan(), {}), 'UNAVAILABLE');

    const withGit = track(await VaultService.open({ root, initGit: true }));
    expect(withGit.hasGit).toBe(true);
    expect(existsSync(join(root, '.git'))).toBe(true);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.trash/');
    expect(readFileSync(join(root, 'Nota.md'), 'utf8')).toBe('Testo con [[Altra]] #tag\n');
    expect(await withGit.history(titan(), { path: 'Nota.md' })).toHaveLength(1);
  });
});

describe('write, read and search', () => {
  it('writes notes with system properties and returns action, commit and hash', async () => {
    const vault = await newVault();
    const a = titan();
    const res = await vault.write(a, {
      path: 'Risorse/Città eterna',
      content: '# Città eterna\n\nRoma è la città eterna. Vedi [[Marco Rossi]].\n',
      frontmatter: { type: 'resource', tags: ['viaggi/italia'] },
    });
    expect(res.path).toBe('Risorse/Città eterna.md');
    expect(res.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(res.action_id).toMatch(/^[0-9A-Z]{26}$/);
    expect(a.events).toEqual([
      {
        type: 'vault_change',
        data: {
          action: 'create',
          path: 'Risorse/Città eterna.md',
          actionId: res.action_id,
          commit: res.commit,
        },
      },
    ]);

    const note = await vault.read(a, { path: 'Città eterna' });
    expect(note.hash).toBe(res.hash);
    expect(note.frontmatter).toMatchObject({
      type: 'resource',
      tags: ['viaggi/italia'],
      author: 'titan',
    });
    expect(Object.keys(note.frontmatter).slice(0, 2)).toEqual(['id', 'type']);
    expect(note.content?.startsWith('# Città eterna')).toBe(true);
    expect(note.outlinks).toEqual(['Marco Rossi (missing)']);

    const history = await vault.history(a, { path: res.path });
    expect(history[0]).toMatchObject({
      commit: res.commit,
      author: 'titan',
      action_id: res.action_id,
    });
    expect(history[0]?.message).toContain('vault_write: Risorse/Città eterna.md');

    await expectToolError(vault.write(a, { path: 'Risorse/Città eterna', content: 'x' }), 'EXISTS');
    await expectToolError(vault.write(a, { path: 'Inbox/a:b', content: 'x' }), 'INVALID_INPUT');
    await expectToolError(vault.write(a, { path: '../fuori', content: 'x' }), 'INVALID_INPUT');
  });

  it('finds notes ignoring accents, by tag, folder, type and links', async () => {
    const vault = await newVault();
    const a = titan();
    await vault.write(a, {
      path: 'Risorse/Roma',
      content: '# Roma\n\nLa città eterna, piena di progettazione urbana.\n',
      frontmatter: { tags: ['viaggi/italia'], aliases: ['Urbe'] },
    });
    await vault.write(a, {
      path: 'Progetti/Monsters',
      content: '# Monsters\n\nHub agentico. Base a [[Roma]].\n',
      frontmatter: { type: 'project', tags: ['progetto/monsters'] },
    });
    await vault.write(a, { path: 'Inbox/Spesa', content: 'latte #casa\n' });

    const accents = await vault.search(a, { query: 'citta' });
    expect(accents.map((h) => h.path)).toEqual(['Risorse/Roma.md']);
    expect(accents[0]?.snippet).toContain('**città**');

    expect((await vault.search(a, { query: 'progett' })).map((h) => h.path)).toContain(
      'Risorse/Roma.md',
    );
    expect((await vault.search(a, { query: 'urbe' })).map((h) => h.path)).toEqual([
      'Risorse/Roma.md',
    ]);
    expect((await vault.search(a, { tags: ['viaggi'] })).map((h) => h.path)).toEqual([
      'Risorse/Roma.md',
    ]);
    expect((await vault.search(a, { tags: ['#casa'] })).map((h) => h.path)).toEqual([
      'Inbox/Spesa.md',
    ]);
    expect((await vault.search(a, { type: 'project' })).map((h) => h.path)).toEqual([
      'Progetti/Monsters.md',
    ]);
    expect((await vault.search(a, { query: 'monsters', folder: 'Risorse' })).length).toBe(0);
    expect((await vault.search(a, { links_to: 'Roma' })).map((h) => h.path)).toEqual([
      'Progetti/Monsters.md',
    ]);
    expect((await vault.search(a, { updated_after: '2999-01-01' })).length).toBe(0);
    // No model: every mode is full-text, never an error.
    expect(
      (await vault.search(a, { query: 'monsters', mode: 'semantic' })).map((h) => h.path),
    ).toEqual((await vault.search(a, { query: 'monsters', mode: 'text' })).map((h) => h.path));

    const tags = vault.tags(a, { prefix: 'progetto' });
    expect(tags).toEqual([
      { tag: 'progetto', count: 1 },
      { tag: 'progetto/monsters', count: 1 },
    ]);

    const graph = await vault.links(a, { path: 'Roma', direction: 'in' });
    expect(graph.edges).toEqual([
      { from: 'Progetti/Monsters.md', to: 'Risorse/Roma.md', type: 'link' },
    ]);

    const list = await vault.list(a, { folder: '' });
    expect(list.folders).toContain('Progetti');
    expect(list.files.map((f) => f.path)).toEqual(['LEGGIMI.md']);
    const recursive = await vault.list(a, { folder: 'Risorse', recursive: true });
    expect(recursive.files.map((f) => f.path)).toEqual(['Risorse/Roma.md']);
  });

  it('edits with ops and reports CONFLICT on a stale base_hash', async () => {
    const vault = await newVault();
    const a = titan();
    const created = await vault.write(a, {
      path: 'Inbox/Idea',
      content: '# Idea\n\nPrima versione.\n',
    });
    const edited = await vault.edit(a, {
      path: 'Inbox/Idea.md',
      base_hash: created.hash,
      ops: [
        { str_replace: { old: 'Prima versione.', new: 'Seconda versione.' } },
        { set_props: { status: 'active' } },
      ],
    });
    expect(edited.diff).toContain('+Seconda versione.');
    expect(edited.commit).not.toBe(created.commit);

    const stale = await expectToolError(
      vault.edit(a, {
        path: 'Inbox/Idea.md',
        base_hash: created.hash,
        ops: [{ append: { text: 'x' } }],
      }),
      'CONFLICT',
    );
    expect(stale.hint).toMatch(/Read the note again/);
    expect((stale.details as { diff: string }).diff).toContain('+Seconda versione.');

    await expectToolError(
      vault.write(a, {
        path: 'Inbox/Idea',
        content: 'nuovo',
        mode: 'overwrite',
        base_hash: created.hash,
      }),
      'CONFLICT',
    );
    await expectToolError(
      vault.write(a, { path: 'Inbox/Idea', content: 'nuovo', mode: 'overwrite' }),
      'INVALID_INPUT',
    );
    const ok = await vault.write(a, {
      path: 'Inbox/Idea',
      content: '# Idea\n\nRiscritta.\n',
      mode: 'overwrite',
      base_hash: edited.hash,
    });
    const after = await vault.read(a, { path: 'Inbox/Idea' });
    expect(after.hash).toBe(ok.hash);
    expect(after.frontmatter.id).toBeDefined();
    expect(after.content).toBe('# Idea\n\nRiscritta.\n');
  });
});

describe('read with a section', () => {
  const body = [
    '# Z_One – application e pitch deck',
    '',
    '## 1. Chi è Z_One',
    'uno',
    '',
    '## 4. Struttura',
    'intro',
    '',
    '**4.3 Struttura indicativa (convenzione di mercato, da adattare)**',
    'corpo del 4.3',
    '',
    '## 7. Da decidere (Mirko)',
    'fine',
    '',
  ].join('\n');
  const asked = '4.3 Struttura indicativa (convenzione di mercato, da adattare)';
  const setup = async () => {
    const vault = await newVault();
    await vault.write(titan(), { path: 'Commerciale/Pitch', content: body });
    return vault;
  };

  it('returns a bold title line as the section, and says what matched', async () => {
    const vault = await setup();
    const r = await vault.read(titan(), { path: 'Commerciale/Pitch', section: asked });
    expect(r.content).toBe(`**${asked}**\ncorpo del 4.3\n\n`);
    expect(r.section_matched).toBe(`**${asked}**`);
    expect(r.section_not_found).toBeUndefined();
  });

  it('reads a heading under another spelling without a note', async () => {
    const vault = await newVault();
    await vault.write(titan(), {
      path: 'Risorse/A',
      content: '# T\n## Z\\_One – Pitch\ncontenuto\n',
    });
    const r = await vault.read(titan(), { path: 'Risorse/A', section: 'z_one - pitch' });
    expect(r.content).toBe('## Z\\_One – Pitch\ncontenuto\n');
    expect(r.section_matched).toBeUndefined();
  });

  it('matches by section number or prefix and says so', async () => {
    const vault = await setup();
    const r = await vault.read(titan(), { path: 'Commerciale/Pitch', section: '7. Cosa decidere' });
    expect(r.content).toBe('## 7. Da decidere (Mirko)\nfine\n');
    expect(r.section_matched).toBe('7. Da decidere (Mirko)');
  });

  it('with no match returns the whole note and the headings, not an error', async () => {
    const vault = await setup();
    const r = await vault.read(titan(), { path: 'Commerciale/Pitch', section: 'Budget 2027' });
    expect(r.content).toContain('corpo del 4.3');
    expect(r.content).toContain('fine');
    expect(r.section_not_found).toBe('Budget 2027');
    expect(r.sections).toEqual([
      'Z_One – application e pitch deck',
      '1. Chi è Z_One',
      '4. Struttura',
      '7. Da decidere (Mirko)',
    ]);
    expect(r.truncated).toBeUndefined();
    const cut = await vault.read(titan(), {
      path: 'Commerciale/Pitch',
      section: 'Budget 2027',
      max_chars: 40,
    });
    expect(cut.truncated).toBe(true);
    expect(cut.section_not_found).toBe('Budget 2027');
  });

  it('edits stay strict: a pseudo-heading is not a section to replace', async () => {
    const vault = await setup();
    const { hash } = await vault.read(titan(), { path: 'Commerciale/Pitch' });
    await expectToolError(
      vault.edit(titan(), {
        path: 'Commerciale/Pitch',
        base_hash: hash,
        ops: [{ replace_section: { heading: asked, text: 'x' } }],
      }),
      'NOT_FOUND',
    );
  });
});

describe('move, delete, restore and undo', () => {
  it('renames a note and updates every backlink in a single commit', async () => {
    const vault = await newVault();
    const a = titan();
    await vault.write(a, { path: 'Progetti/Budget', content: '# Budget\n\n## Q4\nCifre.\n' });
    await vault.write(a, {
      path: 'Inbox/Riunione',
      content:
        '# Riunione\n\nVedi [[Budget]], [[Budget|i conti]], ![[Budget#Q4]] e [md](Progetti/Budget.md).\n' +
        '`[[Budget]]` nel codice resta.\n',
      frontmatter: { rel: '[[Budget]]' },
    });
    await vault.write(a, { path: 'Risorse/Altro', content: 'Solo [[Progetti/Budget#^blocco]].\n' });
    const before = (await vault.history(a, {})).length;

    const moved = await vault.move(a, { from: 'Budget', to: 'Archivio/Budget 2025' });
    expect(moved.path).toBe('Archivio/Budget 2025.md');
    expect(moved.updated_files.sort()).toEqual(['Inbox/Riunione.md', 'Risorse/Altro.md']);
    expect(existsSync(join(vault.root, 'Progetti/Budget.md'))).toBe(false);

    const riunione = readFileSync(join(vault.root, 'Inbox/Riunione.md'), 'utf8');
    expect(riunione).toContain('rel: "[[Budget 2025]]"');
    expect(riunione).toContain(
      'Vedi [[Budget 2025]], [[Budget 2025|i conti]], ![[Budget 2025#Q4]] e [md](Archivio/Budget%202025.md).',
    );
    expect(riunione).toContain('`[[Budget]]` nel codice resta.');
    expect(readFileSync(join(vault.root, 'Risorse/Altro.md'), 'utf8')).toContain(
      '[[Budget 2025#^blocco]]',
    );

    const history = await vault.history(a, {});
    expect(history.length).toBe(before + 1);
    expect(history[0]?.action_id).toBe(moved.action_id);

    const graph = await vault.links(a, { path: 'Budget 2025', direction: 'in' });
    expect(graph.nodes.map((n) => n.path).sort()).toEqual([
      'Archivio/Budget 2025.md',
      'Inbox/Riunione.md',
      'Risorse/Altro.md',
    ]);
  });

  it('uses the path in links when the new name is not unique', async () => {
    const vault = await newVault();
    const a = titan();
    await vault.write(a, { path: 'Aree/Piano', content: 'x\n' });
    await vault.write(a, { path: 'Progetti/Bozza', content: 'y\n' });
    await vault.write(a, { path: 'Inbox/Link', content: 'A [[Bozza]].\n' });
    await vault.move(a, { from: 'Progetti/Bozza', to: 'Progetti/Piano' });
    expect(readFileSync(join(vault.root, 'Inbox/Link.md'), 'utf8')).toContain('[[Progetti/Piano]]');
  });

  it('deletes to .trash and restores the note', async () => {
    const vault = await newVault();
    const a = titan();
    const created = await vault.write(a, {
      path: 'Inbox/Da buttare',
      content: 'contenuto unico zafferano\n',
    });
    const original = readFileSync(join(vault.root, 'Inbox/Da buttare.md'));

    const del = await vault.delete(a, { path: 'Da buttare', reason: 'doppione' });
    expect(del.trash_path).toBe('.trash/Da buttare.md');
    expect(existsSync(join(vault.root, 'Inbox/Da buttare.md'))).toBe(false);
    expect(readFileSync(join(vault.root, '.trash/Da buttare.md'))).toEqual(original);
    expect(await vault.search(a, { query: 'zafferano' })).toEqual([]);
    const log = await vault.history(a, { limit: 1 });
    expect(log[0]?.message).toContain('vault_delete: Inbox/Da buttare.md');

    // A second note with the same name gets a numbered trash copy.
    await vault.write(a, { path: 'Inbox/Da buttare', content: 'altro\n' });
    expect((await vault.delete(a, { path: 'Inbox/Da buttare', reason: 'x' })).trash_path).toBe(
      '.trash/Da buttare 1.md',
    );

    const restored = await vault.restore(a, {
      path: 'Inbox/Da buttare',
      commit: created.commit!.slice(0, 7),
    });
    expect(readFileSync(join(vault.root, 'Inbox/Da buttare.md'))).toEqual(original);
    expect(restored.restored_from).toBe(created.commit);
    expect(existsSync(join(vault.root, '.trash/Da buttare.md'))).toBe(false);
    expect(existsSync(join(vault.root, '.trash/Da buttare 1.md'))).toBe(true);
    expect((await vault.search(a, { query: 'zafferano' })).map((h) => h.path)).toEqual([
      'Inbox/Da buttare.md',
    ]);

    await vault.delete(a, { path: 'Inbox/Da buttare', reason: 'ancora' });
    const again = await vault.restore(a, { path: 'Inbox/Da buttare' });
    expect(readFileSync(join(vault.root, 'Inbox/Da buttare.md'))).toEqual(original);
    expect(again.commit).not.toBe(restored.commit);
  });

  it('undoes a multi-file action with one new commit', async () => {
    const vault = await newVault();
    const a = titan();
    await vault.write(a, { path: 'Persone/Marco', content: '# Marco\n' });
    await vault.write(a, { path: 'Inbox/A', content: 'Con [[Marco]].\n' });
    await vault.write(a, { path: 'Inbox/B', content: 'Anche ![[Marco]].\n' });
    const snapshot = ['Persone/Marco.md', 'Inbox/A.md', 'Inbox/B.md'].map((p) =>
      readFileSync(join(vault.root, p), 'utf8'),
    );

    const moved = await vault.move(a, { from: 'Marco', to: 'Persone/Marco Rossi' });
    expect(moved.updated_files).toHaveLength(2);
    const before = (await vault.history(a, {})).length;

    const undone = await vault.undo(a, { action_id: moved.action_id });
    expect(undone.files.sort()).toEqual([
      'Inbox/A.md',
      'Inbox/B.md',
      'Persone/Marco Rossi.md',
      'Persone/Marco.md',
    ]);
    expect((await vault.history(a, {})).length).toBe(before + 1);
    expect(existsSync(join(vault.root, 'Persone/Marco Rossi.md'))).toBe(false);
    expect(
      ['Persone/Marco.md', 'Inbox/A.md', 'Inbox/B.md'].map((p) =>
        readFileSync(join(vault.root, p), 'utf8'),
      ),
    ).toEqual(snapshot);
    const back = await vault.links(a, { path: 'Marco', direction: 'in' });
    expect(back.edges).toHaveLength(2);
    expect(a.events.at(-1)).toMatchObject({
      type: 'vault_change',
      data: { action: 'undo', files: undone.files, undoneActionId: moved.action_id },
    });

    await expectToolError(vault.undo(a, { action_id: moved.action_id }), 'INVALID_INPUT');
    await expectToolError(vault.undo(a, { action_id: 'nessuna' }), 'NOT_FOUND');
  });

  it('refuses to undo over later changes unless forced', async () => {
    const vault = await newVault();
    const a = titan();
    const first = await vault.write(a, { path: 'Inbox/N', content: 'uno\n' });
    const second = await vault.edit(a, {
      path: 'Inbox/N',
      base_hash: first.hash,
      ops: [{ append: { text: 'due' } }],
    });
    expect(second.hash).not.toBe(first.hash);
    await expectToolError(vault.undo(a, { action_id: first.action_id }), 'CONFLICT');
    await vault.undo(a, { action_id: first.action_id, force: true });
    expect(existsSync(join(vault.root, 'Inbox/N.md'))).toBe(false);
  });
});

describe('user edits and concurrency', () => {
  it('snapshots user edits before an agent writes', async () => {
    const vault = await newVault();
    const a = titan();
    await vault.write(a, { path: 'Inbox/Condivisa', content: '# Condivisa\n\nversione agente\n' });
    const userText = readFileSync(join(vault.root, 'Inbox/Condivisa.md'), 'utf8').replace(
      'versione agente',
      'versione utente',
    );
    writeFileSync(join(vault.root, 'Inbox/Condivisa.md'), userText);

    const read = await vault.read(a, { path: 'Inbox/Condivisa' });
    const edit = await vault.edit(a, {
      path: 'Inbox/Condivisa',
      base_hash: read.hash,
      ops: [{ append: { text: 'aggiunta agente' } }],
    });

    const history = await vault.history(a, { path: 'Inbox/Condivisa.md' });
    expect(history.map((h) => h.author)).toEqual(['titan', 'user', 'titan']);
    expect(history[1]?.message).toMatch(/^snapshot utente: Inbox\/Condivisa\.md/);
    const restored = await vault.restore(a, {
      path: 'Inbox/Condivisa',
      commit: history[1]!.commit,
    });
    expect(readFileSync(join(vault.root, 'Inbox/Condivisa.md'), 'utf8')).toBe(userText);
    expect(restored.commit).not.toBe(edit.commit);
  });

  it('serializes concurrent writes: one commit each, no lost update', async () => {
    const vault = await newVault();
    const a = titan();
    const created = await vault.write(a, { path: 'Inbox/Contatore', content: '0\n' });
    const results = await Promise.allSettled(
      [1, 2, 3].map((n) =>
        vault.edit(a, {
          path: 'Inbox/Contatore',
          base_hash: created.hash,
          ops: [{ append: { text: String(n) } }],
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);
    await Promise.all(
      ['X', 'Y', 'Z'].map((n) => vault.write(a, { path: `Inbox/${n}`, content: `${n}\n` })),
    );
    const log = await vault.history(a, { limit: 3 });
    expect(new Set(log.map((h) => h.message.split(' ')[1])).size).toBe(3);
  });

  it('fails without leaving temporary files when the signal is already aborted', async () => {
    const vault = await newVault();
    const controller = new AbortController();
    controller.abort();
    const killed = actor('titan', controller.signal);
    const before = (await vault.history(titan(), {})).length;
    await expectToolError(vault.write(killed, { path: 'Inbox/Mai', content: 'x' }), 'ABORTED');
    const created = await vault.write(titan(), { path: 'Inbox/Esiste', content: 'x\n' });
    await expectToolError(
      vault.edit(killed, {
        path: 'Inbox/Esiste',
        base_hash: created.hash,
        ops: [{ append: { text: 'y' } }],
      }),
      'ABORTED',
    );
    expect(existsSync(join(vault.root, 'Inbox/Mai.md'))).toBe(false);
    expect(listAll(vault.root).filter((p) => p.endsWith('.monsters-tmp'))).toEqual([]);
    expect(readFileSync(join(vault.root, 'Inbox/Esiste.md'), 'utf8')).toContain('x\n');
    expect((await vault.history(titan(), {})).length).toBe(before + 1);
    expect(killed.events).toEqual([]);
  });
});

describe('permissions', () => {
  it('lets sub-agents write in their area and Inbox, and denies elsewhere with a hint', async () => {
    const vault = await newVault();
    const rhea = actor('rhea');
    await vault.write(rhea, { path: 'Agenti/Rhea/Appunti', content: 'ok\n' });
    const inbox = await vault.write(rhea, { path: 'Inbox/Da Rhea', content: 'ok\n' });

    const denied = await expectToolError(
      vault.write(rhea, { path: 'Progetti/Segreto', content: 'x' }),
      'SETTING_OFF',
    );
    expect(denied.hint).toContain('vault_propose');
    expect(denied.hint).toContain('Agenti/Rhea/');

    const project = await vault.write(titan(), {
      path: 'Progetti/Monsters',
      content: '# Monsters\n',
    });
    await expectToolError(
      vault.edit(rhea, {
        path: 'Progetti/Monsters',
        base_hash: project.hash,
        ops: [{ append: { text: 'x' } }],
      }),
      'SETTING_OFF',
    );
    await expectToolError(
      vault.delete(rhea, { path: 'Progetti/Monsters', reason: 'x' }),
      'SETTING_OFF',
    );
    await expectToolError(
      vault.move(rhea, { from: 'Inbox/Da Rhea', to: 'Progetti/Da Rhea' }),
      'SETTING_OFF',
    );
    await vault.delete(rhea, { path: 'Inbox/Da Rhea', reason: 'mia nota' });
    expect(inbox.path).toBe('Inbox/Da Rhea.md');

    // Granted globs.
    await vault.write(actor('dione'), { path: 'Progetti/Social/Post', content: 'ciao\n' });
    await expectToolError(
      vault.write(rhea, { path: 'Progetti/Social/Post2', content: 'x' }),
      'SETTING_OFF',
    );

    // Nobody writes system folders.
    await expectToolError(
      vault.write(titan(), { path: '.obsidian/app.json', content: '{}' }),
      'BLOCKED_BY_POLICY',
    );
    await expectToolError(vault.read(titan(), { path: '.git/config' }), 'BLOCKED_BY_POLICY');
  });

  it('hides private notes from sub-agents', async () => {
    const vault = await newVault();
    const t = titan();
    await vault.write(t, {
      path: 'Aree/Salute',
      content: 'diagnosi riservata\n',
      frontmatter: { private: true },
    });
    await vault.write(t, { path: 'Privato/Password', content: 'riservata anche questa\n' });
    expect((await vault.search(t, { query: 'riservata' })).length).toBe(2);
    const rhea = actor('rhea');
    expect(await vault.search(rhea, { query: 'riservata' })).toEqual([]);
    await expectToolError(vault.read(rhea, { path: 'Aree/Salute' }), 'BLOCKED_BY_POLICY');
    await expectToolError(vault.read(rhea, { path: 'Privato/Password' }), 'BLOCKED_BY_POLICY');
    expect((await vault.list(rhea, { folder: '' })).folders).not.toContain('Privato');
  });

  it('allows appends to the Agenti section of the daily note only', async () => {
    const vault = await newVault();
    const daily = await vault.write(titan(), {
      path: 'Diario/2026-10-14',
      content: '# 2026-10-14\n\n## Note\n\n## Agenti\n',
      frontmatter: { type: 'daily' },
    });
    const rhea = actor('rhea');
    const ok = await vault.edit(rhea, {
      path: 'Diario/2026-10-14',
      base_hash: daily.hash,
      ops: [{ append: { section: 'Agenti', text: '- 14:32 **Rhea**: post pubblicato' } }],
    });
    expect(readFileSync(join(vault.root, 'Diario/2026-10-14.md'), 'utf8')).toContain(
      '## Agenti\n- 14:32 **Rhea**: post pubblicato\n',
    );
    await expectToolError(
      vault.edit(rhea, {
        path: 'Diario/2026-10-14',
        base_hash: ok.hash,
        ops: [{ append: { section: 'Note', text: 'x' } }],
      }),
      'SETTING_OFF',
    );
  });

  it('turns a denied change into a proposal the orchestrator applies', async () => {
    const vault = await newVault();
    const project = await vault.write(titan(), {
      path: 'Progetti/Lancio',
      content: '# Lancio\n\nData: da decidere.\n',
    });
    const rhea = actor('rhea');
    const proposal = await vault.propose(rhea, {
      path: 'Lancio',
      ops: [{ str_replace: { old: 'da decidere', new: '20 ottobre' } }],
      note: 'Il calendario social è pronto per il 20.',
    });
    expect(proposal.proposal_path.startsWith('Inbox/Proposta di Rhea - Lancio - ')).toBe(true);
    expect(proposal.diff).toContain('+Data: 20 ottobre.');
    expect(rhea.events[0]).toMatchObject({
      data: { action: 'propose', path: proposal.proposal_path },
    });
    expect(readFileSync(join(vault.root, 'Progetti/Lancio.md'), 'utf8')).toContain('da decidere');

    await expectToolError(
      vault.applyProposal(rhea, { proposal_path: proposal.proposal_path }),
      'BLOCKED_BY_POLICY',
    );
    const applied = await vault.applyProposal(titan(), { proposal_path: proposal.proposal_path });
    expect(applied.path).toBe('Progetti/Lancio.md');
    expect(applied.hash).not.toBe(project.hash);
    expect(readFileSync(join(vault.root, 'Progetti/Lancio.md'), 'utf8')).toContain(
      'Data: 20 ottobre.',
    );
    const status = await vault.read(titan(), { path: proposal.proposal_path });
    expect(status.frontmatter).toMatchObject({
      status: 'applied',
      applied_by: 'titan',
      target_path: 'Progetti/Lancio.md',
    });
    await expectToolError(
      vault.applyProposal(titan(), { proposal_path: proposal.proposal_path }),
      'INVALID_INPUT',
    );
  });
});

describe('index maintenance', () => {
  // OS file events can be slow under load: a generous limit, so that a missed event fails in
  // waitForSearch (5 s, with the query) and not as a bare test timeout.
  it('reindexes after external changes seen by the watcher', { timeout: 15_000 }, async () => {
    const changes: string[] = [];
    const vault = await newVault({ onExternalChange: (c) => changes.push(`${c.kind}:${c.path}`) });
    // watch() returns only once events flow (macOS: FSEvents starts after `ready`), so a
    // write right after it is seen; the probe files it uses are gone.
    await vault.watch();
    expect(readdirSync(vault.root).filter((n) => n.startsWith('.monsters-watch-'))).toEqual([]);
    const a = titan();

    writeFileSync(
      join(vault.root, 'Inbox/Da Obsidian.md'),
      '# Da Obsidian\n\nScritta a mano: ornitorinco.\n',
    );
    await waitForSearch(vault, 'ornitorinco', ['Inbox/Da Obsidian.md']);

    writeFileSync(
      join(vault.root, 'Inbox/Da Obsidian.md'),
      '# Da Obsidian\n\nCambiata: echidna.\n',
    );
    await waitForSearch(vault, 'echidna', ['Inbox/Da Obsidian.md']);
    expect(await vault.search(a, { query: 'ornitorinco' })).toEqual([]);

    // Our own writes are not reported as external changes.
    await vault.write(a, { path: 'Inbox/Agente', content: 'scritta da titan\n' });
    const { rmSync } = await import('node:fs');
    rmSync(join(vault.root, 'Inbox/Da Obsidian.md'));
    await waitForSearch(vault, 'echidna', []);
    expect(changes).toEqual([
      'add:Inbox/Da Obsidian.md',
      'change:Inbox/Da Obsidian.md',
      'unlink:Inbox/Da Obsidian.md',
    ]);
  });

  it('rebuilds the whole index and syncs changes made while closed', async () => {
    const vault = await newVault();
    const a = titan();
    await vault.write(a, { path: 'Inbox/Uno', content: 'koala\n' });
    const root = vault.root;
    const dbPath = join(tempDir(), 'index.sqlite');
    await vault.close();

    const first = track(await VaultService.open({ root, indexPath: dbPath }));
    expect((await first.search(a, { query: 'koala' })).length).toBe(1);
    await first.close();
    writeFileSync(join(root, 'Inbox/Due.md'), 'wombat\n');
    const second = track(await VaultService.open({ root, indexPath: dbPath }));
    expect((await second.search(a, { query: 'wombat' })).length).toBe(1);
    const rebuilt = await second.reindex();
    expect(rebuilt.files).toBe(second.index.count());
    expect((await second.search(a, { query: 'koala' })).length).toBe(1);
  });
});

async function waitForSearch(vault: VaultService, query: string, paths: string[]): Promise<void> {
  const { waitFor } = await import('./helpers.ts');
  let hits: string[] = [];
  await waitFor(async () => {
    hits = (await vault.search(titan(), { query })).map((h) => h.path);
    return JSON.stringify(hits) === JSON.stringify(paths);
  }).catch((err: unknown) => {
    throw new Error(
      `search "${query}": expected ${JSON.stringify(paths)}, got ${JSON.stringify(hits)}`,
      { cause: err },
    );
  });
}
