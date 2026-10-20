import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { ToolError } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { VaultPermissions, VaultService, readFrontmatter } from '../src/index.ts';
import { isInside, isSystemPath } from '../src/paths.ts';
import { PERMISSIONS, actor, newVault, tempDir, track } from './helpers.ts';

/*
 * Fixes from the security review of the vault (billion laughs, undo of other
 * agents' actions, symbolic links, forged proposals, history of private notes,
 * case-insensitive file systems).
 */

const titan = () => actor('titan');
const rhea = () => actor('rhea');

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

const LAUGHS_YAML = [
  'a: &a [x,x,x,x,x,x,x,x,x]',
  'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
  'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
  'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
  'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
  'f: [*e,*e,*e,*e,*e,*e,*e,*e,*e]',
].join('\n');
const LAUGHS = `---\n${LAUGHS_YAML}\n---\nbody with the word capibara\n`;

describe('YAML alias bombs in the frontmatter', () => {
  it('reads an alias bomb as an error, without throwing', () => {
    const fm = readFrontmatter(LAUGHS);
    expect(fm.data).toEqual({});
    expect(fm.error).toMatch(/alias/i);
  });

  it('opens and syncs a vault with an alias bomb on disk; the note is indexed as text', async () => {
    const vault = await newVault();
    const root = vault.root;
    writeFileSync(join(root, 'Inbox/Risata.md'), LAUGHS);
    const synced = await vault.sync();
    expect(synced.frontmatter_errors).toEqual(['Inbox/Risata.md']);
    await vault.close();

    const reopened = track(await VaultService.open({ root, permissions: PERMISSIONS }));
    expect((await reopened.search(titan(), { query: 'capibara' })).map((h) => h.path)).toEqual([
      'Inbox/Risata.md',
    ]);
    const read = await reopened.read(titan(), { path: 'Inbox/Risata' });
    expect(read.frontmatter).toEqual({});
    expect(read.frontmatter_error).toMatch(/alias/i);
  });

  it('refuses agent writes and edits that put an alias bomb in the frontmatter', async () => {
    const vault = await newVault();
    const r = rhea();
    await expectToolError(
      vault.write(r, { path: 'Agenti/Rhea/Risata', content: LAUGHS }),
      'INVALID_INPUT',
    );
    const note = await vault.write(r, { path: 'Agenti/Rhea/Nota', content: 'corpo\n' });
    const read = await vault.read(r, { path: note.path });
    await expectToolError(
      vault.edit(r, {
        path: note.path,
        base_hash: read.hash,
        ops: [{ str_replace: { old: 'type: note', new: `type: note\n${LAUGHS_YAML}` } }],
      }),
      'INVALID_INPUT',
    );
    expect(readFileSync(join(vault.root, note.path), 'utf8')).not.toContain('*a');
  });
});

describe('undo', () => {
  it('lets a sub-agent undo only its own actions', async () => {
    const vault = await newVault();
    const plan = await vault.write(titan(), { path: 'Progetti/Piano', content: 'piano\n' });
    await expectToolError(vault.undo(rhea(), { action_id: plan.action_id }), 'BLOCKED_BY_POLICY');
    expect(existsSync(join(vault.root, 'Progetti/Piano.md'))).toBe(true);

    mkdirSync(join(vault.root, 'Privato'), { recursive: true });
    writeFileSync(join(vault.root, 'Privato/Diario.md'), 'segreto v1\n');
    const diary = await vault.read(titan(), { path: 'Privato/Diario' });
    const edit = await vault.write(titan(), {
      path: 'Privato/Diario',
      content: 'segreto v2\n',
      mode: 'overwrite',
      base_hash: diary.hash,
    });
    await expectToolError(
      vault.undo(rhea(), { action_id: edit.action_id, force: true }),
      'BLOCKED_BY_POLICY',
    );
    expect(readFileSync(join(vault.root, 'Privato/Diario.md'), 'utf8')).toContain('segreto v2');
  });

  it('moves files created by the undone action to .trash instead of deleting them', async () => {
    const vault = await newVault();
    const created = await vault.write(rhea(), { path: 'Inbox/Bozza', content: 'bozza\n' });
    await vault.undo(titan(), { action_id: created.action_id });
    expect(existsSync(join(vault.root, 'Inbox/Bozza.md'))).toBe(false);
    expect(readFileSync(join(vault.root, '.trash/Bozza.md'), 'utf8')).toContain('bozza');
  });

  it('checks read permission on every file, also for own actions', async () => {
    const vault = await newVault();
    const r = rhea();
    const created = await vault.write(r, { path: 'Inbox/Mia', content: 'mia\n' });
    // The user then marks the note private.
    const text = readFileSync(join(vault.root, 'Inbox/Mia.md'), 'utf8');
    writeFileSync(join(vault.root, 'Inbox/Mia.md'), text.replace('type: note', 'private: true'));
    await expectToolError(
      vault.undo(r, { action_id: created.action_id, force: true }),
      'BLOCKED_BY_POLICY',
    );
    expect(existsSync(join(vault.root, 'Inbox/Mia.md'))).toBe(true);
  });
});

describe('symbolic links leaving the vault', () => {
  function outside(): string {
    const dir = join(tempDir(), 'fuori');
    mkdirSync(dir);
    writeFileSync(join(dir, 'segreto.md'), 'SEGRETO ESTERNO\n');
    return dir;
  }

  it('never reads, writes or indexes through them', async () => {
    const vault = await newVault();
    const out = outside();
    symlinkSync(out, join(vault.root, 'Risorse/link'));
    symlinkSync(out, join(vault.root, 'Agenti/Rhea/fuori'));
    symlinkSync(join(out, 'segreto.md'), join(vault.root, 'Inbox/Collegata.md'));

    await expectToolError(
      vault.read(rhea(), { path: 'Risorse/link/segreto.md' }),
      'BLOCKED_BY_POLICY',
    );
    await expectToolError(vault.read(titan(), { path: 'Inbox/Collegata' }), 'BLOCKED_BY_POLICY');
    await expectToolError(
      vault.write(rhea(), { path: 'Agenti/Rhea/fuori/pwn', content: 'scritto fuori' }),
      'BLOCKED_BY_POLICY',
    );
    expect(readdirSync(out)).toEqual(['segreto.md']);

    await vault.reindex();
    expect(await vault.search(titan(), { query: 'esterno' })).toEqual([]);
    expect(vault.index.get('Inbox/Collegata.md')).toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')(
    'a link inside the vault does not get around Privato/ and the areas (review 18/10, B2)',
    async () => {
      const vault = await newVault();
      await vault.write(titan(), { path: 'Privato/Diario', content: 'DIARIO PRIVATO\n' });
      symlinkSync(join(vault.root, 'Privato/Diario.md'), join(vault.root, 'Inbox/Link.md'));
      symlinkSync(join(vault.root, 'Privato'), join(vault.root, 'Agenti/Rhea/p'));
      // Read directly: denied; through the links: denied too.
      await expectToolError(vault.read(rhea(), { path: 'Privato/Diario' }), 'BLOCKED_BY_POLICY');
      await expectToolError(vault.read(rhea(), { path: 'Inbox/Link' }), 'BLOCKED_BY_POLICY');
      await expectToolError(
        vault.read(rhea(), { path: 'Agenti/Rhea/p/Diario' }),
        'BLOCKED_BY_POLICY',
      );
      await expectToolError(
        vault.write(rhea(), { path: 'Agenti/Rhea/p/Nuova', content: 'scritta in Privato' }),
        'BLOCKED_BY_POLICY',
      );
      expect(existsSync(join(vault.root, 'Privato/Nuova.md'))).toBe(false);
      // The notes themselves stay reachable by their own paths.
      expect((await vault.read(titan(), { path: 'Privato/Diario' })).content).toContain(
        'DIARIO PRIVATO',
      );
      await vault.write(rhea(), { path: 'Agenti/Rhea/Appunti', content: 'ok\n' });
    },
  );

  it('refuses dangling links that would create files outside', async () => {
    const vault = await newVault();
    const missing = join(tempDir(), 'non-esiste');
    symlinkSync(missing, join(vault.root, 'Agenti/Rhea/vuoto'));
    await expectToolError(
      vault.write(rhea(), { path: 'Agenti/Rhea/vuoto/x', content: 'x' }),
      'BLOCKED_BY_POLICY',
    );
    expect(existsSync(missing)).toBe(false);
  });
});

describe('proposals', () => {
  async function setup() {
    const vault = await newVault();
    await vault.write(titan(), {
      path: 'Progetti/Lancio',
      content: '# Lancio\n\nData: da decidere.\n',
    });
    const r = rhea();
    const proposal = await vault.propose(r, {
      path: 'Lancio',
      ops: [{ str_replace: { old: 'da decidere', new: '20 ottobre' } }],
      note: 'Pronto per il 20.',
    });
    return { vault, r, proposal };
  }

  it('refuses a proposal whose operations were changed after the diff was shown', async () => {
    const { vault, r, proposal } = await setup();
    const read = await vault.read(r, { path: proposal.proposal_path });
    await vault.edit(r, {
      path: proposal.proposal_path,
      base_hash: read.hash,
      ops: [{ str_replace: { old: '"new": "20 ottobre"', new: '"new": "mai"' } }],
    });
    await expectToolError(
      vault.applyProposal(titan(), { proposal_path: proposal.proposal_path }),
      'INVALID_INPUT',
    );
    expect(readFileSync(join(vault.root, 'Progetti/Lancio.md'), 'utf8')).toContain('da decidere');
  });

  it('refuses a proposal when the target changed after it (base_hash)', async () => {
    const { vault, proposal } = await setup();
    const target = await vault.read(titan(), { path: 'Progetti/Lancio' });
    await vault.edit(titan(), {
      path: 'Progetti/Lancio',
      base_hash: target.hash,
      ops: [{ append: { text: 'Budget: 100.' } }],
    });
    await expectToolError(
      vault.applyProposal(titan(), { proposal_path: proposal.proposal_path }),
      'CONFLICT',
    );
  });

  it('refuses proposals not made with vault_propose', async () => {
    const vault = await newVault();
    await vault.write(titan(), { path: 'Progetti/Lancio', content: '# Lancio\n\nData: x.\n' });
    const forged = await vault.write(rhea(), {
      path: 'Inbox/Proposta finta',
      content: '```json monsters-ops\n[{"append":{"text":"pwn"}}]\n```\n',
      frontmatter: { type: 'proposal', status: 'pending', target_path: 'Progetti/Lancio.md' },
    });
    await expectToolError(
      vault.applyProposal(titan(), { proposal_path: forged.path }),
      'INVALID_INPUT',
    );
  });

  it('lets sub-agents edit only their own notes in Inbox', async () => {
    const { vault, proposal } = await setup();
    const dione = actor('dione');
    const read = await vault.read(dione, { path: proposal.proposal_path });
    await expectToolError(
      vault.edit(dione, {
        path: proposal.proposal_path,
        base_hash: read.hash,
        ops: [{ append: { text: 'x' } }],
      }),
      'SETTING_OFF',
    );
    writeFileSync(join(vault.root, 'Inbox/Dell utente.md'), 'nota a mano\n');
    const user = await vault.read(dione, { path: 'Inbox/Dell utente' });
    await expectToolError(
      vault.write(dione, {
        path: 'Inbox/Dell utente',
        content: 'sovrascritta',
        mode: 'overwrite',
        base_hash: user.hash,
      }),
      'SETTING_OFF',
    );
    // New notes are fine, and signed by the agent whatever the content says.
    const mine = await vault.write(dione, {
      path: 'Inbox/Di Dione',
      content: '---\nauthor: titan\n---\nciao\n',
    });
    expect((await vault.read(titan(), { path: mine.path })).frontmatter.author).toBe('dione');
  });
});

describe('private notes in history, overwrite and restore', () => {
  it('hides commits about private notes from the history of sub-agents', async () => {
    const vault = await newVault();
    await vault.write(titan(), { path: 'Privato/Conti segreti', content: 'x\n' });
    await vault.write(titan(), {
      path: 'Aree/Salute',
      content: 'y\n',
      frontmatter: { private: true },
    });
    await vault.write(titan(), { path: 'Progetti/Pubblico', content: 'z\n' });
    const messages = (await vault.history(rhea(), {})).map((h) => h.message).join('\n');
    expect(messages).toContain('Progetti/Pubblico.md');
    expect(messages).not.toContain('Conti segreti');
    expect(messages).not.toContain('Salute');
    expect((await vault.history(titan(), {})).map((h) => h.message).join('\n')).toContain(
      'Conti segreti',
    );
  });

  it('checks read permission before overwrite and restore', async () => {
    const vault = await newVault();
    const r = rhea();
    const own = await vault.write(r, { path: 'Inbox/Mio diario', content: 'v1\n' });
    const text = readFileSync(join(vault.root, own.path), 'utf8');
    writeFileSync(join(vault.root, own.path), text.replace('type: note', 'private: true'));
    const err = await expectToolError(
      vault.write(r, {
        path: own.path,
        content: 'x',
        mode: 'overwrite',
        base_hash: own.hash,
      }),
      'BLOCKED_BY_POLICY',
    );
    expect(JSON.stringify(err.details ?? null)).not.toContain('private');
    await expectToolError(
      vault.restore(r, { path: own.path, commit: own.commit! }),
      'BLOCKED_BY_POLICY',
    );
  });
});

describe('protected paths on case-insensitive file systems', () => {
  it('compares protected folders ignoring case and Unicode form', () => {
    expect(isSystemPath('.Git/config')).toBe(true);
    expect(isSystemPath('.OBSIDIAN/app.json')).toBe(true);
    expect(isSystemPath('.Trash/x.md')).toBe(true);
    expect(isInside('privato/Conti.md', 'Privato')).toBe(true);
    expect(isInside('Agenti/Rhéa/x.md', 'Agenti/Rhéa')).toBe(true);
    const perms = new VaultPermissions(PERMISSIONS);
    expect(perms.canRead('rhea', 'PRIVATO/Conti.md', false)).toBe(false);
  });

  it('denies privato/ to sub-agents and .Obsidian/.Git to everybody', async () => {
    const vault = await newVault();
    mkdirSync(join(vault.root, 'privato'));
    writeFileSync(join(vault.root, 'privato/Conti.md'), 'conto\n');
    await expectToolError(vault.read(rhea(), { path: 'privato/Conti.md' }), 'BLOCKED_BY_POLICY');
    // On a case-insensitive file system (macOS, Windows) `.Obsidian` already is
    // the vault's `.obsidian`; elsewhere it is a different folder to create.
    if (!existsSync(join(vault.root, '.OBSIDIAN'))) {
      mkdirSync(join(vault.root, '.Obsidian'));
      writeFileSync(join(vault.root, '.Obsidian/app.json'), '{}');
    }
    expect(existsSync(join(vault.root, '.Obsidian/app.json'))).toBe(true);
    await expectToolError(
      vault.write(titan(), {
        path: '.Obsidian/app.json',
        content: '{"x":1}',
        mode: 'overwrite',
        base_hash: 'deadbeefdeadbeef',
      }),
      'BLOCKED_BY_POLICY',
    );
    await expectToolError(vault.read(titan(), { path: '.GIT/config' }), 'BLOCKED_BY_POLICY');
  });
});
