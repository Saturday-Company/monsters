import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILE_MODE } from './config.ts';
import { selfStartTime, startTimeOf, START_TOLERANCE } from './kill/proc.ts';
import { coreStrings } from './core.strings.ts';

/*
 * One core per data directory: `MONSTERS_HOME/core.lock` holds the pid of the
 * core that owns it (and its start time, to tell a reused pid apart). It is
 * taken before anything in the directory is touched and removed on close; a
 * lock left by a core that crashed is stale and taken over.
 */

export const LOCK_FILE = 'core.lock';

interface LockInfo {
  pid: number;
  /** Start time of the process, in the unit of `kill/proc.ts`. */
  start: number | null;
  acquiredAt: number;
}

/** Another live core owns the data directory. */
export class HomeLockedError extends Error {
  readonly code = 'home_locked';
  readonly pid: number;
  constructor(home: string, pid: number, url?: string) {
    super(coreStrings().homeLocked(home, url, pid));
    this.name = 'HomeLockedError';
    this.pid = pid;
  }
}

export interface HomeLock {
  readonly path: string;
  /** Removes the lock if it is still ours. Idempotent. */
  release(): void;
}

/** Homes locked by this process: a second core in the same process is refused too. */
const heldHere = new Set<string>();

function readLock(path: string): LockInfo | null {
  try {
    const info = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockInfo>;
    if (typeof info.pid !== 'number' || !Number.isInteger(info.pid) || info.pid <= 0) return null;
    return {
      pid: info.pid,
      start: typeof info.start === 'number' ? info.start : null,
      acquiredAt: typeof info.acquiredAt === 'number' ? info.acquiredAt : 0,
    };
  } catch {
    return null;
  }
}

function isAlive(info: LockInfo, home: string): boolean {
  if (info.pid === process.pid) return heldHere.has(home);
  try {
    process.kill(info.pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') return false;
  }
  // Same pid, other process (pid reused after a crash): stale.
  if (info.start !== null) {
    const start = startTimeOf(info.pid);
    if (start !== null && START_TOLERANCE === 0 && start !== info.start) return false;
  }
  return true;
}

function serverUrl(home: string): string | undefined {
  try {
    const info = JSON.parse(readFileSync(join(home, 'server.json'), 'utf8')) as { url?: unknown };
    return typeof info.url === 'string' ? info.url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Takes the lock of a data directory (which must exist). Throws
 * `HomeLockedError` when a live core already owns it.
 */
export function acquireHomeLock(home: string): HomeLock {
  const path = join(home, LOCK_FILE);
  const mine: LockInfo = { pid: process.pid, start: selfStartTime(), acquiredAt: Date.now() };
  const content = `${JSON.stringify(mine)}\n`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(path, content, { flag: 'wx', mode: FILE_MODE });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const other = readLock(path);
      if (other && isAlive(other, home))
        throw new HomeLockedError(home, other.pid, serverUrl(home));
      // Stale (crashed core) or unreadable: take it over.
      rmSync(path, { force: true });
      continue;
    }
    // Two cores taking over the same stale lock: only the last writer keeps it.
    const written = readLock(path);
    if (written?.pid !== mine.pid || written.acquiredAt !== mine.acquiredAt) continue;
    heldHere.add(home);
    let released = false;
    return {
      path,
      release() {
        if (released) return;
        released = true;
        heldHere.delete(home);
        const current = readLock(path);
        if (current?.pid === mine.pid && current.acquiredAt === mine.acquiredAt) {
          rmSync(path, { force: true });
        }
      },
    };
  }
  const other = readLock(path);
  throw new HomeLockedError(home, other?.pid ?? 0, serverUrl(home));
}
