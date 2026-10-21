import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MonstersTool } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { startTestHub, type TestHub } from './hub-helpers.ts';

/*
 * The life of an MCP connection under concurrent use: changes and removals
 * while a call comes in, HTTP sessions lost when the server restarts, starts
 * shared between runs, retry pauses, tool lists that change.
 */

const POSIX = process.platform !== 'win32';
const FIXTURE = fileURLToPath(new URL('./fixtures/fake-mcp-server.ts', import.meta.url));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const ctx = (signal = new AbortController().signal) => ({
  agentId: 'titan',
  runId: 'r',
  signal,
  emit: () => {},
});

async function toolOf(t: TestHub, name: string, signal?: AbortSignal): Promise<MonstersTool> {
  const hub = t.core.hub;
  const tools = await hub.mcp.toolsFor(hub.team.get('titan')!, signal);
  const tool = tools.find((x) => x.name === name);
  if (!tool) throw new Error(`no tool ${name} in ${tools.map((x) => x.name).join(', ')}`);
  return tool;
}

const run = async (tool: MonstersTool, signal?: AbortSignal): Promise<string> => {
  try {
    return String(await tool.execute({}, ctx(signal)));
  } catch (err) {
    return `ERR ${(err as Error).message}`;
  }
};

const pidsOf = (out: string) => JSON.parse(out) as { pid: number; argv: string[] };

const stdio = (args: string[], token = 'A') => ({
  transport: 'stdio',
  command: process.execPath,
  args: [FIXTURE, ...args],
  env: { FAKE_TOKEN: token },
  agents: ['titan'],
});

describe.skipIf(!POSIX)('MCP connections under concurrent use', () => {
  it('a call while a change stops the server starts the NEW configuration', async () => {
    const t = await startTestHub({});
    await t.json('PUT', '/api/mcp-servers/fake', stdio(['--ignore-sigint']));
    const pids = await toolOf(t, 'mcp__fake__pids');
    const first = pidsOf(await run(pids));
    expect(first.argv).not.toContain('NEW');

    // The old process ignores SIGINT: stopping it takes a while.
    const change = t.core.hub.mcp.upsert(
      'fake',
      { ...stdio(['--ignore-sigint', 'NEW'], 'B') } as never,
      'ui',
    );
    await Promise.resolve();
    const during = pidsOf(await run(pids));
    await change;
    const after = pidsOf(await run(pids));
    expect(during.argv).toContain('NEW');
    expect(after.argv).toContain('NEW');
    expect(after.pid).toBe(during.pid);
    expect(alive(first.pid)).toBe(false);
    const view = t.core.hub.mcp.view().servers.find((s) => s.name === 'fake')!;
    expect(view.args).toContain('NEW');
    expect(view.status).toBe('running');
  });

  it('a call while the server is removed starts nothing and leaves no process', async () => {
    const t = await startTestHub({});
    await t.json('PUT', '/api/mcp-servers/fake', stdio(['--ignore-sigint']));
    const pids = await toolOf(t, 'mcp__fake__pids');
    const first = pidsOf(await run(pids));

    const removal = t.core.hub.mcp.remove('fake', 'ui');
    await Promise.resolve();
    const during = await run(pids);
    await removal;
    expect(during).toMatch(/^ERR /);
    expect(alive(first.pid)).toBe(false);
    expect(t.core.hub.mcp.view().servers).toEqual([]);
  });

  it('an HTTP server that restarted (session not found) gets a new session', async () => {
    let epoch = 1;
    let initializes = 0;
    const srv = createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const m = JSON.parse(Buffer.concat(chunks).toString()) as {
          id?: number;
          method: string;
          params: { protocolVersion: string };
        };
        if (m.method === 'initialize') {
          initializes++;
          res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': `S${epoch}` });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: m.id,
              result: {
                protocolVersion: m.params.protocolVersion,
                capabilities: { tools: {} },
                serverInfo: { name: 'h', version: '1' },
              },
            }),
          );
          return;
        }
        if (req.headers['mcp-session-id'] !== `S${epoch}`) {
          res.writeHead(404, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: m.id ?? null,
              error: { code: -32001, message: 'Session not found' },
            }),
          );
          return;
        }
        if (m.id === undefined) {
          res.writeHead(202).end();
          return;
        }
        const result =
          m.method === 'tools/list'
            ? { tools: [{ name: 'ping', inputSchema: { type: 'object' } }] }
            : { content: [{ type: 'text', text: `pong ${epoch}` }] };
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    try {
      const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`;
      const t = await startTestHub({});
      await t.json('PUT', '/api/mcp-servers/h', { transport: 'http', url, agents: ['titan'] });
      const ping = await toolOf(t, 'mcp__h__ping');
      expect(await run(ping)).toBe('pong 1');
      epoch = 2; // the server restarted: the old session is unknown
      expect(await run(ping)).toBe('pong 2');
      expect(await run(ping)).toBe('pong 2');
      expect(initializes).toBe(2);
      // The test button lists the tools again on the new session too.
      epoch = 3;
      expect((await t.core.hub.mcp.test('h')).ok).toBe(true);
    } finally {
      srv.close();
      srv.closeAllConnections();
    }
  });

  it('a start shared by two runs does not fail when the first run is stopped', async () => {
    const t = await startTestHub({});
    await t.json('PUT', '/api/mcp-servers/fake', stdio(['--slow-start', '400']));
    const first = new AbortController();
    const second = new AbortController();
    const hub = t.core.hub;
    const titan = hub.team.get('titan')!;
    const a = hub.mcp.toolsFor(titan, first.signal);
    const b = hub.mcp.toolsFor(titan, second.signal);
    setTimeout(() => first.abort(), 100);
    const [, tools] = await Promise.all([a, b]);
    expect(tools.map((x) => x.name)).toContain('mcp__fake__echo');
    const echo = tools.find((x) => x.name === 'mcp__fake__pids')!;
    expect(await run(echo)).toMatch(/"pid"/);
  });

  it('calls wait before starting again a server that failed to start', async () => {
    const t = await startTestHub({});
    const starts = join(t.home, 'starts.txt');
    await t.json('PUT', '/api/mcp-servers/fake', stdio(['--starts', starts]));
    const pids = await toolOf(t, 'mcp__fake__pids');
    const first = pidsOf(await run(pids));
    process.kill(first.pid, 'SIGKILL');
    await waitFor(() => t.core.hub.mcp.view().servers[0]!.status === 'idle');
    // Restart: the server now exits at once.
    expect(await run(pids)).toContain('broken now');
    expect(t.core.hub.mcp.view().servers[0]!.status).toBe('error');
    // Within the pause: no new start.
    expect(await run(pids)).toContain('broken now');
    expect(await run(pids)).toMatch(/^ERR /);
    const lines = readFileSync(starts, 'utf8').trim().split('\n');
    expect(lines.length).toBe(2);
    // The test button always tries.
    expect((await t.core.hub.mcp.test('fake')).ok).toBe(false);
    expect(readFileSync(starts, 'utf8').trim().split('\n').length).toBe(3);
  });

  it('a run that starts right after a failed start keeps the tools: they work once the server is back', async () => {
    const t = await startTestHub({});
    const starts = join(t.home, 'starts.txt');
    await t.json('PUT', '/api/mcp-servers/fake', stdio(['--starts', starts]));
    const titan = t.core.hub.team.get('titan')!;
    const fakeTools = async () =>
      (await t.core.hub.mcp.toolsFor(titan))
        .map((x) => x.name)
        .filter((n) => n.startsWith('mcp__fake__'));
    const pids = await toolOf(t, 'mcp__fake__pids');
    process.kill(pidsOf(await run(pids)).pid, 'SIGKILL');
    await waitFor(() => t.core.hub.mcp.view().servers[0]!.status === 'idle');
    // The restart fails once: the run that starts now still gets the tools.
    expect(await run(pids)).toContain('broken now');
    expect(await fakeTools()).toContain('mcp__fake__pids');
    const inRun = await toolOf(t, 'mcp__fake__pids');
    // Within the pause the call says the server is not available; once it is back, it works.
    expect(await run(inRun)).toMatch(/^ERR /);
    writeFileSync(starts, '');
    expect((await t.core.hub.mcp.test('fake')).ok).toBe(true);
    expect(pidsOf(await run(inRun)).pid).toBeGreaterThan(0);

    // Failing again and again: the tools stay out of the runs that start in the pause.
    writeFileSync(starts, 'x\n');
    process.kill(pidsOf(await run(inRun)).pid, 'SIGKILL');
    await waitFor(() => t.core.hub.mcp.view().servers[0]!.status === 'idle');
    expect(await run(inRun)).toContain('broken now');
    expect((await t.core.hub.mcp.test('fake')).ok).toBe(false);
    expect(await fakeTools()).toContain('mcp__fake__pids');
    expect((await t.core.hub.mcp.test('fake')).ok).toBe(false);
    expect(await fakeTools()).toEqual([]);
  });

  it('a server that still answers a ping is working: its timeouts do not restart it', async () => {
    const t = await startTestHub({});
    await t.json('PUT', '/api/mcp-servers/fake', stdio([]));
    t.core.hub.settings.mcpServers['fake']!.timeoutSec = 1;
    const pids = await toolOf(t, 'mcp__fake__pids');
    const slow = await toolOf(t, 'mcp__fake__slow');
    const first = pidsOf(await run(pids));
    for (let i = 0; i < 3; i++) {
      await expect(slow.execute({ ms: 3000 }, ctx())).rejects.toThrow('did not answer');
    }
    // A long render: the same process, still alive.
    expect(alive(first.pid)).toBe(true);
    expect(pidsOf(await run(pids)).pid).toBe(first.pid);
  });

  it(
    'restarts a server that is alive but stuck after two calls in a row time out',
    { timeout: 20_000 },
    async () => {
      const t = await startTestHub({});
      await t.json('PUT', '/api/mcp-servers/fake', stdio([]));
      t.core.hub.settings.mcpServers['fake']!.timeoutSec = 1;
      const pids = await toolOf(t, 'mcp__fake__pids');
      const slow = await toolOf(t, 'mcp__fake__slow');
      const first = pidsOf(await run(pids));
      // Stuck: the process does not even answer a ping.
      const stuck = async () => {
        try {
          return String(await slow.execute({ ms: 2500, freeze: true }, ctx()));
        } catch (err) {
          return `ERR ${(err as Error).message}`;
        }
      };
      expect(await stuck()).toContain('did not answer');
      // One timeout is not enough: the same process.
      expect(pidsOf(await run(pids)).pid).toBe(first.pid);
      expect(await stuck()).toContain('did not answer');
      expect(await stuck()).toContain('did not answer');
      const after = pidsOf(await run(pids));
      expect(after.pid).not.toBe(first.pid);
      expect(alive(first.pid)).toBe(false);
    },
  );

  it('follows notifications/tools/list_changed: a new tool waits for "Accetta", then reaches the next run', async () => {
    const t = await startTestHub({});
    await t.json('PUT', '/api/mcp-servers/fake', stdio(['--dynamic']));
    const grow = await toolOf(t, 'mcp__fake__grow');
    const names = async () =>
      (await t.core.hub.mcp.toolsFor(t.core.hub.team.get('titan')!)).map((x) => x.name);
    expect(await names()).not.toContain('mcp__fake__added');
    expect(await run(grow)).toBe('grown');
    // Seen, but paused (D-070): a security event and the card in the view.
    await waitFor(() => (t.core.hub.mcp.view().servers[0]!.pausedTools?.length ?? 0) > 0);
    expect(await names()).not.toContain('mcp__fake__added');
    const view = t.core.hub.mcp.view().servers[0]!;
    expect(view.pausedTools).toMatchObject([{ name: 'added', change: 'new' }]);
    expect(view.knownTools?.find((x) => x.name === 'added')?.skipped).toMatch(
      /paused until you accept it/,
    );
    const security = t.core.log.query({ type: 'security' });
    expect(security.map((e) => e.type === 'security' && e.data.action)).toEqual([
      'mcp_tools_changed',
    ]);
    await t.json('POST', '/api/mcp-servers/fake/accept', {});
    expect(await run(await toolOf(t, 'mcp__fake__added'))).toBe('added ok');
    expect(t.core.hub.mcp.view().servers[0]!.pausedTools).toBeUndefined();
  });

  it('a description rewritten by the server (rug pull) pauses the tool; a tool taken away just goes', async () => {
    const t = await startTestHub({});
    await t.json('PUT', '/api/mcp-servers/fake', stdio(['--dynamic']));
    const names = async () =>
      (await t.core.hub.mcp.toolsFor(t.core.hub.team.get('titan')!)).map((x) => x.name);
    expect(await names()).toEqual(expect.arrayContaining(['mcp__fake__echo', 'mcp__fake__fail']));
    expect(await run(await toolOf(t, 'mcp__fake__poison'))).toBe('poisoned');
    await waitFor(() => (t.core.hub.mcp.view().servers[0]!.pausedTools?.length ?? 0) > 0);
    const now = await names();
    expect(now).not.toContain('mcp__fake__echo');
    expect(now).not.toContain('mcp__fake__fail');
    const [paused] = t.core.hub.mcp.view().servers[0]!.pausedTools!;
    expect(paused).toMatchObject({
      name: 'echo',
      change: 'changed',
      before: 'Repeats the text it gets.',
      schemaChanged: false,
    });
    expect(paused!.description).toContain('id_rsa');
    // The same list again (a reconnection) asks nothing more.
    await t.json('POST', '/api/mcp-servers/fake/test');
    expect(t.core.log.query({ type: 'security' })).toHaveLength(1);
    await t.json('POST', '/api/mcp-servers/fake/accept', { tools: ['echo'] });
    expect(await names()).toContain('mcp__fake__echo');
    const accepted = t.core.log.query({ type: 'security' }).at(-1)!;
    expect(accepted.type === 'security' && accepted.data.action).toBe('mcp_tools_accepted');
  });

  it('a gallery service: new tools pass with a line in Attività, a new description still pauses', () => {
    return (async () => {
      const t = await startTestHub({});
      await t.json('PUT', '/api/mcp-servers/fake', { ...stdio(['--dynamic']), catalog: 'notion' });
      await toolOf(t, 'mcp__fake__grow');
      expect(await run(await toolOf(t, 'mcp__fake__grow'))).toBe('grown');
      await waitFor(async () =>
        (await t.core.hub.mcp.toolsFor(t.core.hub.team.get('titan')!)).some(
          (x) => x.name === 'mcp__fake__added',
        ),
      );
      const updated = t.core.log
        .query({ type: 'mcp_server' })
        .find((e) => e.type === 'mcp_server' && e.data.action === 'tools_updated');
      expect(updated).toBeDefined();
      expect(await run(await toolOf(t, 'mcp__fake__poison'))).toBe('poisoned');
      await waitFor(() => (t.core.hub.mcp.view().servers[0]!.pausedTools?.length ?? 0) > 0);
      expect(t.core.hub.mcp.view().servers[0]!.pausedTools!.map((x) => x.name)).toEqual(['echo']);
    })();
  });

  it('a gallery service: a rewritten argument description pauses too; "Accetta" takes only what the card showed', () => {
    return (async () => {
      const t = await startTestHub({});
      await t.json('PUT', '/api/mcp-servers/fake', { ...stdio(['--dynamic']), catalog: 'notion' });
      expect(await run(await toolOf(t, 'mcp__fake__poison_args'))).toBe('args poisoned');
      await waitFor(() => (t.core.hub.mcp.view().servers[0]!.pausedTools?.length ?? 0) > 0);
      const [shown] = t.core.hub.mcp.view().servers[0]!.pausedTools!;
      expect(shown).toMatchObject({ name: 'echo', change: 'changed', schemaChanged: true });
      expect(shown!.hash).toMatch(/^[0-9a-f]{24}$/);
      // The server changes echo again after the card was drawn: the old fingerprint is not enough.
      expect(await run(await toolOf(t, 'mcp__fake__poison'))).toBe('poisoned');
      await waitFor(() => t.core.hub.mcp.view().servers[0]!.pausedTools?.[0]?.hash !== shown!.hash);
      await t.json('POST', '/api/mcp-servers/fake/accept', { seen: { echo: shown!.hash } });
      expect(t.core.hub.mcp.view().servers[0]!.pausedTools?.map((x) => x.name)).toEqual(['echo']);
      const now = t.core.hub.mcp.view().servers[0]!.pausedTools![0]!;
      await t.json('POST', '/api/mcp-servers/fake/accept', { seen: { echo: now.hash } });
      expect(t.core.hub.mcp.view().servers[0]!.pausedTools).toBeUndefined();
    })();
  });

  it('names of tools are the same whatever order the server lists them in', () => {
    return (async () => {
      const t = await startTestHub({});
      const tool = (name: string) => ({ name, inputSchema: { type: 'object' as const } });
      const tools = [tool('a.b'), tool('a_b'), tool(`${'y'.repeat(70)}`), tool('c')];
      const names = (list: typeof tools) =>
        Object.fromEntries(
          t.core.hub.mcp.toEntries('s', list).map((e) => [e.tool.name, e.agentName]),
        );
      const forward = names(tools);
      const backward = names([...tools].reverse());
      expect(backward).toEqual(forward);
      // The tool whose name needs no change keeps it.
      expect(forward['a_b']).toBe('mcp__s__a_b');
      expect(forward['a.b']).not.toBe('mcp__s__a_b');
      expect(new Set(Object.values(forward)).size).toBe(4);
    })();
  });
});
