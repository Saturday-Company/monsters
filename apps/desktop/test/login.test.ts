import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startCore, type CoreServer } from '@monsters/core';
import { afterEach, describe, expect, it } from 'vitest';
import { systemLocatorDeps } from '../src/main/core-locator.ts';
import { LocalCore } from '../src/main/local-core.ts';
import {
  cookieLifetime,
  exchangeLoginToken,
  keepSession,
  mintWithCliToken,
  parseSessionCookie,
  postToCore,
  sessionIsValid,
} from '../src/main/login.ts';
import { tempDir } from './helpers.ts';

/* The app's side of the automatic login against a real core over HTTP (D-045). */

let core: CoreServer | undefined;
afterEach(async () => {
  await core?.close();
  core = undefined;
});

async function startWithAccount() {
  core = await startCore({ home: tempDir(), port: 0, webDist: false });
  const res = await fetch(`${core.url}/api/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-monsters-request': '1' },
    body: JSON.stringify({
      email: 'g@example.com',
      password: 'correct horse battery',
      setupCode: core.setupCode,
    }),
  });
  expect(res.status).toBe(201);
  return core;
}

describe('automatic login', () => {
  it('parses the session cookie', () => {
    expect(
      parseSessionCookie(
        [
          'monsters_device=x; Path=/api/login',
          'monsters_session=abc; Max-Age=60; Path=/; HttpOnly',
        ],
        1000,
      ),
    ).toEqual({ value: 'abc', expiresAt: 61_000 });
    expect(parseSessionCookie(['other=1'])).toBeNull();
    expect(parseSessionCookie(['monsters_session=; Max-Age=0'])).toBeNull();
  });

  it('CLI token → login token → session cookie that the core accepts', async () => {
    const c = await startWithAccount();
    const cli = readFileSync(c.paths.cliToken, 'utf8').trim();
    expect(await mintWithCliToken(c.url, 'wrong')).toBeNull();
    const token = await mintWithCliToken(c.url, cli);
    expect(token).toBeTruthy();
    const result = await exchangeLoginToken(c.url, token!);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.cookie.expiresAt).toBeGreaterThan(Date.now());
    expect(await sessionIsValid(c.url, result.cookie.value)).toBe(true);
    expect(await sessionIsValid(c.url, 'forged')).toBe(false);
    // Single use.
    expect(await exchangeLoginToken(c.url, token!)).toEqual({
      status: 'failed',
      reason: 'HTTP 401',
    });
    // The menu's kill switch with the session, as the window's button.
    expect(await postToCore(c.url, '/api/kill', { cookie: result.cookie.value })).toBe(200);
    expect(c.runs.halted).toBe(true);
    expect(c.log.query({ type: ['kill'] }).at(-1)?.data).toMatchObject({ by: 'ui' });
    expect(await postToCore(c.url, '/api/resume', { bearer: cli })).toBe(200);
    expect(c.runs.halted).toBe(false);
    expect(await postToCore('http://127.0.0.1:1', '/api/kill', { bearer: cli })).toBe(0);
  });

  it('no account yet: needs_setup', async () => {
    core = await startCore({ home: tempDir(), port: 0, webDist: false });
    const { token } = core.auth.issueLoginToken('desktop');
    expect(await exchangeLoginToken(core.url, token)).toEqual({ status: 'needs_setup' });
  });

  it('the app’s own core replaces a limited session left by an attach (review of ondate 3-4, n. 4)', async () => {
    const c = await startWithAccount();
    const cli = readFileSync(c.paths.cliToken, 'utf8').trim();
    // The cookie an attach to a core of the terminal leaves: the CLI token's, limited.
    const limited = await exchangeLoginToken(c.url, (await mintWithCliToken(c.url, cli))!);
    if (limited.status !== 'ok') throw new Error('no limited session');
    // Still a valid session, so the old check kept it and every approval asked the password.
    expect(await sessionIsValid(c.url, limited.cookie.value)).toBe(true);
    const owned = { kind: 'owned' as const, url: c.url };
    expect(await keepSession(owned, limited.cookie.value)).toBe(false);
    // Attached or remote: the limited session is what the login token would give again.
    expect(await keepSession({ kind: 'attached', url: c.url }, limited.cookie.value)).toBe(true);
    expect(await keepSession({ kind: 'remote', url: c.url }, limited.cookie.value)).toBe(true);
    // The utility process's login token: the user in person, kept.
    const { token } = c.auth.issueLoginToken('desktop');
    const own = await exchangeLoginToken(c.url, token);
    if (own.status !== 'ok') throw new Error('no session');
    expect(await keepSession(owned, own.cookie.value)).toBe(true);
    expect(await keepSession(owned, 'forged')).toBe(false);
    expect(await keepSession({ kind: 'attached', url: c.url }, 'forged')).toBe(false);
  });

  it('the owner’s cookie on the app’s own core is never written to disk (review of ondate 3-4, n. 9)', () => {
    const cookie = { value: 'v', expiresAt: 7_000_000 };
    // No expiration date: a session cookie, kept in memory by Chromium only.
    expect(cookieLifetime('owned', cookie)).toEqual({});
    expect(cookieLifetime('attached', cookie)).toEqual({ expirationDate: 7000 });
    expect(cookieLifetime('remote', cookie)).toEqual({ expirationDate: 7000 });
    expect(cookieLifetime('remote', { value: 'v', expiresAt: null })).toEqual({});
  });

  it('an attached target logs in through the CLI token of the data directory', async () => {
    const c = await startWithAccount();
    const lc = new LocalCore({
      home: c.config.home,
      coreEntry: '/none',
      spawn: () => {
        throw new Error('must attach');
      },
      locator: systemLocatorDeps(),
      fileExists: () => false,
      logPath: join(c.config.home, 'logs', 'desktop.log'),
    });
    await lc.connect();
    expect(lc.target?.kind).toBe('attached');
    expect(lc.target?.url).toBe(c.url);
    const token = await lc.target!.loginToken();
    expect((await exchangeLoginToken(c.url, token!)).status).toBe('ok');
    await lc.shutdown();
    // Still running: the app does not stop a core it did not start.
    expect((await fetch(`${c.url}/api/health`)).ok).toBe(true);
  });

  it('a file left by a dead core is not a core', async () => {
    const home = tempDir();
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'core.lock'), JSON.stringify({ pid: 2 ** 30 }));
    writeFileSync(
      join(home, 'server.json'),
      JSON.stringify({ pid: 2 ** 30, url: 'http://127.0.0.1:9' }),
    );
    const lc = new LocalCore({
      home,
      coreEntry: '/none',
      spawn: () => {
        throw new Error('x');
      },
      locator: systemLocatorDeps(),
      fileExists: () => false,
      logPath: join(home, 'logs', 'desktop.log'),
    });
    const views: string[] = [];
    lc.on('down', (v) => views.push(v.kind));
    await lc.connect();
    expect(views).toEqual(['missing']);
  });
});
