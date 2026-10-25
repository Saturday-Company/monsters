import { execFileSync } from 'node:child_process';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { FolderGrant, MonstersTool } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { createFsTools, isInside, mayBeInside, realPathOf } from '../src/index.ts';
import { launchFileReason, packageJsonReason } from '../src/system/launch-files.ts';
import { tempDir, toolCtx, toolError } from './system-helpers.ts';

const POSIX = process.platform !== 'win32';

interface Setup {
  root: string;
  work: string;
  docs: string;
  outside: string;
  vault: string;
  home: string;
  trash: string;
  tool: (name: string) => MonstersTool;
  grants: Record<string, FolderGrant[]>;
  /** Agents with the terminal permission. */
  shell: Set<string>;
}

/**
 * root/
 *   lavoro/       granted with write
 *   documenti/    granted read only (contains the vault)
 *     Vault/      the vault: never through fs_*
 *   fuori/        not granted
 *   home/         data folder of Monsters
 */
function setup(): Setup {
  const root = tempDir();
  const work = join(root, 'lavoro');
  const docs = join(root, 'documenti');
  const vault = join(docs, 'Vault');
  const outside = join(root, 'fuori');
  const home = join(root, 'home');
  for (const d of [work, docs, vault, outside, home]) mkdirSync(d, { recursive: true });
  writeFileSync(join(work, 'note.txt'), 'ciao\n');
  writeFileSync(join(docs, 'contratto.md'), '# Contratto\n');
  writeFileSync(join(vault, 'idea.md'), 'nota del vault');
  writeFileSync(join(outside, 'segreto.txt'), 'non leggere');
  writeFileSync(join(home, 'settings.json'), '{}');
  const trash = join(home, 'trash', 'files');
  const grants: Record<string, FolderGrant[]> = {
    rhea: [
      { path: work, write: true },
      { path: docs, write: false },
    ],
  };
  const shell = new Set<string>();
  const tools = createFsTools({
    grants: (id) => grants[id] ?? [],
    canRunCommands: (id) => shell.has(id),
    protectedFolders: () => [
      { path: vault, reason: 'This is the vault.', hint: 'Use vault_read.' },
      { path: home, reason: 'Data folder of Monsters.', hint: 'Work elsewhere.' },
    ],
    trashDir: trash,
  });
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  return { root, work, docs, outside, vault, home, trash, tool, grants, shell };
}

const run = (s: Setup, name: string, input: unknown, agent = 'rhea') =>
  s.tool(name).execute(input, toolCtx(agent)) as Promise<Record<string, unknown>>;

describe('paths', () => {
  it('compares containment on real paths', async () => {
    expect(isInside('/a/b', '/a/b/c')).toBe(true);
    expect(isInside('/a/b', '/a/b')).toBe(true);
    expect(isInside('/a/b', '/a/b/')).toBe(true);
    expect(isInside('/a/b', '/a/bc')).toBe(false);
    expect(isInside('/a/b', '/a')).toBe(false);
    expect(isInside('/', '/a')).toBe(true);
    // Exact: a twin folder in another case or Unicode form is not the granted one.
    expect(isInside('/A/b', '/a/B/c', 'darwin')).toBe(false);
    expect(isInside('/x/caf\u00e9', '/x/cafe\u0301/a.txt', 'linux')).toBe(false);
    expect(isInside('/x/caf\u00e9', '/x/cafe\u0301/a.txt', 'darwin')).toBe(false);
    // Off-limits folders: matched in any case (Windows, macOS) and Unicode form.
    expect(mayBeInside('/A/b', '/a/B/c', 'darwin')).toBe(true);
    expect(mayBeInside('/A/b', '/a/B/c', 'linux')).toBe(false);
    expect(mayBeInside('/x/caf\u00e9', '/x/cafe\u0301/a.txt', 'linux')).toBe(true);
    // Windows rules, on any host: drive letters, backslashes.
    expect(isInside('C:\\Lavoro', 'C:\\Lavoro\\Note\\a.txt', 'win32')).toBe(true);
    expect(isInside('C:\\Lavoro', 'C:/Lavoro/Note', 'win32')).toBe(true);
    expect(isInside('C:\\Lavoro', 'c:\\lavoro\\a.txt', 'win32')).toBe(false);
    expect(mayBeInside('C:\\Lavoro', 'c:\\lavoro\\a.txt', 'win32')).toBe(true);
    expect(mayBeInside('C:\\Lavoro', 'C:\\Lavoro2\\a.txt', 'win32')).toBe(false);
    expect(mayBeInside('C:\\Lavoro', 'C:\\Lavoro\\..\\fuori', 'win32')).toBe(false);
    expect(mayBeInside('C:\\Lavoro', 'D:\\Lavoro\\a.txt', 'win32')).toBe(false);
    expect(mayBeInside('C:\\Lavoro', 'C:\\', 'win32')).toBe(false);
    expect(isInside('C:\\', 'C:\\Lavoro', 'win32')).toBe(true);
    const d = tempDir();
    expect(await realPathOf(join(d, 'non', 'ancora.txt'))).toBe(join(d, 'non', 'ancora.txt'));
  });

  it('knows the files that make the computer run commands', () => {
    for (const p of [
      '/w/repo/.git/config',
      '/w/repo/.git/hooks/pre-commit',
      'C:\\w\\repo\\.GIT.\\config',
      'C:\\w\\repo\\.git::$INDEX_ALLOCATION\\config',
      '/home/u/.bashrc',
      '/home/u/.profile',
      '/w/progetto/.envrc',
      '/home/u/.config/autostart/x.desktop',
      '/Users/u/Library/LaunchAgents/x.plist',
      'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\x.bat',
      'C:\\Users\\u\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1',
      // Claude Code and Codex settings: hooks and MCP servers (review 18/10, M3).
      '/w/repo/.claude/settings.json',
      '/w/repo/sub/.claude/settings.local.json',
      '/w/repo/.mcp.json',
      'C:\\w\\repo\\.MCP.JSON.',
      '/w/repo/.codex/config.toml',
    ]) {
      expect(launchFileReason(p), p).not.toBeNull();
    }
    for (const p of [
      '/w/repo/src/git.ts',
      '/w/repo/.gitignore',
      '/home/u/profile.txt',
      '/w/.config/app.json',
      '/w/constructor/__proto__/toString',
    ]) {
      expect(launchFileReason(p), p).toBeNull();
    }
  });
});

describe('fs tools', () => {
  it('lists the granted folders and their files', async () => {
    const s = setup();
    expect(await run(s, 'fs_list', {})).toEqual({
      folders: [
        { path: s.work, write: true },
        { path: s.docs, write: false },
      ],
    });
    const listed = await run(s, 'fs_list', { path: s.work });
    expect(listed['entries']).toEqual([
      expect.objectContaining({ path: 'note.txt', type: 'file', size: 5 }),
    ]);
  });

  it('reads text files in parts, relative paths from the first granted folder', async () => {
    const s = setup();
    writeFileSync(join(s.work, 'lungo.txt'), 'x'.repeat(1500));
    const first = await run(s, 'fs_read', { path: 'lungo.txt', max_chars: 1000 });
    expect(first).toMatchObject({ chars: 1500, truncated: true, next_offset: 1000 });
    const second = await run(s, 'fs_read', { path: 'lungo.txt', offset: 1000 });
    expect(second).toMatchObject({ truncated: false, offset: 1000 });
    expect((second['content'] as string).length).toBe(500);
    expect(await run(s, 'fs_read', { path: join(s.docs, 'contratto.md') })).toMatchObject({
      content: '# Contratto\n',
    });
    writeFileSync(join(s.work, 'foto.bin'), Buffer.from([1, 0, 2, 3]));
    expect((await toolError(run(s, 'fs_read', { path: 'foto.bin' }))).code).toBe('INVALID_INPUT');
  });

  it('marks file contents as external data', () => {
    const s = setup();
    expect(s.tool('fs_read').externalSource?.({}, { path: '/x/y.md' })).toBe('file /x/y.md');
  });

  it('refuses paths outside the granted folders, saying which folder to ask for', async () => {
    const s = setup();
    const err = await toolError(run(s, 'fs_read', { path: join(s.outside, 'segreto.txt') }));
    expect(err.code).toBe('SETTING_OFF');
    expect(err.message).toContain('outside the folders granted to you');
    expect(err.hint).toContain(`Ask the user to grant "${s.outside}"`);
    expect(err.hint).toContain('Settings → Permissions');
    const up = await toolError(run(s, 'fs_read', { path: '../fuori/segreto.txt' }));
    expect(up.code).toBe('SETTING_OFF');
  });

  it('refuses everything without granted folders', async () => {
    const s = setup();
    const err = await toolError(run(s, 'fs_list', {}, 'dione'));
    expect(err.code).toBe('SETTING_OFF');
    expect(err.hint).toContain('Ask the user to grant a folder');
  });

  it.skipIf(!POSIX)('refuses symlinks that lead out of a granted folder', async () => {
    const s = setup();
    symlinkSync(s.outside, join(s.work, 'scorciatoia'));
    symlinkSync(join(s.outside, 'segreto.txt'), join(s.work, 'link.txt'));
    symlinkSync(join(s.outside, 'nuovo.txt'), join(s.work, 'pendente.txt'));
    for (const path of ['scorciatoia/segreto.txt', 'link.txt']) {
      const err = await toolError(run(s, 'fs_read', { path }));
      expect(err.code).toBe('SETTING_OFF');
      expect(err.message).toContain('link that leads outside');
    }
    // A dangling link would create its target outside: refused too.
    const err = await toolError(
      run(s, 'fs_write', { path: 'pendente.txt', content: 'x', mode: 'overwrite' }),
    );
    expect(err.code).toBe('SETTING_OFF');
    expect(existsSync(join(s.outside, 'nuovo.txt'))).toBe(false);
    // A link that stays inside is fine.
    symlinkSync(join(s.work, 'note.txt'), join(s.work, 'alias.txt'));
    expect(await run(s, 'fs_read', { path: 'alias.txt' })).toMatchObject({ content: 'ciao\n' });
  });

  it('keeps the vault and the data folder of Monsters out of reach', async () => {
    const s = setup();
    const err = await toolError(run(s, 'fs_read', { path: join(s.vault, 'idea.md') }));
    expect(err).toMatchObject({ code: 'BLOCKED_BY_POLICY', hint: 'Use vault_read.' });
    s.grants['rhea']!.push({ path: s.root, write: true });
    const home = await toolError(run(s, 'fs_read', { path: join(s.home, 'settings.json') }));
    expect(home.code).toBe('BLOCKED_BY_POLICY');
  });

  it.skipIf(!POSIX)(
    'a link in a granted folder never reaches the data folder (D-078)',
    async () => {
      const s = setup();
      mkdirSync(join(s.home, 'secrets'), { recursive: true });
      writeFileSync(join(s.home, 'secrets', 'keys.json'), '{"k":"v"}');
      symlinkSync(join(s.home, 'secrets'), join(s.work, 'chiavi'));
      for (const path of ['chiavi/keys.json', join(s.work, 'chiavi', 'keys.json')]) {
        const err = await toolError(run(s, 'fs_read', { path }));
        expect(err.code, path).toBe('BLOCKED_BY_POLICY');
      }
      const write = await toolError(
        run(s, 'fs_write', { path: 'chiavi/nuovo.json', content: '{}' }),
      );
      expect(write.code).toBe('BLOCKED_BY_POLICY');
      expect(existsSync(join(s.home, 'secrets', 'nuovo.json'))).toBe(false);
      const list = await toolError(run(s, 'fs_list', { path: 'chiavi' }));
      expect(list.code).toBe('BLOCKED_BY_POLICY');
    },
  );

  it('writes only where changes are allowed', async () => {
    const s = setup();
    const ro = await toolError(
      run(s, 'fs_write', { path: join(s.docs, 'nuovo.md'), content: 'x' }),
    );
    expect(ro.code).toBe('SETTING_OFF');
    expect(ro.message).toContain('read only');
    expect(ro.hint).toContain(`allow changes in "${s.docs}"`);
    expect(existsSync(join(s.docs, 'nuovo.md'))).toBe(false);
  });

  it('creates, refuses to overwrite by accident, overwrites with a backup and appends', async () => {
    const s = setup();
    expect(
      await run(s, 'fs_write', { path: 'sotto/cartella/a.txt', content: 'uno' }),
    ).toMatchObject({ mode: 'create', bytes: 3 });
    expect(readFileSync(join(s.work, 'sotto/cartella/a.txt'), 'utf8')).toBe('uno');
    const exists = await toolError(run(s, 'fs_write', { path: 'note.txt', content: 'x' }));
    expect(exists.code).toBe('EXISTS');
    const over = await run(s, 'fs_write', {
      path: 'note.txt',
      content: 'nuovo',
      mode: 'overwrite',
    });
    expect(readFileSync(join(s.work, 'note.txt'), 'utf8')).toBe('nuovo');
    expect(readFileSync(over['backup'] as string, 'utf8')).toBe('ciao\n');
    expect(isInside(s.trash, over['backup'] as string)).toBe(true);
    await run(s, 'fs_write', { path: 'note.txt', content: '!', mode: 'append' });
    expect(readFileSync(join(s.work, 'note.txt'), 'utf8')).toBe('nuovo!');
  });

  it('moves and deletes into the trash, never the granted folder itself', async () => {
    const s = setup();
    await run(s, 'fs_move', { from: 'note.txt', to: 'archivio/note.txt' });
    expect(existsSync(join(s.work, 'archivio/note.txt'))).toBe(true);
    writeFileSync(join(s.work, 'altro.txt'), 'altro');
    const clash = await toolError(
      run(s, 'fs_move', { from: 'altro.txt', to: 'archivio/note.txt' }),
    );
    expect(clash.code).toBe('EXISTS');
    const deleted = await run(s, 'fs_delete', { path: 'archivio' });
    expect(existsSync(join(s.work, 'archivio'))).toBe(false);
    expect(readdirSync(deleted['trash'] as string)).toEqual(['note.txt']);
    const root = await toolError(run(s, 'fs_delete', { path: s.work }));
    expect(root.code).toBe('INVALID_INPUT');
    const fromRo = await toolError(
      run(s, 'fs_move', { from: join(s.docs, 'contratto.md'), to: 'contratto.md' }),
    );
    expect(fromRo.code).toBe('SETTING_OFF');
  });

  it('never moves or deletes a folder that holds the vault, the data folder or a granted folder', async () => {
    const s = setup();
    s.grants['rhea'] = [
      { path: s.work, write: true },
      { path: s.docs, write: true },
    ];
    const del = await toolError(run(s, 'fs_delete', { path: s.docs }));
    expect(del.code).toBe('INVALID_INPUT');
    // documenti/ holds the vault: granted with write, still not as a whole.
    s.grants['rhea'] = [{ path: s.root, write: true }];
    for (const call of [
      () => run(s, 'fs_delete', { path: s.docs }),
      () => run(s, 'fs_move', { from: s.docs, to: join(s.root, 'altro') }),
      () => run(s, 'fs_move', { from: 'lavoro/note.txt', to: s.docs, overwrite: true }),
    ]) {
      const err = await toolError(call());
      expect(err.code).toBe('BLOCKED_BY_POLICY');
      expect(err.message).toContain('off limits');
    }
    expect((await toolError(run(s, 'fs_delete', { path: 'home' }))).code).toBe('BLOCKED_BY_POLICY');
    expect(readFileSync(join(s.vault, 'idea.md'), 'utf8')).toBe('nota del vault');
    expect(existsSync(join(s.home, 'settings.json'))).toBe(true);
    expect(existsSync(s.trash)).toBe(false);
  });

  it.skipIf(!POSIX)('moves and deletes a link, not what it points to', async () => {
    const s = setup();
    writeFileSync(join(s.work, 'vero.txt'), 'importante');
    symlinkSync(join(s.work, 'vero.txt'), join(s.work, 'link.txt'));
    const deleted = await run(s, 'fs_delete', { path: 'link.txt' });
    expect(readFileSync(join(s.work, 'vero.txt'), 'utf8')).toBe('importante');
    expect(existsSync(join(s.work, 'link.txt'))).toBe(false);
    expect(lstatSync(deleted['trash'] as string).isSymbolicLink()).toBe(true);
    symlinkSync(join(s.work, 'vero.txt'), join(s.work, 'a'));
    await run(s, 'fs_move', { from: 'a', to: 'b' });
    expect(lstatSync(join(s.work, 'b')).isSymbolicLink()).toBe(true);
    expect(readdirSync(s.work).sort()).toEqual(['b', 'note.txt', 'vero.txt']);
    // A link to a folder out of reach can be removed: what it points to stays.
    symlinkSync(s.vault, join(s.work, 'vault-link'));
    await run(s, 'fs_delete', { path: 'vault-link' });
    expect(existsSync(join(s.vault, 'idea.md'))).toBe(true);
  });

  it('refuses to replace a folder with something inside it', async () => {
    const s = setup();
    mkdirSync(join(s.work, 'dir', 'sub'), { recursive: true });
    writeFileSync(join(s.work, 'dir', 'sub', 'f.txt'), 'f');
    writeFileSync(join(s.work, 'dir', 'g.txt'), 'g');
    const err = await toolError(run(s, 'fs_move', { from: 'dir/sub', to: 'dir', overwrite: true }));
    expect(err.code).toBe('INVALID_INPUT');
    expect(readFileSync(join(s.work, 'dir', 'sub', 'f.txt'), 'utf8')).toBe('f');
    expect(existsSync(join(s.work, 'dir', 'g.txt'))).toBe(true);
    const inside = await toolError(run(s, 'fs_move', { from: 'dir', to: 'dir/sub/dir' }));
    expect(inside.code).toBe('INVALID_INPUT');
  });

  // On macOS the two spellings are the same folder (APFS ignores Unicode form).
  it.skipIf(process.platform === 'darwin')(
    'refuses a twin folder spelled in another Unicode form',
    async () => {
      const s = setup();
      const nfc = join(s.root, 'café');
      const nfd = join(s.root, 'café');
      mkdirSync(nfc);
      mkdirSync(nfd);
      s.grants['rhea'] = [{ path: nfc, write: true }];
      const err = await toolError(run(s, 'fs_write', { path: join(nfd, 'x.txt'), content: 'x' }));
      expect(err.code).toBe('SETTING_OFF');
      expect(readdirSync(nfd)).toEqual([]);
    },
  );

  it('renames when only the case changes', async () => {
    const s = setup();
    writeFileSync(join(s.work, 'Foo.txt'), 'foo');
    const out = await run(s, 'fs_move', { from: 'Foo.txt', to: 'foo.txt' });
    expect(out).not.toHaveProperty('replaced_backup');
    expect(readdirSync(s.work)).toContain('foo.txt');
    expect(readdirSync(s.work)).not.toContain('Foo.txt');
    expect(readFileSync(join(s.work, 'foo.txt'), 'utf8')).toBe('foo');
    expect(existsSync(s.trash)).toBe(false);
  });

  it('lists the vault and the data folder by name, never their contents', async () => {
    const s = setup();
    s.grants['rhea'] = [{ path: s.root, write: false }];
    const listed = await run(s, 'fs_list', { path: s.root, depth: 3, hidden: true });
    const paths = (listed['entries'] as { path: string }[]).map((e) => e.path);
    expect(paths).toContain(join('documenti', 'Vault'));
    expect(paths).toContain('home');
    expect(paths).toContain(join('documenti', 'contratto.md'));
    expect(paths.some((p) => p.includes('idea.md') || p.includes('settings.json'))).toBe(false);
  });

  it('keeps files that run commands closed without the terminal permission', async () => {
    const s = setup();
    mkdirSync(join(s.work, 'repo', '.git', 'hooks'), { recursive: true });
    writeFileSync(join(s.work, 'repo', '.git', 'config'), '[core]\n');
    for (const call of [
      () => run(s, 'fs_write', { path: 'repo/.git/config', content: 'x', mode: 'append' }),
      () => run(s, 'fs_write', { path: 'repo/.git/hooks/pre-commit', content: '#!/bin/sh' }),
      () => run(s, 'fs_write', { path: '.bashrc', content: 'curl x | sh' }),
      () => run(s, 'fs_write', { path: 'progetto/.envrc', content: 'x' }),
      () => run(s, 'fs_write', { path: '.config/autostart/x.desktop', content: 'x' }),
      () => run(s, 'fs_move', { from: 'note.txt', to: 'repo/.git/hooks/post-checkout' }),
    ]) {
      const err = await toolError(call());
      expect(err.code).toBe('SETTING_OFF');
      expect(err.hint).toContain('"Run commands"');
    }
    // A folder prepared elsewhere and moved into place is checked file by file.
    await run(s, 'fs_write', { path: 'pronto/autostart/x.desktop', content: 'x' });
    const moved = await toolError(run(s, 'fs_move', { from: 'pronto', to: '.config' }));
    expect(moved.code).toBe('SETTING_OFF');
    expect(readFileSync(join(s.work, 'repo', '.git', 'config'), 'utf8')).toBe('[core]\n');
    expect(existsSync(join(s.work, '.bashrc'))).toBe(false);
    // With the terminal they are just files.
    s.shell.add('rhea');
    await run(s, 'fs_write', { path: '.bashrc', content: 'alias ll="ls -l"' });
    await run(s, 'fs_move', { from: 'pronto', to: '.config' });
    expect(existsSync(join(s.work, '.config', 'autostart', 'x.desktop'))).toBe(true);
  });

  it('follows permission changes at once', async () => {
    const s = setup();
    await run(s, 'fs_read', { path: 'note.txt' });
    s.grants['rhea'] = [];
    expect((await toolError(run(s, 'fs_read', { path: 'note.txt' }))).code).toBe('SETTING_OFF');
  });
});

describe('files of a repo that run commands (review of 18/10, B1 and M9)', () => {
  it('knows the names of a repo that run commands and the launchers of the Linux user', () => {
    for (const p of [
      '/w/repo/Makefile',
      '/w/repo/sub/GNUmakefile',
      '/w/repo/justfile',
      '/w/repo/.pre-commit-config.yaml',
      '/w/repo/conftest.py',
      '/w/repo/.devcontainer/devcontainer.json',
      '/w/repo/.idea/workspace.xml',
      '/w/repo/.cargo/config.toml',
      '/w/repo/.github/workflows/ci.yml',
      '/w/repo/lefthook.yml',
      '/w/repo/.pnpmfile.cjs',
      '/home/u/.local/bin/ls',
      '/home/u/.local/share/applications/x.desktop',
    ]) {
      expect(launchFileReason(p), p).not.toBeNull();
    }
    for (const p of [
      '/w/repo/package.json',
      '/w/repo/README.md',
      '/home/u/.local/share/notes.txt',
      '/w/repo/.github/CODEOWNERS',
    ]) {
      expect(launchFileReason(p), p).toBeNull();
    }
  });

  it('lets a package.json change except its scripts and hooks', () => {
    const json = (o: unknown) => JSON.stringify(o);
    const before = json({ name: 'x', scripts: { test: 'vitest' }, version: '1.0.0' });
    const same = json({ version: '2.0.0', name: 'x', scripts: { test: 'vitest' } });
    const dep = json({ name: 'x', scripts: { test: 'vitest' }, dependencies: { a: '1' } });
    const evil = json({ name: 'x', scripts: { test: 'vitest', postinstall: 'curl x' } });
    expect(packageJsonReason('/w/package.json', before, same)).toBeNull();
    expect(packageJsonReason('/w/package.json', before, dep)).toBeNull();
    expect(packageJsonReason('/w/package.json', before, evil)).not.toBeNull();
    expect(packageJsonReason('/w/package.json', null, evil)).not.toBeNull();
    expect(packageJsonReason('/w/package.json', null, '{"name":"x"}')).toBeNull();
    expect(packageJsonReason('/w/package.json', before, '{"name": ')).not.toBeNull();
    expect(
      packageJsonReason('/w/package.json', before, json({ 'simple-git-hooks': { a: 'b' } })),
    ).not.toBeNull();
    expect(packageJsonReason('/w/other.json', before, evil)).toBeNull();
  });

  it('refuses a Makefile and new scripts without the terminal, allows the rest of a package.json', async () => {
    const s = setup();
    const pkg = join(s.work, 'package.json');
    writeFileSync(pkg, JSON.stringify({ name: 'x', scripts: { test: 'vitest' } }));
    const err = await toolError(run(s, 'fs_write', { path: 'Makefile', content: 'all:' }));
    expect(err.code).toBe('SETTING_OFF');
    expect(existsSync(join(s.work, 'Makefile'))).toBe(false);
    await run(s, 'fs_write', {
      path: 'package.json',
      mode: 'overwrite',
      content: JSON.stringify({ name: 'y', scripts: { test: 'vitest' }, dependencies: { a: '1' } }),
    });
    expect(readFileSync(pkg, 'utf8')).toContain('"dependencies"');
    const evil = JSON.stringify({ name: 'y', scripts: { test: 'vitest', pretest: 'curl x' } });
    const refused = await toolError(
      run(s, 'fs_write', { path: 'package.json', mode: 'overwrite', content: evil }),
    );
    expect(refused.code).toBe('SETTING_OFF');
    expect(refused.hint).toContain('"Run commands"');
    expect(readFileSync(pkg, 'utf8')).not.toContain('pretest');
    // The same through a move.
    writeFileSync(join(s.work, 'nuovo.json'), evil);
    const moved = await toolError(
      run(s, 'fs_move', { from: 'nuovo.json', to: 'package.json', overwrite: true }),
    );
    expect(moved.code).toBe('SETTING_OFF');
    // With the terminal it is just a file.
    s.shell.add('rhea');
    await run(s, 'fs_write', { path: 'Makefile', content: 'all:' });
    await run(s, 'fs_write', { path: 'package.json', mode: 'overwrite', content: evil });
    expect(readFileSync(pkg, 'utf8')).toContain('pretest');
  });
});

describe.skipIf(!POSIX)('fs tools on special files (review of 18/10, B4)', () => {
  it('does not block on a pipe: it is not a regular file', async () => {
    const s = setup();
    execFileSync('mkfifo', [join(s.work, 'pipe')]);
    const reads = [1, 2, 3, 4, 5].map(() => toolError(run(s, 'fs_read', { path: 'pipe' })));
    for (const err of await Promise.all(reads)) expect(err.code).toBe('INVALID_INPUT');
    const written = await toolError(
      run(s, 'fs_write', { path: 'pipe', mode: 'overwrite', content: 'x' }),
    );
    expect(written.code).toBe('INVALID_INPUT');
    // The core still serves other reads.
    expect((await run(s, 'fs_read', { path: 'note.txt' }))['content']).toBe('ciao\n');
  }, 10_000);

  it('does not write a file that has a second name (a hard link) outside the granted folders', async () => {
    const s = setup();
    const secret = join(s.outside, 'segreto.txt');
    linkSync(secret, join(s.work, 'collegato.txt'));
    const err = await toolError(
      run(s, 'fs_write', { path: 'collegato.txt', mode: 'overwrite', content: 'sovrascritto' }),
    );
    expect(err.code).toBe('BLOCKED_BY_POLICY');
    const appended = await toolError(
      run(s, 'fs_write', { path: 'collegato.txt', mode: 'append', content: 'x' }),
    );
    expect(appended.code).toBe('BLOCKED_BY_POLICY');
    expect(readFileSync(secret, 'utf8')).toBe('non leggere');
  });

  it('writes through the descriptor: create, overwrite with a backup, append', async () => {
    const s = setup();
    await run(s, 'fs_write', { path: 'a/b.txt', content: 'uno' });
    const o = await run(s, 'fs_write', { path: 'a/b.txt', mode: 'overwrite', content: 'due' });
    expect(readFileSync(String(o['backup']), 'utf8')).toBe('uno');
    await run(s, 'fs_write', { path: 'a/b.txt', mode: 'append', content: '+tre' });
    expect(readFileSync(join(s.work, 'a', 'b.txt'), 'utf8')).toBe('due+tre');
    await run(s, 'fs_write', { path: 'a/nuovo.txt', mode: 'append', content: 'x' });
    await run(s, 'fs_write', { path: 'a/altro.txt', mode: 'overwrite', content: 'y' });
    expect(readFileSync(join(s.work, 'a', 'altro.txt'), 'utf8')).toBe('y');
  });
});
