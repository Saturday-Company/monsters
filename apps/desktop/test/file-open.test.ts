import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  coreMigrations,
  defaultVaultDir as coreDefaultVaultDir,
  languageOfHome,
  migrate,
  openDb,
  LEGACY_VAULT_DIR_NAME as CORE_LEGACY,
  loadHubSettings,
  SETTINGS_FILE as CORE_SETTINGS,
  VAULT_DIR_NAME as CORE_VAULT,
} from '@monsters/core';
import { describe, expect, it, vi } from 'vitest';
import {
  FILES_DIR as CORE_FILES_DIR,
  FILES_DIR_ALT as CORE_FILES_DIR_ALT,
  FILES_MARKER as CORE_FILES_MARKER,
  filesDirFor,
} from '../../../packages/core/src/files/store.ts';
import {
  checkVaultFile,
  defaultVaultDir,
  FILES_DIR,
  FILES_DIR_ALT,
  FILES_MARKER,
  filesDirOf,
  fileSegments,
  homeLanguage,
  LEGACY_VAULT_DIR_NAME,
  openVaultFile,
  resolveVaultDir,
  runnableByName,
  SETTINGS_FILE,
  showVaultFile,
  VAULT_DIR_NAME,
  type FileShell,
} from '../src/main/file-open.ts';
import { tempDir } from './helpers.ts';

const posix = process.platform !== 'win32';

/** A notes folder with `File/2026-10/foto.png` (mode 644, `File/` marked) and what the test adds. */
function vaultWith(files: Record<string, string> = {}): string {
  const vault = join(tempDir(), 'Monsters Note');
  mkdirSync(join(vault, 'File', '2026-10'), { recursive: true });
  writeFileSync(join(vault, 'File', '.monsters'), 'x');
  writeFileSync(join(vault, 'File', '2026-10', 'foto.png'), 'png');
  chmodSync(join(vault, 'File', '2026-10', 'foto.png'), 0o644);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(vault, rel, '..'), { recursive: true });
    writeFileSync(join(vault, rel), text);
    chmodSync(join(vault, rel), 0o644);
  }
  return vault;
}

function fakeShell(openError = ''): FileShell & { opened: string[]; shown: string[] } {
  const opened: string[] = [];
  const shown: string[] = [];
  return {
    opened,
    shown,
    openPath: (p) => {
      opened.push(p);
      return Promise.resolve(openError);
    },
    showItemInFolder: (p) => {
      shown.push(p);
    },
  };
}

describe('notes folder of the local core', () => {
  it('uses the same names as the core', () => {
    expect(VAULT_DIR_NAME).toBe(CORE_VAULT);
    expect(LEGACY_VAULT_DIR_NAME).toBe(CORE_LEGACY);
    expect(SETTINGS_FILE).toBe(CORE_SETTINGS);
  });

  it('defaults like the core: <home>/Monsters Note, ~/Monsters Note for ~/.monsters', () => {
    const home = tempDir();
    mkdirSync(home, { recursive: true });
    expect(defaultVaultDir(home)).toBe(join(home, 'Monsters Note'));
    expect(defaultVaultDir(home)).toBe(coreDefaultVaultDir(home));
    // The default data directory: the notes sit next to it in the user's home.
    const user = join(home, 'user');
    expect(defaultVaultDir(join(user, '.monsters'), user)).toBe(join(user, 'Monsters Note'));
    expect(defaultVaultDir(join(user, '.monsters', '.'), user)).toBe(join(user, 'Monsters Note'));
    // An old "Monsters Vault" wins.
    mkdirSync(join(home, 'Monsters Vault'));
    expect(defaultVaultDir(home)).toBe(join(home, 'Monsters Vault'));
    expect(coreDefaultVaultDir(home)).toBe(join(home, 'Monsters Vault'));
  });

  it('reads `vault` of settings.json, absolute, relative to the home or with ~', () => {
    const home = tempDir();
    mkdirSync(home, { recursive: true });
    const settings = (value: unknown) =>
      writeFileSync(join(home, 'settings.json'), JSON.stringify({ vault: value }));
    expect(resolveVaultDir(home, {})).toBe(join(home, 'Monsters Note'));
    settings('/srv/notes');
    // An absolute path is kept as written, as in the core (on Windows too: no drive added).
    expect(resolveVaultDir(home, {})).toBe('/srv/notes');
    expect(resolveVaultDir(home, {})).toBe(loadHubSettings(home, {}, {}).vault);
    settings('appunti');
    expect(resolveVaultDir(home, {})).toBe(join(home, 'appunti'));
    settings('~/Note');
    expect(resolveVaultDir(home, {}, '/u')).toBe(join('/u', 'Note'));
    // MONSTERS_VAULT wins, as in the core.
    expect(resolveVaultDir(home, { MONSTERS_VAULT: '/x/v' })).toBe('/x/v');
    expect(resolveVaultDir(home, { MONSTERS_VAULT: '/x/v' })).toBe(
      loadHubSettings(home, {}, { MONSTERS_VAULT: '/x/v' }).vault,
    );
  });

  it('gives up on a settings.json the core would refuse', () => {
    const home = tempDir();
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'settings.json'), '{ not json');
    expect(resolveVaultDir(home, {})).toBeNull();
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ vault: 7 }));
    expect(resolveVaultDir(home, {})).toBeNull();
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ vault: '' }));
    expect(resolveVaultDir(home, {})).toBeNull();
    writeFileSync(join(home, 'settings.json'), '[]');
    expect(resolveVaultDir(home, {})).toBeNull();
  });
});

describe('language of the data folder (D-153)', () => {
  const withAccount = (home: string): void => {
    mkdirSync(home, { recursive: true });
    const db = openDb(join(home, 'monsters.db'));
    migrate(db, 'core', coreMigrations);
    db.run(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ('u', 'a@b.it', 'x', 1)",
    );
    db.close();
  };

  it('settings.json first, then Italian for a folder with an account, else nothing (the system)', () => {
    expect(homeLanguage(tempDir())).toBeNull();

    // A core that ran without an account: no Italian by itself.
    const noUser = tempDir();
    mkdirSync(noUser, { recursive: true });
    const db = openDb(join(noUser, 'monsters.db'));
    migrate(db, 'core', coreMigrations);
    db.close();
    expect(homeLanguage(noUser)).toBeNull();

    // An install of before the update: an account and no `language`.
    const old = tempDir();
    withAccount(old);
    writeFileSync(join(old, 'settings.json'), JSON.stringify({ userName: 'Giulia' }));
    expect(homeLanguage(old)).toBe('it');
    expect(languageOfHome(old, { MONSTERS_LANG: 'en' })).toBe('it');

    writeFileSync(join(old, 'settings.json'), JSON.stringify({ language: 'en' }));
    expect(homeLanguage(old)).toBe('en');
    expect(languageOfHome(old, { MONSTERS_LANG: 'it' })).toBe('en');
  });
});

describe('files folder of the core', () => {
  it('uses the same names as the core', () => {
    expect(FILES_DIR).toBe(CORE_FILES_DIR);
    expect(FILES_DIR_ALT).toBe(CORE_FILES_DIR_ALT);
    expect(FILES_MARKER).toBe(CORE_FILES_MARKER);
  });

  it('is the folder the core marked, as filesDirFor finds it', () => {
    const vault = join(tempDir(), 'Note');
    mkdirSync(vault, { recursive: true });
    expect(filesDirOf(vault)).toBeNull();
    // A File/ of the user's own: notes, never the files folder.
    mkdirSync(join(vault, 'File'));
    writeFileSync(join(vault, 'File', 'idea.md'), 'nota');
    expect(filesDirOf(vault)).toBeNull();
    const alt = join(vault, 'File di Monsters');
    mkdirSync(join(alt, '2026-10'), { recursive: true });
    writeFileSync(join(alt, '.monsters'), 'x');
    expect(filesDirOf(vault)).toBe('File di Monsters');
    expect(filesDirFor(vault)).toBe('File di Monsters');
    // A folder named like the marker is not the marker.
    const third = join(tempDir(), 'Note');
    mkdirSync(join(third, 'File', '.monsters'), { recursive: true });
    expect(filesDirOf(third)).toBeNull();
  });

  it('opens files of File di Monsters/ and refuses the user’s File/', async () => {
    const vault = join(tempDir(), 'Note');
    mkdirSync(join(vault, 'File'), { recursive: true });
    writeFileSync(join(vault, 'File', 'idea.md'), 'nota privata');
    const alt = join(vault, 'File di Monsters');
    mkdirSync(join(alt, '2026-10'), { recursive: true });
    writeFileSync(join(alt, '.monsters'), 'x');
    writeFileSync(join(alt, '2026-10', 'foto.png'), 'png');
    chmodSync(join(alt, '2026-10', 'foto.png'), 0o644);
    expect(checkVaultFile(vault, 'File di Monsters/2026-10/foto.png')).toMatchObject({
      ok: true,
      runnable: false,
    });
    expect(checkVaultFile(vault, 'File/idea.md')).toEqual({
      ok: false,
      reason: 'not the files folder of Monsters',
    });
    const shell = fakeShell();
    expect(await openVaultFile(vault, 'File/idea.md', shell, vi.fn())).toBe(false);
    expect(showVaultFile(vault, 'File/idea.md', shell, vi.fn())).toBe(false);
    expect(shell.opened).toEqual([]);
    expect(shell.shown).toEqual([]);
    // The marker removed: nothing is Monsters' any more (an old path gets a refusal, no throw).
    rmSync(join(alt, '.monsters'));
    expect(checkVaultFile(vault, 'File di Monsters/2026-10/foto.png')).toEqual({
      ok: false,
      reason: 'not the files folder of Monsters',
    });
  });

  it('refuses File/ when it has no marker', () => {
    const vault = vaultWith();
    rmSync(join(vault, 'File', '.monsters'));
    expect(checkVaultFile(vault, 'File/2026-10/foto.png').ok).toBe(false);
  });
});

describe('paths from the page', () => {
  it('accepts plain relative paths under File/ or File di Monsters/', () => {
    expect(fileSegments('File/2026-10/foto.png')).toEqual(['File', '2026-10', 'foto.png']);
    expect(fileSegments('File/a b (1).pdf')).toEqual(['File', 'a b (1).pdf']);
    expect(fileSegments('File di Monsters/2026-10/a.pdf')).toEqual([
      'File di Monsters',
      '2026-10',
      'a.pdf',
    ]);
    expect(fileSegments('File di Monsters 2/a.pdf')).toEqual(['File di Monsters 2', 'a.pdf']);
  });

  it('refuses everything else', () => {
    for (const bad of [
      42,
      null,
      undefined,
      {},
      '',
      'File',
      'File/',
      'foto.png',
      'Note/idea.md',
      'file/foto.png',
      'File di Monsters',
      'File di monsters/a.pdf',
      'File di Monsters 0/a.pdf',
      'File di Monsters x/a.pdf',
      'Altro/File/a.pdf',
      '/etc/passwd',
      '/File/foto.png',
      'C:/Windows/notepad.exe',
      'C:File/x.png',
      '\\\\server\\share\\x.png',
      'File\\..\\..\\x',
      'File/../settings.json',
      'File/2026-10/../../x',
      'File/./foto.png',
      'File//foto.png',
      'File/foto.png\u0000.txt',
      'File/foto\n.png',
      'File/foto.png:stream',
      'File/foto.exe.',
      'File/foto.exe ',
      'File/con.txt',
      'File/NUL',
      'File/' + 'a'.repeat(1100),
    ]) {
      expect(fileSegments(bad), JSON.stringify(bad) ?? 'undefined').toBeNull();
    }
  });

  it('knows the extensions that run something', () => {
    for (const name of [
      'x.exe',
      'x.EXE',
      'x.bat',
      'x.cmd',
      'x.ps1',
      'x.vbs',
      'x.js',
      'x.lnk',
      'x.url',
      'x.hta',
      'x.msi',
      'x.reg',
      'x.appref-ms',
      'x.app',
      'x.command',
      'x.pkg',
      'x.terminal',
      'x.workflow',
      'x.desktop',
      'x.sh',
      'x.run',
      'x.AppImage',
      'x.bin',
      'x.py',
      'archive.tar.sh',
      'pagina.html',
      'disegno.svg',
    ]) {
      expect(runnableByName(name), name).toBe(true);
    }
    for (const name of ['foto.png', 'doc.pdf', 'note.md', 'x.tar.gz', 'README']) {
      expect(runnableByName(name), name).toBe(false);
    }
  });
});

describe('files of the notes folder', () => {
  it('finds a regular file under File/', () => {
    const vault = vaultWith();
    const check = checkVaultFile(vault, 'File/2026-10/foto.png');
    expect(check).toMatchObject({ ok: true, runnable: false });
    expect(check.ok && check.path.endsWith('foto.png')).toBe(true);
  });

  it('refuses missing files, folders and files outside File/', () => {
    const vault = vaultWith({ 'Idee/nota.md': 'x' });
    expect(checkVaultFile(vault, 'File/2026-10/manca.png')).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(checkVaultFile(vault, 'File/2026-10')).toEqual({
      ok: false,
      reason: 'not a regular file',
    });
    expect(checkVaultFile(vault, 'Idee/nota.md').ok).toBe(false);
    expect(checkVaultFile(join(vault, 'nowhere'), 'File/2026-10/foto.png').ok).toBe(false);
  });

  it.skipIf(!posix)('follows no symlink out of File/', () => {
    const vault = vaultWith({ 'Idee/nota.md': 'x' });
    const outside = join(vault, '..', 'segreto.txt');
    writeFileSync(outside, 'secret');
    symlinkSync(outside, join(vault, 'File', 'link.txt'));
    symlinkSync(join(vault, 'Idee'), join(vault, 'File', 'idee'));
    symlinkSync(join(vault, 'File', '2026-10', 'foto.png'), join(vault, 'File', 'dentro.png'));
    expect(checkVaultFile(vault, 'File/link.txt')).toEqual({ ok: false, reason: 'outside File/' });
    expect(checkVaultFile(vault, 'File/idee/nota.md')).toEqual({
      ok: false,
      reason: 'outside File/',
    });
    // A link that stays inside File/ is fine: the real file is what opens.
    const inside = checkVaultFile(vault, 'File/dentro.png');
    expect(inside.ok && inside.path.endsWith(join('2026-10', 'foto.png'))).toBe(true);
    // A link with a harmless name to a runnable file is still runnable.
    writeFileSync(join(vault, 'File', 'run.sh'), 'echo');
    chmodSync(join(vault, 'File', 'run.sh'), 0o644);
    symlinkSync(join(vault, 'File', 'run.sh'), join(vault, 'File', 'innocuo.txt'));
    expect(checkVaultFile(vault, 'File/innocuo.txt')).toMatchObject({ ok: true, runnable: true });
  });

  it('marks runnable files: by extension, and with an execute bit on POSIX', () => {
    const vault = vaultWith({ 'File/setup.exe': 'MZ', 'File/tool': '#!/bin/sh' });
    expect(checkVaultFile(vault, 'File/setup.exe')).toMatchObject({ ok: true, runnable: true });
    expect(checkVaultFile(vault, 'File/tool')).toMatchObject({ ok: true, runnable: false });
    if (posix) {
      chmodSync(join(vault, 'File', 'tool'), 0o755);
      expect(checkVaultFile(vault, 'File/tool', 'linux')).toMatchObject({ runnable: true });
      expect(checkVaultFile(vault, 'File/tool', 'darwin')).toMatchObject({ runnable: true });
    }
  });
});

describe('open and show', () => {
  it('opens a plain file with the system', async () => {
    const vault = vaultWith();
    const shell = fakeShell();
    const log = vi.fn();
    expect(await openVaultFile(vault, 'File/2026-10/foto.png', shell, log)).toBe(true);
    expect(shell.opened).toHaveLength(1);
    expect(shell.shown).toEqual([]);
  });

  it('shows a runnable file in its folder instead of opening it', async () => {
    const vault = vaultWith({ 'File/2026-10/setup.bat': 'echo' });
    const shell = fakeShell();
    const log = vi.fn();
    expect(await openVaultFile(vault, 'File/2026-10/setup.bat', shell, log)).toBe(false);
    expect(shell.opened).toEqual([]);
    expect(shell.shown).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('it could run'));
  });

  it('is false when the system cannot open it, or nothing is checked', async () => {
    const vault = vaultWith();
    const log = vi.fn();
    expect(await openVaultFile(vault, 'File/2026-10/foto.png', fakeShell('no app'), log)).toBe(
      false,
    );
    const shell = fakeShell();
    expect(await openVaultFile(null, 'File/2026-10/foto.png', shell, log)).toBe(false);
    expect(await openVaultFile(vault, '../settings.json', shell, log)).toBe(false);
    expect(shell.opened).toEqual([]);
    expect(shell.shown).toEqual([]);
  });

  it('shows a file in its folder after the same checks', () => {
    const vault = vaultWith({ 'File/setup.exe': 'MZ' });
    const shell = fakeShell();
    const log = vi.fn();
    expect(showVaultFile(vault, 'File/2026-10/foto.png', shell, log)).toBe(true);
    expect(showVaultFile(vault, 'File/setup.exe', shell, log)).toBe(true);
    expect(showVaultFile(vault, 'File/manca.png', shell, log)).toBe(false);
    expect(showVaultFile(null, 'File/2026-10/foto.png', shell, log)).toBe(false);
    expect(showVaultFile(vault, '/etc/passwd', shell, log)).toBe(false);
    expect(shell.shown).toHaveLength(2);
    expect(shell.opened).toEqual([]);
  });
});
