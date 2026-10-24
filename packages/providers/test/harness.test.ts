import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ClaudeAgentHarness,
  claudeRulePath,
  claudeRunSettings,
  claudeDontAskDenial,
  claudeOutsideMatcher,
  claudeToolPrefix,
  CodexHarness,
  codexMcpStatus,
  codexShellCommand,
  parseConnectorStatus,
  CODEX_INTEGRITY,
  installPackage,
  runOnce,
  plainSpawn,
  SiwcError,
  type HarnessEvent,
  type HarnessTask,
} from '../src/index.ts';
import { FAKE_CLAUDE_SCRIPT, FAKE_CODEX_SCRIPT, FAKE_NPM_SCRIPT } from '../src/testing/index.ts';

/*
 * The two harnesses with fake binaries speaking their documented protocols
 * (stream-json of `claude -p`, JSON-RPC of `codex app-server`): events
 * translated, Monsters' tools reached through MCP, the child's environment
 * without unwanted keys, the documented command lines.
 */

let dir: string;
let mcp: Server;
let mcpUrl: string;
const mcpCalls: { auth: string | undefined; method: string }[] = [];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'monsters-harness-'));
  mcpCalls.length = 0;
  mcp = createServer((req, res) => {
    let body = '';
    req.on('data', (d: Buffer) => (body += d.toString()));
    req.on('end', () => {
      const msg = JSON.parse(body || '{}') as { id?: number; method: string };
      mcpCalls.push({ auth: req.headers.authorization, method: msg.method });
      if (req.headers.authorization !== 'Bearer run-token') {
        res.writeHead(401).end();
        return;
      }
      if (msg.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      const result =
        msg.method === 'initialize'
          ? {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'fake', version: '1' },
            }
          : msg.method === 'tools/list'
            ? { tools: [{ name: 'vault_search', inputSchema: { type: 'object' } }] }
            : { content: [{ type: 'text', text: '2 note trovate' }] };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
  await new Promise<void>((r) => mcp.listen(0, '127.0.0.1', () => r()));
  mcpUrl = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`;
});

afterEach(async () => {
  await new Promise<void>((r) => mcp.close(() => r()));
  // Windows: a fake binary killed at the end of its turn may still hold its
  // working directory for a moment (EPERM): rm retries.
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function task(extra: Partial<HarnessTask> = {}): HarnessTask {
  const cwd = join(dir, 'agent');
  mkdirSync(cwd, { recursive: true });
  return {
    prompt: 'trova le ricette',
    cwd,
    mcp: { name: 'monsters', url: mcpUrl, token: 'run-token' },
    systemTools: false,
    spawn: plainSpawn,
    scratchDir: join(dir, 'scratch'),
    ...extra,
  };
}

async function collect(it: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const records = (file: string) =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown> & { kind: string });

/** The user's environment, with keys and Monsters' settings that must not reach a child. */
function userEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'],
    HOME: home,
    USERPROFILE: home,
    LANG: 'it_IT.UTF-8',
    ANTHROPIC_API_KEY: 'sk-ant-should-not-pass',
    ANTHROPIC_AUTH_TOKEN: 'should-not-pass',
    OPENAI_API_KEY: 'sk-should-not-pass',
    OPENROUTER_API_KEY: 'sk-or-should-not-pass',
    GROQ_API_KEY: 'gsk_should-not-pass',
    MONSTERS_HOME: '/secret/home',
    MONSTERS_CLI_TOKEN: 'cli',
    SOME_TOOL_TOKEN: 'core-cli-token-value',
    // The core started from a Claude Code terminal: that session's variables.
    ...CLAUDE_SESSION_ENV,
    // …or from a Codex one, by a user with Codex settings of their own.
    CODEX_SANDBOX: 'seatbelt',
    CODEX_SANDBOX_NETWORK_DISABLED: '1',
    CODEX_THREAD_ID: 'thr_user',
    CODEX_HOME: '/home/user/.codex',
    CODEX_API_KEY: 'codex-key-should-not-pass',
  };
}

const CLAUDE_SESSION_ENV = {
  CLAUDECODE: '1',
  CLAUDE_CODE_SESSION_ID: 'sess-user',
  CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/claude-socket',
  CLAUDE_CODE_MESSAGING_TOKEN: 'messaging-token',
  CLAUDE_CODE_BRIDGE_SESSION_ID: 'bridge',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CLAUDE_PID: '4242',
  CLAUDE_EFFORT: 'high',
  AI_AGENT: 'claude-code',
};
const SESSION_VARS = [
  ...Object.keys(CLAUDE_SESSION_ENV),
  'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED',
  'CODEX_THREAD_ID',
];

const isSecret = (_n: string, v: string) => v === 'core-cli-token-value';

describe('Claude Agent harness', () => {
  function harness(scenario: string, env: NodeJS.ProcessEnv, fakeArgs: string[] = []) {
    const record = join(dir, `claude-${scenario}${fakeArgs.join('')}.jsonl`);
    const h = new ClaudeAgentHarness({
      binary: () => ({
        command: process.execPath,
        args: [
          FAKE_CLAUDE_SCRIPT,
          `--fake-record=${record}`,
          `--fake-scenario=${scenario}`,
          ...fakeArgs,
        ],
        source: 'configured',
      }),
      env,
      isSecret,
    });
    return { h, record };
  }

  function loggedInHome(): string {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      join(home, '.claude', '.credentials.json'),
      JSON.stringify({ method: 'claude.ai' }),
    );
    return home;
  }

  it('reads the plan limits the binary prints, and ignores what it does not know (D-111)', async () => {
    const { h } = harness('tool', userEnv(loggedInHome()));
    const events = await collect(h.run(task({ model: 'sonnet' }), new AbortController().signal));
    const readings = events.flatMap((e) => (e.type === 'plan-limits' ? [e.reading] : []));
    // Two events with windows; the third (an unknown type) names none.
    expect(readings).toHaveLength(2);
    expect(readings[0]).toMatchObject({ plan: 'claude', partial: true });
    expect(readings[0]!.windows.map((w) => [w.id, Math.round(w.usedPercent)])).toEqual([
      ['five_hour', 9],
      ['seven_day', 63],
    ]);
    expect(readings[1]!.windows).toMatchObject([{ id: 'seven_day_opus', usedPercent: 41 }]);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'stop' });
  });

  it('prints no limits when the binary sends none', async () => {
    const { h } = harness('tool', userEnv(loggedInHome()), ['--fake-limits=off']);
    const events = await collect(h.run(task({ model: 'sonnet' }), new AbortController().signal));
    expect(events.some((e) => e.type === 'plan-limits')).toBe(false);
  });

  it('does not read a connector authentication error as signed out, nor a transient 429 as the usage limit (F-B8)', async () => {
    const a = harness('tool', userEnv(loggedInHome()), [
      '--fake-limits=off',
      '--fake-error=MCP server "claude.ai Slack" authentication failed',
    ]);
    const evA = await collect(a.h.run(task({}), new AbortController().signal));
    expect(evA.at(-1)).toMatchObject({ type: 'done', reason: 'error' });
    expect(evA.at(-1)).not.toHaveProperty('code');
    const b = harness('tool', userEnv(loggedInHome()), [
      '--fake-limits=off',
      '--fake-error=API Error: 429 rate limit, try again shortly',
    ]);
    const evB = await collect(b.h.run(task({}), new AbortController().signal));
    expect(evB.at(-1)).toMatchObject({ type: 'done', reason: 'error' });
    expect(evB.at(-1)).not.toHaveProperty('code');
    const c = harness('tool', userEnv(loggedInHome()), [
      '--fake-limits=off',
      '--fake-error=API Error 401 {"type":"authentication_error"}',
    ]);
    const evC = await collect(c.h.run(task({}), new AbortController().signal));
    expect(evC.at(-1)).toMatchObject({ code: 'not_logged_in' });
  });

  it('gives the usage_limit code when the plan rejected a request, whatever the words (F-B8)', async () => {
    const { h } = harness('tool', userEnv(loggedInHome()), [
      '--fake-limits=rejected',
      '--fake-error=API Error: 429 Too Many Requests',
    ]);
    const events = await collect(h.run(task({ model: 'opus' }), new AbortController().signal));
    expect(events.at(-1)).toMatchObject({ code: 'usage_limit' });
  });

  it('adds the reset time to a request the plan refused', async () => {
    const { h } = harness('tool', userEnv(loggedInHome()), ['--fake-limits=rejected']);
    const events = await collect(h.run(task({ model: 'opus' }), new AbortController().signal));
    const last = events.at(-1);
    expect(last).toMatchObject({ type: 'done', reason: 'error', code: 'usage_limit' });
    expect((last as { error: string }).error).toMatch(
      /usage limit \(resets at \d{1,2}:\d\d [AP]M\)/,
    );
    const first = events.find((e) => e.type === 'plan-limits');
    expect(first).toMatchObject({
      reading: { windows: [{ id: 'five_hour', usedPercent: 100 }, { id: 'seven_day' }] },
    });
  });

  it('asks the binary for the login and strips the API key first', async () => {
    const { h, record } = harness('tool', userEnv(loggedInHome()));
    const status = await h.status();
    expect(status).toMatchObject({
      state: 'subscription',
      authMethod: 'claude.ai',
      version: '2.1.286',
    });
    for (const r of records(record)) {
      const env = r['env'] as Record<string, string>;
      expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
      expect(env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
    }
  });

  it('reports a missing login and a missing binary', async () => {
    const home = join(dir, 'empty-home');
    mkdirSync(home);
    expect((await harness('tool', userEnv(home)).h.status()).state).toBe('logged_out');
    expect((await new ClaudeAgentHarness({ binary: () => null }).status()).state).toBe('not_found');
  });

  it('runs the binary in stream-json mode with Monsters tools over MCP, never --bare', async () => {
    const { h, record } = harness('tool', userEnv(loggedInHome()));
    const events = await collect(
      h.run(
        task({ model: 'sonnet', instructions: 'Regole di Monsters' }),
        new AbortController().signal,
      ),
    );

    // The sub-agent's messages are only a sign of life for the watchdog.
    expect(events.some((e) => e.type === 'heartbeat')).toBe(true);
    expect(events.filter((e) => e.type !== 'plan-limits' && e.type !== 'heartbeat')).toEqual([
      { type: 'session', id: 'sess-0001', model: 'claude-sonnet-test' },
      { type: 'mcp-status', servers: { monsters: 'connected' } },
      { type: 'text-delta', delta: 'Cerco nel vault.' },
      { type: 'text', text: 'Cerco nel vault.' },
      {
        type: 'tool-call',
        id: 'toolu_1',
        name: 'vault_search',
        input: { query: 'ricette' },
        monsters: true,
      },
      // Final counts of the request (message_delta), as soon as it ends.
      { type: 'usage', model: 'claude-sonnet-test', inTok: 105, outTok: 20, cacheReadTok: 5 },
      { type: 'tool-result', id: 'toolu_1', output: '2 note trovate', monsters: true },
      { type: 'text-delta', delta: 'Fatto: trova le ricette' },
      { type: 'text', text: 'Fatto: trova le ricette' },
      { type: 'usage', model: 'claude-sonnet-test', inTok: 150, outTok: 30 },
      // What only the result's total counts (the sub-agent's request).
      { type: 'usage', model: 'claude-sonnet-test', inTok: 7, outTok: 3, aggregate: true },
      { type: 'done', reason: 'stop', text: 'Fatto: trova le ricette' },
    ]);

    const run = records(record).find((r) => r.kind === 'run')!;
    const argv = run['argv'] as string[];
    expect(argv).not.toContain('--bare');
    expect(argv.slice(0, 7)).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ]);
    expect(argv).toContain('--strict-mcp-config');
    expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(argv[argv.indexOf('--allowedTools') + 1]).toBe('mcp__monsters');
    // Only Claude Code's ToolSearch: big MCP servers wait for a search (C.2).
    expect(argv[argv.indexOf('--tools') + 1]).toBe('ToolSearch');
    expect(argv[argv.indexOf('--model') + 1]).toBe('sonnet');
    // The child sees the real path (macOS: /var/folders → /private/var/folders).
    expect(realpathSync.native(run['cwd'] as string)).toBe(realpathSync.native(task().cwd));
    expect(run['prompt']).toBe('trova le ricette');
    // The run's MCP token is in a private file, not on the command line.
    expect(argv.join(' ')).not.toContain('run-token');
    const mcpConfig = argv[argv.indexOf('--mcp-config') + 1]!;
    if (process.platform !== 'win32') expect(statSync(mcpConfig).mode & 0o777).toBe(0o600);
    expect(readFileSync(argv[argv.indexOf('--append-system-prompt-file') + 1]!, 'utf8')).toBe(
      'Regole di Monsters',
    );
    // The fake binary reached the MCP endpoint with the run's bearer.
    expect(mcpCalls.map((c) => c.method)).toEqual(
      expect.arrayContaining(['initialize', 'tools/list', 'tools/call']),
    );
    expect(mcpCalls.every((c) => c.auth === 'Bearer run-token')).toBe(true);
  });

  it('passes the effort of the run to Claude Code with --effort, and only when there is one (D-110)', async () => {
    const withEffort = harness('tool', userEnv(loggedInHome()));
    await collect(
      withEffort.h.run(task({ model: 'opus', effort: 'high' }), new AbortController().signal),
    );
    const argv = records(withEffort.record).find((r) => r.kind === 'run')!['argv'] as string[];
    expect(argv[argv.indexOf('--model') + 1]).toBe('opus');
    expect(argv[argv.indexOf('--effort') + 1]).toBe('high');

    const without = harness('tool', userEnv(loggedInHome()));
    await collect(without.h.run(task({ model: 'sonnet' }), new AbortController().signal));
    const plain = records(without.record)
      .filter((r) => r.kind === 'run')
      .at(-1)!['argv'] as string[];
    expect(plain).not.toContain('--effort');
  });

  it('gives the child no unwanted key, setting or secret of Monsters', async () => {
    const home = loggedInHome();
    const { h, record } = harness('tool', userEnv(home));
    await collect(h.run(task(), new AbortController().signal));
    const env = records(record).find((r) => r.kind === 'run')!['env'] as Record<string, string>;
    for (const name of [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'OPENAI_API_KEY',
      'OPENROUTER_API_KEY',
      'GROQ_API_KEY',
      'MONSTERS_HOME',
      'MONSTERS_CLI_TOKEN',
      'SOME_TOOL_TOKEN',
      'CLAUDE_CODE_OAUTH_TOKEN',
      // The Claude Code (or Codex) session the core was started from stays out.
      ...SESSION_VARS,
    ]) {
      expect(env[name], name).toBeUndefined();
    }
    // Only Monsters' own MCP timeouts (D-078): nothing of the user's or of a session.
    expect(
      Object.keys(env)
        .filter((n) => n.startsWith('CLAUDE_CODE_'))
        .sort(),
    ).toEqual([
      'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
      'CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS',
      'CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT',
    ]);
    // A call of Monsters' tools may last an hour (D-078: 2.1.301 cut it at 60 s).
    expect(env['MCP_TOOL_TIMEOUT']).toBe('3600000');
    expect(env['CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT']).toBe('3600000');
    expect(env['CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS']).toBe('0');
    // The `monsters` server may take a minute to connect (D-160: 30 s by default, then failed).
    expect(env['MCP_TIMEOUT']).toBe('60000');
    // No proxy in this environment: no NO_PROXY of ours either.
    expect(env['NO_PROXY']).toBeUndefined();
    // The user's own environment stays: the binary finds its login by itself.
    expect(env['HOME']).toBe(home);
    expect(env['LANG']).toBe('it_IT.UTF-8');
  });

  it("reports how Monsters' server came up, and reaches it directly behind a proxy (D-160)", async () => {
    const { h, record } = harness(
      'tool',
      {
        ...userEnv(loggedInHome()),
        HTTPS_PROXY: 'http://proxy.example:3128',
        NO_PROXY: 'intranet.example',
      },
      ['--fake-mcp=failed'],
    );
    const ctrl = new AbortController();
    const seen: HarnessEvent[] = [];
    for await (const e of h.run(
      task({ mcp: { name: 'monsters', url: 'http://192.0.2.7:4791/api/harness/mcp', token: 't' } }),
      ctrl.signal,
    )) {
      seen.push(e);
      // The fake waits like a model with no tools: the runner would stop it here.
      if (e.type === 'mcp-status') ctrl.abort();
    }
    expect(seen.find((e) => e.type === 'mcp-status')).toEqual({
      type: 'mcp-status',
      servers: { monsters: 'failed' },
    });
    expect(seen.at(-1)).toMatchObject({ type: 'done', reason: 'aborted' });
    const env = records(record).find((r) => r.kind === 'run')!['env'] as Record<string, string>;
    // The user's list stays, plus loopback and the address the core listens on.
    // Windows keeps one of the two names (its environment ignores case): every one has the list.
    const lists = Object.entries(env).filter(([k]) => k.toLowerCase() === 'no_proxy');
    expect(lists.length).toBeGreaterThan(0);
    for (const [, v] of lists) {
      expect(v).toBe('intranet.example,localhost,127.0.0.1,::1,[::1],192.0.2.7');
    }
  });

  it("keeps a CLAUDE_CODE_OAUTH_TOKEN the user set, never a session's variables", async () => {
    const home = loggedInHome();
    const { h, record } = harness('tool', {
      ...userEnv(home),
      CLAUDE_CODE_OAUTH_TOKEN: 'user-own-token',
    });
    await h.status();
    for (const r of records(record)) {
      const env = r['env'] as Record<string, string>;
      expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBe('user-own-token');
      for (const name of SESSION_VARS) expect(env[name], name).toBeUndefined();
    }
  });

  it('counts the final tokens of each request even without partial messages', async () => {
    const { h } = harness('nostream', userEnv(loggedInHome()));
    const events = await collect(h.run(task(), new AbortController().signal));
    const usage = events.filter((e) => e.type === 'usage');
    expect(usage).toEqual([
      // The cache reads are part of the input, and said apart (C.1).
      { type: 'usage', model: 'claude-sonnet-test', inTok: 105, outTok: 1, cacheReadTok: 5 },
      { type: 'usage', model: 'claude-sonnet-test', inTok: 150, outTok: 1 },
      // The result's total: the output the `assistant` messages could not know yet.
      { type: 'usage', model: 'claude-sonnet-test', inTok: 7, outTok: 51, aggregate: true },
    ]);
    expect(usage.reduce((n, e) => n + e.outTok, 0)).toBe(53);
    expect(usage.reduce((n, e) => n + e.inTok, 0)).toBe(262);
  });

  it('hands over the usage in flight synchronously when the run is stopped', async () => {
    const { h, record } = harness('hang', userEnv(loggedInHome()));
    const controller = new AbortController();
    const atAbort: unknown[] = [];
    const events: HarnessEvent[] = [];
    const run = (async () => {
      for await (const e of h.run(
        task({ onAbortUsage: (u) => atAbort.push(u) }),
        controller.signal,
      )) {
        events.push(e);
        if (e.type === 'text-delta') {
          controller.abort();
          // Recorded inside abort(), before anything else (the kill's log entries).
          expect(atAbort).toEqual([
            {
              type: 'usage',
              model: 'claude-sonnet-test',
              inTok: 100,
              outTok: 1,
              cacheWriteTok: 20,
            },
          ]);
          // The fake ignores SIGINT: kill it the hard way. On Windows the
          // SIGINT of `abort()` already terminated it (no signals there).
          const pid = records(record).find((r) => r.kind === 'run')!['pid'] as number;
          try {
            process.kill(pid, 'SIGKILL');
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err;
          }
        }
      }
    })();
    await run;
    expect(events.filter((e) => e.type === 'usage')).toEqual([]);
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'aborted' });
  });

  it('does not wait forever for a binary that stays after its answer', async () => {
    const record = join(dir, 'claude-linger.jsonl');
    const h = new ClaudeAgentHarness({
      binary: () => ({
        command: process.execPath,
        args: [FAKE_CLAUDE_SCRIPT, `--fake-record=${record}`, '--fake-scenario=linger'],
        source: 'configured',
      }),
      env: userEnv(loggedInHome()),
      exitGraceMs: 300,
    });
    const started = Date.now();
    const events = await collect(h.run(task(), new AbortController().signal));
    expect(events.at(-1)).toEqual({
      type: 'done',
      reason: 'stop',
      text: 'Fatto: trova le ricette',
    });
    expect(Date.now() - started).toBeLessThan(5000);
    const pid = records(record).find((r) => r.kind === 'run')!['pid'] as number;
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('turns "not logged in" into a clear code', async () => {
    const home = join(dir, 'nobody');
    mkdirSync(home);
    const { h } = harness('tool', userEnv(home));
    const events = await collect(h.run(task(), new AbortController().signal));
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'error', code: 'not_logged_in' });
  });

  it('gives an agent with the web the built-in WebSearch, never WebFetch (D-069)', async () => {
    const { h, record } = harness('tool', userEnv(loggedInHome()));
    await collect(h.run(task({ webSearch: true }), new AbortController().signal));
    const argv = records(record).find((r) => r.kind === 'run')!['argv'] as string[];
    expect(argv[argv.indexOf('--tools') + 1]).toBe('WebSearch,ToolSearch');
    const allowed = argv.slice(argv.indexOf('--allowedTools') + 1, argv.indexOf('--tools'));
    expect(allowed).toEqual(['mcp__monsters', 'WebSearch']);
    expect(argv.join(' ')).not.toContain('WebFetch');
  });

  it('lets it Read exactly the files the user attached, also without the terminal (D-075)', async () => {
    const { h, record } = harness('tool', userEnv(loggedInHome()));
    const files = [
      '/home/g/Monsters Note/File/2026-10/foto.png',
      '/home/g/Monsters Note/File/2026-10/c.pdf',
    ];
    await collect(h.run(task({ webSearch: true, readFiles: files }), new AbortController().signal));
    const argv = records(record).find((r) => r.kind === 'run')!['argv'] as string[];
    expect(argv[argv.indexOf('--tools') + 1]).toBe('Read,WebSearch,ToolSearch');
    const allowed = argv.slice(argv.indexOf('--allowedTools') + 1, argv.indexOf('--tools'));
    expect(allowed).toEqual([
      'mcp__monsters',
      'Read(//home/g/Monsters Note/File/2026-10/foto.png)',
      'Read(//home/g/Monsters Note/File/2026-10/c.pdf)',
      'WebSearch',
    ]);
  });

  it('writes the hooks and the connector allowlist in a private settings file (D-069)', async () => {
    const { h, record } = harness('tool', userEnv(loggedInHome()));
    const events = await collect(
      h.run(
        task({
          systemTools: true,
          webSearch: true,
          hooks: { url: 'http://127.0.0.1:9/api/harness/hook', token: 'hook-token', stop: true },
          connectors: [
            { name: 'claude.ai Figma', kind: 'claude-ai', url: 'https://mcp.figma.com/*' },
            {
              name: 'claude-design',
              kind: 'http',
              url: 'https://api.anthropic.com/v1/design/mcp',
            },
          ],
        }),
        new AbortController().signal,
      ),
    );
    const run = records(record).find((r) => r.kind === 'run')!;
    const argv = run['argv'] as string[];
    // claude.ai connectors need the account's servers: the allowlist replaces --strict-mcp-config.
    expect(argv).not.toContain('--strict-mcp-config');
    // No settings file of the user or of the working folder (D-079).
    expect(argv[argv.indexOf('--setting-sources') + 1]).toBe('');
    const allowed = argv.slice(argv.indexOf('--allowedTools') + 1, argv.indexOf('--tools'));
    expect(allowed).toEqual([
      'mcp__monsters',
      ...['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'LS'],
      'WebSearch',
      'mcp__claude_ai_Figma',
      'mcp__claude-design',
    ]);
    // The tokens stay off the command line.
    expect(argv.join(' ')).not.toContain('hook-token');
    const file = argv[argv.indexOf('--settings') + 1]!;
    expect(file.endsWith('settings.json')).toBe(true);
    const settings = records(record).find((r) => r.kind === 'settings')!['settings'] as {
      hooks: Record<string, { matcher?: string; hooks: Record<string, unknown>[] }[]>;
      allowedMcpServers: unknown[];
    };
    const pre = settings.hooks['PreToolUse']![0]!;
    expect(pre.hooks[0]).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:9/api/harness/hook',
      headers: { Authorization: 'Bearer hook-token' },
      timeout: 3600,
      // A core that cannot answer blocks the tool (D-079).
      onFailure: 'block',
    });
    expect((settings as { disableAllHooks?: boolean }).disableAllHooks).toBe(false);
    const matcher = new RegExp(pre.matcher!);
    for (const t of [
      'Bash',
      'WebSearch',
      'mcp__claude_ai_Figma__get_screenshot',
      'mcp__claude-design__x',
    ]) {
      expect(matcher.test(t), t).toBe(true);
    }
    // The file tools too: the core keeps them out of Monsters' data folder (D-078).
    for (const t of ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'LS']) {
      expect(matcher.test(t), t).toBe(true);
    }
    // Monsters' own tools are checked in the core.
    for (const t of ['mcp__monsters__web_fetch', 'mcp__claude_ai_Slack__send']) {
      expect(matcher.test(t), t).toBe(false);
    }
    // Third-party results go back to the core (D-073): the web search and the services, not the terminal.
    const post = new RegExp(settings.hooks['PostToolUse']![0]!.matcher!);
    for (const t of [
      'WebSearch',
      'mcp__claude_ai_Figma__get_screenshot',
      'mcp__claude-design__x',
    ]) {
      expect(post.test(t), t).toBe(true);
    }
    for (const t of ['Bash', 'mcp__monsters__web_fetch', 'Read'])
      expect(post.test(t), t).toBe(false);
    expect(settings.hooks['PostToolUse']![0]!.hooks[0]).toMatchObject({
      type: 'http',
      timeout: 30,
    });
    // The errors of the services come to PostToolUseFailure (D-074): the same tools.
    expect(settings.hooks['PostToolUseFailure']).toEqual(settings.hooks['PostToolUse']);
    expect(settings.hooks['Stop']).toHaveLength(1);
    expect(settings.allowedMcpServers).toEqual([
      { serverName: 'monsters' },
      { serverName: 'claude-design' },
      { serverUrl: 'https://mcp.figma.com/*' },
    ]);
    // The first-party server is in the run's MCP config, with no header of Monsters.
    const servers = (run['mcpConfig'] as { mcpServers: Record<string, unknown> }).mcpServers;
    expect(servers['claude-design']).toEqual({
      type: 'http',
      url: 'https://api.anthropic.com/v1/design/mcp',
    });
    expect((run['env'] as Record<string, string>)['CLAUDE_CODE_MCP_STARTUP_WAIT_MS']).toBe('10000');
    // Monsters' own server: a call may last an hour (D-078: 2.1.301 cut it at 60 s).
    expect(servers['monsters']).toMatchObject({ type: 'http', timeout: 3_600_000 });
    expect(events[1]).toEqual({
      type: 'mcp-status',
      servers: { monsters: 'connected', 'claude-design': 'connected' },
    });
  });

  it('denies the data folder of Monsters to the file tools as a second layer (D-078)', () => {
    expect(claudeRulePath('/home/a/.monsters/agents')).toBe('//home/a/.monsters/agents');
    expect(claudeRulePath('C:\\Users\\a\\.monsters\\secrets\\')).toBe(
      '//c/Users/a/.monsters/secrets',
    );
    const base = {
      ...task(),
      systemTools: true,
      forbiddenPaths: ['/home/a/.monsters/secrets', '/home/a/.monsters/monsters.db'],
    };
    const settings = claudeRunSettings(base) as { permissions: { deny: string[] } };
    const ws = claudeRulePath(base.cwd);
    expect(settings.permissions.deny).toEqual([
      'Read(//home/a/.monsters/secrets)',
      'Read(//home/a/.monsters/secrets/**)',
      'Edit(//home/a/.monsters/secrets)',
      'Edit(//home/a/.monsters/secrets/**)',
      'Read(//home/a/.monsters/monsters.db)',
      'Read(//home/a/.monsters/monsters.db/**)',
      'Edit(//home/a/.monsters/monsters.db)',
      'Edit(//home/a/.monsters/monsters.db/**)',
      // The harness configuration of the working folder is never written (D-079).
      `Edit(${ws}/.claude)`,
      `Edit(${ws}/.claude/**)`,
      `Edit(${ws}/.mcp.json)`,
      `Edit(${ws}/CLAUDE.md)`,
      `Edit(${ws}/CLAUDE.local.md)`,
      `Edit(${ws}/AGENTS.md)`,
      `Edit(${ws}/AGENTS.override.md)`,
      `Edit(${ws}/.codex)`,
      `Edit(${ws}/.codex/**)`,
    ]);
    // Without the terminal and the files there is nothing to deny.
    expect(claudeRunSettings({ ...base, systemTools: false })).toEqual({
      autoMemoryEnabled: false,
    });
  });

  it('a plain run (a summary) turns extended thinking off; a normal run leaves it as it is (D-169)', () => {
    const base = {
      prompt: 'ok',
      cwd: '/tmp/ws',
      mcp: { name: 'monsters', url: 'http://127.0.0.1:1/mcp', token: 't' },
      systemTools: false,
      spawn: () => {
        throw new Error('not used');
      },
      scratchDir: '/tmp/run',
    };
    expect(claudeRunSettings({ ...base, plain: true })).toEqual({
      autoMemoryEnabled: false,
      alwaysThinkingEnabled: false,
    });
    expect(claudeRunSettings(base)).toEqual({ autoMemoryEnabled: false });
  });

  it('keeps --strict-mcp-config; the settings only switch the automatic memory off (M6)', async () => {
    const { h, record } = harness('tool', userEnv(loggedInHome()));
    await collect(h.run(task(), new AbortController().signal));
    const argv = records(record).find((r) => r.kind === 'run')!['argv'] as string[];
    expect(argv).toContain('--strict-mcp-config');
    expect(argv).toContain('--settings');
    // The session stays on disk (--resume needs it) and the login stays where it is.
    expect(argv).not.toContain('--no-session-persistence');
    const settings = records(record).find((r) => r.kind === 'settings')!['settings'];
    expect(settings).toEqual({ autoMemoryEnabled: false });
  });

  it('reads the state of a claude.ai connector from `claude mcp get`', () => {
    expect(
      parseConnectorStatus(0, 'claude.ai Figma:\n  Scope: claude.ai config\n  Status: ✔ Connected'),
    ).toEqual({ state: 'connected' });
    expect(parseConnectorStatus(0, 'claude.ai Stripe:\n  Status: ! Needs authentication')).toEqual({
      state: 'needs_login',
    });
    expect(
      parseConnectorStatus(1, 'No MCP server named "claude.ai Asana". Configured servers: …'),
    ).toEqual({ state: 'missing' });
    expect(parseConnectorStatus(0, 'claude.ai X:\n  Status: ✗ Failed to connect')).toEqual({
      state: 'error',
      message: '✗ Failed to connect',
    });
    // Wording we do not know (a new CLI version) says nothing about the account (C-10).
    expect(parseConnectorStatus(0, 'claude.ai X:\n  Stato: pronto al lavoro')).toEqual({
      state: 'unknown',
    });
    expect(parseConnectorStatus(0, 'claude.ai X:\n  Status: Ready')).toEqual({
      state: 'unknown',
      message: 'Ready',
    });
    expect(claudeToolPrefix('claude.ai Google Drive')).toBe('mcp__claude_ai_Google_Drive');
  });

  it('lets the agent use the built-in tools only with the shell permission', async () => {
    const { h, record } = harness('tool', userEnv(loggedInHome()));
    await collect(h.run(task({ systemTools: true }), new AbortController().signal));
    const argv = records(record).find((r) => r.kind === 'run')!['argv'] as string[];
    // Exactly the pre-approved ones, never `default` (D-127: WebSearch, WebFetch, Task… refused).
    expect(argv[argv.indexOf('--tools') + 1]).toBe('Bash,Read,Edit,Write,Glob,Grep,LS,ToolSearch');
    expect(argv).toContain('Bash');
  });

  it('sends a built-in outside the run to the core, never to the mode (D-127)', () => {
    const settings = claudeRunSettings({
      ...task({ systemTools: true, webSearch: true }),
      hooks: { url: 'http://127.0.0.1:9/api/harness/hook', token: 't', stop: false },
    }) as { hooks: Record<string, { matcher: string; hooks: Record<string, unknown>[] }[]> };
    const outside = settings.hooks['PreToolUse']!.at(-1)!;
    expect(outside.hooks[0]).toMatchObject({ type: 'http', onFailure: 'block' });
    const m = new RegExp(outside.matcher);
    for (const t of ['WebFetch', 'Task', 'TodoWrite', 'MultiEdit', 'Workflow', 'CronCreate']) {
      expect(m.test(t), t).toBe(true);
    }
    for (const t of ['Bash', 'Read', 'Grep', 'WebSearch', 'ToolSearch', 'mcp__monsters__x']) {
      expect(m.test(t), t).toBe(false);
    }
    // Without the web, WebSearch is outside too.
    const noWeb = claudeRunSettings({
      ...task({ systemTools: true }),
      hooks: { url: 'http://127.0.0.1:9/api/harness/hook', token: 't', stop: false },
    }) as { hooks: Record<string, { matcher: string }[]> };
    expect(new RegExp(noWeb.hooks['PreToolUse']!.at(-1)!.matcher).test('WebSearch')).toBe(true);
    expect(claudeOutsideMatcher(['Read', 'ToolSearch'])).toBe(
      '^(?!mcp__)(?!(?:Read|ToolSearch)$).+$',
    );
    expect(
      claudeDontAskDenial(
        "Permission to use WebFetch has been denied because Claude Code is running in don't ask mode. IMPORTANT",
      ),
    ).toBe('WebFetch');
    expect(claudeDontAskDenial('Permission denied: /etc/shadow')).toBeNull();
  });
});

describe('Codex harness', () => {
  function harness(
    scenario: string,
    env: NodeJS.ProcessEnv,
    fakeArgs: string[] = [],
    extra: { rpcTimeoutMs?: number; idleTimeoutMs?: number } = {},
  ) {
    // No `=` in the name: the fake splits `--fake-record=<file>` on it.
    const record = join(dir, `codex-${scenario}${fakeArgs.join('').replace(/=/g, '_')}.jsonl`);
    const h = new CodexHarness({
      binary: () => ({
        command: process.execPath,
        args: [
          FAKE_CODEX_SCRIPT,
          `--fake-record=${record}`,
          `--fake-scenario=${scenario}`,
          ...fakeArgs,
        ],
        source: 'configured',
      }),
      accessToken: ({ minValidityMs }) => {
        expect(minValidityMs).toBeGreaterThanOrEqual(15 * 60_000);
        return Promise.resolve('siwc-access-token');
      },
      codexHome: join(dir, 'codex-home'),
      baseURL: 'https://api.openai.com/v1',
      env,
      isSecret,
      clientVersion: '0.1.0',
      exitGraceMs: 500,
      ...extra,
    });
    return { h, record };
  }

  it('reads the plan limits Codex announces (D-111)', async () => {
    const { h } = harness('tool', userEnv(join(dir, 'home')));
    const events = await collect(h.run(task({ model: 'gpt-test' }), new AbortController().signal));
    const reading = events.find((e) => e.type === 'plan-limits');
    expect(reading).toMatchObject({
      reading: {
        plan: 'chatgpt',
        partial: true,
        windows: [
          { id: 'primary', usedPercent: 24, windowMinutes: 300 },
          { id: 'secondary', usedPercent: 81, windowMinutes: 10080 },
        ],
      },
    });
    const resets = (reading as { reading: { windows: { resetsAt: number }[] } }).reading.windows[0]!
      .resetsAt;
    expect(resets - Date.now()).toBeGreaterThan(70 * 60_000);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'stop' });
  });

  it('reads nothing from the empty update app-server sends when the backend gave no windows', async () => {
    const { h } = harness('tool', userEnv(join(dir, 'home')), ['--fake-limits=empty']);
    const events = await collect(h.run(task({ model: 'gpt-test' }), new AbortController().signal));
    expect(events.some((e) => e.type === 'plan-limits')).toBe(false);
    // The token counts are not lost with it: usage still reaches the log.
    expect(events.filter((e) => e.type === 'usage').length).toBeGreaterThan(0);
  });

  it('prints no limits when app-server sends none', async () => {
    const { h } = harness('tool', userEnv(join(dir, 'home')), ['--fake-limits=off']);
    const events = await collect(h.run(task({ model: 'gpt-test' }), new AbortController().signal));
    expect(events.some((e) => e.type === 'plan-limits')).toBe(false);
  });

  it('starts app-server with the SIWC token as documented, never codex login', async () => {
    const { h, record } = harness('tool', userEnv(join(dir, 'home')));
    const events = await collect(h.run(task({ model: 'gpt-test' }), new AbortController().signal));
    expect(events.filter((e) => e.type !== 'plan-limits' && e.type !== 'heartbeat')).toEqual([
      { type: 'session', id: 'thr_123', model: 'gpt-test' },
      { type: 'text-delta', delta: 'Cerco.' },
      { type: 'text', text: 'Cerco.' },
      {
        type: 'tool-call',
        id: 'm1',
        name: 'vault_search',
        input: { query: 'ricette' },
        monsters: true,
      },
      {
        type: 'tool-result',
        id: 'm1',
        output: {
          content: [{ type: 'text', text: '2 note trovate' }],
          structuredContent: null,
          _meta: null,
        },
        monsters: true,
      },
      { type: 'usage', model: 'gpt-test', inTok: 200, outTok: 100 },
      { type: 'text', text: 'Fatto: trova le ricette' },
      { type: 'done', reason: 'stop' },
    ]);

    const all = records(record);
    const start = all.find((r) => r.kind === 'start')!;
    const argv = start['argv'] as string[];
    expect(argv.slice(0, 3)).toEqual(['app-server', '--listen', 'stdio://']);
    const sets = argv.filter((_, i) => argv[i - 1] === '-c');
    expect(sets).toEqual(
      expect.arrayContaining([
        'model_provider="openai_chatgpt_plan"',
        'model_providers.openai_chatgpt_plan.name="ChatGPT plan"',
        'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
        'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"',
        'model_providers.openai_chatgpt_plan.wire_api="responses"',
        'model_providers.openai_chatgpt_plan.requires_openai_auth=false',
        'model_providers.openai_chatgpt_plan.supports_websockets=false',
        `mcp_servers.monsters.url="${mcpUrl}"`,
        'mcp_servers.monsters.bearer_token_env_var="MONSTERS_MCP_TOKEN"',
        // A delegation lasts minutes (D-078).
        'mcp_servers.monsters.tool_timeout_sec=3600',
      ]),
    );
    expect(argv).not.toContain('login');
    const env = start['env'] as Record<string, string>;
    expect(env['ACCESS_TOKEN']).toBe('siwc-access-token');
    expect(env['CODEX_HOME']).toBe(join(dir, 'codex-home'));
    for (const name of [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENROUTER_API_KEY',
      'MONSTERS_HOME',
      'SOME_TOOL_TOKEN',
      'CODEX_API_KEY',
      ...SESSION_VARS,
    ]) {
      expect(env[name], name).toBeUndefined();
    }
    // Only the CODEX_* that Monsters sets.
    expect(Object.keys(env).filter((n) => n.startsWith('CODEX_'))).toEqual(['CODEX_HOME']);
    const rpc = all.filter((r) => r.kind === 'rpc').map((r) => r['msg'] as Record<string, unknown>);
    expect(rpc[0]).toMatchObject({
      method: 'initialize',
      params: { clientInfo: { name: 'Monsters', title: 'Monsters', version: '0.1.0' } },
    });
    expect(rpc[0]).not.toHaveProperty('jsonrpc');
    expect(rpc[1]).toEqual({ method: 'initialized', params: {} });
    expect(rpc[2]).toMatchObject({
      method: 'thread/start',
      params: { approvalPolicy: 'never', sandbox: 'read-only', model: 'gpt-test', cwd: task().cwd },
    });
    // Without the `shell` permission Codex has no command tool at all (read-only still reads).
    expect((rpc[2] as { params: { config: unknown } }).params.config).toEqual({
      web_search: 'disabled',
      features: { shell_tool: false, unified_exec: false, multi_agent: false, view_image: false },
    });
    expect(rpc[3]).toMatchObject({
      method: 'turn/start',
      params: { threadId: 'thr_123', input: [{ type: 'text', text: 'trova le ricette' }] },
    });
    expect(mcpCalls.every((c) => c.auth === 'Bearer run-token')).toBe(true);
    expect(mcpCalls.some((c) => c.method === 'tools/call')).toBe(true);
  });

  it('reports a usage limit as it arrives', async () => {
    const { h } = harness('usage_limit', userEnv(join(dir, 'home')));
    const events = await collect(h.run(task(), new AbortController().signal));
    expect(events.at(-1)).toEqual({
      type: 'done',
      reason: 'error',
      code: 'chatgpt_usage_limit',
      error: 'You have hit your usage limit.',
    });
  });

  it('gives the attached images as local images of the turn (D-075)', async () => {
    const { h, record } = harness('tool', userEnv(join(dir, 'home')));
    await collect(h.run(task({ images: ['/n/File/2026-10/a.png'] }), new AbortController().signal));
    const turn = records(record)
      .filter((r) => r.kind === 'rpc')
      .map((r) => r['msg'] as { method: string; params: { input: unknown[] } })
      .find((m) => m.method === 'turn/start')!;
    expect(turn.params.input.slice(1)).toEqual([
      { type: 'localImage', path: '/n/File/2026-10/a.png' },
    ]);
  });

  it('resumes a thread instead of starting one', async () => {
    const { h, record } = harness('tool', userEnv(join(dir, 'home')));
    await collect(h.run(task({ resume: 'thr_old' }), new AbortController().signal));
    const rpc = records(record)
      .filter((r) => r.kind === 'rpc')
      .map((r) => r['msg'] as { method: string; params: unknown });
    expect(rpc[2]).toMatchObject({ method: 'thread/resume', params: { threadId: 'thr_old' } });
  });

  it("counts only this turn's tokens, once (resumed thread, repeated update)", async () => {
    const { h } = harness('tool', userEnv(join(dir, 'home')));
    const events = await collect(h.run(task({ resume: 'thr_old' }), new AbortController().signal));
    expect(events.filter((e) => e.type === 'usage')).toEqual([
      { type: 'usage', model: 'gpt-test', inTok: 200, outTok: 100 },
    ]);
  });

  it('gives the commands back with the shell permission', async () => {
    const { h, record } = harness('tool', userEnv(join(dir, 'home')));
    await collect(h.run(task({ systemTools: true }), new AbortController().signal));
    const start = records(record)
      .filter((r) => r.kind === 'rpc')
      .map((r) => r['msg'] as { method: string; params: Record<string, unknown> })
      .find((m) => m.method === 'thread/start')!;
    expect(start.params['sandbox']).toBe('workspace-write');
    expect(start.params['config']).toEqual({ web_search: 'disabled' });
  });

  it("turns on Codex's own web search only for an agent with the web (D-069)", async () => {
    const { h, record } = harness('tool', userEnv(join(dir, 'home')));
    await collect(
      h.run(task({ systemTools: true, webSearch: true }), new AbortController().signal),
    );
    const start = records(record)
      .filter((r) => r.kind === 'rpc')
      .map((r) => r['msg'] as { method: string; params: Record<string, unknown> })
      .find((m) => m.method === 'thread/start')!;
    expect(start.params['config']).toEqual({ web_search: 'live' });
  });

  it('stops a turn that goes past maxTurns', async () => {
    const { h, record } = harness('loop', userEnv(join(dir, 'home')));
    const events = await collect(h.run(task({ maxTurns: 2 }), new AbortController().signal));
    // The stop comes at the second usage update; every call that started still has its trace (F-B10).
    const calls = events.filter((e) => e.type === 'tool-call');
    expect(calls.map((e) => (e as { id: string }).id)).toEqual(['l1', 'l2', 'l3', 'l4', 'l5']);
    expect(events.filter((e) => e.type === 'usage')).toHaveLength(5);
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'max-steps' });
    const methods = records(record)
      .filter((r) => r.kind === 'rpc')
      .map((r) => (r['msg'] as { method: string }).method);
    expect(methods).toContain('turn/interrupt');
  });

  it('does not hang on an app-server that never answers initialize (F-M3)', async () => {
    const { h } = harness('noinit', userEnv(join(dir, 'home')), [], { rpcTimeoutMs: 200 });
    const events = await collect(h.run(task({}), new AbortController().signal));
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'error' });
    expect((events.at(-1) as { error: string }).error).toMatch(/isn’t answering initialize/);
  });

  it('ends a turn whose notifications stop for good (F-M3)', async () => {
    const { h } = harness('hang', userEnv(join(dir, 'home')), [], { idleTimeoutMs: 300 });
    const events = await collect(h.run(task({}), new AbortController().signal));
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'error' });
    expect((events.at(-1) as { error: string }).error).toMatch(/no sign of life/);
  });

  it('waits for a long command: its open item stops the clock, its output is a sign of life', async () => {
    const { h } = harness('longcmd', userEnv(join(dir, 'home')), ['--fake-cmd-ms=600'], {
      idleTimeoutMs: 200,
    });
    const events = await collect(h.run(task({ systemTools: true }), new AbortController().signal));
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'stop' });
    expect(events).toContainEqual({
      type: 'tool-call',
      id: 'c1',
      name: 'shell',
      input: { command: 'pnpm test' },
    });
    expect(events.some((e) => e.type === 'heartbeat')).toBe(true);
  });

  describe('commands that need the network (D-158)', () => {
    const rpcOf = (record: string) =>
      records(record)
        .filter((r) => r.kind === 'rpc')
        .map(
          (r) =>
            r['msg'] as {
              id?: number;
              method?: string;
              params?: Record<string, unknown>;
              result?: unknown;
            },
        );

    it('reads the command out of the shell wrapper Codex puts around it', () => {
      // As 0.163.0 sends it: mixed '…' and "…" pieces.
      expect(
        codexShellCommand(
          `/usr/bin/bash -lc "echo \\"it's "'$HOME" '"'a b' && ls ~/.monsters > /dev/null"`,
        ),
      ).toBe(`echo "it's $HOME" 'a b' && ls ~/.monsters > /dev/null`);
      expect(codexShellCommand(`/usr/bin/bash -lc 'curl -sS https://example.com'`)).toBe(
        'curl -sS https://example.com',
      );
      expect(codexShellCommand('bash -c ls')).toBe('ls');
      // Not one word after -lc, or another program: left as it is.
      expect(codexShellCommand(`bash -lc 'a' 'b'`)).toBe(`bash -lc 'a' 'b'`);
      expect(codexShellCommand('pnpm test')).toBe('pnpm test');
      expect(codexShellCommand(`bash -lc 'open`)).toBe(`bash -lc 'open`);
    });

    it('maps the MCP startup states of app-server', () => {
      expect(codexMcpStatus({ name: 'monsters', status: 'ready' })).toEqual({
        monsters: 'connected',
      });
      expect(codexMcpStatus({ name: 'x', status: 'starting' })).toEqual({ x: 'pending' });
      expect(codexMcpStatus({ name: 'x', status: 'cancelled' })).toEqual({ x: 'failed' });
      expect(
        codexMcpStatus({ name: 'x', status: 'failed', failureReason: 'reauthenticationRequired' }),
      ).toEqual({ x: 'needs-auth' });
      expect(codexMcpStatus({ name: 'x', status: 'other' })).toBeNull();
    });

    it('asks the core before a command leaves the sandbox, and runs it when allowed', async () => {
      const { h, record } = harness('netcmd', userEnv(join(dir, 'home')));
      const asked: unknown[] = [];
      const events = await collect(
        h.run(
          task({
            systemTools: true,
            approveCommand: (call) => {
              asked.push(call);
              return Promise.resolve(null);
            },
          }),
          new AbortController().signal,
        ),
      );
      // The command the model wrote, out of Codex's `bash -lc '…'` and its quoting.
      expect(asked).toEqual([
        {
          id: 'exec-1',
          command: `git push origin main && echo "it's done"`,
          cwd: expect.any(String) as unknown,
          reason: 'Do you want to push the branch?',
        },
      ]);
      const rpc = rpcOf(record);
      expect(rpc.find((m) => m.method === 'thread/start')?.params).toMatchObject({
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandbox: 'workspace-write',
      });
      expect(records(record).find((r) => r.kind === 'approval')?.['answer']).toEqual({
        decision: 'accept',
      });
      expect(rpc.some((m) => m.method === 'thread/inject_items')).toBe(false);
      expect(events).toContainEqual({
        type: 'tool-result',
        id: 'exec-1',
        output: { output: 'pushed\n', exitCode: 0 },
      });
      expect(events.at(-1)).toEqual({ type: 'done', reason: 'stop' });
    });

    it("refuses with Monsters' words, added to the thread before the decline", async () => {
      const { h, record } = harness('netcmd', userEnv(join(dir, 'home')));
      const events = await collect(
        h.run(
          task({
            systemTools: true,
            approveCommand: () => Promise.resolve('Monsters’ internal files are not reachable.'),
          }),
          new AbortController().signal,
        ),
      );
      const all = records(record);
      const inject = all.findIndex(
        (r) =>
          r.kind === 'rpc' && (r['msg'] as { method?: string }).method === 'thread/inject_items',
      );
      const approval = all.findIndex((r) => r.kind === 'approval');
      expect(inject).toBeGreaterThan(-1);
      expect(inject).toBeLessThan(approval);
      const params = (all[inject]!['msg'] as { params: Record<string, unknown> }).params;
      expect(params).toMatchObject({
        threadId: 'thr_123',
        items: [{ type: 'message', role: 'developer' }],
      });
      const text = JSON.stringify(params['items']);
      expect(text).toContain('git push origin main');
      expect(text).toContain('Monsters’ internal files are not reachable.');
      expect(text).toContain('rejected by user');
      expect(all[approval]!['answer']).toEqual({ decision: 'decline' });
      expect(events.at(-1)).toEqual({ type: 'done', reason: 'stop' });
    });

    it('declines when the check fails, and never escalates without the check', async () => {
      const failing = harness('netcmd', userEnv(join(dir, 'home')), ['--fake-x=1']);
      await collect(
        failing.h.run(
          task({ systemTools: true, approveCommand: () => Promise.reject(new Error('boom')) }),
          new AbortController().signal,
        ),
      );
      expect(records(failing.record).find((r) => r.kind === 'approval')?.['answer']).toEqual({
        decision: 'decline',
      });
      const bare = harness('netcmd', userEnv(join(dir, 'home')), ['--fake-x=2']);
      await collect(bare.h.run(task({ systemTools: true }), new AbortController().signal));
      expect(rpcOf(bare.record).find((m) => m.method === 'thread/start')?.params).toMatchObject({
        approvalPolicy: 'never',
      });
      expect(records(bare.record).find((r) => r.kind === 'approval')?.['answer']).toEqual({
        decision: 'decline',
      });
      // Without the terminal the check is never given to Codex either.
      const reader = harness('tool', userEnv(join(dir, 'home')), ['--fake-x=3']);
      await collect(
        reader.h.run(
          task({ approveCommand: () => Promise.resolve(null) }),
          new AbortController().signal,
        ),
      );
      expect(rpcOf(reader.record).find((m) => m.method === 'thread/start')?.params).toMatchObject({
        approvalPolicy: 'never',
        sandbox: 'read-only',
      });
    });

    it('reports the prompt-cache reads of each request (cachedInputTokens)', async () => {
      const { h } = harness('netcmd', userEnv(join(dir, 'home')));
      const events = await collect(
        h.run(
          task({ systemTools: true, approveCommand: () => Promise.resolve(null) }),
          new AbortController().signal,
        ),
      );
      expect(events.filter((e) => e.type === 'usage')).toEqual([
        { type: 'usage', model: 'gpt-test', inTok: 1000, outTok: 20, cacheReadTok: 600 },
        { type: 'usage', model: 'gpt-test', inTok: 1001, outTok: 20, cacheReadTok: 601 },
      ]);
    });

    it("reports the MCP servers' startup, and needs Monsters' server to start", async () => {
      const ok = harness('netcmd', userEnv(join(dir, 'home')));
      const events = await collect(
        ok.h.run(
          task({ systemTools: true, approveCommand: () => Promise.resolve(null) }),
          new AbortController().signal,
        ),
      );
      expect(events.filter((e) => e.type === 'mcp-status')).toEqual([
        { type: 'mcp-status', servers: { monsters: 'pending' } },
        { type: 'mcp-status', servers: { monsters: 'connected' } },
      ]);
      const argv = records(ok.record).find((r) => r.kind === 'start')!['argv'] as string[];
      expect(argv).toContain('mcp_servers.monsters.required=true');
      expect(argv).toContain('mcp_servers.monsters.default_tools_approval_mode="approve"');

      const failed = harness('mcpfail', userEnv(join(dir, 'home')));
      const out = await collect(failed.h.run(task(), new AbortController().signal));
      expect(out.filter((e) => e.type !== 'heartbeat')).toEqual([
        { type: 'mcp-status', servers: { monsters: 'failed' } },
        {
          type: 'done',
          reason: 'error',
          code: 'mcp_unavailable',
          error: expect.stringContaining('`monsters`') as unknown,
        },
      ]);
      expect(rpcOf(failed.record).some((m) => m.method === 'turn/start')).toBe(false);
    });
  });

  it('tells a failed refresh from a sign-out', async () => {
    const make = (err: Error) =>
      new CodexHarness({
        binary: () => ({
          command: process.execPath,
          args: [FAKE_CODEX_SCRIPT],
          source: 'configured',
        }),
        accessToken: () => Promise.reject(err),
        codexHome: join(dir, 'codex-home'),
      });
    const signal = new AbortController().signal;
    const out = await collect(
      make(new SiwcError('signed_out', 'sign in again')).run(task(), signal),
    );
    expect(out.at(-1)).toMatchObject({ reason: 'error', code: 'signed_out' });
    const down = await collect(
      make(new SiwcError('unavailable', 'refresh: 502')).run(task(), signal),
    );
    expect(down.at(-1)).toMatchObject({ reason: 'error', code: 'unavailable' });
    // No answer at all from OpenAI: the user reads why, and that the sign-in stays.
    const offline = await collect(
      make(
        new SiwcError('unavailable', 'auth.openai.com is unreachable (dns ENOTFOUND)', {
          network: { kind: 'dns', code: 'ENOTFOUND', host: 'auth.openai.com' },
        }),
      ).run(task(), signal),
    );
    const last = offline.at(-1) as { reason?: string; code?: string; error?: string };
    expect(last).toMatchObject({ reason: 'error', code: 'unavailable' });
    expect(last.error).toMatch(
      /^I can’t reach OpenAI \(auth\.openai\.com\): the name doesn’t resolve .*still valid/,
    );
  });
});

describe('installing an official package on request', () => {
  const npm = { command: process.execPath, args: [FAKE_NPM_SCRIPT], source: 'path' as const };
  function install(scenario: string) {
    const target = join(dir, `install-${scenario}`);
    const record = join(dir, `npm-${scenario}.jsonl`);
    const run = installPackage(target, '@openai/codex@0.159.2', {
      integrity: CODEX_INTEGRITY,
      npm,
      env: {
        PATH: process.env['PATH'],
        FAKE_NPM_RECORD: record,
        FAKE_NPM_SCENARIO: scenario,
        FAKE_NPM_INTEGRITY: CODEX_INTEGRITY,
      },
    });
    return { run, target, record };
  }

  it('uses the official registry for the package and its scope, without scripts', async () => {
    const { run, record } = install('ok');
    await run;
    const argv = (JSON.parse(readFileSync(record, 'utf8').trim()) as { argv: string[] }).argv;
    expect(argv).toEqual(
      expect.arrayContaining([
        'install',
        '--ignore-scripts',
        '--registry=https://registry.npmjs.org/',
        '--@openai:registry=https://registry.npmjs.org/',
      ]),
    );
    expect(argv.at(-1)).toBe('@openai/codex@0.159.2');
  });

  it('removes an install whose package has another integrity or comes from elsewhere', async () => {
    const tampered = install('tampered');
    await expect(tampered.run).rejects.toThrow(/integrity/);
    expect(existsSync(join(tampered.target, 'node_modules'))).toBe(false);
    const foreign = install('foreign');
    await expect(foreign.run).rejects.toThrow(/registry\.npmjs\.org/);
    expect(existsSync(join(foreign.target, 'node_modules'))).toBe(false);
  });

  it('accepts only an exact version', async () => {
    await expect(
      installPackage(join(dir, 'x'), '@openai/codex@latest', { integrity: 'x', npm }),
    ).rejects.toThrow(/exact/);
  });

  it('says how to get npm when there is none (desktop app without Node)', async () => {
    // A configured Node with no npm next to it, nothing on the PATH.
    const env = { PATH: '', MONSTERS_NODE_PATH: join(dir, 'missing', 'node') };
    await expect(
      installPackage(join(dir, 'x'), '@openai/codex@0.159.2', { integrity: 'x', env }),
    ).rejects.toThrow(/npm not found.*nodejs\.org.*MONSTERS_NODE_PATH/);
  });

  it('runs a script binary with the variables of its runtime', async () => {
    const out = await runOnce(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write(process.env.RUNTIME_FLAG ?? "")'],
        source: 'installed',
        env: { RUNTIME_FLAG: 'on' },
      },
      [],
      { env: { PATH: process.env['PATH'] ?? '' } },
    );
    expect(out.stdout).toBe('on');
  });
});
