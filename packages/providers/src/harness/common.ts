import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { npmMissing, npmCommand as findNpm } from '@monsters/shared/node';
import { PROVIDER_CATALOG } from '../catalog.ts';
import type { HarnessSpawn } from '../types.ts';

/*
 * What the two harnesses share: where their binary is, the environment their
 * process gets, reading JSON lines, installing an official package on request.
 */

/** How to start a harness binary: a native executable, or `node script.js`. */
export interface HarnessBinary {
  command: string;
  /** Arguments before the harness's own (e.g. the script for `node`). */
  args: string[];
  /** Where it was found: set by the user, on the PATH, installed by Monsters. */
  source: 'configured' | 'path' | 'installed';
  /** Variables its process needs on top of its environment. */
  env?: Record<string, string>;
}

/**
 * The longest one call to Monsters' MCP tools may take on a harness (D-078):
 * a delegation lasts minutes, a card of the brake waits for the user (the
 * core answers "no answer" at 55 minutes, as for the hooks). Without it
 * Claude Code cut a call after 60 s ("The operation timed out", 2.1.301).
 */
export const HARNESS_TOOL_TIMEOUT_MS = 60 * 60_000;

/** An executable named `name` on the PATH, or null. */
export { findOnPath } from '@monsters/shared/node';

/** Environment variables that hold the keys of the providers Monsters knows. */
export const PROVIDER_KEY_VARS: readonly string[] = [
  ...new Set(PROVIDER_CATALOG.flatMap((p) => p.envVars)),
  'BRAVE_API_KEY',
  'BRAVE_SEARCH_API_KEY',
  'TAVILY_API_KEY',
];

/**
 * Variables that a Claude Code session sets for the commands it runs: its
 * socket and token reach the user's live session, `CLAUDECODE` tells `claude`
 * it is nested in another session.
 */
const CLAUDE_SESSION_VARS = new Set(['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'AI_AGENT']);
/** `CLAUDE_CODE_*` that only the user sets (D-005: Monsters neither sets nor suggests them). */
const CLAUDE_USER_VARS = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_GIT_BASH_PATH']);
/** Variables that a Codex session sets for the commands it runs. */
const CODEX_SESSION_VARS = new Set([
  'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED',
  'CODEX_THREAD_ID',
]);

/**
 * True for a variable of the coding-agent session the core was started from
 * (a Claude Code or Codex terminal): it belongs to that session, not to the
 * user, and never reaches a harness. Same list as `isAgentSessionEnv` of
 * `@monsters/tools` (agents' commands, MCP servers).
 */
export function isAgentSessionVar(name: string): boolean {
  const upper = name.toUpperCase();
  if (CLAUDE_SESSION_VARS.has(upper) || CODEX_SESSION_VARS.has(upper)) return true;
  return upper.startsWith('CLAUDE_CODE_') && !CLAUDE_USER_VARS.has(upper);
}

export interface HarnessEnvOptions {
  /** Variables to remove besides Monsters' own (`MONSTERS_*`) and the provider keys. */
  drop?: readonly string[];
  /** Prefixes of further variables to remove (`CODEX_` for the Codex child). */
  dropPrefixes?: readonly string[];
  /** Variables to set (after the removals). */
  set?: Record<string, string>;
  /** A value equal to a secret Monsters holds (CLI token, keys): removed whatever its name. */
  isSecret?: (name: string, value: string) => boolean;
}

/**
 * The environment of a harness process: the user's own, without Monsters'
 * configuration, without the provider keys Monsters may hold (a key in the
 * child would bill the user per use instead of the subscription), without any
 * value equal to one of Monsters' secrets, without the variables of a Claude
 * Code or Codex session the core may have been started from.
 */
export function harnessEnv(
  base: NodeJS.ProcessEnv,
  options: HarnessEnvOptions = {},
): Record<string, string> {
  const drop = new Set([...PROVIDER_KEY_VARS, ...(options.drop ?? [])].map((n) => n.toUpperCase()));
  const prefixes = ['MONSTERS_', ...(options.dropPrefixes ?? [])].map((p) => p.toUpperCase());
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (prefixes.some((p) => upper.startsWith(p))) continue;
    if (drop.has(upper) || isAgentSessionVar(upper)) continue;
    if (options.isSecret?.(name, value)) continue;
    out[name] = value;
  }
  return { ...out, ...options.set };
}

/** Reads a stream line by line (JSON lines of the harnesses). */
export async function* readLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  let buffer = '';
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (line.trim()) yield line;
    }
  }
  if (buffer.trim()) yield buffer;
}

export function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Last lines of a process's stderr, for an error message. */
export function collectStderr(child: ChildProcess, max = 4000): () => string {
  let text = '';
  child.stderr?.on('data', (d: Buffer) => {
    text = (text + d.toString('utf8')).slice(-max);
  });
  return () => text.trim();
}

/** Resolves when the process has exited (code, or the signal that ended it). */
export function exited(
  child: ChildProcess,
): Promise<{ code: number | null; signal: string | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: -1, signal: null }));
  });
}

export interface StopChildOptions {
  /** The platform to act as (tests simulate Windows); default `process.platform`. */
  platform?: NodeJS.Platform;
  /** Runs `taskkill` (tests record it); default a synchronous spawn. */
  taskkill?: (args: string[]) => void;
}

/**
 * Asks the main process of a harness to stop (`SIGINT`), or forces it (`SIGKILL`).
 * On Windows there are no signals: `child.kill()` ends the main process at once and the
 * `taskkill /T` of the scope then finds no tree, leaving the children (`claude.exe`'s shell
 * commands, `codex.exe` under its `codex.js` wrapper) running (F-A8). So the whole tree goes
 * first, while its parent still links it.
 */
export function stopChild(
  child: ChildProcess,
  signal: 'SIGINT' | 'SIGKILL',
  options: StopChildOptions = {},
): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if ((options.platform ?? process.platform) === 'win32' && child.pid !== undefined) {
    const args = ['/pid', String(child.pid), '/T', '/F'];
    try {
      if (options.taskkill) options.taskkill(args);
      else spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true, timeout: 5000 });
      return;
    } catch {
      // taskkill is missing or failed: the main process at least must go.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Already gone.
  }
}

/**
 * Waits up to `ms` for a process that should be leaving (its turn is over),
 * then terminates it: a harness hanging after its answer never holds a run.
 */
export async function exitedWithin(
  child: ChildProcess,
  exit: Promise<{ code: number | null; signal: string | null }>,
  ms: number,
): Promise<{ code: number | null; signal: string | null }> {
  const timers: NodeJS.Timeout[] = [];
  const after = (wait: number) =>
    new Promise<null>((resolve) => {
      timers.push(setTimeout(() => resolve(null), wait));
    });
  try {
    const result = await Promise.race([exit, after(ms)]);
    if (result) return result;
    stopChild(child, 'SIGKILL');
    await Promise.race([exit, after(2000)]);
    return { code: null, signal: 'timeout' };
  } finally {
    for (const t of timers) clearTimeout(t);
  }
}

/** Default spawn (status checks outside a run): the core passes the scope's. */
export const plainSpawn: HarnessSpawn = (command, args, options: SpawnOptions) =>
  spawn(command, args, options);

/** Runs a short command and collects its output (status checks, versions). */
export async function runOnce(
  binary: HarnessBinary,
  args: string[],
  options: { env: Record<string, string>; cwd?: string; timeoutMs?: number; spawn?: HarnessSpawn },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = (options.spawn ?? plainSpawn)(binary.command, [...binary.args, ...args], {
    env: { ...options.env, ...binary.env },
    ...(options.cwd ? { cwd: options.cwd } : {}),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (d: Buffer) => {
    stdout += d.toString('utf8');
  });
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString('utf8');
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 20_000);
  try {
    const { code } = await exited(child);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * npm to install an official package on request: the one of the Node that runs
 * the children (never next to the Electron binary), else of the `node` on the
 * PATH. Null when there is none.
 */
export function npmCommand(env: NodeJS.ProcessEnv = process.env): HarnessBinary | null {
  const npm = findNpm(env);
  return npm ? { ...npm, source: 'path' } : null;
}

/** The official npm registry: never the one of the user's `.npmrc`. */
export const NPM_REGISTRY = 'https://registry.npmjs.org/';

/**
 * Installs an exact version of a package into `dir` (`npm install --prefix`).
 * Used only when the user asks for it:
 * - from the official registry, also for the package's scope (an
 *   `@scope:registry` of the user's `.npmrc` would win over `--registry`);
 * - without install scripts (neither `@openai/codex` nor
 *   `@anthropic-ai/claude-agent-sdk` has any: their binaries come in the
 *   platform packages);
 * - then checked: the main package must have the integrity pinned by Monsters
 *   (the registry's `dist.integrity` of that version) and every package must
 *   come from the official registry, otherwise the install is removed. npm
 *   itself checks each tarball against the registry's integrity.
 */
export async function installPackage(
  dir: string,
  spec: string,
  options: {
    /** `dist.integrity` of the exact version, pinned in the code. */
    integrity: string;
    spawn?: HarnessSpawn;
    env?: NodeJS.ProcessEnv;
    npm?: HarnessBinary;
    timeoutMs?: number;
  },
): Promise<void> {
  const m = /^((@[a-z0-9][\w.-]*)\/)?[a-z0-9][\w.-]*@\d+\.\d+\.\d+$/i.exec(spec);
  if (!m) throw new Error(`not an exact package version: ${spec}`);
  const name = spec.slice(0, spec.lastIndexOf('@'));
  const scope = m[2];
  const npm = options.npm ?? npmCommand(options.env ?? process.env);
  if (!npm) throw new Error(npmMissing());
  const result = await runOnce(
    npm,
    [
      'install',
      '--prefix',
      dir,
      '--no-save',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      `--registry=${NPM_REGISTRY}`,
      ...(scope ? [`--${scope}:registry=${NPM_REGISTRY}`] : []),
      spec,
    ],
    {
      env: harnessEnv(options.env ?? process.env),
      timeoutMs: options.timeoutMs ?? 15 * 60_000,
      ...(options.spawn ? { spawn: options.spawn } : {}),
    },
  );
  if (result.code !== 0) {
    const tail = (result.stderr || result.stdout).trim().split('\n').slice(-5).join('\n');
    throw new Error(`npm install ${spec} failed (${result.code}): ${tail}`);
  }
  const problem = checkInstalled(dir, name, options.integrity);
  if (problem) {
    rmSync(join(dir, 'node_modules'), { recursive: true, force: true });
    throw new Error(`npm install ${spec}: ${problem}`);
  }
}

/** What is wrong with an install, from npm's own record of it (`node_modules/.package-lock.json`). */
function checkInstalled(dir: string, name: string, integrity: string): string | null {
  let lock: {
    packages?: Record<string, { resolved?: string; integrity?: string; link?: boolean }>;
  };
  try {
    lock = JSON.parse(readFileSync(join(dir, 'node_modules', '.package-lock.json'), 'utf8')) as {
      packages?: Record<string, { resolved?: string; integrity?: string }>;
    };
  } catch {
    return 'no record of the installed packages';
  }
  const packages = lock.packages ?? {};
  const main = packages[`node_modules/${name}`];
  if (!main) return `${name} is not installed`;
  if (main.integrity !== integrity) return `${name} does not have the expected integrity`;
  for (const [path, p] of Object.entries(packages)) {
    if (!path) continue;
    if (p.link || !p.resolved?.startsWith(NPM_REGISTRY) || !p.integrity) {
      return `${path.replace(/^node_modules\//, '')} does not come from ${NPM_REGISTRY}`;
    }
  }
  return null;
}

/** Kills a process and waits a little for it to go (status checks). */
export function stop(child: ChildProcess): void {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
}
