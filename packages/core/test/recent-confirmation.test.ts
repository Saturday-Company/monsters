import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServerRequestSchema, type McpServersResponse } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { ConfirmRequiredError, recentProofOf } from '../src/auth/recent.ts';
import { McpServerSettingSchema } from '../src/mcp/config.ts';
import { runsNewCode } from '../src/mcp/manager.ts';
import { RECENT, startTestHub, TERMINAL_OFF, type TestHub } from './hub-helpers.ts';

/*
 * Review of 28/10 (P0 7, weakness 4): the password typed in the last minutes is a capability a
 * service asks for (`RecentProof`, auth/recent.ts), not a list of paths. A stdio MCP server is a
 * program the core launches as the user: adding one or changing what it runs wants it like the
 * Terminal of a monster does. The Telegram side is in telegram-bots.test.ts (it needs the fake
 * Bot API).
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-mcp-server.ts', import.meta.url));
const SECRET = 'tok-SEGRETO-4f9a2c71';

const stdio = (extra: Record<string, unknown> = {}, flags: string[] = []) => ({
  transport: 'stdio',
  command: process.execPath,
  args: [FIXTURE, ...flags],
  env: { FAKE_TOKEN: SECRET },
  agents: ['titan'],
  ...extra,
});

/**
 * A hub whose session of the user in person is there (made on the first owner call) and was
 * confirmed with the password a quarter of an hour ago: still the user's, no longer recent.
 */
async function staleHub(options: Parameters<typeof startTestHub>[1] = {}): Promise<TestHub> {
  const t = await startTestHub({}, options);
  await t.ownerJson('GET', '/api/permissions');
  stale(t);
  return t;
}
const stale = (t: TestHub) =>
  t.core.db.run('UPDATE sessions SET confirmed_at = ?', Date.now() - 16 * 60_000);
const fresh = (t: TestHub) => t.core.db.run('UPDATE sessions SET confirmed_at = ?', Date.now());

const servers = (t: TestHub) => t.json<McpServersResponse>('GET', '/api/mcp-servers');

async function refused(res: Response) {
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: 'confirm_required' });
}

describe('MCP servers: a program the core launches wants the recent password', () => {
  it('adding a stdio server is refused to an old session and nothing is saved', async () => {
    const t = await staleHub();
    await refused(await t.api('PUT', '/api/mcp-servers/fake', stdio()));
    expect((await servers(t)).servers).toEqual([]);
    expect(existsSync(join(t.core.paths.secrets, 'mcp-fake.json'))).toBe(false);
    expect(t.events().some((e) => e.type === 'mcp_server')).toBe(false);

    // The password typed in the session: the same request goes through.
    fresh(t);
    expect((await t.api('PUT', '/api/mcp-servers/fake', stdio())).status).toBe(200);
    expect((await servers(t)).servers.map((s) => s.name)).toEqual(['fake']);
  });

  it('a change of command, arguments or variables asks it; who uses the server does not', async () => {
    const t = await startTestHub({});
    await t.ownerJson('PUT', '/api/mcp-servers/fake', stdio());
    stale(t);
    const put = (body: unknown) => t.api('PUT', '/api/mcp-servers/fake', body);

    await refused(await put({ command: '/bin/sh' }));
    await refused(await put({ args: [FIXTURE, '--evil'] }));
    await refused(await put({ env: { FAKE_TOKEN: SECRET, NODE_OPTIONS: '--require=/tmp/x.js' } }));
    await refused(await put({ env: {} }));
    const before = (await servers(t)).servers[0]!;
    expect(before).toMatchObject({ envKeys: ['FAKE_TOKEN'], status: 'idle' });

    // Not code: the monsters that use it, the tools, the timeout, off and on, the same
    // configuration sent again (the UI sends the whole form), an empty value that keeps the secret.
    expect((await put({ agents: ['rhea'] })).status).toBe(200);
    expect((await put({ tools: ['echo'], timeoutSec: 30 })).status).toBe(200);
    expect((await put({ enabled: false })).status).toBe(200);
    expect((await put({ enabled: true })).status).toBe(200);
    expect((await put(stdio({ agents: ['dione'] }))).status).toBe(200);
    expect((await put({ env: { FAKE_TOKEN: '' } })).status).toBe(200);
    const after = (await servers(t)).servers[0]!;
    expect(after).toMatchObject({ agents: ['dione'], command: before.command });

    // Fresh again: the change is made.
    fresh(t);
    expect((await put({ command: '/bin/sh' })).status).toBe(200);
  });

  it('a server that becomes stdio asks it; a web one, or one that stops being stdio, does not', async () => {
    const t = await startTestHub({});
    await t.ownerJson('PUT', '/api/mcp-servers/remote', {
      transport: 'http',
      url: 'https://example.com/mcp',
      agents: ['titan'],
    });
    await t.ownerJson('PUT', '/api/mcp-servers/fake', stdio());
    stale(t);
    await refused(await t.api('PUT', '/api/mcp-servers/remote', stdio()));
    expect((await servers(t)).servers.find((s) => s.name === 'remote')).toMatchObject({
      transport: 'http',
    });
    expect(
      (
        await t.api('PUT', '/api/mcp-servers/web', {
          transport: 'http',
          url: 'https://example.com/other',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await t.api('PUT', '/api/mcp-servers/fake', {
          transport: 'http',
          url: 'https://example.com/fake',
        })
      ).status,
    ).toBe(200);
  });

  it('is the manager that decides, not the route: no proof, no stdio program', async () => {
    const t = await startTestHub({});
    const req = McpServerRequestSchema.parse(stdio());
    const mcp = t.core.hub.mcp;
    await expect(mcp.upsert('direct', req, 'cli', undefined)).rejects.toBeInstanceOf(
      ConfirmRequiredError,
    );
    expect(mcp.view().servers).toEqual([]);
    // Not the user in person, or not recent: no proof either.
    expect(recentProofOf({ owner: false, recent: false })).toBeUndefined();
    expect(recentProofOf({ owner: true, recent: false })).toBeUndefined();
    expect(recentProofOf(undefined)).toBeUndefined();
    await mcp.upsert('direct', req, 'ui', RECENT);
    expect(mcp.view().servers.map((s) => s.name)).toEqual(['direct']);
    // A card that only widens who uses it (access requests) needs none.
    await mcp.upsert('direct', { agents: ['rhea'] }, 'ui', undefined);
  });

  it('what runs new code: the browser preset is the core’s own program', () => {
    const base = { transport: 'stdio', command: 'uvx', args: ['pkg'] } as const;
    const prev = McpServerSettingSchema.parse(base);
    const same = (next: Record<string, unknown>, env = {}, prevEnv = {}) =>
      runsNewCode(prev, McpServerSettingSchema.parse({ ...base, ...next }), env, prevEnv);
    expect(same({})).toBe(false);
    expect(same({ args: ['pkg', '--x'] })).toBe(true);
    expect(same({ command: 'npx' })).toBe(true);
    expect(same({ timeoutSec: 60, enabled: false })).toBe(false);
    expect(same({}, { A: '1', B: '2' }, { B: '2', A: '1' })).toBe(false);
    expect(same({}, { A: '1' }, {})).toBe(true);
    const browser = McpServerSettingSchema.parse({ transport: 'stdio', preset: 'browser' });
    expect(runsNewCode(undefined, browser, {}, {})).toBe(false);
    expect(runsNewCode(browser, browser, {}, {})).toBe(false);
    // Its variables reach the program: `NODE_OPTIONS` is code.
    const hook = { NODE_OPTIONS: '--import=data:text/javascript,0' };
    expect(runsNewCode(undefined, browser, hook, {})).toBe(true);
    expect(runsNewCode(browser, browser, hook, {})).toBe(true);
    expect(runsNewCode(browser, browser, hook, hook)).toBe(false);
    expect(runsNewCode(prev, browser, {}, { A: '1' })).toBe(false);
    expect(runsNewCode(undefined, prev, {}, {})).toBe(true);
    const http = McpServerSettingSchema.parse({ transport: 'http', url: 'https://example.com' });
    expect(runsNewCode(undefined, http, {}, {})).toBe(false);
    expect(runsNewCode(prev, http, {}, {})).toBe(false);
    expect(runsNewCode(http, prev, {}, {})).toBe(true);
  });
});

describe('the Terminal is decided by the permissions service', () => {
  it('a grant without the proof is refused whatever the route; with it, it goes through', async () => {
    const t = await startTestHub({}, { hub: { settings: TERMINAL_OFF } });
    const grant = { agents: { rhea: { vault: true, web: true, shell: true, folders: [] } } };
    await expect(t.core.hub.permissions.update(grant, 'ui', undefined)).rejects.toBeInstanceOf(
      ConfirmRequiredError,
    );
    expect(t.core.hub.team.permissionsFor('rhea').shell).toBe(false);
    // Less power, or the same: no proof needed.
    await t.core.hub.permissions.update(
      { agents: { rhea: { vault: true, web: false, folders: [] } } },
      'ui',
      undefined,
    );
    await t.core.hub.permissions.update(grant, 'ui', RECENT);
    expect(t.core.hub.team.permissionsFor('rhea').shell).toBe(true);
  });
});

describe('the test of a server is the user’s in person', () => {
  it('the CLI token does not start the program of a server', async () => {
    const t = await startTestHub({});
    await t.ownerJson('PUT', '/api/mcp-servers/fake', stdio());
    const token = (await import('node:fs')).readFileSync(t.core.paths.cliToken, 'utf8').trim();
    const res = await fetch(`${t.core.url}/api/mcp-servers/fake/test`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-monsters-request': '1',
      },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'owner_required' });
    // The user in person, with an old session, still tests it: it runs what they confirmed.
    stale(t);
    const ok = await t.api('POST', '/api/mcp-servers/fake/test');
    expect(ok.status).toBe(200);
  });
});
