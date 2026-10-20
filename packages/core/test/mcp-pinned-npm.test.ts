import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_CATALOG, UV_EXCLUDE_NEWER } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  NPM_REGISTRY,
  PINNED_NPM_SERVERS,
  installPinnedPackage,
  pinnedEntry,
  pinnedInstalled,
  pinnedServerOf,
  preparePinnedInstall,
  withUvDateLimit,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';

/*
 * Shopify (and any npm server of the gallery with a pinned install) runs from a
 * package installed once from our lockfile, like the browser (review of 18/10, M10).
 * No network here: npm is replaced by a script that lays out what `npm ci` would.
 */

const shopify = PINNED_NPM_SERVERS.find((s) => s.id === 'shopify')!;
const catalogShopify = MCP_CATALOG.find((e) => e.id === 'shopify')!;
const gallerySetting = {
  catalog: 'shopify',
  transport: 'stdio' as const,
  command: catalogShopify.command,
  args: catalogShopify.args ?? [],
};

const fakeNpm = (version: string) => `
const fs = require('node:fs');
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const dir = 'node_modules/${shopify.package}';
fs.mkdirSync(dir + '/dist', { recursive: true });
fs.writeFileSync(dir + '/package.json', JSON.stringify({ version: ${JSON.stringify(version)} }));
fs.writeFileSync(dir + '/dist/index.js', '');
fs.writeFileSync('node_modules/.package-lock.json', JSON.stringify(lock));
`;

describe('gallery npm servers with a pinned install', () => {
  it('the lockfile pins every package, indirect ones too, on the public registry', () => {
    const { packages } = shopify.lock;
    expect(packages['']?.dependencies).toEqual({ [shopify.package]: shopify.version });
    expect(packages[`node_modules/${shopify.package}`]).toMatchObject({ version: shopify.version });
    for (const [path, entry] of Object.entries(packages)) {
      if (path === '') continue;
      expect(entry.integrity, path).toMatch(/^sha512-/);
      expect(entry.resolved, path).toMatch(/^https:\/\/registry\.npmjs\.org\//);
    }
  });

  it('the gallery line is the one pinned; a changed line keeps its own command', () => {
    expect(pinnedServerOf(gallerySetting)).toBe(shopify);
    expect(pinnedServerOf({ ...gallerySetting, args: ['-y', '@shopify/dev-mcp@9.9.9'] })).toBe(
      undefined,
    );
    expect(pinnedServerOf({ ...gallerySetting, args: [...gallerySetting.args, '--x'] })).toBe(
      undefined,
    );
    expect(pinnedServerOf({ ...gallerySetting, command: 'node' })).toBe(undefined);
    expect(pinnedServerOf({ ...gallerySetting, catalog: undefined })).toBe(undefined);
  });

  it('npm ci: public registry, no scripts, no user configuration', () => {
    const home = tempHome();
    const step = preparePinnedInstall(
      home,
      shopify,
      { PATH: '/bin', npm_config_registry: 'x' },
      'linux',
    );
    expect(step.args).toEqual(
      expect.arrayContaining(['ci', '--ignore-scripts', `--registry=${NPM_REGISTRY}`]),
    );
    expect(step.env).toEqual({ PATH: '/bin' });
    const lock = JSON.parse(readFileSync(join(step.cwd, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, unknown>;
    };
    expect(Object.keys(lock.packages)).toHaveLength(Object.keys(shopify.lock.packages).length);
  });

  it('installs, checks the integrity and does not install again', async () => {
    const home = tempHome();
    const runs: string[][] = [];
    const fake =
      (version: string) => (_c: string, args: string[], options: Parameters<typeof spawn>[2]) => {
        runs.push(args);
        return spawn(process.execPath, ['-e', fakeNpm(version)], options);
      };
    const signal = new AbortController().signal;
    const npm = () => true;
    await expect(
      installPinnedPackage(home, shopify, {}, fake('0.0.1'), signal, npm),
    ).rejects.toThrow(/non è quello atteso/);
    expect(pinnedInstalled(home, shopify)).toBe(false);
    await installPinnedPackage(home, shopify, {}, fake(shopify.version), signal, npm);
    expect(pinnedInstalled(home, shopify)).toBe(true);
    expect(pinnedEntry(home, shopify)).toContain(join('node_modules', '@shopify', 'dev-mcp'));
    await installPinnedPackage(home, shopify, {}, fake(shopify.version), signal, npm);
    expect(runs.length).toBe(2);
  });

  it('Blender: uv resolves the indirect packages as of a fixed day', () => {
    const entry = MCP_CATALOG.find((e) => e.id === 'blender')!;
    expect(entry.args?.slice(0, 2)).toEqual(['--exclude-newer', UV_EXCLUDE_NEWER]);
    // Added before the limit existed: the gallery line gets it at the start.
    const old = { catalog: 'blender', command: 'uvx', args: (entry.args ?? []).slice(2) };
    expect(withUvDateLimit(old)).toEqual(entry.args);
    expect(withUvDateLimit({ ...old, command: 'node' })).toEqual(old.args);
    expect(withUvDateLimit({ ...old, catalog: undefined })).toEqual(old.args);
    expect(withUvDateLimit({ ...old, args: entry.args ?? [] })).toEqual(entry.args);
  });
});
