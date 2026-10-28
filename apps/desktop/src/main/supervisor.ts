import { EventEmitter } from 'node:events';
import type { CoreToDesktopMessage, DesktopToCoreMessage } from '@monsters/shared';
import { DEFAULT_RESTART_POLICY, RestartBackoff, type RestartPolicy } from './backoff.ts';
import type { KeychainHost, KeychainSession } from './keychain-host.ts';

/*
 * The core the app started itself: `monsters start` in an Electron utility process (the
 * spawn function hides Electron, so this runs in tests with a fake child). It waits for
 * `ready`, restarts a core that dies unexpectedly (backoff.ts), asks for login tokens over
 * the message port and stops it gracefully, then by force.
 */

/** The child process as the supervisor sees it (an Electron `UtilityProcess` in the app). */
export interface CoreChild {
  readonly pid: number | undefined;
  postMessage(message: DesktopToCoreMessage): void;
  /** Asks the process to terminate (SIGTERM on POSIX). */
  kill(): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number) => void): void;
}

export type SpawnCore = () => CoreChild;
export type ReadyInfo = Extract<CoreToDesktopMessage, { type: 'ready' }>;

export interface SupervisorOptions {
  policy?: RestartPolicy;
  /** Longest wait for `ready` (the first start may wait for the keychain, up to 20 s). */
  readyTimeoutMs?: number;
  /** Graceful stop, then SIGTERM, then (3 s later) `forceKill`. */
  stopTimeoutMs?: number;
  forceKill?: (pid: number) => void;
  /** Runs the core's keychain calls (keychain-host.ts); without it they get no answer. */
  keychain?: KeychainHost;
  /**
   * Run before every start of the core, restarts after a crash included (the packaged app checks
   * resources/core against its manifest, core-integrity.ts, S-M9): a problem stops the start
   * (`start-failed`, not retried).
   */
  check?: () => Promise<{ code: string; message: string } | null>;
  log?: (line: string) => void;
}

export type SupervisorState =
  'idle' | 'starting' | 'running' | 'waiting' | 'failed' | 'stopping' | 'stopped';

export interface CrashInfo {
  code: number;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
}

export interface SupervisorEvents {
  ready: [ReadyInfo];
  /** Died unexpectedly; restarting after `delayMs`. */
  crash: [CrashInfo];
  /** Died too many times in a row: no more restarts until `retry()`. */
  failed: [{ code: number; attempts: number }];
  /**
   * The core said why it will not start (`start-failed` over the port: `home_locked`, a bad
   * settings.json, a migration…) or the check before the start refused it. Not retried: it would
   * fail the same way, and the reason is what the user needs to see.
   */
  'start-failed': [{ code: string; message: string }];
}

const FORCE_KILL_AFTER_MS = 3000;

function defaultForceKill(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

function asMessage(raw: unknown): CoreToDesktopMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m['type'] === 'ready' && typeof m['url'] === 'string' && typeof m['home'] === 'string') {
    return raw as CoreToDesktopMessage;
  }
  if (m['type'] === 'login-token' && typeof m['id'] === 'number')
    return raw as CoreToDesktopMessage;
  if (m['type'] === 'start-failed' && typeof m['code'] === 'string') {
    return raw as CoreToDesktopMessage;
  }
  return null;
}

export class CoreSupervisor extends EventEmitter<SupervisorEvents> {
  readonly #spawn: SpawnCore;
  readonly #backoff: RestartBackoff;
  readonly #readyTimeoutMs: number;
  readonly #stopTimeoutMs: number;
  readonly #forceKill: (pid: number) => void;
  readonly #log: (line: string) => void;
  readonly #keychain: KeychainHost | undefined;
  readonly #check: SupervisorOptions['check'];
  /** Bumped by every launch and stop: a check that ends after either is forgotten. */
  #launches = 0;
  #state: SupervisorState = 'idle';
  #child: CoreChild | null = null;
  #keychainSession: KeychainSession | null = null;
  #info: ReadyInfo | null = null;
  #readyAt: number | null = null;
  #startFailure: { code: string; message: string } | null = null;
  #timers = new Set<ReturnType<typeof setTimeout>>();
  #stopping: Promise<void> | null = null;
  #onStopped: (() => void) | null = null;
  #tokens = new Map<number, (token: string | null) => void>();
  #nextId = 1;

  constructor(spawn: SpawnCore, options: SupervisorOptions = {}) {
    super();
    this.#spawn = spawn;
    this.#backoff = new RestartBackoff(options.policy ?? DEFAULT_RESTART_POLICY);
    this.#readyTimeoutMs = options.readyTimeoutMs ?? 90_000;
    this.#stopTimeoutMs = options.stopTimeoutMs ?? 10_000;
    this.#forceKill = options.forceKill ?? defaultForceKill;
    this.#log = options.log ?? (() => {});
    this.#keychain = options.keychain;
    this.#check = options.check;
  }

  get state(): SupervisorState {
    return this.#state;
  }

  /** Where the core listens, while it is running. */
  get info(): ReadyInfo | null {
    return this.#state === 'running' ? this.#info : null;
  }

  get pid(): number | undefined {
    return this.#child?.pid;
  }

  start(): void {
    if (!['idle', 'failed', 'stopped'].includes(this.#state)) return;
    this.#launch();
  }

  /** After `failed` (or a refused start): try again from a clean count. */
  retry(): void {
    if (this.#state !== 'failed') return;
    this.#backoff.reset();
    this.#launch();
  }

  #later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.#timers.delete(t);
      fn();
    }, ms);
    this.#timers.add(t);
  }

  #clearTimers(): void {
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
  }

  #launch(): void {
    this.#clearTimers();
    this.#state = 'starting';
    this.#info = null;
    this.#readyAt = null;
    this.#startFailure = null;
    const launch = ++this.#launches;
    if (!this.#check) {
      this.#spawnNow();
      return;
    }
    const refuse = (failure: { code: string; message: string }) => {
      this.#log(`core: not started (${failure.code}): ${failure.message}`);
      this.#state = 'failed';
      this.emit('start-failed', failure);
    };
    this.#check().then(
      (problem) => {
        // Stopped, or started again, meanwhile: this check is not the current one.
        if (launch !== this.#launches || this.#state !== 'starting') return;
        if (problem) refuse(problem);
        else this.#spawnNow();
      },
      (err: unknown) => {
        if (launch !== this.#launches || this.#state !== 'starting') return;
        refuse({ code: 'core_check_failed', message: (err as Error).message });
      },
    );
  }

  #spawnNow(): void {
    let child: CoreChild;
    try {
      child = this.#spawn();
    } catch (err) {
      this.#log(`core: could not start the process: ${(err as Error).message}`);
      this.#state = 'failed';
      this.emit('failed', { code: -1, attempts: this.#backoff.failures });
      return;
    }
    this.#child = child;
    this.#keychainSession?.close();
    this.#keychainSession = this.#keychain?.open((m) => child.postMessage(m)) ?? null;
    this.#log('core: starting');
    child.onMessage((m) => this.#onMessage(child, m));
    child.onExit((code) => this.#onExit(child, code));
    this.#later(() => {
      if (this.#child !== child || this.#state !== 'starting') return;
      this.#log(`core: not ready after ${this.#readyTimeoutMs} ms, terminating it`);
      this.#terminate(child);
    }, this.#readyTimeoutMs);
  }

  #terminate(child: CoreChild): void {
    child.kill();
    this.#later(() => {
      if (this.#child === child && child.pid !== undefined) this.#forceKill(child.pid);
    }, FORCE_KILL_AFTER_MS);
  }

  #onMessage(child: CoreChild, raw: unknown): void {
    if (child !== this.#child) return;
    // Keychain calls, also while the core starts (it reads its key before `ready`).
    if (this.#keychainSession?.handle(raw)) return;
    const message = asMessage(raw);
    if (!message) return;
    switch (message.type) {
      case 'ready':
        if (this.#state !== 'starting') return;
        this.#clearTimers();
        this.#state = 'running';
        this.#info = message;
        this.#readyAt = Date.now();
        this.#log(`core: ready at ${message.url}`);
        this.emit('ready', message);
        return;
      case 'login-token': {
        const resolve = this.#tokens.get(message.id);
        this.#tokens.delete(message.id);
        resolve?.(message.token);
        return;
      }
      case 'start-failed':
        this.#startFailure = { code: message.code, message: message.message };
        this.#log(`core: refused to start (${message.code}): ${message.message}`);
        return;
    }
  }

  #onExit(child: CoreChild, code: number): void {
    if (child !== this.#child) return;
    this.#child = null;
    this.#keychainSession?.close();
    this.#keychainSession = null;
    this.#clearTimers();
    for (const resolve of this.#tokens.values()) resolve(null);
    this.#tokens.clear();
    const uptime = this.#readyAt === null ? 0 : Date.now() - this.#readyAt;
    if (this.#state === 'stopping') {
      this.#log(`core: stopped (exit ${code})`);
      this.#state = 'stopped';
      this.#stopping = null;
      this.#onStopped?.();
      this.#onStopped = null;
      return;
    }
    if (this.#startFailure) {
      this.#state = 'failed';
      this.emit('start-failed', this.#startFailure);
      return;
    }
    const next = this.#backoff.onCrash(uptime);
    this.#log(`core: exited unexpectedly (code ${code}) after ${uptime} ms`);
    if (!next) {
      this.#state = 'failed';
      this.emit('failed', { code, attempts: this.#backoff.policy.maxAttempts });
      return;
    }
    this.#state = 'waiting';
    this.emit('crash', {
      code,
      attempt: next.attempt,
      maxAttempts: this.#backoff.policy.maxAttempts,
      delayMs: next.delayMs,
    });
    this.#later(() => {
      if (this.#state === 'waiting') this.#launch();
    }, next.delayMs);
  }

  /** A single-use login token from the running core, or null (not running, no answer). */
  loginToken(timeoutMs = 5000): Promise<string | null> {
    const child = this.#child;
    if (!child || this.#state !== 'running') return Promise.resolve(null);
    const id = this.#nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#tokens.delete(id);
        resolve(null);
      }, timeoutMs);
      this.#tokens.set(id, (token) => {
        clearTimeout(timer);
        resolve(token);
      });
      child.postMessage({ type: 'login-token', id });
    });
  }

  /**
   * The running core no longer answers (health check, local-core.ts): ends it. Its exit is
   * handled like any crash, so it restarts after the pause of the backoff, and gives up after
   * too many in a row. SIGTERM, then (3 s later) `forceKill`: a wedged process does not hear the
   * first. False if there is no running core.
   */
  terminateUnresponsive(): boolean {
    const child = this.#child;
    if (!child || this.#state !== 'running') return false;
    this.#log('core: not answering, terminating it');
    this.#terminate(child);
    return true;
  }

  /** Stops the core (runs aborted and files closed by the core itself); idempotent. */
  stop(): Promise<void> {
    if (this.#stopping) return this.#stopping;
    this.#clearTimers();
    this.#launches++;
    const child = this.#child;
    if (!child) {
      this.#state = 'stopped';
      return Promise.resolve();
    }
    this.#state = 'stopping';
    this.#stopping = new Promise<void>((resolve) => {
      this.#onStopped = resolve;
    });
    child.postMessage({ type: 'stop' });
    this.#later(() => {
      if (this.#child !== child) return;
      this.#log(`core: no clean stop after ${this.#stopTimeoutMs} ms, terminating it`);
      this.#terminate(child);
    }, this.#stopTimeoutMs);
    return this.#stopping;
  }
}
