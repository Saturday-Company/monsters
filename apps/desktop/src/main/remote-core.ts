import { EventEmitter } from 'node:events';
import {
  rewriteTunnelHeaders,
  type ConnectionProfile,
  type HostKeyInfo,
  type RemoteHomeFile,
  type TunnelErrorKind,
  type TunnelOptions,
  type TunnelPorts,
  type TunnelState,
} from '@monsters/remote';
import type { CoreTarget } from './local-core.ts';
import { mintWithCliToken } from './login.ts';
import type { StoredProfile } from './profiles.ts';
import type { StatusView } from './status-page.ts';

/*
 * The client mode (M3.3, D-044/D-047): a remote core reached through an SSH tunnel of
 * @monsters/remote, seen by the window as a `CoreTarget` like the local one. The tunnel
 * lives in the main process; its states become what the window and the tray show:
 * the first connection and a failure replace the page (status page), a reconnection keeps
 * the page and shows a banner over it. Pure logic over an injected tunnel (no Electron).
 */

/** The part of `Tunnel` used here (tests pass a fake). */
export interface TunnelLike {
  readonly state: TunnelState;
  readonly pid: number | undefined;
  onState(listener: (s: TunnelState) => void): () => void;
  /** Wake, network back: check now; a non-retryable failure stays failed. */
  reconnectNow(): void;
  /** The user asked to try again: also after a non-retryable failure. */
  retry(): void;
  close(): Promise<void>;
  readRemoteFile(file: RemoteHomeFile): Promise<string | null>;
}

export interface RemoteTarget extends CoreTarget {
  readonly kind: 'remote';
  readonly profileId: string;
  readonly name: string;
  readonly ports: TunnelPorts;
  /** Local and remote ports differ: Origin must be rewritten on the session (D-044). */
  readonly originRewrite: boolean;
  rewriteHeaders(url: string, headers: Record<string, string>): Record<string, string>;
}

/** What the banner over the window and the tray tooltip say. */
export type LinkState =
  | { status: 'connecting'; name: string }
  | { status: 'connected'; name: string }
  | { status: 'reconnecting'; name: string; attempt: number; delayMs: number; reason: string }
  | { status: 'failed'; name: string; kind: TunnelErrorKind; message: string }
  | { status: 'closed'; name: string };

export interface RemoteCoreEvents {
  target: [CoreTarget];
  down: [StatusView];
  link: [LinkState];
}

export interface RemoteCoreDeps {
  profile: StoredProfile;
  openTunnel(profile: ConnectionProfile, options: TunnelOptions): TunnelLike;
  /** known_hosts of the app, ssh config for tests, env… (`confirmHostKey` is added here). */
  tunnelOptions: TunnelOptions;
  /** First connection to a host: the user compares the fingerprint (native dialog). */
  confirmHostKey(info: HostKeyInfo, profile: StoredProfile): Promise<boolean>;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export function isRemoteTarget(target: CoreTarget | null | undefined): target is RemoteTarget {
  return target?.kind === 'remote';
}

export class RemoteCore extends EventEmitter<RemoteCoreEvents> {
  readonly #d: RemoteCoreDeps;
  readonly #log: (line: string) => void;
  #tunnel: TunnelLike | null = null;
  #target: RemoteTarget | null = null;
  #closed = false;

  constructor(deps: RemoteCoreDeps) {
    super();
    this.#d = deps;
    this.#log = deps.log ?? (() => {});
  }

  get profile(): StoredProfile {
    return this.#d.profile;
  }

  get target(): RemoteTarget | null {
    return this.#target;
  }

  /** pid of the ssh process (its guard on POSIX), for the log and the tests. */
  get sshPid(): number | undefined {
    return this.#tunnel?.pid;
  }

  get link(): LinkState {
    return this.#linkOf(this.#tunnel?.state ?? { status: 'connecting' });
  }

  connect(): Promise<void> {
    if (this.#closed || this.#tunnel) return Promise.resolve();
    const p = this.#d.profile;
    this.#log(`remote: connecting to "${p.name}"`);
    this.emit('down', { kind: 'remote-connecting', name: p.name });
    this.emit('link', { status: 'connecting', name: p.name });
    const tunnel = this.#d.openTunnel(p, {
      ...this.#d.tunnelOptions,
      confirmHostKey: (info) => this.#d.confirmHostKey(info, p),
    });
    this.#tunnel = tunnel;
    tunnel.onState((s) => this.#onState(s));
    return Promise.resolve();
  }

  #linkOf(s: TunnelState): LinkState {
    const name = this.#d.profile.name;
    switch (s.status) {
      case 'connecting':
      case 'connected':
      case 'closed':
        return { status: s.status, name };
      case 'reconnecting':
        return {
          status: 'reconnecting',
          name,
          attempt: s.attempt,
          delayMs: s.delayMs,
          reason: s.error.message,
        };
      case 'failed':
        return { status: 'failed', name, kind: s.error.kind, message: s.error.message };
    }
  }

  #onState(s: TunnelState): void {
    if (this.#closed && s.status !== 'closed') return;
    const p = this.#d.profile;
    switch (s.status) {
      case 'connected': {
        this.#log(
          `remote: connected to "${p.name}" (local ${s.localPort}, remote ${s.remotePort}` +
            `${s.originRewrite ? ', Origin rewritten' : ''}, core ${s.coreVersion})`,
        );
        const prev = this.#target;
        const same =
          prev !== null &&
          prev.url === s.url &&
          prev.ports.localPort === s.localPort &&
          prev.ports.remotePort === s.remotePort;
        if (!same) {
          this.#target = this.#makeTarget(s);
          this.emit('target', this.#target);
        }
        break;
      }
      case 'reconnecting':
        this.#log(
          `remote: reconnecting to "${p.name}" (attempt ${s.attempt}, in ${s.delayMs} ms): ` +
            `${s.error.kind}${s.error.detail ? ` · ${lastLine(s.error.detail)}` : ''}`,
        );
        break;
      case 'failed':
        this.#log(
          `remote: "${p.name}" failed: ${s.error.kind}` +
            `${s.error.detail ? ` · ${lastLine(s.error.detail)}` : ''}`,
        );
        this.#target = null;
        this.emit('down', {
          kind: 'remote-failed',
          name: p.name,
          address: p.host,
          errorKind: s.error.kind,
          message: s.error.message,
          detail: s.error.detail,
        });
        break;
      case 'connecting':
        // Again after a failure ("Riprova"): the status page says it is trying.
        if (!this.#target) this.emit('down', { kind: 'remote-connecting', name: p.name });
        break;
      case 'closed':
        break;
    }
    this.emit('link', this.#linkOf(s));
  }

  #makeTarget(s: Extract<TunnelState, { status: 'connected' }>): RemoteTarget {
    const p = this.#d.profile;
    const tunnel = this.#tunnel!;
    const url = s.url;
    return {
      kind: 'remote',
      url,
      profileId: p.id,
      name: p.name,
      ports: { localPort: s.localPort, remotePort: s.remotePort },
      originRewrite: s.originRewrite,
      // The ports of this target, not the tunnel's current ones: while reconnecting the
      // tunnel has none, and after a port change the window gets a new target anyway.
      rewriteHeaders: (u, h) =>
        rewriteTunnelHeaders(u, h, { localPort: s.localPort, remotePort: s.remotePort }),
      loginToken: async () => {
        if (!p.autoLogin) return null;
        // Read over SSH, used once through the tunnel, never stored or logged (D-047).
        const cli = await tunnel.readRemoteFile('cli-token');
        if (!cli) {
          this.#log('remote: automatic login: no CLI token on the remote computer');
          return null;
        }
        return mintWithCliToken(url, cli, this.#d.fetch);
      },
      setupCode: () => tunnel.readRemoteFile('setup-code'),
    };
  }

  /** "Riprova" on the status page, and the "Riconnetti" of the menu. */
  retry(): void {
    if (this.#closed) return;
    if (!this.#tunnel) void this.connect();
    // Also after a refused host key or access: the user is the one asking.
    else this.#tunnel.retry();
  }

  /** Wake from sleep, network back: check the link now (reconnect if it is dead). */
  reconnectNow(): void {
    if (!this.#closed) this.#tunnel?.reconnectNow();
  }

  /** Closes the tunnel (ssh and its children). The remote core keeps running. */
  async shutdown(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#target = null;
    const tunnel = this.#tunnel;
    if (tunnel) {
      await tunnel.close();
      this.#log(`remote: disconnected from "${this.#d.profile.name}"`);
    }
  }
}

function lastLine(text: string): string {
  return text.trim().split('\n').at(-1)?.slice(0, 200) ?? '';
}
