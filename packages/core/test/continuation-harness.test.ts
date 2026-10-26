import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { ClaudeAgentHarness, CodexHarness, type HarnessProvider } from '@monsters/providers';
import { FAKE_CLAUDE_SCRIPT, FAKE_CODEX_SCRIPT } from '@monsters/providers/testing';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAgentConfig } from '../src/agents/definition.ts';
import { HarnessToolSessions } from '../src/agents/harness-tools.ts';
import { runHarnessAgent, type RunHarnessOptions } from '../src/agents/run-harness.ts';
import { ControlScope } from '../src/kill/control-scope.ts';
import { registerHarnessMcpRoutes } from '../src/server/routes/harness-mcp.ts';
import type { AppEnv } from '../src/server/app.ts';
import { createCoreServices, type CoreServices } from '../src/index.ts';
import { tempHome } from './helpers.ts';

/*
 * D-199 with the fake binaries: a run that continues a job resumes its harness session and
 * hands the session back for the next one; a session the harness no longer has costs nothing,
 * and the same turn starts again without it, with the conversation and the notes of the job.
 */

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

function fakeClaude(record: string): HarnessProvider {
  const userHome = join(home, 'user');
  mkdirSync(join(userHome, '.claude'), { recursive: true });
  writeFileSync(join(userHome, '.claude', '.credentials.json'), '{"method":"claude.ai"}');
  return new ClaudeAgentHarness({
    binary: () => ({
      command: process.execPath,
      args: [FAKE_CLAUDE_SCRIPT, `--fake-record=${record}`, '--fake-scenario=nostream'],
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
      args: [FAKE_CODEX_SCRIPT, `--fake-record=${record}`, '--fake-scenario=tool'],
      source: 'configured',
    }),
    accessToken: () => Promise.resolve('siwc-token'),
    codexHome: join(home, 'codex-home'),
    env: { PATH: process.env['PATH'] },
    exitGraceMs: 500,
  });
}

function options(harness: HarnessProvider, extra: Partial<RunHarnessOptions> = {}) {
  const scope = new ControlScope('run', 'r2', null, 100);
  return {
    agent: {
      config: parseAgentConfig({
        id: 'vesta',
        name: 'Vesta',
        role: 'Grafica',
        color: '#336699',
        models: [{ provider: harness.id, model: harness.id === 'codex' ? 'gpt-test' : 'opus' }],
        tools: [],
      }),
      instructions: 'Sei Vesta.',
    },
    harness,
    task: 'finisci pure',
    tools: [],
    signal: scope.signal,
    scope,
    log: s.log,
    runId: 'r2',
    sessions,
    mcpUrl: () => `http://127.0.0.1:${port}/api/harness/mcp`,
    workspace: join(home, 'ws'),
    scratchRoot: join(home, 'scratch'),
    systemTools: false,
    ...extra,
  } satisfies RunHarnessOptions;
}

const FALLBACK = {
  history: [
    { role: 'user' as const, content: 'Grafica a tema Lucca Comics 2026' },
    { role: 'assistant' as const, content: 'Ora applico tutto nel design Canva.' },
  ],
  notes:
    '<previous_job source="x">\n- Bash {"command":"curl lucca"} → Spiriti del fumetto\n</previous_job>',
};

const runs = (file: string) =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { kind: string; argv?: string[]; prompt?: string })
    .filter((r) => r.kind === 'run');

describe('continuing a job on its harness session (D-199)', () => {
  it('Claude Code: resumes the session, sends the request alone and hands the session back', async () => {
    const record = join(home, 'claude.jsonl');
    const result = await runHarnessAgent(
      options(fakeClaude(record), { resume: 'sess-job', resumeFallback: FALLBACK }),
    );
    expect(result.status).toBe('completed');
    const [run] = runs(record);
    expect(run!.argv![run!.argv!.indexOf('--resume') + 1]).toBe('sess-job');
    expect(run!.prompt).toBe('finisci pure');
    expect(result.harnessSession).toEqual({
      harness: 'claude-agent',
      id: 'sess-job',
      cwd: join(home, 'ws'),
    });
  });

  it('Claude Code: a session gone from its disk: started again without it, with the conversation and the notes', async () => {
    const record = join(home, 'claude.jsonl');
    const result = await runHarnessAgent(
      options(fakeClaude(record), { resume: 'gone-0001', resumeFallback: FALLBACK }),
    );
    expect(result.status).toBe('completed');
    const [lost, again] = runs(record);
    expect(lost!.argv).toContain('--resume');
    expect(again!.argv).not.toContain('--resume');
    expect(again!.prompt).toContain('## Recent conversation');
    expect(again!.prompt).toContain('Ora applico tutto nel design Canva.');
    expect(again!.prompt).toContain('Spiriti del fumetto');
    const prompt = again!.prompt ?? '';
    expect(prompt.indexOf('finisci pure')).toBeLessThan(prompt.indexOf('<previous_job'));
    // Nothing failed for the user: no error of the lost session in the log.
    expect(s.log.query({ runId: 'r2', type: 'error', limit: 100 })).toEqual([]);
    expect(result.harnessSession?.id).toBe('sess-0001');
  });

  it('Codex: a thread gone from its home: started again as a new thread', async () => {
    const record = join(home, 'codex.jsonl');
    const result = await runHarnessAgent(
      options(fakeCodex(record), { resume: 'gone-thr', resumeFallback: FALLBACK }),
    );
    expect(result.status).toBe('completed');
    const methods = readFileSync(record, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { kind: string; msg?: { method?: string } })
      .filter((r) => r.kind === 'rpc')
      .map((r) => r.msg?.method);
    expect(methods).toContain('thread/resume');
    expect(methods).toContain('thread/start');
    expect(s.log.query({ runId: 'r2', type: 'error', limit: 100 })).toEqual([]);
  });
});
