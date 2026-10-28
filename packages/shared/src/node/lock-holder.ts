import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

/*
 * Is the process named in a `core.lock` still the core that took it? A lock outlives a core that
 * crashed or a computer that was switched off, and a pid is reused: `kill(pid, 0)` alone then
 * says "alive" for some unrelated process and the data folder looks taken forever. Used by the
 * core (which takes the lock over) and by the desktop app (which decides between attaching and
 * starting), so both give the same answer.
 *
 * What identifies the holder, by system:
 * - Linux: the boot id (`/proc/sys/kernel/random/boot_id`) and the start time of the process in
 *   clock ticks since boot (`/proc/<pid>/stat`): exact.
 * - macOS: the boot session uuid (`kern.bootsessionuuid`) and the start time from `ps`.
 * - Windows: the creation time and the image name of the process from `Win32_Process` (CIM; it
 *   works without elevation, `Get-Process ... .StartTime` throws "Access denied" for SYSTEM and
 *   protected processes). The lock records the image name of the core (`Monsters.exe`, `node.exe`):
 *   a pid now used by another program cannot be the core. There is no boot id, and a boot time
 *   computed from the uptime is not trusted to judge a live process (Fast Startup does not restart
 *   the uptime at "Shut down"; a clock corrected after the core took the lock moves it): it is
 *   only asked, with a wide margin, when the start time cannot be had.
 *
 * When nothing can be learned the holder counts as alive: the damage of a wrong "stale" is two
 * cores on one folder, the damage of a wrong "alive" is a message that says to close the other one.
 */

/** What `core.lock` says about the process that took it. */
export interface LockHolder {
  pid: number;
  /** Start time of the holder, in the unit of `selfStartTime` (core/src/kill/proc.ts); null if unknown. */
  start: number | null;
  /** Boot id of the computer when the lock was taken (older locks: null). */
  boot: string | null;
  /** `Date.now()` when the lock was taken (older locks: 0). */
  acquiredAt: number;
  /** Lower-case file name of the holder's executable (`currentImageName`; older locks: null). */
  image: string | null;
}

/** When a process started: `ticks` since boot (Linux, exact) or epoch milliseconds. */
export interface StartTime {
  value: number;
  unit: 'ticks' | 'ms';
  /** File name of the process's executable, when the probe learns it (Windows). */
  image?: string;
}

/** What the check asks the system; replaced by fakes in tests. */
export interface HolderProbes {
  /** True if a process with this pid exists (even if another user's). */
  exists(pid: number): boolean;
  /** Identifier of the current boot of the computer, or null if the system has none. */
  bootId(): string | null;
  /** When process `pid` started, or null if it cannot be had cheaply (or it is gone). */
  startOf(pid: number): StartTime | null;
  /** When the computer booted (epoch ms), for systems without a boot id; null if unknown. */
  bootedAt?(): number | null;
}

type MaybePromise<T> = T | Promise<T>;

/** The same probes for callers that must not block (the desktop app's main thread). */
export interface AsyncHolderProbes {
  exists(pid: number): boolean;
  bootId(): MaybePromise<string | null>;
  startOf(pid: number): MaybePromise<StartTime | null>;
  bootedAt?(): MaybePromise<number | null>;
}

/**
 * A process that started after the lock was taken cannot be the one that took it. A margin for the
 * clocks involved (the system's, `ps` that counts whole seconds).
 */
export const LATER_START_MS = 5000;

/**
 * A lock taken this long before the computer booted is stale (Windows, when the start time is
 * unknown). Wide: a clock corrected after the core took the lock moves the boot time.
 */
export const BOOT_MARGIN_MS = 10 * 60_000;

function bootChanged(holder: LockHolder, boot: string | null): boolean {
  return holder.boot !== null && boot !== null && holder.boot !== boot;
}

/** True if the start time says the process is not the one that took the lock. */
function startMoved(holder: LockHolder, start: StartTime): boolean {
  if (start.image !== undefined && holder.image !== null) {
    if (start.image.toLowerCase() !== holder.image.toLowerCase()) return true;
  }
  if (start.unit === 'ticks') return holder.start !== null && start.value !== holder.start;
  return holder.acquiredAt > 0 && start.value > holder.acquiredAt + LATER_START_MS;
}

function bootedAfterLock(holder: LockHolder, bootedAt: number | null): boolean {
  return (
    bootedAt !== null && holder.acquiredAt > 0 && holder.acquiredAt < bootedAt - BOOT_MARGIN_MS
  );
}

/** True if the lock was left by a process that is gone (also: its pid now belongs to another one). */
export function holderIsStale(holder: LockHolder, probes: HolderProbes): boolean {
  if (!probes.exists(holder.pid)) return true;
  if (bootChanged(holder, probes.bootId())) return true;
  const start = probes.startOf(holder.pid);
  if (start !== null) return startMoved(holder, start);
  return bootedAfterLock(holder, probes.bootedAt?.() ?? null);
}

/** `holderIsStale` for probes that answer later (a process is started for each). */
export async function holderIsStaleAsync(
  holder: LockHolder,
  probes: AsyncHolderProbes,
): Promise<boolean> {
  if (!probes.exists(holder.pid)) return true;
  if (bootChanged(holder, await probes.bootId())) return true;
  const start = await probes.startOf(holder.pid);
  if (start !== null) return startMoved(holder, start);
  return bootedAfterLock(holder, (await probes.bootedAt?.()) ?? null);
}

/** Start time (field 22, clock ticks since boot) from the text of `/proc/<pid>/stat`. */
export function parseProcStatStart(stat: string): number | null {
  // The command name may contain spaces and parentheses: count the fields after the last ")".
  const close = stat.lastIndexOf(')');
  if (close < 0) return null;
  const start = Number(stat.slice(close + 2).split(' ')[19]);
  return Number.isFinite(start) ? start : null;
}

/** The start time in the output of `ps -o lstart=` (C locale, local time), as epoch ms. */
export function parsePsStart(output: string): number | null {
  const ms = Date.parse(output.trim());
  return Number.isNaN(ms) ? null : ms;
}

/**
 * `Win32_Process` output of `WINDOWS_PROCESS_SCRIPT`: "<creation time, epoch ms> <image name>".
 * PowerShell prints the epoch itself, so there is no date format to parse.
 */
export function parseWindowsProcess(output: string): { start: number; image: string } | null {
  const m = /^\s*(\d{10,16})\s+(\S.*?)\s*$/m.exec(output);
  if (!m) return null;
  const start = Number(m[1]);
  return Number.isSafeInteger(start) && start > 0 ? { start, image: m[2]! } : null;
}

/** An epoch in milliseconds printed by PowerShell (`WINDOWS_BOOT_SCRIPT`). */
export function parseEpochMs(output: string): number | null {
  const m = /^\s*(\d{10,16})\s*$/m.exec(output);
  const value = m ? Number(m[1]) : Number.NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

const POWERSHELL = ['-NoProfile', '-NonInteractive', '-Command'];

/** The script is built from an integer only: no quoting problems. */
export function windowsProcessScript(pid: number): string {
  return (
    `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${Math.trunc(pid)}'; ` +
    `if ($p) { '{0} {1}' -f ([DateTimeOffset]($p.CreationDate)).ToUnixTimeMilliseconds(), $p.Name }`
  );
}

export const WINDOWS_BOOT_SCRIPT =
  '([DateTimeOffset](Get-CimInstance Win32_OperatingSystem).LastBootUpTime).ToUnixTimeMilliseconds()';

/** File name of the running executable, lower case: what the lock records as `image`. */
export function currentImageName(): string | null {
  return basename(process.execPath).toLowerCase() || null;
}

/** What the answers of the slow probes (a process is started for each) are kept for. */
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; value: unknown }>();

function cached<T>(key: string, compute: () => T): T {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = compute();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Waits at most this long for a probe that blocks the caller (the core, once, at its start). */
const SYNC_TIMEOUT_MS = 3000;
const ASYNC_TIMEOUT_MS = 4000;

const probeEnv = () => ({ ...process.env, LC_ALL: 'C', LANG: 'C' });

function run(file: string, args: string[]): string | null {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      env: probeEnv(),
      timeout: SYNC_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function runAsync(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const child = execFile(
        file,
        args,
        { encoding: 'utf8', env: probeEnv(), timeout: ASYNC_TIMEOUT_MS, windowsHide: true },
        (err, stdout) => resolve(err ? null : stdout),
      );
      // PowerShell may wait for its input to end.
      child.stdin?.end();
    } catch {
      resolve(null);
    }
  });
}

const hasProc = (() => {
  if (process.platform !== 'linux') return false;
  try {
    readFileSync('/proc/self/stat', 'utf8');
    return true;
  } catch {
    return false;
  }
})();

const validPid = (pid: number): boolean => Number.isInteger(pid) && pid > 0;

/** Boot id of this computer: Linux and macOS have one, Windows does not (see above). */
export function currentBootId(): string | null {
  if (hasProc) {
    try {
      return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() || null;
    } catch {
      return null;
    }
  }
  if (process.platform === 'darwin') {
    return cached('boot', () => run('sysctl', ['-n', 'kern.bootsessionuuid'])?.trim() || null);
  }
  return null;
}

async function currentBootIdAsync(): Promise<string | null> {
  if (process.platform !== 'darwin') return currentBootId();
  return cached('boot-async', async () => {
    return (await runAsync('sysctl', ['-n', 'kern.bootsessionuuid']))?.trim() || null;
  });
}

function toStartTime(win: { start: number; image: string } | null): StartTime | null {
  return win === null ? null : { value: win.start, unit: 'ms', image: win.image };
}

function startOf(pid: number): StartTime | null {
  if (!validPid(pid)) return null;
  if (hasProc) {
    try {
      const value = parseProcStatStart(readFileSync(`/proc/${pid}/stat`, 'utf8'));
      return value === null ? null : { value, unit: 'ticks' };
    } catch {
      return null;
    }
  }
  if (process.platform === 'win32') {
    return cached(`start:${pid}`, () => {
      const out = run('powershell.exe', [...POWERSHELL, windowsProcessScript(pid)]);
      return out === null ? null : toStartTime(parseWindowsProcess(out));
    });
  }
  return cached(`start:${pid}`, () => {
    const out = run('ps', ['-o', 'lstart=', '-p', String(pid)]);
    const value = out === null ? null : parsePsStart(out);
    return value === null ? null : { value, unit: 'ms' as const };
  });
}

async function startOfAsync(pid: number): Promise<StartTime | null> {
  if (!validPid(pid)) return null;
  if (hasProc) {
    try {
      const value = parseProcStatStart(await readFile(`/proc/${pid}/stat`, 'utf8'));
      return value === null ? null : { value, unit: 'ticks' };
    } catch {
      return null;
    }
  }
  if (process.platform === 'win32') {
    return cached(`start-async:${pid}`, async () => {
      const out = await runAsync('powershell.exe', [...POWERSHELL, windowsProcessScript(pid)]);
      return out === null ? null : toStartTime(parseWindowsProcess(out));
    });
  }
  return cached(`start-async:${pid}`, async () => {
    const out = await runAsync('ps', ['-o', 'lstart=', '-p', String(pid)]);
    const value = out === null ? null : parsePsStart(out);
    return value === null ? null : { value, unit: 'ms' as const };
  });
}

function bootedAt(): number | null {
  if (process.platform !== 'win32') return null;
  return cached('booted', () => {
    const out = run('powershell.exe', [...POWERSHELL, WINDOWS_BOOT_SCRIPT]);
    return out === null ? null : parseEpochMs(out);
  });
}

function bootedAtAsync(): Promise<number | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return cached('booted-async', async () => {
    const out = await runAsync('powershell.exe', [...POWERSHELL, WINDOWS_BOOT_SCRIPT]);
    return out === null ? null : parseEpochMs(out);
  });
}

function exists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The real probes, blocking: `kill(pid, 0)`, `/proc`, `ps`, PowerShell. For the core at its start. */
export function systemHolderProbes(): HolderProbes {
  return { exists, bootId: currentBootId, startOf, bootedAt };
}

/** The real probes, not blocking (child processes are awaited): for the desktop app's main process. */
export function systemHolderProbesAsync(): AsyncHolderProbes {
  return {
    exists,
    bootId: currentBootIdAsync,
    startOf: startOfAsync,
    bootedAt: bootedAtAsync,
  };
}
