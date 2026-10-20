import { existsSync, readFileSync, statSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig, startCore, type CoreServer } from '../src/index.ts';
import {
  BROWSER_HEADERS,
  EMAIL,
  PASSWORD,
  postJson,
  browserSession,
  setupUser,
  tempHome,
} from './helpers.ts';

const posix = process.platform !== 'win32';
const DEV_ORIGIN = 'http://localhost:5173';
let core: CoreServer | undefined;

afterEach(async () => {
  await core?.close();
  core = undefined;
});

async function loggedIn(opts: Parameters<typeof startCore>[0] = {}) {
  core = await startCore({ home: tempHome(), port: 0, env: {}, ...opts });
  const res = await setupUser(core);
  expect(res.status).toBe(201);
  return { c: core, auth: await browserSession(res) };
}

function handshake(url: string, options: WebSocket.ClientOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options);
    ws.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.on('open', () => {
      resolve(101);
      ws.close();
    });
    ws.on('error', reject);
  });
}

describe('development origins', () => {
  it('does not trust the Vite dev server unless development mode is on', () => {
    expect(loadConfig({ port: 4747 }, {}).allowedOrigins).not.toContain(DEV_ORIGIN);
    expect(loadConfig({ port: 4747 }, { MONSTERS_DEV: '1' }).allowedOrigins).toContain(DEV_ORIGIN);
    expect(loadConfig({ port: 4747, dev: true }, {}).allowedOrigins).toContain(DEV_ORIGIN);
  });

  it('rejects kill, resume and the stream from port 5173 without the dev flag', async () => {
    const { c, auth } = await loggedIn();
    const headers = { ...BROWSER_HEADERS, origin: DEV_ORIGIN, ...auth };
    const kill = await fetch(`${c.url}/api/kill`, { method: 'POST', headers, body: '{}' });
    expect(kill.status).toBe(403);
    const resume = await fetch(`${c.url}/api/resume`, { method: 'POST', headers, body: '{}' });
    expect(resume.status).toBe(403);
    expect(c.runs.halted).toBe(false);
    const ws = `${c.url.replace('http', 'ws')}/api/stream?after=00000000000000000000000000`;
    expect(await handshake(ws, { origin: DEV_ORIGIN, headers: { ...auth } })).toBe(403);
  });

  it('accepts port 5173 in development mode', async () => {
    const { c, auth } = await loggedIn({ dev: true });
    const res = await fetch(`${c.url}/api/kill`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, origin: DEV_ORIGIN, ...auth },
      body: '{}',
    });
    expect(res.status).toBe(200);
  });
});

describe('state-changing requests', () => {
  it('require Content-Type: application/json', async () => {
    const { c, auth } = await loggedIn();
    const token = readFileSync(c.paths.cliToken, 'utf8').trim();
    for (const headers of [
      { 'content-type': 'text/plain', 'x-monsters-request': '1', origin: c.url, ...auth },
      { 'content-type': 'text/plain', authorization: `Bearer ${token}` },
      { 'content-type': 'application/x-www-form-urlencoded', 'x-monsters-request': '1', ...auth },
      { authorization: `Bearer ${token}` },
    ]) {
      const res = await fetch(`${c.url}/api/kill`, {
        method: 'POST',
        headers,
        body: '{"reason":"csrf"}',
      });
      expect(res.status).toBe(415);
    }
    expect(c.runs.halted).toBe(false);
    const ok = await fetch(`${c.url}/api/kill`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${token}`,
      },
      body: '{}',
    });
    expect(ok.status).toBe(200);
  });

  it('require the anti-CSRF header when authenticated by cookie', async () => {
    const { c, auth } = await loggedIn();
    const noHeader = await fetch(`${c.url}/api/kill`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: c.url, ...auth },
      body: '{}',
    });
    expect(noHeader.status).toBe(403);
    expect(await noHeader.json()).toEqual({ error: 'csrf_header_required' });
    const wrongValue = await fetch(`${c.url}/api/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-monsters-request': '0', ...auth },
      body: '{}',
    });
    expect(wrongValue.status).toBe(403);
    expect(c.runs.halted).toBe(false);

    const ok = await fetch(`${c.url}/api/kill`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, origin: c.url, ...auth },
      body: '{}',
    });
    expect(ok.status).toBe(200);
    expect(c.runs.halted).toBe(true);
  });

  it('refuse bodies over the configured limit', async () => {
    const { c, auth } = await loggedIn({ maxBodyBytes: 1024 });
    const res = await postJson(`${c.url}/api/kill`, { reason: 'x'.repeat(2000) }, { ...auth });
    expect(res.status).toBe(413);
    expect(c.runs.halted).toBe(false);
  });
});

describe('first setup', () => {
  it('requires the one-time code printed by monsters start', async () => {
    core = await startCore({ home: tempHome(), port: 0 });
    expect(core.setupCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(readFileSync(core.paths.setupCode, 'utf8').trim()).toBe(core.setupCode);
    if (posix) expect(statSync(core.paths.setupCode).mode & 0o777).toBe(0o600);

    const missing = await postJson(`${core.url}/api/setup`, { email: EMAIL, password: PASSWORD });
    expect(missing.status).toBe(400);
    const wrong = await postJson(`${core.url}/api/setup`, {
      email: EMAIL,
      password: PASSWORD,
      setupCode: 'AAAA-BBBB-CCCC',
    });
    expect(wrong.status).toBe(403);
    expect(core.auth.needsSetup()).toBe(true);

    // Case, spaces and dashes do not matter.
    const typed = (core.setupCode ?? '').toLowerCase().replace(/-/g, ' ');
    const ok = await postJson(`${core.url}/api/setup`, {
      email: EMAIL,
      password: PASSWORD,
      setupCode: typed,
    });
    expect(ok.status).toBe(201);
    expect(existsSync(core.paths.setupCode)).toBe(false);
  });

  it('issues no code once the account exists', async () => {
    const home = tempHome();
    core = await startCore({ home, port: 0 });
    await setupUser(core);
    await core.close();
    core = await startCore({ home, port: 0 });
    expect(core.setupCode).toBeNull();
    expect(existsSync(core.paths.setupCode)).toBe(false);
  });

  it('deletes the CLI token on a clean stop', async () => {
    core = await startCore({ home: tempHome(), port: 0 });
    const token = readFileSync(core.paths.cliToken, 'utf8').trim();
    expect(token.length).toBeGreaterThan(0);
    const path = core.paths.cliToken;
    await core.close();
    expect(existsSync(path)).toBe(false);
    core = undefined;
  });
});
