import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify as verifySignature,
  type JsonWebKey,
} from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { netCause, netFailureOf, netHint, type NetFailure } from '@monsters/shared';
import { providerTexts } from '../providers.strings.ts';

/*
 * Sign in with ChatGPT for open-source local apps (D-005, research 06 §2.1),
 * written from OpenAI's public documentation (developers.openai.com/siwc,
 * token-sharing-open-source/*). No code from the SIWC DevKit (non-commercial
 * license) is used or copied.
 *
 * - Authorization Code + PKCE (S256), loopback callback on 127.0.0.1 (never
 *   `localhost`): port 1455 when free, any port otherwise (only the port may
 *   vary between sign-ins).
 * - First sign-in registers dynamically: `client_id=dynamic_agent_client`,
 *   `agent_name_hint=Monsters`, a persistent opaque `ext_agent_host_id`
 *   (`urn:uuid:…`). The callback carries the issued `oaiapp_…` client id,
 *   saved and reused for later sign-ins (with `id_token_hint`/`login_hint`).
 * - The ID token is verified against OpenAI's JWKS (RS256, issuer, audience,
 *   expiry, nonce); `chatgpt.tokens.use.direct` must be granted.
 * - Refresh near expiry, one at a time (the refresh token rotates); terminal
 *   refresh errors sign the user out, temporary failures keep the tokens.
 * - A request that could not even leave (no name, no route, refused, TLS or
 *   proxy refused) is tried again twice (2 s, then 5 s): right after the
 *   computer wakes up the network takes a moment to come back. Its error
 *   carries the classified cause (`network`), for the user's words.
 * - Tokens live in a 0600 file through `CredentialStore`, never in the log.
 */

export const SIWC_SCOPE =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const SIWC_DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
export const SIWC_DYNAMIC_CLIENT = 'dynamic_agent_client';
export const SIWC_AGENT_NAME = 'Monsters';
export const SIWC_CALLBACK_PATH = '/auth/callback';
export const SIWC_DEFAULT_PORT = 1455;
/** Where the user manages the plan usage of the apps (OpenAI UI guidelines). */
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';

export interface SiwcEndpoints {
  issuer: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** `resource` of the grant and base URL of inference. */
  resource: string;
}

export const SIWC_ENDPOINTS: SiwcEndpoints = {
  issuer: 'https://auth.openai.com',
  authorizeUrl: 'https://auth.openai.com/api/accounts/authorize',
  tokenUrl: 'https://auth.openai.com/api/accounts/oauth/token',
  resource: 'https://api.openai.com/v1',
};

/** One signed-in account (the stored record of the docs, plus the expiry as epoch ms). */
export interface SiwcCredentials {
  email?: string;
  issuer: string;
  subject: string;
  client_id: string;
  ext_agent_host_id: string;
  id_token: string;
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scopes: string[];
  saved_at: string;
  /** Epoch ms when the access token expires. */
  expires_at: number;
}

/** The registration kept after a sign-out: the next sign-in reuses the issued client id. */
export interface SiwcRegistration {
  client_id: string;
  /** Absent when the first code exchange failed (`invalid_grant`): the next attempt reuses the id. */
  subject?: string;
  email?: string;
  /** Last ID token, sent as `id_token_hint` (it may be expired). */
  id_token?: string;
}

export interface SiwcRecord {
  version: 1;
  credentials: SiwcCredentials | null;
  registration: SiwcRegistration | null;
}

/** Where the record lives (core: `secrets/chatgpt.json`, mode 600, written atomically). */
export interface CredentialStore {
  read(): SiwcRecord | null;
  write(record: SiwcRecord): void;
}

export type SiwcErrorCode =
  | 'access_denied'
  | 'state_mismatch'
  | 'registration_incomplete'
  | 'client_mismatch'
  | 'invalid_grant'
  | 'invalid_id_token'
  | 'scope_missing'
  | 'account_mismatch'
  | 'signed_out'
  | 'invalid_client'
  | 'unavailable'
  | 'timeout'
  | 'cancelled';

export class SiwcError extends Error {
  readonly code: SiwcErrorCode;
  /** No answer from OpenAI (`unavailable`): why, as the network said it, and to which host. */
  readonly network: (NetFailure & { host: string }) | undefined;
  constructor(
    code: SiwcErrorCode,
    message: string,
    options?: { cause?: unknown; network?: NetFailure & { host: string } },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'SiwcError';
    this.code = code;
    this.network = options?.network;
  }
}

/** The SiwcError in an error or its causes (the session and the AI SDK may wrap it). */
export function siwcErrorOf(err: unknown): SiwcError | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 6; depth++) {
    if (e instanceof SiwcError) return e;
    e = e instanceof Error ? e.cause : undefined;
  }
  return undefined;
}

/**
 * OpenAI out of reach, in the user's words (a run that failed, a sign-in that did not
 * complete), or undefined when the error is not about the network. `in_use`: the sign-in is
 * already there and a network failure never touches it (`#doRefresh` keeps the tokens).
 */
export function chatgptUnreachableText(
  err: unknown,
  when: 'in_use' | 'sign_in',
): string | undefined {
  const network = siwcErrorOf(err)?.network;
  if (!network) return undefined;
  const t = providerTexts();
  const then = when === 'in_use' ? t.unreachableInUse : t.unreachableSignIn;
  const hint = network.kind === 'unknown' ? '' : ` ${netHint(network, network.host)}`;
  return t.unreachable(network.host, netCause(network), then, hint);
}

/** Waits between attempts of a request that could not leave (`SiwcClientOptions.retryDelaysMs`). */
const RETRY_DELAYS_MS = [2_000, 5_000];

/** Connection failures: nothing reached OpenAI. */
const NOT_SENT = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EADDRNOTAVAIL',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * The request never left: safe to send again, even a one-time code or a refresh token that
 * rotates. A reset or a timeout after the connection may come after OpenAI used the refresh
 * token: sent again, the old token would read as reused and sign the user out.
 */
function notSent(f: NetFailure): boolean {
  return f.kind === 'dns' || f.kind === 'tls' || f.kind === 'proxy' || NOT_SENT.has(f.code ?? '');
}

// --- PKCE and small helpers -------------------------------------------------------

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** A new opaque host id: one per machine, kept forever (also after a sign-out). */
export function newHostId(): string {
  return `urn:uuid:${randomUUID()}`;
}

export function isHostId(value: string): boolean {
  return /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function decodeJwtPart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/** Below this a token is not handed out even when a refresh failed for network reasons. */
const MIN_USABLE_MS = 30_000;

/** Refresh errors that mean the refresh token is gone: sign in again. */
const TERMINAL_REFRESH = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
}

async function readOAuthError(res: Response): Promise<{ code: string; message: string }> {
  const text = await res.text().catch(() => '');
  try {
    const body = JSON.parse(text) as {
      error?: unknown;
      error_description?: unknown;
      code?: unknown;
    };
    const code =
      typeof body.error === 'string'
        ? body.error
        : typeof (body.error as { code?: unknown } | undefined)?.code === 'string'
          ? (body.error as { code: string }).code
          : typeof body.code === 'string'
            ? body.code
            : `http_${res.status}`;
    const message =
      typeof body.error_description === 'string'
        ? body.error_description
        : typeof (body.error as { message?: unknown } | undefined)?.message === 'string'
          ? (body.error as { message: string }).message
          : `answered ${res.status}`;
    return { code, message };
  } catch {
    return { code: `http_${res.status}`, message: `answered ${res.status}` };
  }
}

// --- the client ------------------------------------------------------------------

export interface SiwcClientOptions {
  store: CredentialStore;
  /** Persistent `ext_agent_host_id` of this machine. */
  hostId: string;
  endpoints?: Partial<SiwcEndpoints>;
  fetch?: typeof fetch;
  now?: () => number;
  /** Refresh when the access token expires within this. Default 5 minutes. */
  refreshMarginMs?: number;
  /** Waits before the new attempts of a request that got no answer. Default 2 s, then 5 s. */
  retryDelaysMs?: readonly number[];
}

export interface SiwcLoginOptions {
  /** Preferred callback port. Default 1455; another free port when it is taken. */
  port?: number;
  /** Address the listener binds to. Default 127.0.0.1 (the redirect always says 127.0.0.1). */
  host?: string;
  /** How long the browser has to come back. Default 10 minutes. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SiwcLogin {
  /** Open this in the user's browser (system browser, never a webview). */
  url: string;
  redirectUri: string;
  port: number;
  /** Resolves with the new credentials once the callback has been validated. */
  done: Promise<SiwcCredentials>;
  cancel(): void;
}

const CALLBACK_PAGE = (ok: boolean, text: string) => {
  const t = providerTexts();
  return (
    `<!doctype html><html lang="${t.pageLang}"><meta charset="utf-8"><title>Monsters</title>` +
    `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
    `<h1 style="font-size:1.4rem">${ok ? t.pageDone : t.pageFailed}</h1><p>${text}</p></body></html>`
  );
};

export class SiwcClient {
  readonly #store: CredentialStore;
  readonly #hostId: string;
  readonly #endpoints: SiwcEndpoints;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #margin: number;
  readonly #retryDelays: readonly number[];
  #refreshing: Promise<SiwcCredentials> | null = null;
  #jwks: { at: number; keys: JsonWebKey[] } | null = null;

  constructor(options: SiwcClientOptions) {
    if (!isHostId(options.hostId)) throw new Error('ext_agent_host_id must be a urn:uuid');
    this.#store = options.store;
    this.#hostId = options.hostId;
    this.#endpoints = { ...SIWC_ENDPOINTS, ...options.endpoints };
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#margin = options.refreshMarginMs ?? 5 * 60_000;
    this.#retryDelays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  }

  get endpoints(): SiwcEndpoints {
    return this.#endpoints;
  }

  get hostId(): string {
    return this.#hostId;
  }

  #record(): SiwcRecord {
    return this.#store.read() ?? { version: 1, credentials: null, registration: null };
  }

  /** The signed-in account, without the tokens. */
  account(): { email?: string; subject: string; clientId: string; expiresAt: number } | null {
    const c = this.#record().credentials;
    if (!c) return null;
    return {
      ...(c.email ? { email: c.email } : {}),
      subject: c.subject,
      clientId: c.client_id,
      expiresAt: c.expires_at,
    };
  }

  signedIn(): boolean {
    return this.#record().credentials !== null;
  }

  /** Starts a sign-in: loopback listener first, then the URL to open. */
  async startLogin(options: SiwcLoginOptions = {}): Promise<SiwcLogin> {
    const record = this.#record();
    const registration = record.registration;
    const { verifier, challenge } = pkcePair();
    const state = base64url(randomBytes(24));
    const nonce = base64url(randomBytes(24));

    let settle!: { resolve: (c: SiwcCredentials) => void; reject: (e: Error) => void };
    const done = new Promise<SiwcCredentials>((resolve, reject) => {
      settle = { resolve, reject };
    });
    done.catch(() => {});
    let finished = false;
    let server: Server | null = null;
    const timers: { timeout?: NodeJS.Timeout } = {};
    const finish = (err: Error | null, creds?: SiwcCredentials) => {
      if (finished) return;
      finished = true;
      if (timers.timeout) clearTimeout(timers.timeout);
      options.signal?.removeEventListener('abort', onAbort);
      // Let the browser get its page before the listener goes away.
      setTimeout(() => server?.close(), 50).unref();
      server?.closeIdleConnections?.();
      if (err) settle.reject(err);
      else settle.resolve(creds!);
    };
    const onAbort = () => finish(new SiwcError('cancelled', 'sign-in cancelled'));

    let redirectUri = '';
    const handle = (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== SIWC_CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }
      const reply = (ok: boolean, text: string) => {
        res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(CALLBACK_PAGE(ok, text));
      };
      if (finished) {
        reply(false, providerTexts().pageClosed);
        return;
      }
      const p = url.searchParams;
      // State first: a request with a foreign state is refused and the sign-in
      // stays open (any local page or process could send one to close it).
      if (p.get('state') !== state) {
        reply(false, providerTexts().pageBadState);
        return;
      }
      const error = p.get('error');
      if (error) {
        reply(false, providerTexts().pageCancelled);
        finish(
          new SiwcError(
            error === 'access_denied' ? 'access_denied' : 'unavailable',
            p.get('error_description') ?? error,
          ),
        );
        return;
      }
      const code = p.get('code');
      const returned = p.get('client_id');
      let clientId: string;
      if (registration) {
        // Reauthorization: the id may be absent; a different one is refused.
        if (returned && returned !== registration.client_id) {
          reply(false, providerTexts().pageBadClient);
          finish(new SiwcError('client_mismatch', 'the issued client id changed'));
          return;
        }
        clientId = registration.client_id;
      } else {
        if (!returned || returned === SIWC_DYNAMIC_CLIENT || !returned.startsWith('oaiapp_')) {
          reply(false, providerTexts().pageNoRegistration);
          finish(new SiwcError('registration_incomplete', 'no issued client id in the callback'));
          return;
        }
        clientId = returned;
      }
      if (!code) {
        reply(false, providerTexts().pageNoCode);
        finish(new SiwcError('unavailable', 'the callback has no code'));
        return;
      }
      this.#exchange({ code, clientId, verifier, redirectUri, nonce, registration })
        .then((creds) => {
          reply(true, providerTexts().pageOk);
          finish(null, creds);
        })
        .catch((err: Error) => {
          reply(false, providerTexts().pageError);
          finish(err);
        });
    };

    const host = options.host ?? '127.0.0.1';
    const listen = (port: number) =>
      new Promise<Server>((resolve, reject) => {
        const s = createServer(handle);
        s.once('error', reject);
        s.listen(port, host, () => {
          s.off('error', reject);
          resolve(s);
        });
      });
    const preferred = options.port ?? SIWC_DEFAULT_PORT;
    try {
      server = await listen(preferred);
    } catch (err) {
      if (preferred === 0 || (err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
      server = await listen(0);
    }
    const port = (server.address() as AddressInfo).port;
    redirectUri = `http://127.0.0.1:${port}${SIWC_CALLBACK_PATH}`;

    const q = new URLSearchParams({
      response_type: 'code',
      client_id: registration?.client_id ?? SIWC_DYNAMIC_CLIENT,
      redirect_uri: redirectUri,
      scope: SIWC_SCOPE,
      resource: this.#endpoints.resource,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      ext_agent_host_id: this.#hostId,
    });
    if (registration) {
      if (registration.id_token) q.set('id_token_hint', registration.id_token);
      if (registration.email) q.set('login_hint', registration.email);
    } else {
      q.set('agent_name_hint', SIWC_AGENT_NAME);
    }

    timers.timeout = setTimeout(
      () => finish(new SiwcError('timeout', 'the browser did not come back in time')),
      options.timeoutMs ?? 10 * 60_000,
    );
    timers.timeout.unref();
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });

    return {
      url: `${this.#endpoints.authorizeUrl}?${q.toString()}`,
      redirectUri,
      port,
      done,
      cancel: () => finish(new SiwcError('cancelled', 'sign-in cancelled')),
    };
  }

  async #exchange(p: {
    code: string;
    clientId: string;
    verifier: string;
    redirectUri: string;
    nonce: string;
    registration: SiwcRegistration | null;
  }): Promise<SiwcCredentials> {
    const res = await this.#post(this.#endpoints.tokenUrl, {
      grant_type: 'authorization_code',
      client_id: p.clientId,
      code: p.code,
      code_verifier: p.verifier,
      redirect_uri: p.redirectUri,
      resource: this.#endpoints.resource,
    });
    if (!res.ok) {
      const e = await readOAuthError(res);
      if (e.code === 'invalid_grant' && !p.registration) {
        // The code is discarded; the next attempt starts with the issued client id.
        const record = this.#record();
        this.#store.write({ ...record, registration: { client_id: p.clientId } });
      }
      throw new SiwcError(
        e.code === 'invalid_grant'
          ? 'invalid_grant'
          : e.code === 'invalid_client'
            ? 'invalid_client'
            : 'unavailable',
        `token exchange refused: ${e.code}`,
      );
    }
    const body = (await res.json()) as TokenResponse;
    if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
      throw new SiwcError('unavailable', 'the token answer has no tokens');
    }
    if (typeof body.id_token !== 'string') {
      throw new SiwcError('invalid_id_token', 'the token answer has no ID token');
    }
    const claims = await this.#verifyIdToken(body.id_token, p.clientId, p.nonce);
    const scopes = (typeof body.scope === 'string' ? body.scope : '').split(/\s+/).filter(Boolean);
    if (!scopes.includes(SIWC_DIRECT_SCOPE)) {
      throw new SiwcError('scope_missing', 'ChatGPT plan usage was not granted');
    }
    const subject = claims.sub;
    if (p.registration?.subject && p.registration.subject !== subject) {
      throw new SiwcError('account_mismatch', 'a different ChatGPT account answered');
    }
    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    // A refresh of the previous sign-in still running must not overwrite this one.
    await this.#settled();
    const now = this.#now();
    const creds: SiwcCredentials = {
      ...(claims.email ? { email: claims.email } : {}),
      issuer: this.#endpoints.issuer,
      subject,
      client_id: p.clientId,
      ext_agent_host_id: this.#hostId,
      id_token: body.id_token,
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      scopes: [...scopes].sort(),
      saved_at: new Date(now).toISOString(),
      expires_at: now + expiresIn * 1000,
    };
    this.#store.write({
      version: 1,
      credentials: creds,
      registration: {
        client_id: p.clientId,
        subject,
        ...(claims.email ? { email: claims.email } : {}),
        id_token: body.id_token,
      },
    });
    return creds;
  }

  /**
   * A request to OpenAI's sign-in servers. Any answer is returned as it is (an HTTP error is
   * OpenAI speaking, never tried again here); a request that could not leave (`notSent`) is
   * tried again after each of `retryDelaysMs`, unless `signal` stopped it or the attempt ran
   * out its own time (that already waited long enough). The last failure becomes an
   * `unavailable` SiwcError with the classified cause.
   */
  async #request(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    options: { retry?: boolean; signal?: AbortSignal } = {},
  ): Promise<Response> {
    const delays = options.retry === false ? [] : this.#retryDelays;
    for (let attempt = 0; ; attempt++) {
      options.signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      try {
        return await this.#fetch(url, { ...init, signal });
      } catch (err) {
        if (options.signal?.aborted) throw err;
        const network = netFailureOf(err);
        const delay = delays[attempt];
        if (delay !== undefined && !timeout.aborted && notSent(network)) {
          await sleep(delay, undefined, options.signal ? { signal: options.signal } : {});
          continue;
        }
        const host = new URL(url).host;
        throw new SiwcError(
          'unavailable',
          `${host} is unreachable (${network.kind}${network.code ? ` ${network.code}` : ''}, ${attempt + 1} attempt${attempt > 0 ? 's' : ''})`,
          { cause: err, network: { ...network, host } },
        );
      }
    }
  }

  #post(url: string, form: Record<string, string>, retry = true): Promise<Response> {
    return this.#request(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams(form).toString(),
      },
      30_000,
      { retry },
    );
  }

  async #discovery(): Promise<Record<string, unknown>> {
    const res = await this.#request(
      `${this.#endpoints.issuer}/.well-known/openid-configuration`,
      { headers: { accept: 'application/json' } },
      15_000,
    );
    if (!res.ok) throw new SiwcError('unavailable', `openid-configuration answered ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async #keys(refresh: boolean): Promise<JsonWebKey[]> {
    if (!refresh && this.#jwks && this.#now() - this.#jwks.at < 3_600_000) return this.#jwks.keys;
    const discovery = await this.#discovery();
    const uri = discovery['jwks_uri'];
    if (typeof uri !== 'string') throw new SiwcError('invalid_id_token', 'no jwks_uri');
    const res = await this.#request(uri, {}, 15_000);
    if (!res.ok) throw new SiwcError('unavailable', `JWKS answered ${res.status}`);
    const body = (await res.json()) as { keys?: JsonWebKey[] };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    this.#jwks = { at: this.#now(), keys };
    return keys;
  }

  /** Signature (RS256 on OpenAI's JWKS), issuer, audience, expiry, nonce. */
  async #verifyIdToken(
    token: string,
    clientId: string,
    nonce: string,
  ): Promise<{ sub: string; email?: string }> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new SiwcError('invalid_id_token', 'malformed ID token');
    let header: Record<string, unknown>;
    let claims: Record<string, unknown>;
    try {
      header = decodeJwtPart(parts[0]!);
      claims = decodeJwtPart(parts[1]!);
    } catch {
      throw new SiwcError('invalid_id_token', 'malformed ID token');
    }
    if (header['alg'] !== 'RS256') throw new SiwcError('invalid_id_token', 'unexpected algorithm');
    const kid = header['kid'];
    const find = (keys: JsonWebKey[]) =>
      keys.find((k) => (kid === undefined || k['kid'] === kid) && k.kty === 'RSA');
    let jwk = find(await this.#keys(false));
    // A key rotated since the last read.
    jwk ??= find(await this.#keys(true));
    if (!jwk) throw new SiwcError('invalid_id_token', 'unknown signing key');
    const ok = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(parts[2]!, 'base64url'),
    );
    if (!ok) throw new SiwcError('invalid_id_token', 'bad ID token signature');
    if (claims['iss'] !== this.#endpoints.issuer)
      throw new SiwcError('invalid_id_token', 'unexpected issuer');
    const aud = claims['aud'];
    const audOk = Array.isArray(aud) ? aud.includes(clientId) : aud === clientId;
    if (!audOk) throw new SiwcError('invalid_id_token', 'unexpected audience');
    const exp = claims['exp'];
    if (typeof exp !== 'number' || exp * 1000 < this.#now() - 60_000)
      throw new SiwcError('invalid_id_token', 'expired ID token');
    if (claims['nonce'] !== nonce) throw new SiwcError('invalid_id_token', 'nonce mismatch');
    const sub = claims['sub'];
    if (typeof sub !== 'string' || !sub) throw new SiwcError('invalid_id_token', 'no subject');
    const email = claims['email'];
    return { sub, ...(typeof email === 'string' ? { email } : {}) };
  }

  /**
   * A valid access token, refreshed when it expires within the margin. Refreshes
   * are serialized: concurrent callers share one request (rotating token).
   */
  async accessToken(options: { minValidityMs?: number } = {}): Promise<string> {
    const creds = this.#record().credentials;
    if (!creds) throw new SiwcError('signed_out', 'not signed in with ChatGPT');
    const margin = Math.max(this.#margin, options.minValidityMs ?? 0);
    if (creds.expires_at - this.#now() > margin) return creds.access_token;
    try {
      return (await this.refresh()).access_token;
    } catch (err) {
      // OpenAI unreachable for a moment: the token still valid serves meanwhile.
      if (err instanceof SiwcError && err.code === 'unavailable') {
        const still = this.#record().credentials;
        if (still && still.expires_at - this.#now() > MIN_USABLE_MS) return still.access_token;
      }
      throw err;
    }
  }

  /** Waits for a refresh in flight (sign-in and sign-out never cross one). */
  async #settled(): Promise<void> {
    await this.#refreshing?.catch(() => {});
  }

  /** Refreshes now (shared with any refresh already running). */
  refresh(): Promise<SiwcCredentials> {
    this.#refreshing ??= this.#doRefresh().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async #doRefresh(): Promise<SiwcCredentials> {
    const record = this.#record();
    const creds = record.credentials;
    if (!creds) throw new SiwcError('signed_out', 'not signed in with ChatGPT');
    const res = await this.#post(this.#endpoints.tokenUrl, {
      grant_type: 'refresh_token',
      client_id: creds.client_id,
      refresh_token: creds.refresh_token,
      resource: this.#endpoints.resource,
    });
    /** The stored sign-in is still the one this refresh started from. */
    const current = () => {
      const now = this.#record();
      const c = now.credentials;
      const same = !!c && c.refresh_token === creds.refresh_token && c.subject === creds.subject;
      return { record: now, same };
    };
    if (!res.ok) {
      const e = await readOAuthError(res);
      if (TERMINAL_REFRESH.has(e.code)) {
        // The refresh token is gone: sign out, keep the registration for the next sign-in.
        // A sign-in made meanwhile is not this one: it stays.
        const now = current();
        if (now.same) this.#store.write({ ...now.record, credentials: null });
        throw new SiwcError('signed_out', `ChatGPT sign-in expired (${e.code}): sign in again`);
      }
      if (e.code === 'invalid_client') throw new SiwcError('invalid_client', e.message);
      // Network or server trouble: the tokens stay.
      throw new SiwcError('unavailable', `token refresh failed: ${e.code}`);
    }
    const body = (await res.json()) as TokenResponse;
    if (typeof body.access_token !== 'string')
      throw new SiwcError('unavailable', 'the refresh answer has no access token');
    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : creds.expires_in;
    const now = this.#now();
    const next: SiwcCredentials = {
      ...creds,
      access_token: body.access_token,
      // Rotating refresh token: access token, expiry, scopes and refresh token change together.
      refresh_token:
        typeof body.refresh_token === 'string' ? body.refresh_token : creds.refresh_token,
      ...(typeof body.id_token === 'string' ? { id_token: body.id_token } : {}),
      expires_in: expiresIn,
      expires_at: now + expiresIn * 1000,
      scopes:
        typeof body.scope === 'string'
          ? body.scope.split(/\s+/).filter(Boolean).sort()
          : creds.scopes,
      saved_at: new Date(now).toISOString(),
    };
    const after = current();
    if (!after.same) {
      // Signed out (or in again) meanwhile: the rotated token must not bring the old sign-in back.
      if (next.refresh_token !== creds.refresh_token) {
        await this.#revoke(next.refresh_token, next.client_id).catch(() => false);
      }
      const other = after.record.credentials;
      if (!other) throw new SiwcError('signed_out', 'signed out of ChatGPT during the refresh');
      return other;
    }
    this.#store.write({ ...after.record, credentials: next });
    return next;
  }

  /** Revokes a refresh token (three attempts on server errors). True when OpenAI confirmed. */
  async #revoke(token: string, clientId: string): Promise<boolean> {
    const discovery = await this.#discovery();
    const endpoint = discovery['revocation_endpoint'];
    if (typeof endpoint !== 'string') return false;
    for (let attempt = 0; attempt < 3; attempt++) {
      // Its own three attempts: no extra waits for an answer that does not come.
      const res = await this.#post(
        endpoint,
        { token, token_type_hint: 'refresh_token', client_id: clientId },
        false,
      ).catch(() => null);
      if (res?.status === 200) return true;
      if (res && res.status < 500) return false;
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
    return false;
  }

  /**
   * Revokes the refresh token and forgets the tokens (the registration and the
   * host id stay). `confirmed: false` when OpenAI could not be reached: the user
   * can disconnect the app in the ChatGPT settings.
   */
  async signOut(): Promise<{ confirmed: boolean }> {
    // A refresh in flight would rotate the token being revoked: wait for it.
    await this.#settled();
    const record = this.#record();
    const creds = record.credentials;
    if (!creds) return { confirmed: true };
    const confirmed = await this.#revoke(creds.refresh_token, creds.client_id).catch(() => false);
    this.#store.write({
      ...record,
      credentials: null,
      registration: record.registration ?? {
        client_id: creds.client_id,
        subject: creds.subject,
        ...(creds.email ? { email: creds.email } : {}),
      },
    });
    return { confirmed };
  }
}
