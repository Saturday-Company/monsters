import {
  spawn as nodeSpawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { posix, win32 } from 'node:path';

/** `child_process.spawn`, injectable so the tests can fake `ssh`. */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface ProcessDeps {
  spawn?: SpawnFn;
  /** Test hook for `taskkill` on Windows. */
  spawnSync?: typeof spawnSync;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/**
 * Wrapper that runs `ssh` on Linux and macOS so it never outlives us. ssh -N
 * does not read stdin, so it would not notice that its parent died (SIGKILL,
 * crash) and would keep the tunnel open forever. The wrapper keeps our stdin
 * pipe on fd 3: when the pipe closes (we exited, or `close()` ended it) the
 * watcher kills ssh. The wrapper exits with the status of ssh. The process
 * group (spawned detached) lets `killTree` reach ssh, the watcher and `cat`.
 */
export const POSIX_WRAPPER = [
  'exec 3<&0',
  '"$@" </dev/null 3<&- &',
  'child=$!',
  '{ cat <&3 >/dev/null; kill -TERM "$child" 2>/dev/null; } &',
  'watcher=$!',
  'exec 3<&-',
  'trap \'kill -TERM "$child" 2>/dev/null\' TERM HUP INT',
  'wait "$child"',
  'status=$?',
  'kill -TERM "$watcher" 2>/dev/null',
  'exit "$status"',
].join('\n');

export const POSIX_SHELL = '/bin/sh';

/**
 * Starts a long-running ssh: through the wrapper on POSIX (own process group),
 * directly on Windows, where libuv puts children in a job object that is closed
 * (and its processes killed) when we exit.
 */
export function spawnGuarded(
  command: string,
  args: readonly string[],
  deps: ProcessDeps = {},
): ChildProcess {
  const spawn = deps.spawn ?? nodeSpawn;
  const platform = deps.platform ?? process.platform;
  const options: SpawnOptions = {
    stdio: ['pipe', 'ignore', 'pipe'],
    env: deps.env ?? process.env,
    windowsHide: true,
  };
  if (platform === 'win32') return spawn(command, args, options);
  return spawn(POSIX_SHELL, ['-c', POSIX_WRAPPER, 'monsters-ssh', command, ...args], {
    ...options,
    detached: true,
  });
}

/** Kills a guarded process and everything it started. Safe to call twice. */
export function killTree(
  child: ChildProcess,
  deps: ProcessDeps = {},
  signal: NodeJS.Signals = 'SIGTERM',
): void {
  const platform = deps.platform ?? process.platform;
  const pid = child.pid;
  // Closing stdin alone makes the POSIX wrapper stop ssh.
  child.stdin?.destroy();
  if (pid === undefined) return;
  if (platform === 'win32') {
    // /T: also children of ssh (ProxyCommand, ProxyJump), which the job object
    // lets break away.
    (deps.spawnSync ?? spawnSync)('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

/**
 * After a guarded ssh exited: kills what may be left in its process group
 * (the stdin watcher of the POSIX wrapper). Nothing to do on Windows.
 */
export function reapLeftovers(child: ChildProcess, deps: ProcessDeps = {}): void {
  if ((deps.platform ?? process.platform) === 'win32') return;
  killTree(child, deps, 'SIGKILL');
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** spawn error (ENOENT when the binary does not exist). */
  error?: NodeJS.ErrnoException;
  timedOut: boolean;
}

/** Runs a short command (ssh -G, ssh-keyscan, remote `cat`) with a timeout. */
export function runCapture(
  command: string,
  args: readonly string[],
  timeoutMs: number,
  deps: ProcessDeps & { signal?: AbortSignal | undefined } = {},
): Promise<RunResult> {
  const spawn = deps.spawn ?? nodeSpawn;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const done = (r: Omit<RunResult, 'stdout' | 'stderr' | 'timedOut'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...r, stdout, stderr, timedOut });
    };
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: deps.env ?? process.env,
        windowsHide: true,
      });
    } catch (err) {
      resolve({ code: null, stdout, stderr, timedOut, error: err as NodeJS.ErrnoException });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const onAbort = () => child.kill('SIGKILL');
    if (deps.signal?.aborted) onAbort();
    deps.signal?.addEventListener('abort', onAbort, { once: true });
    child.once('close', () => deps.signal?.removeEventListener('abort', onAbort));
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (error: NodeJS.ErrnoException) => done({ code: null, error }));
    child.on('close', (code) => done({ code }));
  });
}

export interface LocateDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Test hook: whether a file exists and is executable. */
  isExecutable?: (path: string) => boolean;
}

function defaultIsExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds a binary of the system OpenSSH (`ssh`, `ssh-keyscan`). On Windows the
 * built-in client in System32\OpenSSH comes first (Windows 10 1809+), then
 * PATH (e.g. Git for Windows). On Linux and macOS PATH, then /usr/bin: an app
 * started from the Finder has a minimal PATH.
 */
export function locateOpenSsh(name: 'ssh' | 'ssh-keyscan', deps: LocateDeps = {}): string | null {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  if (platform === 'win32') {
    const exe = `${name}.exe`;
    const systemRoot = env['SystemRoot'] ?? env['SYSTEMROOT'] ?? 'C:\\Windows';
    const candidates = [win32.join(systemRoot, 'System32', 'OpenSSH', exe)];
    const path = env['Path'] ?? env['PATH'] ?? '';
    for (const dir of path.split(';')) if (dir) candidates.push(win32.join(dir, exe));
    return candidates.find(isExecutable) ?? null;
  }
  const candidates: string[] = [];
  for (const dir of (env['PATH'] ?? '').split(':')) if (dir) candidates.push(posix.join(dir, name));
  candidates.push(posix.join('/usr/bin', name));
  return candidates.find(isExecutable) ?? null;
}
