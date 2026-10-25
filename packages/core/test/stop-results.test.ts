import { createServer, type Server } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { fake } from '@monsters/providers/testing';
import type { LogEvent, MonstersTool } from '@monsters/shared';
import { createWebFetchTool } from '@monsters/tools';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { adaptTools } from '../src/agents/tool-adapter.ts';
import { createCoreServices, type CoreServices, type RunController } from '../src/index.ts';
import type { EventLog } from '../src/log/event-log.ts';
import { tempHome } from './helpers.ts';
import { fakeWebSearch, startTestHub } from './hub-helpers.ts';

/*
 * Every tool call that started has its result in the log, and before the end of its run, also
 * when the kill switch stops it in flight (CI on macOS, 25/10: the shell's result came after
 * `run aborted`, because the kill logs the end right after aborting and the shell settles only
 * on the close of its pipes).
 */

const POSIX = process.platform !== 'win32';
const FIXTURE = fileURLToPath(new URL('./fixtures/fake-mcp-server.ts', import.meta.url));

const opened: CoreServices[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) s.db.close();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await sleep(20);
  }
}

/**
 * The invariant on the events of a run: each `tool_call` has exactly one `tool_result`, after
 * it and before the end of the run. Returns the results by tool.
 */
function expectEveryCallClosed(events: LogEvent[]): Map<string, LogEvent<'tool_result'>> {
  const end = events.find((e) => e.type === 'run' && e.data.status !== 'started');
  expect(end, 'the run ended').toBeDefined();
  const byTool = new Map<string, LogEvent<'tool_result'>>();
  const calls = events.filter((e): e is LogEvent<'tool_call'> => e.type === 'tool_call');
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    const results = events.filter(
      (e): e is LogEvent<'tool_result'> =>
        e.type === 'tool_result' && e.data.callId === call.data.callId,
    );
    expect(
      results.map((r) => r.data.tool),
      `one result for ${call.data.tool}`,
    ).toEqual([call.data.tool]);
    const result = results[0]!;
    // ULIDs from one monotonic factory: the order of the ids is the order of the log.
    expect(result.id > call.id, `${call.data.tool}: result after its call`).toBe(true);
    expect(result.id < end!.id, `${call.data.tool}: result before the end of the run`).toBe(true);
    byTool.set(call.data.tool, result);
  }
  return byTool;
}

/** Tools that settle in every way a tool can after a stop. */
function stopTools(): MonstersTool[] {
  const tool = (name: string, execute: MonstersTool['execute']): MonstersTool => ({
    name,
    description: name,
    inputSchema: z.object({}),
    execute,
  });
  const onAbort = (signal: AbortSignal) =>
    new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
  return [
    // Rejects at once, like a `fetch` or an MCP request.
    tool('prompt', (_i, ctx) => sleep(60_000, undefined, { signal: ctx.signal })),
    // Settles a while after the stop, like the shell on the close of its pipes.
    tool('late', async (_i, ctx) => {
      await onAbort(ctx.signal);
      await sleep(150);
      throw new Error('closed');
    }),
    // Finishes its work anyway, after the stop.
    tool('done_anyway', async (_i, ctx) => {
      await onAbort(ctx.signal);
      await sleep(50);
      return 'written';
    }),
    // Never listens to the signal, never settles.
    tool('deaf', () => new Promise(() => {})),
  ];
}

function startCalls(log: EventLog, runId: string, signal: AbortSignal): Promise<unknown>[] {
  const set = adaptTools(stopTools(), { log, agentId: 'rhea', runId, signal });
  return Object.entries(set).map(([name, t]) => {
    const execute = t.execute as unknown as (
      input: unknown,
      options: { toolCallId: string; messages: [] },
    ) => Promise<unknown>;
    return execute({}, { toolCallId: `c-${name}`, messages: [] });
  });
}

describe('a call in flight at a stop has its result before the end of its run', () => {
  const services = () => {
    const s = createCoreServices({ home: tempHome(), killGraceMs: 300 });
    opened.push(s);
    return s;
  };
  const settled = (calls: Promise<unknown>[]) =>
    Promise.race([Promise.allSettled(calls.slice(0, 3)), sleep(2000)]);

  const stops: [string, (runs: RunController, runId: string) => Promise<unknown>][] = [
    ['the kill switch', (runs) => runs.kill({ by: 'cli', reason: 'test' })],
    ['the stop of one run', (runs, runId) => runs.killRun(runId, { by: 'cli' })],
    ['the shutdown of the core', (runs) => runs.shutdown()],
  ];
  for (const [what, stop] of stops) {
    it(`${what}: whatever the tool does after the stop`, async () => {
      const { runs, log } = services();
      const run = runs.startRun({ agent: 'rhea', goal: 'stop test' });
      const calls = startCalls(log, run.id, run.agent('rhea').signal);
      await sleep(20);
      await stop(runs, run.id);
      await settled(calls);
      const results = expectEveryCallClosed(log.query({ runId: run.id, limit: 100 }));
      for (const name of ['prompt', 'late', 'done_anyway', 'deaf']) {
        expect(results.get(name)!.data).toMatchObject({ ok: false, error: 'aborted' });
      }
    });
  }
});

describe.skipIf(!POSIX)('the kill switch with every kind of tool in flight', () => {
  it('shell, web page, MCP call and a delegation whose monster runs a command', async () => {
    const hanging = createServer(() => {
      // Never answers: the page is in flight until the stop.
    });
    servers.push(hanging);
    await new Promise<void>((r) => hanging.listen(0, '127.0.0.1', r));
    const { port } = hanging.address() as { port: number };
    const t = await startTestHub(
      {
        titan: [
          fake.toolCalls([
            { name: 'shell', input: { command: 'sleep 30' } },
            { name: 'web_fetch', input: { url: `http://127.0.0.1:${port}/lenta` } },
            { name: 'mcp__fake__slow', input: { ms: 60_000 } },
            { name: 'delegate', input: { agent: 'Rhea', goal: 'Lancia un comando lungo' } },
          ]),
          fake.text('mai'),
        ],
        rhea: [fake.toolCall('shell', { command: 'sleep 30' }), fake.text('mai')],
      },
      {
        hub: {
          webTools: [fakeWebSearch, createWebFetchTool({ allowPrivateHosts: true })],
          settings: { permissions: { vault: true, web: true, shell: true } },
        },
      },
    );
    await t.json('PUT', '/api/mcp-servers/fake', {
      transport: 'stdio',
      command: process.execPath,
      args: [FIXTURE],
      agents: ['titan'],
    });
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'tutto' });
    const inFlight = () =>
      t
        .events(sent.runId)
        .filter((e) => e.type === 'tool_call')
        .map((e) => `${e.agent}:${e.data.tool}`);
    await waitFor(
      () =>
        [
          'titan:shell',
          'titan:web_fetch',
          'titan:mcp__fake__slow',
          'titan:delegate',
          'rhea:shell',
        ].every((c) => inFlight().includes(c)),
      10_000,
    );
    expect(t.events(sent.runId).filter((e) => e.type === 'tool_result')).toEqual([]);
    expect((await t.api('POST', '/api/kill', {})).status).toBe(200);
    expect((await t.runEnded(sent.runId)).data.status).toBe('aborted');
    // Read at once: what is not in the log when the run ends is a call left open.
    const results = expectEveryCallClosed(t.events(sent.runId));
    for (const tool of ['shell', 'web_fetch', 'mcp__fake__slow', 'delegate']) {
      expect(results.get(tool)!.data, tool).toMatchObject({ ok: false, error: 'aborted' });
    }
  }, 30_000);
});
