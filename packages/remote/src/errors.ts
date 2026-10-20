import type { HostKeyInfo } from './host-keys.ts';

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

const MESSAGES: Record<TunnelErrorKind, string> = {
  'ssh-missing':
    'Non trovo il comando ssh su questo computer. Su Windows installa "Client OpenSSH" da ' +
    'Impostazioni → Sistema → Funzionalità facoltative; su Linux il pacchetto openssh-client.',
  'host-key-unknown':
    "È la prima connessione a questo computer: controlla che l'impronta della sua chiave sia quella giusta " +
    'prima di fidarti.',
  'host-key-changed':
    'La chiave del computer remoto è cambiata rispetto a quella che conosci. Potrebbe essere stato ' +
    'reinstallato, ma anche qualcuno che si mette in mezzo: Monsters non si collega. Verifica con chi ' +
    'gestisce quel computer e, se il cambio è legittimo, togli la vecchia chiave dal file known_hosts.',
  'host-key-scan-failed':
    'Non riesco a leggere la chiave del computer remoto per fartela confermare. Collegati una volta da ' +
    'un terminale con "ssh" e accetta lì la chiave, poi riprova.',
  'auth-failed':
    "Il computer remoto ha rifiutato l'accesso. Monsters usa solo chiavi SSH (niente password): " +
    'controlla utente e chiave, e che la chiave pubblica sia in ~/.ssh/authorized_keys sul computer remoto.',
  'host-not-found':
    "Non trovo questo computer in rete: controlla il nome o l'indirizzo (e la VPN, se la usi).",
  unreachable:
    'Il computer remoto non risponde: è acceso e raggiungibile? Controlla indirizzo, porta SSH e VPN.',
  'connection-lost': 'La connessione con il computer remoto si è interrotta.',
  'forward-failed': 'Non riesco ad aprire la porta locale del tunnel.',
  'core-unreachable':
    'Il collegamento SSH funziona, ma Monsters non risponde sul computer remoto: è acceso? ' +
    '(sul computer remoto: "monsters start")',
  'core-unverified':
    'Sul computer remoto, alla porta di Monsters, risponde qualcosa che non dimostra di essere il tuo ' +
    'Monsters: non mi collego. Se il motore remoto si è appena riavviato basta riprovare; altrimenti ' +
    'controlla sul computer remoto chi usa quella porta.',
  'core-outdated':
    'Monsters sul computer remoto è di una versione troppo vecchia per collegarsi in modo sicuro: ' +
    'aggiornalo e riavvialo, poi riprova.',
  'forwarding-disabled':
    'Il server SSH del computer remoto non permette i tunnel: in /etc/ssh/sshd_config serve ' +
    '"AllowTcpForwarding local" (o "yes") per il tuo utente.',
  'ssh-error': 'Il collegamento SSH non è riuscito.',
};

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
    super(options.message ?? MESSAGES[kind], { cause: options.cause });
    this.name = 'TunnelError';
    this.kind = kind;
    this.detail = options.detail ?? '';
    this.retryable = RETRYABLE.has(kind);
    this.hostKey = options.hostKey;
  }
}

export function messageFor(kind: TunnelErrorKind): string {
  return MESSAGES[kind];
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
  private readonly max: number;
  constructor(max = 8192) {
    this.max = max;
  }
  push(chunk: string | Buffer): void {
    this.text += chunk.toString();
    if (this.text.length > this.max) this.text = this.text.slice(-this.max);
  }
  clear(): void {
    this.text = '';
  }
  toString(): string {
    return this.text.trim();
  }
}
