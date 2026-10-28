import { tunnelStrings } from './errors.strings.ts';
import type { HostKeyInfo } from './host-keys.ts';
import { StringDecoder } from 'node:string_decoder';

export type TunnelErrorKind =
  /** No `ssh` binary on this computer. */
  | 'ssh-missing'
  /** First connection: the host key must be confirmed by the user. */
  | 'host-key-unknown'
  /** The host key differs from the trusted one: possible man in the middle. */
  | 'host-key-changed'
  /** The fingerprint of an unknown host could not be read (e.g. behind ProxyJump). */
  | 'host-key-scan-failed'
  /** Key or agent refused (no password prompts in the MVP). */
  | 'auth-failed'
  | 'host-not-found'
  /** Connection refused, timed out, no route. */
  | 'unreachable'
  /** An established connection dropped (network, sleep, server restarted). */
  | 'connection-lost'
  /** The local end of the tunnel could not listen (port taken meanwhile). */
  | 'forward-failed'
  /** SSH works but no Monsters core answers on the remote port. */
  | 'core-unreachable'
  /** Something answers on the remote port but cannot prove it is the core of server.json. */
  | 'core-unverified'
  /** The remote core is too old to prove who it is (no key in its server.json). */
  | 'core-outdated'
  /** The SSH server does not allow port forwarding (AllowTcpForwarding no). */
  | 'forwarding-disabled'
  | 'ssh-error';

/** Kinds that a new attempt can fix by itself (network, sleep, restarts). */
const RETRYABLE = new Set<TunnelErrorKind>([
  'host-not-found',
  'unreachable',
  'connection-lost',
  'forward-failed',
  'core-unreachable',
  // A core that restarted between reading server.json and the check: the next attempt reads it again.
  'core-unverified',
  'ssh-error',
]);

export class TunnelError extends Error {
  readonly kind: TunnelErrorKind;
  /** Last lines printed by ssh, for the "details" of the UI and the logs. */
  readonly detail: string;
  readonly retryable: boolean;
  /** For `host-key-unknown`: the keys to show and, once confirmed, to trust. */
  readonly hostKey: HostKeyInfo | undefined;

  constructor(
    kind: TunnelErrorKind,
    options: { detail?: string; message?: string; hostKey?: HostKeyInfo; cause?: unknown } = {},
  ) {
    super(options.message ?? messageFor(kind), { cause: options.cause });
    this.name = 'TunnelError';
    this.kind = kind;
    this.detail = options.detail ?? '';
    this.retryable = RETRYABLE.has(kind);
    this.hostKey = options.hostKey;
  }
}

/** The text for the user, in the app's language. */
export function messageFor(kind: TunnelErrorKind): string {
  return tunnelStrings()[kind];
}

const PATTERNS: [RegExp, TunnelErrorKind][] = [
  [/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key for .* has changed/i, 'host-key-changed'],
  [/No \S+ host key is known for|Host key verification failed/i, 'host-key-unknown'],
  [
    /Permission denied \(|Too many authentication failures|no more authentication methods/i,
    'auth-failed',
  ],
  [/Could not resolve hostname|Name or service not known|nodename nor servname/i, 'host-not-found'],
  [
    /Could not request local forwarding|cannot listen to port|bind \[?[^\]]*\]?:\d+: Address already in use/i,
    'forward-failed',
  ],
  [/administratively prohibited/i, 'forwarding-disabled'],
  // ssh is up but the remote port refused: `channel 2: open failed: connect failed: …`
  [/open failed: connect failed|channel \d+: open failed/i, 'core-unreachable'],
  [
    /Connection refused|Connection timed out|Operation timed out|No route to host|Network is unreachable|Host is down|connect to host .* port \d+:/i,
    'unreachable',
  ],
  [
    /Timeout, server .* not responding|Connection closed by|Connection reset|Broken pipe|client_loop: send disconnect|Connection to .* closed/i,
    'connection-lost',
  ],
];

/**
 * Turns the stderr of a failed `ssh` run into an error kind. The order matters:
 * a changed host key also prints "Host key verification failed".
 */
export function classifySshFailure(stderr: string): TunnelErrorKind {
  for (const [re, kind] of PATTERNS) if (re.test(stderr)) return kind;
  return 'ssh-error';
}

/** Keeps the last `max` characters of what a process printed. */
export class TailBuffer {
  private text = '';
  private readonly decoder = new StringDecoder('utf8');
  private readonly max: number;
  constructor(max = 8192) {
    this.max = max;
  }
  push(chunk: string | Buffer): void {
    // Bytes are decoded as a stream: a character cut between two chunks stays whole.
    this.text += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    if (this.text.length > this.max) this.text = this.text.slice(-this.max);
  }
  clear(): void {
    this.text = '';
  }
  toString(): string {
    return this.text.trim();
  }
}
