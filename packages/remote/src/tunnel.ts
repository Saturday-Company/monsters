import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTunnelProof, newTunnelProofNonce } from '@monsters/shared/node';
import { discoverRemotePort, type RemotePort } from './discover.ts';
import { TailBuffer, TunnelError, classifySshFailure, type TunnelErrorKind } from './errors.ts';
import { scanHostKeys, trustHostKeys, type HostKeyInfo } from './host-keys.ts';
import { rewriteTunnelHeaders, type TunnelPorts } from './origin.ts';
import { pickLocalPort } from './ports.ts';
import { ConnectionProfileSchema, type ConnectionProfile } from './profile.ts';
import {
  killTree,
  locateOpenSsh,
  reapLeftovers,
  runCapture,
  spawnGuarded,
  type ProcessDeps,
} from './process.ts';
import { remoteFileArgs, tunnelArgs, type RemoteHomeFile, type SshArgOptions } from './ssh-args.ts';

export interface ConnectedInfo extends TunnelPorts {
  /** Where the window goes: `http://127.0.0.1:<localPort>`. */
  url: string;
  remotePortSource: RemotePort['source'];
  /** Version reported by the remote core. */
  coreVersion: string;
  /** True when local and remote ports differ: the app must rewrite Origin (D-044). */
  originRewrite: boolean;
}

export type TunnelState =
  | { status: 'connecting' }
  | ({ status: 'connected' } & ConnectedInfo)
  | { status: 'reconnecting'; attempt: number; delayMs: number; error: TunnelError }
  | { status: 'failed'; error: TunnelError }
  | { status: 'closed' };

export interface ReconnectOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Consecutive failed attempts before giving up (`failed`). */
  maxAttempts?: number;
  /**
   * After `failed` by exhausted attempts with a retryable error: a slow new round of
   * attempts every so often (default 3 minutes). 0 turns it off.
   */
  slowRetryMs?: number;
}

export interface TunnelOptions extends ProcessDeps {
  /** known_hosts of Monsters. Default `<MONSTERS_HOME or ~/.monsters>/known_hosts`. */
  knownHostsFile?: string;
  /** See `SshArgOptions.userKnownHostsFiles`. */
  userKnownHostsFiles?: readonly string[];
  /** `ssh -F` (tests). Default: the user's `~/.ssh/config`. */
  configFile?: string;
  /** Default: the system OpenSSH (`locateOpenSsh`). */
  sshPath?: string;
  keyscanPath?: string | null;
  /**
   * Called on the first connection to a host: show `info.keys[0].fingerprint`
   * and resolve true to trust that key (only that one: see `trustHostKeys`). Without it (or on false) the tunnel
   * fails with `host-key-unknown` and the error carries `hostKey`.
   */
  confirmHostKey?: (info: HostKeyInfo) => boolean | Promise<boolean>;
  /**
   * Try the remote port as local port first (no Origin rewrite). Default false: a port
   * chosen by the system. Either way the tunnel holds it for its whole life.
   */
  preferSamePort?: boolean;
  /** Fixed local port (tests, or a port chosen by the app). */
  localPort?: number;
  /**
   * Where ssh listens for the forward, behind the tunnel's own listener: `unix` (default
   * on Linux and macOS) a socket in a private folder, `tcp` (default on Windows) a port
   * of 127.0.0.1. See D-044 (M3.6).
   */
  forward?: 'unix' | 'tcp';
  /** Time for one attempt: discovery, SSH handshake and first health check. */
  connectTimeoutMs?: number;
  /** Health check of the remote core while connected. */
  healthIntervalMs?: number;
  healthTimeoutMs?: number;
  reconnect?: ReconnectOptions;
}

const DEFAULTS = {
  connectTimeoutMs: 20_000,
  healthIntervalMs: 15_000,
  healthTimeoutMs: 5_000,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  maxAttempts: 20,
  slowRetryMs: 180_000,
  killGraceMs: 2_000,
  pollMs: 200,
  remoteFailuresBeforeGivingUp: 3,
  maxHealthBody: 64 * 1024,
};

/** sun_path is 104 bytes on macOS, 108 on Linux. */
const MAX_SOCKET_PATH = 100;

export function defaultKnownHostsFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env['MONSTERS_HOME'] ?? join(homedir(), '.monsters'), 'known_hosts');
}

/** Delay before reconnection attempt `n` (1-based): doubling, capped. */
export function backoffDelay(attempt: number, initialMs: number, maxMs: number): number {
  return Math.min(maxMs, initialMs * 2 ** Math.max(0, attempt - 1));
}

/** Where ssh listens for one attempt: only the tunnel connects there. */
type Endpoint = { kind: 'unix'; path: string } | { kind: 'tcp'; port: number };

type Health =
  | { version: string }
  | 'refused'
  | 'broken'
  | 'timeout'
  | 'not-monsters'
  /** A Monsters health answer without a valid proof for the key of server.json. */
  | 'unproven';

interface Running {
  child: ChildProcess;
  endpoint: Endpoint;
  stderr: TailBuffer;
  exited: Promise<number | null>;
  hasExited: () => boolean;
}

/** A private folder (0700, ours) for the sockets of ssh, short enough for sun_path. */
function makeSocketDir(): string | null {
  for (const base of [tmpdir(), '/tmp']) {
    try {
      const dir = mkdtempSync(join(base, 'monsters-ssh-'));
      if (join(dir, 't99999.sock').length <= MAX_SOCKET_PATH && !dir.includes(':')) return dir;
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // try the next one
    }
  }
  return null;
}

function listen(server: Server, port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const onError = () => resolve(null);
    server.once('error', onError);
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      server.off('error', onError);
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : null);
    });
  });
}

/**
 * Opens an SSH tunnel to a remote Monsters core and keeps it up:
 * connecting → connected → reconnecting (backoff) → connected | failed;
 * `close()` → closed.
 *
 * The window talks to a listener of the tunnel itself on 127.0.0.1 (a port chosen by the
 * system, held until `close()`, so the URL never changes and no other program can take
 * it in between). That listener forwards a connection only while connected, to where ssh
 * listens: a Unix socket in a private folder (Linux, macOS) or a port of 127.0.0.1
 * (Windows). "Connected" means the far end proved to be the remote core: it answered a
 * fresh nonce with the HMAC of the key that the core wrote in its server.json, read over
 * SSH (D-044, M3.6).
 */
export function openTunnel(profile: ConnectionProfile, options: TunnelOptions = {}): Tunnel {
  return new Tunnel(ConnectionProfileSchema.parse(profile), options);
}

export class Tunnel {
  private current: TunnelState = { status: 'connecting' };
  private readonly listeners = new Set<(s: TunnelState) => void>();
  private closed = false;
  private running: Running | null = null;
  private proxy: Server | null = null;
  private boundPort: number | undefined;
  /** Where the listener forwards to: set only while connected (proved). */
  private gate: Endpoint | null = null;
  private readonly piped = new Set<Socket>();
  private socketDir: string | null | undefined;
  private attempts = 0;
  private proofKey: string | null = null;
  private ports: TunnelPorts | null = null;
  private wake: (() => void) | null = null;
  private slowRetry: ReturnType<typeof setTimeout> | null = null;
  /** While connected: ends the wait of the health loop and checks at once. */
  private checkNow: (() => void) | null = null;
  private readonly abort = new AbortController();
  private loop: Promise<void>;
  private readonly sshArgs: SshArgOptions;
  private readonly knownHostsFile: string;

  readonly profile: ConnectionProfile;
  private readonly opts: TunnelOptions;

  constructor(profile: ConnectionProfile, opts: TunnelOptions) {
    this.profile = profile;
    this.opts = opts;
    this.knownHostsFile = opts.knownHostsFile ?? defaultKnownHostsFile(opts.env);
    this.sshArgs = {
      knownHostsFile: this.knownHostsFile,
      userKnownHostsFiles: opts.userKnownHostsFiles,
      configFile: opts.configFile,
      connectTimeoutSec: Math.max(
        1,
        Math.round((opts.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs) / 2000),
      ),
    };
    this.loop = this.run(false);
  }

  get state(): TunnelState {
    return this.current;
  }

  /**
   * The tunnel's own port on 127.0.0.1, once bound (first attempt) and until `close()`;
   * it forwards only while connected.
   */
  get localPort(): number | undefined {
    return this.boundPort;
  }

  /** Current ports while connected (for the Origin rewrite), else null. */
  get tunnelPorts(): TunnelPorts | null {
    return this.ports;
  }

  /**
   * pid of the running ssh process (on Linux and macOS its guard, the leader
   * of a process group with ssh in it), for diagnostics.
   */
  get pid(): number | undefined {
    return this.running?.child.pid;
  }

  /** Subscribes to state changes; returns the unsubscribe function. */
  onState(listener: (s: TunnelState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves when connected (now or next); rejects on `failed` or `closed`. */
  connected(): Promise<ConnectedInfo> {
    const settled = (s: TunnelState): ConnectedInfo | Error | null => {
      if (s.status === 'connected') {
        const { status: _status, ...info } = s;
        return info;
      }
      if (s.status === 'failed') return s.error;
      if (s.status === 'closed') return new Error('tunnel closed');
      return null;
    };
    return new Promise((resolve, reject) => {
      const check = (s: TunnelState) => {
        const r = settled(s);
        if (r === null) return false;
        if (r instanceof Error) reject(r);
        else resolve(r);
        return true;
      };
      if (check(this.current)) return;
      const off = this.onState((s) => {
        if (check(s)) off();
      });
    });
  }

  /** `rewriteTunnelHeaders` with the current ports (no-op when not connected). */
  rewriteHeaders(url: string, headers: Record<string, string>): Record<string, string> {
    return this.ports ? rewriteTunnelHeaders(url, headers, this.ports) : headers;
  }

  /**
   * For a network change or a wake from sleep. While connected: checks the
   * remote core at once and, if it does not answer, reconnects without
   * waiting for a second missed check (after a sleep the SSH connection is
   * often dead while ssh itself has not noticed yet). While reconnecting:
   * skips the wait before the next attempt. After `failed`: starts again only
   * when the error was one that a new attempt can fix (network, core); after a
   * refused host key ("Annulla"), a changed key or refused access it waits for
   * an explicit `retry()`, so no dialog comes back by itself.
   */
  reconnectNow(): void {
    if (this.closed) return;
    if (this.current.status === 'failed') {
      if (this.current.error.retryable) this.restart();
    } else if (this.current.status === 'connected') this.checkNow?.();
    else this.wake?.();
  }

  /**
   * Starts a new round of attempts after `failed`, with the backoff of a lost link: the
   * network or DNS that just came back may need a few seconds more (wake from sleep).
   */
  private restart(): void {
    this.clearSlowRetry();
    this.setState({ status: 'connecting' });
    this.loop = this.run(true);
  }

  private clearSlowRetry(): void {
    if (this.slowRetry) clearTimeout(this.slowRetry);
    this.slowRetry = null;
  }

  /** The user asked to try again ("Riprova", "Riconnetti"): also after any failure. */
  retry(): void {
    if (this.closed) return;
    this.clearSlowRetry();
    if (this.current.status === 'failed') this.loop = this.run(false);
    else this.reconnectNow();
  }

  /**
   * Reads a file of the remote data directory over SSH (same host key checks
   * and options as the tunnel): the setup code of a core never configured, or
   * the CLI token for the automatic login of the app (D-047). Null when the
   * file does not exist or ssh fails; the content is never logged here.
   */
  async readRemoteFile(file: RemoteHomeFile, timeoutMs = 10_000): Promise<string | null> {
    if (this.closed) return null;
    let sshPath: string;
    try {
      sshPath = this.sshPath();
    } catch {
      return null;
    }
    const res = await runCapture(
      sshPath,
      remoteFileArgs(this.profile, this.sshArgs, file),
      timeoutMs,
      {
        ...this.opts,
        signal: this.abort.signal,
      },
    );
    if (res.code !== 0 || res.timedOut) return null;
    const text = res.stdout.trim();
    return text === '' ? null : text;
  }

  /** Stops ssh (and its children), frees the local port and waits for ssh to exit. */
  async close(): Promise<void> {
    if (this.closed) {
      await this.loop;
      return;
    }
    this.closed = true;
    this.clearSlowRetry();
    this.abort.abort();
    this.wake?.();
    this.closeGate();
    await this.stopRunning();
    await this.closeProxy();
    if (this.socketDir) rmSync(this.socketDir, { recursive: true, force: true });
    this.setState({ status: 'closed' });
    // The loop may be waiting for confirmHostKey: it stops by itself afterwards.
    await Promise.race([
      this.loop,
      new Promise((r) => setTimeout(r, DEFAULTS.killGraceMs).unref()),
    ]);
  }

  private setState(s: TunnelState): void {
    if (this.current.status === 'closed' || (this.closed && s.status !== 'closed')) return;
    if (s.status !== 'connected') this.closeGate();
    this.current = s;
    this.ports =
      s.status === 'connected' ? { localPort: s.localPort, remotePort: s.remotePort } : null;
    for (const l of [...this.listeners]) {
      try {
        l(s);
      } catch {
        // a listener must not break the tunnel
      }
    }
  }

  /** A connection to the local listener: forwarded only while connected. */
  private onClient(client: Socket): void {
    const target = this.gate;
    if (target === null || this.closed) {
      client.destroy();
      return;
    }
    const upstream =
      target.kind === 'unix' ? connect(target.path) : connect(target.port, '127.0.0.1');
    this.piped.add(client);
    this.piped.add(upstream);
    const end = () => {
      client.destroy();
      upstream.destroy();
      this.piped.delete(client);
      this.piped.delete(upstream);
    };
    client.on('error', end).on('close', end);
    upstream.on('error', end).on('close', end);
    client.pipe(upstream);
    upstream.pipe(client);
  }

  /** No more forwarding: open connections end, new ones are refused. */
  private closeGate(): void {
    this.gate = null;
    for (const s of this.piped) s.destroy();
    this.piped.clear();
  }

  /** The local listener: bound once, on the first attempt, and kept until `close()`. */
  private async ensureProxy(remotePort: number): Promise<number> {
    if (this.proxy && this.boundPort !== undefined) return this.boundPort;
    const fixed = this.opts.localPort;
    const candidates =
      fixed !== undefined ? [fixed] : this.opts.preferSamePort ? [remotePort, 0] : [0];
    for (const port of candidates) {
      const server = createServer((socket) => this.onClient(socket));
      const bound = await listen(server, port);
      if (bound !== null) {
        if (this.closed) {
          server.close();
          break;
        }
        this.proxy = server;
        this.boundPort = bound;
        return bound;
      }
    }
    if (this.closed) throw new TunnelError('connection-lost', { message: 'tunnel closed' });
    throw new TunnelError('forward-failed', {
      detail: `127.0.0.1:${fixed ?? remotePort}: address already in use`,
    });
  }

  private async closeProxy(): Promise<void> {
    const server = this.proxy;
    this.proxy = null;
    if (!server) return;
    await Promise.race([
      new Promise<void>((r) => server.close(() => r())),
      new Promise((r) => setTimeout(r, DEFAULTS.killGraceMs).unref()),
    ]);
  }

  /** Where ssh will listen for this attempt (a new name each time). */
  private async newEndpoint(): Promise<Endpoint> {
    const platform = this.opts.platform ?? process.platform;
    const mode = this.opts.forward ?? (platform === 'win32' ? 'tcp' : 'unix');
    if (mode === 'unix') {
      if (this.socketDir === undefined) this.socketDir = makeSocketDir();
      if (this.socketDir !== null) {
        this.attempts += 1;
        return { kind: 'unix', path: join(this.socketDir, `t${this.attempts}.sock`) };
      }
    }
    // Windows (no Unix sockets in its OpenSSH): a port that only the proof makes trusted.
    return { kind: 'tcp', port: await pickLocalPort() };
  }

  private dropEndpoint(endpoint: Endpoint): void {
    if (endpoint.kind === 'unix') rmSync(endpoint.path, { force: true });
  }

  private async run(reconnecting: boolean): Promise<void> {
    const max = this.opts.reconnect?.maxAttempts ?? DEFAULTS.maxAttempts;
    let attempt = 0;
    let everConnected = reconnecting;
    if (!reconnecting) this.setState({ status: 'connecting' });
    while (!this.closed) {
      let error: TunnelError;
      try {
        const info = await this.connectOnce();
        if (this.closed) break;
        attempt = 0;
        everConnected = true;
        this.gate = this.running?.endpoint ?? null;
        this.setState({ status: 'connected', ...info });
        error = await this.watch();
      } catch (err) {
        error = toTunnelError(err);
        await this.stopRunning();
        if (this.closed) break;
        if (!everConnected || !error.retryable) {
          this.setState({ status: 'failed', error });
          this.armSlowRetry(error);
          return;
        }
      }
      if (this.closed) break;
      attempt += 1;
      if (attempt > max) {
        this.setState({ status: 'failed', error });
        this.armSlowRetry(error);
        return;
      }
      const delayMs = backoffDelay(
        attempt,
        this.opts.reconnect?.initialDelayMs ?? DEFAULTS.initialDelayMs,
        this.opts.reconnect?.maxDelayMs ?? DEFAULTS.maxDelayMs,
      );
      this.setState({ status: 'reconnecting', attempt, delayMs, error });
      await this.sleep(delayMs);
    }
  }

  /** A slow round of attempts later, for errors that time can fix (host down, no network). */
  private armSlowRetry(error: TunnelError): void {
    const ms = this.opts.reconnect?.slowRetryMs ?? DEFAULTS.slowRetryMs;
    if (ms <= 0 || !error.retryable || this.closed) return;
    this.clearSlowRetry();
    this.slowRetry = setTimeout(() => {
      this.slowRetry = null;
      if (!this.closed && this.current.status === 'failed') this.restart();
    }, ms);
    this.slowRetry.unref();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = () => {
        this.wake = null;
        done();
      };
    });
  }

  private sshPath(): string {
    const path = this.opts.sshPath ?? locateOpenSsh('ssh', this.opts);
    if (path === null) throw new TunnelError('ssh-missing');
    return path;
  }

  /** One attempt, with the host key confirmation in the middle if needed. */
  private async connectOnce(): Promise<ConnectedInfo> {
    let trusted = false;
    for (;;) {
      try {
        return await this.attempt();
      } catch (err) {
        const e = toTunnelError(err);
        if (e.kind !== 'host-key-unknown' || trusted || this.closed) throw e;
        await this.stopRunning();
        const info = await scanHostKeys(this.profile, {
          ...this.opts,
          sshPath: this.sshPath(),
          keyscanPath:
            this.opts.keyscanPath !== undefined
              ? this.opts.keyscanPath
              : locateOpenSsh('ssh-keyscan', this.opts),
          sshArgs: this.sshArgs,
          signal: this.abort.signal,
        });
        if (info === null) throw new TunnelError('host-key-scan-failed', { detail: e.detail });
        const ok = this.opts.confirmHostKey ? await this.opts.confirmHostKey(info) : false;
        if (!ok) throw new TunnelError('host-key-unknown', { detail: e.detail, hostKey: info });
        if (this.closed) throw e;
        trustHostKeys(this.knownHostsFile, info);
        trusted = true;
      }
    }
  }

  private async attempt(): Promise<ConnectedInfo> {
    const sshPath = this.sshPath();
    const deadline = Date.now() + (this.opts.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs);
    const remote = await discoverRemotePort(this.profile, {
      ...this.opts,
      sshPath,
      sshArgs: this.sshArgs,
      signal: this.abort.signal,
      timeoutMs: Math.max(1_000, deadline - Date.now()),
    });
    if (this.closed) throw new TunnelError('connection-lost', { message: 'tunnel closed' });
    // Without the key nothing could prove the far end: no ssh, no port.
    if (remote.proofKey === null) {
      throw remote.serverInfo
        ? new TunnelError('core-outdated', { detail: 'server.json without proofKey' })
        : new TunnelError('core-unreachable', {
            detail: 'no server.json in the remote data directory: the remote core is not running',
          });
    }
    const localPort = await this.ensureProxy(remote.port);
    const endpoint = await this.newEndpoint();
    const forwardEnd = endpoint.kind === 'unix' ? endpoint.path : endpoint.port;
    const running = this.start(
      sshPath,
      tunnelArgs(this.profile, this.sshArgs, forwardEnd, remote.port),
      endpoint,
    );
    const version = await this.waitHealthy(running, remote.proofKey, deadline);
    this.proofKey = remote.proofKey;
    return {
      localPort,
      remotePort: remote.port,
      remotePortSource: remote.source,
      url: `http://127.0.0.1:${localPort}`,
      coreVersion: version,
      originRewrite: localPort !== remote.port,
    };
  }

  private start(sshPath: string, args: string[], endpoint: Endpoint): Running {
    const stderr = new TailBuffer();
    const child = spawnGuarded(sshPath, args, this.opts);
    let exitCode: number | null | undefined;
    const running: Running = {
      child,
      endpoint,
      stderr,
      exited: new Promise<number | null>((resolve) => {
        child.once('exit', (code) => {
          exitCode = code;
          // At once, not when the health loop notices: nothing more goes to this end.
          if (this.gate === endpoint) this.closeGate();
          resolve(code);
        });
        child.once('error', (err: NodeJS.ErrnoException) => {
          stderr.push(`spawn error: ${err.code ?? err.message}\n`);
          exitCode = 127;
          if (this.gate === endpoint) this.closeGate();
          resolve(127);
        });
      }),
      hasExited: () => exitCode !== undefined,
    };
    child.stderr?.on('data', (d: Buffer) => stderr.push(d));
    // Writing to a stdin that the wrapper closed must not crash us.
    child.stdin?.on('error', () => {});
    this.running = running;
    return running;
  }

  private async stopRunning(): Promise<void> {
    const running = this.running;
    if (!running) return;
    this.running = null;
    if (this.gate === running.endpoint) this.closeGate();
    if (!running.hasExited()) {
      killTree(running.child, this.opts, 'SIGTERM');
      const timer = setTimeout(
        () => killTree(running.child, this.opts, 'SIGKILL'),
        DEFAULTS.killGraceMs,
      );
      await running.exited;
      clearTimeout(timer);
    }
    // Leftovers of the POSIX wrapper (the stdin watcher) share the group.
    reapLeftovers(running.child, this.opts);
    this.dropEndpoint(running.endpoint);
  }

  private failureOf(running: Running, code: number | null): TunnelError {
    const detail = running.stderr.toString();
    if (code === 127) return new TunnelError('ssh-missing', { detail });
    const kind: TunnelErrorKind = classifySshFailure(detail);
    return new TunnelError(kind === 'ssh-error' && detail === '' ? 'connection-lost' : kind, {
      detail,
    });
  }

  /**
   * Health of the remote core where ssh listens, with a fresh nonce: its version when
   * it answers with the right proof, `unproven` for a health answer without it,
   * `refused` when ssh does not listen yet (still connecting), `broken` when ssh
   * accepted but closed the connection (nothing on the remote port), `timeout` when no
   * answer came in time (network), `not-monsters` for any other answer.
   */
  private health(endpoint: Endpoint, key: string, timeoutMs: number): Promise<Health> {
    const nonce = newTunnelProofNonce();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (h: Health) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        req.destroy();
        resolve(h);
      };
      const req = httpRequest(
        {
          ...(endpoint.kind === 'unix'
            ? { socketPath: endpoint.path }
            : { host: '127.0.0.1', port: endpoint.port }),
          path: `/api/health?proof=${nonce}`,
          method: 'GET',
          agent: false,
          headers: { host: '127.0.0.1', accept: 'application/json' },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (d: string) => {
            body += d;
            if (body.length > DEFAULTS.maxHealthBody) finish('not-monsters');
          });
          res.on('error', () => finish('broken'));
          res.on('end', () => {
            const json = parseHealth(body);
            if (res.statusCode !== 200 || json?.ok !== true) return finish('not-monsters');
            if (!checkTunnelProof(key, nonce, json.proof)) return finish('unproven');
            finish({ version: typeof json.version === 'string' ? json.version : 'unknown' });
          });
        },
      );
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      req.on('error', (err: NodeJS.ErrnoException) =>
        finish(err.code === 'ECONNREFUSED' || err.code === 'ENOENT' ? 'refused' : 'broken'),
      );
      req.end();
    });
  }

  private async waitHealthy(running: Running, key: string, deadline: number): Promise<string> {
    let remoteFailures = 0;
    let unproven = false;
    while (!this.closed) {
      if (running.hasExited()) throw this.failureOf(running, await running.exited);
      const h = await this.health(
        running.endpoint,
        key,
        Math.max(500, Math.min(3_000, deadline - Date.now())),
      );
      if (typeof h === 'object') return h.version;
      if (h === 'unproven') unproven = true;
      if (h === 'broken' || h === 'not-monsters' || h === 'unproven') remoteFailures += 1;
      const remoteFailed = remoteFailures > 0;
      // A few refusals in a row from the remote end: no need to wait for the deadline.
      if (remoteFailures >= DEFAULTS.remoteFailuresBeforeGivingUp || Date.now() >= deadline) {
        const detail = running.stderr.toString();
        // The local end listens, so SSH is up: the remote port is the problem.
        const kind: TunnelErrorKind = unproven
          ? 'core-unverified'
          : remoteFailed || /open failed|connect failed/i.test(detail)
            ? 'core-unreachable'
            : 'unreachable';
        throw new TunnelError(kind, { detail });
      }
      const exited = await Promise.race([
        running.exited.then(() => true),
        new Promise<false>((r) => setTimeout(() => r(false), DEFAULTS.pollMs)),
      ]);
      if (exited) throw this.failureOf(running, await running.exited);
    }
    throw new TunnelError('connection-lost', { message: 'tunnel closed' });
  }

  /** While connected: resolves with the reason the tunnel went down. */
  private async watch(): Promise<TunnelError> {
    const running = this.running;
    const key = this.proofKey;
    if (!running || key === null) return new TunnelError('connection-lost');
    const interval = this.opts.healthIntervalMs ?? DEFAULTS.healthIntervalMs;
    const timeout = this.opts.healthTimeoutMs ?? DEFAULTS.healthTimeoutMs;
    running.stderr.clear();
    let failures = 0;
    for (;;) {
      let urgent = false;
      const exited = await Promise.race([
        running.exited.then(() => true),
        new Promise<false>((r) => {
          const timer = setTimeout(() => r(false), interval);
          this.checkNow = () => {
            clearTimeout(timer);
            urgent = true;
            r(false);
          };
        }),
      ]);
      this.checkNow = null;
      if (exited || this.closed) {
        const code = await running.exited;
        if (this.running === running) this.running = null;
        reapLeftovers(running.child, this.opts);
        this.dropEndpoint(running.endpoint);
        return this.failureOf(running, code);
      }
      const h = await this.health(running.endpoint, key, timeout);
      if (typeof h === 'object') {
        failures = 0;
        continue;
      }
      failures += 1;
      // A core that restarted has a new key: reconnecting reads it again.
      if (failures >= 2 || urgent || h === 'unproven') {
        const detail = running.stderr.toString();
        this.closeGate();
        await this.stopRunning();
        const kind: TunnelErrorKind =
          h === 'unproven'
            ? 'core-unverified'
            : h === 'not-monsters' || h === 'broken' || /open failed|connect failed/i.test(detail)
              ? 'core-unreachable'
              : 'connection-lost';
        return new TunnelError(kind, { detail });
      }
    }
  }
}

function parseHealth(body: string): { ok?: unknown; version?: unknown; proof?: unknown } | null {
  try {
    const json = JSON.parse(body) as unknown;
    return typeof json === 'object' && json !== null ? json : null;
  } catch {
    return null;
  }
}

function toTunnelError(err: unknown): TunnelError {
  if (err instanceof TunnelError) return err;
  return new TunnelError('ssh-error', {
    detail: err instanceof Error ? err.message : String(err),
    cause: err,
  });
}
