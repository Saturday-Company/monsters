import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { ProcessRegistry } from './process-registry.ts';
import { groupExists, startTimeOf, verifiedGroupMembers } from './proc.ts';

export type ScopeKind = 'global' | 'run' | 'agent' | 'tool';

/** Reason used to abort scopes; `name` is "AbortError" like a DOM abort. */
export class KilledError extends Error {
  readonly scope: ScopeKind;
  constructor(scope: ScopeKind, reason?: string) {
    super(reason ? `stopped (${scope}): ${reason}` : `stopped (${scope})`);
    this.name = 'AbortError';
    this.scope = scope;
  }
}

/**
 * Reason of a scope stopped because the work it was for stopped or ended, not by a stop of its
 * own: the tool call that started a delegation stopped (its lead reached a limit, crashed, was
 * stopped), or its parent scope ended while it was still working. See `follow` and `close`.
 */
export class CallerStoppedError extends KilledError {
  constructor(scope: ScopeKind, reason = 'the work it was for stopped') {
    super(scope, reason);
  }
}

/**
 * Why a scope that follows a caller stops: the kill switch, the closing of the core and the
 * stop of a whole job keep their own reason (the cause the user reads), anything else is
 * the caller's stop.
 */
function followedReason(kind: ScopeKind, reason: unknown): unknown {
  const own =
    reason instanceof KilledError &&
    !(reason instanceof CallerStoppedError) &&
    (reason.scope === 'global' || reason.scope === 'run');
  return own ? reason : new CallerStoppedError(kind);
}

export const DEFAULT_KILL_GRACE_MS = 1500;

export interface TrackOptions {
  /**
   * The child leads its own process group (spawned with `detached: true` on
   * POSIX): signals go to the whole group, grandchildren included.
   */
  group?: boolean;
}

interface Tracked {
  child: ChildProcess;
  group: boolean;
  /** Process group id (= leader pid) when `group` is true. */
  pgid: number | undefined;
  /** Leader start time, to recognise the group after the leader has exited. */
  leaderStart: number | null;
  /** Called once the process (and its group) is gone. */
  onGone: () => void;
  terminating?: Promise<void>;
}

const POSIX = process.platform !== 'win32';
const POLL_MS = 20;
/** How long to wait for a group to disappear after SIGKILL before giving up. */
const KILL_WAIT_MS = 2000;

function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * True while the tracked process or, for a group, any member of the group is
 * alive. With `verify` the group is matched against the leader start time so a
 * reused PGID is never mistaken for ours (used before sending signals).
 */
function isAlive(t: Tracked, verify = false): boolean {
  if (isRunning(t.child)) return true;
  if (!t.group || t.pgid === undefined) return false;
  if (!groupExists(t.pgid)) return false;
  if (!verify || t.leaderStart === null) return true;
  const members = verifiedGroupMembers(t.pgid, t.leaderStart);
  // Cannot inspect processes: trust the leader-exit bookkeeping and the group probe.
  return members === null || members.length > 0;
}

function sendSignal(t: Tracked, signal: NodeJS.Signals): void {
  if (t.group && t.pgid !== undefined) {
    try {
      process.kill(-t.pgid, signal);
      // The leader is in the group: signalling it again could look like a
      // second Ctrl+C (forced exit) to programs that shut down gracefully.
      return;
    } catch {
      // The group may be gone already: fall back to the leader.
    }
  }
  if (!POSIX && isRunning(t.child) && t.child.pid !== undefined) {
    // No process groups on Windows: end the whole tree while the leader still
    // links it (killing the leader alone leaves its children running).
    try {
      spawnSync('taskkill', ['/pid', String(t.child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 5000,
      });
    } catch {
      // Fall back to the leader below.
    }
  }
  if (isRunning(t.child)) {
    try {
      t.child.kill(signal);
    } catch {
      // Already exited.
    }
  }
}

async function waitUntil(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
  }
  return true;
}

/**
 * Sends SIGINT, then SIGKILL after `graceMs` if the process (or any member of
 * its process group, even after the leader has exited) is still alive.
 * Resolves once they are gone.
 */
export function terminateProcess(t: Tracked, graceMs: number): Promise<void> {
  // Closing a run and the kill switch may both stop the same process: one termination.
  t.terminating ??= terminate(t, graceMs);
  return t.terminating;
}

async function terminate(t: Tracked, graceMs: number): Promise<void> {
  try {
    if (!isAlive(t, true)) return;
    const gone = () => !isAlive(t);
    sendSignal(t, 'SIGINT');
    if (await waitUntil(gone, graceMs)) return;
    sendSignal(t, 'SIGKILL');
    // Safety net: never hang the kill switch on a process that refuses to report its exit.
    await waitUntil(gone, KILL_WAIT_MS);
  } finally {
    t.onGone();
  }
}

/**
 * A node of the cancellation tree: global → run → agent → tool call.
 * Aborting a scope aborts all its descendants and terminates their processes.
 */
export class ControlScope {
  readonly kind: ScopeKind;
  readonly id: string;
  readonly parent: ControlScope | null;
  readonly createdAt = Date.now();
  readonly #controller = new AbortController();
  readonly #children = new Set<ControlScope>();
  readonly #processes = new Set<Tracked>();
  readonly #graceMs: number;
  readonly #registry: ProcessRegistry | null;
  /** Removes the listeners of `follow`: a finished scope follows nobody. */
  readonly #unfollow: (() => void)[] = [];
  #closed = false;
  #settled: Promise<void> = Promise.resolve();

  constructor(
    kind: ScopeKind,
    id: string,
    parent: ControlScope | null,
    graceMs: number,
    registry?: ProcessRegistry | null,
  ) {
    this.kind = kind;
    this.id = id;
    this.parent = parent;
    this.#graceMs = graceMs;
    this.#registry = registry ?? (parent ? parent.#registry : null);
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  get aborted(): boolean {
    return this.#controller.signal.aborted;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Resolves once a closed scope has terminated its leftover processes. */
  get settled(): Promise<void> {
    return this.#settled;
  }

  throwIfAborted(): void {
    this.#controller.signal.throwIfAborted();
  }

  /** Creates a child scope. A child of an aborted scope is born aborted. */
  child(kind: ScopeKind, id: string): ControlScope {
    const scope = new ControlScope(kind, id, this, this.#graceMs);
    this.attach(scope);
    return scope;
  }

  /** Scope for an agent working inside this run. */
  agent(agentId: string): ControlScope {
    return this.child('agent', agentId);
  }

  /** Scope for a single tool or model call. */
  toolCall(callId: string): ControlScope {
    return this.child('tool', callId);
  }

  /**
   * Ties this scope to the work that asked for it (the signal of the tool call that started a
   * delegation): when `caller` aborts, this scope aborts too, with its processes, whatever the
   * tree it hangs from. A delegation stays a child of its run (the kill switch, `killRun` and a
   * monster's Stop find it there, F-1) and still stops with the call that waits for it: a lead
   * that reaches a limit or crashes mid-call leaves no delegate working for nobody.
   */
  follow(caller: AbortSignal): this {
    if (this.#closed || this.aborted) return this;
    if (caller.aborted) {
      void this.abort(followedReason(this.kind, caller.reason));
      return this;
    }
    const onAbort = () => {
      if (!this.#closed) void this.abort(followedReason(this.kind, caller.reason));
    };
    caller.addEventListener('abort', onAbort, { once: true });
    this.#unfollow.push(() => caller.removeEventListener('abort', onAbort));
    return this;
  }

  /**
   * Attaches an externally constructed scope (e.g. a subclass like `RunHandle`)
   * as a child. A scope attached to an aborted parent is aborted immediately.
   */
  attach(scope: ControlScope): void {
    if (this.aborted) {
      scope.#abortTree(this.signal.reason, []);
      return;
    }
    this.#children.add(scope);
  }

  /**
   * Registers a child process to terminate when this scope is aborted or
   * closed. With `group`, the whole process group is followed: it stays
   * tracked after the leader exits for as long as any member is alive.
   */
  trackProcess(child: ChildProcess, options: TrackOptions = {}): () => void {
    // No pid: the spawn failed (the child emits 'error'), there is nothing to stop.
    if (child.pid === undefined) return () => {};
    const group = (options.group ?? false) && POSIX;
    const pgid = group ? child.pid : undefined;
    const leaderStart = pgid !== undefined ? startTimeOf(pgid) : null;
    const registry = this.#registry;
    let registered = false;
    if (registry && pgid !== undefined && leaderStart !== null) {
      registry.add(registry.record(pgid, leaderStart));
      registered = true;
    }
    let gone = false;
    const tracked: Tracked = {
      child,
      group,
      pgid,
      leaderStart,
      onGone: () => {
        if (gone) return;
        gone = true;
        this.#processes.delete(tracked);
        if (registered && pgid !== undefined) registry?.remove(pgid);
      },
    };
    if (this.aborted || this.#closed) {
      void terminateProcess(tracked, this.#graceMs);
      return () => {};
    }
    this.#processes.add(tracked);
    child.once('exit', () => {
      // A group outlives its leader while grandchildren are running.
      if (!isAlive(tracked)) tracked.onGone();
    });
    return tracked.onGone;
  }

  /**
   * Spawns a process tied to this scope: on POSIX it gets its own process group
   * so the kill switch reaches its descendants too.
   */
  spawn(command: string, args: readonly string[] = [], options: SpawnOptions = {}): ChildProcess {
    this.throwIfAborted();
    if (this.#closed) throw new Error(`scope ${this.kind}:${this.id} is closed`);
    const child = spawn(command, args, { ...options, detached: POSIX });
    this.trackProcess(child, { group: POSIX });
    return child;
  }

  /**
   * Aborts this scope and its descendants, terminating their processes
   * (SIGINT, then SIGKILL after the grace period). Resolves when they are gone.
   */
  async abort(reason: unknown = new KilledError(this.kind)): Promise<{ processes: number }> {
    const pending: Promise<void>[] = [];
    this.#abortTree(reason, pending);
    if (this.parent) this.parent.#children.delete(this);
    await Promise.all(pending);
    return { processes: pending.length };
  }

  /**
   * Closes a finished scope without aborting it: processes still alive in it
   * or its descendants (including groups whose leader already exited) are
   * terminated, and the scope stays attached to its parent until they are
   * gone, so a kill in the meantime still reaches them. See `settled`.
   *
   * A child scope still working (not closed) is aborted with `CallerStoppedError`: the work
   * it was part of ended, nobody waits for its result, and once this scope is detached
   * neither the kill switch nor the list of active runs would see it any more.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#release();
    const pending: Promise<void>[] = [];
    for (const t of this.#processes) pending.push(terminateProcess(t, this.#graceMs));
    for (const c of [...this.#children]) {
      if (c.#closed) {
        c.#terminateTree(pending);
        continue;
      }
      c.#abortTree(new CallerStoppedError(c.kind, 'its parent ended'), pending);
      this.#children.delete(c);
    }
    const detach = () => {
      if (this.parent) this.parent.#children.delete(this);
    };
    if (pending.length === 0) {
      detach();
      return;
    }
    this.#settled = Promise.all(pending).then(detach);
  }

  /** The live child scopes, not closed (a monster's stop looks for its part in a run, F-1). */
  children(): ControlScope[] {
    return [...this.#children].filter((c) => !c.#closed && !c.aborted);
  }

  /** Number of live descendant scopes of a given kind. */
  countDescendants(kind: ScopeKind): number {
    let n = 0;
    for (const c of this.#children) {
      if (c.kind === kind && !c.#closed) n++;
      n += c.countDescendants(kind);
    }
    return n;
  }

  /** Number of live tracked processes (or process groups) in this scope and its descendants. */
  countProcesses(): number {
    let n = 0;
    for (const t of this.#processes) {
      if (isAlive(t)) n++;
      else t.onGone();
    }
    for (const c of this.#children) n += c.countProcesses();
    return n;
  }

  #terminateTree(pending: Promise<void>[]): void {
    for (const t of this.#processes) pending.push(terminateProcess(t, this.#graceMs));
    for (const c of this.#children) c.#terminateTree(pending);
  }

  #release(): void {
    for (const off of this.#unfollow.splice(0)) off();
  }

  #abortTree(reason: unknown, pending: Promise<void>[]): void {
    this.#release();
    if (!this.#controller.signal.aborted) this.#controller.abort(reason);
    for (const t of this.#processes) pending.push(terminateProcess(t, this.#graceMs));
    this.#processes.clear();
    for (const c of this.#children) c.#abortTree(reason, pending);
    this.#children.clear();
  }
}
