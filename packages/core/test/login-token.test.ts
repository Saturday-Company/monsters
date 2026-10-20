import { readFileSync } from 'node:fs';
import { LOGIN_EXCHANGE_PATH, LOGIN_TOKEN_PATH } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { startCore, type CoreServer } from '../src/index.ts';
import { browserSession, EMAIL, postJson, sessionCookie, setupUser, tempHome } from './helpers.ts';

/* Single-use login tokens of the desktop app (M3.1, D-045), over real HTTP. */

let core: CoreServer | undefined;
afterEach(async () => {
  await core?.close();
  core = undefined;
});

async function start() {
  core = await startCore({ home: tempHome(), port: 0, webDist: false });
  return core;
}

function cliToken(c: CoreServer): string {
  return readFileSync(c.paths.cliToken, 'utf8').trim();
}

function mint(c: CoreServer, bearer: string | undefined, session?: Record<string, string>) {
  return fetch(`${c.url}${LOGIN_TOKEN_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : { 'x-monsters-request': '1' }),
      ...session,
    },
    body: '{}',
  });
}

function exchange(c: CoreServer, token: string, headers: Record<string, string> = {}) {
  return postJson(`${c.url}${LOGIN_EXCHANGE_PATH}`, { token }, headers);
}

function authActions(c: CoreServer): string[] {
  return c.log
    .query({ type: ['auth'] })
    .map((e) => (e.data as { action: string }).action)
    .filter((a) => a.startsWith('login_token'));
}

describe('login tokens', () => {
  it('the CLI token mints a token that opens one session, once', async () => {
    const c = await start();
    await setupUser(c);
    const res = await mint(c, cliToken(c));
    expect(res.status).toBe(201);
    const { token, expiresAt } = (await res.json()) as { token: string; expiresAt: number };
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(60_000);

    const ok = await exchange(c, token);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ email: EMAIL });
    const cookie = sessionCookie(ok);
    expect(cookie).toBeDefined();
    const setCookie = ok.headers.getSetCookie().join('\n');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    // No device cookie: the app is not a browser that typed a password.
    expect(setCookie).not.toMatch(/monsters_device=/);
    // A session of the desktop app's own cookie jar (D-044): the cookie alone, no secret (S-B13).
    const me = await fetch(`${c.url}/api/me`, { headers: { cookie: cookie! } });
    expect(await me.json()).toEqual({ email: EMAIL, via: 'session', owner: false, recent: false });

    // Single use.
    const again = await exchange(c, token);
    expect(again.status).toBe(401);
    expect(authActions(c)).toEqual(['login_token_issued', 'login_token', 'login_token_failed']);
    const issued = c.log
      .query({ type: ['auth'] })
      .find((e) => (e.data as { action?: string }).action === 'login_token_issued');
    expect(issued?.data).toMatchObject({ channel: 'cli' });
    // The token itself never reaches the log.
    expect(JSON.stringify(c.log.query({}))).not.toContain(token);
  });

  it('a session cannot mint tokens, nor can anybody without the CLI token', async () => {
    const c = await start();
    const session = await browserSession(await setupUser(c));
    expect((await mint(c, undefined, session)).status).toBe(403);
    expect((await mint(c, undefined)).status).toBe(401);
    expect((await mint(c, 'not-the-token')).status).toBe(401);
  });

  it('refuses expired, unknown and cross-origin exchanges', async () => {
    const c = await start();
    await setupUser(c);
    const expired = c.auth.issueLoginToken('desktop', -1);
    expect((await exchange(c, expired.token)).status).toBe(401);
    expect((await exchange(c, 'x'.repeat(43))).status).toBe(401);
    const fresh = c.auth.issueLoginToken('desktop');
    // A page of another site cannot use it (Origin check), nor a form (JSON + header only).
    const cross = await exchange(c, fresh.token, { origin: 'https://evil.example' });
    expect(cross.status).toBe(403);
    const form = await fetch(`${c.url}${LOGIN_EXCHANGE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `token=${fresh.token}`,
    });
    expect(form.status).toBe(415);
    // Still valid after the refused attempts (they never reached the token).
    expect((await exchange(c, fresh.token)).status).toBe(200);
  });

  it('spends the token but asks for the account when none exists', async () => {
    const c = await start();
    const { token } = c.auth.issueLoginToken('desktop');
    const res = await exchange(c, token);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'needs_setup' });
    await setupUser(c);
    expect((await exchange(c, token)).status).toBe(401);
  });

  it('backs off after a burst of wrong tokens, apart from password logins', async () => {
    const c = await start();
    await setupUser(c);
    for (let i = 0; i < 5; i++) expect((await exchange(c, `wrong-${i}`)).status).toBe(401);
    const limited = await exchange(c, 'wrong-again');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    const login = await postJson(`${c.url}/api/login`, {
      email: EMAIL,
      password: 'correct horse battery',
    });
    expect(login.status).toBe(200);
  });

  it('keeps only the last few tokens alive', async () => {
    const c = await start();
    await setupUser(c);
    const tokens = Array.from({ length: 5 }, () => c.auth.issueLoginToken('desktop').token);
    expect((await exchange(c, tokens[0]!)).status).toBe(401);
    expect((await exchange(c, tokens[4]!)).status).toBe(200);
  });
});
