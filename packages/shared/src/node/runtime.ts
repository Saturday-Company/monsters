import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, posix, win32 } from 'node:path';
import { findOnPath } from './path.ts';

/*
 * The Node that runs JavaScript in child processes (Playwright MCP, the gallery's MCP
 * servers, Codex, npm). From a terminal it is the Node running Monsters. Inside the desktop
 * app `process.execPath` is the Electron binary, whose RunAsNode fuse is off (S-M8, D-045):
 * it never runs as a plain Node, so these children run with a `node` found on the PATH, the
 * same one whose npm installed their packages. The app's keychain helper is not one of them: it
 * runs in an Electron utility process started by the app (apps/desktop, keychain-host.ts).
 *
 * That `node` is looked for once, when the core starts (`pinNodeRuntime`, called by the hub
 * with the folders the monsters can write), and its absolute path is kept for the life of the
 * process (review of wave 5, n. 9): a `node` a monster drops later in a folder of the PATH, or
 * a PATH changed in some environment, never becomes the Node of the children (which get tokens
 * in their environment). The search skips relative PATH entries (on Windows also the current
 * folder, which is never searched), the folders monsters can write, anything but `node.exe` on
 * Windows (no .cmd or .bat), files that are not executable, and a Node older than 20
 * (`node --version`, asked once per candidate).
 */

/** How to run a JavaScript file in a child process: `command [script] …`. */
export interface NodeRuntime {
  command: string;
  /** `MONSTERS_NODE_PATH`, the Node running Monsters, or (desktop app) the `node` on the PATH. */
  source: 'configured' | 'node' | 'path';
}

export interface RuntimeProcess {
  execPath: string;
  versions: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}

/** Shown when a JavaScript child must start and there is no Node for it (in Italian: it reaches the user). */
export const NODE_MISSING =
  'Node.js non trovato: installa Node.js 20 o più recente da https://nodejs.org, oppure indica il Node da usare con la variabile MONSTERS_NODE_PATH';

/** The oldest Node the children may run with (NODE_MISSING says so). */
export const MIN_NODE_MAJOR = 20;

/** Where to look for the children's `node` (`findChildNode`). */
export interface ChildNodeSearch {
  /** Its PATH is searched (`PATH`, or `Path` on Windows). Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Default: `process.platform` (the tests describe Windows from Linux). */
  platform?: NodeJS.Platform;
  /**
   * Folders the monsters can write (data directory with their homes, vault, project folders):
   * a `node` in them, or in a PATH entry inside them, is never used.
   */
  exclude?: readonly string[];
  /** The output of `<command> --version`, null when it does not run. Default: spawnSync. */
  version?: (command: string) => string | null;
  /** A regular file, executable on POSIX. Default: stat (tests describe Windows from Linux). */
  isExecutable?: (path: string, windows: boolean) => boolean;
}

function isExecutableFile(path: string, windows: boolean): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (!windows) accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export type ChildNodeResult =
  { command: string; version: string } | { command: null; skipped: string[] };

function defaultVersion(command: string): string | null {
  try {
    const env = { ...process.env };
    delete env['ELECTRON_RUN_AS_NODE'];
    delete env['NODE_OPTIONS'];
    // The absolute path, no shell.
    const r = spawnSync(command, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      env,
    });
    return r.status === 0 && typeof r.stdout === 'string' ? r.stdout : null;
  } catch {
    return null;
  }
}

/** The major version in the output of `node --version` (`v24.1.0`), or null. */
export function nodeMajor(output: string | null): number | null {
  const m = output === null ? null : /^v(\d+)\.\d+\.\d+\s*$/.exec(output.trim());
  return m ? Number(m[1]) : null;
}

/**
 * The first acceptable `node` on the PATH of `o.env`, as an absolute path, or why the
 * candidates were skipped. See the module comment for the rules.
 */
export function findChildNode(o: ChildNodeSearch = {}): ChildNodeResult {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const win = platform === 'win32';
  const p = win ? win32 : posix;
  const fold = (s: string) => (win || platform === 'darwin' ? s.toLowerCase() : s);
  const real = (s: string) => {
    try {
      return realpathSync(s);
    } catch {
      return s;
    }
  };
  const excluded = (o.exclude ?? [])
    .filter((d) => d && p.isAbsolute(d))
    .flatMap((d) => [p.resolve(d), real(p.resolve(d))])
    .map(fold);
  const inside = (path: string) =>
    excluded.some((ex) => {
      const rel = p.relative(ex, fold(path));
      return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
    });
  const path = (win ? (env['Path'] ?? env['PATH']) : (env['PATH'] ?? env['Path'])) ?? '';
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const entry of path.split(win ? ';' : ':')) {
    const dir = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!dir) continue;
    // Relative entries (".", "bin", "C:tools" on Windows) depend on the current folder.
    if (!p.isAbsolute(dir)) {
      skipped.push(`${dir}: not an absolute folder`);
      continue;
    }
    const candidate = p.join(p.resolve(dir), win ? 'node.exe' : 'node');
    if (seen.has(fold(candidate))) continue;
    seen.add(fold(candidate));
    if (!(o.isExecutable ?? isExecutableFile)(candidate, win)) continue;
    if (inside(candidate) || inside(real(candidate))) {
      skipped.push(`${candidate}: in a folder the monsters can write`);
      continue;
    }
    const out = (o.version ?? defaultVersion)(candidate);
    const major = nodeMajor(out);
    if (major === null || major < MIN_NODE_MAJOR) {
      skipped.push(
        `${candidate}: ${major === null ? 'not a Node' : `Node ${major}, older than ${MIN_NODE_MAJOR}`}`,
      );
      continue;
    }
    return { command: candidate, version: (out ?? '').trim() };
  }
  return { command: null, skipped };
}

/** The `node` of the children once looked for, with the search that found it (or not). */
let pinned: { runtime: NodeRuntime | null; search: ChildNodeSearch; explicit: boolean } | null =
  null;

const asRuntime = (r: ChildNodeResult): NodeRuntime | null =>
  r.command ? { command: r.command, source: 'path' } : null;

/**
 * Inside Electron: looks for the children's `node` now and keeps its absolute path for the
 * life of the process (`nodeRuntime` returns it, whatever env it is given later). Called by
 * the core at start with the folders the monsters can write; a later call keeps the first
 * result. Outside Electron the children run with the Node running Monsters: nothing to look for.
 */
export function pinNodeRuntime(
  search: ChildNodeSearch = {},
  proc: RuntimeProcess = process,
): NodeRuntime | null {
  if (proc.versions['electron'] === undefined) return { command: proc.execPath, source: 'node' };
  if (pinned?.explicit) return nodeRuntime({}, proc);
  const s: ChildNodeSearch = { platform: proc.platform, ...search };
  pinned = { runtime: asRuntime(findChildNode(s)), search: s, explicit: true };
  return pinned.runtime;
}

/** Tests: forgets the pinned `node`. */
export function unpinNodeRuntime(): void {
  pinned = null;
}

/**
 * `MONSTERS_NODE_PATH` wins; then, inside Electron, the `node` pinned at the start of the core
 * (looked for now, on the PATH of `env`, when the core did not pin one; never the Electron
 * binary; null when there is none); else the Node running Monsters. When no `node` was found
 * the same search (same folders left out) runs again: Node installed while the app runs is
 * found without a restart.
 */
export function nodeRuntime(
  env: NodeJS.ProcessEnv = process.env,
  proc: RuntimeProcess = process,
): NodeRuntime | null {
  const configured = env['MONSTERS_NODE_PATH']?.trim();
  if (configured) return { command: configured, source: 'configured' };
  if (proc.versions['electron'] === undefined) return { command: proc.execPath, source: 'node' };
  if (pinned?.runtime) return pinned.runtime;
  if (pinned) {
    pinned.runtime = asRuntime(findChildNode(pinned.search));
    return pinned.runtime;
  }
  const search: ChildNodeSearch = { env, platform: proc.platform };
  pinned = { runtime: asRuntime(findChildNode(search)), search, explicit: false };
  return pinned.runtime;
}

/** `nodeRuntime`, or an error saying `NODE_MISSING` when there is none. */
export function requireNodeRuntime(
  env: NodeJS.ProcessEnv = process.env,
  proc: RuntimeProcess = process,
): NodeRuntime {
  const runtime = nodeRuntime(env, proc);
  if (!runtime) throw new Error(NODE_MISSING);
  return runtime;
}

/** npm's own script installed with the Node at `node` (nvm, Homebrew, installers, Windows). */
function npmCliNextTo(node: string): string | null {
  const dirs = new Set([dirname(node)]);
  try {
    dirs.add(dirname(realpathSync(node)));
  } catch {
    // a path that does not exist: nothing next to it
  }
  for (const dir of dirs) {
    for (const candidate of [
      join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** How to run npm. */
export interface NpmCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * npm, as `node npm-cli.js` when possible (no shell, no `npm.cmd`): the npm of
 * the runtime Node, else (outside Electron) of the `node` on the PATH (a
 * MONSTERS_NODE_PATH without npm next to it), else an `npm` on the PATH (not
 * on Windows, where it is a .cmd). Null when there is none: see `NPM_MISSING`.
 */
export function npmCommand(
  env: NodeJS.ProcessEnv = process.env,
  proc: RuntimeProcess = process,
): NpmCommand | null {
  const runtime = nodeRuntime(env, proc);
  if (runtime) {
    const cli = npmCliNextTo(runtime.command);
    if (cli) return { command: runtime.command, args: [cli], env: {} };
  }
  // Inside Electron the pinned `node` is the only one: no other taken from the PATH.
  const node = proc.versions['electron'] === undefined ? findOnPath('node', env) : null;
  if (node) {
    const cli = npmCliNextTo(node);
    if (cli) return { command: node, args: [cli], env: {} };
  }
  if (proc.platform !== 'win32') {
    const npm = findOnPath('npm', env);
    if (npm) return { command: npm, args: [], env: {} };
  }
  return null;
}

/** Shown when npm is needed and not found (in Italian: it reaches the user). */
export const NPM_MISSING =
  'npm non trovato: installa Node.js (con npm) da https://nodejs.org, oppure indica il Node da usare con la variabile MONSTERS_NODE_PATH';
