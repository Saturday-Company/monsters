import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromCorePage } from '../src/main/ipc-guards.ts';
import {
  AUTOSTART_FILE,
  autostartDir,
  autostartEntry,
  HIDDEN_ARG,
  linuxLauncher,
  LoginItem,
  parseLoginItemRequest,
  quoteExecArg,
  readAutostart,
  relaunchArgs,
  removeAutostart,
  startsHidden,
  writeAutostart,
  type LoginItemBackend,
  type LoginItemDeps,
} from '../src/main/login-item.ts';
import { tempDir } from './helpers.ts';

/* "Apri all'accesso" (D-095). Never the real ~/.config: every test has its own XDG_CONFIG_HOME. */

/** Reads an `Exec=` argument back as the Desktop Entry Specification says. */
function unquoteExecArg(value: string): string {
  // The string escape first (`\\` is one backslash), then the quoting rule.
  let unescaped = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && value[i + 1] === '\\') {
      unescaped += '\\';
      i++;
    } else unescaped += value[i];
  }
  expect(unescaped.startsWith('"') && unescaped.endsWith('"')).toBe(true);
  return unescaped
    .slice(1, -1)
    .replace(/\\(["`$\\])/g, '$1')
    .replace(/%%/g, '%');
}

describe('Exec= of the autostart file', () => {
  it('always in quotes, and read back as the same path', () => {
    for (const path of [
      '/opt/Monsters/monsters',
      '/home/andrea/Scaricati/Monsters-0.1.0-linux-x86_64.AppImage',
      '/home/andrea/App Mie/Monsters.AppImage',
      '/home/g/"strano"/$HOME/`id`/a\\b/100%/Monsters.AppImage',
      "/home/g/l'app;rm -rf ~ &/Monsters.AppImage",
    ]) {
      const quoted = quoteExecArg(path)!;
      expect(quoted.startsWith('"')).toBe(true);
      expect(unquoteExecArg(quoted)).toBe(path);
    }
    expect(quoteExecArg('/a b')).toBe('"/a b"');
    expect(quoteExecArg('/a\\b')).toBe('"/a\\\\\\\\b"');
    expect(quoteExecArg('/a"b$c`d')).toBe('"/a\\\\"b\\\\$c\\\\`d"');
    expect(quoteExecArg('/100%')).toBe('"/100%%"');
  });

  it('refuses a control character: a newline would start another key', () => {
    expect(quoteExecArg('/tmp/x\nExec=/bin/evil')).toBeNull();
    expect(quoteExecArg('/tmp/x\ty')).toBeNull();
    expect(quoteExecArg('')).toBeNull();
    expect(autostartEntry('/tmp/x\nHidden=true')).toBeNull();
  });

  it('the file starts the app hidden, and is marked as ours', () => {
    const entry = autostartEntry('/opt/Monsters/monsters')!;
    const lines = entry.split('\n');
    expect(lines[0]).toBe('[Desktop Entry]');
    expect(lines).toContain('Type=Application');
    expect(lines).toContain('Name=Monsters');
    expect(lines).toContain(`Exec="/opt/Monsters/monsters" ${HIDDEN_ARG}`);
    expect(lines).toContain('X-GNOME-Autostart-enabled=true');
    expect(lines).toContain('X-Monsters-Autostart=1');
    expect(lines.filter((l) => l.startsWith('Exec='))).toHaveLength(1);
  });
});

describe('where the file goes', () => {
  it('$XDG_CONFIG_HOME/autostart, ~/.config/autostart without it (or with a relative one)', () => {
    // `join`: the tests run on Windows too, where the separators are backslashes.
    expect(autostartDir({ XDG_CONFIG_HOME: '/tmp/cfg' }, '/home/g')).toBe(
      join('/tmp/cfg', 'autostart'),
    );
    expect(autostartDir({}, '/home/g')).toBe(join('/home/g/.config/autostart'));
    expect(autostartDir({ XDG_CONFIG_HOME: 'cfg' }, '/home/g')).toBe(
      join('/home/g/.config/autostart'),
    );
  });

  it('the AppImage file, not its mount; the installed executable of the .deb', () => {
    const appImage = linuxLauncher({
      env: { APPIMAGE: '/home/g/Monsters.AppImage' },
      execPath: '/tmp/.mount_MonstXYZ/monsters',
      isPackaged: true,
    });
    expect(appImage).toEqual({ ok: true, kind: 'appimage', exec: '/home/g/Monsters.AppImage' });
    expect(
      linuxLauncher({ env: {}, execPath: '/opt/Monsters/monsters', isPackaged: true }),
    ).toEqual({ ok: true, kind: 'installed', exec: '/opt/Monsters/monsters' });
  });

  it('neither: the development app, or a path that cannot be written', () => {
    const dev = linuxLauncher({ env: {}, execPath: '/repo/electron', isPackaged: false });
    expect(dev.ok).toBe(false);
    if (!dev.ok) expect(dev.reason).toMatch(/installed app/);
    expect(
      linuxLauncher({
        env: { APPIMAGE: '/home/g/a\nb.AppImage' },
        execPath: '/x',
        isPackaged: true,
      }).ok,
    ).toBe(false);
    expect(
      linuxLauncher({ env: { APPIMAGE: 'Monsters.AppImage' }, execPath: '/x', isPackaged: true })
        .ok,
    ).toBe(false);
  });
});

describe('the file on disk', () => {
  it('written, read back, removed (also when already gone)', () => {
    const dir = join(tempDir(), 'autostart');
    expect(readAutostart(dir)).toEqual({ exists: false, ours: false, enabled: false, exec: null });
    expect(writeAutostart(dir, '/home/g/App Mie/Monsters.AppImage')).toBe(true);
    const file = join(dir, AUTOSTART_FILE);
    // Windows has no Unix permissions (0o666 there).
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o644);
    expect(readAutostart(dir)).toEqual({
      exists: true,
      ours: true,
      enabled: true,
      exec: `"/home/g/App Mie/Monsters.AppImage" ${HIDDEN_ARG}`,
    });
    removeAutostart(dir);
    expect(existsSync(file)).toBe(false);
    expect(() => removeAutostart(dir)).not.toThrow();
  });

  it('an entry turned off by the desktop (Hidden, GNOME) is off', () => {
    const dir = join(tempDir(), 'autostart');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, AUTOSTART_FILE);
    writeFileSync(file, `${autostartEntry('/opt/Monsters/monsters')!}Hidden=true\n`);
    expect(readAutostart(dir).enabled).toBe(false);
    writeFileSync(
      file,
      autostartEntry('/opt/Monsters/monsters')!.replace(
        'X-GNOME-Autostart-enabled=true',
        'X-GNOME-Autostart-enabled=false',
      ),
    );
    expect(readAutostart(dir).enabled).toBe(false);
  });
});

function noBackend(): LoginItemBackend & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    get: () => {
      throw new Error('not on Linux');
    },
    set: (s) => {
      calls.push(s);
    },
  };
}

function linux(extra: Partial<LoginItemDeps> = {}) {
  const xdg = tempDir();
  const lines: string[] = [];
  const backend = noBackend();
  const item = new LoginItem({
    platform: 'linux',
    env: { XDG_CONFIG_HOME: xdg },
    execPath: '/opt/Monsters/monsters',
    isPackaged: true,
    homedir: '/nonexistent-home',
    backend,
    log: (l) => lines.push(l),
    ...extra,
  });
  return { item, dir: join(xdg, 'autostart'), lines, backend };
}

describe('Linux', () => {
  it('off by default; on writes the file, off removes it; the file is the truth', () => {
    const { item, dir, backend } = linux();
    expect(item.state()).toEqual({ supported: true, enabled: false });
    expect(item.set(true)).toEqual({ supported: true, enabled: true });
    expect(readFileSync(join(dir, AUTOSTART_FILE), 'utf8')).toContain(
      `Exec="/opt/Monsters/monsters" ${HIDDEN_ARG}`,
    );
    // Removed by hand (or by the desktop's settings): off.
    removeAutostart(dir);
    expect(item.state().enabled).toBe(false);
    item.set(true);
    expect(item.set(false)).toEqual({ supported: true, enabled: false });
    expect(existsSync(join(dir, AUTOSTART_FILE))).toBe(false);
    expect(backend.calls).toEqual([]);
  });

  it('the development app: not available, nothing written, the reason said', () => {
    const { item, dir } = linux({ isPackaged: false });
    const state = item.set(true);
    expect(state.supported).toBe(false);
    expect(state.enabled).toBe(false);
    expect(state.note).toMatch(/installed app/);
    expect(existsSync(dir)).toBe(false);
  });

  it('the AppImage moved: its file is written again at start, a foreign file is left alone', () => {
    const xdg = tempDir();
    const moved = new LoginItem({
      platform: 'linux',
      env: { XDG_CONFIG_HOME: xdg, APPIMAGE: '/home/g/Nuova/Monsters.AppImage' },
      execPath: '/tmp/.mount_x/monsters',
      isPackaged: true,
      homedir: '/nonexistent-home',
      backend: noBackend(),
      log: () => {},
    });
    const auto = join(xdg, 'autostart');
    writeAutostart(auto, '/home/g/Vecchia/Monsters.AppImage');
    moved.refresh();
    expect(readAutostart(auto).exec).toBe(`"/home/g/Nuova/Monsters.AppImage" ${HIDDEN_ARG}`);
    // Not ours (no marker): never rewritten.
    const foreign = '[Desktop Entry]\nType=Application\nExec=/usr/bin/altro\n';
    writeFileSync(join(auto, AUTOSTART_FILE), foreign);
    moved.refresh();
    expect(readFileSync(join(auto, AUTOSTART_FILE), 'utf8')).toBe(foreign);
  });
});

function system(platform: 'darwin' | 'win32', status?: string) {
  const calls: unknown[] = [];
  const asked: unknown[] = [];
  let on = false;
  const item = new LoginItem({
    platform,
    env: {},
    execPath: 'C:\\Program Files\\Monsters\\Monsters.exe',
    isPackaged: true,
    homedir: '/nonexistent-home',
    backend: {
      get: (options) => {
        asked.push(options);
        return { openAtLogin: on, ...(status ? { status } : {}) };
      },
      set: (s) => {
        calls.push(s);
        on = s.openAtLogin;
      },
    },
    log: () => {},
  });
  return { item, calls, asked };
}

describe('macOS and Windows', () => {
  it('Windows: the Run key with --hidden, read back with the same arguments', () => {
    const { item, calls, asked } = system('win32');
    expect(item.set(true)).toEqual({ supported: true, enabled: true });
    expect(calls).toEqual([{ openAtLogin: true, args: [HIDDEN_ARG] }]);
    expect(asked.every((a) => JSON.stringify(a) === JSON.stringify({ args: [HIDDEN_ARG] }))).toBe(
      true,
    );
    item.set(false);
    expect(calls.at(-1)).toEqual({ openAtLogin: false, args: [HIDDEN_ARG] });
  });

  it('macOS: the login item; waiting for approval is said', () => {
    const { item, calls } = system('darwin');
    expect(item.set(true)).toEqual({ supported: true, enabled: true });
    expect(calls).toEqual([{ openAtLogin: true }]);
    const pending = system('darwin', 'requires-approval');
    expect(pending.item.state().note).toMatch(/Login Items/);
  });

  it('not in the development app (it would register Electron)', () => {
    const calls: unknown[] = [];
    const item = new LoginItem({
      platform: 'win32',
      env: {},
      execPath: 'electron.exe',
      isPackaged: false,
      homedir: '/x',
      backend: { get: () => ({ openAtLogin: false }), set: (s) => calls.push(s) },
      log: () => {},
    });
    expect(item.set(true).supported).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('the request of a page, and who may send it', () => {
  it('only true or false', () => {
    expect(parseLoginItemRequest(true)).toBe(true);
    expect(parseLoginItemRequest(false)).toBe(false);
    for (const bad of ['true', 1, 0, null, undefined, {}, [true], 'on']) {
      expect(parseLoginItemRequest(bad)).toBeNull();
    }
    const { item, dir, lines } = linux();
    expect(item.fromPage('true')).toBeNull();
    expect(item.fromPage({ enabled: true })).toBeNull();
    expect(existsSync(dir)).toBe(false);
    expect(lines).toContain('login item refused (not true or false)');
    expect(item.fromPage(true)).toEqual({ supported: true, enabled: true });
  });

  it('the core page of the window only, never a status page or a subframe', () => {
    const origin = 'http://127.0.0.1:41234';
    const main = { url: `${origin}/impostazioni`, origin };
    const win = { mainFrame: main };
    expect(fromCorePage({ sender: win, senderFrame: main }, win, origin)).toBe(true);
    const sub = { url: `${origin}/anteprima`, origin };
    expect(fromCorePage({ sender: win, senderFrame: sub }, win, origin)).toBe(false);
    const data = { url: 'data:text/html;base64,AAAA' };
    expect(fromCorePage({ sender: { mainFrame: data }, senderFrame: data }, win, origin)).toBe(
      false,
    );
    // While a status page is shown there is no core origin.
    expect(fromCorePage({ sender: win, senderFrame: main }, win, null)).toBe(false);
  });
});

describe('opened at login', () => {
  it('--hidden or the macOS login item; a restart after an update shows the window', () => {
    expect(startsHidden(['/opt/Monsters/monsters', HIDDEN_ARG])).toBe(true);
    expect(startsHidden(['/opt/Monsters/monsters'])).toBe(false);
    expect(startsHidden(['/Applications/Monsters.app/Contents/MacOS/Monsters'], true)).toBe(true);
    expect(relaunchArgs([HIDDEN_ARG, '--no-sandbox'])).toEqual(['--no-sandbox']);
  });
});
