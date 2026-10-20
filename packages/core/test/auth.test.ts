import { readFileSync, statSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { createCoreServices, startCore, type CoreServer } from '../src/index.ts';
import {
  BROWSER_HEADERS,
  browserSession,
  EMAIL,
  PASSWORD,
  postJson,
  rawGet,
  sessionCookie,
  setupUser,
  tempHome,
} from './helpers.ts';

const posix = process.platform !== 'win32';
let core: CoreServer | undefined;

afterEach(async () => {
  await core?.close();
  core = undefined;
});

async function start(opts: Parameters<typeof startCore>[0] = {}) {
  core = await startCore({ home: tempHome(), port: 0, ...opts });
  return core;
}

describe('setup, login, logout', () => {
  it('creates the single local user only once', async () => {
    const c = await start();
    const { url } = c;
    expect(await (await fetch(`${url}/api/setup-status`)).json()).toEqual({ needsSetup: true });

    const weak = await postJson(`${url}/api/setup`, {
      email: EMAIL,
      password: 'short',
      setupCode: c.setupCode,
    });
    expect(weak.status).toBe(400);

    const res = await setupUser(c);
    expect(res.status).toBe(201);
    expect(sessionCookie(res)).toBeDefined();
    expect(await (await fetch(`${url}/api/setup-status`)).json()).toEqual({ needsSetup: false });

    const again = await postJson(`${url}/api/setup`, {
      email: 'x@example.com',
      password: PASSWORD,
      setupCode: c.setupCode,
    });
    expect(again.status).toBe(409);
  });

  it('stores the password with argon2id', async () => {
    const c = await start();
    await setupUser(c);
    const row = c.db.get<{ password_hash: string }>('SELECT password_hash FROM users');
    expect(row?.password_hash.startsWith('$argon2id$')).toBe(true);
  });

  it('logs in with an HttpOnly SameSite=Strict cookie, serves /me, logs out', async () => {
    const c = await start();
    const { url } = c;
    await setupUser(c);

    const wrong = await postJson(`${url}/api/login`, { email: EMAIL, password: 'wrong password' });
    expect(wrong.status).toBe(401);
    const unknown = await postJson(`${url}/api/login`, {
      email: 'no@example.com',
      password: PASSWORD,
    });
    expect(unknown.status).toBe(401);

    const res = await postJson(`${url}/api/login`, {
      email: EMAIL.toUpperCase(),
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie().join('\n');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Max-Age=\d+/i);
    const cookie = sessionCookie(res);
    expect(cookie).toBeDefined();
    const session = await browserSession(res);
    expect(session['x-monsters-session']).not.toBe('');

    expect((await fetch(`${url}/api/me`)).status).toBe(401);
    const me = await fetch(`${url}/api/me`, { headers: session });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ email: EMAIL, via: 'session', owner: true, recent: true });

    const out = await fetch(`${url}/api/logout`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, ...session },
    });
    expect(out.status).toBe(200);
    expect((await fetch(`${url}/api/me`, { headers: session })).status).toBe(401);
  });

  it('rejects expired sessions', async () => {
    const c = await start({ sessionTtlMs: 300 });
    const { url } = c;
    const res = await setupUser(c);
    const session = await browserSession(res);
    expect((await fetch(`${url}/api/me`, { headers: session })).status).toBe(200);
    await sleep(400);
    expect((await fetch(`${url}/api/me`, { headers: session })).status).toBe(401);
  });

  it('rate-limits repeated failed logins (details in rate-limit.test.ts)', async () => {
    const home = tempHome();
    const services = createCoreServices({ home });
    await services.auth.setup(EMAIL, PASSWORD);
    for (let i = 0; i < 5; i++) {
      expect(await services.auth.login(EMAIL, 'nope-nope')).toBeNull();
    }
    await expect(services.auth.login(EMAIL, PASSWORD)).rejects.toThrow(/too many/);
    services.db.close();
  });

  it('records auth events without secrets', async () => {
    const c = await start();
    await setupUser(c);
    await postJson(`${c.url}/api/login`, { email: EMAIL, password: 'bad password' });
    const actions = c.log.query({ type: 'auth' }).map((e) => (e.data as { action: string }).action);
    expect(actions).toEqual(['cli_token_issued', 'setup', 'login_failed']);
    const all = JSON.stringify(c.log.query({ limit: 1000 }));
    expect(all).not.toContain(PASSWORD);
  });
});

describe('CLI token', () => {
  it('is written with mode 600 and authenticates API calls', async () => {
    const c = await start();
    const token = readFileSync(c.paths.cliToken, 'utf8').trim();
    if (posix) expect(statSync(c.paths.cliToken).mode & 0o777).toBe(0o600);
    expect(token.length).toBeGreaterThanOrEqual(43);

    const ok = await fetch(`${c.url}/api/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.status).toBe(200);
    const bad = await fetch(`${c.url}/api/status`, { headers: { authorization: 'Bearer nope' } });
    expect(bad.status).toBe(401);
    expect((await fetch(`${c.url}/api/status`)).status).toBe(401);

    // Only the hash is stored.
    const stored = c.db.get<{ token_hash: string }>('SELECT token_hash FROM api_tokens');
    expect(stored?.token_hash).not.toBe(token);
  });

  it('is rotated at every start', async () => {
    const home = tempHome();
    core = await startCore({ home, port: 0 });
    const first = readFileSync(core.paths.cliToken, 'utf8').trim();
    await core.close();
    core = await startCore({ home, port: 0 });
    const second = readFileSync(core.paths.cliToken, 'utf8').trim();
    expect(second).not.toBe(first);
    const old = await fetch(`${core.url}/api/status`, {
      headers: { authorization: `Bearer ${first}` },
    });
    expect(old.status).toBe(401);
  });
});

describe('request guards', () => {
  it('rejects foreign Host headers (DNS rebinding)', async () => {
    const c = await start();
    expect(
      (await rawGet(c.port, '/api/setup-status', { host: `127.0.0.1:${c.port}` })).status,
    ).toBe(200);
    expect(
      (await rawGet(c.port, '/api/setup-status', { host: `localhost:${c.port}` })).status,
    ).toBe(200);
    expect((await rawGet(c.port, '/api/setup-status', { host: 'evil.example' })).status).toBe(403);
  });

  it('rejects requests from foreign origins, accepts local ones', async () => {
    const c = await start();
    const evil = await setupUser(c, { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    expect(c.auth.needsSetup()).toBe(true);

    const local = await setupUser(c, { origin: `http://127.0.0.1:${c.port}` });
    expect(local.status).toBe(201);
  });

  it('refuses to bind to non-loopback addresses unless explicitly allowed', async () => {
    await expect(startCore({ home: tempHome(), port: 0, host: '0.0.0.0' })).rejects.toThrow(
      /loopback/,
    );
  });
});
