/*
 * Probe of the real harness binaries (D5 of the capability audit of 19/10,
 * D-127): what a Monsters run SEES must be what it may RUN. For each typical run it
 * builds the HarnessTask, the argv and the settings file exactly as Monsters does and
 * compares the tools the binary offers with what the run pre-approves. A visible
 * built-in that is not approved is refused by `dontAsk` with "STOP and explain to the
 * user… let the user decide", and the monster says the user denied it (19/10/2026).
 *
 *   pnpm exec node packages/core/test/fixtures/probe-harness-tools.ts
 *
 * Exit code: 0 all clean, 1 a mismatch (one line each) or a probe that did not work,
 * 3 Claude Code not installed (nothing probed). Codex missing is only a line.
 * `PROBE_CLAUDE` / `PROBE_CODEX` name the binaries; otherwise `claude` on the PATH, and
 * Codex as the core finds it (installed by Monsters under MONSTERS_HOME, else the PATH).
 *
 * No request reaches a model, so no token is spent:
 *
 * - Claude Code (checked on 2.1.303, 19/10/2026). With `-p --input-format stream-json`
 *   the binary prints nothing until a user message arrives: stdin open and silent →
 *   nothing in 20 s; stdin closed → exit 0 in 1.2 s with no output; the control
 *   requests (`initialize`, `get_context_usage`) answer without the tool names. So the
 *   probe sends the user message, and the run's settings file gets one more hook,
 *   `UserPromptSubmit` → command `exit 2`, which blocks the prompt. Order on 2.1.303:
 *   `system/init` (with `tools`), then `system/informational` "UserPromptSubmit operation
 *   blocked by hook" (`prompt_submit_outcome.kind: blocked_by_hook`), then `result` with
 *   `num_turns: 0`, `duration_api_ms: 0`, every usage count 0, `modelUsage: {}`; no
 *   `stream_event`, `assistant` or `rate_limit_event` ever. A hook does not change the
 *   tool list (`--tools`/`--allowedTools` stay identical); the probe also fails if any
 *   sign of a request shows up (`requestSigns`).
 * - Codex: `codex app-server` with `codexArgs` whose `base_url` is a loopback server of
 *   the probe. The first `POST …/responses` is recorded (its `tools` are what the model
 *   would get) and answered 400, so OpenAI is never reached; `ACCESS_TOKEN` is a dummy.
 *   Codex is not installed on the PC where this was written: that half is unit-tested
 *   only, and its tool names (`CODEX_*` below) come from codex.ts and the Codex sources;
 *   an unknown name is reported, to be sorted into the lists here.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateSync, zstdDecompressSync } from 'node:zlib';
import {
  ClaudeAgentHarness,
  claudeEnv,
  claudeMcpEnv,
  claudeRunSettings,
  codexArgs,
  codexEnv,
  codexThreadConfig,
  parseJsonLine,
  readLines,
  type HarnessBinary,
  type HarnessTask,
} from '@monsters/providers';
import { findOnPath } from '@monsters/shared/node';
import { startFakeHttpServer } from './fake-mcp-server.ts';

/** Name of Monsters' MCP server in a run (`HARNESS_MCP_SERVER` of the core). */
const SERVER = 'monsters';

/** What a check found: errors make the probe red, notes are printed only. */
export interface ToolCheck {
  errors: string[];
  notes: string[];
}

/** What Claude Code 2.1.303 listed with `--tools default` (probe of 19/10/2026, no request). */
export const CLAUDE_DEFAULT_TOOLS_2_1_303: readonly string[] = [
  'Task',
  'Bash',
  'CronCreate',
  'CronDelete',
  'CronList',
  'DesignSync',
  'Edit',
  'EnterWorktree',
  'ExitWorktree',
  'ListAgents',
  'Monitor',
  'NotebookEdit',
  'PushNotification',
  'Read',
  'RemoteTrigger',
  'ReportFindings',
  'ScheduleWakeup',
  'SendMessage',
  'Skill',
  'TaskStop',
  'ToolSearch',
  'WebFetch',
  'WebSearch',
  'Workflow',
  'Write',
];

/** One typical run of Monsters, as the fields of its HarnessTask that decide the tools. */
export interface ProbeCase {
  id: string;
  label: string;
  task: Pick<HarnessTask, 'systemTools' | 'webSearch' | 'readFiles'>;
}

/** The runs probed (`attachment` gets the path of a real temporary file). */
export function probeCases(attachment: string): ProbeCase[] {
  return [
    { id: 'capo', label: 'capo di progetto (terminale, niente web)', task: { systemTools: true } },
    {
      id: 'web',
      label: 'membro col web (terminale e web)',
      task: { systemTools: true, webSearch: true },
    },
    { id: 'plain', label: 'membro senza web e senza terminale', task: { systemTools: false } },
    {
      id: 'files',
      label: 'allegati senza terminale',
      task: { systemTools: false, readFiles: [attachment] },
    },
  ];
}

// --- Claude Code ------------------------------------------------------------------------

/** Built-ins that need no approval (the binary's own tool search: it only loads tools). */
const CLAUDE_NO_APPROVAL = ['ToolSearch'];

/** Splits one `--allowedTools` value on commas or spaces outside parentheses (`Read(/a b)`). */
function splitRules(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || ch === ' ')) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * `--tools` (one comma-separated value, `''` for none, `default` for all) and
 * `--allowedTools` (variadic: every argument up to the next `--flag`) of an argv.
 */
export function claudeToolFlags(argv: readonly string[]): { tools: string[]; allowed: string[] } {
  const tools: string[] = [];
  const allowed: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--tools' && i + 1 < argv.length) {
      tools.push(
        ...argv[++i]!.split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      );
    } else if (arg === '--allowedTools' || arg === '--allowed-tools') {
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) {
        allowed.push(...splitRules(argv[++i]!));
      }
    }
  }
  return { tools, allowed };
}

/** True when a tool of the `init` message is pre-approved by one of the rules. */
function claudeApproved(tool: string, allowed: readonly string[]): boolean {
  return allowed.some(
    (rule) =>
      rule === tool ||
      // `Read(<path>)`: approved on those paths; the core's hook answers any other (D-127).
      rule.startsWith(`${tool}(`) ||
      // `mcp__monsters` approves every tool of that server.
      (rule.startsWith('mcp__') && !rule.includes('(') && tool.startsWith(`${rule}__`)),
  );
}

/**
 * Compares the argv of a run with the `tools` of its `init`: every visible tool must be
 * pre-approved (built-ins and MCP), except the ones that need no approval. A built-in of
 * `--tools` the binary does not list is a note (2.1.303 drops `LS` without error).
 */
export function checkClaudeTools(argv: readonly string[], initTools: readonly string[]): ToolCheck {
  const { tools, allowed } = claudeToolFlags(argv);
  const errors: string[] = [];
  const notes: string[] = [];
  for (const t of initTools) {
    if (CLAUDE_NO_APPROVAL.includes(t) || claudeApproved(t, allowed)) continue;
    const asked = tools.includes(t) || tools.includes('default');
    errors.push(
      `${t}: visibile ma non pre-approvato (visible, not allowed): dontAsk lo rifiuterebbe` +
        (asked ? '' : '; e --tools non lo chiede'),
    );
  }
  if (!tools.includes('default')) {
    for (const t of tools) {
      if (!initTools.includes(t))
        notes.push(`${t}: chiesto in --tools ma il binario non lo elenca`);
    }
  }
  return { errors, notes };
}

/**
 * Signs that a model request was made (there must be none): any message of the model,
 * of the plan's limits, or a result with turns, API time, usage or cost.
 */
export function requestSigns(messages: readonly Record<string, unknown>[]): string[] {
  const signs: string[] = [];
  for (const m of messages) {
    const type = m['type'];
    if (type === 'assistant' || type === 'stream_event' || type === 'rate_limit_event') {
      signs.push(`messaggio ${String(type)}`);
    }
    if (type !== 'result') continue;
    const usage = (m['usage'] ?? {}) as Record<string, unknown>;
    const tokens = [
      'input_tokens',
      'output_tokens',
      'cache_creation_input_tokens',
      'cache_read_input_tokens',
    ]
      .map((k) => usage[k])
      .some((v) => typeof v === 'number' && v > 0);
    const models = m['modelUsage'] as Record<string, unknown> | undefined;
    if (
      (typeof m['num_turns'] === 'number' && m['num_turns'] > 0) ||
      (typeof m['duration_api_ms'] === 'number' && m['duration_api_ms'] > 0) ||
      (typeof m['total_cost_usd'] === 'number' && m['total_cost_usd'] > 0) ||
      tokens ||
      (models && Object.keys(models).length > 0)
    ) {
      signs.push('result con turni, tempo API o token');
    }
  }
  return signs;
}

/** The settings file of the run plus the hook that blocks the prompt (no model request). */
export function probeSettings(task: HarnessTask): Record<string, unknown> {
  const settings = claudeRunSettings(task);
  const hooks = (settings['hooks'] ?? {}) as Record<string, unknown>;
  return {
    ...settings,
    disableAllHooks: false,
    hooks: {
      ...hooks,
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: 'echo monsters-probe >&2; exit 2' }] },
      ],
    },
  };
}

interface ClaudeOutcome {
  argv: string[];
  initTools: string[] | null;
  blocked: boolean;
  signs: string[];
  failure?: string;
}

async function probeClaude(
  binary: HarnessBinary,
  probe: ProbeCase,
  mcp: { url: string; token: string },
  dir: string,
): Promise<ClaudeOutcome> {
  const scratch = mkdtempSync(join(dir, `${probe.id}-`));
  const task: HarnessTask = {
    prompt: 'Rispondi solo: ok',
    cwd: scratch,
    instructions: 'Prova notturna degli strumenti di Monsters.',
    model: 'sonnet',
    mcp: { name: SERVER, ...mcp },
    ...probe.task,
    // A dead loopback URL: these hooks only fire on a tool call, and none is made. No `stop`
    // hook: nothing may ask the model to go on.
    hooks: { url: 'http://127.0.0.1:9/hook', token: 'probe', stop: false },
    forbiddenPaths: [join(scratch, 'closed')],
    maxTurns: 30,
    spawn: () => {
      throw new Error('not used');
    },
    scratchDir: scratch,
  };
  // The same files as ClaudeAgentHarness.run (the MCP token in the file, not in the argv).
  const mcpConfig = join(scratch, 'mcp.json');
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        [SERVER]: { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } },
      },
    }),
    { mode: 0o600 },
  );
  const instructions = join(scratch, 'instructions.md');
  writeFileSync(instructions, task.instructions!, { mode: 0o600 });
  const settings = join(scratch, 'settings.json');
  writeFileSync(settings, JSON.stringify(probeSettings(task)), { mode: 0o600 });
  const argv = ClaudeAgentHarness.args(task, { mcpConfig, instructions, settings });
  const child = spawn(binary.command, [...binary.args, ...argv], {
    cwd: scratch,
    env: {
      ...claudeEnv(process.env),
      ...binary.env,
      ...claudeMcpEnv(),
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  child.stdin.on('error', () => {});
  child.stdin.end(
    `${JSON.stringify({
      type: 'user',
      message: { role: 'user', content: task.prompt },
      parent_tool_use_id: null,
      session_id: '',
    })}\n`,
  );
  const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
  const messages: Record<string, unknown>[] = [];
  let initTools: string[] | null = null;
  let blocked = false;
  try {
    for await (const line of readLines(child.stdout)) {
      const msg = parseJsonLine(line);
      if (!msg) continue;
      messages.push(msg);
      if (msg['type'] === 'system' && msg['subtype'] === 'init' && Array.isArray(msg['tools'])) {
        initTools = (msg['tools'] as unknown[]).filter((t): t is string => typeof t === 'string');
      }
      const outcome = msg['prompt_submit_outcome'] as { kind?: unknown } | undefined;
      if (outcome?.kind === 'blocked_by_hook') blocked = true;
      if (msg['type'] === 'result') break;
    }
  } finally {
    clearTimeout(timer);
    stop(child);
  }
  const signs = requestSigns(messages);
  if (!initTools)
    return { argv, initTools, blocked, signs, failure: 'nessun messaggio init entro 60 s' };
  return { argv, initTools, blocked, signs };
}

function stop(child: ChildProcess): void {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

// --- Codex ------------------------------------------------------------------------------

/**
 * Codex tools that need the client and that Monsters answers (`answerServerRequest` of
 * codex.ts): `request_user_input` gets Monsters' words, not an error (D-135, review M4).
 */
export const CODEX_HANDLED_CLIENT_TOOLS: readonly string[] = ['request_user_input'];
/** Client tools Monsters does not answer: visible means refused. */
const CODEX_CLIENT_TOOLS = ['request_user_input'];
/** Command, file and sub-agent tools: only with the terminal (`shell`), see codexThreadConfig. */
const CODEX_SHELL_TOOLS = [
  'shell',
  'shell_command',
  'local_shell',
  'exec_command',
  'write_stdin',
  'unified_exec',
  'apply_patch',
  'view_image',
  'spawn_agent',
  'send_input',
  'wait',
  'close_agent',
];
/** Codex's own web search: only for a run with the web. */
const CODEX_WEB_TOOLS = ['web_search', 'web_search_preview'];
/** Tools that run inside Codex with nothing to approve (the plan). */
const CODEX_INTERNAL_TOOLS = ['update_plan'];

/**
 * Names of the tools of a Responses API request body: `name` of a function tool, `type`
 * of a hosted one (`web_search`, `local_shell`); a group with its own `tools` (a
 * namespace, newer versions) gives `<group>__<tool>`.
 */
export function codexToolNames(body: unknown): string[] {
  const tools = (body as { tools?: unknown } | null)?.tools;
  if (!Array.isArray(tools)) return [];
  const names: string[] = [];
  for (const t of tools as Record<string, unknown>[]) {
    const name = typeof t['name'] === 'string' ? t['name'] : undefined;
    if (Array.isArray(t['tools'])) {
      for (const sub of codexToolNames({ tools: t['tools'] }))
        names.push(name ? `${name}__${sub}` : sub);
    } else if (name) names.push(name);
    else if (typeof t['type'] === 'string') names.push(t['type']);
  }
  return names;
}

/** Compares the tools Codex would give the model with what Monsters runs for that run. */
export function checkCodexTools(
  names: readonly string[],
  run: { systemTools: boolean; webSearch?: boolean | undefined; server?: string },
): ToolCheck {
  const server = run.server ?? SERVER;
  const errors: string[] = [];
  const notes: string[] = [];
  const err = (t: string, why: string) => errors.push(`${t}: visibile (visible) ma ${why}`);
  for (const t of names) {
    if (t.startsWith(`mcp__${server}__`) || t.startsWith(`${server}__`)) continue;
    if (CODEX_INTERNAL_TOOLS.includes(t)) continue;
    if (CODEX_SHELL_TOOLS.includes(t)) {
      if (!run.systemTools) err(t, 'la run non ha il terminale');
    } else if (CODEX_WEB_TOOLS.includes(t)) {
      if (!run.webSearch) err(t, 'la run non ha il web');
    } else if (CODEX_CLIENT_TOOLS.includes(t)) {
      if (!CODEX_HANDLED_CLIENT_TOOLS.includes(t)) err(t, 'Monsters lo rifiuta («not supported»)');
    } else if (t.startsWith('mcp__') || t.includes('__')) {
      err(t, `non è del server ${server}`);
    } else {
      err(t, 'sconosciuto alla prova: va classificato in probe-harness-tools.ts');
    }
  }
  if (run.webSearch && !names.some((t) => CODEX_WEB_TOOLS.includes(t))) {
    notes.push('web_search: la run ha il web ma Codex non lo offre');
  }
  return { errors, notes };
}

function bodyOf(req: IncomingMessage, raw: Buffer): unknown {
  const enc = String(req.headers['content-encoding'] ?? '').toLowerCase();
  const data =
    enc === 'zstd'
      ? zstdDecompressSync(raw)
      : enc === 'gzip'
        ? gunzipSync(raw)
        : enc === 'deflate'
          ? inflateSync(raw)
          : raw;
  return JSON.parse(data.toString('utf8')) as unknown;
}

/** A loopback "model" that records the first `/responses` body and refuses every request. */
async function startFakeModel(): Promise<{
  baseURL: string;
  request: Promise<unknown>;
  close(): void;
}> {
  let resolve!: (v: unknown) => void;
  const request = new Promise<unknown>((r) => (resolve = r));
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'POST' && (req.url ?? '').includes('/responses')) {
        try {
          resolve(bodyOf(req, Buffer.concat(chunks)));
        } catch (e) {
          resolve({ unreadable: String(e) });
        }
      }
      // A 400 is not retried: the turn ends with an error, nothing reached OpenAI.
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(
        '{"error":{"message":"monsters probe: no model here","type":"invalid_request_error"}}',
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    request,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}

async function probeCodex(
  binary: HarnessBinary,
  probe: ProbeCase,
  mcp: { url: string; token: string },
  dir: string,
): Promise<{ names: string[] | null; failure?: string }> {
  const scratch = mkdtempSync(join(dir, `codex-${probe.id}-`));
  const model = await startFakeModel();
  const child = spawn(
    binary.command,
    [...binary.args, ...codexArgs(model.baseURL, { name: SERVER, ...mcp })],
    {
      cwd: scratch,
      env: {
        ...codexEnv(process.env, {
          accessToken: 'monsters-probe-not-a-token',
          codexHome: join(scratch, 'codex-home'),
          mcpToken: mcp.token,
        }),
        ...binary.env,
      },
      stdio: ['pipe', 'pipe', 'ignore'],
    },
  );
  child.stdin.on('error', () => {});
  // JSON-RPC as in CodexHarness.run: initialize, initialized, thread/start, turn/start.
  let next = 1;
  const send = (m: Record<string, unknown>) => child.stdin.write(`${JSON.stringify(m)}\n`);
  const pending = new Map<number, (result: unknown) => void>();
  const request = (method: string, params: unknown) =>
    new Promise<unknown>((r) => {
      const id = next++;
      pending.set(id, r);
      send({ id, method, params });
    });
  void (async () => {
    for await (const line of readLines(child.stdout)) {
      const msg = parseJsonLine(line);
      if (!msg) continue;
      if (typeof msg['id'] === 'number' && msg['method'] === undefined) {
        pending.get(msg['id'])?.(msg['result'] ?? msg['error']);
      } else if (msg['id'] !== undefined && typeof msg['method'] === 'string') {
        // Requests of app-server (approvals, questions): refused, as Monsters would.
        send({ id: msg['id'], error: { code: -32601, message: 'not supported by Monsters' } });
      }
    }
  })().catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((r) => (timer = setTimeout(() => r(null), 90_000)));
  try {
    await Promise.race([
      (async () => {
        await request('initialize', {
          clientInfo: { name: 'Monsters', title: 'Monsters', version: 'probe' },
          capabilities: null,
        });
        send({ method: 'initialized', params: {} });
        const started = (await request('thread/start', {
          cwd: scratch,
          approvalPolicy: 'never',
          sandbox: probe.task.systemTools ? 'workspace-write' : 'read-only',
          config: codexThreadConfig(probe.task.systemTools, probe.task.webSearch === true),
          serviceName: 'Monsters',
        })) as { thread?: { id?: string } } | undefined;
        const threadId = started?.thread?.id;
        if (!threadId) return;
        await request('turn/start', {
          threadId,
          input: [{ type: 'text', text: 'Rispondi solo: ok', text_elements: [] }],
        });
      })(),
      timeout,
    ]);
    const body = await Promise.race([model.request, timeout]);
    if (body === null) return { names: null, failure: 'nessuna richiesta /responses entro 90 s' };
    return { names: codexToolNames(body) };
  } finally {
    clearTimeout(timer);
    stop(child);
    model.close();
  }
}

/** Codex as the core finds it: installed by Monsters under MONSTERS_HOME, else on the PATH. */
function codexBinary(): HarnessBinary | null {
  const configured = process.env['PROBE_CODEX'];
  if (configured) return { command: configured, args: [], source: 'configured' };
  const home = process.env['MONSTERS_HOME'] ?? join(homedir(), '.monsters');
  const script = join(
    home,
    'harness',
    'codex',
    'node_modules',
    '@openai',
    'codex',
    'bin',
    'codex.js',
  );
  if (existsSync(script)) return { command: process.execPath, args: [script], source: 'installed' };
  const onPath = findOnPath('codex');
  return onPath ? { command: onPath, args: [], source: 'path' } : null;
}

function claudeBinary(): HarnessBinary | null {
  const configured = process.env['PROBE_CLAUDE'];
  if (configured) return { command: configured, args: [], source: 'configured' };
  const onPath = findOnPath('claude');
  return onPath ? { command: onPath, args: [], source: 'path' } : null;
}

function versionOf(binary: HarnessBinary): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(binary.command, [...binary.args, '--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...claudeEnv(process.env), ...binary.env },
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.on('close', () => resolve(out.trim().split('\n')[0] ?? '?'));
    child.on('error', () => resolve('?'));
  });
}

// --- main -------------------------------------------------------------------------------

const say = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<number> {
  const claude = claudeBinary();
  if (!claude) {
    say('Claude Code non installato: salto (Claude Code not installed: skipped)');
    return 3;
  }
  const dir = mkdtempSync(join(tmpdir(), 'monsters-probe-tools-'));
  const token = 'monsters-probe-token';
  const mcp = await startFakeHttpServer(token);
  let red = false;
  try {
    const attachment = join(dir, 'allegato.txt');
    writeFileSync(attachment, 'allegato di prova\n');
    const cases = probeCases(attachment);
    say(`Claude Code: ${await versionOf(claude)} (${claude.command})`);
    for (const probe of cases) {
      const r = await probeClaude(claude, probe, { url: mcp.url, token }, dir);
      if (r.failure || !r.initTools) {
        red = true;
        say(`ERRORE [claude · ${probe.label}] la prova non ha funzionato: ${r.failure ?? '?'}`);
        continue;
      }
      if (r.signs.length > 0) {
        red = true;
        say(`ERRORE [claude · ${probe.label}] richiesta al modello partita: ${r.signs.join(', ')}`);
      }
      if (!r.blocked)
        say(`nota [claude · ${probe.label}] il prompt non risulta bloccato dall'hook`);
      const check = checkClaudeTools(r.argv, r.initTools);
      for (const e of check.errors) say(`ERRORE [claude · ${probe.label}] ${e}`);
      for (const n of check.notes) say(`nota [claude · ${probe.label}] ${n}`);
      if (check.errors.length > 0) red = true;
      const builtins = r.initTools.filter((t) => !t.startsWith('mcp__'));
      const mcpCount = r.initTools.length - builtins.length;
      if (check.errors.length === 0) {
        say(
          `ok [claude · ${probe.label}] ${builtins.join(', ') || '(nessun integrato)'} + ${mcpCount} di ${SERVER}`,
        );
      }
    }
    const codex = codexBinary();
    if (!codex) {
      say('Codex non installato: salto (Codex not installed: skipped)');
    } else {
      // Codex reads no attachment itself (images go as `localImage`): the first three runs.
      for (const probe of cases.filter((c) => !c.task.readFiles)) {
        const r = await probeCodex(codex, probe, { url: mcp.url, token }, dir);
        if (!r.names) {
          red = true;
          say(`ERRORE [codex · ${probe.label}] la prova non ha funzionato: ${r.failure ?? '?'}`);
          continue;
        }
        const check = checkCodexTools(r.names, probe.task);
        for (const e of check.errors) say(`ERRORE [codex · ${probe.label}] ${e}`);
        for (const n of check.notes) say(`nota [codex · ${probe.label}] ${n}`);
        if (check.errors.length > 0) red = true;
        else say(`ok [codex · ${probe.label}] ${r.names.join(', ')}`);
      }
    }
  } finally {
    await mcp.close();
    rmSync(dir, { recursive: true, force: true });
  }
  return red ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
