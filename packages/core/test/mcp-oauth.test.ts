import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fake } from '@monsters/providers/testing';
import type {
  LogEvent,
  McpOAuthStartResponse,
  McpServersResponse,
  McpTestResponse,
} from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  McpOAuth,
  isSafeBrowserUrl,
  oauthCallbackHost,
  readOAuthRecord,
} from '../src/mcp/oauth.ts';
import { oauthResultPage } from '../src/server/routes/mcp.ts';
import { startFakeOAuthServer, type FakeOAuthServer } from './fixtures/fake-oauth-server.ts';
import { startTestHub, type TestHub } from './hub-helpers.ts';

/*
 * OAuth sign-in of remote MCP servers (D-063) against a fake authorization
 * server: registration, PKCE and `state`, the callback on the core, tokens
 * kept secret, refresh after a 401, revocation when signing out or removing.
 */

const POSIX = process.platform !== 'win32';

const servers: FakeOAuthServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function setup(scripts: Parameters<typeof startTestHub>[0] = {}) {
  const as = await startFakeOAuthServer();
  servers.push(as);
  const t = await startTestHub(scripts);
  await t.json('PUT', '/api/mcp-servers/notes', {
    transport: 'http',
    url: as.mcpUrl,
    oauth: true,
    catalog: 'notes',
    label: 'Note remote',
    agents: ['titan'],
  });
  return { as, t };
}

/** The user's browser: opens the page of the service, follows it back to the core. */
async function signIn(t: TestHub, as: FakeOAuthServer): Promise<Response> {
  const start = await t.json<McpOAuthStartResponse>('POST', '/api/mcp-servers/notes/oauth');
  expect(start.status).toBe('redirect');
  const page = await fetch(start.authorizationUrl!, { redirect: 'manual' });
  expect(page.status).toBe(302);
  const back = page.headers.get('location')!;
  expect(back.startsWith(start.redirectUri)).toBe(true);
  void as;
  return fetch(back);
}

const toolResult = (t: TestHub, runId: string, tool: string) =>
  t
    .events(runId)
    .find((e): e is LogEvent<'tool_result'> => e.type === 'tool_result' && e.data.tool === tool);

describe('MCP OAuth: helpers', () => {
  it('sends the browser only to https or to loopback', () => {
    expect(isSafeBrowserUrl(new URL('https://mcp.notion.com/authorize'))).toBe(true);
    expect(isSafeBrowserUrl(new URL('http://127.0.0.1:9/authorize'))).toBe(true);
    expect(isSafeBrowserUrl(new URL('http://evil.example/authorize'))).toBe(false);
    expect(isSafeBrowserUrl(new URL('javascript:alert(1)'))).toBe(false);
    expect(isSafeBrowserUrl(new URL('https://u:p@x.it/'))).toBe(false);
  });

  it('builds the callback host from the address of the core', () => {
    expect(oauthCallbackHost('127.0.0.1')).toBe('127.0.0.1');
    expect(oauthCallbackHost('0.0.0.0')).toBe('127.0.0.1');
    expect(oauthCallbackHost('::1')).toBe('[::1]');
    expect(oauthCallbackHost('100.64.1.2')).toBe('100.64.1.2');
  });

  it('the result page never carries markup from the service', () => {
    const html = oauthResultPage(false, '<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('MCP OAuth: sign-in, use, refresh, sign-out', () => {
  it('signs in with PKCE and state, keeps the tokens secret, refreshes, revokes', async () => {
    const { as, t } = await setup({
      titan: [
        fake.toolCall('mcp__notes__add', { a: 2, b: 3 }),
        fake.text('ok'),
        fake.toolCall('mcp__notes__add', { a: 4, b: 5 }),
        fake.text('ok'),
      ],
    });

    // Before the sign-in: nothing asked to the server, a clear sentence.
    let view = await t.json<McpServersResponse>('GET', '/api/mcp-servers');
    expect(view.servers[0]).toMatchObject({
      name: 'notes',
      catalog: 'notes',
      oauth: { connected: false, pending: false },
    });
    const before = await t.json<McpTestResponse>('POST', '/api/mcp-servers/notes/test');
    expect(before.ok).toBe(false);
    expect(before.error).toContain('Collega');

    // Start: registration with our callback, then the page of the service.
    const start = await t.json<McpOAuthStartResponse>('POST', '/api/mcp-servers/notes/oauth');
    expect(start.status).toBe('redirect');
    expect(start.redirectUri).toBe(`${t.core.url}/api/mcp-oauth/callback`);
    const auth = new URL(start.authorizationUrl!);
    expect(auth.origin).toBe(as.base);
    expect(auth.searchParams.get('response_type')).toBe('code');
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(auth.searchParams.get('redirect_uri')).toBe(start.redirectUri);
    expect(auth.searchParams.get('resource')).toBe(as.mcpUrl);
    const state = auth.searchParams.get('state')!;
    expect(state.length).toBeGreaterThanOrEqual(40);
    expect(as.registrations).toHaveLength(1);
    expect(as.registrations[0]!.redirect_uris).toEqual([start.redirectUri]);
    view = await t.json<McpServersResponse>('GET', '/api/mcp-servers');
    expect(view.servers[0]!.oauth).toEqual({ connected: false, pending: true });

    // A callback with another state is refused, and does not spend the real one.
    const forged = await fetch(`${start.redirectUri}?code=x&state=not-the-state`);
    expect(forged.status).toBe(400);
    expect(await forged.text()).toContain('non è più valido');

    const page = await fetch(start.authorizationUrl!, { redirect: 'manual' });
    const back = page.headers.get('location')!;
    const done = await fetch(back);
    expect(done.status).toBe(200);
    expect(done.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await done.text()).toContain('Note remote è collegato');
    // The same code and state again: refused (one use).
    expect((await fetch(back)).status).toBe(400);

    view = await t.json<McpServersResponse>('GET', '/api/mcp-servers');
    expect(view.servers[0]!.oauth).toEqual({ connected: true, pending: false });
    const ok = await t.json<McpTestResponse>('POST', '/api/mcp-servers/notes/test');
    expect(ok.ok).toBe(true);
    expect(ok.tools.map((x) => x.name)).toContain('add');

    // An agent uses it.
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'somma' });
    await t.runEnded(sent.runId);
    expect(toolResult(t, sent.runId, 'mcp__notes__add')!.data).toMatchObject({
      ok: true,
      output: '5',
    });

    // The access token expires: the SDK refreshes it (rotation) and the call goes on.
    as.expireAccessTokens();
    const again = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'ancora' });
    await t.runEnded(again.runId);
    expect(toolResult(t, again.runId, 'mcp__notes__add')!.data).toMatchObject({
      ok: true,
      output: '9',
    });
    expect(as.grants).toEqual(['authorization_code', 'refresh_token']);

    // Secrets: in their own file (600), never in the log nor in the API.
    const file = join(t.home, 'secrets', 'mcp-oauth-notes.json');
    expect(existsSync(file)).toBe(true);
    if (POSIX) expect(statSync(file).mode & 0o777).toBe(0o600);
    const saved = readFileSync(file, 'utf8');
    expect(saved).toContain(as.issued.access.at(-1)!);
    const everything =
      JSON.stringify(t.events()) +
      JSON.stringify(await t.json('GET', '/api/mcp-servers')) +
      JSON.stringify(start);
    for (const token of [...as.issued.access, ...as.issued.refresh]) {
      expect(everything).not.toContain(token);
    }
    expect(
      t
        .events()
        .some(
          (e) =>
            e.type === 'mcp_server' && e.data.action === 'signed_in' && e.data.server === 'notes',
        ),
    ).toBe(true);

    // Sign out: tokens revoked at the service and forgotten here.
    const out = await t.json<McpServersResponse>('DELETE', '/api/mcp-servers/notes/oauth');
    expect(out.servers[0]!.oauth).toEqual({ connected: false, pending: false });
    expect(as.revoked).toEqual([as.issued.refresh.at(-1), as.issued.access.at(-1)]);
    expect(existsSync(file)).toBe(false);
    const after = await t.json<McpTestResponse>('POST', '/api/mcp-servers/notes/test');
    expect(after.ok).toBe(false);
  });

  it('a denied sign-in connects nothing; removing the server revokes its tokens', async () => {
    const { as, t } = await setup();
    as.deny = true;
    const denied = await signIn(t, as);
    expect(denied.status).toBe(400);
    expect(await denied.text()).toContain('Hai rifiutato l’accesso');
    let view = await t.json<McpServersResponse>('GET', '/api/mcp-servers');
    expect(view.servers[0]!.oauth).toEqual({ connected: false, pending: false });

    as.deny = false;
    expect((await signIn(t, as)).status).toBe(200);
    // A second start with working tokens needs no page: refreshed and connected.
    const again = await t.json<McpOAuthStartResponse>('POST', '/api/mcp-servers/notes/oauth');
    expect(again.status).toBe('connected');
    // The client registered once, for the same callback.
    expect(as.registrations).toHaveLength(1);

    view = await t.json<McpServersResponse>('DELETE', '/api/mcp-servers/notes');
    expect(view.servers).toEqual([]);
    expect(as.revoked).toContain(as.issued.refresh.at(-1));
    expect(existsSync(join(t.home, 'secrets', 'mcp-oauth-notes.json'))).toBe(false);
  });

  it('OAuth only for web services, and only on OAuth servers', async () => {
    const { t } = await setup();
    const stdio = await t.api('PUT', '/api/mcp-servers/local', {
      transport: 'stdio',
      command: 'npx',
      oauth: true,
    });
    expect(stdio.status).toBe(400);
    await t.json('PUT', '/api/mcp-servers/plain', {
      transport: 'http',
      url: 'https://example.com/mcp',
    });
    const res = await t.api('POST', '/api/mcp-servers/plain/oauth');
    expect(res.status).toBe(400);
    expect((await t.api('POST', '/api/mcp-servers/nope/oauth')).status).toBe(404);
    // The callback needs no session but a state: without one, a plain refusal.
    expect((await fetch(`${t.core.url}/api/mcp-oauth/callback`)).status).toBe(400);
  });

  it('a service that does not answer gives a sentence, not a crash', async () => {
    const t = await startTestHub({});
    await t.json('PUT', '/api/mcp-servers/gone', {
      transport: 'http',
      url: 'http://127.0.0.1:9/mcp',
      oauth: true,
    });
    const res = await t.api('POST', '/api/mcp-servers/gone/oauth');
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('oauth_failed');
    expect(body.message).toContain('Non riesco a preparare l’accesso');
  });
});

describe('OAuth: a refresh at run time and the end of a sign-in (review of 19/10, 10)', () => {
  it('the refresh on its way when a sign-in with a new client ends never saves over it', async () => {
    const as = await startFakeOAuthServer();
    servers.push(as);
    const secretsDir = mkdtempSync(join(tmpdir(), 'mcp-oauth-'));
    const oauth = new McpOAuth({ secretsDir, onSecret: () => {} });
    const signIn = async (redirectUri: string) => {
      const start = await oauth.start('notes', as.mcpUrl, redirectUri);
      if (start.status !== 'redirect') throw new Error('no page');
      const page = await fetch(start.authorizationUrl, { redirect: 'manual' });
      return new URL(page.headers.get('location')!).searchParams;
    };
    await oauth.finish(await signIn('http://127.0.0.1:1111/cb'));
    // A sign-in from another port (a new client) is halfway...
    const back = await signIn('http://127.0.0.1:2222/cb');
    // ...when a call finds its token expired and renews it, slowly, with the old client.
    as.expireAccessTokens();
    as.refreshDelayMs = 300;
    const { authProvider } = oauth.runtime('notes', 'http://127.0.0.1:1111/cb');
    const unauthorized = new Response('{}', {
      status: 401,
      headers: {
        'www-authenticate': `Bearer resource_metadata="${as.base}/.well-known/oauth-protected-resource/mcp"`,
      },
    });
    const refreshing = authProvider.onUnauthorized!({
      response: unauthorized,
      serverUrl: new URL(as.mcpUrl),
      fetchFn: fetch,
    });
    while (!as.grants.includes('refresh_token')) await new Promise((r) => setTimeout(r, 5));
    await oauth.finish(back);
    await refreshing;
    // The new client with its own tokens: they renew at the service.
    const record = readOAuthRecord(secretsDir, 'notes');
    const client = record.client as { client_id: string };
    expect(client.client_id).toBe(as.registrations.at(-1)!.client_id);
    as.refreshDelayMs = 0;
    const renewed = await fetch(`${as.base}/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: (record.tokens as { refresh_token: string }).refresh_token,
        client_id: client.client_id,
      }),
    });
    expect(renewed.status).toBe(200);
  });
});

describe('OAuth requests have a time limit', () => {
  it('a server that accepts the connection and never answers ends the sign-in with an error', async () => {
    const silent = createServer(() => {});
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
    try {
      const port = (silent.address() as { port: number }).port;
      const oauth = new McpOAuth({
        secretsDir: mkdtempSync(join(tmpdir(), 'mcp-oauth-')),
        onSecret: () => {},
        requestTimeoutMs: 200,
      });
      const started = Date.now();
      await expect(
        oauth.start('silent', `http://127.0.0.1:${port}/mcp`, 'http://127.0.0.1:1/cb'),
      ).rejects.toThrow('Non riesco a preparare l’accesso');
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      silent.closeAllConnections();
      silent.close();
    }
  });
});
