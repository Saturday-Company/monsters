import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { ClaudeAgentHarness, CodexHarness, type HarnessProvider } from '@monsters/providers';
import { FAKE_CLAUDE_SCRIPT, FAKE_CODEX_SCRIPT } from '@monsters/providers/testing';
import type { LogEvent, MonstersTool } from '@monsters/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseAgentConfig, type AgentDefinition } from '../src/agents/definition.ts';
import { HarnessToolSessions } from '../src/agents/harness-tools.ts';
import { stepsLeftNote, stepsWarningAt } from '../src/agents/run-agent.ts';
import type { RunHarnessOptions } from '../src/agents/run-harness.ts';
import { runHarnessAgent, WRAP_UP_REQUESTS } from '../src/agents/run-harness.ts';
import { ControlScope } from '../src/kill/control-scope.ts';
import { registerHarnessMcpRoutes } from '../src/server/routes/harness-mcp.ts';
import type { AppEnv } from '../src/server/app.ts';
import { RunBudget, RunLimitsSchema } from '../src/team/run-limits.ts';
import { createCoreServices, type CoreServices } from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { inLang } from './prompt-lang.ts';

/*
 * D-196: the agent's own step cap on a harness is a limit like the others (D-170). The fake
 * Claude Code honours `--max-turns` like the real one and never finishes by itself: a few steps
 * before the cap the model is told to save its work, at the cap its tools are refused and its
 * report ends the run at `max_steps`; the harness's max-turns is the backstop past the wrap-up.
 */

const CLAUDE_REPORT = 'Rapporto: grafica a metà, transazione Canva ancora aperta; mancano i testi.';
const CODEX_REPORT = 'Rapporto: 3 passi fatti, manca il resto.';
const MAX = 10;

let home: string;
let s: CoreServices;
let sessions: HarnessToolSessions;
let server: Server;
let port: number;

beforeEach(async () => {
  inLang('en');
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
  execute: () => Promise.resolve('Grafiche/Recap.md'),
};

function agentDef(provider: string): AgentDefinition {
  return {
    config: parseAgentConfig({
      id: 'franco',
      name: 'Franco',
      role: 'Social',
      color: '#336699',
      models: [{ provider, model: provider === 'codex' ? 'gpt-test' : 'opus' }],
      tools: ['vault_search'],
      limits: { maxSteps: MAX },
    }),
    instructions: 'Sei Franco.',
  };
}

function fakeClaude(record: string, fake: string[] = []): HarnessProvider {
  const userHome = join(home, 'user');
  mkdirSync(join(userHome, '.claude'), { recursive: true });
  writeFileSync(join(userHome, '.claude', '.credentials.json'), '{"method":"claude.ai"}');
  return new ClaudeAgentHarness({
    binary: () => ({
      command: process.execPath,
      args: [FAKE_CLAUDE_SCRIPT, `--fake-record=${record}`, '--fake-scenario=steps', ...fake],
      source: 'configured',
    }),
    env: { PATH: process.env['PATH'], HOME: userHome, USERPROFILE: userHome },
    exitGraceMs: 500,
  });
}

function fakeCodex(record: string): HarnessProvider {
  return new CodexHarness({
    binary: () => ({
      command: process.execPath,
      args: [FAKE_CODEX_SCRIPT, `--fake-record=${record}`, '--fake-scenario=steps'],
      source: 'configured',
    }),
    accessToken: () => Promise.resolve('siwc-token'),
    codexHome: join(home, 'codex-home'),
    env: { PATH: process.env['PATH'] },
    exitGraceMs: 500,
  });
}

function options(
  harness: HarnessProvider,
  extra: Partial<RunHarnessOptions> = {},
): RunHarnessOptions {
  const scope = new ControlScope('run', 'r1', null, 100);
  return {
    agent: agentDef(harness.id),
    harness,
    task: 'Fai la grafica recap della settimana',
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
  argv?: string[];
  request?: number;
  via?: string;
  text?: string;
  note?: unknown;
  result?: { isError?: boolean; content?: { text?: string }[] };
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
const usages = () => events().filter((e) => e.type === 'provider_usage');
const maxTurnsArg = (all: Recorded[]) => {
  const argv = all.find((r) => r.kind === 'run')!.argv!;
  return argv[argv.indexOf('--max-turns') + 1];
};

describe('few steps left (D-196)', () => {
  it('15% of the cap, between 2 and 10, from a cap of 10; never before the first step or with none left', () => {
    expect([10, 20, 30, 60, 100, 400].map(stepsWarningAt)).toEqual([2, 3, 5, 9, 10, 10]);
    expect(stepsLeftNote(5, 30, 25)).toContain('5 steps left of your 30');
    expect(stepsLeftNote(1, 30, 29)).toContain('1 step left of your 30');
    expect(stepsLeftNote(6, 30, 24)).toBeNull();
    expect(stepsLeftNote(0, 30, 30)).toBeNull();
    expect(stepsLeftNote(2, 30, 0)).toBeNull();
    // A small cap: the system prompt's "at most N steps" is enough.
    expect(stepsLeftNote(2, 9, 6)).toBeNull();
    inLang('it');
    expect(stepsLeftNote(5, 30, 25)).toContain('Ti restano 5 passi dei tuoi 30');
  });
});

describe("the agent's step cap on Claude Code (D-196)", () => {
  it('warns in a result of Monsters’ tools, then refuses every tool at the cap; the report ends the run', async () => {
    const record = join(home, 'claude.jsonl');
    const result = await runHarnessAgent(options(fakeClaude(record)));

    expect(result.status).toBe('max_steps');
    expect(result.text).toBe(CLAUDE_REPORT);
    expect(result.finalText).toBe(CLAUDE_REPORT);
    expect(result.limit).toEqual({ kind: 'agent_steps', value: MAX });

    const all = recorded(record);
    // The backstop: the cap plus the wrap-up's requests.
    expect(maxTurnsArg(all)).toBe(String(MAX + WRAP_UP_REQUESTS));
    // Told once, with 2 of 10 left, in the result of the first tool after the eighth request.
    const told = all.filter((r) => r.kind === 'context');
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ request: 8, via: 'mcp' });
    expect(told[0]!.text).toContain('2 steps left of your 10 for this task');
    expect(told[0]!.text).toContain('close what you left open');

    // At the cap (the 10th request) both tools are refused for the limit, with the words of the wrap-up.
    const sixth = all.find((r) => r.kind === 'mcp' && r.request === MAX)!;
    expect(JSON.stringify(sixth.result?.content)).toContain('LIMIT_REACHED');
    expect(JSON.stringify(sixth.result?.content)).toContain('your limit of 10 steps for this task');
    expect(JSON.stringify(sixth.result?.content)).toContain('anything you left half-open');
    expect(results().find((r) => r.data.callId === `toolu_b${MAX}`)?.data).toMatchObject({
      ok: false,
      cause: 'limit',
    });
    // Only the requests up to the cap and the report.
    expect(usages()).toHaveLength(MAX + 1);

    // The error says the cap and that a report was written; the UI reads both as data.
    expect(errors().map((e) => e.data.code)).toEqual(['max_steps']);
    expect(errors()[0]!.data).toMatchObject({
      limit: { kind: 'agent_steps', value: MAX },
      report: true,
    });
    expect(errors()[0]!.data.message).toBe(
      'Franco used all 10 steps without finishing (report written at the last step)',
    );
    const last = events()
      .filter((e) => e.type === 'message' && !e.data.partial)
      .at(-1);
    expect(last?.data).toMatchObject({ role: 'agent', text: CLAUDE_REPORT });
  });

  it('warns in the hook of a built-in that still runs', async () => {
    const record = join(home, 'claude.jsonl');
    const result = await runHarnessAgent(options(fakeClaude(record, ['--fake-first=bash'])));
    expect(result.status).toBe('max_steps');
    const told = recorded(record).filter((r) => r.kind === 'context');
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ request: 8, via: 'hook' });
    expect(told[0]!.text).toContain('2 steps left of your 10');
    // The warning never refuses: the terminal of that request ran.
    expect(results().find((r) => r.data.callId === 'toolu_b8')?.data).toMatchObject({ ok: true });
  });

  it('a model that keeps working is stopped past the wrap-up, without a report', async () => {
    const record = join(home, 'claude.jsonl');
    const result = await runHarnessAgent(options(fakeClaude(record, ['--fake-wrap=ignore'])));
    expect(result.status).toBe('max_steps');
    expect(result.text).not.toBe(CLAUDE_REPORT);
    expect(usages().length).toBeLessThanOrEqual(MAX + WRAP_UP_REQUESTS + 1);
    expect(errors().map((e) => e.data.code)).toEqual(['max_steps']);
    expect(errors()[0]!.data.report).toBeUndefined();
  });

  it('without the hooks the cap stays the harness’s own max-turns, as before', async () => {
    const record = join(home, 'claude.jsonl');
    const { hookUrl: _none, ...rest } = options(fakeClaude(record));
    const result = await runHarnessAgent(rest);
    expect(result.status).toBe('max_steps');
    const all = recorded(record);
    expect(maxTurnsArg(all)).toBe(String(MAX));
    expect(all.some((r) => r.kind === 'max-turns')).toBe(true);
    expect(all.filter((r) => r.kind === 'context')).toEqual([]);
    expect(usages()).toHaveLength(MAX);
    expect(errors().map((e) => e.data.code)).toEqual(['max_steps']);
  });
});

describe('no step cap of its own (D-200)', () => {
  it('no max-turns and no note on Claude Code: the job’s limits bound the run', async () => {
    const record = join(home, 'claude.jsonl');
    const base = options(fakeClaude(record), {
      budget: new RunBudget(RunLimitsSchema.parse({ plan: { maxRunSteps: 12 } })),
    });
    const uncapped = { ...base.agent, config: { ...base.agent.config, limits: {} } };
    const result = await runHarnessAgent({ ...base, agent: uncapped });
    expect(result.status).toBe('run_limit');
    expect(result.text).toBe(CLAUDE_REPORT);
    expect(result.limit).toMatchObject({ kind: 'steps', value: 12, plan: true });
    const all = recorded(record);
    expect(all.find((r) => r.kind === 'run')!.argv).not.toContain('--max-turns');
    expect(all.filter((r) => r.kind === 'context')).toEqual([]);
    // Past the cap of 10 the old default would have stopped it at.
    expect(usages().length).toBeGreaterThan(MAX);
  });
});

describe("the agent's step cap on Codex (D-196)", () => {
  it('warns and wraps up with notes in the thread; the report ends the run at max_steps', async () => {
    const record = join(home, 'codex.jsonl');
    const result = await runHarnessAgent(options(fakeCodex(record)));
    expect(result.status).toBe('max_steps');
    expect(result.text).toBe(CODEX_REPORT);
    const notes = recorded(record)
      .filter((r) => r.kind === 'note')
      .map((r) => JSON.stringify(r.note));
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain('2 steps left of your 10 for this task');
    expect(notes[1]).toContain('Limit reached (your limit of 10 steps for this task)');
    // No "few steps left" in the results of Monsters' tools: Codex read it in its thread.
    const mcp = recorded(record).filter((r) => r.kind === 'mcp');
    expect(mcp.every((r) => (r.result?.content ?? []).length <= 1)).toBe(true);
    expect(errors().map((e) => e.data.code)).toEqual(['max_steps']);
    expect(errors()[0]!.data).toMatchObject({ report: true });
  });
});
