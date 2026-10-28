import { randomBytes } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  currentImageName,
  holderIsStale,
  systemHolderProbes,
  type HolderProbes,
  type LockHolder,
} from '@monsters/shared/node';
import { FILE_MODE } from './config.ts';
import { selfStartTime } from './kill/proc.ts';
import { coreStrings } from './core.strings.ts';

/*
 * One core per data directory: `MONSTERS_HOME/core.lock` holds the pid of the
 * core that owns it, its start time and the boot id of the computer (to tell a
 * reused pid apart, `@monsters/shared/node` lock-holder.ts). It is taken before
 * anything in the directory is touched and removed on close; a lock left by a
 * core that crashed, or by a computer that was switched off, is stale and taken
 * over. Taking over is serialized (`core.lock.takeover`), so that two cores that
 * find the same stale lock never both end up with it. Inside that section a lock is
 * removed only if it is there and was judged stale: a missing one just means that
 * another core has already removed it and is about to publish its own, which is not
 * ours to delete.
 */

export const LOCK_FILE = 'core.lock';

type LockInfo = LockHolder;

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

/** What `acquireHomeLock` asks the system; replaced in tests. */
export interface HomeLockOptions {
  /** The pid written in the lock (default: this process). */
  pid?: number;
  /** The start time written in the lock (default: of this process). */
  start?: number | null;
  probes?: HolderProbes;
  /** How long to wait for another core that is taking over a stale lock (default 2 s). */
  takeoverWaitMs?: number;
  /** The image name written in the lock (default: of this process). */
  image?: string | null;
  /**
   * Test hook inside the takeover section: `entered` before the lock is read, `judged` after it
   * was and before anything is removed. Lets a test play the other core in between.
   */
  onTakeover?: (step: 'entered' | 'judged') => void;
}

/** Homes locked by this process: a second core in the same process is refused too. */
const heldHere = new Set<string>();

/** The text of the lock file, or null if there is none. */
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function parseLock(text: string | null): LockInfo | null {
  if (text === null) return null;
  try {
    const info = JSON.parse(text) as Partial<LockInfo>;
    if (typeof info.pid !== 'number' || !Number.isInteger(info.pid) || info.pid <= 0) return null;
    return {
      pid: info.pid,
      start: typeof info.start === 'number' ? info.start : null,
      boot: typeof info.boot === 'string' && info.boot ? info.boot : null,
      acquiredAt: typeof info.acquiredAt === 'number' ? info.acquiredAt : 0,
      image: typeof info.image === 'string' && info.image ? info.image : null,
    };
  } catch {
    return null;
  }
}

const readLock = (path: string): LockInfo | null => parseLock(readText(path));

/**
 * Writes the lock with its content already in it (a temporary file linked into place), and only
 * if there is none: a core that finds the file never reads it half written. Without hard links
 * (some file systems) it falls back to an exclusive create. False: a lock is there.
 */
function publish(path: string, content: string): boolean {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, content, { flag: 'wx', mode: FILE_MODE });
    try {
      linkSync(tmp, path);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return false;
      if (!['EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EACCES'].includes(code ?? '')) {
        throw err;
      }
    }
  } finally {
    rmSync(tmp, { force: true });
  }
  try {
    writeFileSync(path, content, { flag: 'wx', mode: FILE_MODE });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** A takeover that has been going on for longer than this was abandoned (its core died). */
const TAKEOVER_ABANDONED_MS = 10_000;

/** Enters the takeover section (a directory: `mkdir` is atomic). False if another core stays in it. */
function enterTakeover(guard: string, waitMs: number): boolean {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(guard);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    try {
      if (Date.now() - statSync(guard).mtimeMs > TAKEOVER_ABANDONED_MS) {
        rmdirSync(guard);
        continue;
      }
    } catch {
      // Gone meanwhile: try again.
      continue;
    }
    if (Date.now() >= deadline) return false;
    sleepSync(25);
  }
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
export function acquireHomeLock(home: string, options: HomeLockOptions = {}): HomeLock {
  const path = join(home, LOCK_FILE);
  const probes = options.probes ?? systemHolderProbes();
  const pid = options.pid ?? process.pid;
  const mine: LockInfo = {
    pid,
    start: options.start === undefined ? selfStartTime() : options.start,
    boot: probes.bootId(),
    acquiredAt: Date.now(),
    image: options.image === undefined ? currentImageName() : options.image,
  };
  const content = `${JSON.stringify(mine)}\n`;
  const isLive = (info: LockInfo): boolean =>
    info.pid === pid ? heldHere.has(home) : !holderIsStale(info, probes);
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!publish(path, content)) {
      const other = readLock(path);
      if (other && isLive(other)) throw new HomeLockedError(home, other.pid, serverUrl(home));
      // Stale (crashed core, reused pid, other boot) or unreadable: take it over. Alone, and
      // judged again inside: another core may have done it just before.
      const guard = `${path}.takeover`;
      if (enterTakeover(guard, options.takeoverWaitMs ?? 2000)) {
        try {
          options.onTakeover?.('entered');
          const text = readText(path);
          const now = parseLock(text);
          options.onTakeover?.('judged');
          // No file: another core removed the stale one and is about to publish (or has): leave it
          // be, our own publish below fails if it did. A file that is unreadable counts as stale,
          // but only if it is still the very same text when it is removed.
          if (text !== null && (!now || !isLive(now)) && readText(path) === text) {
            rmSync(path, { force: true });
          }
        } finally {
          rmSync(guard, { recursive: true, force: true });
        }
      }
      continue;
    }
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
