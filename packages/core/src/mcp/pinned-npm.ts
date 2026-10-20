import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UV_EXCLUDE_NEWER } from '@monsters/shared';
import { findOnPath } from '@monsters/shared/node';
import { prepareNpmCi, runNpmCi, type InstallCommand } from './browser-package.ts';
import { SHOPIFY_DEV_MCP_LOCK, type NpmLock } from './pinned-npm-locks.ts';
import type { McpServerSetting } from './config.ts';

/*
 * Gallery servers that run from an npm package installed once, like the
 * browser preset (review of 18/10, M10): `npm ci` on a lockfile of ours (exact
 * version and `dist.integrity` of every package, indirect ones included), from
 * the public registry whatever the user's npm configuration says, without
 * install scripts. `npx -y` would resolve the indirect packages again at every
 * start and run their scripts with the user's `.npmrc`.
 *
 * A server added before, or edited by the user, keeps the command it has: only
 * a setting that still holds the gallery's own `npx` line is moved here.
 */

export interface PinnedNpmServer {
  /** Gallery id. */
  readonly id: string;
  readonly package: string;
  readonly version: string;
  /** Script of the package that starts the server, relative to its folder. */
  readonly bin: string;
  readonly lock: NpmLock;
}

export const PINNED_NPM_SERVERS: readonly PinnedNpmServer[] = [
  {
    id: 'shopify',
    package: '@shopify/dev-mcp',
    version: '1.16.0',
    bin: 'dist/index.js',
    lock: SHOPIFY_DEV_MCP_LOCK,
  },
];

/** Where the packages of the gallery servers are installed. */
export function pinnedDir(home: string, id: string): string {
  return join(home, 'mcp-packages', id);
}

/** Script that starts the installed server. */
export function pinnedEntry(home: string, server: PinnedNpmServer): string {
  return join(pinnedDir(home, server.id), 'node_modules', ...server.package.split('/'), server.bin);
}

/** `dist.integrity` of the main package, from the lockfile. */
export function pinnedIntegrity(server: PinnedNpmServer): string {
  return server.lock.packages[`node_modules/${server.package}`]?.integrity ?? '';
}

/**
 * The pinned server a setting stands for: it came from the gallery and still
 * runs the gallery's `npx -y <package>@<version>` line. Undefined for anything
 * else (a server the user wrote or changed keeps its own command).
 */
export function pinnedServerOf(
  setting: Pick<McpServerSetting, 'catalog' | 'command' | 'args' | 'transport' | 'preset'>,
): PinnedNpmServer | undefined {
  if (setting.transport !== 'stdio' || setting.preset || !setting.catalog) return undefined;
  const server = PINNED_NPM_SERVERS.find((s) => s.id === setting.catalog);
  if (!server || setting.command !== 'npx') return undefined;
  const pinned = `${server.package}@${server.version}`;
  const rest = setting.args.filter((a) => a !== '-y' && a !== '--yes');
  return rest.length === 1 && rest[0] === pinned ? server : undefined;
}

const MARKER = 'installed.json';

/** True when the exact package is installed and was checked. */
export function pinnedInstalled(home: string, server: PinnedNpmServer): boolean {
  try {
    const marker = JSON.parse(readFileSync(join(pinnedDir(home, server.id), MARKER), 'utf8')) as {
      package?: string;
      version?: string;
      integrity?: string;
    };
    return (
      marker.package === server.package &&
      marker.version === server.version &&
      marker.integrity === pinnedIntegrity(server) &&
      statSync(pinnedEntry(home, server)).isFile()
    );
  } catch {
    return false;
  }
}

export function preparePinnedInstall(
  home: string,
  server: PinnedNpmServer,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  hasNpm: (env: NodeJS.ProcessEnv) => boolean = (e) => findOnPath('npm', e) !== null,
): InstallCommand {
  return prepareNpmCi(pinnedDir(home, server.id), server.lock, env, platform, hasNpm);
}

/**
 * After `npm ci`: the installed version and the integrity npm recorded for the
 * main package must be ours. Writes the marker read by `pinnedInstalled`.
 */
export function checkPinnedInstall(home: string, server: PinnedNpmServer): void {
  const dir = pinnedDir(home, server.id);
  const modules = join(dir, 'node_modules');
  const pkg = JSON.parse(
    readFileSync(join(modules, ...server.package.split('/'), 'package.json'), 'utf8'),
  ) as { version?: string };
  const recorded = JSON.parse(readFileSync(join(modules, '.package-lock.json'), 'utf8')) as {
    packages?: Record<string, { integrity?: string }>;
  };
  const integrity = recorded.packages?.[`node_modules/${server.package}`]?.integrity;
  if (pkg.version !== server.version || integrity !== pinnedIntegrity(server)) {
    throw new Error(`il pacchetto ${server.package} installato non è quello atteso`);
  }
  writeFileSync(
    join(dir, MARKER),
    `${JSON.stringify({ package: server.package, version: server.version, integrity })}\n`,
  );
}

/** Installs the package of a gallery server unless it is there already (npm runs in the kill scope). */
export async function installPinnedPackage(
  home: string,
  server: PinnedNpmServer,
  env: NodeJS.ProcessEnv,
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess,
  signal: AbortSignal,
  hasNpm?: (env: NodeJS.ProcessEnv) => boolean,
): Promise<void> {
  if (pinnedInstalled(home, server)) return;
  const step = preparePinnedInstall(home, server, env, process.platform, hasNpm);
  await runNpmCi(step, spawn, signal, `di ${server.package}`);
  checkPinnedInstall(home, server);
}

/**
 * The arguments of a Blender server added before `--exclude-newer` (M10): the
 * gallery's own `uvx` line gets the date limit in front.
 */
export function withUvDateLimit(
  setting: Pick<McpServerSetting, 'catalog' | 'command' | 'args'>,
): string[] {
  if (setting.catalog !== 'blender' || setting.command !== 'uvx') return setting.args;
  if (setting.args.includes('--exclude-newer')) return setting.args;
  return ['--exclude-newer', UV_EXCLUDE_NEWER, ...setting.args];
}
