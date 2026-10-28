import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
 * - Windows: the start time from PowerShell. There is no boot id, and a boot time computed from
 *   the uptime is not trusted: with Fast Startup the uptime does not restart at "Shut down", so it
 *   could not tell a boot anyway, and one that miscounts sleep would call a live core stale, which
 *   is worse than not noticing a stale one.
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
}

/** When a process started: `ticks` since boot (Linux, exact) or epoch milliseconds. */
export interface StartTime {
  value: number;
  unit: 'ticks' | 'ms';
}

/** What the check asks the system; replaced by fakes in tests. */
export interface HolderProbes {
  /** True if a process with this pid exists (even if another user's). */
  exists(pid: number): boolean;
  /** Identifier of the current boot of the computer, or null if the system has none. */
  bootId(): string | null;
  /** When process `pid` started, or null if it cannot be had cheaply (or it is gone). */
  startOf(pid: number): StartTime | null;
}

/**
 * A process that started after the lock was taken cannot be the one that took it. A margin for the
 * clocks involved (the system's, `ps` that counts whole seconds).
 */
export const LATER_START_MS = 5000;

/** True if the lock was left by a process that is gone (also: its pid now belongs to another one). */
export function holderIsStale(holder: LockHolder, probes: HolderProbes): boolean {
  if (!probes.exists(holder.pid)) return true;
  const boot = probes.bootId();
  if (holder.boot !== null && boot !== null && holder.boot !== boot) return true;
  const start = probes.startOf(holder.pid);
  if (start === null) return false;
  if (start.unit === 'ticks') return holder.start !== null && start.value !== holder.start;
  return holder.acquiredAt > 0 && start.value > holder.acquiredAt + LATER_START_MS;
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

function run(file: string, args: string[]): string | null {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
      timeout: 4000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
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

function startOf(pid: number): StartTime | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
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
      const out = run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `([DateTimeOffset](Get-Process -Id ${pid} -ErrorAction Stop).StartTime).ToUnixTimeMilliseconds()`,
      ]);
      const value = out === null ? Number.NaN : Number(out.trim());
      return Number.isFinite(value) && value > 0 ? { value, unit: 'ms' as const } : null;
    });
  }
  return cached(`start:${pid}`, () => {
    const out = run('ps', ['-o', 'lstart=', '-p', String(pid)]);
    const value = out === null ? null : parsePsStart(out);
    return value === null ? null : { value, unit: 'ms' as const };
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

/** The real probes: `kill(pid, 0)`, `/proc`, `ps`, PowerShell. */
export function systemHolderProbes(): HolderProbes {
  return { exists, bootId: currentBootId, startOf };
}
