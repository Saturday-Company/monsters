import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fake } from '@monsters/providers/testing';
import type { LogEvent, McpOAuthStartResponse, McpServersResponse } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { signInNeeded } from '../src/mcp/manager.ts';
import { readOAuthRecord } from '../src/mcp/oauth.ts';
import { startFakeOAuthServer, type FakeOAuthServer } from './fixtures/fake-oauth-server.ts';
import { startTestHub, type TestHub } from './hub-helpers.ts';

/*
 * OAuth of a remote MCP server while the session is open (review of 18/10,
 * connettori 1 and 2): a grant revoked meanwhile, a token endpoint that is
 * down, and two calls that refresh at the same time with rotating tokens.
 */

const servers: FakeOAuthServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function setup(scripts: Parameters<typeof startTestHub>[0]) {
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
  const start = await t.json<McpOAuthStartResponse>('POST', '/api/mcp-servers/notes/oauth');
  const page = await fetch(start.authorizationUrl!, { redirect: 'manual' });
  expect((await fetch(page.headers.get('location')!)).status).toBe(200);
  return { as, t };
}

const results = (t: TestHub, runId: string) =>
  t
    .events(runId)
    .filter(
      (e): e is LogEvent<'tool_result'> =>
        e.type === 'tool_result' && e.data.tool === 'mcp__notes__add',
    );

async function run(t: TestHub, text: string): Promise<LogEvent<'tool_result'>[]> {
  const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text });
  await t.runEnded(sent.runId);
  return results(t, sent.runId);
}

const notes = async (t: TestHub) =>
  (await t.json<McpServersResponse>('GET', '/api/mcp-servers')).servers.find(
    (s) => s.name === 'notes',
  )!;

describe('MCP OAuth: the grant dies while the session is open', () => {
  it('asks to sign in again: the call is refused, the server stops, Giulio is told', async () => {
    const { as, t } = await setup({
      titan: [
        fake.toolCall('mcp__notes__add', { a: 1, b: 2 }),
        fake.text('ok'),
        fake.toolCall('mcp__notes__add', { a: 2, b: 2 }),
        fake.text('ok'),
      ],
    });
    const [first] = await run(t, 'prima');
    expect(first!.data).toMatchObject({ ok: true, output: '3' });

    // Password changed at the service: the access token and the refresh token are gone.
    as.revokeAll();
    const [second] = await run(t, 'dopo');
    expect(second!.data.ok).toBe(false);
    expect(second!.data.error).toMatch(/^NOT_LINKED: /);
    const seen = JSON.stringify(second!.data.output);
    expect(seen).toContain('Ask the user to reconnect Note remote');
    expect(seen).toContain('do not retry');
    expect(seen).not.toContain('Check the arguments');

    // The gallery says what to do, and the server is not "running" any more.
    const view = await notes(t);
    expect(view.status).toBe('error');
    expect(view.error).toBe(signInNeeded());
    expect(view.oauth).toMatchObject({ connected: false, needsSignIn: true });

    // One event for the phone and the app.
    const told = t
      .events()
      .filter(
        (e): e is LogEvent<'mcp_server'> =>
          e.type === 'mcp_server' && e.data.action === 'needs_signin',
      );
    expect(told).toHaveLength(1);
    expect(told[0]!.data).toMatchObject({ server: 'notes' });
    expect(told[0]!.data.message).toContain('Note remote');

    // A new sign-in clears it.
    const again = await t.json<McpOAuthStartResponse>('POST', '/api/mcp-servers/notes/oauth');
    const page = await fetch(again.authorizationUrl!, { redirect: 'manual' });
    expect((await fetch(page.headers.get('location')!)).status).toBe(200);
    const after = await notes(t);
    expect(after.oauth).toEqual({ connected: true, pending: false });
    expect(after.error).toBeUndefined();
  });

  it('the core keeps the native Response: a fetch answer is still `instanceof Response`', async () => {
    const { as } = await setup({ titan: [fake.text('ok')] });
    const res = await fetch(`${as.base}/.well-known/oauth-authorization-server`);
    expect(res).toBeInstanceOf(Response);
    expect(res.constructor).toBe(globalThis.Response);
  });

  it('a client the service forgot (invalid_client): sign in again, with a new client', async () => {
    const { as, t } = await setup({
      titan: [
        fake.toolCall('mcp__notes__add', { a: 1, b: 2 }),
        fake.text('ok'),
        fake.toolCall('mcp__notes__add', { a: 2, b: 2 }),
        fake.text('ok'),
      ],
    });
    await run(t, 'prima');
    const first = as.registrations.at(-1)!.client_id;
    as.forgetClients();
    const [second] = await run(t, 'dopo');
    expect(second!.data.error).toMatch(/^NOT_LINKED: /);
    // The SDK read the `invalid_client`: the client is gone, and no client was registered
    // at run time (only the user starts a sign-in).
    const saved = readOAuthRecord(join(t.home, 'secrets'), 'notes');
    expect(saved.client).toBeUndefined();
    expect(saved.tokens).toBeUndefined();
    expect(saved.signInNeeded).toBe(true);
    expect((await notes(t)).oauth).toMatchObject({ connected: false, needsSignIn: true });

    const again = await t.json<McpOAuthStartResponse>('POST', '/api/mcp-servers/notes/oauth');
    const page = await fetch(again.authorizationUrl!, { redirect: 'manual' });
    expect((await fetch(page.headers.get('location')!)).status).toBe(200);
    const after = readOAuthRecord(join(t.home, 'secrets'), 'notes');
    expect((after.client as { client_id: string }).client_id).not.toBe(first);
    expect((await notes(t)).oauth).toEqual({ connected: true, pending: false });
  });

  it('a token endpoint that is down is "not reachable", and the sign-in stays', async () => {
    const { as, t } = await setup({
      titan: [
        fake.toolCall('mcp__notes__add', { a: 1, b: 2 }),
        fake.text('ok'),
        fake.toolCall('mcp__notes__add', { a: 2, b: 2 }),
        fake.text('ok'),
      ],
    });
    await run(t, 'prima');
    as.refreshStatus = 503;
    as.expireAccessTokens();
    const [second] = await run(t, 'dopo');
    expect(second!.data.ok).toBe(false);
    expect(second!.data.error).toMatch(/^UNAVAILABLE: .*not reachable/);
    expect(JSON.stringify(second!.data.output)).not.toContain('reconnect');

    const view = await notes(t);
    expect(view.status).toBe('error');
    expect(view.error).toContain('can’t be reached');
    expect(view.oauth).toEqual({ connected: true, pending: false });
    expect(
      t.events().some((e) => e.type === 'mcp_server' && e.data.action === 'needs_signin'),
    ).toBe(false);
  });
});

describe('MCP OAuth: a call refused for its scope (403 insufficient_scope)', () => {
  const words = (s: string | null | undefined) => (s ?? '').split(' ').filter(Boolean).sort();

  it('«Collega» asks for the scope the server wants; the rest keeps working until then', async () => {
    const { as, t } = await setup({
      titan: [
        fake.toolCall('mcp__notes__add', { a: 1, b: 2 }),
        fake.text('ok'),
        fake.toolCall('mcp__notes__add', { a: 2, b: 2 }),
        fake.text('ok'),
      ],
    });
    as.requiredScope = 'read write notes:admin';
    const [first] = await run(t, 'prima');
    expect(first!.data.ok).toBe(false);
    expect(first!.data.error).toMatch(/^NOT_LINKED: /);
    const seen = JSON.stringify(first!.data.output);
    expect(seen).toContain('lacks a permission');
    expect(seen).toContain('Collega');

    // The card asks for «Collega» with the wider scope; the access is still there.
    const view = await notes(t);
    expect(view.oauth?.connected).toBe(true);
    expect(view.oauth?.needsSignIn).toBeUndefined();
    expect(words(view.oauth?.moreScope)).toEqual(['notes:admin', 'read', 'write']);
    expect(view.status).toBe('running');
    const told = t
      .events()
      .filter(
        (e): e is LogEvent<'mcp_server'> =>
          e.type === 'mcp_server' && e.data.action === 'needs_signin',
      );
    expect(told).toHaveLength(1);
    expect(told[0]!.data.message).toContain('one more permission');

    // «Collega»: the service's page asks for the wider scope, not a refresh of the old grant.
    const again = await t.json<McpOAuthStartResponse>('POST', '/api/mcp-servers/notes/oauth');
    expect(again.status).toBe('redirect');
    const page = await fetch(again.authorizationUrl!, { redirect: 'manual' });
    expect((await fetch(page.headers.get('location')!)).status).toBe(200);
    expect(words(as.scopesAsked.at(-1))).toEqual(['notes:admin', 'read', 'write']);
    const after = await notes(t);
    expect(after.oauth).toEqual({ connected: true, pending: false });

    const [second] = await run(t, 'dopo');
    expect(second!.data).toMatchObject({ ok: true, output: '4' });
  });
});

describe('MCP: a service given to the monster but not connected (connettori 6)', () => {
  it('the card of the monster says it, instead of giving tools that would all fail', async () => {
    const as = await startFakeOAuthServer();
    servers.push(as);
    const t = await startTestHub({ titan: [fake.text('ok'), fake.text('ok')] });
    await t.json('PUT', '/api/mcp-servers/notes', {
      transport: 'http',
      url: as.mcpUrl,
      oauth: true,
      label: 'Note remote',
      agents: ['titan'],
    });
    const system = (i: number) =>
      JSON.stringify(t.provider.calls[i]!.options.prompt.filter((m) => m.role === 'system'));
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'ciao' });
    await t.runEnded(sent.runId);
    expect(system(0)).toContain('Note remote non risponde ora');
    expect((t.provider.calls[0]!.options.tools ?? []).map((x) => x.name)).not.toContain(
      'mcp__notes__add',
    );

    // Signed in: the tools come, the line goes.
    const start = await t.json<McpOAuthStartResponse>('POST', '/api/mcp-servers/notes/oauth');
    const page = await fetch(start.authorizationUrl!, { redirect: 'manual' });
    expect((await fetch(page.headers.get('location')!)).status).toBe(200);
    const again = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'ancora' });
    await t.runEnded(again.runId);
    expect(system(1)).not.toContain('non è collegato');
    expect((t.provider.calls[1]!.options.tools ?? []).map((x) => x.name)).toContain(
      'mcp__notes__add',
    );
  });
});

describe('MCP OAuth: one refresh at a time (connettori 2, F-A7)', () => {
  it('two calls that find the token expired refresh once; the rotated tokens stay', async () => {
    const { as, t } = await setup({
      titan: [
        fake.toolCall('mcp__notes__add', { a: 1, b: 1 }),
        fake.text('ok'),
        fake.toolCalls([
          { name: 'mcp__notes__add', input: { a: 2, b: 3 } },
          { name: 'mcp__notes__add', input: { a: 4, b: 5 } },
        ]),
        fake.text('ok'),
      ],
    });
    await run(t, 'prima');
    // Both calls get the 401 before the first refresh answers.
    as.refreshDelayMs = 150;
    as.expireAccessTokens();
    const both = await run(t, 'insieme');
    expect(both.map((r) => r.data.ok)).toEqual([true, true]);
    expect(both.map((r) => r.data.output).sort()).toEqual(['5', '9']);
    expect(as.grants.filter((g) => g === 'refresh_token')).toHaveLength(1);

    // Still signed in, with the tokens of the one refresh.
    const file = join(t.home, 'secrets', 'mcp-oauth-notes.json');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain(as.issued.refresh.at(-1)!);
    expect((await notes(t)).oauth).toEqual({ connected: true, pending: false });
  });
});
