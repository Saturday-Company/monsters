import { randomBytes } from 'node:crypto';
import {
  auth,
  computeScopeUnion,
  extractWWWAuthenticateParams,
  isStrictScopeSuperset,
  UnauthorizedError,
  type AuthProvider,
  type FetchLike,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from '@modelcontextprotocol/client';
import { McpServerNameSchema } from '@monsters/shared';
import { isLoopbackHost } from '../config.ts';
import { secretStoreFor } from '../secrets/store.ts';
import { mcpStrings } from './mcp.strings.ts';

/*
 * OAuth sign-in for remote MCP servers (D-063), driven by the SDK's `auth()`:
 * protected resource and authorization server discovery (RFC 9728 / 8414),
 * dynamic client registration (RFC 7591), Authorization Code with PKCE (S256)
 * and `state`, issuer check of the callback (RFC 9207), refresh on 401.
 *
 * - The callback is a route of the core itself (`OAUTH_CALLBACK_PATH`) on its
 *   loopback address: the browser comes back to the computer that runs Monsters.
 * - What survives a restart (client registration, tokens, discovery) is one
 *   secret per server, `mcp-oauth-<name>.json` (keychain or file backend,
 *   D-042). The PKCE verifier and `state` live only in memory, for at most
 *   `PENDING_TTL_MS`, and each `state` is good for one callback.
 * - Values never leave the core: the API says only "connected" or "pending",
 *   and every token is given to the log redactor as soon as it is known.
 * - Signing out revokes the tokens (RFC 7009) when the server offers it, then
 *   forgets them.
 */

export const OAUTH_CALLBACK_PATH = '/api/mcp-oauth/callback';
/** How long a sign-in waits for the browser to come back. */
export const PENDING_TTL_MS = 10 * 60_000;
const REVOKE_TIMEOUT_MS = 5_000;

export interface OAuthRecord {
  /** Redirect URI the client was registered with: a new one needs a new registration. */
  redirectUri?: string;
  client?: StoredOAuthClientInformation;
  tokens?: StoredOAuthTokens;
  discovery?: OAuthDiscoveryState;
  /** The service refused the saved tokens at run time: they are gone, a new sign-in is needed. */
  signInNeeded?: true;
  /**
   * A call was refused with `403 insufficient_scope`: the scopes the next «Collega» asks for
   * (what the access had plus what the server asked, space separated). The tokens stay good
   * for the rest; a sign-in that ends clears it.
   */
  scopeNeeded?: string;
}

export function mcpOAuthSecretName(name: string): string {
  McpServerNameSchema.parse(name);
  return `mcp-oauth-${name}.json`;
}

export function readOAuthRecord(secretsDir: string, name: string): OAuthRecord {
  const raw = secretStoreFor(secretsDir).read(mcpOAuthSecretName(name));
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeOAuthRecord(secretsDir: string, name: string, record: OAuthRecord): void {
  secretStoreFor(secretsDir).write(
    mcpOAuthSecretName(name),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

export function removeOAuthRecord(secretsDir: string, name: string): void {
  secretStoreFor(secretsDir).remove(mcpOAuthSecretName(name));
}

/** Values of a record that must never reach the log. */
export function oauthSecretValues(record: OAuthRecord): string[] {
  const out: string[] = [];
  const t = record.tokens as { access_token?: unknown; refresh_token?: unknown } | undefined;
  const c = record.client as { client_secret?: unknown } | undefined;
  for (const v of [t?.access_token, t?.refresh_token, c?.client_secret]) {
    if (typeof v === 'string' && v.length >= 8) out.push(v);
  }
  return out;
}

/**
 * Host of the callback address for a core bound to `host`: itself on loopback,
 * 127.0.0.1 for a core bound to every interface, the address otherwise (a core
 * reached through the network: the browser must reach it there).
 */
export function oauthCallbackHost(host: string): string {
  const h = host.replace(/^\[|\]$/g, '');
  if (h === '' || h === '0.0.0.0' || h === '::') return '127.0.0.1';
  return h.includes(':') ? `[${h}]` : h;
}

/**
 * Where the browser of the user comes back after a sign-in (D-072): the
 * address it reached the core at, from the `Host` of the request that started
 * the sign-in. It is loopback on the user's own computer even when the core is
 * on another one: the window of the desktop app goes through its tunnel on a
 * local port (often not the core's), a browser through `ssh -L`; the callback
 * takes the same way back to the core, and `state` and PKCE stay in the core.
 * A core reached on the network (`--allow-non-loopback`) gets the loopback
 * address of its own port instead, as RFC 8252 wants for native apps: the page
 * does not open there, and the user pastes its address into Monsters
 * (`paste`, `POST /api/mcp-oauth/finish`).
 */
export function oauthCallbackOrigin(
  hostHeader: string | undefined,
  fallback: string,
): { origin: string; paste: boolean } {
  const raw = (hostHeader ?? '').trim().toLowerCase();
  const m = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(raw);
  if (!m) return { origin: fallback, paste: false };
  const host = m[1]!;
  const port = m[2] ? Number(m[2]) : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return { origin: fallback, paste: false };
  const bare = host.replace(/^\[|\]$/g, '');
  if (isLoopbackHost(bare)) {
    // `localhost` can resolve to ::1 while the listener is on 127.0.0.1.
    const name = host === 'localhost' ? '127.0.0.1' : host;
    return { origin: `http://${name}:${port}`, paste: false };
  }
  let local: URL;
  try {
    local = new URL(fallback);
  } catch {
    return { origin: fallback, paste: true };
  }
  return { origin: `http://127.0.0.1:${local.port || port}`, paste: true };
}

/** The sign-in is needed (or must be done again): no tokens, or the service refused them. */
export class OAuthSignInNeeded extends Error {
  constructor() {
    super('sign-in needed');
    this.name = 'OAuthSignInNeeded';
  }
}

/**
 * The tokens could not be renewed because the service did not answer (network,
 * 5xx): the sign-in is still good, the service is not reachable right now.
 */
export class OAuthServiceUnreachable extends Error {
  constructor() {
    super('the service that renews the sign-in is not reachable');
    this.name = 'OAuthServiceUnreachable';
  }
}

/** A problem of a sign-in, in plain Italian for the user. */
export class OAuthFlowError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OAuthFlowError';
  }
}

interface Pending {
  state: string;
  name: string;
  serverUrl: string;
  redirectUri: string;
  expiresAt: number;
  verifier?: string;
  authorizationUrl?: URL;
  /**
   * A client registered for this sign-in's callback address: kept here until
   * the sign-in ends, so a sign-in left halfway never replaces the client the
   * saved tokens belong to (D-072).
   */
  client?: StoredOAuthClientInformation;
}

/** An address the browser may be sent to: https, or http on loopback (local servers, tests). */
export function isSafeBrowserUrl(url: URL): boolean {
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && isLoopbackHost(url.hostname.replace(/^\[|\]$/g, ''));
}

/**
 * The SDK's view of one server's credentials. With a `flow` it can start a
 * sign-in (state, verifier, the page to open); without, it only reads and
 * refreshes tokens, and asking for a sign-in fails with `OAuthSignInNeeded`.
 */
class StoredOAuthProvider implements OAuthClientProvider {
  readonly #secretsDir: string;
  readonly #name: string;
  readonly #redirectUri: string;
  readonly #flow: Pending | undefined;
  readonly #onSecret: (value: string) => void;
  /**
   * The tokens this provider read last, i.e. those the SDK is trying to
   * refresh: `invalidateCredentials` forgets the saved tokens only while they
   * are still these (a refresh elsewhere may have saved new ones meanwhile).
   */
  #seen: StoredOAuthTokens | undefined;

  constructor(o: {
    secretsDir: string;
    name: string;
    redirectUri: string;
    flow?: Pending;
    onSecret: (value: string) => void;
  }) {
    this.#secretsDir = o.secretsDir;
    this.#name = o.name;
    this.#redirectUri = o.redirectUri;
    this.#flow = o.flow;
    this.#onSecret = o.onSecret;
  }

  #read(): OAuthRecord {
    return readOAuthRecord(this.#secretsDir, this.#name);
  }

  #update(change: (r: OAuthRecord) => OAuthRecord): void {
    const next = change(this.#read());
    for (const v of oauthSecretValues(next)) this.#onSecret(v);
    writeOAuthRecord(this.#secretsDir, this.#name, next);
  }

  get redirectUrl(): string {
    return this.#redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Monsters',
      client_uri: 'https://github.com/Saturday-Company/monsters',
      redirect_uris: [this.#redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // A public client on the user's computer: PKCE instead of a secret.
      token_endpoint_auth_method: 'none',
    };
  }

  state(): string {
    if (!this.#flow) {
      // At run time the SDK asks for a new sign-in after a refresh it could not do.
      // A service that did not answer leaves the sign-in good: "not reachable".
      if (this.refreshOutcome === 'unreachable') throw new OAuthServiceUnreachable();
      // Refused, or nothing to refresh with: the saved tokens are dead. The SDK forgets
      // them only when it can read the `invalid_grant` (not with an answer that is not
      // OAuth JSON, or another `Response` class global): forgotten here too.
      if (this.#read().tokens) this.invalidateCredentials('tokens');
      throw new OAuthSignInNeeded();
    }
    return this.#flow.state;
  }

  /**
   * How the last refresh at run time ended, as seen on the wire: a 4xx of the
   * token endpoint is a refusal, no answer or a 5xx/429 leaves the sign-in good.
   */
  refreshOutcome: 'refused' | 'unreachable' | undefined;

  /** The saved client was registered for this callback address. */
  #sameClient(r: OAuthRecord): boolean {
    return r.client !== undefined && r.redirectUri === this.#redirectUri;
  }

  clientInformation(): StoredOAuthClientInformation | undefined {
    if (this.#flow?.client) return this.#flow.client;
    const r = this.#read();
    // Registered for another callback address (another port, another way in): register again.
    return this.#sameClient(r) ? r.client : undefined;
  }

  saveClientInformation(client: StoredOAuthClientInformation): void {
    const r = this.#read();
    if (!this.#flow && r.client?.client_id !== client.client_id) {
      // At run time the SDK registers a new client after an `invalid_client`: that is a
      // sign-in, and only the user starts one ("Collega" registers again).
      throw new OAuthSignInNeeded();
    }
    if (this.#flow && r.tokens && !this.#sameClient(r)) {
      // Tokens of another client are saved: this one waits for the end of the sign-in.
      for (const v of oauthSecretValues({ client })) this.#onSecret(v);
      this.#flow.client = client;
      return;
    }
    this.#update((r) => ({ ...r, client, redirectUri: this.#redirectUri }));
  }

  tokens(): StoredOAuthTokens | undefined {
    const r = this.#read();
    // A sign-in with a new client does not refresh the tokens of the old one.
    if (this.#flow && r.client && !this.#sameClient(r)) return undefined;
    this.#seen = r.tokens;
    return r.tokens;
  }

  saveTokens(tokens: StoredOAuthTokens): void {
    const client = this.#flow?.client;
    // A refresh at run time saves only over the tokens it renewed: a sign-in that ended
    // meanwhile (maybe with a new client) keeps its own (review of 19/10, item 10).
    if (!this.#flow && !sameTokens(this.#read().tokens, this.#seen)) return;
    this.#update((r) => {
      const next: OAuthRecord = client
        ? { ...r, client, redirectUri: this.#redirectUri, tokens }
        : { ...r, tokens };
      delete next.signInNeeded;
      // A sign-in asked for the wider scope (`start`): what it got is what the service gives.
      if (this.#flow) delete next.scopeNeeded;
      return next;
    });
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // Agents never open pages: only a sign-in started by the user does.
    if (!this.#flow) throw new OAuthSignInNeeded();
    this.#flow.authorizationUrl = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string): void {
    if (!this.#flow) throw new OAuthSignInNeeded();
    this.#flow.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.#flow?.verifier) throw new OAuthSignInNeeded();
    return this.#flow.verifier;
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'verifier') {
      if (this.#flow) delete this.#flow.verifier;
      return;
    }
    // A client of this sign-in only is forgotten alone: the saved one and its tokens stay.
    if ((scope === 'all' || scope === 'client') && this.#flow?.client) {
      delete this.#flow.client;
      if (scope === 'all') delete this.#flow.verifier;
      return;
    }
    if (scope === 'all') {
      removeOAuthRecord(this.#secretsDir, this.#name);
      return;
    }
    this.#update((r) => {
      const next = { ...r };
      if (scope === 'client') {
        delete next.client;
        delete next.tokens;
      } else if (scope === 'tokens') {
        // Refused tokens go; tokens saved meanwhile by another refresh stay (connettori 2).
        if (!sameTokens(r.tokens, this.#seen)) return r;
        delete next.tokens;
      } else delete next.discovery;
      // Refused at run time: the app says "Serve l’accesso" until a new sign-in.
      if (!this.#flow && r.tokens && !next.tokens) next.signInNeeded = true;
      return next;
    });
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.#update((r) => ({ ...r, discovery: state }));
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.#read().discovery;
  }
}

/** The same tokens (same access and refresh token); with nothing on one side, nothing on both. */
function sameTokens(a: StoredOAuthTokens | undefined, b: StoredOAuthTokens | undefined): boolean {
  if (!a || !b) return a === b;
  return a.access_token === b.access_token && a.refresh_token === b.refresh_token;
}

function accessToken(record: OAuthRecord): string | undefined {
  const t = record.tokens as { access_token?: unknown } | undefined;
  return typeof t?.access_token === 'string' && t.access_token !== '' ? t.access_token : undefined;
}

/** The bearer token a request was sent with. */
function bearerOf(init: RequestInit | undefined): string | undefined {
  const raw = new Headers(init?.headers).get('authorization') ?? '';
  return /^Bearer\s+(.+)$/i.exec(raw)?.[1];
}

function plainError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

/** Each request of the OAuth sign-in (the revocation has its own, shorter limit). */
const OAUTH_REQUEST_TIMEOUT_MS = 15_000;

/** Sign-ins in progress and the credentials of the OAuth servers. */
export class McpOAuth {
  readonly #secretsDir: string;
  readonly #onSecret: (value: string) => void;
  readonly #fetch: FetchLike | undefined;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pending = new Map<string, Pending>();
  /** The token work of each server, one at a time (refresh at run time, a sign-in's start). */
  readonly #queue = new Map<string, Promise<unknown>>();

  constructor(o: {
    secretsDir: string;
    onSecret: (value: string) => void;
    fetchFn?: FetchLike;
    now?: () => number;
    /** Limit for each request of the sign-in (discovery, registration, code exchange). */
    requestTimeoutMs?: number;
  }) {
    this.#secretsDir = o.secretsDir;
    this.#onSecret = o.onSecret;
    this.#fetch = o.fetchFn;
    this.#now = o.now ?? Date.now;
    this.#timeoutMs = o.requestTimeoutMs ?? OAUTH_REQUEST_TIMEOUT_MS;
  }

  /** The SDK's `fetch` for `auth()`: every request gets a time limit, so a silent server cannot hang "Collega". */
  #timedFetch: FetchLike = (url, init) => {
    const limit = AbortSignal.timeout(this.#timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, limit]) : limit;
    return (this.#fetch ?? fetch)(url, { ...init, signal });
  };

  /** Runs `job` after the token work already queued for this server. */
  #serial<T>(name: string, job: () => Promise<T>): Promise<T> {
    const before = this.#queue.get(name) ?? Promise.resolve();
    const run = before.catch(() => {}).then(job);
    const tail = run.catch(() => {});
    this.#queue.set(name, tail);
    void tail.finally(() => {
      if (this.#queue.get(name) === tail) this.#queue.delete(name);
    });
    return run;
  }

  #sweep(): void {
    const now = this.#now();
    for (const [state, p] of this.#pending) if (p.expiresAt <= now) this.#pending.delete(state);
  }

  /** Drops the sign-in waiting for this server, if any. */
  cancel(name: string): void {
    for (const [state, p] of this.#pending) if (p.name === name) this.#pending.delete(state);
  }

  pending(name: string): boolean {
    this.#sweep();
    return [...this.#pending.values()].some((p) => p.name === name);
  }

  connected(name: string): boolean {
    return accessToken(readOAuthRecord(this.#secretsDir, name)) !== undefined;
  }

  /** The service refused the saved tokens at run time: only a new sign-in helps. */
  signInNeeded(name: string): boolean {
    return readOAuthRecord(this.#secretsDir, name).signInNeeded === true;
  }

  /** The scopes a call was refused for (`403 insufficient_scope`), to ask at the next «Collega». */
  scopeNeeded(name: string): string | undefined {
    return readOAuthRecord(this.#secretsDir, name).scopeNeeded;
  }

  /**
   * A call was refused with `403 insufficient_scope` asking for `required`: the next sign-in
   * asks for it together with what the access already had (and what an earlier refusal asked).
   * True when that is more than the access has, i.e. a new «Collega» helps; false without a
   * scope in the challenge or with one the access already covers.
   */
  needScope(name: string, required: string | undefined): boolean {
    if (!required?.trim()) return false;
    const r = readOAuthRecord(this.#secretsDir, name);
    if (!r.tokens) return false;
    const granted = (r.tokens as { scope?: unknown }).scope;
    const current = typeof granted === 'string' ? granted : undefined;
    const union = computeScopeUnion(current, r.scopeNeeded, required);
    if (!union || !isStrictScopeSuperset(union, current)) return false;
    if (union !== r.scopeNeeded)
      writeOAuthRecord(this.#secretsDir, name, { ...r, scopeNeeded: union });
    return true;
  }

  /** Secret values already saved for a server (for the redactor at start). */
  secretValues(name: string): string[] {
    return oauthSecretValues(readOAuthRecord(this.#secretsDir, name));
  }

  /** The provider used at run time: reads and refreshes, never signs in. */
  #runtimeProvider(name: string, redirectUri: string): StoredOAuthProvider {
    const saved = readOAuthRecord(this.#secretsDir, name).redirectUri;
    return new StoredOAuthProvider({
      secretsDir: this.#secretsDir,
      name,
      redirectUri: saved ?? redirectUri,
      onSecret: this.#onSecret,
    });
  }

  /**
   * What the transport of a server uses at run time (connettori 2, F-A7): the
   * saved access token for every request and, on a 401, one refresh at a time
   * for the server. A 401 to a token that is no longer the saved one (another
   * call refreshed meanwhile) only retries with the new one: two calls that
   * find the token expired together never spend the same refresh token twice,
   * which a service that rotates them answers with `invalid_grant`.
   *
   * The transport must send its requests through `fetch`: it notes the token
   * each one carried, to compare it on a 401.
   */
  runtime(
    name: string,
    redirectUri: string,
    baseFetch?: FetchLike,
  ): { authProvider: AuthProvider; fetch: FetchLike } {
    const provider = this.#runtimeProvider(name, redirectUri);
    const sentWith = new WeakMap<Response, string>();
    const doFetch = baseFetch ?? this.#fetch ?? fetch;
    const tagged: FetchLike = async (url, init) => {
      const token = bearerOf(init);
      const res = await doFetch(url, init);
      if (token) sentWith.set(res, token);
      return res;
    };
    const timeoutMs = this.#timeoutMs;
    const saved = () => accessToken(readOAuthRecord(this.#secretsDir, name));
    const authProvider: AuthProvider = {
      token: () => Promise.resolve(saved()),
      onUnauthorized: (ctx) => {
        const failed = sentWith.get(ctx.response);
        return this.#serial(name, async () => {
          const now = saved();
          // Already renewed by another call: the transport retries with the new token.
          if (now !== undefined && failed !== undefined && now !== failed) return;
          const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(ctx.response);
          provider.refreshOutcome = undefined;
          const result = await auth(provider, {
            serverUrl: ctx.serverUrl,
            ...(resourceMetadataUrl ? { resourceMetadataUrl } : {}),
            ...(scope ? { scope } : {}),
            fetchFn: async (u, i) => {
              const refresh =
                i?.body instanceof URLSearchParams && i.body.get('grant_type') === 'refresh_token';
              // A silent token endpoint must not hold the call (and the queue) for ever.
              const limit = AbortSignal.timeout(timeoutMs);
              let res: Response;
              try {
                res = await ctx.fetchFn(u, {
                  ...i,
                  signal: i?.signal ? AbortSignal.any([i.signal, limit]) : limit,
                });
              } catch (err) {
                if (refresh) provider.refreshOutcome = 'unreachable';
                throw err;
              }
              if (refresh && !res.ok) {
                provider.refreshOutcome =
                  res.status >= 500 || res.status === 429 ? 'unreachable' : 'refused';
              }
              return res;
            },
          });
          if (result !== 'AUTHORIZED') throw new UnauthorizedError();
        });
      },
    };
    return { authProvider, fetch: tagged };
  }

  /**
   * Starts a sign-in: discovery, registration if needed, then the page of the
   * service to open. Saved tokens that still work (or refresh) mean no page.
   */
  async start(
    name: string,
    serverUrl: string,
    redirectUri: string,
  ): Promise<{ status: 'connected' } | { status: 'redirect'; authorizationUrl: string }> {
    this.#sweep();
    this.cancel(name);
    const flow: Pending = {
      state: randomBytes(32).toString('base64url'),
      name,
      serverUrl,
      redirectUri,
      expiresAt: this.#now() + PENDING_TTL_MS,
    };
    const provider = new StoredOAuthProvider({
      secretsDir: this.#secretsDir,
      name,
      redirectUri,
      flow,
      onSecret: this.#onSecret,
    });
    let result: 'AUTHORIZED' | 'REDIRECT';
    // A call refused for its scope (`needScope`): this sign-in asks for the wider one, on the
    // service's page (a refresh cannot widen a grant, RFC 6749 §6).
    const saved = readOAuthRecord(this.#secretsDir, name);
    const scope = saved.scopeNeeded;
    const granted = (saved.tokens as { scope?: unknown } | undefined)?.scope;
    const widen =
      scope !== undefined &&
      isStrictScopeSuperset(scope, typeof granted === 'string' ? granted : undefined);
    try {
      // Saved tokens may be refreshed here: never at the same time as a running call.
      result = await this.#serial(name, () =>
        auth(provider, {
          serverUrl,
          ...(scope ? { scope } : {}),
          ...(widen ? { forceReauthorization: true } : {}),
          fetchFn: this.#timedFetch,
        }),
      );
    } catch (err) {
      throw new OAuthFlowError(mcpStrings().oauthPrepare(plainError(err)), { cause: err });
    }
    if (result === 'AUTHORIZED') return { status: 'connected' };
    const url = flow.authorizationUrl;
    if (!url || !isSafeBrowserUrl(url)) {
      throw new OAuthFlowError(mcpStrings().oauthUnsafePage);
    }
    this.#pending.set(flow.state, flow);
    return { status: 'redirect', authorizationUrl: url.href };
  }

  /**
   * The browser came back: checks `state` (one use, not expired), then trades
   * the code for tokens with the verifier of that sign-in. Returns the server.
   */
  async finish(params: URLSearchParams): Promise<string> {
    this.#sweep();
    const state = params.get('state') ?? '';
    const flow = this.#pending.get(state);
    if (!state || !flow) {
      throw new OAuthFlowError(mcpStrings().oauthExpired);
    }
    this.#pending.delete(state);
    const error = params.get('error');
    if (error) {
      const code = error.replace(/[^a-z0-9_.-]/gi, '').slice(0, 60);
      throw new OAuthFlowError(
        code === 'access_denied' ? mcpStrings().oauthDenied : mcpStrings().oauthRefused(code),
      );
    }
    const code = params.get('code');
    if (!code) throw new OAuthFlowError(mcpStrings().oauthNoCode);
    const provider = new StoredOAuthProvider({
      secretsDir: this.#secretsDir,
      name: flow.name,
      redirectUri: flow.redirectUri,
      flow,
      onSecret: this.#onSecret,
    });
    const iss = params.get('iss');
    try {
      // After a refresh at run time still on its way: its tokens never land on the new ones.
      const result = await this.#serial(flow.name, () =>
        auth(provider, {
          serverUrl: flow.serverUrl,
          authorizationCode: code,
          ...(iss ? { iss } : {}),
          fetchFn: this.#timedFetch,
        }),
      );
      if (result !== 'AUTHORIZED') throw new Error('no tokens');
    } catch (err) {
      throw new OAuthFlowError(mcpStrings().oauthNotAccepted(plainError(err)), { cause: err });
    }
    return flow.name;
  }

  /** Revokes the tokens where the service allows it, then forgets everything. */
  async signOut(name: string): Promise<void> {
    this.cancel(name);
    const record = readOAuthRecord(this.#secretsDir, name);
    removeOAuthRecord(this.#secretsDir, name);
    await this.#revoke(record).catch(() => {});
  }

  async #revoke(record: OAuthRecord): Promise<void> {
    const endpoint = (
      record.discovery?.authorizationServerMetadata as { revocation_endpoint?: unknown } | undefined
    )?.revocation_endpoint;
    const tokens = record.tokens as { access_token?: unknown; refresh_token?: unknown } | undefined;
    const client = record.client as { client_id?: unknown; client_secret?: unknown } | undefined;
    if (typeof endpoint !== 'string' || typeof client?.client_id !== 'string') return;
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      return;
    }
    if (!isSafeBrowserUrl(url)) return;
    const doFetch = this.#fetch ?? fetch;
    // The refresh token first: revoking it ends the whole grant on most servers.
    for (const [token, hint] of [
      [tokens?.refresh_token, 'refresh_token'],
      [tokens?.access_token, 'access_token'],
    ] as const) {
      if (typeof token !== 'string' || !token) continue;
      const body = new URLSearchParams({ token, token_type_hint: hint });
      const headers: Record<string, string> = {
        'content-type': 'application/x-www-form-urlencoded',
      };
      if (typeof client.client_secret === 'string') {
        headers['authorization'] =
          `Basic ${Buffer.from(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`).toString('base64')}`;
      } else {
        body.set('client_id', client.client_id);
      }
      await doFetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
      }).catch(() => undefined);
    }
  }
}
