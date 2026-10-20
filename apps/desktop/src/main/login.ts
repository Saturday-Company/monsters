import { LOGIN_EXCHANGE_PATH, LOGIN_TOKEN_PATH } from '@monsters/shared';

/*
 * Automatic login of the desktop app (D-045). The main process gets a single-use login token
 * from the core (over the utility process's port when the app started the core, with the CLI
 * token when it attached to a core started from the terminal), exchanges it at
 * `POST /api/login/exchange` and puts the session cookie it receives into the window's
 * session. The renderer never sees a token. Plain HTTP helpers, no Electron.
 */

/** Name of the core's session cookie (`SESSION_COOKIE` in core/src/server/guards.ts). */
export const SESSION_COOKIE = 'monsters_session';

/** Headers of a state-changing request authenticated by the session cookie (CSRF guard). */
const COOKIE_POST_HEADERS = {
  'content-type': 'application/json',
  'x-monsters-request': '1',
} as const;

const TIMEOUT_MS = 5000;

export interface SessionCookie {
  value: string;
  /** Epoch ms, from Max-Age; null for a session cookie. */
  expiresAt: number | null;
}

export type ExchangeResult =
  | { status: 'ok'; cookie: SessionCookie }
  /** No account yet: the window shows the normal first start. */
  | { status: 'needs_setup' }
  | { status: 'failed'; reason: string };

/** The session cookie in a response's `Set-Cookie` headers. */
export function parseSessionCookie(
  setCookie: readonly string[],
  now: number = Date.now(),
): SessionCookie | null {
  for (const header of setCookie) {
    const [pair, ...attrs] = header.split(';');
    const eq = pair?.indexOf('=') ?? -1;
    if (!pair || eq < 0 || pair.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = pair.slice(eq + 1).trim();
    if (!value) return null;
    let expiresAt: number | null = null;
    for (const attr of attrs) {
      const [k, v] = attr.split('=');
      if (k?.trim().toLowerCase() === 'max-age' && v !== undefined) {
        const s = Number(v.trim());
        if (Number.isFinite(s)) expiresAt = now + s * 1000;
      }
    }
    return { value, expiresAt };
  }
  return null;
}

/** Mints a login token with the CLI token (a core started from the terminal). */
export async function mintWithCliToken(
  url: string,
  cliToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(`${url}${LOGIN_TOKEN_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cliToken}`, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: unknown };
    return typeof body.token === 'string' ? body.token : null;
  } catch {
    return null;
  }
}

export async function exchangeLoginToken(
  url: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${url}${LOGIN_EXCHANGE_PATH}`, {
      method: 'POST',
      headers: COOKIE_POST_HEADERS,
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { status: 'failed', reason: (err as Error).message };
  }
  if (res.status === 409) return { status: 'needs_setup' };
  if (!res.ok) return { status: 'failed', reason: `HTTP ${res.status}` };
  const cookie = parseSessionCookie(res.headers.getSetCookie());
  return cookie ? { status: 'ok', cookie } : { status: 'failed', reason: 'no session cookie' };
}

/** True if the session cookie still opens a session on this core. */
export async function sessionIsValid(
  url: string,
  cookieValue: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${url}/api/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${cookieValue}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Whether the cookie the window already has is kept for `target` (review of ondate 3-4, n. 4).
 * A session the core no longer opens is never kept. On the core the app started itself
 * (`owned`) the login token comes from the utility process's port and opens a session of the
 * user in person: a limited session left there by an earlier attach to a core of the terminal
 * (same home, same port, so the same cookie) would ask the password for every approval, so it
 * is replaced. Attached and remote cores keep a limited session: their login token comes from
 * the CLI token and would open another limited one.
 */
export async function keepSession(
  target: { kind: 'owned' | 'attached' | 'remote'; url: string },
  cookieValue: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${target.url}/api/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${cookieValue}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return false;
    if (target.kind !== 'owned') return true;
    const me = (await res.json().catch(() => null)) as { owner?: unknown } | null;
    return me?.owner === true;
  } catch {
    return false;
  }
}

/**
 * How the window's session keeps the cookie of an automatic login. On the app's own core
 * (`owned`) the session is of the user in person, and a new one costs nothing (the utility
 * process's port gives a login token at every start): a session cookie, never written to the
 * cookie database in the user data folder, where a monster with the terminal could read it and
 * approve its own cards (review of ondate 3-4, n. 9; Chromium's key is readable by every
 * process of the user, or a fixed one on Linux without a keyring). Elsewhere the cookie lasts
 * as the core says: a limited session, and the password confirmed once stays.
 */
export function cookieLifetime(
  kind: 'owned' | 'attached' | 'remote',
  cookie: SessionCookie,
): { expirationDate?: number } {
  if (kind === 'owned' || cookie.expiresAt === null) return {};
  return { expirationDate: cookie.expiresAt / 1000 };
}

export type CoreAuth = { cookie: string } | { bearer: string };

/**
 * A state-changing call of the app menu (`/api/kill`, `/api/resume`), as the window would
 * make it (session cookie and CSRF header) or as the CLI (bearer). Returns the HTTP status
 * (0 when the core does not answer).
 */
export async function postToCore(
  url: string,
  path: string,
  auth: CoreAuth,
  body: unknown = {},
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  try {
    const res = await fetchImpl(`${url}${path}`, {
      method: 'POST',
      headers:
        'cookie' in auth
          ? { ...COOKIE_POST_HEADERS, cookie: `${SESSION_COOKIE}=${auth.cookie}` }
          : { 'content-type': 'application/json', authorization: `Bearer ${auth.bearer}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.body?.cancel();
    return res.status;
  } catch {
    return 0;
  }
}
