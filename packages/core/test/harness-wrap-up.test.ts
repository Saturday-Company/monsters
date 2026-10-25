import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { ClaudeAgentHarness, CodexHarness, type HarnessProvider } from '@monsters/providers';
import { FAKE_CLAUDE_SCRIPT, FAKE_CODEX_SCRIPT } from '@monsters/providers/testing';
import type { LogEvent, MonstersTool, ToolContext } from '@monsters/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseAgentConfig, type AgentDefinition } from '../src/agents/definition.ts';
import { HarnessToolSessions } from '../src/agents/harness-tools.ts';
import type { RunHarnessOptions } from '../src/agents/run-harness.ts';
import { runHarnessAgent, WRAP_UP_REQUESTS } from '../src/agents/run-harness.ts';
import { ControlScope } from '../src/kill/control-scope.ts';
import { registerHarnessMcpRoutes } from '../src/server/routes/harness-mcp.ts';
import type { AppEnv } from '../src/server/app.ts';
import { RunBudget, RunLimitsSchema } from '../src/team/run-limits.ts';
import {
  delegateTool,
  type SubagentRunParams,
  type TeamToolsContext,
} from '../src/team/team-tools.ts';
import { createCoreServices, type CoreServices } from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { inLang } from './prompt-lang.ts';

/*
 * D-170: a harness run that reaches a limit gets a wrap-up instead of a cut. The fake Claude
 * Code calls the hooks of its --settings file and Monsters' MCP endpoint like the real one: past
 * the limit every tool is refused with the words that ask for the report, the report ends the
 * run at the limit with its text, and a model that keeps working is stopped past the bound.
 */

const REPORT = 'Rapporto: trovate 2 lune, salvate in Ricerche/Lune.md; manca la terza.';

let home: string;
let s: CoreServices;
let sessions: HarnessToolSessions;
let server: Server;
let port: number;

beforeEach(async () => {
  home = tempHome();
  s = createCoreServices({ home });
  sessions = new HarnessToolSessions(s.log);
  const app = new Hono<AppEnv>();
  registerHarnessMcpRoutes(app, { sessions, version: 'test' });
  const listener = getRequestListener(app.fetch, { overrideGlobalObjects: false });
  server = createServer((req, res) => void listener(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as AddressInfo).port;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  s.db.close();
  rmSync(home, { recursive: true, force: true });
});

const vaultSearch: MonstersTool = {
  name: 'vault_search',
  description: 'Search the vault',
  readOnly: true,
  inputSchema: z.object({ query: z.string() }),
  execute: () => Promise.resolve('Ricerche/Lune.md'),
};

function agentDef(provider = 'claude-agent', limits: Record<string, number> = {}): AgentDefinition {
  return {
    config: parseAgentConfig({
      id: 'franco',
      name: 'Franco',
      role: 'Ricerca',
      color: '#336699',
      models: [{ provider, model: provider === 'codex' ? 'gpt-test' : 'opus' }],
      tools: ['vault_search'],
      limits: { maxSteps: 20, ...limits },
    }),
    instructions: 'Sei Franco.',
  };
}

function fakeClaude(record: string, wrap: 'obey' | 'ignore' | 'hang' = 'obey'): HarnessProvider {
  const userHome = join(home, 'user');
  mkdirSync(join(userHome, '.claude'), { recursive: true });
  writeFileSync(join(userHome, '.claude', '.credentials.json'), '{"method":"claude.ai"}');
  return new ClaudeAgentHarness({
    binary: () => ({
      command: process.execPath,
      args: [
        FAKE_CLAUDE_SCRIPT,
        `--fake-record=${record}`,
        '--fake-scenario=limit',
        `--fake-wrap=${wrap}`,
      ],
      source: 'configured',
    }),
    env: { PATH: process.env['PATH'], HOME: userHome, USERPROFILE: userHome },
    exitGraceMs: 500,
  });
}

function fakeCodex(record: string, wrap: 'obey' | 'ignore' = 'obey'): HarnessProvider {
  return new CodexHarness({
    binary: () => ({
      command: process.execPath,
      args: [
        FAKE_CODEX_SCRIPT,
        `--fake-record=${record}`,
        '--fake-scenario=limit',
        `--fake-wrap=${wrap}`,
      ],
      source: 'configured',
    }),
    accessToken: () => Promise.resolve('siwc-token'),
    codexHome: join(home, 'codex-home'),
    env: { PATH: process.env['PATH'] },
    exitGraceMs: 500,
  });
}

/** One step of the run left: the first request of the harness reaches the limit. */
const oneStep = () => new RunBudget(RunLimitsSchema.parse({ maxRunSteps: 1 }));

function options(
  harness: HarnessProvider,
  extra: Partial<RunHarnessOptions> = {},
): RunHarnessOptions {
  const scope = extra.scope ?? new ControlScope('run', 'r1', null, 100);
  return {
    agent: agentDef(harness.id),
    harness,
    task: 'Cerca le lune di Saturno',
    tools: [vaultSearch],
    signal: scope.signal,
    scope,
    log: s.log,
    runId: 'r1',
    sessions,
    mcpUrl: () => `http://127.0.0.1:${port}/api/harness/mcp`,
    hookUrl: () => `http://127.0.0.1:${port}/api/harness/hook`,
    workspace: join(home, 'ws'),
    scratchRoot: join(home, 'scratch'),
    systemTools: true,
    ...extra,
  };
}

type Recorded = {
  kind: string;
  event?: string;
  payload?: { tool_name?: string };
  answer?: Record<string, unknown>;
  result?: { isError?: boolean; content?: { text?: string }[] };
  settings?: { hooks?: Record<string, { matcher?: string }[]> };
  request?: number;
  note?: unknown;
  id?: string;
  msg?: { method?: string };
};

function recorded(file: string): Recorded[] {
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Recorded);
}

const events = (): LogEvent[] => s.log.query({ runId: 'r1', order: 'asc', limit: 1000 });
const results = () =>
  events().filter((e): e is LogEvent<'tool_result'> => e.type === 'tool_result');
const errors = () => events().filter((e): e is LogEvent<'error'> => e.type === 'error');

describe('the wrap-up at a limit on Claude Code (D-170)', () => {
  it('refuses every tool past the run budget; the report ends the run at the limit, with no "finito davvero?"', async () => {
    inLang('en');
    const record = join(home, 'claude.jsonl');
    const asked: string[] = [];
    const result = await runHarnessAgent(
      options(fakeClaude(record), {
        budget: oneStep(),
        onFinalAnswer: (text) => {
          asked.push(text);
          return { text: 'Manca la terza luna.', textCounts: true };
        },
      }),
    );

    expect(result.status).toBe('run_limit');
    expect(result.text).toBe(REPORT);
    expect(result.finalText).toBe(REPORT);

    // The built-ins (the terminal, and `ToolSearch` through its own matcher) are refused for the limit.
    const all = recorded(record);
    const pre = all.find((r) => r.kind === 'settings')!.settings!.hooks!['PreToolUse']!;
    expect(pre.some((g) => new RegExp(g.matcher!).test('ToolSearch'))).toBe(true);
    const denied = all.filter(
      (r) =>
        r.kind === 'hook' &&
        r.event === 'PreToolUse' &&
        (r.answer?.['hookSpecificOutput'] as { permissionDecision?: string } | undefined)
          ?.permissionDecision === 'deny',
    );
    expect(denied.map((r) => r.payload?.tool_name)).toEqual(['Bash', 'ToolSearch']);
    expect(JSON.stringify(denied[0]!.answer)).toContain('Limit reached');
    expect(JSON.stringify(denied[0]!.answer)).toContain('Write the report now');
    for (const id of ['toolu_l1', 'toolu_l2']) {
      expect(results().find((r) => r.data.callId === id)?.data).toMatchObject({
        ok: false,
        cause: 'limit',
      });
    }
    // Monsters' own tool answers LIMIT_REACHED with the same words.
    const mcp = all.find((r) => r.kind === 'mcp')!;
    expect(mcp.result?.isError).toBe(true);
    expect(JSON.stringify(mcp.result?.content)).toContain('LIMIT_REACHED');
    expect(JSON.stringify(mcp.result?.content)).toContain('Write the report now');

    // The stop hook sends no reminder past the limit.
    expect(asked).toEqual([]);
    const stop = all.find((r) => r.kind === 'hook' && r.event === 'Stop')!;
    expect(stop.answer).toEqual({});

    // The error says the limit, with the report written; the report is the run's last message.
    expect(errors().map((e) => e.data.code)).toEqual(['run_limit']);
    expect(errors()[0]!.data.message).toContain('(report written at the last step)');
    const last = events()
      .filter((e) => e.type === 'message' && !e.data.partial)
      .at(-1);
    expect(last?.data).toMatchObject({ role: 'agent', text: REPORT });
    // The wrap-up's requests are still counted.
    expect(events().filter((e) => e.type === 'provider_usage').length).toBe(2);
  });

  it("the agent's own token limit: the same wrap-up, status token_limit with the report", async () => {
    inLang('en');
    const record = join(home, 'claude.jsonl');
    const harness = fakeClaude(record);
    const result = await runHarnessAgent(
      options(harness, { agent: agentDef(harness.id, { maxTotalTokens: 1000 }) }),
    );
    expect(result.status).toBe('token_limit');
    expect(result.text).toBe(REPORT);
    const mcp = recorded(record).find((r) => r.kind === 'mcp')!;
    expect(JSON.stringify(mcp.result?.content)).toContain('your limit of 1000 tokens');
    expect(errors().map((e) => e.data.code)).toEqual(['token_limit']);
  });

  it('a model that keeps calling tools is stopped after the bound of requests', async () => {
    const record = join(home, 'claude.jsonl');
    const result = await runHarnessAgent(
      options(fakeClaude(record, 'ignore'), { budget: oneStep() }),
    );
    expect(result.status).toBe('run_limit');
    expect(result.text).not.toBe(REPORT);
    // The requests after the limit: at most the bound, never the ten the model wanted.
    const more = recorded(record).filter((r) => r.kind === 'more-work');
    expect(more.length).toBeLessThanOrEqual(WRAP_UP_REQUESTS + 1);
    expect(events().filter((e) => e.type === 'provider_usage').length).toBeLessThanOrEqual(
      1 + WRAP_UP_REQUESTS + 1,
    );
    expect(errors().map((e) => e.data.code)).toEqual(['run_limit']);
  });

  it('a model that writes nothing is stopped at the end of the wrap-up time', async () => {
    const record = join(home, 'claude.jsonl');
    const started = Date.now();
    const result = await runHarnessAgent(
      options(fakeClaude(record, 'hang'), { budget: oneStep(), wrapUpMs: 300 }),
    );
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.status).toBe('run_limit');
    expect(result.text).toBe('Comincio dal terminale.');
  });

  it('the kill switch during the wrap-up stops at once', async () => {
    const record = join(home, 'claude.jsonl');
    const scope = new ControlScope('run', 'r1', null, 100);
    const off = s.log.subscribe((e) => {
      if (e.type === 'tool_result' && e.data.cause === 'limit') void scope.abort();
    });
    const started = Date.now();
    const result = await runHarnessAgent(
      options(fakeClaude(record, 'hang'), { budget: oneStep(), scope }),
    );
    off();
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.status).toBe('aborted');
    expect(errors().map((e) => e.data.code)).toEqual(['aborted']);
  });

  it('a delegation hands the report back to the lead as a partial report', async () => {
    inLang('en');
    const record = join(home, 'claude.jsonl');
    const harness = fakeClaude(record);
    const run = s.runs.startRun({ agent: 'titan', goal: 'test' });
    const franco = agentDef(harness.id);
    const titan = { config: { id: 'titan', name: 'Titan', kind: 'orchestrator', role: 'Capo' } };
    const budget = oneStep();
    const ctx = {
      run,
      self: titan,
      team: {
        list: () => [titan, franco],
        get: (n: string) => (n.toLowerCase() === 'franco' ? franco : undefined),
        instructionFields: () => Promise.resolve(undefined),
      },
      log: s.log,
      runSubagent: (p: SubagentRunParams) =>
        runHarnessAgent({
          ...options(harness),
          agent: p.agent,
          task: p.brief,
          signal: p.scope.signal,
          scope: p.scope,
          runId: run.id,
          parentId: p.parentId,
          budget,
          ...(p.onFinalAnswer ? { onFinalAnswer: p.onFinalAnswer } : {}),
        }),
    } as unknown as TeamToolsContext;
    const tc = {
      agentId: 'titan',
      runId: run.id,
      signal: new AbortController().signal,
      emit: () => {},
    } as unknown as ToolContext;
    const report = (await delegateTool(ctx).execute(
      { agent: 'Franco', goal: 'Cerca le lune di Saturno' },
      tc,
    )) as Record<string, unknown>;
    expect(report).toMatchObject({
      agent: 'Franco',
      status: 'run_limit',
      stopped_by: 'run_limit',
      summary: REPORT,
      partial: true,
    });
    expect(report['error']).toBeUndefined();
  });
});

describe('the wrap-up at a limit on Codex (D-170)', () => {
  it("tells the model in a note of the thread; Monsters' tools refuse; the report ends the run", async () => {
    inLang('en');
    const record = join(home, 'codex.jsonl');
    const result = await runHarnessAgent(
      options(fakeCodex(record), { agent: agentDef('codex'), budget: oneStep() }),
    );
    expect(result.status).toBe('run_limit');
    expect(result.text).toBe('Rapporto: 2 lune in Ricerche/Lune.md; manca la terza.');
    const all = recorded(record);
    expect(JSON.stringify(all.find((r) => r.kind === 'note')?.note)).toContain(
      'Write the report now',
    );
    const second = all.find((r) => r.kind === 'mcp' && r.id === 'm2')!;
    expect(JSON.stringify(second.result?.content)).toContain('LIMIT_REACHED');
    expect(
      results()
        .filter((r) => r.data.tool === 'vault_search')
        .map((r) => r.data.cause ?? 'ok'),
    ).toEqual(['ok', 'limit']);
    expect(errors().map((e) => e.data.code)).toEqual(['run_limit']);
  });

  it('a model that keeps calling tools is interrupted after the bound', async () => {
    const record = join(home, 'codex.jsonl');
    const result = await runHarnessAgent(
      options(fakeCodex(record, 'ignore'), { agent: agentDef('codex'), budget: oneStep() }),
    );
    expect(result.status).toBe('run_limit');
    // The call before the limit, those of the wrap-up's requests, at most one more in flight.
    const calls = recorded(record).filter((r) => r.kind === 'mcp');
    expect(calls.length).toBeLessThanOrEqual(1 + WRAP_UP_REQUESTS + 1);
    expect(errors().map((e) => e.data.code)).toEqual(['run_limit']);
  });
});
