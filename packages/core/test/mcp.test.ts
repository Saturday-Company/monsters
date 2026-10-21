import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { fake } from '@monsters/providers/testing';
import type { LogEvent, McpServersResponse, McpTestResponse, MonstersTool } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  MAX_MCP_TOOLS_FREE,
  MAX_TOOL_NAME,
  agentToolName,
  checkInputSchema,
  describeToolCall,
  resultText,
  splitAgentToolName,
  EventLog,
  coreMigrations,
  migrate,
  openDb,
} from '../src/index.ts';
import { StateStore } from '../src/db/state-store.ts';
import type { RunController } from '../src/kill/run-controller.ts';
import { SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import {
  inspectMcpSecrets,
  McpServerSettingSchema,
  type McpServerSetting,
} from '../src/mcp/config.ts';
import { McpManager, httpFailure } from '../src/mcp/manager.ts';
import type { TeamService } from '../src/team/team-service.ts';
import { tempHome } from './helpers.ts';
import { startFakeHttpServer } from './fixtures/fake-mcp-server.ts';
import { sdkHttpHandler } from './fixtures/sdk-mcp-server.ts';
import { deferred, startTestHub, toolResultsSeen, type TestHub } from './hub-helpers.ts';

const POSIX = process.platform !== 'win32';
const FIXTURE = fileURLToPath(new URL('./fixtures/fake-mcp-server.ts', import.meta.url));
const SDK_FIXTURE = fileURLToPath(new URL('./fixtures/sdk-mcp-server.ts', import.meta.url));
const SECRET = 'tok-SEGRETO-4f9a2c71';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const toolResult = (t: TestHub, runId: string, tool: string) =>
  t
    .events(runId)
    .find((e): e is LogEvent<'tool_result'> => e.type === 'tool_result' && e.data.tool === tool);

const stdioServer = (extra: Record<string, unknown> = {}, flags: string[] = []) => ({
  transport: 'stdio',
  command: process.execPath,
  args: [FIXTURE, ...flags],
  env: { FAKE_TOKEN: SECRET },
  agents: ['titan'],
  ...extra,
});

describe('MCP: the gallery timeout reaches servers added before it', () => {
  it('Blender added with 60 s gets 600 s once; a value set later stays', () => {
    const home = tempHome();
    mkdirSync(home, { recursive: true });
    const db = openDb(':memory:');
    migrate(db, 'core', coreMigrations);
    const state = new StateStore(db);
    const setting = McpServerSettingSchema.parse({
      transport: 'stdio',
      command: 'uvx',
      args: ['blender-mcp'],
      catalog: 'blender',
      agents: ['*'],
    });
    const other = McpServerSettingSchema.parse({
      transport: 'stdio',
      command: 'node',
      catalog: 'github',
      agents: ['*'],
    });
    const start = (servers: Record<string, McpServerSetting>) =>
      new McpManager({
        home,
        secretsDir: join(home, 'secrets'),
        servers,
        log: new EventLog(db),
        runs: { onKill: () => () => {} } as unknown as RunController,
        team: {} as TeamService,
        state,
        env: {},
      });
    const servers = { blender: setting, altro: other };
    start(servers);
    expect(servers.blender.timeoutSec).toBe(600);
    expect(servers.altro.timeoutSec).toBe(60);
    const file = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')) as {
      mcpServers: Record<string, { timeoutSec: number }>;
    };
    expect(file.mcpServers['blender']!.timeoutSec).toBe(600);
    // The user brings it back to 60: the next start leaves it.
    const again = { blender: { ...setting, timeoutSec: 60 } };
    start(again);
    expect(again.blender.timeoutSec).toBe(60);
  });
});

describe('MCP: environment of a stdio server', () => {
  it('has no variable of the Claude Code or Codex session the core was started from', () => {
    const home = tempHome();
    const db = openDb(':memory:');
    migrate(db, 'core', coreMigrations);
    const session = {
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 's',
      CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/sock',
      CLAUDE_CODE_MESSAGING_TOKEN: 't',
      CLAUDE_PID: '1',
      CLAUDE_EFFORT: 'high',
      AI_AGENT: 'claude-code',
      CODEX_SANDBOX: 'seatbelt',
    };
    const manager = new McpManager({
      home,
      secretsDir: join(home, 'secrets'),
      servers: {},
      log: new EventLog(db),
      runs: { onKill: () => () => {} } as unknown as RunController,
      team: {} as TeamService,
      state: {} as StateStore,
      env: { PATH: '/usr/bin', HOME: '/home/u', MONSTERS_HOME: home, ...session },
    });
    const launch = manager.launchOf({
      name: 'fake',
      setting: { transport: 'stdio', command: 'node', args: [], enabled: true, agents: [] },
    } as unknown as Parameters<McpManager['launchOf']>[0]);
    expect(launch.transport).toBe('stdio');
    const env = (launch as { env: Record<string, string> }).env;
    expect(env['HOME']).toBe('/home/u');
    expect(env['MONSTERS_HOME']).toBeUndefined();
    for (const name of Object.keys(session)) expect(env[name], name).toBeUndefined();
  });
});

describe('MCP: names, schemas and results', () => {
  it('gives every tool a name the providers accept, stable and unique', () => {
    const taken = new Set<string>();
    expect(agentToolName('browser', 'browser_navigate', taken)).toBe(
      'mcp__browser__browser_navigate',
    );
    const odd = agentToolName('fs', 'read file/v2.0', taken);
    expect(odd).toMatch(/^mcp__fs__read_file_v2_0$/);
    taken.add(odd);
    const again = agentToolName('fs', 'read file/v2_0', taken);
    expect(again).not.toBe(odd);
    expect(again).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    const long = agentToolName('server-name-long', 'x'.repeat(200), new Set());
    expect(long.length).toBeLessThanOrEqual(MAX_TOOL_NAME);
    expect(long).toBe(agentToolName('server-name-long', 'x'.repeat(200), new Set()));
    expect(splitAgentToolName('mcp__browser__browser_click')).toEqual({
      server: 'browser',
      tool: 'browser_click',
    });
    expect(describeToolCall('mcp__browser__browser_navigate', { url: 'https://a.it/x' })).toBe(
      'apre nel browser a.it/x',
    );
    expect(describeToolCall('mcp__fake__echo', {})).toBe('usa fake: echo');
  });

  it('checks the schemas: invalid ones are skipped, valid ones validate the input', () => {
    expect(checkInputSchema({ type: 'string' })).toMatchObject({ ok: false });
    expect(checkInputSchema('nope')).toMatchObject({ ok: false });
    expect(
      checkInputSchema({ type: 'object', properties: { a: { $ref: 'https://x.it/s.json' } } }),
    ).toMatchObject({ ok: false });
    expect(
      checkInputSchema({ type: 'object', properties: { x: { type: 'nonsense' } } }),
    ).toMatchObject({ ok: false });
    const ok = checkInputSchema({
      $schema: 'http://json-schema.org/draft-07/schema#',
      properties: { n: { type: 'number' } },
      required: ['n'],
    });
    if (!ok.ok) throw new Error(ok.reason);
    expect(ok.schema).toMatchObject({ type: 'object', properties: { n: { type: 'number' } } });
    expect(ok.schema['$schema']).toBeUndefined();
    expect(ok.input.safeParse({ n: 2 }).success).toBe(true);
    expect(ok.input.safeParse({ n: 'due' }).success).toBe(false);
    expect(ok.input.safeParse({}).success).toBe(false);
    const empty = checkInputSchema({ type: 'object' });
    if (!empty.ok) throw new Error(empty.reason);
    expect(empty.input.safeParse(undefined)).toMatchObject({ success: true, data: {} });
  });

  it('turns results into text: images and resources as descriptions, long text cut', () => {
    const text = resultText({
      content: [
        { type: 'text', text: 'ciao' },
        { type: 'image', data: Buffer.alloc(4096).toString('base64'), mimeType: 'image/png' },
        { type: 'resource', resource: { uri: 'file:///a.md', text: '# A' } },
        { type: 'resource', resource: { uri: 'file:///b.bin', blob: 'AAAA', mimeType: 'x/y' } },
      ],
    });
    expect(text).toContain('ciao');
    expect(text).toContain('[immagine image/png, 4 KB');
    expect(text).toContain('[risorsa file:///a.md]\n# A');
    expect(text).toContain('[risorsa file:///b.bin, x/y');
    expect(resultText({ content: [], structuredContent: { a: 1 } })).toBe('{"a":1}');
    expect(resultText({ content: [{ type: 'text', text: 'x'.repeat(50) }] }, 10)).toContain(
      'testo troncato: 40',
    );
  });
});

describe.skipIf(!POSIX)('MCP servers in the hub', () => {
  it('adds a stdio server: secrets stay out of settings, API and log; lists its tools', async () => {
    const t = await startTestHub({});
    const view = await t.json<McpServersResponse>('PUT', '/api/mcp-servers/fake', stdioServer());
    const server = view.servers.find((s) => s.name === 'fake')!;
    expect(server).toMatchObject({ transport: 'stdio', envKeys: ['FAKE_TOKEN'], status: 'idle' });
    expect(JSON.stringify(view)).not.toContain(SECRET);
    const settings = readFileSync(join(t.home, 'settings.json'), 'utf8');
    expect(settings).toContain('"FAKE_TOKEN"');
    expect(settings).not.toContain(SECRET);
    const secretsFile = join(t.core.paths.secrets, 'mcp-fake.json');
    expect(readFileSync(secretsFile, 'utf8')).toContain(SECRET);
    expect(statSync(secretsFile).mode & 0o777).toBe(0o600);

    const test = await t.json<McpTestResponse>('POST', '/api/mcp-servers/fake/test');
    expect(test.ok).toBe(true);
    expect(test.server).toBe('fake-mcp 1.0.0');
    const names = test.tools.map((x) => x.agentName);
    expect(names).toContain('mcp__fake__echo');
    expect(names).toContain('mcp__fake__strange_name_with_dots');
    expect(test.tools.find((x) => x.name === 'broken')?.skipped).toMatch(/schema/);

    // An empty value keeps the saved secret; a name left out is removed.
    await t.json('PUT', '/api/mcp-servers/fake', { env: { FAKE_TOKEN: '' } });
    expect(readFileSync(secretsFile, 'utf8')).toContain(SECRET);
    const bad = await t.api('PUT', '/api/mcp-servers/fake', { env: { OTHER: '' } });
    expect(bad.status).toBe(400);
    const unknownAgent = await t.api('PUT', '/api/mcp-servers/fake', { agents: ['nessuno'] });
    expect(unknownAgent.status).toBe(404);
    const badName = await t.api('PUT', '/api/mcp-servers/Fake_1', stdioServer());
    expect(badName.status).toBe(400);
    expect(JSON.stringify(t.events())).not.toContain(SECRET);
    expect(t.events().some((e) => e.type === 'mcp_server' && e.data.action === 'added')).toBe(true);
  });

  it('an agent calls an MCP tool: logged, marked as external data, secrets redacted', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('mcp__fake__echo', { text: 'ciao' }),
        fake.toolCall('mcp__fake__whoami', {}),
        fake.toolCall('mcp__fake__fail', {}),
        fake.toolCall('mcp__fake__picture', {}),
        fake.toolCall('mcp__fake__echo', { text: 42 }),
        fake.text('fatto'),
      ],
    });
    await t.json('PUT', '/api/mcp-servers/fake', stdioServer());
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'usa fake' });
    const ended = await t.runEnded(sent.runId);
    expect(ended.data.status).toBe('completed');

    // The model got the tools with their JSON schema.
    const tools = t.provider.calls[0]!.options.tools ?? [];
    const echo = tools.find((x) => x.name === 'mcp__fake__echo') as
      { inputSchema: unknown; description?: string } | undefined;
    expect(echo?.inputSchema).toMatchObject({ properties: { text: { type: 'string' } } });
    expect(echo?.description).toContain('MCP server "fake"');
    expect(tools.some((x) => x.name === 'mcp__fake__broken')).toBe(false);

    const echoed = toolResult(t, sent.runId, 'mcp__fake__echo')!;
    expect(echoed.data).toMatchObject({ ok: true, output: 'echo: ciao' });
    const seen = toolResultsSeen(t.provider.calls[1]!.options.prompt);
    expect(seen).toContain('<dati_esterni fonte=\\"mcp:fake\\">');
    expect(seen).toContain('echo: ciao');

    // The secret printed by the server never reaches the log.
    const who = t
      .events(sent.runId)
      .find(
        (e): e is LogEvent<'tool_result'> =>
          e.type === 'tool_result' && e.data.tool === 'mcp__fake__whoami',
      )!;
    expect(who.data.ok).toBe(true);
    expect(JSON.stringify(t.events())).not.toContain(SECRET);

    // An error result: a failure for the model, still inside the envelope (escaped).
    const failed = toolResult(t, sent.runId, 'mcp__fake__fail')!;
    expect(failed.data.ok).toBe(false);
    expect(failed.data.error).toContain('<dati_esterni fonte="mcp:fake">');
    expect(failed.data.error).toContain('&lt;/dati_esterni>');

    const picture = toolResult(t, sent.runId, 'mcp__fake__picture')!;
    // The image is kept among the files (D-075), with a `file` event for the chat.
    expect(String(picture.data.output)).toContain('immagine salvata tra i File');
    const saved = t
      .events(sent.runId)
      .find((e): e is LogEvent<'file'> => e.type === 'file' && e.data.source === 'tool');
    expect(saved?.data).toMatchObject({
      kind: 'image',
      tool: 'mcp__fake__picture',
      mime: 'image/png',
    });
    expect(saved?.data.name).toMatch(/^immagine-fake-\d{4}-\d{2}-\d{2}-\d{6}\.png$/);
    expect(t.core.hub.files.get(saved!.data.id)).toMatchObject({
      source: 'tool',
      agent: 'titan',
      width: 2,
    });
    expect(String(picture.data.output)).toContain('[risorsa: a.txt file:///tmp/a.txt]');

    // Invalid input is refused before the call, for the model to fix.
    const invalid = t
      .events(sent.runId)
      .filter(
        (e): e is LogEvent<'tool_result'> =>
          e.type === 'tool_result' && e.data.tool === 'mcp__fake__echo',
      )[1]!;
    expect(invalid.data.error).toContain('INVALID_INPUT');
    expect(t.events().some((e) => e.type === 'mcp_server' && e.data.action === 'connected')).toBe(
      true,
    );
  });

  it('gives a server only to the agents chosen; one taken away holds at the next call', async () => {
    const release = deferred();
    const t = await startTestHub({
      titan: [
        fake.toolCall('mcp__fake__echo', { text: 'uno' }),
        fake.toolCall('mcp__fake__echo', { text: 'due' }, { gate: release.promise }),
        fake.text('ok'),
      ],
    });
    await t.json('PUT', '/api/mcp-servers/fake', stdioServer());
    const hub = t.core.hub;
    const names = async (id: string) =>
      (await hub.mcp.toolsFor(hub.team.get(id)!)).map((x: MonstersTool) => x.name);
    expect(await names('titan')).toContain('mcp__fake__echo');
    expect(await names('rhea')).toEqual([]);

    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'vai' });
    await waitFor(() => t.provider.calls.length === 2);
    await t.json('PUT', '/api/mcp-servers/fake', { agents: ['rhea'] });
    release.resolve();
    await t.runEnded(sent.runId);
    const results = t
      .events(sent.runId)
      .filter((e): e is LogEvent<'tool_result'> => e.type === 'tool_result');
    expect(results[0]!.data.ok).toBe(true);
    expect(results[1]!.data.error).toContain('SETTING_OFF');
    expect(await names('rhea')).toContain('mcp__fake__echo');
    expect(await names('titan')).toEqual([]);

    // Disabled: nobody gets it; `*` gives it to the whole team.
    await t.json('PUT', '/api/mcp-servers/fake', { agents: ['*'], enabled: false });
    expect(await names('dione')).toEqual([]);
    await t.json('PUT', '/api/mcp-servers/fake', { enabled: true });
    expect(await names('dione')).toContain('mcp__fake__echo');
  });

  it('reports start errors in plain words and goes on without the server', async () => {
    const t = await startTestHub({ titan: [fake.text('ok senza')] });
    await t.json('PUT', '/api/mcp-servers/missing', {
      transport: 'stdio',
      command: 'programma-che-non-esiste-xyz',
      agents: ['titan'],
    });
    const test = await t.json<McpTestResponse>('POST', '/api/mcp-servers/missing/test');
    expect(test).toMatchObject({ ok: false });
    expect(test.error).toContain('I can’t find the program');

    // A launcher of the gallery (D-092): what to install, with the link.
    await t.json('PUT', '/api/mcp-servers/blender', {
      transport: 'stdio',
      command: '/percorso-che-non-esiste-xyz/uvx',
      args: ['--from', 'x', 'blender-mcp'],
      agents: ['titan'],
    });
    const uv = await t.json<McpTestResponse>('POST', '/api/mcp-servers/blender/test');
    expect(uv.error).toContain('it’s part of uv, which has to be installed on the computer');
    expect(uv.error).toContain('https://docs.astral.sh/uv/getting-started/installation/');

    await t.json('PUT', '/api/mcp-servers/exits', stdioServer({}, ['--exit-at-start']));
    const exits = await t.json<McpTestResponse>('POST', '/api/mcp-servers/exits/test');
    expect(exits.ok).toBe(false);
    expect(exits.error).toContain('missing configuration');

    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'ciao' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const failed = t.events().filter((e) => e.type === 'mcp_server' && e.data.action === 'failed');
    expect(failed.length).toBeGreaterThanOrEqual(2);
  });

  it('a call that takes too long ends with a timeout the model can read', async () => {
    const t = await startTestHub({
      titan: [fake.toolCall('mcp__fake__slow', { ms: 3000 }), fake.text('ok')],
    });
    await t.json('PUT', '/api/mcp-servers/fake', stdioServer());
    // Settings allow shorter waits than the API (tests).
    const settings = JSON.parse(readFileSync(join(t.home, 'settings.json'), 'utf8')) as {
      mcpServers: Record<string, { timeoutSec: number }>;
    };
    settings.mcpServers['fake']!.timeoutSec = 1;
    writeFileSync(join(t.home, 'settings.json'), JSON.stringify(settings));
    t.core.hub.settings.mcpServers['fake']!.timeoutSec = 1;
    const started = Date.now();
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'lento' });
    await t.runEnded(sent.runId);
    expect(Date.now() - started).toBeLessThan(2900);
    const slow = toolResult(t, sent.runId, 'mcp__fake__slow')!;
    expect(slow.data.ok).toBe(false);
    expect(slow.data.error).toContain('did not answer within 1 s');
  });

  it(
    'the kill switch stops the server and its children in under 2 s; it restarts after resume',
    { timeout: 20_000 },
    async () => {
      const t = await startTestHub({
        titan: [
          fake.toolCall('mcp__fake__pids', {}),
          fake.toolCall('mcp__fake__slow', { ms: 60_000 }),
          fake.text('mai'),
        ],
      });
      await t.json(
        'PUT',
        '/api/mcp-servers/fake',
        stdioServer({}, ['--ignore-sigint', '--grandchild']),
      );
      const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'pids' });
      await waitFor(() => toolResult(t, sent.runId, 'mcp__fake__pids') !== undefined);
      const pids = JSON.parse(
        String(toolResult(t, sent.runId, 'mcp__fake__pids')!.data.output),
      ) as { pid: number; child: number };
      expect(alive(pids.pid) && alive(pids.child)).toBe(true);
      await waitFor(() =>
        t
          .events(sent.runId)
          .some((e) => e.type === 'tool_call' && e.data.tool === 'mcp__fake__slow'),
      );
      const started = Date.now();
      expect((await t.api('POST', '/api/kill', {})).status).toBe(200);
      await waitFor(() => !alive(pids.pid) && !alive(pids.child), 2000);
      expect(Date.now() - started).toBeLessThan(2000);
      expect((await t.runEnded(sent.runId)).data.status).toBe('aborted');

      // Halted: the test button does not start anything.
      expect((await t.api('POST', '/api/mcp-servers/fake/test')).status).toBe(409);

      await t.json('POST', '/api/resume', {});
      const tools = await t.core.hub.mcp.toolsFor(t.core.hub.team.get('titan')!);
      const pidsTool = tools.find((x) => x.name === 'mcp__fake__pids')!;
      const ctrl = new AbortController();
      const out = (await pidsTool.execute(
        {},
        { agentId: 'titan', runId: 'x', signal: ctrl.signal, emit: () => {} },
      )) as string;
      const again = JSON.parse(out) as { pid: number };
      expect(again.pid).not.toBe(pids.pid);
      expect(alive(again.pid)).toBe(true);
    },
  );

  it('connects to a Streamable HTTP server with headers kept secret', async () => {
    const httpToken = 'http-SEGRETO-91c2d0aa';
    const server = await startFakeHttpServer(httpToken);
    try {
      const t = await startTestHub({
        titan: [fake.toolCall('mcp__remote__echo', { text: 'via http' }), fake.text('ok')],
      });
      await t.json('PUT', '/api/mcp-servers/remote', {
        transport: 'http',
        url: server.url,
        headers: { Authorization: 'Bearer wrong-token-000' },
        agents: ['titan'],
      });
      const refused = await t.json<McpTestResponse>('POST', '/api/mcp-servers/remote/test');
      expect(refused.ok).toBe(false);
      expect(refused.error).toContain('refused the sign-in');

      const view = await t.json<McpServersResponse>('PUT', '/api/mcp-servers/remote', {
        headers: { Authorization: `Bearer ${httpToken}` },
      });
      expect(view.servers[0]).toMatchObject({ headerKeys: ['Authorization'], transport: 'http' });
      const ok = await t.json<McpTestResponse>('POST', '/api/mcp-servers/remote/test');
      expect(ok.ok).toBe(true);

      const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'http' });
      await t.runEnded(sent.runId);
      expect(toolResult(t, sent.runId, 'mcp__remote__echo')!.data).toMatchObject({
        ok: true,
        output: 'echo: via http',
      });
      expect(server.calls).toBe(1);
      expect(JSON.stringify(t.events())).not.toContain(httpToken);

      const bad = await t.api('PUT', '/api/mcp-servers/other', {
        transport: 'http',
        url: 'ftp://x.it',
      });
      expect(bad.status).toBe(400);
      const removed = await t.json<McpServersResponse>('DELETE', '/api/mcp-servers/remote');
      expect(removed.servers).toEqual([]);
      expect((await t.api('DELETE', '/api/mcp-servers/remote')).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('speaks to servers written with the official SDK (stdio and HTTP)', async () => {
    const handler = sdkHttpHandler();
    const http = serve({
      fetch: (req: Request) => handler.fetch(req),
      port: 0,
      hostname: '127.0.0.1',
      overrideGlobalObjects: false,
    });
    await new Promise<void>((r) => http.once('listening', () => r()));
    const port = (http.address() as AddressInfo).port;
    try {
      const t = await startTestHub({
        titan: [
          fake.toolCalls([
            { name: 'mcp__sdk__add', input: { a: 2, b: 3 } },
            { name: 'mcp__sdkhttp__add', input: { a: 4, b: 5 } },
          ]),
          fake.text('ok'),
        ],
      });
      await t.json('PUT', '/api/mcp-servers/sdk', {
        transport: 'stdio',
        command: process.execPath,
        args: [SDK_FIXTURE],
        agents: ['titan'],
      });
      await t.json('PUT', '/api/mcp-servers/sdkhttp', {
        transport: 'http',
        url: `http://127.0.0.1:${port}/mcp`,
        agents: ['titan'],
      });
      const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'somma' });
      await t.runEnded(sent.runId);
      expect(toolResult(t, sent.runId, 'mcp__sdk__add')!.data).toMatchObject({
        ok: true,
        output: '5',
      });
      expect(toolResult(t, sent.runId, 'mcp__sdkhttp__add')!.data).toMatchObject({
        ok: true,
        output: '9',
      });
    } finally {
      await new Promise<void>((r) => http.close(() => r()));
    }
  });

  it('the browser preset: own profile, off by default, only for agents with the web', async () => {
    const t = await startTestHub({});
    const view = await t.json<McpServersResponse>('GET', '/api/mcp-servers');
    expect(view.servers).toEqual([]);
    expect(view.browser.package).toMatch(/^@playwright\/mcp@\d+\.\d+\.\d+$/);
    const wrong = await t.api('PUT', '/api/mcp-servers/browser', stdioServer());
    expect(wrong.status).toBe(400);

    const on = await t.json<McpServersResponse>('PUT', '/api/mcp-servers/browser', {
      preset: 'browser',
      agents: ['*'],
    });
    const browser = on.servers.find((s) => s.name === 'browser')!;
    expect(browser).toMatchObject({ preset: 'browser', label: 'Browser', enabled: true });
    expect(browser.args).toEqual(
      expect.arrayContaining(['--user-data-dir', join(t.home, 'browser', 'profile'), '--headless']),
    );
    // Node on the package installed once, never `npx` resolving it at every start.
    expect(browser.command).toBe(process.execPath);
    expect(browser.args![0]).toBe(
      join(t.home, 'browser', 'package', 'node_modules', '@playwright', 'mcp', 'cli.js'),
    );
    expect(browser.args).not.toContain('--allow-unrestricted-file-access');
    const shown = await t.json<McpServersResponse>('PUT', '/api/mcp-servers/browser', {
      showWindow: true,
    });
    expect(shown.servers[0]!.args).not.toContain('--headless');

    await t.json('PUT', '/api/permissions', { agents: { rhea: { vault: true, web: false } } });
    expect(t.core.hub.mcp.allowed('rhea', 'browser')).toBe(false);
    expect(t.core.hub.mcp.allowed('dione', 'browser')).toBe(true);

    // The tool that runs code in the server process never reaches an agent, even when chosen.
    const hash = createHash('sha256')
      .update(JSON.stringify({ preset: view.browser.package }))
      .digest('hex')
      .slice(0, 16);
    const schema = { type: 'object' };
    t.core.state.set('mcp_tools:browser', {
      hash,
      tools: [
        { name: 'browser_navigate', inputSchema: schema },
        { name: 'browser_tabs', inputSchema: schema },
        { name: 'browser_run_code_unsafe', inputSchema: schema },
      ],
    });
    await t.json('PUT', '/api/mcp-servers/browser', {
      tools: ['browser_navigate', 'browser_tabs', 'browser_run_code_unsafe'],
    });
    const tools = await t.core.hub.mcp.toolsFor(t.core.hub.team.get('dione')!);
    expect(tools.map((x) => x.name)).toEqual([
      'mcp__browser__browser_navigate',
      'mcp__browser__browser_tabs',
    ]);
    // A new tab on this machine is refused like a navigation, before the server sees it.
    const ctx = { agentId: 'dione', signal: new AbortController().signal } as never;
    for (const [tool, input] of [
      [tools[0]!, { url: 'http://127.0.0.1:4747/' }],
      [tools[1]!, { action: 'new', url: 'http://192.168.1.1/' }],
    ] as const) {
      await expect(tool.execute(input, ctx)).rejects.toMatchObject({ code: 'BLOCKED_BY_POLICY' });
    }
    const known = t.core.hub.mcp.view().servers[0]!.knownTools!;
    expect(known.find((k) => k.name === 'browser_run_code_unsafe')?.skipped).toBeTruthy();
  });

  it('free models get a short list of MCP tools', async () => {
    const t = await startTestHub({});
    // Twenty tools known from a previous connection (cache of the tool list).
    await t.json('PUT', '/api/mcp-servers/many', stdioServer({ agents: ['*'] }));
    const hub = t.core.hub;
    await hub.mcp.test('many');
    const titan = hub.team.get('titan')!;
    const free = {
      ...titan,
      config: { ...titan.config, models: [{ provider: 'openrouter', model: 'openrouter/free' }] },
    };
    // The fake server has 7 valid tools: under the limit, all of them.
    expect((await hub.mcp.toolsFor(free)).length).toBe(7);
    // Only the tools chosen by the user.
    await t.json('PUT', '/api/mcp-servers/many', { tools: ['echo'] });
    expect((await hub.mcp.toolsFor(free)).map((x) => x.name)).toEqual(['mcp__many__echo']);
    expect(MAX_MCP_TOOLS_FREE).toBeLessThan(20);
  });
});

describe('MCP: HTTP failures of a remote server', () => {
  const http = (status: number) =>
    new SdkHttpError(
      SdkErrorCode.ClientHttpNotImplemented,
      `Error POSTing to endpoint: ${status}`,
      {
        status,
      },
    );

  it('a 429 is RATE_LIMITED and tells the model to wait, not to change the arguments', () => {
    const err = httpFailure('exa', http(429))!;
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.hint).toMatch(/wait/);
    expect(err.hint).toMatch(/do not change the arguments/);
  });

  it('a 5xx is UNAVAILABLE with a hint about the service, not the arguments', () => {
    const err = httpFailure('exa', http(503))!;
    expect(err.code).toBe('UNAVAILABLE');
    expect(err.hint).toMatch(/not your arguments/);
  });

  it('other errors are left to the generic message', () => {
    expect(httpFailure('exa', http(400))).toBeUndefined();
    expect(httpFailure('exa', new Error('boom'))).toBeUndefined();
  });

  it('a read-only call gets one new try after a 5xx; a call that may write does not', async () => {
    const mcp = () => {
      const server = new McpServer({ name: 'flaky', version: '1.0.0' });
      server.registerTool(
        'look',
        { description: 'Reads.', annotations: { readOnlyHint: true } },
        () => ({ content: [{ type: 'text', text: 'seen' }] }),
      );
      server.registerTool('write', { description: 'Writes.' }, () => ({
        content: [{ type: 'text', text: 'written' }],
      }));
      return server;
    };
    const handler = createMcpHandler(mcp);
    const calls: Record<string, number> = {};
    const http = serve({
      fetch: async (req: Request) => {
        const body = req.method === 'POST' ? await req.clone().text() : '';
        const m = /"method":"tools\/call".*"name":"(\w+)"/.exec(body);
        if (m) {
          const n = (calls[m[1]!] = (calls[m[1]!] ?? 0) + 1);
          // The first call of each tool finds the service in trouble.
          if (n === 1) return new Response('bad gateway', { status: 502 });
        }
        return handler.fetch(req);
      },
      port: 0,
      hostname: '127.0.0.1',
      overrideGlobalObjects: false,
    });
    await new Promise<void>((r) => http.once('listening', () => r()));
    try {
      const t = await startTestHub({
        titan: [
          fake.toolCall('mcp__flaky__look', {}),
          fake.toolCall('mcp__flaky__write', {}),
          fake.text('ok'),
        ],
      });
      await t.json('PUT', '/api/mcp-servers/flaky', {
        transport: 'http',
        url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`,
        agents: ['titan'],
      });
      const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'prova' });
      await t.runEnded(sent.runId);
      expect(toolResult(t, sent.runId, 'mcp__flaky__look')!.data).toMatchObject({
        ok: true,
        output: 'seen',
      });
      const write = toolResult(t, sent.runId, 'mcp__flaky__write')!.data;
      expect(write.ok).toBe(false);
      expect(write.error).toMatch(/^UNAVAILABLE: .*HTTP 502/);
      expect(calls).toEqual({ look: 2, write: 1 });
    } finally {
      http.close();
    }
  });

  it('a 403 on one call refuses that call only: the server stays on (review of 19/10, 7)', async () => {
    const mcp = () => {
      const server = new McpServer({ name: 'repo', version: '1.0.0' });
      server.registerTool('read', { description: 'Reads a repo.' }, () => ({
        content: [{ type: 'text', text: 'letto' }],
      }));
      return server;
    };
    const handler = createMcpHandler(mcp);
    let n = 0;
    const http = serve({
      fetch: async (req: Request) => {
        const body = req.method === 'POST' ? await req.clone().text() : '';
        // The first call asks for a repository this access does not reach.
        if (/"method":"tools\/call"/.test(body) && ++n === 1) {
          return new Response('forbidden', { status: 403 });
        }
        return handler.fetch(req);
      },
      port: 0,
      hostname: '127.0.0.1',
      overrideGlobalObjects: false,
    });
    await new Promise<void>((r) => http.once('listening', () => r()));
    try {
      const t = await startTestHub({
        titan: [
          fake.toolCall('mcp__repo__read', {}),
          fake.toolCall('mcp__repo__read', {}),
          fake.text('ok'),
        ],
      });
      await t.json('PUT', '/api/mcp-servers/repo', {
        transport: 'http',
        url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`,
        headers: { Authorization: 'Bearer tok-repo-1234567890' },
        agents: ['titan'],
      });
      const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'leggi' });
      await t.runEnded(sent.runId);
      const results = t
        .events(sent.runId)
        .filter(
          (e): e is LogEvent<'tool_result'> =>
            e.type === 'tool_result' && e.data.tool === 'mcp__repo__read',
        );
      expect(results[0]!.data.error).toMatch(/^SITE_REFUSED: .*HTTP 403/);
      expect(JSON.stringify(results[0]!.data.output)).not.toContain('access key');
      expect(results[1]!.data).toMatchObject({ ok: true, output: 'letto' });
      const view = await t.json<McpServersResponse>('GET', '/api/mcp-servers');
      expect(view.servers.find((s) => s.name === 'repo')).toMatchObject({ status: 'running' });
    } finally {
      http.close();
    }
  });
});

describe('MCP: secrets that cannot be read', () => {
  it('a damaged secrets file is reported as unreadable, not thrown at startup', () => {
    const dir = join(tempHome(), 'secrets');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'mcp-x.json'), '{ not json');
    expect(inspectMcpSecrets(dir, 'x')).toEqual({
      secrets: { env: {}, headers: {} },
      unreadable: true,
    });
    expect(inspectMcpSecrets(dir, 'absent').unreadable).toBe(false);
  });

  it('saving only the agents of a server never erases secrets that cannot be read', async () => {
    const t = await startTestHub({});
    await t.json('PUT', '/api/mcp-servers/fake', stdioServer());
    const file = join(t.core.paths.secrets, 'mcp-fake.json');
    const damaged = '{ "env": { "FAKE_TOKEN": "tok-';
    writeFileSync(file, damaged);
    const saved = await t.json<McpServersResponse>('PUT', '/api/mcp-servers/fake', {
      agents: ['*'],
    });
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(damaged);
    expect(saved.servers.find((x) => x.name === 'fake')!.envKeys).toEqual(['FAKE_TOKEN']);
    // The server stays off, with a sentence that says why.
    const test = await t.json<McpTestResponse>('POST', '/api/mcp-servers/fake/test');
    expect(test.ok).toBe(false);
    expect(test.error).toContain('can’t be read');
  });
});
