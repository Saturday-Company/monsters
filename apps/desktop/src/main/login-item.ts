import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { loginItemStrings } from './login-item.strings.ts';

/*
 * "Open at login" (D-095): the app opens when the user logs in, hidden (only the tray icon,
 * no window), and starts the core of its last choice, so the monsters (and the automations)
 * work without anyone opening the app. Off by default; the first start does not change it.
 * The system is the only place the choice lives, read back every time:
 * - macOS: a login item of the app (`app.setLoginItemSettings`, SMAppService), and
 *   `wasOpenedAtLogin` says the app was opened by it;
 * - Windows: the Run key of the user with `--hidden`;
 * - Linux: an XDG autostart file, `$XDG_CONFIG_HOME/autostart/monsters.desktop`, that starts
 *   the AppImage (its `APPIMAGE` path: the running file is a mount that goes away) or the
 *   installed executable of the .deb, with `--hidden`.
 * Not in the development app (it would register Electron itself), nor from an AppImage whose
 * path cannot be written in a desktop file. Pure Node, no Electron (tested in
 * test/login-item.test.ts).
 */

/** Argument of a start at login: no window, only the tray icon. */
export const HIDDEN_ARG = '--hidden';

/** Name of the autostart file: the same as the .deb's desktop file (`syncDesktopName`). */
export const AUTOSTART_FILE = 'monsters.desktop';

/** Line that marks an autostart file written by Monsters. */
const MARKER = 'X-Monsters-Autostart=1';

/** Environment variable of the tests: the executable an autostart file starts (Linux). */
export const AUTOSTART_EXEC_ENV = 'MONSTERS_DESKTOP_AUTOSTART_EXEC';

export interface LoginItemState {
  /** False where the app cannot open at login (the reason is in `note`). */
  supported: boolean;
  enabled: boolean;
  /** What the user should know, in the app's language: why not, or what is still missing. */
  note?: string;
}

type Env = Readonly<Record<string, string | undefined>>;

/** A start at login: `--hidden` (Windows, Linux) or the login item of macOS. */
export function startsHidden(argv: readonly string[], openedAtLogin = false): boolean {
  return openedAtLogin || argv.includes(HIDDEN_ARG);
}

/** The arguments of a restart (after an update): without `--hidden`, the window comes back. */
export function relaunchArgs(argv: readonly string[]): string[] {
  return argv.filter((a) => a !== HIDDEN_ARG);
}

/** What a page sends: exactly true or false. */
export function parseLoginItemRequest(input: unknown): boolean | null {
  return typeof input === 'boolean' ? input : null;
}

// ---- Linux: the XDG autostart file -----------------------------------------------------

/** `$XDG_CONFIG_HOME/autostart` (an absolute XDG_CONFIG_HOME only, as the spec says). */
export function autostartDir(env: Env, homedir: string): string {
  const xdg = env['XDG_CONFIG_HOME'];
  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir, '.config'), 'autostart');
}

/**
 * One argument of `Exec=` (Desktop Entry Specification): always in double quotes, `"`, `` ` ``,
 * `$` and `\` escaped with a backslash, then the string escape of the value (a backslash
 * doubled) and `%` as `%%` (not a field code). Null for a control character: a newline would
 * end the line and start another key.
 */
export function quoteExecArg(arg: string): string | null {
  // eslint-disable-next-line no-control-regex
  if (arg === '' || /[\u0000-\u001f\u007f]/.test(arg)) return null;
  const quoted = arg.replace(/["`$\\]/g, (c) => `\\${c}`);
  return `"${quoted.replace(/\\/g, '\\\\').replace(/%/g, '%%')}"`;
}

/** The content of the autostart file that starts `exec` hidden; null if `exec` cannot be written. */
export function autostartEntry(exec: string): string | null {
  const quoted = quoteExecArg(exec);
  if (!quoted) return null;
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Monsters',
    'Comment=Apre Monsters all’accesso, nascosto: resta l’icona vicino all’orologio',
    `Exec=${quoted} ${HIDDEN_ARG}`,
    'Icon=monsters',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    MARKER,
    '',
  ].join('\n');
}

/** The executable an autostart file starts, or why there is none. */
export type LinuxLauncher =
  { ok: true; kind: 'appimage' | 'installed'; exec: string } | { ok: false; reason: string };

export function linuxLauncher(o: {
  env: Env;
  execPath: string;
  isPackaged: boolean;
}): LinuxLauncher {
  const forced = o.env[AUTOSTART_EXEC_ENV];
  const appImage = o.env['APPIMAGE'];
  const pick = (kind: 'appimage' | 'installed', exec: string): LinuxLauncher =>
    isAbsolute(exec) && quoteExecArg(exec)
      ? { ok: true, kind, exec }
      : {
          ok: false,
          reason: loginItemStrings().pathNotWritable,
        };
  if (forced) return pick('installed', forced);
  if (appImage) return pick('appimage', appImage);
  if (o.isPackaged) return pick('installed', o.execPath);
  return { ok: false, reason: loginItemStrings().onlyInstalledPackage };
}

export interface AutostartFile {
  exists: boolean;
  /** Written by Monsters (the marker line). */
  ours: boolean;
  /** On: neither `Hidden=true` nor `X-GNOME-Autostart-enabled=false`. */
  enabled: boolean;
  /** The `Exec=` line's value, as written. */
  exec: string | null;
}

export function readAutostart(dir: string): AutostartFile {
  let text: string;
  try {
    text = readFileSync(join(dir, AUTOSTART_FILE), 'utf8');
  } catch {
    return { exists: false, ours: false, enabled: false, exec: null };
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const value = (key: string) =>
    lines.find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1) ?? null;
  const off =
    value('Hidden')?.toLowerCase() === 'true' ||
    value('X-GNOME-Autostart-enabled')?.toLowerCase() === 'false';
  return { exists: true, ours: lines.includes(MARKER), enabled: !off, exec: value('Exec') };
}

/** Writes the autostart file (the folder created if missing); false if `exec` cannot be written. */
export function writeAutostart(dir: string, exec: string): boolean {
  const entry = autostartEntry(exec);
  if (!entry) return false;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, AUTOSTART_FILE), entry, { mode: 0o644 });
  return true;
}

export function removeAutostart(dir: string): void {
  rmSync(join(dir, AUTOSTART_FILE), { force: true });
}

// ---- The three systems ------------------------------------------------------------------

/** The parts of Electron's `app` used here (macOS and Windows). */
export interface LoginItemBackend {
  get(options: { args?: string[] }): { openAtLogin: boolean; status?: string };
  set(settings: { openAtLogin: boolean; args?: string[] }): void;
}

export interface LoginItemDeps {
  platform: NodeJS.Platform;
  env: Env;
  execPath: string;
  isPackaged: boolean;
  homedir: string;
  backend: LoginItemBackend;
  log(line: string): void;
}

export class LoginItem {
  readonly #d: LoginItemDeps;

  constructor(deps: LoginItemDeps) {
    this.#d = deps;
  }

  get #dir(): string {
    return autostartDir(this.#d.env, this.#d.homedir);
  }

  state(): LoginItemState {
    const d = this.#d;
    if (d.platform === 'linux') {
      const launcher = linuxLauncher(d);
      if (!launcher.ok) return { supported: false, enabled: false, note: launcher.reason };
      return { supported: true, enabled: readAutostart(this.#dir).enabled };
    }
    if (d.platform !== 'darwin' && d.platform !== 'win32') {
      return { supported: false, enabled: false, note: loginItemStrings().notAvailable };
    }
    if (!d.isPackaged)
      return { supported: false, enabled: false, note: loginItemStrings().onlyInstalled };
    try {
      const s = d.backend.get(d.platform === 'win32' ? { args: [HIDDEN_ARG] } : {});
      if (d.platform === 'darwin' && s.status === 'requires-approval') {
        return { supported: true, enabled: true, note: loginItemStrings().macApproval };
      }
      return { supported: true, enabled: s.openAtLogin };
    } catch (err) {
      d.log(`login item: cannot read it (${(err as Error).message})`);
      return { supported: true, enabled: false };
    }
  }

  /** A choice from a page or a menu; null if refused (not a boolean). */
  fromPage(input: unknown): LoginItemState | null {
    const enabled = parseLoginItemRequest(input);
    if (enabled === null) {
      this.#d.log('login item refused (not true or false)');
      return null;
    }
    return this.set(enabled);
  }

  set(enabled: boolean): LoginItemState {
    const d = this.#d;
    const before = this.state();
    if (!before.supported) {
      d.log(`login item: not available (${before.note ?? ''})`);
      return before;
    }
    try {
      if (d.platform === 'linux') {
        const launcher = linuxLauncher(d);
        if (launcher.ok && enabled) writeAutostart(this.#dir, launcher.exec);
        else removeAutostart(this.#dir);
      } else if (d.platform === 'win32') {
        d.backend.set({ openAtLogin: enabled, args: [HIDDEN_ARG] });
      } else {
        d.backend.set({ openAtLogin: enabled });
      }
      d.log(`login item: ${enabled ? 'on' : 'off'}`);
    } catch (err) {
      d.log(`login item: cannot change it (${(err as Error).message})`);
      return { ...this.state(), note: loginItemStrings().couldntChange };
    }
    return this.state();
  }

  /**
   * At start (Linux): an autostart file of Monsters that starts another path (the AppImage
   * moved or renamed) is written again for this one. Nothing when it is off or not ours.
   */
  refresh(): void {
    const d = this.#d;
    if (d.platform !== 'linux') return;
    const launcher = linuxLauncher(d);
    if (!launcher.ok) return;
    const file = readAutostart(this.#dir);
    if (!file.ours || !file.enabled) return;
    const expected = autostartEntry(launcher.exec)
      ?.split('\n')
      .find((l) => l.startsWith('Exec='))
      ?.slice('Exec='.length);
    if (!expected || file.exec === expected) return;
    try {
      writeAutostart(this.#dir, launcher.exec);
      d.log('login item: autostart file updated for the new path');
    } catch (err) {
      d.log(`login item: cannot update the autostart file (${(err as Error).message})`);
    }
  }
}
