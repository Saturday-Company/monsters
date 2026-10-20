import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Minimal, dependency-free process inspection used by the kill switch to tell
 * whether a process group still exists and is still the one we spawned.
 *
 * Start times are compared to detect PID/PGID reuse. Their unit depends on the
 * platform: clock ticks since boot on Linux (exact, from `/proc`), epoch
 * milliseconds elsewhere (from `ps`, one-second resolution).
 */

export interface ProcInfo {
  pid: number;
  pgid: number;
  start: number;
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

/** Tolerance when comparing start times (exact on Linux, `ps` has 1 s resolution). */
export const START_TOLERANCE = hasProc ? 0 : 2000;

/** Parses `/proc/<pid>/stat`: the command name may contain spaces and parentheses. */
export function parseProcStat(pid: number, stat: string): ProcInfo | null {
  const close = stat.lastIndexOf(')');
  if (close < 0) return null;
  // Fields after the name, starting at field 3 (state).
  const rest = stat.slice(close + 2).split(' ');
  const pgid = Number(rest[2]);
  const start = Number(rest[19]);
  if (!Number.isInteger(pgid) || !Number.isFinite(start)) return null;
  return { pid, pgid, start };
}

function readProcStat(pid: number | 'self'): ProcInfo | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const realPid = pid === 'self' ? Number(stat.slice(0, stat.indexOf(' '))) : pid;
    return parseProcStat(realPid, stat);
  } catch {
    return null;
  }
}

/** Parses the output of `ps -A -o pid= -o pgid= -o lstart=`. */
export function parsePsOutput(output: string): ProcInfo[] {
  const out: ProcInfo[] = [];
  for (const line of output.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const start = Date.parse(m[3] ?? '');
    if (Number.isNaN(start)) continue;
    out.push({ pid: Number(m[1]), pgid: Number(m[2]), start });
  }
  return out;
}

/**
 * Snapshot of the processes visible to us, or null when the platform offers no
 * way to inspect them (Windows).
 */
export function listProcesses(): ProcInfo[] | null {
  if (hasProc) {
    const out: ProcInfo[] = [];
    let entries: string[];
    try {
      entries = readdirSync('/proc');
    } catch {
      return null;
    }
    for (const name of entries) {
      if (!/^\d+$/.test(name)) continue;
      const info = readProcStat(Number(name));
      if (info) out.push(info);
    }
    return out;
  }
  if (process.platform === 'win32') return null;
  try {
    const output = execFileSync('ps', ['-A', '-o', 'pid=', '-o', 'pgid=', '-o', 'lstart='], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parsePsOutput(output);
  } catch {
    return null;
  }
}

/**
 * Start time of a process we just spawned, in the unit of `listProcesses`.
 * Without `/proc` the spawn time is used (compared with `START_TOLERANCE`).
 */
export function startTimeOf(pid: number): number | null {
  if (hasProc) return readProcStat(pid)?.start ?? null;
  return Date.now();
}

/** Start time of the current process, in the unit of `listProcesses`. */
export function selfStartTime(): number | null {
  if (hasProc) return readProcStat('self')?.start ?? null;
  return Math.round(Date.now() - process.uptime() * 1000);
}

/** Linux boot id: records from a previous boot refer to processes that are gone. */
export function bootId(): string | null {
  if (!hasProc) return null;
  try {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch {
    return null;
  }
}

/** True if a signal can be delivered to the process group (it has at least one member). */
export function groupExists(pgid: number): boolean {
  if (process.platform === 'win32') return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    // ESRCH: no such group. EPERM: it exists but belongs to someone else, so not ours.
    return false;
  }
}

/**
 * Live members of a process group that we spawned, verified against the leader
 * start time: if the PGID was reused by another group, returns an empty list.
 * Returns null when the platform cannot be inspected.
 */
export function verifiedGroupMembers(
  pgid: number,
  leaderStart: number,
  processes: ProcInfo[] | null = listProcesses(),
): ProcInfo[] | null {
  if (!processes) return null;
  const members = processes.filter((p) => p.pgid === pgid);
  const leader = members.find((p) => p.pid === pgid);
  // A live leader with another start time means the PGID now names another group.
  if (leader && Math.abs(leader.start - leaderStart) > START_TOLERANCE) return [];
  // Every member of our group was created after its leader.
  if (members.some((p) => p.start < leaderStart - START_TOLERANCE)) return [];
  return members;
}

/** True if `pid` is alive and started at `start` (same process, not a reused PID). */
export function isSameProcess(
  pid: number,
  start: number | null,
  processes: ProcInfo[] | null,
): boolean {
  if (processes && start !== null) {
    const p = processes.find((x) => x.pid === pid);
    return p !== undefined && Math.abs(p.start - start) <= START_TOLERANCE;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
