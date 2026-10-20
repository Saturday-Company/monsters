import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findOnPath } from '@monsters/shared/node';
import { DIR_MODE } from '../config.ts';
import {
  PLAYWRIGHT_MCP_PACKAGE,
  PLAYWRIGHT_MCP_VERSION,
  browserCli,
  browserPackageDir,
} from './config.ts';

/*
 * One-time install of the browser preset (Playwright MCP) in
 * `MONSTERS_HOME/browser/package`, instead of `npx -y` at every start: `npm ci`
 * on a lockfile of ours (exact version and `dist.integrity` of every package,
 * indirect ones included), from the public registry whatever the user's npm
 * configuration says, without install scripts. The integrity of the main
 * package is checked again afterwards.
 */

/** The public registry, never the one (or a scoped one) from the user's `.npmrc`. */
export const NPM_REGISTRY = 'https://registry.npmjs.org/';

const LOCK = {
  name: 'monsters-browser',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': {
      name: 'monsters-browser',
      dependencies: { '@playwright/mcp': PLAYWRIGHT_MCP_VERSION },
    },
    'node_modules/@playwright/mcp': {
      version: PLAYWRIGHT_MCP_VERSION,
      resolved: 'https://registry.npmjs.org/@playwright/mcp/-/mcp-0.0.83.tgz',
      integrity:
        'sha512-oNcl+Ae2/IAjhfPeP46BfIkSakfmprY+aOtkv5MjrQ4lPav4/yNtPhL0iq8SlIM90oApWgBDUxaNKvktazUKOg==',
      dependencies: {
        playwright: '1.64.0-alpha-1790635538000',
        'playwright-core': '1.64.0-alpha-1790635538000',
      },
      bin: { 'playwright-mcp': 'cli.js' },
      engines: { node: '>=18' },
    },
    'node_modules/playwright': {
      version: '1.64.0-alpha-1790635538000',
      resolved: 'https://registry.npmjs.org/playwright/-/playwright-1.64.0-alpha-1790635538000.tgz',
      integrity:
        'sha512-/5XDUMxpOd/9AojJtWDFIRV3EJZNQ0AwvK69wgt3CPzy8wTgiBG9pX45VfxtqtvIRGwfWzMhrvawNKreG69Snw==',
      dependencies: { 'playwright-core': '1.64.0-alpha-1790635538000' },
      bin: { playwright: 'cli.js' },
      engines: { node: '>=20' },
    },
    'node_modules/playwright-core': {
      version: '1.64.0-alpha-1790635538000',
      resolved:
        'https://registry.npmjs.org/playwright-core/-/playwright-core-1.64.0-alpha-1790635538000.tgz',
      integrity:
        'sha512-pNwaXirhXMRLaRQs4NQ18EpTdtDoFwyPH9FOaaDC7YXG4hpwE2xmwCic/1srbuExVQC7zT9LJSJpDBAru+Vo9A==',
      bin: { 'playwright-core': 'cli.js' },
      engines: { node: '>=20' },
    },
  },
};

/** `dist.integrity` of the main package on the registry. */
export const PLAYWRIGHT_MCP_INTEGRITY = LOCK.packages['node_modules/@playwright/mcp'].integrity;

const MARKER = 'installed.json';

/** True when the exact package is installed and was checked. */
export function browserInstalled(home: string): boolean {
  try {
    const marker = JSON.parse(readFileSync(join(browserPackageDir(home), MARKER), 'utf8')) as {
      package?: string;
      integrity?: string;
    };
    return (
      marker.package === PLAYWRIGHT_MCP_PACKAGE &&
      marker.integrity === PLAYWRIGHT_MCP_INTEGRITY &&
      statSync(browserCli(home)).isFile()
    );
  } catch {
    return false;
  }
}

/** In Italian: it reaches the user. */
export const NPM_NEEDED =
  'per installare il browser serve npm: installa Node.js (con npm) da https://nodejs.org e riprova';

/** Exit code of `cmd.exe /c <command>` when the command does not exist. */
const CMD_NOT_FOUND = 9009;

export interface InstallCommand {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export function prepareBrowserInstall(
  home: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  hasNpm: (env: NodeJS.ProcessEnv) => boolean = (e) => findOnPath('npm', e) !== null,
): InstallCommand {
  return prepareNpmCi(browserPackageDir(home), LOCK, env, platform, hasNpm);
}

/**
 * Writes `package.json`, the lockfile and an empty `.npmrc` in a clean folder
 * and returns the npm command: `npm ci`, public registry, no install scripts,
 * no user or global npm configuration. On Windows npm runs through `cmd.exe`,
 * which itself always exists: without npm on the PATH the user would read
 * cmd's "not recognized" message, so the missing npm is told before.
 * Shared by the browser preset and the gallery servers with a pinned install
 * (`pinned-npm.ts`).
 */
export function prepareNpmCi(
  dir: string,
  lock: { packages: Record<string, object | undefined> },
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  hasNpm: (env: NodeJS.ProcessEnv) => boolean = (e) => findOnPath('npm', e) !== null,
): InstallCommand {
  if (platform === 'win32' && !hasNpm(env)) throw new Error(NPM_NEEDED);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ ...lock.packages[''], private: true }, null, 2)}\n`,
  );
  writeFileSync(join(dir, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  // Two empty files in place of the user's and the global configuration (npm
  // refuses the same file twice); no `.npmrc` here, so no project one either.
  const userrc = join(dir, 'user.npmrc');
  const globalrc = join(dir, 'global.npmrc');
  writeFileSync(userrc, '');
  writeFileSync(globalrc, '');
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    // npm also reads its options from npm_config_* variables.
    if (v === undefined || /^npm_config_/i.test(k)) continue;
    clean[k] = v;
  }
  const args = [
    'ci',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--omit=dev',
    `--registry=${NPM_REGISTRY}`,
    `--userconfig=${userrc}`,
    `--globalconfig=${globalrc}`,
  ];
  // npm is a .cmd on Windows: it needs the command interpreter.
  return platform === 'win32'
    ? { command: 'cmd.exe', args: ['/d', '/s', '/c', 'npm', ...args], cwd: dir, env: clean }
    : { command: 'npm', args, cwd: dir, env: clean };
}

/**
 * After `npm ci`: the installed version and the integrity npm recorded for the
 * main package must be ours. Writes the marker read by `browserInstalled`.
 */
export function checkBrowserInstall(home: string): void {
  const dir = browserPackageDir(home);
  const modules = join(dir, 'node_modules');
  const pkg = JSON.parse(
    readFileSync(join(modules, '@playwright', 'mcp', 'package.json'), 'utf8'),
  ) as { version?: string };
  const recorded = JSON.parse(readFileSync(join(modules, '.package-lock.json'), 'utf8')) as {
    packages?: Record<string, { integrity?: string }>;
  };
  const integrity = recorded.packages?.['node_modules/@playwright/mcp']?.integrity;
  if (pkg.version !== PLAYWRIGHT_MCP_VERSION || integrity !== PLAYWRIGHT_MCP_INTEGRITY) {
    throw new Error(`il pacchetto ${PLAYWRIGHT_MCP_PACKAGE} installato non è quello atteso`);
  }
  writeFileSync(
    join(dir, MARKER),
    `${JSON.stringify({ package: PLAYWRIGHT_MCP_PACKAGE, integrity })}\n`,
  );
}

const OUTPUT_KEEP = 2000;

/**
 * Runs the `npm ci` of `prepareNpmCi` in the kill scope (`spawn`): stopping the
 * server (or the kill switch) stops npm too. `what` names the thing installed
 * in the errors the user reads.
 */
export async function runNpmCi(
  step: InstallCommand,
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
      // Not the error itself: its ENOENT would name the wrong program.
      reject(
        new Error(
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? NPM_NEEDED
            : `installazione ${what} non riuscita: ${err.message}`,
        ),
      );
    });
    child.once('close', (exit) => {
      signal.removeEventListener('abort', onAbort);
      resolve(exit);
    });
  });
  if (signal.aborted) throw signal.reason;
  // npm vanished between the check and the start (Windows, through cmd.exe).
  if (code === CMD_NOT_FOUND && step.command === 'cmd.exe') throw new Error(NPM_NEEDED);
  if (code !== 0) {
    const tail = output.trim().split('\n').at(-1) ?? '';
    throw new Error(`installazione ${what} non riuscita (npm ${code})${tail ? `: ${tail}` : ''}`);
  }
}

/**
 * Installs the browser package unless it is there already. `spawn` is the
 * kill scope's: stopping the server (or the kill switch) stops npm too.
 */
export async function installBrowserPackage(
  home: string,
  env: NodeJS.ProcessEnv,
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess,
  signal: AbortSignal,
  hasNpm?: (env: NodeJS.ProcessEnv) => boolean,
): Promise<void> {
  if (browserInstalled(home)) return;
  const step = prepareBrowserInstall(home, env, process.platform, hasNpm);
  await runNpmCi(step, spawn, signal, 'del browser');
  checkBrowserInstall(home);
}
