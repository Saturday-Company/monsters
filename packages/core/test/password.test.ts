import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { LogEvent } from '@monsters/shared';
import { resetPasswordOffline, startCore, type CoreServer } from '../src/index.ts';
import {
  BROWSER_HEADERS,
  EMAIL,
  PASSWORD,
  postJson,
  browserSession,
  setupUser,
  tempHome,
} from './helpers.ts';

let core: CoreServer | undefined;

afterEach(async () => {
  await core?.close();
  core = undefined;
});

const NEW = 'una password nuova';

async function loggedIn(home = tempHome()) {
  core = await startCore({ home, port: 0, env: {}, hub: { decisionPort: null } });
  const session = await browserSession(await setupUser(core));
  return { c: core, session, home };
}

async function login(c: CoreServer, password: string) {
  const res = await postJson(`${c.url}/api/login`, { email: EMAIL, password });
  return { status: res.status, session: res.ok ? await browserSession(res) : undefined };
}

type BrowserSession = Awaited<ReturnType<typeof browserSession>>;

const change = (c: CoreServer, session: BrowserSession, body: unknown) =>
  fetch(`${c.url}/api/auth/password`, {
    method: 'POST',
    headers: { ...BROWSER_HEADERS, ...session },
    body: JSON.stringify(body),
  });

const authEvents = (c: CoreServer) =>
  c.log.query({ type: 'auth', limit: 100 }).map((e) => (e as LogEvent<'auth'>).data.action);

describe('password change from the settings', () => {
  it('needs the current password; closes the other sessions and their streams', async () => {
    const { c, session } = await loggedIn();
    const other = (await login(c, PASSWORD)).session!;
    const ws = new WebSocket(`${c.url.replace('http', 'ws')}/api/stream`, {
      origin: c.url,
      headers: { cookie: other.cookie },
    });
    await new Promise((r) => ws.once('open', r));
    // A browser's session: its secret in the first message (S-B13), then the stream says hello.
    const hello = new Promise((r) => ws.once('message', r));
    ws.send(JSON.stringify({ kind: 'auth', secret: other['x-monsters-session'] }));
    await hello;
    const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)));

    const wrong = await change(c, session, { currentPassword: 'sbagliata', newPassword: NEW });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: 'wrong_password' });
    const same = await change(c, session, { currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(await same.json()).toMatchObject({ error: 'same_password' });
    const short = await change(c, session, { currentPassword: PASSWORD, newPassword: 'corta' });
    expect(short.status).toBe(400);
    const csrf = await fetch(`${c.url}/api/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...session },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: NEW }),
    });
    expect(csrf.status).toBe(403);
    const foreign = await fetch(`${c.url}/api/auth/password`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, ...session, origin: 'https://evil.example' },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: NEW }),
    });
    expect(foreign.status).toBe(403);

    const ok = await change(c, session, { currentPassword: PASSWORD, newPassword: NEW });
    expect(await ok.json()).toEqual({ ok: true, sessionsClosed: 1 });
    expect(await closed).toBe(4401);
    // This session stays, the other is gone; only the new password works.
    const me = (k: BrowserSession) => fetch(`${c.url}/api/me`, { headers: k });
    expect((await me(session)).status).toBe(200);
    expect((await me(other)).status).toBe(401);
    expect((await login(c, PASSWORD)).status).toBe(401);
    expect((await login(c, NEW)).status).toBe(200);
    const row = c.db.get<{ password_hash: string }>('SELECT password_hash FROM users');
    expect(row?.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(authEvents(c)).toEqual(
      expect.arrayContaining(['password_change_failed', 'password_changed']),
    );
    // The password never reaches the log.
    expect(JSON.stringify(c.log.query({ limit: 1000 }))).not.toContain(NEW);
  });

  it('is rate limited like the login, and refused to the CLI token', async () => {
    const { c, session } = await loggedIn();
    let last = 0;
    for (let i = 0; i < 7; i++) {
      const res = await change(c, session, { currentPassword: `no-${i}`, newPassword: NEW });
      last = res.status;
      if (res.status === 429) {
        expect(res.headers.get('retry-after')).toBeTruthy();
        break;
      }
    }
    expect(last).toBe(429);
    const token = readFileSync(c.paths.cliToken, 'utf8').trim();
    const viaToken = await fetch(`${c.url}/api/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: NEW }),
    });
    expect(viaToken.status).toBe(403);
    expect(await viaToken.json()).toMatchObject({ error: 'session_required' });
  });
});

describe('password reset on this computer', () => {
  it('never with the core running: not the CLI token (a monster may read it), nor a browser (M1)', async () => {
    const { c, session } = await loggedIn();
    const token = readFileSync(c.paths.cliToken, 'utf8').trim();
    const reset = (headers: Record<string, string>, body: unknown = { newPassword: NEW }) =>
      fetch(`${c.url}/api/auth/password/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    const viaToken = await reset({ authorization: `Bearer ${token}` });
    expect(viaToken.status).toBe(409);
    expect(await viaToken.json()).toMatchObject({ error: 'core_running' });
    expect((await reset({ ...BROWSER_HEADERS, ...session })).status).toBe(409);
    // Nothing changed: the session is still open, the old password still works.
    expect((await fetch(`${c.url}/api/me`, { headers: session })).status).toBe(200);
    expect((await login(c, PASSWORD)).status).toBe(200);
    expect(authEvents(c)).not.toContain('password_reset');
  });

  it('with the core stopped: straight in the data folder, under its lock', async () => {
    const { c, home } = await loggedIn();
    await c.close();
    core = undefined;
    expect(await resetPasswordOffline(home, NEW)).toBe(1);
    const again = await startCore({ home, port: 0, env: {}, hub: { decisionPort: null } });
    core = again;
    expect((await login(again, PASSWORD)).status).toBe(401);
    expect((await login(again, NEW)).status).toBe(200);
    expect(authEvents(again)).toContain('password_reset');
    // A running core holds the lock: stop it first.
    await expect(resetPasswordOffline(home, NEW)).rejects.toThrow(/già in esecuzione/);
    await expect(resetPasswordOffline(tempHome(), NEW)).rejects.toThrow(/no local user/);
  });
});
