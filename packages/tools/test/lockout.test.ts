import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { setAppLang } from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  forbiddenEntries,
  instructionFilesDenied,
  internalFilesDenied,
  internalFilesTreeDenied,
  lockedCommand,
  lockedPath,
  lockedSearch,
  type DataDirLock,
} from '../src/index.ts';

/*
 * D-078: the data folder of Monsters is closed to the agents' own terminal
 * and files, except each agent's working folder inside it.
 */

let root: string;
let home: string;
let data: string;
let ws: string;
let lock: DataDirLock;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'monsters-lockout-'));
  home = join(root, 'user');
  data = join(home, '.monsters');
  ws = join(data, 'workspaces', 'titan');
  mkdirSync(ws, { recursive: true });
  mkdirSync(join(data, 'workspaces', 'rhea'), { recursive: true });
  mkdirSync(join(data, 'agents', 'titan'), { recursive: true });
  mkdirSync(join(data, 'secrets'), { recursive: true });
  writeFileSync(join(data, 'monsters.db'), '');
  writeFileSync(join(data, 'settings.json'), '{}');
  mkdirSync(join(home, 'Documenti'), { recursive: true });
  lock = { dataDir: data, allowed: [ws], home };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('paths of the file tools', () => {
  it('closes the data folder in every spelling, opens the working folder', () => {
    for (const p of [
      join(data, 'agents', 'titan', 'agent.yaml'),
      '~/.monsters/secrets/keys.json',
      '$HOME/.monsters/monsters.db',
      '../../agents/titan/agent.yaml',
      '../rhea/notes.md',
      '..',
      join(ws, '..', '..', 'settings.json'),
      data,
    ]) {
      const v = lockedPath(p, ws, lock);
      expect(v?.message, p).toBe(internalFilesDenied());
    }
    for (const p of [
      join(ws, 'AGENTS.md'),
      'note.txt',
      './bin/tool',
      '~/Documenti/lettera.txt',
      join(home, 'Documenti'),
      home,
    ]) {
      expect(lockedPath(p, ws, lock), p).toBeNull();
    }
  });

  it('follows a link in the working folder that leads into the data folder', () => {
    symlinkSync(join(data, 'secrets'), join(ws, 'chiavi'));
    expect(lockedPath('chiavi/keys.json', ws, lock)?.message).toBe(internalFilesDenied());
    expect(lockedPath(join(ws, 'chiavi'), ws, lock)?.message).toBe(internalFilesDenied());
    // A link out of the working folder to the user's documents is fine.
    symlinkSync(join(home, 'Documenti'), join(ws, 'docs'));
    expect(lockedPath('docs/lettera.txt', ws, lock)).toBeNull();
  });

  it('searches: a folder that holds the data folder is closed to a tree walk only', () => {
    expect(lockedSearch({ path: '../..', recursive: true }, ws, lock)?.message).toBe(
      internalFilesDenied(),
    );
    expect(lockedSearch({ path: home, recursive: true }, ws, lock)?.message).toBe(
      internalFilesTreeDenied(),
    );
    expect(
      lockedSearch({ path: '~', pattern: '**/*.json', recursive: false }, ws, lock)?.message,
    ).toBe(internalFilesTreeDenied());
    expect(
      lockedSearch({ pattern: `${data}/agents/**/*.yaml`, recursive: false }, ws, lock)?.message,
    ).toBe(internalFilesDenied());
    expect(lockedSearch({ path: '~', pattern: '*.txt', recursive: false }, ws, lock)).toBeNull();
    expect(lockedSearch({ path: '~/Documenti', recursive: true }, ws, lock)).toBeNull();
    expect(lockedSearch({ recursive: true }, ws, lock)).toBeNull();
  });

  it('lists what deny rules must cover: everything but the working folder', () => {
    // Real paths (`/private/var/…` on macOS, long names on Windows): relative to the real folder.
    const real = realpathSync.native(data);
    const entries = forbiddenEntries(lock).map((p) => relative(real, p).replace(/\\/g, '/'));
    expect(entries.sort()).toEqual(
      ['agents', 'monsters.db', 'secrets', 'settings.json', 'workspaces/rhea'].sort(),
    );
  });
});

describe('command lines', () => {
  it('refuses the data folder named in a command, however it is written', () => {
    for (const c of [
      `cat ${join(data, 'secrets', 'keys.json')}`,
      'ls ~/.monsters/agents',
      'cat "$HOME/.monsters/settings.json"',
      'cat ${HOME}/.monsters/monsters.db',
      'sqlite3 ~/.monsters/monsters.db .tables',
      'cat ../../agents/titan/agent.yaml',
      'ls ..',
      'cd .. && ls',
      'cd ../.. ; cat settings.json',
      'cd ~ && cat .monsters/settings.json',
      'cd ~; cd .monsters',
      `python3 -c "print(open('${join(data, 'secrets', 'k')}').read())"`,
      'cp --target-directory=../../agents x',
      'ln -s ~/.monsters/secrets chiavi',
      'cat $MONSTERS_HOME/settings.json',
    ]) {
      expect(lockedCommand(c, ws, lock)?.message, c).toBe(internalFilesDenied());
    }
  });

  it('refuses a tree walk from a folder that holds the data folder', () => {
    for (const c of [
      'grep -r token ~',
      'find / -name monsters.db',
      'du -sh ~',
      'cd ~ && rg password',
      'tar czf /tmp/all.tgz ~',
      'ls -R ~',
    ]) {
      expect(lockedCommand(c, ws, lock)?.message, c).toBe(internalFilesTreeDenied());
    }
  });

  it('lets the ordinary work through', () => {
    for (const c of [
      'ls -la',
      'npm install -g cowsay',
      'cat AGENTS.md',
      'mkdir -p out && echo ciao > out/a.txt',
      `ls ${ws}`,
      'git clone https://github.com/example/repo.git',
      'ls ~',
      'cat ~/Documenti/lettera.txt',
      'grep -r ciao ~/Documenti',
      'find . -name "*.md"',
      'python3 -c "print(1+1)"',
      'curl -s https://example.com/a/b',
    ]) {
      expect(lockedCommand(c, ws, lock), c).toBeNull();
    }
  });

  it('refuses quotes, escapes, globs and other homes that spell the data folder (a brake)', () => {
    for (const c of [
      "cat ~/.mon''sters/settings.json",
      'cat ~/.mon""sters/settings.json',
      'cat ~/.mon\\sters/settings.json',
      'cat "$HOME"/.monsters/settings.json',
      'cat ~/.mon*/settings.json',
      'cat ~/.monster?/settings.json',
      'cat ~/.mon[s]ters/settings.json',
      'cat ~/.{monsters,x}/settings.json',
      'rm -rf ~/.mon*',
      'cat ~/.*/settings.json',
      'cd ~/.mon* && cat settings.json',
      'cd ~ && cat .mon*/settings.json',
      'cat ~user/.monsters/settings.json',
      'cat ~/.monsters/workspaces/*/notes.md',
    ]) {
      expect(lockedCommand(c, ws, lock)?.message, c).toBe(internalFilesDenied());
    }
    // A glob that could be an ancestor of the data folder, walked recursively.
    expect(lockedCommand('grep -r token /*', ws, lock)?.message).toBe(internalFilesTreeDenied());
    // Another user's home is not ours.
    expect(lockedCommand('cat ~other/.monsters/settings.json', ws, lock)).toBeNull();
  });

  it('lets ordinary globs through', () => {
    for (const c of [
      'ls *.md',
      'cat ./out/*.txt',
      'ls ~/Documenti/*.txt',
      'ls ~/*',
      'cat ~/.monsters/workspaces/titan/*.md',
      `cat ${ws}/**/*.md`,
      'ls -a .*',
      'curl -s "https://example.com/a?b=1"',
      'grep -r ciao ~/Documenti/*',
    ]) {
      expect(lockedCommand(c, ws, lock), c).toBeNull();
    }
  });

  it('follows a link of the working folder named in a command', () => {
    symlinkSync(join(data, 'agents'), join(ws, 'gli-altri'));
    expect(lockedCommand('cat gli-altri/titan/agent.yaml', ws, lock)?.message).toBe(
      internalFilesDenied(),
    );
  });
});

describe('on Windows (path rules of win32)', () => {
  const winHome = 'C:\\Users\\u';
  const winData = `${winHome}\\.monsters`;
  const winWs = `${winData}\\workspaces\\titan`;
  const win: DataDirLock = {
    dataDir: winData,
    allowed: [winWs],
    home: winHome,
    platform: 'win32',
    env: { LOCALAPPDATA: `${winHome}\\AppData\\Local` },
  };

  it('refuses PowerShell and cmd variables, short names, namespaces and case', () => {
    for (const c of [
      'Get-Content $env:USERPROFILE\\.monsters\\settings.json',
      'Get-Content ${env:USERPROFILE}\\.monsters\\settings.json',
      'type %USERPROFILE%\\.monsters\\settings.json',
      'type %HOMEDRIVE%%HOMEPATH%\\.monsters\\settings.json',
      'Get-Content $home\\.monsters\\settings.json',
      'type C:\\Users\\u\\MONSTE~1\\settings.json',
      'cd ~ ; type MONSTE~1\\settings.json',
      'type \\\\?\\C:\\Users\\u\\.monsters\\settings.json',
      'type \\\\.\\C:\\Users\\u\\.monsters\\settings.json',
      'type c:\\users\\U\\.MONSTERS\\settings.json',
      'type C:/Users/u/.monsters/settings.json',
      'Get-Content C:\\Users\\u\\.mon`sters\\settings.json',
      'Get-Content C:\\Users\\u\\.mon*\\settings.json',
      'Get-Content C:\\Users\\u\\*\\settings.json',
    ]) {
      expect(lockedCommand(c, winWs, win)?.message, c).toBe(internalFilesDenied());
    }
    for (const p of [
      'C:\\Users\\u\\MONSTE~1\\settings.json',
      '\\\\?\\C:\\Users\\u\\.monsters\\settings.json',
      '%USERPROFILE%\\.monsters\\secrets',
    ]) {
      expect(lockedPath(p, winWs, win)?.message, p).toBe(internalFilesDenied());
    }
  });

  it('lets the ordinary work through', () => {
    for (const c of [
      'Get-ChildItem',
      'dir ~\\*',
      'type %USERPROFILE%\\Documents\\lettera.txt',
      'Get-Content $env:USERPROFILE\\Documents\\*.txt',
      'type C:\\PROGRA~1\\app\\readme.txt',
      `type ${winWs}\\AGENTS.md`,
      'Get-Content *.md',
    ]) {
      expect(lockedCommand(c, winWs, win), c).toBeNull();
    }
    expect(lockedPath('AGENTS.md', winWs, win)).toBeNull();
    expect(lockedPath('C:\\Users\\u\\DOCUME~1\\a.txt', winWs, win)).toBeNull();
  });

  it('a root without a drive is the root of the working folder’s drive', () => {
    // The core may run from another drive (D:\ on GitHub's runners): `\` is still C:\ here.
    for (const c of ['find / -name monsters.db', 'Get-ChildItem \\ -Recurse', 'grep -r token /*']) {
      expect(lockedCommand(c, winWs, win)?.message, c).toBe(internalFilesTreeDenied());
    }
    expect(lockedPath('\\Users\\u\\.monsters\\settings.json', winWs, win)?.message).toBe(
      internalFilesDenied(),
    );
    expect(lockedSearch({ path: '\\Users\\u', recursive: true }, winWs, win)?.message).toBe(
      internalFilesTreeDenied(),
    );
  });

  // A user name longer than eight letters: %TEMP% and paths built from it carry the
  // 8.3 short name of the home (`C:\Users\RUNNER~1`, the runners of GitHub).
  const shortHome = 'C:\\Users\\RUNNER~1';
  const shortData = `${shortHome}\\.monsters`;
  const shortWs = `${shortData}\\workspaces\\titan`;
  const short: DataDirLock = {
    dataDir: shortData,
    allowed: [shortWs],
    home: shortHome,
    platform: 'win32',
    env: {},
  };

  it('a short name in the folders above the working folder is not the data folder', () => {
    for (const p of [`${shortWs}\\AGENTS.md`, 'AGENTS.md', `${shortWs}\\out\\*.txt`, shortWs]) {
      expect(lockedPath(p, shortWs, short), p).toBeNull();
    }
    for (const c of [
      `ls ${shortWs}`,
      `type ${shortWs}\\AGENTS.md`,
      'cat ./out/*.txt',
      `Get-Content ${shortWs}\\*.md`,
      'ls -la && cat AGENTS.md',
    ]) {
      expect(lockedCommand(c, shortWs, short), c).toBeNull();
    }
    expect(
      lockedSearch({ path: shortWs, pattern: '**/*.md', recursive: true }, shortWs, short),
    ).toBeNull();
    // …while the data folder stays closed, in the short spelling and in others.
    for (const p of [
      `${shortData}\\settings.json`,
      `${shortHome}\\MONSTE~1\\settings.json`,
      `${shortData}\\workspaces\\rhea\\notes.md`,
      `${shortData}\\*\\agent.yaml`,
      '..\\rhea\\notes.md',
    ]) {
      expect(lockedPath(p, shortWs, short)?.message, p).toBe(internalFilesDenied());
    }
    for (const c of [
      `type ${shortData}\\settings.json`,
      `type ${shortHome}\\MONSTE~1\\settings.json`,
      'type ~\\.monsters\\settings.json',
      `Get-Content ${shortData}\\workspaces\\*\\notes.md`,
      `Get-Content ${shortWs}\\..\\rhea\\notes.md`,
    ]) {
      expect(lockedCommand(c, shortWs, short)?.message, c).toBe(internalFilesDenied());
    }
  });
});

describe('the messages of the lockout follow the language of the prompts (D-153)', () => {
  afterEach(() => setAppLang('en'));

  it('Italian family: the words the models have always read', () => {
    setAppLang('it');
    expect(internalFilesDenied()).toBe(
      'I file interni di Monsters non sono accessibili: usa gli strumenti di Monsters.',
    );
    expect(internalFilesTreeDenied()).toBe(
      'Questo comando passerebbe dai file interni di Monsters: restringilo a una cartella precisa, oppure usa gli strumenti di Monsters.',
    );
    expect(instructionFilesDenied()).toBe(
      'CLAUDE.md, AGENTS.md, .claude, .mcp.json e .codex della cartella del progetto (anche nelle sottocartelle) non si scrivono: sono le istruzioni del progetto, le cambia l’utente.',
    );
  });

  it('English family: the twin', () => {
    setAppLang('en');
    expect(internalFilesDenied()).toBe(
      'The internal files of Monsters aren’t accessible: use the Monsters tools.',
    );
    expect(internalFilesTreeDenied()).toMatch(/^This command would go through the internal files/);
    expect(instructionFilesDenied()).toMatch(
      /^CLAUDE\.md, AGENTS\.md, \.claude, \.mcp\.json and \.codex/,
    );
  });
});
