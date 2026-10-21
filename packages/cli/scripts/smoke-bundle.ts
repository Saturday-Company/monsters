/*
 * Smoke test of the bundled core (M3.0): builds the web UI and the bundle (`pnpm build:core`),
 * then runs the BUNDLED `monsters` under Node 24 and under Electron in Node mode
 * (ELECTRON_RUN_AS_NODE=1 on the Electron of node_modules: the Node of the utility process
 * that runs the desktop app's core; the packaged binary has RunAsNode off), each time on a temporary
 * MONSTERS_HOME with port 0 and a fake LM Studio server on 127.0.0.1 as the only model:
 *
 *   - the embedding worker of the bundle starts, the optional transformers.js loads;
 *   - `monsters start`: setup code, web UI from the bundle, account, login, local provider;
 *   - a chat gets the fake model's answer;
 *   - kill switch from the bundled CLI during a run: run aborted, model request closed,
 *     messages refused, resume;
 *   - SIGTERM: clean stop (not on Windows, which has no SIGTERM: there the process is terminated);
 *   - packages/cli/test/mcp.test.ts with `monsters mcp` run from the bundle.
 *
 *   pnpm smoke:bundle [--no-build] [--runtime node|electron|all] [--keep]
 *
 * Never uses the network, a real account or the user's MONSTERS_HOME. Exit code 0 when every
 * runtime passed.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { orchestratorBlueprint, writeAgentFolder } from '@monsters/core';
import { streamReply } from '@monsters/providers/testing';
import { DEFAULT_MODEL_SPEC } from '@monsters/vault';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const BUNDLE = join(ROOT, 'packages', 'cli', 'dist-bundle');
const ENTRY = join(BUNDLE, 'monsters.js');
const MODEL = 'smoke-model';
const REPLY = 'Ciao! Qui parla il core impacchettato.';
/** A message containing this word gets an answer that never ends (kill switch test). */
const SLOW = 'LENTISSIMO';

interface Runtime {
  name: 'node' | 'electron';
  command: string;
  env: Record<string, string>;
}

function electronBinary(): string {
  // apps/desktop pins the Electron of the desktop app; requiring it gives its binary.
  const req = createRequire(join(ROOT, 'apps', 'desktop', 'package.json'));
  return req('electron') as string;
}

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

class SmokeError extends Error {}

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new SmokeError(message);
}

async function until<T>(
  what: string,
  probe: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 30_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() - start > timeoutMs) throw new SmokeError(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Environment of the bundled processes: none of the user's MONSTERS_* settings, and the
 * secrets in files (D-042: never the real keychain in tests). With the keychain, a locked
 * login keyring on a desktop (this machine's GNOME after a reboot) opens its unlock prompt
 * and nobody answers: each start waited the 20 s deadline before falling back (D-086).
 */
function childEnv(rt: Runtime): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !/^MONSTERS_/i.test(k) && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  }
  return {
    ...env,
    MONSTERS_EMBEDDINGS: 'off',
    MONSTERS_TELEGRAM: 'off',
    MONSTERS_SECRETS: 'file',
    ...rt.env,
  };
}

// --- fake LM Studio (OpenAI-compatible) ------------------------------------------------------

interface ModelServer {
  url: string;
  state: { chats: number; slowStarted: boolean; slowClosed: boolean };
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = '';
    req.on('data', (d: Buffer) => (body += d.toString('utf8')));
    req.on('end', () => resolveBody(body));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function fakeModelServer(): Promise<ModelServer> {
  const state = { chats: 0, slowStarted: false, slowClosed: false };
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const body = await readBody(req);
    const path = req.url ?? '';
    if (req.method === 'GET' && path.startsWith('/api/v0/models')) {
      return sendJson(res, {
        data: [{ id: MODEL, type: 'llm', capabilities: ['tool_use'], max_context_length: 32768 }],
      });
    }
    if (req.method === 'GET' && path.startsWith('/v1/models')) {
      return sendJson(res, { data: [{ id: MODEL }] });
    }
    if (req.method === 'POST' && path.startsWith('/v1/chat/completions')) {
      state.chats++;
      if (body.includes(SLOW)) {
        state.slowStarted = true;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = {
          id: 'chatcmpl-slow',
          object: 'chat.completion.chunk',
          created: 1,
          model: MODEL,
          choices: [
            { index: 0, delta: { role: 'assistant', content: 'Ci penso' }, finish_reason: null },
          ],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        // Never ends: only the kill switch closes it.
        res.on('close', () => {
          if (!res.writableEnded) state.slowClosed = true;
        });
        return;
      }
      const reply = streamReply('openai', { text: REPLY, model: MODEL });
      res.writeHead(reply.status, Object.fromEntries(reply.headers));
      res.end(await reply.text());
      return;
    }
    sendJson(res, { error: { message: `no route for ${req.method} ${path}` } }, 404);
  };
  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => sendJson(res, { error: String(err) }, 500));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

// --- the core's API, as the web UI calls it ------------------------------------------------

class Api {
  readonly url: string;
  #cookies = new Map<string, string>();
  /** The session's secret from setup or login, sent with the cookie as the web UI does (S-B13). */
  #secret = '';
  constructor(url: string) {
    this.url = url;
  }

  #auth(): Record<string, string> {
    return {
      'x-monsters-request': '1',
      cookie: [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(this.#secret ? { 'x-monsters-session': this.#secret } : {}),
    };
  }

  async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: Record<string, unknown> }> {
    const res = await fetch(`${this.url}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...this.#auth(),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair = ''] = c.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) this.#cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const text = await res.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { text };
    }
    if (typeof data['sessionSecret'] === 'string') this.#secret = data['sessionSecret'];
    return { status: res.status, data };
  }

  /** `POST /api/files` with one file (multipart, as the composer sends it). */
  async upload(
    name: string,
    text: string,
  ): Promise<{ status: number; data: Record<string, unknown> }> {
    const form = new FormData();
    form.append('file', new Blob([text], { type: 'text/plain' }), name);
    const res = await fetch(`${this.url}/api/files`, {
      method: 'POST',
      headers: {
        ...this.#auth(),
      },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    return { status: res.status, data: (await res.json()) as Record<string, unknown> };
  }

  /** Status of a run once it ended (`completed`, `failed`, `aborted`). */
  runEnd(runId: string, timeoutMs = 60_000): Promise<string> {
    return until(
      `the end of run ${runId}`,
      async () => {
        const { data } = await this.call('GET', `/api/events?runId=${runId}&type=run`);
        const events = (data['events'] ?? []) as { data: { status?: string } }[];
        const end = events.find((e) => e.data.status && e.data.status !== 'started');
        return end?.data.status;
      },
      timeoutMs,
    );
  }
}

// --- one runtime -----------------------------------------------------------------------------

/** Runs the bundled CLI (a short command) and returns its output. */
function cli(rt: Runtime, args: string[]): { code: number | null; out: string } {
  const r = spawnSync(rt.command, [ENTRY, ...args], {
    env: childEnv(rt),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Starts the bundle's embedding worker: it must load (offline it then reports the missing model). */
function checkWorker(rt: Runtime, dir: string): string {
  const script = join(dir, 'check-worker.mjs');
  writeFileSync(
    script,
    `import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const [entry, worker, cacheDir, spec] = process.argv.slice(2);
// The optional external resolves next to the bundle and loads (native onnxruntime included).
const t = await import(pathToFileURL(createRequire(entry).resolve('@huggingface/transformers')).href);
if (typeof t.pipeline !== 'function') throw new Error('transformers.js without pipeline');
const w = new Worker(worker, { workerData: { cacheDir, spec: JSON.parse(spec), offline: true } });
const reply = await new Promise((ok, ko) => {
  w.once('message', ok);
  w.once('error', ko);
  setTimeout(() => ko(new Error('no answer from the worker')), 30000).unref();
});
await w.terminate();
process.stdout.write(JSON.stringify(reply));
`,
  );
  const r = spawnSync(
    rt.command,
    [
      script,
      ENTRY,
      join(BUNDLE, 'embed-worker.js'),
      join(dir, 'models'),
      JSON.stringify(DEFAULT_MODEL_SPEC),
    ],
    { env: childEnv(rt), encoding: 'utf8', timeout: 90_000 },
  );
  check(r.status === 0, `embedding worker check failed (${r.status}): ${r.stderr.trim()}`);
  const reply = JSON.parse(r.stdout) as { type?: string; message?: string };
  check(reply.type === 'error' || reply.type === 'ready', `unexpected worker reply ${r.stdout}`);
  return reply.type === 'ready' ? 'model ready' : `offline, as expected: ${reply.message ?? ''}`;
}

async function smoke(rt: Runtime, keep: boolean): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), 'monsters-smoke-'));
  const home = join(base, 'home');
  const model = await fakeModelServer();
  let core: ChildProcess | undefined;
  let output = '';
  const t0 = Date.now();
  const step = (what: string) =>
    log(`  [${rt.name}] ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s  ${what}`);
  try {
    const version = cli(rt, ['version']);
    check(version.code === 0, `monsters version: ${version.out}`);
    step(`monsters version ${version.out.trim()}`);
    step(`embedding worker: ${checkWorker(rt, base)}`);

    // The team after onboarding, on the fake local model.
    await writeAgentFolder(
      join(home, 'agents', 'titan'),
      orchestratorBlueprint({ user: 'Smoke', models: [{ provider: 'lmstudio', model: MODEL }] }),
    );

    core = spawn(rt.command, [ENTRY, 'start', '--home', home, '--port', '0'], {
      env: childEnv(rt),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = new Promise<number | null>((r) => core!.once('exit', (code) => r(code)));
    core.stdout!.on('data', (d: Buffer) => (output += d.toString('utf8')));
    core.stderr!.on('data', (d: Buffer) => (output += d.toString('utf8')));
    const started = await until(
      'monsters start',
      () => {
        if (core!.exitCode !== null) throw new SmokeError(`the core exited: ${output}`);
        const url = /is running at (http:\/\/\S+)/.exec(output)?.[1];
        const code = /Setup code: (\S+)/.exec(output)?.[1];
        return url && code ? { url, code } : undefined;
      },
      60_000,
    );
    step(`started at ${started.url}`);
    const api = new Api(started.url);

    const page = await fetch(`${started.url}/`);
    const html = await page.text();
    check(
      page.status === 200 && html.includes('<div id="root">'),
      'web UI not served from the bundle',
    );
    step('web UI served from the bundle');

    const setup = await api.call('POST', '/api/setup', {
      email: 'smoke@example.com',
      password: 'smoke-password-2026',
      setupCode: started.code,
    });
    check(setup.status === 201, `setup: ${setup.status} ${JSON.stringify(setup.data)}`);
    await api.call('POST', '/api/logout', {});
    const login = await api.call('POST', '/api/login', {
      email: 'smoke@example.com',
      password: 'smoke-password-2026',
    });
    check(login.status === 200, `login: ${login.status} ${JSON.stringify(login.data)}`);
    step('account created, logged in');
    // Secrets in files from the start: the real keychain was never asked (D-042, D-086).
    const { data: errors } = await api.call('GET', '/api/events?type=error');
    check(
      !JSON.stringify(errors).includes('secrets_fallback'),
      `the core asked the keychain: ${JSON.stringify(errors)}`,
    );

    // The text of a file is extracted in a worker (extract-worker.js next to the entry, D-085).
    const up = await api.upload('nota.txt', 'Testo letto dal worker del bundle.');
    check(up.status === 201, `upload: ${up.status} ${JSON.stringify(up.data)}`);
    await until(
      'the text of the uploaded file',
      async () => {
        const { data } = await api.call('GET', `/api/files/${String(up.data['id'])}`);
        return data['hasText'] === true ? true : undefined;
      },
      20_000,
    );
    step('file uploaded, text extracted in the worker');

    const local = await api.call('PUT', '/api/providers/lmstudio/url', { baseURL: model.url });
    check(local.status === 200, `local provider: ${local.status} ${JSON.stringify(local.data)}`);

    const sent = await api.call('POST', '/api/messages', { text: 'Ciao, sei il bundle?' });
    check(sent.status === 202, `chat: ${sent.status} ${JSON.stringify(sent.data)}`);
    const runId = String(sent.data['runId']);
    const end = await api.runEnd(runId);
    check(end === 'completed', `chat run ${end}: ${output}`);
    const { data: msgs } = await api.call('GET', `/api/events?runId=${runId}&type=message`);
    check(
      JSON.stringify(msgs).includes(REPLY),
      `the answer is not in the log: ${JSON.stringify(msgs)}`,
    );
    step(`chat answered by the fake model (${model.state.chats} model calls)`);

    const slow = await api.call('POST', '/api/messages', { text: `Pensaci ${SLOW}` });
    check(slow.status === 202, `slow chat: ${slow.status} ${JSON.stringify(slow.data)}`);
    await until('the slow model call', () => (model.state.slowStarted ? true : undefined));
    const kill = cli(rt, ['kill', '--home', home, '--json', '--reason', 'smoke test']);
    check(kill.code === 0, `monsters kill: ${kill.out}`);
    const report = JSON.parse(kill.out) as {
      halted: boolean;
      report: { runsAborted: number };
    };
    check(report.halted && report.report.runsAborted >= 1, `kill report: ${kill.out}`);
    check((await api.runEnd(String(slow.data['runId']))) === 'aborted', 'slow run not aborted');
    await until('the model request to close', () => (model.state.slowClosed ? true : undefined));
    const refused = await api.call('POST', '/api/messages', { text: 'ancora?' });
    check(
      refused.status === 409 && refused.data['error'] === 'halted',
      'message accepted while halted',
    );
    const status = cli(rt, ['status', '--home', home, '--json']);
    check(status.code === 0 && (JSON.parse(status.out) as { halted: boolean }).halted, status.out);
    const resume = cli(rt, ['resume', '--home', home, '--json']);
    check(
      resume.code === 0 && (JSON.parse(resume.out) as { resumed: boolean }).resumed,
      resume.out,
    );
    step(
      `kill switch from the CLI: ${report.report.runsAborted} run aborted, model call closed, resumed`,
    );

    core.kill('SIGTERM');
    const code = await exited;
    if (process.platform === 'win32') {
      // Windows has no SIGTERM: kill() terminates the process, nothing can run a clean stop.
      // The app stops its core with the utility process's "stop" message instead (D-045).
      step(`stopped (Windows: no SIGTERM, the process was terminated, exit ${code})`);
    } else {
      check(code === 0 && output.includes('Stopped.'), `stop: exit ${code}\n${output}`);
      step('stopped cleanly');
    }

    // The MCP server of the vault (`monsters mcp`, spawned by Claude Desktop) from the bundle.
    const mcp = spawnSync('pnpm', ['exec', 'vitest', 'run', 'packages/cli/test/mcp.test.ts'], {
      cwd: ROOT,
      env: { ...process.env, MONSTERS_TEST_CLI: ENTRY, MONSTERS_TEST_NODE: rt.command, ...rt.env },
      encoding: 'utf8',
      timeout: 300_000,
      shell: process.platform === 'win32',
    });
    const tests = /Tests\s+(\d+ passed[^\n]*)/.exec(mcp.stdout)?.[1]?.trim();
    check(mcp.status === 0, `mcp.test.ts on the bundle failed:\n${mcp.stdout}${mcp.stderr}`);
    step(`packages/cli/test/mcp.test.ts on the bundle: ${tests ?? 'passed'}`);
  } catch (err) {
    if (output) log(`  [${rt.name}] core output:\n${output.replace(/^/gm, '    ')}`);
    throw err;
  } finally {
    if (core && core.exitCode === null) core.kill('SIGKILL');
    await model.close();
    if (keep) log(`  [${rt.name}] kept ${base}`);
    else rmSync(base, { recursive: true, force: true });
  }
}

const { values } = parseArgs({
  options: {
    'no-build': { type: 'boolean' },
    runtime: { type: 'string', default: 'all' },
    keep: { type: 'boolean' },
  },
});
const wanted = values.runtime;
if (!['node', 'electron', 'all'].includes(wanted)) {
  console.error('--runtime must be node, electron or all');
  process.exit(2);
}

if (!values['no-build']) {
  const build = spawnSync('pnpm', ['run', 'build:core'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (build.status !== 0) process.exit(1);
}

const runtimes: Runtime[] = [];
if (wanted !== 'electron') runtimes.push({ name: 'node', command: process.execPath, env: {} });
if (wanted !== 'node') {
  let electron: string;
  try {
    electron = electronBinary();
  } catch (err) {
    console.error(
      `Electron not available (pnpm install installs it in apps/desktop): ${String(err)}`,
    );
    process.exit(1);
  }
  runtimes.push({ name: 'electron', command: electron, env: { ELECTRON_RUN_AS_NODE: '1' } });
}

let failed = false;
for (const rt of runtimes) {
  const v = spawnSync(
    rt.command,
    ['-p', 'process.versions.node + " " + (process.versions.electron ?? "")'],
    {
      env: childEnv(rt),
      encoding: 'utf8',
    },
  );
  log(`${rt.name}: Node ${v.stdout.trim().replace(' ', ', Electron ') || '?'} (${rt.command})`);
  const started = Date.now();
  try {
    await smoke(rt, values.keep ?? false);
    log(`${rt.name}: ok in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } catch (err) {
    failed = true;
    log(`${rt.name}: FAILED: ${(err as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
