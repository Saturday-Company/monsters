import { createServer, connect, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import type {
  McpOAuthFinishResponse,
  McpOAuthStartResponse,
  McpServersResponse,
  McpTestResponse,
} from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { oauthCallbackOrigin, readOAuthRecord } from '../src/mcp/oauth.ts';
import { startFakeOAuthServer, type FakeOAuthServer } from './fixtures/fake-oauth-server.ts';
import { ownerCookie, startTestHub, type TestHub } from './hub-helpers.ts';

/*
 * OAuth with the core on another computer (D-072): the browser of the user
 * comes back where it reached the core (the tunnel of the desktop app on a
 * local port of its own, `ssh -L`), so the callback travels the same tunnel
 * back to the core, with `state` and PKCE untouched. When the page cannot
 * open, its address is pasted (`POST /api/mcp-oauth/finish`).
 */

const servers: FakeOAuthServer[] = [];
const tunnels: Server[] = [];
const sockets = new Set<Socket>();
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  for (const s of sockets) s.destroy();
  sockets.clear();
  await Promise.all(tunnels.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

/** A raw TCP forward on another local port, like the tunnel of the desktop app. */
async function tunnelTo(coreUrl: string): Promise<string> {
  const port = Number(new URL(coreUrl).port);
  const server = createServer((socket) => {
    const upstream = connect(port, '127.0.0.1');
    sockets.add(socket).add(upstream);
    socket.pipe(upstream);
    upstream.pipe(socket);
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  tunnels.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function setup() {
  const as = await startFakeOAuthServer();
  servers.push(as);
  const t = await startTestHub({});
  await t.json('PUT', '/api/mcp-servers/notes', {
    transport: 'http',
    url: as.mcpUrl,
    oauth: true,
    catalog: 'notes',
    agents: ['titan'],
  });
  return { as, t };
}

/**
 * An API call of the window, made through `base` (the tunnel): the user's session, signing a
 * monster in to a service is theirs only (review of ondate 3-4, n. 7).
 */
async function startVia(t: TestHub, base: string): Promise<McpOAuthStartResponse> {
  const res = await fetch(`${base}/api/mcp-servers/notes/oauth`, {
    method: 'POST',
    headers: {
      cookie: ownerCookie(t.core),
      'content-type': 'application/json',
      'x-monsters-request': '1',
    },
    body: '{}',
  });
  expect(res.status).toBe(200);
  return (await res.json()) as McpOAuthStartResponse;
}

/** The service's page: where it sends the browser back. */
async function authorize(start: McpOAuthStartResponse): Promise<string> {
  const page = await fetch(start.authorizationUrl!, { redirect: 'manual' });
  expect(page.status).toBe(302);
  return page.headers.get('location')!;
}

describe('OAuth callback address (D-072)', () => {
  it('is where the browser reached the core; on the network, loopback and paste', () => {
    const core = 'http://127.0.0.1:4747';
    expect(oauthCallbackOrigin('127.0.0.1:51234', core)).toEqual({
      origin: 'http://127.0.0.1:51234',
      paste: false,
    });
    expect(oauthCallbackOrigin('localhost:4747', core)).toEqual({
      origin: 'http://127.0.0.1:4747',
      paste: false,
    });
    expect(oauthCallbackOrigin('[::1]:4800', core)).toEqual({
      origin: 'http://[::1]:4800',
      paste: false,
    });
    expect(oauthCallbackOrigin('192.168.1.20:4747', core)).toEqual({
      origin: 'http://127.0.0.1:4747',
      paste: true,
    });
    // Nothing usable: the address of the core.
    expect(oauthCallbackOrigin(undefined, core)).toEqual({ origin: core, paste: false });
    expect(oauthCallbackOrigin('evil.example/x?', core)).toEqual({ origin: core, paste: false });
    expect(oauthCallbackOrigin('127.0.0.1:99999', core)).toEqual({ origin: core, paste: false });
  });
});

describe('OAuth with the core on another computer (D-072)', () => {
  it('the callback comes back through the tunnel of the app, on its own port', async () => {
    const { as, t } = await setup();
    const tunnel = await tunnelTo(t.core.url);
    expect(tunnel).not.toBe(t.core.url);

    const start = await startVia(t, tunnel);
    expect(start.status).toBe('redirect');
    expect(start.redirectUri).toBe(`${tunnel}/api/mcp-oauth/callback`);
    expect(start.paste).toBeUndefined();
    expect(as.registrations.at(-1)!.redirect_uris).toEqual([start.redirectUri]);

    // The system browser of the user's computer opens the callback on the tunnel.
    const back = await authorize(start);
    expect(back.startsWith(start.redirectUri)).toBe(true);
    const page = await fetch(back);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('is connected');
    expect((await t.json<McpTestResponse>('POST', '/api/mcp-servers/notes/test')).ok).toBe(true);
  });

  it('a sign-in left halfway from another port keeps the tokens of the first', async () => {
    const { as, t } = await setup();
    const first = await tunnelTo(t.core.url);
    const page = await fetch(await authorize(await startVia(t, first)));
    expect(page.status).toBe(200);
    const record = readOAuthRecord(t.core.paths.secrets, 'notes');
    expect(record.redirectUri).toBe(`${first}/api/mcp-oauth/callback`);

    // The app came back with another local port: a new client, kept aside.
    const second = await tunnelTo(t.core.url);
    const again = await startVia(t, second);
    expect(again.status).toBe('redirect');
    expect(as.registrations).toHaveLength(2);
    const kept = readOAuthRecord(t.core.paths.secrets, 'notes');
    expect(kept.redirectUri).toBe(record.redirectUri);
    expect(kept.client).toEqual(record.client);
    expect((await t.json<McpTestResponse>('POST', '/api/mcp-servers/notes/test')).ok).toBe(true);

    // Finished: the new client and its tokens replace the old ones together.
    expect((await fetch(await authorize(again))).status).toBe(200);
    const now = readOAuthRecord(t.core.paths.secrets, 'notes');
    expect(now.redirectUri).toBe(`${second}/api/mcp-oauth/callback`);
    expect(now.client).not.toEqual(record.client);
    expect((await t.json<McpTestResponse>('POST', '/api/mcp-servers/notes/test')).ok).toBe(true);
  });

  it('the address of a callback page that did not open can be pasted, once', async () => {
    const { t } = await setup();
    const start = await t.json<McpOAuthStartResponse>('POST', '/api/mcp-servers/notes/oauth');
    const back = await authorize(start);

    const wrong = await t.json<McpOAuthFinishResponse>('POST', '/api/mcp-oauth/finish', {
      url: 'https://example.com/?code=x&state=y',
    });
    expect(wrong.ok).toBe(false);
    const notUrl = await t.json<McpOAuthFinishResponse>('POST', '/api/mcp-oauth/finish', {
      url: 'codice a caso',
    });
    expect(notUrl.ok).toBe(false);
    expect(notUrl.message).toContain('address');

    const done = await t.json<McpOAuthFinishResponse>('POST', '/api/mcp-oauth/finish', {
      url: back,
    });
    expect(done).toEqual({ ok: true, message: 'notes is connected.' });
    const view = await t.json<McpServersResponse>('GET', '/api/mcp-servers');
    expect(view.servers[0]!.oauth).toEqual({ connected: true, pending: false });
    // One use: the same address again is refused.
    const twice = await t.json<McpOAuthFinishResponse>('POST', '/api/mcp-oauth/finish', {
      url: back,
    });
    expect(twice.ok).toBe(false);
    // Only for the signed-in user.
    const anonymous = await fetch(`${t.core.url}/api/mcp-oauth/finish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-monsters-request': '1' },
      body: JSON.stringify({ url: back }),
    });
    expect(anonymous.status).toBe(401);
  });
});
