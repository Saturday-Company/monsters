import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_CATALOG, STDIO_LAUNCHERS } from '@monsters/shared';
import { DIR_MODE } from '../config.ts';
import type { McpServerSetting } from './config.ts';
import { mcpStrings } from './mcp.strings.ts';
import { BLENDER_MCP_REQUIREMENTS } from './pinned-python-locks.ts';

/*
 * Gallery servers written in Python that run from an environment installed
 * once (review of 18/10, M10), like Shopify and the browser do with npm:
 * `uv venv` in `MONSTERS_HOME/mcp-packages/<id>`, then
 * 1. `uv pip install --require-hashes --only-binary :all:` of our requirements
 *    (exact version and sha256 of every file of every package, indirect ones
 *    included, all platforms: no build step runs for them), and
 * 2. the server itself from the tarball of its pinned commit, `--no-deps`,
 *    checked against the sha256 below (uv refuses a different archive) and
 *    built with the `setuptools` of step 1, so no build dependency is resolved
 *    on the way.
 * It starts from the Python of that environment, never `uvx`: nothing is
 * resolved again at start, and the user's uv/pip configuration is ignored.
 *
 * A server added before, or edited by the user, keeps the command it has: only
 * a setting that still holds the gallery's own `uvx` line is moved here.
 */

export interface PinnedPythonServer {
  /** Gallery id. */
  readonly id: string;
  /** Distribution name, for the messages. */
  readonly package: string;
  readonly version: string;
  /** Tarball of the pinned commit (Gitea's API link, immutable per commit). */
  readonly archive: string;
  /** Folder of the Python package inside the tarball. */
  readonly subdirectory: string;
  readonly archiveSha256: string;
  /** Output of `uv pip compile --generate-hashes`. */
  readonly requirements: string;
  /** Python code that runs the server in the environment. */
  readonly code: string;
}

export const PINNED_PYTHON_SERVERS: readonly PinnedPythonServer[] = [
  {
    id: 'blender',
    package: 'blender-mcp',
    version: '1.0.3',
    archive:
      'https://projects.blender.org/api/v1/repos/lab/blender_mcp/archive/2cea8d566dde07fbac28a61d698909d69724e853.tar.gz',
    subdirectory: 'mcp',
    archiveSha256: '8dc1dd7433755857bd2ae35420f8cf4f59cdc61846d1a75416659c34fd17c972',
    requirements: BLENDER_MCP_REQUIREMENTS,
    code: 'import blmcp; blmcp.main()',
  },
];

/** The public index, never the one from the user's configuration. */
export const PYPI_INDEX = 'https://pypi.org/simple';

/** The oldest Python the servers accept (`requires-python` of Blender's). */
const PYTHON_REQUEST = '>=3.10';

/** Where the environment of a server lives. */
export function pinnedPythonDir(home: string, id: string): string {
  return join(home, 'mcp-packages', id);
}

/** Python of the environment (the one that runs the server). */
export function pinnedPythonExe(
  home: string,
  server: PinnedPythonServer,
  platform: NodeJS.Platform = process.platform,
): string {
  const venv = join(pinnedPythonDir(home, server.id), 'venv');
  return platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python');
}

/**
 * Arguments that start the server: isolated mode (`-I`) ignores `PYTHONPATH`,
 * `PYTHON*` variables and the user's site-packages.
 */
export function pinnedPythonArgs(server: PinnedPythonServer): string[] {
  return ['-I', '-c', server.code];
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The gallery line of an entry, without the date limit that came later. */
function galleryArgs(id: string): string[] | undefined {
  const entry = MCP_CATALOG.find((e) => e.id === id);
  if (entry?.command !== 'uvx' || !entry.args) return undefined;
  return stripDateLimit(entry.args);
}

function stripDateLimit(args: readonly string[]): string[] {
  return args[0] === '--exclude-newer' ? args.slice(2) : [...args];
}

/**
 * The pinned server a setting stands for: it came from the gallery and still
 * runs the gallery's `uvx` line (with or without the `--exclude-newer` of
 * before, whatever the day). Undefined for anything else.
 */
export function pinnedPythonServerOf(
  setting: Pick<McpServerSetting, 'catalog' | 'command' | 'args' | 'transport' | 'preset'>,
): PinnedPythonServer | undefined {
  if (setting.transport !== 'stdio' || setting.preset || !setting.catalog) return undefined;
  const server = PINNED_PYTHON_SERVERS.find((s) => s.id === setting.catalog);
  if (!server || setting.command !== 'uvx') return undefined;
  const expected = galleryArgs(server.id);
  if (!expected) return undefined;
  const args = stripDateLimit(setting.args);
  return args.length === expected.length && args.every((a, i) => a === expected[i])
    ? server
    : undefined;
}

const MARKER = 'installed.json';

interface Marker {
  package?: string;
  version?: string;
  archiveSha256?: string;
  requirementsSha256?: string;
}

function markerOf(server: PinnedPythonServer): Marker {
  return {
    package: server.package,
    version: server.version,
    archiveSha256: server.archiveSha256,
    requirementsSha256: sha256(server.requirements),
  };
}

/** True when this exact environment was installed and checked. */
export function pinnedPythonInstalled(home: string, server: PinnedPythonServer): boolean {
  try {
    const marker = JSON.parse(
      readFileSync(join(pinnedPythonDir(home, server.id), MARKER), 'utf8'),
    ) as Marker;
    const want = markerOf(server);
    return (
      marker.package === want.package &&
      marker.version === want.version &&
      marker.archiveSha256 === want.archiveSha256 &&
      marker.requirementsSha256 === want.requirementsSha256 &&
      statSync(pinnedPythonExe(home, server)).isFile()
    );
  } catch {
    return false;
  }
}

export interface PythonStep {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

/**
 * uv and pip read their options from `UV_*` and `PIP_*` variables (indexes,
 * extra indexes, trusted hosts…); `PYTHON*` and `VIRTUAL_ENV` would steer the
 * interpreter. None of them reaches the install.
 */
function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || /^(?:UV_|PIP_|PYTHON|VIRTUAL_ENV$|CONDA_)/i.test(k)) continue;
    clean[k] = v;
  }
  return clean;
}

/**
 * Writes the requirements in a clean folder and returns the three uv commands
 * (environment, dependencies, server), in order. `--no-config`: no `uv.toml`
 * or `pyproject.toml` of the user or of a parent folder.
 */
export function preparePythonInstall(
  home: string,
  server: PinnedPythonServer,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): PythonStep[] {
  const dir = pinnedPythonDir(home, server.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  writeFileSync(join(dir, 'requirements.txt'), server.requirements);
  writeFileSync(
    join(dir, 'server.txt'),
    `${server.package} @ ${server.archive}#subdirectory=${server.subdirectory} --hash=sha256:${server.archiveSha256}\n`,
  );
  const clean = cleanEnv(env);
  const python = pinnedPythonExe(home, server, platform);
  const base = { command: 'uv', cwd: dir, env: clean };
  return [
    {
      ...base,
      args: ['--no-config', 'venv', '--no-project', '--python', PYTHON_REQUEST, join(dir, 'venv')],
    },
    {
      ...base,
      args: [
        '--no-config',
        'pip',
        'install',
        '--python',
        python,
        '--default-index',
        PYPI_INDEX,
        '--require-hashes',
        '--only-binary',
        ':all:',
        '--no-deps',
        '-r',
        join(dir, 'requirements.txt'),
      ],
    },
    {
      ...base,
      args: [
        '--no-config',
        'pip',
        'install',
        '--python',
        python,
        '--no-index',
        '--require-hashes',
        '--no-deps',
        '--no-build-isolation',
        '-r',
        join(dir, 'server.txt'),
      ],
    },
  ];
}

const OUTPUT_KEEP = 4000;

/** Longest start while the environment is installed (about fifty packages and the server's build). */
export const PINNED_PYTHON_START_TIMEOUT_MS = 300_000;

/** Runs one step in the kill scope (`spawn`): stopping the server stops uv too. */
async function runStep(
  step: PythonStep,
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess,
  signal: AbortSignal,
  what: string,
): Promise<void> {
  let output = '';
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      env: step.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-OUTPUT_KEEP);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    const onAbort = () => child.kill();
    signal.addEventListener('abort', onAbort, { once: true });
    child.once('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(
        new Error(
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? mcpStrings().uvNeeded(STDIO_LAUNCHERS['uv']!.url)
            : mcpStrings().installFailed(what, err.message),
        ),
      );
    });
    child.once('close', (exit) => {
      signal.removeEventListener('abort', onAbort);
      resolve(exit);
    });
  });
  if (signal.aborted) throw signal.reason;
  if (code !== 0) {
    const lines = output.trim().split('\n');
    // uv puts the cause (a mismatch of the hash, a missing file) a few lines above its last one.
    const tail = lines
      .filter((l) => l.trim())
      .slice(-3)
      .join(' ')
      .replace(/\s+/g, ' ');
    throw new Error(mcpStrings().installFailedCode(what, 'uv', code, tail));
  }
}

/** Installs the environment of a gallery server unless it is there already (uv runs in the kill scope). */
export async function installPinnedPython(
  home: string,
  server: PinnedPythonServer,
  env: NodeJS.ProcessEnv,
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess,
  signal: AbortSignal,
): Promise<void> {
  if (pinnedPythonInstalled(home, server)) return;
  const steps = preparePythonInstall(home, server, env);
  const what = mcpStrings().installOf(server.package);
  for (const step of steps) await runStep(step, spawn, signal, what);
  if (!statSync(pinnedPythonExe(home, server), { throwIfNoEntry: false })?.isFile()) {
    throw new Error(mcpStrings().notExpected(server.package));
  }
  writeFileSync(
    join(pinnedPythonDir(home, server.id), MARKER),
    `${JSON.stringify(markerOf(server))}\n`,
  );
}
