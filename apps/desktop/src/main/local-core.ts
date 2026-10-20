import { EventEmitter } from 'node:events';
import { delimiter } from 'node:path';
import { locateCore, readProofKey, type LocatorDeps } from './core-locator.ts';
import { homeFile } from './home.ts';
import { mintWithCliToken } from './login.ts';
import type { StatusView } from './status-page.ts';
import { CoreSupervisor, type SpawnCore, type SupervisorOptions } from './supervisor.ts';

/*
 * The core of the local mode (M3.1, D-045): attach to the one already running for the data
 * directory (CLI), else start one in a utility process and keep it alive. Whatever the
 * origin, the window gets a `CoreTarget`: a URL plus a way to obtain a login token and the
 * setup code. The client mode (M3.3) provides its own target (a remote core behind an SSH
 * tunnel) and reuses the window, the session and the login handoff unchanged.
 */

/** The `start-failed` code of a core whose files are not those of the package (S-M9). */
export const CORE_TAMPERED = 'core_tampered';

export interface CoreTarget {
  /**
   * `owned`: started by the app (stopped on quit); `attached`: started by someone else;
   * `remote`: on another computer, through an SSH tunnel (remote-core.ts).
   */
  readonly kind: 'owned' | 'attached' | 'remote';
  /** `http://127.0.0.1:<port>`, no trailing slash. */
  readonly url: string;
  /** A single-use login token, or null when none can be had (the window shows the login). */
  loginToken(): Promise<string | null>;
  /** The one-time setup code while no account exists, for the first start. */
  setupCode(): Promise<string | null>;
}

/** Variables the app decides for its core: never taken from the app's own environment. */
const SET_BY_THE_APP = new Set([
  'ELECTRON_RUN_AS_NODE',
  'MONSTERS_INSTALL_DIRS',
  'MONSTERS_CORE_CONFINE',
  'NODE_PATH',
]);

/**
 * Environment of the core the app starts: the app's own, without ELECTRON_RUN_AS_NODE (the
 * utility process is not a plain Node), plus the app's version, which the core reports as its own
 * (`/api/health`, core/src/version.ts): the core of a package is that package's core.
 *
 * The packaged app (`installDirs` given) confines its core to resources/core (review of 19/10,
 * n. 1): MONSTERS_CORE_CONFINE=1 makes the bundle refuse any module outside its folder
 * (scripts/build-core.ts), no NODE_PATH, and ws does not even try its optional native helpers.
 */
export function coreChildEnv(
  env: NodeJS.ProcessEnv,
  appVersion: string,
  installDirs: readonly string[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && !SET_BY_THE_APP.has(k)) out[k] = v;
  }
  out['MONSTERS_APP_VERSION'] = appVersion;
  // Where the app is installed (`resources` and the executable's folder): off limits to the
  // monsters' file tools, the core there runs outside the signed ASAR (review of 18/10, M9).
  if (installDirs.length > 0) {
    out['MONSTERS_INSTALL_DIRS'] = installDirs.join(delimiter);
    out['MONSTERS_CORE_CONFINE'] = '1';
    out['WS_NO_BUFFER_UTIL'] = '1';
    out['WS_NO_UTF_8_VALIDATE'] = '1';
  }
  return out;
}

export interface LocalCoreEvents {
  /** A core is ready (first time, after a restart, after re-attaching). */
  target: [CoreTarget];
  /** No core to show: what to tell the user meanwhile. */
  down: [StatusView];
}

export interface LocalCoreDeps {
  home: string;
  /** Path of `monsters.js` (the bundle of M3.0), checked before starting. */
  coreEntry: string;
  spawn: SpawnCore;
  locator: LocatorDeps;
  fileExists(path: string): boolean;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  logPath: string;
  /** Run from the sources (not packaged): a missing bundle comes from `pnpm build:core`. */
  dev?: boolean;
  supervisor?: Omit<SupervisorOptions, 'log'>;
  /** Health polling of an attached core. */
  monitor?: { intervalMs?: number; failures?: number };
  locate?: { waitMs?: number; pollMs?: number };
}

export class LocalCore extends EventEmitter<LocalCoreEvents> {
  readonly #d: LocalCoreDeps;
  readonly #log: (line: string) => void;
  readonly supervisor: CoreSupervisor;
  #target: CoreTarget | null = null;
  #monitor: ReturnType<typeof setInterval> | null = null;
  #connecting: Promise<void> | null = null;
  #lockedRetries = 0;
  #closed = false;
  readonly #abort = new AbortController();

  constructor(deps: LocalCoreDeps) {
    super();
    this.#d = deps;
    this.#log = deps.log ?? (() => {});
    this.supervisor = new CoreSupervisor(deps.spawn, { ...deps.supervisor, log: this.#log });
    this.supervisor.on('ready', (info) => {
      this.#lockedRetries = 0;
      this.#setTarget(this.#ownedTarget(info.url));
    });
    this.supervisor.on('crash', (c) => {
      this.#target = null;
      this.emit('down', { kind: 'restarting', ...c });
    });
    this.supervisor.on('failed', () => {
      this.#target = null;
      this.emit('down', { kind: 'failed', logPath: deps.logPath });
    });
    this.supervisor.on('start-failed', ({ code, message }) => {
      this.#target = null;
      // resources/core is not the one of the package (S-M9): the core does not start.
      if (code === CORE_TAMPERED) {
        this.emit('down', { kind: 'tampered', detail: message, logPath: deps.logPath });
        return;
      }
      // Someone else took the directory meanwhile (CLI started at the same moment): attach.
      if (code === 'home_locked' && this.#lockedRetries++ < 2) {
        void this.connect();
        return;
      }
      this.emit('down', { kind: 'locked', home: deps.home });
    });
  }

  get target(): CoreTarget | null {
    return this.#target;
  }

  #setTarget(target: CoreTarget): void {
    this.#target = target;
    this.#log(`${target.kind === 'owned' ? 'started' : 'attached to'} core at ${target.url}`);
    this.emit('target', target);
  }

  #readSetupCode(): string | null {
    const text = this.#d.locator.readFile(homeFile(this.#d.home, 'setupCode'))?.trim();
    return text ? text : null;
  }

  #ownedTarget(url: string): CoreTarget {
    return {
      kind: 'owned',
      url,
      loginToken: () => this.supervisor.loginToken(),
      setupCode: () => Promise.resolve(this.#readSetupCode()),
    };
  }

  #attachedTarget(url: string): CoreTarget {
    return {
      kind: 'attached',
      url,
      loginToken: async () => {
        // The CLI token: a file readable only by this user, rotated at each core start.
        const token = this.#d.locator.readFile(homeFile(this.#d.home, 'cliToken'))?.trim();
        return token ? mintWithCliToken(url, token, this.#d.fetch) : null;
      },
      setupCode: () => Promise.resolve(this.#readSetupCode()),
    };
  }

  /** Finds or starts the core. Safe to call again (re-attach, retry). */
  connect(): Promise<void> {
    this.#connecting ??= this.#connect().finally(() => {
      this.#connecting = null;
    });
    return this.#connecting;
  }

  async #connect(): Promise<void> {
    if (this.#closed) return;
    // Our own core is starting, running or about to restart: nothing to look for.
    if (['starting', 'running', 'waiting', 'stopping'].includes(this.supervisor.state)) return;
    this.#stopMonitor();
    const found = await locateCore(this.#d.home, this.#d.locator, {
      ...this.#d.locate,
      signal: this.#abort.signal,
    });
    if (this.#closed || found.kind === 'aborted') return;
    if (found.kind === 'attach') {
      this.#setTarget(this.#attachedTarget(found.url));
      this.#startMonitor(found.url);
      return;
    }
    if (found.afterWait)
      this.#log(`a core holds the lock but does not answer (${found.afterWait})`);
    if (!this.#d.fileExists(this.#d.coreEntry)) {
      this.#log(`core bundle not found: ${this.#d.coreEntry}`);
      this.emit('down', { kind: 'missing', path: this.#d.coreEntry, dev: this.#d.dev === true });
      return;
    }
    this.emit('down', { kind: 'starting' });
    if (this.supervisor.state === 'failed') this.supervisor.retry();
    else this.supervisor.start();
  }

  /** "Riprova" on the status page. */
  retry(): void {
    if (this.#connecting || this.#target) return;
    const state = this.supervisor.state;
    if (state !== 'failed' && state !== 'idle' && state !== 'stopped') return;
    this.#lockedRetries = 0;
    void this.connect();
  }

  #startMonitor(url: string): void {
    const intervalMs = this.#d.monitor?.intervalMs ?? 5000;
    const maxFailures = this.#d.monitor?.failures ?? 3;
    let failures = 0;
    let checking = false;
    this.#monitor = setInterval(() => {
      if (checking) return;
      checking = true;
      void this.#d.locator
        .health(url, readProofKey(this.#d.home, this.#d.locator))
        .then((ok) => {
          failures = ok ? 0 : failures + 1;
          if (failures < maxFailures || this.#closed) return;
          // The core started from the terminal went away: find (or start) another one.
          this.#log(`attached core at ${url} stopped answering`);
          this.#target = null;
          this.#stopMonitor();
          void this.connect();
        })
        .finally(() => {
          checking = false;
        });
    }, intervalMs);
  }

  #stopMonitor(): void {
    if (this.#monitor) clearInterval(this.#monitor);
    this.#monitor = null;
  }

  /** On quit: stops the core only if the app started it; an attached core keeps running. */
  async shutdown(): Promise<void> {
    this.#closed = true;
    // A search for a hung CLI core may wait up to 15 s: quitting or switching does not.
    this.#abort.abort();
    this.#stopMonitor();
    await this.#connecting?.catch(() => {});
    await this.supervisor.stop();
  }
}
