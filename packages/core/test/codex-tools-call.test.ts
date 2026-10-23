import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpHandler } from '@modelcontextprotocol/server';
import {
  ProviderRegistry,
  RateBudget,
  codexArgs,
  type HarnessEvent,
  type HarnessProvider,
  type HarnessTask,
} from '@monsters/providers';
import { FakeProvider } from '@monsters/providers/testing';
import { defineTool, ToolError, type LogEvent, type MonstersTool } from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseAgentConfig } from '../src/agents/definition.ts';
import { harnessMcpServer, HarnessToolSessions } from '../src/agents/harness-tools.ts';
import { runHarnessAgent } from '../src/agents/run-harness.ts';
import { ControlScope } from '../src/kill/control-scope.ts';
import { EventLog, coreMigrations, migrate, openDb } from '../src/index.ts';
import {
  ANTEIKU_DATA,
  startFakeAnteiku,
  type FakeAnteiku,
} from './fixtures/fake-anteiku-server.ts';
import { fakeWebSearch, startTestHub } from './hub-helpers.ts';

/*
 * Codex with many MCP tools (D-163): its tool list cannot change in a session, so the core's MCP
 * server lists only the base tools (Monsters' own and the preloaded ones), `tools_search` (it
 * loads nothing, it returns schemas) and `tools_call`, which runs any tool of the run by its
 * name. The session still holds every tool: each call passes the adapter (brake, permissions,
 * log under the real tool name). Claude Code, and Codex with few MCP tools, are unchanged.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'monsters-codex-call-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function memoryLog() {
  const db = openDb(':memory:');
  migrate(db, 'core', coreMigrations);
  return new EventLog(db);
}

const NOUNS = ['customer', 'invoice', 'project', 'ticket', 'report', 'contact'];
const VERBS = ['list', 'get', 'create', 'update', 'delete', 'archive', 'export'];

/** `mcp__crm__invoice_archive` and the like: 42 tools of a made-up server, all of them recorded. */
function crmTools(called: string[], nouns = NOUNS): MonstersTool[] {
  return nouns.flatMap((noun) =>
    VERBS.map((verb) => {
      const name = `mcp__crm__${noun}_${verb}`;
      return defineTool({
        name,
        description: `[External tool, MCP server "crm"] ${verb} a ${noun}`,
        inputSchema: z.object({ id: z.string().optional(), title: z.string().optional() }),
        readOnly: verb === 'list' || verb === 'get',
        execute: (input) => {
          called.push(`${name} ${JSON.stringify(input)}`);
          return Promise.resolve({ ok: true });
        },
      });
    }),
  );
}

const vaultRead = defineTool({
  name: 'vault_read',
  description: 'Reads a note.',
  inputSchema: z.object({ path: z.string() }),
  readOnly: true,
  execute: () => Promise.resolve('note'),
});

/** An MCP client (stateless requests, JSON or SSE answers) over `post`. */
function mcpClient(post: (req: Request) => Promise<Response>) {
  let id = 0;
  return async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    const res = await post(
      new Request('http://127.0.0.1/api/harness/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      }),
    );
    const text = await res.text();
    const data = res.headers.get('content-type')?.includes('text/event-stream')
      ? (text
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .at(-1) ?? '{}')
      : text;
    return (JSON.parse(data) as { result?: unknown }).result;
  };
}

/** The MCP endpoint of a session, in process. */
function sessionClient(session: NonNullable<ReturnType<HarnessToolSessions['get']>>) {
  const handler = createMcpHandler(() => harnessMcpServer(session, 'test'), {
    legacy: 'stateless',
  });
  return mcpClient((req) => handler.fetch(req));
}

/** The core's real endpoint, with the bearer token of the run. */
function httpClient(task: HarnessTask) {
  return mcpClient(async (req) => {
    const headers = new Headers(req.headers);
    headers.set('authorization', `Bearer ${task.mcp.token}`);
    return fetch(task.mcp.url, { method: 'POST', headers, body: await req.text() });
  });
}

type Json = Record<string, unknown>;
type Client = ReturnType<typeof mcpClient>;
interface ToolResult {
  isError?: boolean;
  content: { text: string }[];
}

const listed = async (c: Client) =>
  ((await c('tools/list')) as { tools: { name: string }[] }).tools.map((t) => t.name);
const callOf = async (c: Client, name: string, args: Record<string, unknown>) => {
  const r = (await c('tools/call', { name, arguments: args })) as ToolResult;
  const text = r.content[0]!.text;
  return { error: r.isError === true, text, json: tryJson(text) as Json };
};
function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

interface Seen {
  task: HarnessTask;
  names: string[];
  tools: string[];
}

/** A harness that lets `act` talk to the run's MCP session, as Codex or Claude Code would. */
function harnessWith(
  id: 'codex' | 'claude-agent',
  sessions: HarnessToolSessions | undefined,
  seen: Seen[],
  act: (c: Client, seen: Seen) => Promise<void> = () => Promise.resolve(),
  events: HarnessEvent[] = [],
): HarnessProvider {
  return {
    id,
    kind: 'harness',
    auth: id === 'codex' ? 'oauth-siwc' : 'external-login',
    budget: new RateBudget({ id, windows: [], limitScope: 'account' }),
    listModels: () => Promise.resolve([]),
    async *run(task) {
      // Through the run's session in process, or (a hub) the core's HTTP endpoint.
      const session = sessions?.get(task.mcp.token);
      const client = session ? sessionClient(session) : httpClient(task);
      const mine: Seen = {
        task,
        names: await listed(client),
        tools: session?.tools.map((t) => t.name) ?? [],
      };
      seen.push(mine);
      await act(client, mine);
      for (const e of events) yield e;
      yield { type: 'done', reason: 'stop', text: 'ok' };
    },
  };
}

async function runOn(
  id: 'codex' | 'claude-agent',
  tools: MonstersTool[],
  act?: (c: Client, seen: Seen) => Promise<void>,
  options: {
    guard?: Parameters<typeof runHarnessAgent>[0]['guard'];
    events?: HarnessEvent[];
    task?: string;
  } = {},
) {
  const log = memoryLog();
  const sessions = new HarnessToolSessions(log);
  const seen: Seen[] = [];
  const harness = harnessWith(id, sessions, seen, act, options.events);
  const scope = new ControlScope('run', 'r1', null, 100);
  await runHarnessAgent({
    agent: {
      config: parseAgentConfig({
        id: 'rhea',
        name: 'Rhea',
        role: 'Ricerca',
        color: '#336699',
        models: [{ provider: id, model: id === 'codex' ? 'gpt-5.5' : 'sonnet' }],
        tools: ['vault_read'],
      }),
      instructions: 'You are Rhea.',
    },
    harness,
    task: options.task ?? 'Hello, how are you?',
    tools: [vaultRead],
    extraTools: tools,
    signal: scope.signal,
    scope,
    log,
    runId: 'r1',
    sessions,
    mcpUrl: () => 'http://127.0.0.1:1/api/harness/mcp',
    workspace: join(dir, 'ws'),
    scratchRoot: join(dir, 'scratch'),
    systemTools: false,
    ...(options.guard ? { guard: options.guard } : {}),
  });
  return { log, seen: seen[0]!, sessions };
}

const toolCalls = (log: EventLog) =>
  log.query({ type: 'tool_call', limit: 200 }).map((e) => (e as LogEvent<'tool_call'>).data.tool);

describe('Codex with many MCP tools: the server lists the base, tools_call reaches the rest', () => {
  it('lists the own tools, the preloaded ones, tools_search and tools_call; holds all of them', async () => {
    const r = await runOn('codex', crmTools([]));
    const { names, tools } = r.seen;
    expect(tools).toHaveLength(1 + 42 + 1);
    expect(names).toContain('vault_read');
    expect(names).toContain('tools_search');
    expect(names).toContain('tools_call');
    // Far fewer than the 42: the preload (8 at most) and the tools of the plan.
    expect(names.length).toBeLessThanOrEqual(1 + 8 + 2);
    expect(names.filter((n) => n.startsWith('mcp__crm__')).length).toBeLessThanOrEqual(8);
  });

  it('preloads the tools the request points at', async () => {
    const r = await runOn('codex', crmTools([]), undefined, {
      task: 'Please archive the invoice and list the tickets',
    });
    expect(r.seen.names).toContain('mcp__crm__invoice_archive');
    expect(r.seen.names).toContain('mcp__crm__ticket_list');
  });

  it('tools_call runs a tool that is not listed: the log shows the real tool, once', async () => {
    const called: string[] = [];
    let result: Awaited<ReturnType<typeof callOf>> | undefined;
    const r = await runOn('codex', crmTools(called), async (c, seen) => {
      expect(seen.names).not.toContain('mcp__crm__report_export');
      result = await callOf(c, 'tools_call', {
        name: 'mcp__crm__report_export',
        arguments: { id: 'r1' },
      });
    });
    expect(result?.error).toBe(false);
    expect(called).toEqual(['mcp__crm__report_export {"id":"r1"}']);
    const calls = toolCalls(r.log);
    expect(calls.filter((t) => t === 'mcp__crm__report_export')).toHaveLength(1);
    expect(calls).not.toContain('tools_call');
    const results = r.log.query({ type: 'tool_result', limit: 50 }) as LogEvent<'tool_result'>[];
    expect(results.map((e) => [e.data.tool, e.data.ok])).toEqual([
      ['mcp__crm__report_export', true],
    ]);
  });

  it('a call through tools_call passes the guard like a direct call', async () => {
    const called: string[] = [];
    const seenByGuard: string[] = [];
    let result: Awaited<ReturnType<typeof callOf>> | undefined;
    const r = await runOn(
      'codex',
      crmTools(called),
      async (c) => {
        result = await callOf(c, 'tools_call', {
          name: 'mcp__crm__customer_delete',
          arguments: {},
        });
      },
      {
        guard: {
          beforeCall: ({ tool }) => {
            seenByGuard.push(tool.name);
            if (tool.name.endsWith('_delete')) {
              return Promise.reject(new ToolError('USER_DECLINED', 'The user said no.'));
            }
            return Promise.resolve();
          },
        },
      },
    );
    expect(seenByGuard).toEqual(['mcp__crm__customer_delete']);
    expect(called).toEqual([]);
    expect(result?.error).toBe(true);
    expect(result?.json['error']).toMatchObject({ code: 'USER_DECLINED' });
    const results = r.log.query({ type: 'tool_result', limit: 50 }) as LogEvent<'tool_result'>[];
    expect(results.map((e) => [e.data.tool, e.data.ok])).toEqual([
      ['mcp__crm__customer_delete', false],
    ]);
  });

  it('resolves a name without mcp__server__, and one spelt in another case', async () => {
    const called: string[] = [];
    const answers: boolean[] = [];
    const r = await runOn('codex', crmTools(called), async (c) => {
      for (const name of ['invoice_archive', 'Ticket_Export', 'mcp__crm__project_update']) {
        answers.push((await callOf(c, 'tools_call', { name })).error);
      }
    });
    expect(answers).toEqual([false, false, false]);
    expect(called.map((x) => x.split(' ')[0])).toEqual([
      'mcp__crm__invoice_archive',
      'mcp__crm__ticket_export',
      'mcp__crm__project_update',
    ]);
    // Arguments are optional: `{}`.
    expect(called[0]).toBe('mcp__crm__invoice_archive {}');
    expect(toolCalls(r.log)).toEqual([
      'mcp__crm__invoice_archive',
      'mcp__crm__ticket_export',
      'mcp__crm__project_update',
    ]);
  });

  it('an unknown name is NOT_IN_RUN with a hint to tools_search, never the user’s no', async () => {
    let result: Awaited<ReturnType<typeof callOf>> | undefined;
    const r = await runOn('codex', crmTools([]), async (c) => {
      result = await callOf(c, 'tools_call', { name: 'mcp__crm__customer_teleport' });
    });
    expect(result?.error).toBe(true);
    const e = result?.json['error'] as {
      code: string;
      message: string;
      hint: string;
      cause: string;
    };
    expect(e.code).toBe('NOT_IN_RUN');
    expect(e.hint).toContain('tools_search');
    expect(e.hint).toContain('not a no from the user');
    expect(e.cause).toContain('not a no from the user');
    // Nothing ran, nothing was logged as a tool.
    expect(toolCalls(r.log)).toEqual([]);
  });

  it('refuses tools_call and tools_search themselves', async () => {
    const answers: Json[] = [];
    await runOn('codex', crmTools([]), async (c) => {
      for (const name of ['tools_call', 'tools_search', 'mcp__monsters__tools_call']) {
        answers.push((await callOf(c, 'tools_call', { name })).json);
      }
    });
    for (const a of answers) {
      expect(a['error']).toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('tools_search returns schemas and loads nothing: the list does not change', async () => {
    let found: Json | undefined;
    let after: string[] = [];
    const r = await runOn('codex', crmTools([]), async (c, seen) => {
      found = (await callOf(c, 'tools_search', { query: 'archive invoice' })).json;
      after = await listed(c);
      expect(after).toEqual(seen.names);
    });
    const tools = found!['tools'] as {
      name: string;
      status: string;
      schema: unknown;
      args: string;
    }[];
    const hit = tools.find((t) => t.name === 'mcp__crm__invoice_archive')!;
    expect(hit.status).toBe('call with tools_call');
    expect(hit.args).toBe('id, title');
    expect(hit.schema).toMatchObject({
      type: 'object',
      properties: { id: { type: 'string' }, title: { type: 'string' } },
    });
    expect(hit.schema).not.toHaveProperty('$schema');
    expect(found!['note']).toContain('tools_call');
    expect(after).not.toContain('mcp__crm__invoice_archive');
    // The search is a tool of the run like any other: logged.
    expect(toolCalls(r.log)).toEqual(['tools_search']);
  });

  it('a tool of the base found by tools_search comes back marked ready', async () => {
    let found: Json | undefined;
    await runOn(
      'codex',
      crmTools([]),
      async (c) => {
        found = (await callOf(c, 'tools_search', { query: 'mcp__crm__ticket_list' })).json;
      },
      { task: 'list the tickets' },
    );
    const hit = (found!['tools'] as { name: string; status: string }[]).find(
      (t) => t.name === 'mcp__crm__ticket_list',
    )!;
    expect(hit.status).toBe('ready');
  });

  it('the card says to call them with tools_call, and the context meter counts the listed tools only', async () => {
    const usage: HarnessEvent[] = [{ type: 'usage', model: 'gpt-5.5', inTok: 5000, outTok: 10 }];
    const tools = (parts: unknown) => (parts as { parts: { tools?: number } }).parts.tools ?? 0;
    const measure = async (id: 'codex' | 'claude-agent') => {
      const r = await runOn(id, crmTools([]), undefined, { events: usage });
      const u = r.log.query({ type: 'provider_usage' })[0] as LogEvent<'provider_usage'>;
      return { r, tools: tools(u.data.context) };
    };
    const codex = await measure('codex');
    const claude = await measure('claude-agent');
    expect(codex.tools).toBeGreaterThan(0);
    expect(codex.tools).toBeLessThan(claude.tools / 2);
    const text = codex.r.seen.task.instructions ?? '';
    expect(text).toContain('`tools_call`');
    expect(text).toContain('{"name": "mcp__crm__');
    expect(text).toContain('crm');
    expect(text).not.toContain('one not loaded yet loads and runs at its first call');
  });

  it('the session’s instructions say what tools_call is for', async () => {
    const r = await runOn('codex', crmTools([]), async (c) => {
      const init = (await c('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      })) as { instructions?: string };
      expect(init.instructions).toContain('tools_call');
    });
    expect(r.seen.names).toContain('tools_call');
  });
});

describe('Claude Code, and Codex with few MCP tools: unchanged', () => {
  it('Claude Code lists every tool and has no tools_call', async () => {
    const r = await runOn('claude-agent', crmTools([]));
    expect(r.seen.names).toHaveLength(r.seen.tools.length);
    expect(r.seen.names).not.toContain('tools_call');
    expect(r.seen.names).not.toContain('tools_search');
    expect(r.seen.names).toContain('mcp__crm__invoice_archive');
    expect(r.seen.task.instructions ?? '').not.toContain('tools_call');
  });

  it('Codex with up to 30 MCP tools lists them all, no tools_search, no tools_call', async () => {
    // 5 nouns × 6 verbs = 30: the threshold is "more than 30".
    const few = crmTools([])
      .filter((t) => !t.name.endsWith('_export'))
      .slice(0, 30);
    expect(few).toHaveLength(30);
    const r = await runOn('codex', few);
    expect(r.seen.names).toHaveLength(r.seen.tools.length);
    expect(r.seen.names).toHaveLength(31);
    expect(r.seen.names).not.toContain('tools_call');
    expect(r.seen.task.instructions ?? '').not.toContain('tools_call');
  });

  it('with no deferral, `callByName` does not exist on the session', async () => {
    const r = await runOn('claude-agent', crmTools([]));
    const open = new HarnessToolSessions(memoryLog()).open(
      r.seen.tools.map((n) => ({ ...vaultRead, name: n })),
      {
        log: memoryLog(),
        agentId: 'rhea',
        runId: 'x',
        signal: new AbortController().signal,
      },
    );
    expect('callByName' in open.session).toBe(false);
    expect(open.session.exposed).toEqual(r.seen.tools);
  });
});

describe('Codex approves the tools of Monsters’ server as a whole (D-158)', () => {
  it('default_tools_approval_mode of the server covers tools_call and tools_search too', () => {
    const args = codexArgs('https://example.invalid/v1', {
      name: 'monsters',
      url: 'http://127.0.0.1:1/api/harness/mcp',
      token: 't',
    });
    expect(args).toContain('mcp_servers.monsters.default_tools_approval_mode="approve"');
    // Server-wide: no per-tool setting that would leave a tool out.
    expect(args.filter((a) => a.includes('approval')).length).toBe(1);
  });
});

const UUID = '2b1d1f0e-8f5a-4c1e-9d2a-5a1c1d7c9e11';

describe('a Codex run with the fake Anteiku (124 tools)', () => {
  let fa: FakeAnteiku | undefined;
  afterEach(async () => {
    await fa?.close();
    fa = undefined;
  });

  /** A hub with Anteiku on its personal token and Titan on a recording harness. */
  async function hubWith(
    id: 'codex' | 'claude-agent',
    act: (c: Client, seen: Seen) => Promise<void>,
  ) {
    const seen: Seen[] = [];
    const providers = new ProviderRegistry().register(new FakeProvider({ models: {} }));
    const hub = await startTestHub({}, { hub: { providers, webTools: [fakeWebSearch] } });
    providers.register(harnessWith(id, undefined, seen, act));
    fa = await startFakeAnteiku();
    await hub.json('PUT', '/api/mcp-servers/anteiku', {
      transport: 'http',
      url: fa.mcpUrl,
      label: 'Anteiku',
      catalog: 'anteiku',
      agents: ['*'],
      headers: { Authorization: `Bearer ${fa.personalToken}` },
    });
    await hub.core.hub.team.setModels('titan', [
      { provider: id, model: id === 'codex' ? 'gpt-5.5' : 'sonnet' },
    ]);
    const sent = await hub.json<{ runId: string }>('POST', '/api/messages', {
      to: 'titan',
      text: 'Ciao, come va?',
    });
    await hub.runEnded(sent.runId);
    return { hub, seen: seen[0]!, anteiku: fa };
  }

  it('lists far fewer than 124 tools and reaches anteiku_task_crea through tools_call', async () => {
    let created: Awaited<ReturnType<typeof callOf>> | undefined;
    let last: Awaited<ReturnType<typeof callOf>> | undefined;
    const { hub, seen, anteiku } = await hubWith('codex', async (c, s) => {
      expect(s.names).not.toContain('mcp__anteiku__anteiku_task_crea');
      created = await callOf(c, 'tools_call', {
        name: 'anteiku_task_crea',
        arguments: { titolo: 'Chiamare il cliente', progetto_id: ANTEIKU_DATA.progetti[0]!.id },
      });
      // The last of the server's 124 tools, far past the 40 the cap used to keep.
      last = await callOf(c, 'tools_call', {
        name: 'mcp__anteiku__anteiku_timer_ferma',
        arguments: { id: UUID },
      });
    });
    // Nothing is cut at 40 any more (D-163): the run holds all 124, the list far fewer.
    expect(seen.names.length).toBeLessThan(30);
    expect(seen.names).toContain('tools_call');
    expect(hub.core.hub.mcp.cutFor('titan')).toEqual([]);
    expect(created?.error).toBe(false);
    expect(last?.error).toBe(false);
    expect(anteiku.calls).toEqual([
      {
        tool: 'anteiku_task_crea',
        args: { titolo: 'Chiamare il cliente', progetto_id: ANTEIKU_DATA.progetti[0]!.id },
      },
      { tool: 'anteiku_timer_ferma', args: { id: UUID } },
    ]);
    const calls = hub.core.log
      .query({ type: 'tool_call', limit: 200 })
      .map((e) => (e as LogEvent<'tool_call'>).data.tool);
    expect(calls).toEqual(['mcp__anteiku__anteiku_task_crea', 'mcp__anteiku__anteiku_timer_ferma']);
    // The card names every tool of the server in a few words and says how to call them.
    const text = seen.task.instructions ?? '';
    expect(text).toContain('`tools_call`');
    expect(text).toContain('anteiku_task_{');
  });

  it('Claude Code still gets all 124 listed, with no tools_call', async () => {
    const { seen } = await hubWith('claude-agent', () => Promise.resolve());
    expect(seen.names.filter((n) => n.startsWith('mcp__anteiku__'))).toHaveLength(124);
    expect(seen.names).not.toContain('tools_call');
  });
});
