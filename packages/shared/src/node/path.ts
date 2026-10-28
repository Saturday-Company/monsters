import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { delimiter, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/*
 * The PATH of the process. A desktop app started from the Dock, Finder or a
 * Linux launcher does not get the PATH of the user's shell (on macOS it is
 * /usr/bin:/bin:/usr/sbin:/sbin), so npm, node, `claude`, MCP servers and the
 * user's tools are not found. As VS Code does, the PATH is asked once to the
 * user's login shell and merged with the current one.
 */

/** An executable named `name` on the PATH, or null. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const path = env['PATH'] ?? env['Path'] ?? '';
  const exts =
    process.platform === 'win32'
      ? (env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())
      : [''];
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      try {
        if (!statSync(candidate).isFile()) continue;
        if (process.platform !== 'win32') accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // not here
      }
    }
  }
  return null;
}

/** PATH that launchd gives to apps started from the Dock or Finder. */
export const MACOS_GUI_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

export interface LoginShellProcess {
  platform: NodeJS.Platform;
  versions: Record<string, string | undefined>;
  /** stdin or stdout is a terminal. */
  tty: boolean;
}

const currentProcess = (): LoginShellProcess => ({
  platform: process.platform,
  versions: process.versions,
  tty: process.stdin.isTTY === true || process.stdout.isTTY === true,
});

/**
 * Whether the PATH should come from the login shell: macOS and Linux only, when
 * the process looks started by the desktop rather than by a terminal (no
 * terminal, no `TERM`, and either inside Electron or with the bare macOS PATH).
 * `MONSTERS_LOGIN_SHELL_PATH=1` forces it, `=0` turns it off.
 */
export function wantsLoginShellPath(
  env: NodeJS.ProcessEnv = process.env,
  proc: LoginShellProcess = currentProcess(),
): boolean {
  if (proc.platform !== 'darwin' && proc.platform !== 'linux') return false;
  const flag = env['MONSTERS_LOGIN_SHELL_PATH'];
  if (flag === '1') return true;
  if (flag === '0') return false;
  if (proc.tty || env['TERM']) return false;
  return (
    proc.versions['electron'] !== undefined ||
    (proc.platform === 'darwin' && (env['PATH'] ?? '') === MACOS_GUI_PATH)
  );
}

/** Entries of `first`, then those of `second` not already there; no empty entries. */
export function mergePathLists(first: string, second: string, sep: string = delimiter): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [...first.split(sep), ...second.split(sep)]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out.join(sep);
}

const MARK = '__MONSTERS_LOGIN_PATH__';

/**
 * Runs `shell -i -l -c <command>` and returns its stdout, or null (error, timeout). With
 * `until`, returns as soon as stdout holds that text twice (the closing marker).
 */
export type RunShell = (
  shell: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number; until?: string },
) => Promise<string | null>;

const runShell: RunShell = (shell, args, { env, timeoutMs, until }) =>
  new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Our end of the pipe goes: a process started in the background by an rc file keeps
      // the other end open, so waiting for EOF ('close') would last until the timeout.
      child.stdout.destroy();
      child.unref();
      resolve(value);
    };
    // Own process group: on timeout the shell and whatever its rc files started go together.
    const child = spawn(shell, args, { env, stdio: ['ignore', 'pipe', 'ignore'], detached: true });
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      finish(null);
    }, timeoutMs);
    const decoder = new StringDecoder('utf8');
    child.stdout.on('data', (d: Buffer) => {
      out += decoder.write(d);
      if (until !== undefined && out.split(until).length >= 3) {
        finish(out);
        // What the rc files left in this throwaway shell's group goes with it (a daemon
        // that detached into its own session is not touched).
        try {
          if (child.pid) process.kill(-child.pid, 'SIGTERM');
        } catch {
          // already gone
        }
      }
    });
    child.once('error', () => finish(null));
    child.once('close', (code) => finish(code === 0 ? out : null));
  });

export interface LoginShellPathOptions {
  env?: NodeJS.ProcessEnv;
  proc?: LoginShellProcess;
  /** Default 3 s: a slow rc file must not hold the start of the app. */
  timeoutMs?: number;
  run?: RunShell;
  /** Shell to ask when `SHELL` is not set. Default: the user's login shell. */
  fallbackShell?: () => string | null;
}

/** The PATH printed by the user's login shell, or null. */
export async function readLoginShellPath(
  options: LoginShellPathOptions = {},
): Promise<string | null> {
  const env = options.env ?? process.env;
  const shell =
    env['SHELL'] ||
    (
      options.fallbackShell ??
      (() => {
        try {
          return userInfo().shell;
        } catch {
          return null;
        }
      })
    )();
  if (!shell) return null;
  // printenv works the same in sh, bash, zsh and fish (which keeps PATH as a list).
  const out = await (options.run ?? runShell)(
    shell,
    ['-i', '-l', '-c', `echo ${MARK}; printenv PATH; echo ${MARK}`],
    { env, timeoutMs: options.timeoutMs ?? 3000, until: MARK },
  );
  if (out === null) return null;
  const parts = out.split(MARK);
  if (parts.length < 3) return null;
  const path = (parts[1] ?? '').trim();
  return path && !path.includes('\n') ? path : null;
}

/**
 * The PATH to use: the login shell's followed by the current entries it lacks,
 * or null when the shell is not asked (see `wantsLoginShellPath`), fails or
 * adds nothing. Never throws.
 */
export async function loginShellPath(options: LoginShellPathOptions = {}): Promise<string | null> {
  const env = options.env ?? process.env;
  if (!wantsLoginShellPath(env, options.proc)) return null;
  const login = await readLoginShellPath(options).catch(() => null);
  if (!login) return null;
  const current = env['PATH'] ?? '';
  // POSIX only (never on Windows, wantsLoginShellPath), whatever system runs this code.
  const merged = mergePathLists(login, current, ':');
  return merged === current ? null : merged;
}

let applied: Promise<boolean> | undefined;

/**
 * Once per process: sets `process.env.PATH` from `loginShellPath()`. Resolves
 * to true when the PATH changed. Call it before starting anything that looks
 * for programs on the PATH.
 */
export function applyLoginShellPath(): Promise<boolean> {
  applied ??= loginShellPath().then((path) => {
    if (path === null) return false;
    process.env['PATH'] = path;
    return true;
  });
  return applied;
}
