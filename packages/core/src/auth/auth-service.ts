import { readFileSync, rmSync } from 'node:fs';
import { ulid, type Channel } from '@monsters/shared';
import { writeSensitiveFile } from '../config.ts';
import type { Db } from '../db/sqlite.ts';
import { StateStore } from '../db/state-store.ts';
import type { EventLog } from '../log/event-log.ts';
import { hashPassword, verifyPassword } from './password.ts';
import {
  generateSetupCode,
  generateToken,
  hashToken,
  normaliseSetupCode,
  safeEqual,
} from './tokens.ts';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthContext {
  via: 'session' | 'token';
  /**
   * The user in person (review of 18/10, M1): a session opened with the password or by the
   * desktop app over its own channel. False for the CLI token, a file any process of the
   * user can read (a monster with the terminal too), and for the sessions opened with a
   * login token it asked for. Answering the brake, permissions, caps, the "Chiedi sempre"
   * rules, Telegram and the password need it.
   */
  owner: boolean;
  /** Null only for the CLI token before the local user has been created. */
  user: AuthUser | null;
  /** Hash of the session token, to close streams on logout. */
  sessionId?: string;
  /**
   * The user in person confirmed it recently (review of 18/10, residual risk of M1): the
   * password typed in this session less than `ownerRecentMs` ago, or a session the desktop
   * app opened over its own channel (the app's own core: its cookie never goes to disk). The
   * most sensitive changes need it (`RecentProof`, auth/recent.ts): a session left open for
   * days is not enough for them.
   */
  recent: boolean;
}

/**
 * What a cookie session shows besides the cookie (S-B13). Cookies do not tell ports apart: on
 * `127.0.0.1` every other local service the browser visits receives `monsters_session`. A
 * session opened in a browser is bound to a secret the UI keeps in its tab and sends in a
 * header (or in the first message of the WebSocket); the bytes of a file loaded by an `<img>`
 * or an `<iframe>` carry a short-lived ticket of the session and of that file instead.
 */
export interface SessionProof {
  secret?: string | undefined;
  ticket?: { value: string; resource: string } | undefined;
}

/** Why a cookie session was refused: `secret_required` when the cookie alone was presented. */
export type SessionCheck = AuthContext | 'secret_required' | null;

export interface Session {
  token: string;
  expiresAt: number;
  user: AuthUser;
  /**
   * Device token of the browser that logged in (new or confirmed): it gives the
   * browser its own login rate-limit bucket, so failures from other clients do
   * not lock it out.
   */
  deviceToken: string;
  /**
   * The secret the UI sends with every request of this session (S-B13); absent for a session
   * whose cookie lives in a jar of its own (the desktop app, D-044).
   */
  secret?: string;
}

export class AuthError extends Error {
  readonly code: 'already_configured' | 'too_many_attempts' | 'no_account';
  /** For `too_many_attempts`: how long to wait before the next attempt. */
  readonly retryAfterMs: number;
  constructor(code: AuthError['code'], message: string, retryAfterMs = 0) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface AuthServiceOptions {
  sessionTtlMs: number;
  cliTokenPath: string;
  now?: () => number;
  /** Login attempts allowed in a burst before the backoff starts (default 5). */
  loginBurst?: number;
  /** First backoff delay; it doubles at every further failure (default 1 s). */
  loginBackoffBaseMs?: number;
  /** Longest wait imposed between two attempts (default 60 s). */
  loginBackoffMaxMs?: number;
  /** Failures older than this are forgotten (default 15 min). */
  failedLoginWindowMs?: number;
  /** How long the password typed in a session counts as recent (default 15 min). */
  ownerRecentMs?: number;
}

/** Options of a login attempt. */
export interface LoginOptions {
  channel?: Channel;
  /** Device token presented by the client (cookie), if any. */
  deviceToken?: string | undefined;
  /**
   * The client keeps the cookie in a jar no other site shares (the desktop app, one session
   * per destination, D-044): the session is not bound to a secret (S-B13).
   */
  partitioned?: boolean | undefined;
}

export const CLI_TOKEN_NAME = 'cli';

/** Lifetime of a single-use login token of the desktop app (D-045). */
export const LOGIN_TOKEN_TTL_MS = 60_000;
/** How long the password typed in a session counts as recent (`AuthContext.recent`). */
export const OWNER_RECENT_MS = 15 * 60_000;
/** Lifetime of a ticket for the bytes of a file (S-B13). */
export const FILE_TICKET_TTL_MS = 2 * 60_000;
/** Requests a ticket answers: an `<img>` or an `<iframe>` mounted again within its lifetime. */
export const FILE_TICKET_USES = 16;
/**
 * The ticket of the thumbnails of a session: one for every file (`THUMBS_TICKET_RESOURCE`), so
 * a list of hundreds of them asks one ticket, not one each (review of 19/10, n. 14). As many
 * requests as a long list loads in its two minutes.
 */
export const THUMBS_TICKET_RESOURCE = 'file:*:thumb';
export const THUMBS_TICKET_USES = 2048;
const THUMB_RESOURCE = /^file:[A-Za-z0-9_-]{1,100}:thumb$/;
/** Tickets alive at once for a session, and for all of them: one more drops the oldest. */
const MAX_FILE_TICKETS_PER_SESSION = 256;
const MAX_FILE_TICKETS = 4096;
/** Login tokens alive at once: issuing one more drops the oldest. */
const MAX_LOGIN_TOKENS = 4;
/** Rate-limit bucket of the login-token exchange, apart from the password logins. */
const LOGIN_TOKEN_BUCKET = 'login-token';

/** A session opened without a password (desktop app), without a device cookie. */
export type TokenSession = Omit<Session, 'deviceToken'>;

const DEVICES_KEY = 'auth.devices';
/** Rate-limit bucket of the password changes (wrong current password). */
const PASSWORD_BUCKET = 'password';
const MAX_DEVICES = 20;
const GLOBAL_BUCKET = 'global';

interface SessionRow {
  user_id: string;
  email: string;
  expires_at: number;
  limited: number;
  secret_hash: string | null;
  confirmed_at: number | null;
  bridge: number;
}

/** How a new session is opened. */
interface NewSession {
  /** Opened with a login token the CLI token asked for (not the user in person). */
  limited?: boolean;
  /** Opened by the desktop app over its own channel (the app's own core). */
  bridge?: boolean;
  /** Bound to a secret of the UI (a browser): see `SessionProof`. */
  bound?: boolean;
  /** The password was just typed. */
  confirmed?: boolean;
}

interface FileTicket {
  hash: string;
  sessionId: string;
  resource: string;
  expiresAt: number;
  uses: number;
}

interface DeviceRecord {
  hash: string;
  createdAt: number;
  lastUsedAt: number;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
}

/**
 * Single local user (email + argon2id password), cookie sessions and the CLI
 * token. Tokens and sessions are stored as SHA-256 hashes.
 */
export class AuthService {
  readonly #db: Db;
  readonly #log: EventLog;
  readonly #state: StateStore;
  readonly #opts: Required<Omit<AuthServiceOptions, 'now'>>;
  readonly #now: () => number;
  /** Attempt timestamps per rate-limit bucket (device hash or global). */
  readonly #attempts = new Map<string, number[]>();
  #setupCode: string | null = null;
  #dummyHash: Promise<string> | undefined;
  /**
   * Hashes of the outstanding single-use login tokens (memory only: a restart voids them).
   * `limited`: asked with the CLI token, so the session it opens is not the user in person.
   */
  #loginTokens: { hash: string; expiresAt: number; limited: boolean }[] = [];
  /** Tickets for the bytes of a file (memory only, short-lived; S-B13). */
  #tickets: FileTicket[] = [];

  constructor(db: Db, log: EventLog, options: AuthServiceOptions) {
    this.#db = db;
    this.#log = log;
    this.#state = new StateStore(db);
    this.#now = options.now ?? Date.now;
    this.#opts = {
      sessionTtlMs: options.sessionTtlMs,
      cliTokenPath: options.cliTokenPath,
      loginBurst: options.loginBurst ?? 5,
      loginBackoffBaseMs: options.loginBackoffBaseMs ?? 1000,
      loginBackoffMaxMs: options.loginBackoffMaxMs ?? 60_000,
      failedLoginWindowMs: options.failedLoginWindowMs ?? 15 * 60 * 1000,
      ownerRecentMs: options.ownerRecentMs ?? OWNER_RECENT_MS,
    };
  }

  /**
   * The sessions the desktop app opened from its own channel (`bridge`, always recent) live as
   * long as the core that opened them: the app asks a new one at every start of the core (its
   * cookie is never on disk), so one left from a previous start, a copy of the cookie taken
   * from the app's memory included, does not stay recent for its whole week (review of 19/10).
   * Called at the start of the core. Returns the sessions closed.
   */
  closeBridgeSessions(): number {
    return this.#db.run('DELETE FROM sessions WHERE bridge = 1').changes;
  }

  needsSetup(): boolean {
    return !this.#db.get('SELECT 1 AS x FROM users LIMIT 1');
  }

  /**
   * Issues the one-time code required by `POST /api/setup` (printed by
   * `monsters start`), so that no other local process can create the account
   * first. Returns null if the user already exists.
   */
  issueSetupCode(): string | null {
    if (!this.needsSetup()) {
      this.#setupCode = null;
      return null;
    }
    this.#setupCode = generateSetupCode();
    return this.#setupCode;
  }

  /** True if `code` matches the current setup code (constant-time). */
  checkSetupCode(code: string | undefined): boolean {
    if (this.#setupCode === null || code === undefined) return false;
    return safeEqual(normaliseSetupCode(code), normaliseSetupCode(this.#setupCode));
  }

  /** Creates the local user. Fails if one already exists. Returns a new session. */
  async setup(
    email: string,
    password: string,
    channel: Channel = 'ui',
    options: { partitioned?: boolean | undefined } = {},
  ): Promise<Session> {
    if (!this.needsSetup()) throw new AuthError('already_configured', 'user already exists');
    const passwordHash = await hashPassword(password);
    const id = ulid();
    // Atomic: concurrent setups cannot create two users.
    const result = this.#db.run(
      `INSERT INTO users (id, email, password_hash, created_at)
       SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
      id,
      email.trim(),
      passwordHash,
      this.#now(),
    );
    if (result.changes === 0) throw new AuthError('already_configured', 'user already exists');
    this.#setupCode = null;
    this.#log.append({ agent: 'system', type: 'auth', data: { action: 'setup', channel } });
    return this.#createSession({ id, email: email.trim() }, undefined, options.partitioned);
  }

  /**
   * Verifies credentials and opens a session; null on wrong credentials.
   *
   * Rate limit: each attempt is reserved (counted) before argon2 runs, so
   * parallel requests cannot all pass the check. After `loginBurst` attempts
   * every further one waits an exponential backoff (capped). A browser with a
   * valid device token has its own bucket: failures from other clients do not
   * lock it out. Throws `AuthError('too_many_attempts')` while backing off.
   */
  async login(
    email: string,
    password: string,
    options: LoginOptions | Channel = {},
  ): Promise<Session | null> {
    const opts: LoginOptions = typeof options === 'string' ? { channel: options } : options;
    const channel = opts.channel ?? 'ui';
    const device = this.#findDevice(opts.deviceToken);
    const bucket = device ? `device:${device.hash}` : GLOBAL_BUCKET;
    this.#reserveAttempt(bucket);

    const row = this.#db.get<UserRow>(
      'SELECT id, email, password_hash FROM users WHERE email = ?',
      email.trim(),
    );
    // Verify against a dummy hash when the user does not exist: same timing.
    const ok = row
      ? await verifyPassword(row.password_hash, password)
      : (await verifyPassword(await this.#getDummyHash(), password)) && false;
    if (!row || !ok) {
      this.#log.append({
        agent: 'system',
        type: 'auth',
        data: { action: 'login_failed', channel },
      });
      return null;
    }
    this.#attempts.delete(bucket);
    this.#log.append({ agent: 'system', type: 'auth', data: { action: 'login', channel } });
    return this.#createSession(
      { id: row.id, email: row.email },
      opts.deviceToken,
      opts.partitioned,
    );
  }

  /** Milliseconds to wait before a bucket may try again (0 = now). */
  #waitMs(attempts: number[], now: number): number {
    const n = attempts.length;
    if (n < this.#opts.loginBurst) return 0;
    const exp = Math.min(n - this.#opts.loginBurst, 30);
    const delay = Math.min(this.#opts.loginBackoffMaxMs, this.#opts.loginBackoffBaseMs * 2 ** exp);
    const last = attempts[n - 1] ?? 0;
    return Math.max(0, last + delay - now);
  }

  /** Counts an attempt before verifying it; synchronous, hence atomic. */
  #reserveAttempt(bucket: string): void {
    const now = this.#now();
    const window = this.#opts.failedLoginWindowMs;
    const attempts = (this.#attempts.get(bucket) ?? []).filter((t) => now - t < window);
    const wait = this.#waitMs(attempts, now);
    if (wait > 0) {
      this.#attempts.set(bucket, attempts);
      throw new AuthError('too_many_attempts', 'too many failed logins, retry later', wait);
    }
    attempts.push(now);
    this.#attempts.set(bucket, attempts);
  }

  #devices(): DeviceRecord[] {
    return this.#state.get<DeviceRecord[]>(DEVICES_KEY) ?? [];
  }

  #findDevice(token: string | undefined): DeviceRecord | undefined {
    if (!token) return undefined;
    const hash = hashToken(token);
    return this.#devices().find((d) => safeEqual(d.hash, hash));
  }

  /** Confirms the presented device token or issues a new one. */
  #rememberDevice(token: string | undefined): string {
    const now = this.#now();
    const devices = this.#devices();
    const known = token ? this.#findDevice(token) : undefined;
    const value = known && token ? token : generateToken();
    const hash = hashToken(value);
    const next = devices.filter((d) => d.hash !== hash);
    next.push({ hash, createdAt: known?.createdAt ?? now, lastUsedAt: now });
    next.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    this.#state.set(DEVICES_KEY, next.slice(0, MAX_DEVICES));
    return value;
  }

  logout(token: string, channel: Channel = 'ui'): boolean {
    const result = this.#db.run('DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
    if (result.changes > 0) {
      this.#log.append({ agent: 'system', type: 'auth', data: { action: 'logout', channel } });
    }
    return result.changes > 0;
  }

  /**
   * Resolves a session cookie value; expired sessions are deleted. A session bound to a secret
   * (S-B13) needs `proof`: the secret, or a ticket of this session for `proof.ticket.resource`.
   */
  authenticateSession(token: string | undefined, proof: SessionProof = {}): AuthContext | null {
    const ctx = this.checkSession(token, proof);
    return ctx === 'secret_required' ? null : ctx;
  }

  /** Like `authenticateSession`, telling a cookie presented without its secret apart. */
  checkSession(token: string | undefined, proof: SessionProof = {}): SessionCheck {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = this.#db.get<SessionRow>(
      `SELECT s.user_id, u.email, s.expires_at, s.limited, s.secret_hash, s.confirmed_at, s.bridge
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
      tokenHash,
    );
    if (!row) return null;
    const now = this.#now();
    if (row.expires_at <= now) {
      this.#db.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
      return null;
    }
    if (row.secret_hash !== null && !this.#proves(row.secret_hash, tokenHash, proof, now)) {
      return 'secret_required';
    }
    this.#db.run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', now, tokenHash);
    const owner = row.limited === 0;
    return {
      via: 'session',
      owner,
      recent:
        owner &&
        (row.bridge === 1 ||
          (row.confirmed_at !== null && now - row.confirmed_at < this.#opts.ownerRecentMs)),
      user: { id: row.user_id, email: row.email },
      sessionId: tokenHash,
    };
  }

  /** The secret of the session, or a live ticket of it for that resource (spends one use). */
  #proves(secretHash: string, sessionId: string, proof: SessionProof, now: number): boolean {
    if (proof.secret !== undefined && proof.secret !== '') {
      return safeEqual(hashToken(proof.secret), secretHash);
    }
    if (!proof.ticket) return false;
    const hash = hashToken(proof.ticket.value);
    this.#tickets = this.#tickets.filter((t) => t.expiresAt > now && t.uses > 0);
    const ticket = this.#tickets.find((t) => safeEqual(t.hash, hash));
    const wanted = proof.ticket.resource;
    const covers =
      ticket?.resource === wanted ||
      (ticket?.resource === THUMBS_TICKET_RESOURCE && THUMB_RESOURCE.test(wanted));
    if (!ticket || ticket.sessionId !== sessionId || !covers) return false;
    ticket.uses--;
    return true;
  }

  /**
   * A ticket for one resource of a session (the bytes of a file, `file:<id>:<part>`, or the
   * thumbnails of every file, `THUMBS_TICKET_RESOURCE`): good for `FILE_TICKET_TTL_MS` and
   * `FILE_TICKET_USES` requests (`THUMBS_TICKET_USES` for the thumbnails), with the session
   * cookie (S-B13). Each session has a pool of its own: another session's tickets never push
   * its own out.
   */
  issueFileTicket(sessionId: string, resource: string): { ticket: string; expiresAt: number } {
    const now = this.#now();
    const ticket = generateToken();
    const expiresAt = now + FILE_TICKET_TTL_MS;
    let live = this.#tickets.filter((t) => t.expiresAt > now && t.uses > 0);
    const mine = live.filter((t) => t.sessionId === sessionId);
    if (mine.length >= MAX_FILE_TICKETS_PER_SESSION) {
      const drop = new Set(mine.slice(0, mine.length - MAX_FILE_TICKETS_PER_SESSION + 1));
      live = live.filter((t) => !drop.has(t));
    }
    live.push({
      hash: hashToken(ticket),
      sessionId,
      resource,
      expiresAt,
      uses: resource === THUMBS_TICKET_RESOURCE ? THUMBS_TICKET_USES : FILE_TICKET_USES,
    });
    this.#tickets = live.slice(-MAX_FILE_TICKETS);
    return { ticket, expiresAt };
  }

  /**
   * "Conferma che sei tu": the password typed again in this session (`sessionId`, hash of its
   * token) makes it the user's in person and recent (`AuthContext.recent`). False for a wrong
   * password. Rate-limited like the password changes; throws `AuthError('too_many_attempts')`.
   */
  async confirm(sessionId: string, password: string, channel: Channel = 'ui'): Promise<boolean> {
    this.#reserveAttempt(PASSWORD_BUCKET);
    const row = this.#db.get<UserRow>('SELECT id, email, password_hash FROM users LIMIT 1');
    if (!row || !(await verifyPassword(row.password_hash, password))) {
      this.#log.append({
        agent: 'system',
        type: 'auth',
        data: { action: 'confirm_failed', channel },
      });
      return false;
    }
    this.#attempts.delete(PASSWORD_BUCKET);
    this.#db.run(
      'UPDATE sessions SET limited = 0, confirmed_at = ? WHERE token_hash = ?',
      this.#now(),
      sessionId,
    );
    this.#log.append({ agent: 'system', type: 'auth', data: { action: 'confirmed', channel } });
    return true;
  }

  /** Resolves an API token (`Authorization: Bearer`), e.g. the CLI token. */
  authenticateToken(token: string | undefined): AuthContext | null {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = this.#db.get<{ name: string }>(
      'SELECT name FROM api_tokens WHERE token_hash = ?',
      tokenHash,
    );
    if (!row) return null;
    this.#db.run('UPDATE api_tokens SET last_used_at = ? WHERE name = ?', this.#now(), row.name);
    const user = this.#db.get<AuthUser>('SELECT id, email FROM users LIMIT 1') ?? null;
    return { via: 'token', owner: false, recent: false, user };
  }

  /**
   * Issues a new CLI token (invalidating the previous one) and writes it to
   * `cli-token` with mode 600. Called at every start of the core.
   */
  issueCliToken(): string {
    const token = generateToken();
    this.#db.run(
      `INSERT INTO api_tokens (name, token_hash, created_at) VALUES (?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET token_hash = excluded.token_hash,
         created_at = excluded.created_at, last_used_at = NULL`,
      CLI_TOKEN_NAME,
      hashToken(token),
      this.#now(),
    );
    writeSensitiveFile(this.#opts.cliTokenPath, `${token}\n`);
    this.#log.append({ agent: 'system', type: 'auth', data: { action: 'cli_token_issued' } });
    return token;
  }

  /** Revokes the CLI token and deletes its file (clean shutdown of the core). */
  revokeCliToken(): void {
    this.#db.run('DELETE FROM api_tokens WHERE name = ?', CLI_TOKEN_NAME);
    rmSync(this.#opts.cliTokenPath, { force: true });
  }

  /**
   * Issues a single-use login token for the desktop app (D-045): exchanged once, within
   * `ttlMs`, at `POST /api/login/exchange` for a session cookie. Kept hashed in memory only;
   * at most a few are alive at once. One asked with the CLI token (`by: 'cli'`, a core
   * started from the terminal or reached over SSH) opens a limited session: the password
   * makes it the user's in person (review of 18/10, M1).
   */
  issueLoginToken(by: Channel, ttlMs = LOGIN_TOKEN_TTL_MS): { token: string; expiresAt: number } {
    const now = this.#now();
    const token = generateToken();
    const expiresAt = now + ttlMs;
    this.#loginTokens = this.#loginTokens.filter((t) => t.expiresAt > now);
    this.#loginTokens.push({ hash: hashToken(token), expiresAt, limited: by === 'cli' });
    this.#loginTokens = this.#loginTokens.slice(-MAX_LOGIN_TOKENS);
    this.#log.append({
      agent: 'system',
      type: 'auth',
      data: { action: 'login_token_issued', channel: by },
    });
    return { token, expiresAt };
  }

  /**
   * Exchanges a login token for a session. The token is spent on a match (single use), even
   * when no account exists yet (`needs_setup`); null for an unknown or expired token.
   * Rate-limited like the password logins, in a bucket of its own; throws
   * `AuthError('too_many_attempts')` while backing off.
   */
  consumeLoginToken(token: string): TokenSession | 'needs_setup' | null {
    this.#reserveAttempt(LOGIN_TOKEN_BUCKET);
    const now = this.#now();
    const hash = hashToken(token);
    let match = -1;
    // Constant time over every outstanding token, no early exit.
    this.#loginTokens.forEach((t, i) => {
      if (safeEqual(t.hash, hash) && t.expiresAt > now) match = i;
    });
    const limited = match >= 0 && this.#loginTokens[match]!.limited;
    this.#loginTokens = this.#loginTokens.filter((t, i) => i !== match && t.expiresAt > now);
    const user =
      match >= 0 ? (this.#db.get<AuthUser>('SELECT id, email FROM users LIMIT 1') ?? null) : null;
    if (match < 0 || !user) {
      this.#log.append({
        agent: 'system',
        type: 'auth',
        data: { action: 'login_token_failed', channel: 'desktop' },
      });
      return match < 0 ? null : 'needs_setup';
    }
    this.#attempts.delete(LOGIN_TOKEN_BUCKET);
    this.#log.append({
      agent: 'system',
      type: 'auth',
      data: { action: 'login_token', channel: 'desktop' },
    });
    // From the desktop app's own channel (not the CLI token): the user in person, and recent
    // (its cookie never goes to disk, a new one at every start). Never bound to a secret: the
    // app keeps the cookie in a session of its own (D-044).
    return this.#insertSession(user, { limited, bridge: !limited });
  }

  /**
   * Changes the password after checking the current one (Settings → Account).
   * Rate-limited like the logins, in a bucket of its own. Every other session is
   * closed; `keepSession` (hash of the caller's session) stays. Returns the
   * hashes of the closed sessions, or null for a wrong current password.
   * Throws `AuthError('too_many_attempts')` while backing off.
   */
  async changePassword(
    current: string,
    next: string,
    options: { keepSession?: string | undefined; channel?: Channel } = {},
  ): Promise<string[] | null> {
    const channel = options.channel ?? 'ui';
    this.#reserveAttempt(PASSWORD_BUCKET);
    const row = this.#db.get<UserRow>('SELECT id, email, password_hash FROM users LIMIT 1');
    if (!row || !(await verifyPassword(row.password_hash, current))) {
      this.#log.append({
        agent: 'system',
        type: 'auth',
        data: { action: 'password_change_failed', channel },
      });
      return null;
    }
    this.#attempts.delete(PASSWORD_BUCKET);
    const closed = await this.#setPassword(row.id, next, options.keepSession);
    // The current password was just typed: the session that changed it is recent.
    if (options.keepSession) {
      this.#db.run(
        'UPDATE sessions SET confirmed_at = ? WHERE token_hash = ?',
        this.#now(),
        options.keepSession,
      );
    }
    this.#log.append({
      agent: 'system',
      type: 'auth',
      data: { action: 'password_changed', channel },
    });
    return closed;
  }

  /**
   * Sets a new password without the old one: `monsters password` on the
   * computer of the core (access to the data folder is the proof). Closes every
   * session and forgets the failed logins. Returns the closed session hashes.
   */
  async resetPassword(next: string, channel: Channel = 'cli'): Promise<string[]> {
    const row = this.#db.get<{ id: string }>('SELECT id FROM users LIMIT 1');
    if (!row) throw new AuthError('no_account', 'no local user yet');
    const closed = await this.#setPassword(row.id, next, undefined);
    this.#attempts.clear();
    this.#log.append({
      agent: 'system',
      type: 'auth',
      data: { action: 'password_reset', channel },
    });
    return closed;
  }

  async #setPassword(userId: string, next: string, keep: string | undefined): Promise<string[]> {
    const hash = await hashPassword(next);
    this.#db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, userId);
    const sessions = this.#db
      .all<{ token_hash: string }>('SELECT token_hash FROM sessions WHERE user_id = ?', userId)
      .map((r) => r.token_hash)
      .filter((h) => h !== keep);
    for (const h of sessions) this.#db.run('DELETE FROM sessions WHERE token_hash = ?', h);
    return sessions;
  }

  /** Deletes expired sessions. */
  purgeExpiredSessions(): number {
    return this.#db.run('DELETE FROM sessions WHERE expires_at <= ?', this.#now()).changes;
  }

  #createSession(
    user: AuthUser,
    deviceToken: string | undefined,
    partitioned: boolean | undefined,
  ): Session {
    // The password was just typed; a browser's session is bound to a secret (S-B13).
    const session = this.#insertSession(user, { confirmed: true, bound: partitioned !== true });
    return { ...session, deviceToken: this.#rememberDevice(deviceToken) };
  }

  #insertSession(user: AuthUser, how: NewSession = {}): TokenSession {
    const token = generateToken();
    const secret = how.bound ? generateToken() : undefined;
    const now = this.#now();
    const expiresAt = now + this.#opts.sessionTtlMs;
    this.#db.run(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, limited,
         secret_hash, confirmed_at, bridge) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      hashToken(token),
      user.id,
      now,
      expiresAt,
      now,
      how.limited ? 1 : 0,
      secret !== undefined ? hashToken(secret) : null,
      how.confirmed ? now : null,
      how.bridge ? 1 : 0,
    );
    return { token, expiresAt, user, ...(secret !== undefined ? { secret } : {}) };
  }

  #getDummyHash(): Promise<string> {
    this.#dummyHash ??= hashPassword(generateToken());
    return this.#dummyHash;
  }
}

/** Reads the CLI token written by the core. */
export function readCliToken(path: string): string {
  return readFileSync(path, 'utf8').trim();
}
