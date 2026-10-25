import { fake } from '@monsters/providers/testing';
import {
  ToolError,
  type LogEvent,
  type McpOAuthStartResponse,
  type MonstersTool,
} from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeAnteiku, type FakeAnteiku } from './fixtures/fake-anteiku-server.ts';
import { startTestHub, type TestHub } from './hub-helpers.ts';

/*
 * HTTP MCP connections that fail while the monster works (D-163, P8), against the fake Anteiku
 * (OAuth 2.1 with rotating refresh tokens, or a personal token): a 401 renews the sign-in once
 * or asks the user for a new one, a slow call ends with an error that says it may have run, and
 * a server that cuts the connection or answers 5xx is reached again by the next call.
 */

const servers: FakeAnteiku[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function anteiku(t: TestHub, how: 'oauth' | 'token'): Promise<FakeAnteiku> {
  const fa = await startFakeAnteiku();
  servers.push(fa);
  await t.json('PUT', '/api/mcp-servers/anteiku', {
    transport: 'http',
    url: fa.mcpUrl,
    label: 'Anteiku',
    catalog: 'anteiku',
    agents: ['*'],
    ...(how === 'oauth'
      ? { oauth: true }
      : { headers: { Authorization: `Bearer ${fa.personalToken}` } }),
  });
  if (how === 'oauth') {
    const start = await t.json<McpOAuthStartResponse>('POST', '/api/mcp-servers/anteiku/oauth');
    const page = await fetch(start.authorizationUrl!, { redirect: 'manual' });
    expect((await fetch(page.headers.get('location')!)).status).toBe(200);
  }
  return fa;
}

const ctx = () => ({
  agentId: 'titan',
  runId: 'r',
  signal: new AbortController().signal,
  emit: () => {},
});

async function tool(t: TestHub, name: string): Promise<MonstersTool> {
  const hub = t.core.hub;
  const all = await hub.mcp.toolsFor(hub.team.get('titan')!, undefined, { deferred: true });
  const found = all.find((x) => x.name === `mcp__anteiku__${name}`);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

async function failure(call: Promise<unknown>): Promise<ToolError> {
  try {
    await call;
  } catch (err) {
    expect(err).toBeInstanceOf(ToolError);
    return err as ToolError;
  }
  throw new Error('the call did not fail');
}

const view = (t: TestHub) => t.core.hub.mcp.view().servers.find((s) => s.name === 'anteiku')!;
const mcpEvents = (t: TestHub, action: string) =>
  t
    .events()
    .filter(
      (e): e is LogEvent<'mcp_server'> => e.type === 'mcp_server' && e.data.action === action,
    );
const refreshes = (fa: FakeAnteiku) => fa.grants.filter((g) => g === 'refresh_token').length;

describe('MCP over HTTP: a 401 on a call', () => {
  it('an expired access token is renewed with the refresh token and the call is made once', async () => {
    const t = await startTestHub({});
    const fa = await anteiku(t, 'oauth');
    const list = await tool(t, 'anteiku_clienti_elenca');
    await list.execute({}, ctx());
    expect(fa.calls).toHaveLength(1);

    fa.expireAccessTokens();
    const out = await list.execute({}, ctx());
    expect(String(out)).toContain('elementi');
    expect(refreshes(fa)).toBe(1);
    // The 401 did not run the tool: one call at the server for each call of the monster.
    expect(fa.calls).toHaveLength(2);
    expect(view(t).status).toBe('running');

    // The rotated tokens are in use: the next call renews nothing.
    await list.execute({}, ctx());
    expect(refreshes(fa)).toBe(1);
    expect(mcpEvents(t, 'needs_signin')).toHaveLength(0);
  });

  it('a write that finds the token expired is made once, after the renewal', async () => {
    const t = await startTestHub({});
    const fa = await anteiku(t, 'oauth');
    const create = await tool(t, 'anteiku_clienti_crea');
    await create.execute({ nome: 'Uno' }, ctx());
    fa.expireAccessTokens();
    await create.execute({ nome: 'Due' }, ctx());
    expect(fa.calls.map((c) => c.args['nome'])).toEqual(['Uno', 'Due']);
    expect(refreshes(fa)).toBe(1);
  });

  it('a refresh token that is gone: NOT_LINKED, the server is unlinked, one event, no retry storm', async () => {
    const t = await startTestHub({
      titan: [fake.toolCall('mcp__anteiku__anteiku_clienti_elenca', {}), fake.text('ok')],
    });
    const fa = await anteiku(t, 'oauth');
    const list = await tool(t, 'anteiku_clienti_elenca');
    await list.execute({}, ctx());

    fa.revokeAll();
    const err = await failure(list.execute({}, ctx()));
    expect(err.code).toBe('NOT_LINKED');
    // Not the user's no, and not an error of the arguments: the user reconnects it.
    expect(err.message).toContain('needs the user to sign in again');
    expect(err.message).not.toMatch(/denied|declined|not allowed/i);
    expect(err.hint).toContain('Ask the user to reconnect Anteiku');
    expect(err.hint).toContain('do not retry');
    // One refresh attempt, then nothing more: the call was not repeated.
    expect(refreshes(fa)).toBe(1);
    expect(fa.calls).toHaveLength(1);

    const told = mcpEvents(t, 'needs_signin');
    expect(told).toHaveLength(1);
    expect(told[0]!.data.message).toContain('Anteiku');
    expect(view(t)).toMatchObject({
      status: 'error',
      oauth: { connected: false, needsSignIn: true },
    });
    expect(t.core.hub.mcp.unlinkedFor(t.core.hub.team.get('titan')!)).toEqual(['Anteiku']);

    // The next call does not go to the service again, and says the same.
    const again = await failure(list.execute({}, ctx()));
    expect(again.code).toBe('NOT_LINKED');
    expect(refreshes(fa)).toBe(1);
    expect(fa.calls).toHaveLength(1);
    expect(mcpEvents(t, 'needs_signin')).toHaveLength(1);

    // From the next run the card lists it and the monster has no tool that would fail.
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'clienti' });
    await t.runEnded(sent.runId);
    expect(
      (t.provider.calls[0]!.options.tools ?? []).filter((x) => x.name.startsWith('mcp__anteiku__')),
    ).toEqual([]);
    expect(JSON.stringify(t.provider.calls[0]!.options.prompt)).toContain('Anteiku');
    expect(t.core.hub.mcp.unlinkedFor(t.core.hub.team.get('titan')!)).toEqual(['Anteiku']);
  });

  it('a personal token that is refused: NOT_LINKED saying the key was refused, no renewal', async () => {
    const t = await startTestHub({});
    const fa = await anteiku(t, 'token');
    const list = await tool(t, 'anteiku_clienti_elenca');
    await list.execute({}, ctx());

    fa.revokePersonalToken();
    const err = await failure(list.execute({}, ctx()));
    expect(err.code).toBe('NOT_LINKED');
    expect(err.message).toContain('refused the access key');
    expect(err.hint).toContain('check the access key of Anteiku');
    expect(err.hint).toContain('do not retry');
    // No OAuth: nothing to renew, nothing registered.
    expect(fa.grants).toEqual([]);
    expect(fa.registrations).toHaveLength(0);
    expect(fa.calls).toHaveLength(1);

    expect(view(t).status).toBe('error');
    expect(t.core.hub.mcp.unlinkedFor(t.core.hub.team.get('titan')!)).toEqual(['Anteiku']);
    expect(mcpEvents(t, 'failed').some((e) => e.data.message?.includes('headers'))).toBe(true);
    // And the next call does not knock again.
    const again = await failure(list.execute({}, ctx()));
    expect(again.code).toBe('NOT_LINKED');
  });
});

describe('MCP over HTTP: a call that takes too long', () => {
  it('ends with an error that says it timed out and may have run; the connection stays usable', async () => {
    const t = await startTestHub({});
    const fa = await anteiku(t, 'token');
    t.core.hub.settings.mcpServers['anteiku']!.timeoutSec = 1;
    const write = await tool(t, 'anteiku_clienti_crea');
    const read = await tool(t, 'anteiku_clienti_elenca');
    await read.execute({}, ctx());

    fa.fault({ delayMs: 1800 });
    const started = Date.now();
    const err = await failure(write.execute({ nome: 'Lento' }, ctx()));
    expect(Date.now() - started).toBeLessThan(1700);
    expect(err.code).toBe('UNAVAILABLE');
    expect(err.message).toContain('did not answer within 1 s');
    expect(err.hint).toMatch(/may still complete on the server/);
    expect(err.hint).toMatch(/do not repeat it/);

    // The next call goes through at once, on the same connection.
    expect(String(await read.execute({}, ctx()))).toContain('elementi');
    expect(view(t).status).toBe('running');
    // The slow write did run at the server, as the hint warned.
    await new Promise((r) => setTimeout(r, 1000));
    expect(fa.calls.filter((c) => c.tool === 'anteiku_clienti_crea')).toHaveLength(1);
    expect(mcpEvents(t, 'disconnected')).toHaveLength(0);
  });
});

describe('MCP over HTTP: the server drops the connection or fails', () => {
  it('a cut connection on a read: the call reconnects and is made again, nobody is asked', async () => {
    const t = await startTestHub({});
    const fa = await anteiku(t, 'token');
    const read = await tool(t, 'anteiku_clienti_elenca');
    await read.execute({}, ctx());

    fa.fault({ drop: true });
    expect(String(await read.execute({}, ctx()))).toContain('elementi');
    expect(fa.calls).toHaveLength(2);
    expect(view(t).status).toBe('running');
  });

  it('a cut connection on a write: UNAVAILABLE that says to check first; the next call works', async () => {
    const t = await startTestHub({});
    const fa = await anteiku(t, 'token');
    const write = await tool(t, 'anteiku_clienti_crea');
    await write.execute({ nome: 'Uno' }, ctx());

    fa.fault({ drop: true });
    const err = await failure(write.execute({ nome: 'Due' }, ctx()));
    expect(err.code).toBe('UNAVAILABLE');
    expect(err.message).toMatch(/connection to the MCP server "anteiku" was lost/);
    expect(err.hint).toMatch(/check whether the action was done/);
    expect(err.hint).toMatch(/may already have been applied/);
    // The write was not repeated behind the model's back.
    expect(fa.calls).toHaveLength(1);
    expect(view(t).status).not.toBe('error');

    await write.execute({ nome: 'Tre' }, ctx());
    expect(fa.calls.map((c) => c.args['nome'])).toEqual(['Uno', 'Tre']);
    expect(view(t).status).toBe('running');
  });

  it('a 500 on a write: UNAVAILABLE, not repeated; the next call works without the user', async () => {
    const t = await startTestHub({});
    const fa = await anteiku(t, 'token');
    const write = await tool(t, 'anteiku_clienti_crea');
    await write.execute({ nome: 'Uno' }, ctx());

    fa.fault({ status: 500 });
    const err = await failure(write.execute({ nome: 'Due' }, ctx()));
    expect(err.code).toBe('UNAVAILABLE');
    expect(err.message).toContain('HTTP 500');
    expect(err.hint).toMatch(/not your arguments/);
    // The server may have done the work before failing: check, do not just retry (C-2).
    expect(err.hint).toMatch(/may already have been applied/);
    expect(err.hint).not.toMatch(/retry later/);
    expect(fa.calls).toHaveLength(1);

    await write.execute({ nome: 'Tre' }, ctx());
    expect(fa.calls.map((c) => c.args['nome'])).toEqual(['Uno', 'Tre']);
    expect(view(t).status).toBe('running');
  });

  it('a server that is gone: the call fails as unavailable, then waits before knocking again', async () => {
    const t = await startTestHub({});
    const fa = await anteiku(t, 'token');
    const read = await tool(t, 'anteiku_clienti_elenca');
    await read.execute({}, ctx());
    await fa.close();

    const first = await failure(read.execute({}, ctx()));
    expect(first.code).toBe('UNAVAILABLE');
    // The reconnection finds nobody: the monster is told the service is down, not to rephrase.
    expect(first.hint).toContain('go on without it or try later');
    expect(view(t).status).toBe('error');
    // Within the pause the next call does not knock again.
    const second = await failure(read.execute({}, ctx()));
    expect(second.code).toBe('UNAVAILABLE');
    expect(second.hint).toContain('go on without it or try later');
  });

  it('a server that keeps failing to answer is `brokenNow`: unlinked, as at any start', async () => {
    const t = await startTestHub({});
    const fa = await anteiku(t, 'token');
    const read = await tool(t, 'anteiku_clienti_elenca');
    await read.execute({}, ctx());
    await fa.close();
    await failure(read.execute({}, ctx()));
    // The test button always tries again: three starts in a row that fail.
    for (let i = 0; i < 3; i++) expect((await t.core.hub.mcp.test('anteiku')).ok).toBe(false);
    expect(t.core.hub.mcp.unlinkedFor(t.core.hub.team.get('titan')!)).toEqual(['Anteiku']);
  });
});
