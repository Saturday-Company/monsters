import { EventEmitter } from 'node:events';
import type { CoreTarget } from './local-core.ts';
import type { StatusView } from './status-page.ts';

/*
 * Which core the window shows (M3.3, D-047): "Questo computer" (LocalCore) or a remote core
 * behind an SSH tunnel (RemoteCore). Only one at a time: switching closes the current one
 * (the tunnel, or the local core if the app started it) before the next one starts, so two
 * ssh processes or two windows never compete. Requests made while a switch is running are
 * not lost: the last one wins. Pure logic, no Electron (index.ts wires it to the window).
 */

/** What LocalCore and RemoteCore have in common for the window. */
export interface CoreHost {
  readonly target: CoreTarget | null;
  connect(): Promise<void>;
  /** "Riprova" on the status page. */
  retry(): void;
  shutdown(): Promise<void>;
  on(event: 'target', listener: (target: CoreTarget) => void): unknown;
  on(event: 'down', listener: (view: StatusView) => void): unknown;
}

export type SwitchPhase = 'idle' | 'switching' | 'active' | 'closed';

export interface SwitcherEvents<C> {
  /** The previous host is closed and `host` for `choice` is about to connect. */
  active: [choice: C, host: CoreHost];
  /** A switch started (the window can say so). */
  switching: [choice: C];
}

export interface SwitcherDeps<C> {
  create(choice: C): CoreHost;
  log?: (line: string) => void;
  /**
   * False when `choice` can no longer be opened (a profile removed while the switch to it was
   * closing the previous core): `fallback` is opened instead.
   */
  available?: (choice: C) => boolean;
  fallback?: C;
}

export class TargetSwitcher<C extends string = string> extends EventEmitter<SwitcherEvents<C>> {
  readonly #d: SwitcherDeps<C>;
  #current: { choice: C; host: CoreHost } | null = null;
  #phase: SwitchPhase = 'idle';
  #pending: { choice: C; force: boolean } | null = null;
  #running: Promise<void> | null = null;
  #shutdown: Promise<void> | null = null;

  constructor(deps: SwitcherDeps<C>) {
    super();
    this.#d = deps;
  }

  get phase(): SwitchPhase {
    return this.#phase;
  }

  get choice(): C | null {
    return this.#current?.choice ?? null;
  }

  get host(): CoreHost | null {
    return this.#current?.host ?? null;
  }

  /**
   * Shows `choice`. The same choice as now only retries when it has no core to show
   * (`force`: closes it and opens it again, e.g. after its profile was edited); a switch
   * running already picks up the newest request when it ends.
   */
  switchTo(choice: C, opts: { force?: boolean } = {}): Promise<void> {
    if (this.#phase === 'closed') return Promise.resolve();
    this.#pending = { choice, force: opts.force === true };
    this.#running ??= this.#drain().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  async #drain(): Promise<void> {
    while (this.#pending !== null && this.#phase !== 'closed') {
      const { choice: next, force } = this.#pending;
      this.#pending = null;
      const current = this.#current;
      if (current && current.choice === next && !force) {
        if (!current.host.target) current.host.retry();
        continue;
      }
      this.#phase = 'switching';
      this.emit('switching', next);
      if (current) {
        this.#current = null;
        this.#d.log?.(`switch: closing ${current.choice}`);
        await current.host.shutdown().catch((err: Error) => {
          this.#d.log?.(`switch: closing ${current.choice} failed: ${err.message}`);
        });
      }
      // Closed meanwhile, or a newer request arrived while closing: skip this one.
      if (this.#closed()) return;
      const newer = this.#pending as { choice: C } | null;
      if (newer !== null && newer.choice !== next) continue;
      this.#pending = null;
      let open = next;
      if (this.#d.available && !this.#d.available(next) && this.#d.fallback !== undefined) {
        this.#d.log?.(`switch: ${next} is gone, opening ${this.#d.fallback} instead`);
        open = this.#d.fallback;
      }
      this.#d.log?.(`switch: opening ${open}`);
      const host = this.#d.create(open);
      this.#current = { choice: open, host };
      this.#phase = 'active';
      this.emit('active', open, host);
      // Not awaited: a first connection may wait for the user (host key), and a new
      // request must be able to close it meanwhile.
      void host.connect().catch((err: Error) => this.#d.log?.(`connect: ${err.message}`));
    }
  }

  // A method, so TypeScript does not narrow the phase across the awaits above.
  #closed(): boolean {
    return this.#phase === 'closed';
  }

  /**
   * On quit: closes the current host; no switch after this. Called again (a second "Esci", or
   * "Esci" during an update), it returns the same stop: never done before the core is.
   */
  shutdown(): Promise<void> {
    this.#shutdown ??= this.#close();
    return this.#shutdown;
  }

  async #close(): Promise<void> {
    const running = this.#running;
    this.#phase = 'closed';
    this.#pending = null;
    await running?.catch(() => {});
    const current = this.#current;
    this.#current = null;
    await current?.host.shutdown();
  }
}
