import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ToolError, VAULT_LAYOUT_RECORD } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  detectVaultLayout,
  readVaultLayoutRecord,
  VaultService,
  writeVaultLayoutRecord,
} from '../src/index.ts';
import { actor, newVault, PERMISSIONS, tempDir, track } from './helpers.ts';

/*
 * The names of a vault on disk (D-154): a new English vault has English folders and notes, an
 * Italian one (every vault made before D-154) keeps its names forever, and the guards (private
 * folder, agents' areas, inbox, journal, templates) follow the vault's own layout.
 */

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

const ITALIAN_NAMES = [
  'Diario',
  'Progetti',
  'Aree',
  'Risorse',
  'Persone',
  'Archivio',
  'Agenti',
  'Modelli',
  'Allegati',
  'Privato',
  'LEGGIMI.md',
  'profilo.md',
];

describe('a new English vault', () => {
  it('has English folders, readme, templates and memories, and records its layout', async () => {
    const vault = await newVault({ layout: 'en' });
    const root = vault.root;
    expect(vault.layout.id).toBe('en');
    for (const folder of [
      'Inbox',
      'Journal',
      'Projects',
      'Areas',
      'Resources',
      'People',
      'Archive',
      'Agents',
      'Templates',
      'Attachments',
    ]) {
      expect(existsSync(join(root, folder)), folder).toBe(true);
    }
    for (const file of [
      'README.md',
      'Templates/Note.md',
      'Templates/Person.md',
      'Templates/Project.md',
      'Templates/Journal.md',
      'Agents/Titan/MEMORY.md',
      'Agents/Rhea/MEMORY.md',
      'Agents/Dione/MEMORY.md',
    ]) {
      expect(existsSync(join(root, file)), file).toBe(true);
    }
    for (const name of ITALIAN_NAMES) expect(existsSync(join(root, name)), name).toBe(false);
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toMatch(/^# Read me\n/);
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain('the `Private/` folder');
    expect(readFileSync(join(root, 'Templates/Journal.md'), 'utf8')).toContain('## Agents\n');
    const app = JSON.parse(readFileSync(join(root, '.obsidian/app.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(app).toMatchObject({ attachmentFolderPath: 'Attachments', newFileFolderPath: 'Inbox' });
    expect(readVaultLayoutRecord(root)).toBe('en');
    // The record is in the first commit: the history has nothing left out.
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    expect(status).toBe('');
    // Opened again, with nothing said: English.
    await vault.close();
    const again = track(await VaultService.open({ root }));
    expect(again.layout.id).toBe('en');
  });

  it('keeps Private/ from the sub-agents, and Privato/ is an ordinary folder', async () => {
    const vault = await newVault({ layout: 'en' });
    const t = titan();
    await vault.write(t, { path: 'Private/Passwords', content: 'secret, also this one\n' });
    await vault.write(t, { path: 'Privato/Appunti', content: 'secret word in Italian\n' });
    const rhea = actor('rhea');
    await expectToolError(vault.read(rhea, { path: 'Private/Passwords' }), 'BLOCKED_BY_POLICY');
    expect((await vault.search(rhea, { query: 'secret' })).map((h) => h.path)).toEqual([
      'Privato/Appunti.md',
    ]);
    expect((await vault.list(rhea, { folder: '' })).folders).not.toContain('Private');
    expect(vault.permissions.canRead('rhea', 'private/passwords.md', false)).toBe(false);
    expect(vault.tags(rhea, {})).toEqual([]);
  });

  it('gives each sub-agent its own Agents/ folder and the inbox, nothing else', async () => {
    const vault = await newVault({ layout: 'en' });
    const rhea = actor('rhea');
    expect(vault.permissions.areaOf('rhea')).toBe('Agents/Rhea');
    expect(vault.permissions.writableAreas('rhea')).toEqual(['Agents/Rhea/', 'Inbox/']);
    await vault.write(rhea, { path: 'Agents/Rhea/Notes', content: 'mine\n' });
    await vault.write(rhea, { path: 'Inbox/Idea', content: 'an idea\n' });
    await expectToolError(
      vault.write(rhea, { path: 'Agents/Dione/Notes', content: 'not mine\n' }),
      'SETTING_OFF',
    );
    expect(vault.permissions.canWrite('rhea', 'Agents/Titan/MEMORY.md', 'titan')).toBe(false);
    expect(vault.permissions.canWrite('rhea', 'agents/titan/memory.md', 'titan')).toBe(false);
    // Dione's extra glob of the Italian test team names an Italian folder: only that one.
    expect(vault.permissions.canWrite('dione', 'Progetti/Social/Post.md', null)).toBe(true);
    expect(vault.permissions.canWrite('dione', 'Projects/Social/Post.md', null)).toBe(false);
    // The external clients (MCP) work in Agents/MCP/.
    expect(vault.permissions.areaOf('mcp-claude-code')).toBe('Agents/MCP');
    expect(vault.permissions.canWrite('mcp-claude-code', 'Agents/MCP/Notes.md', null)).toBe(true);
    expect(vault.permissions.canWrite('mcp-claude-code', 'Agenti/MCP/Notes.md', null)).toBe(false);
  });

  it('lets the agents append only to the Agents section of the journal', async () => {
    const vault = await newVault({ layout: 'en' });
    const daily = await vault.write(titan(), {
      path: 'Journal/2026-10-21',
      content: '# 2026-10-21\n\n## Notes\n\n## Agents\n',
      frontmatter: { type: 'daily' },
    });
    const rhea = actor('rhea');
    const ok = await vault.edit(rhea, {
      path: 'Journal/2026-10-21',
      base_hash: daily.hash,
      ops: [{ append: { section: 'Agents', text: '- 14:32 **Rhea**: post published' } }],
    });
    expect(readFileSync(join(vault.root, 'Journal/2026-10-21.md'), 'utf8')).toContain(
      '## Agents\n- 14:32 **Rhea**: post published\n',
    );
    await expectToolError(
      vault.edit(rhea, {
        path: 'Journal/2026-10-21',
        base_hash: ok.hash,
        ops: [{ append: { section: 'Notes', text: 'x' } }],
      }),
      'SETTING_OFF',
    );
  });

  it('leaves the templates out of the search and writes proposals in English', async () => {
    const vault = await newVault({ layout: 'en' });
    expect((await vault.search(titan(), { query: 'summary' })).map((h) => h.path)).toEqual([]);
    expect(
      (await vault.search(titan(), { query: 'summary', folder: 'Templates' })).map((h) => h.path),
    ).toEqual(['Templates/Note.md']);
    await vault.write(titan(), { path: 'Projects/Launch', content: '# Launch\n\nDate: TBD.\n' });
    const proposal = await vault.propose(actor('rhea'), {
      path: 'Launch',
      ops: [{ str_replace: { old: 'TBD', new: 'October 20' } }],
      note: 'The social calendar is ready for the 20th.',
    });
    expect(proposal.proposal_path.startsWith('Inbox/Proposal by Rhea - Launch - ')).toBe(true);
    const text = readFileSync(join(vault.root, proposal.proposal_path), 'utf8');
    expect(text).toContain('# Proposed change to [[Launch]]');
    expect(text).toContain('## Operations');
    const applied = await vault.applyProposal(titan(), { proposal_path: proposal.proposal_path });
    expect(applied.path).toBe('Projects/Launch.md');
  });
});

describe('the history of a vault speaks its layout’s language (C8)', () => {
  const log = (root: string): string =>
    execFileSync('git', ['log', '--format=%B%x00'], { cwd: root, encoding: 'utf8' });

  it('an English vault: create, user snapshot and undo messages are English', async () => {
    const vault = await newVault({ layout: 'en' });
    const a = titan();
    await vault.write(a, { path: 'Inbox/Shared', content: 'agent version\n' });
    writeFileSync(join(vault.root, 'Inbox/Shared.md'), 'user version\n');
    const read = await vault.read(a, { path: 'Inbox/Shared' });
    const edit = await vault.edit(a, {
      path: 'Inbox/Shared',
      base_hash: read.hash,
      ops: [{ append: { text: 'agent addition' } }],
    });
    await vault.undo(a, { action_id: edit.action_id });
    const text = log(vault.root);
    expect(text).toContain('vault_create: new vault');
    expect(text).toMatch(/user snapshot: Inbox\/Shared\.md\n\nChanges made outside Monsters/);
    expect(text).toContain(`Undo action ${edit.action_id} (commit `);
    expect(text).not.toMatch(/nuovo vault|snapshot utente|Annulla l/);
  });

  it('an Italian vault keeps the Italian messages, and a history started later too', async () => {
    const vault = await newVault();
    const a = titan();
    await vault.write(a, { path: 'Inbox/Condivisa', content: 'agente\n' });
    writeFileSync(join(vault.root, 'Inbox/Condivisa.md'), 'utente\n');
    const read = await vault.read(a, { path: 'Inbox/Condivisa' });
    const edit = await vault.edit(a, {
      path: 'Inbox/Condivisa',
      base_hash: read.hash,
      ops: [{ append: { text: 'aggiunta' } }],
    });
    await vault.undo(a, { action_id: edit.action_id });
    const text = log(vault.root);
    expect(text).toContain('vault_create: nuovo vault');
    expect(text).toContain('snapshot utente: Inbox/Condivisa.md');
    expect(text).toContain(`Annulla l'azione ${edit.action_id} (commit `);

    // A folder without history that gets one: the first commit says it in the layout's words.
    for (const layout of ['en', 'it'] as const) {
      const root = join(tempDir(), 'late');
      mkdirSync(root, { recursive: true });
      writeVaultLayoutRecord(root, layout);
      writeFileSync(join(root, 'Nota.md'), '# Nota\n');
      track(await VaultService.open({ root, permissions: PERMISSIONS, initGit: true }));
      expect(log(root)).toContain(
        layout === 'en'
          ? 'vault_init: history started by Monsters'
          : 'vault_init: cronologia avviata da Monsters',
      );
    }
  });
});

describe('an Italian vault', () => {
  it('keeps its names when opened without a layout, and Privato/ stays private', async () => {
    const created = await newVault();
    const root = created.root;
    expect(created.layout.id).toBe('it');
    expect(readVaultLayoutRecord(root)).toBe('it');
    await created.write(titan(), { path: 'Privato/Conti', content: 'riservato\n' });
    await created.close();
    // A vault made before D-154 has no record: what it has says Italian.
    rmSync(join(root, VAULT_LAYOUT_RECORD));
    const vault = track(await VaultService.open({ root, permissions: PERMISSIONS }));
    expect(vault.layout.id).toBe('it');
    expect(readVaultLayoutRecord(root)).toBeNull();
    await expectToolError(
      vault.read(actor('rhea'), { path: 'Privato/Conti' }),
      'BLOCKED_BY_POLICY',
    );
    expect(vault.permissions.areaOf('rhea')).toBe('Agenti/Rhea');
    for (const name of ['Agents', 'Private', 'Templates', 'Journal', 'README.md']) {
      expect(existsSync(join(root, name)), name).toBe(false);
    }
  });

  it('is never read as English because of its record alone', async () => {
    const created = await newVault();
    const root = created.root;
    await created.close();
    // A record changed by hand (or by a program with the terminal) while the vault has only
    // Italian names: its `Privato/` keeps its guard.
    writeVaultLayoutRecord(root, 'en');
    const vault = track(await VaultService.open({ root, permissions: PERMISSIONS }));
    expect(vault.layout.id).toBe('it');
    expect(vault.permissions.canRead('rhea', 'Privato/Conti.md', false)).toBe(false);
    await vault.close();
    // Nor because a caller says so: what the vault has wins.
    const asked = track(await VaultService.open({ root, permissions: PERMISSIONS, layout: 'en' }));
    expect(asked.layout.id).toBe('it');
  });
});

describe('detectVaultLayout', () => {
  const folder = (entries: Record<string, string>): string => {
    const root = join(tempDir(), 'Notes');
    mkdirSync(root, { recursive: true });
    for (const [name, content] of Object.entries(entries)) {
      if (content === 'dir') mkdirSync(join(root, name), { recursive: true });
      else writeFileSync(join(root, name), content);
    }
    return root;
  };

  it('reads an Italian vault from its traces when there is no record', () => {
    expect(detectVaultLayout(folder({ Agenti: 'dir' }))).toBe('it');
    expect(detectVaultLayout(folder({ 'profilo.md': '# Profilo\n' }))).toBe('it');
    expect(detectVaultLayout(folder({ Privato: 'dir' }))).toBe('it');
    expect(detectVaultLayout(folder({ 'LEGGIMI.md': '# Leggimi\n' }))).toBe('it');
    expect(detectVaultLayout(folder({ Modelli: 'dir' }))).toBe('it');
    // Any case: a disk that ignores it sees `agenti` as `Agenti`.
    expect(detectVaultLayout(folder({ agenti: 'dir' }))).toBe('it');
  });

  it('reads an English vault from its traces, Italian when it has both', () => {
    expect(detectVaultLayout(folder({ Agents: 'dir' }))).toBe('en');
    expect(detectVaultLayout(folder({ 'profile.md': '# Profile\n' }))).toBe('en');
    expect(detectVaultLayout(folder({ Private: 'dir' }))).toBe('en');
    expect(detectVaultLayout(folder({ Agents: 'dir', 'profilo.md': 'x' }))).toBe('it');
  });

  it('knows nothing of a folder of notes Monsters never used', () => {
    // README.md and Templates/ are in many folders of notes: not a trace of Monsters.
    expect(detectVaultLayout(folder({ 'README.md': '# Notes\n', Templates: 'dir' }))).toBeNull();
    expect(detectVaultLayout(folder({}))).toBeNull();
    expect(detectVaultLayout(join(tempDir(), 'missing'))).toBeNull();
  });

  it('follows the record, unless the vault has only the other layout', () => {
    const empty = folder({});
    writeVaultLayoutRecord(empty, 'en');
    expect(detectVaultLayout(empty)).toBe('en');
    const english = folder({ Agents: 'dir', Agenti: 'dir' });
    writeVaultLayoutRecord(english, 'en');
    expect(detectVaultLayout(english)).toBe('en');
    const italian = folder({ Agenti: 'dir' });
    writeVaultLayoutRecord(italian, 'en');
    expect(detectVaultLayout(italian)).toBe('it');
    // A damaged record is no record.
    const broken = folder({ Agents: 'dir' });
    mkdirSync(join(broken, '.monsters'));
    writeFileSync(join(broken, VAULT_LAYOUT_RECORD), '{ not json');
    expect(readVaultLayoutRecord(broken)).toBeNull();
    expect(detectVaultLayout(broken)).toBe('en');
  });
});
