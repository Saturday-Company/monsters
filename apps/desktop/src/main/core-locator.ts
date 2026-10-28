import {
  checkTunnelProof,
  holderIsStaleAsync,
  newTunnelProofNonce,
  systemHolderProbesAsync,
  type LockHolder,
} from '@monsters/shared/node';
import { homeFile, readTextFile } from './home.ts';

/*
 * Is a core already running for this data directory (started by the CLI, or by another copy
 * of the app)? Then the app attaches to it instead of starting a second one (the core would
 * refuse anyway: one core per directory, `core.lock`). The lock says who owns the
 * directory, `server.json` where it listens, `/api/health` that it answers. The answer must
 * carry the proof for the `proofKey` of `server.json` (the same HMAC as the SSH tunnel,
 * review of 18/10, B12): a process that took the port, or another user's, never gets the CLI
 * token and never fills the window.
 */

export interface LocatorDeps {
  readFile(path: string): string | null;
  /** True if a process with this pid exists (even if owned by another user). */
  isAlive(pid: number): boolean;
  /**
   * True if the lock was left by a core that is gone and its pid now belongs to another process
   * (or the computer restarted since): the same judgment the core makes before it takes the lock
   * over. Only asked of a lock whose core does not answer. Asynchronous: on Windows and macOS
   * it starts a child process, which must not block the main thread.
   */
  isStale(holder: LockHolder): boolean | Promise<boolean>;
  /** True if the Monsters core of this data directory answers at this URL (proof for `proofKey`). */
  health(url: string, proofKey: string | null): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export type LocateOnce =
  | { kind: 'attach'; url: string; pid: number }
  | { kind: 'start' }
  /** A live process holds the lock but the core does not answer (yet). */
  | { kind: 'wait'; reason: 'starting' | 'not_responding' };

export type Located =
  | { kind: 'attach'; url: string; pid: number }
  /** `afterWait`: a live lock never answered; starting lets the core judge the lock itself. */
  | { kind: 'start'; afterWait?: 'starting' | 'not_responding' }
  /** The search was cut short (the app is quitting or switching away). */
  | { kind: 'aborted' };

/** True for `http://<loopback>:<port>` with nothing else (the only URLs the app attaches to). */
export function isLocalCoreUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' || url.username || url.password || !url.port) return false;
  if (url.pathname !== '/' || url.search || url.hash) return false;
  return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}

function parseLock(text: string | null): LockHolder | null {
  if (!text) return null;
  try {
    const l = JSON.parse(text) as Partial<Record<keyof LockHolder, unknown>>;
    if (typeof l.pid !== 'number' || !Number.isInteger(l.pid) || l.pid <= 0) return null;
    return {
      pid: l.pid,
      start: typeof l.start === 'number' ? l.start : null,
      boot: typeof l.boot === 'string' && l.boot ? l.boot : null,
      acquiredAt: typeof l.acquiredAt === 'number' ? l.acquiredAt : 0,
      image: typeof l.image === 'string' && l.image ? l.image : null,
    };
  } catch {
    return null;
  }
}

function parseServerInfo(
  text: string | null,
): { pid: number; url: string; proofKey: string | null } | null {
  if (!text) return null;
  try {
    const info = JSON.parse(text) as { pid?: unknown; url?: unknown; proofKey?: unknown };
    if (typeof info.url !== 'string' || !isLocalCoreUrl(info.url)) return null;
    const pid = typeof info.pid === 'number' && Number.isInteger(info.pid) ? info.pid : null;
    // A core older than the proof has none: it is not attached to (it cannot say who it is).
    const proofKey = typeof info.proofKey === 'string' && info.proofKey ? info.proofKey : null;
    return pid ? { pid, url: info.url.replace(/\/+$/, ''), proofKey } : null;
  } catch {
    return null;
  }
}

/** The `proofKey` of the core that owns the directory now (read again: a restarted core has a new one). */
export function readProofKey(home: string, deps: Pick<LocatorDeps, 'readFile'>): string | null {
  return parseServerInfo(deps.readFile(homeFile(home, 'serverInfo')))?.proofKey ?? null;
}

export async function locateOnce(home: string, deps: LocatorDeps): Promise<LocateOnce> {
  const lock = parseLock(deps.readFile(homeFile(home, 'lock')));
  if (lock === null || !deps.isAlive(lock.pid)) return { kind: 'start' };
  const info = parseServerInfo(deps.readFile(homeFile(home, 'serverInfo')));
  if (info && info.pid === lock.pid && (await deps.health(info.url, info.proofKey))) {
    return { kind: 'attach', url: info.url, pid: lock.pid };
  }
  // Nobody answers. A crash or a restart of the computer leaves the lock behind and the pid may
  // since belong to another process (macOS and Windows reuse them quickly): not a core to wait for.
  if (await deps.isStale(lock)) return { kind: 'start' };
  // Lock taken, server.json not written yet (or left by an older core): it is starting.
  if (!info || info.pid !== lock.pid) return { kind: 'wait', reason: 'starting' };
  return { kind: 'wait', reason: 'not_responding' };
}

/**
 * Attach or start. While a live lock has no answering core, polls for up to `waitMs`
 * (a core takes a few seconds to start); then says "start": the core's own lock check
 * tells a reused pid (stale lock, taken over) from a live core that hangs (refused).
 */
export async function locateCore(
  home: string,
  deps: LocatorDeps,
  opts: { waitMs?: number; pollMs?: number; signal?: AbortSignal } = {},
): Promise<Located> {
  const waitMs = opts.waitMs ?? 15_000;
  const pollMs = opts.pollMs ?? 250;
  const deadline = deps.now() + waitMs;
  const signal = opts.signal;
  // Every wait (health check, pause) ends at once when the signal fires.
  const aborted = new Promise<'aborted'>((resolve) => {
    if (signal?.aborted) resolve('aborted');
    else signal?.addEventListener('abort', () => resolve('aborted'), { once: true });
  });
  for (;;) {
    if (signal?.aborted) return { kind: 'aborted' };
    const found = await Promise.race([locateOnce(home, deps), aborted]);
    if (found === 'aborted') return { kind: 'aborted' };
    if (found.kind !== 'wait') return found;
    if (deps.now() >= deadline) return { kind: 'start', afterWait: found.reason };
    if ((await Promise.race([deps.sleep(pollMs), aborted])) === 'aborted') {
      return { kind: 'aborted' };
    }
  }
}

/** Real dependencies: files, `kill(pid, 0)`, the lock's holder, `GET /api/health`. */
export function systemLocatorDeps(fetchImpl: typeof fetch = fetch): LocatorDeps {
  const probes = systemHolderProbesAsync();
  return {
    readFile: readTextFile,
    isAlive(pid) {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM';
      }
    },
    isStale: (holder) => holderIsStaleAsync(holder, probes),
    async health(url, proofKey) {
      if (proofKey === null) return false;
      try {
        const nonce = newTunnelProofNonce();
        const res = await fetchImpl(`${url}/api/health?proof=${nonce}`, {
          signal: AbortSignal.timeout(2000),
        });
        if (!res.ok) return false;
        const body = (await res.json()) as { ok?: unknown; proof?: unknown };
        return body.ok === true && checkTunnelProof(proofKey, nonce, body.proof);
      } catch {
        return false;
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}
