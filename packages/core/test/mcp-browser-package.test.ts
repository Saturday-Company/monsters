import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  NPM_REGISTRY,
  PLAYWRIGHT_MCP_INTEGRITY,
  PLAYWRIGHT_MCP_VERSION,
  browserEnv,
  browserInstalled,
  BROWSER_BLOCKED_ORIGINS,
  assertPublicBrowserUrl,
  browserLaunch,
  installBrowserPackage,
  prepareBrowserInstall,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';

/*
 * The browser preset is installed once, from our lockfile, without install
 * scripts and without the user's npm configuration. No network here: npm is
 * replaced by a script that lays out what `npm ci` would.
 */

/** Writes what `npm ci` leaves in node_modules, with the given version. */
const fakeNpm = (version: string) => `
const fs = require('node:fs');
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
fs.mkdirSync('node_modules/@playwright/mcp', { recursive: true });
fs.writeFileSync('node_modules/@playwright/mcp/package.json', JSON.stringify({ version: ${JSON.stringify(version)} }));
fs.writeFileSync('node_modules/@playwright/mcp/cli.js', '');
fs.writeFileSync('node_modules/.package-lock.json', JSON.stringify(lock));
`;

describe('browser preset: package installed once', () => {
  it('npm ci on our lockfile: public registry, no scripts, no user configuration', () => {
    const home = tempHome();
    const step = prepareBrowserInstall(
      home,
      { PATH: '/bin', npm_config_registry: 'https://evil.example/', NPM_CONFIG_USERCONFIG: 'x' },
      'linux',
    );
    expect(step.command).toBe('npm');
    expect(step.args[0]).toBe('ci');
    expect(step.args).toEqual(
      expect.arrayContaining([
        '--ignore-scripts',
        `--registry=${NPM_REGISTRY}`,
        `--userconfig=${join(step.cwd, 'user.npmrc')}`,
        `--globalconfig=${join(step.cwd, 'global.npmrc')}`,
      ]),
    );
    expect(step.env).toEqual({ PATH: '/bin' });
    expect(readFileSync(join(step.cwd, 'user.npmrc'), 'utf8')).toBe('');
    const lock = JSON.parse(readFileSync(join(step.cwd, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { version?: string; integrity?: string; resolved?: string }>;
    };
    const main = lock.packages['node_modules/@playwright/mcp']!;
    expect(main).toMatchObject({
      version: PLAYWRIGHT_MCP_VERSION,
      integrity: PLAYWRIGHT_MCP_INTEGRITY,
    });
    // Every package, indirect ones too, pinned with its integrity on the public registry.
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (path === '') continue;
      expect(entry.integrity).toMatch(/^sha512-/);
      expect(entry.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//);
    }
    expect(prepareBrowserInstall(home, {}, 'win32', () => true).command).toBe('cmd.exe');
  });

  it('on Windows without npm: says to install Node.js, not what cmd.exe would say', async () => {
    const home = tempHome();
    expect(() => prepareBrowserInstall(home, { PATH: '' }, 'win32', () => false)).toThrow(
      /install Node\.js \(with npm\) from https:\/\/nodejs\.org/,
    );
    // The real check: npm (npm.cmd on Windows) on the PATH.
    if (process.platform === 'win32') {
      await expect(
        installBrowserPackage(home, { PATH: '' }, spawn, new AbortController().signal),
      ).rejects.toThrow(/install Node\.js/);
    }
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
    // npm "found" on the PATH: the fake spawn stands in for it on every system.
    const npm = () => true;

    await expect(installBrowserPackage(home, {}, fake('0.0.1'), signal, npm)).rejects.toThrow(
      /isn’t the expected one/,
    );
    expect(browserInstalled(home)).toBe(false);

    await installBrowserPackage(home, {}, fake(PLAYWRIGHT_MCP_VERSION), signal, npm);
    expect(browserInstalled(home)).toBe(true);
    await installBrowserPackage(home, {}, fake(PLAYWRIGHT_MCP_VERSION), signal, npm);
    expect(runs.length).toBe(2);
  });

  it('starts with node, files confined, no PLAYWRIGHT_MCP_* from the environment', () => {
    const launch = browserLaunch('/h', false);
    expect(launch.command).toBe(process.execPath);
    expect(launch).not.toHaveProperty('env');
    // Inside the desktop app: the node on the PATH (the app's binary is never a Node).
    const inApp = browserLaunch('/h', false, { command: '/usr/bin/node', source: 'path' });
    expect(inApp.command).toBe('/usr/bin/node');
    // No Node at all: shown as `node` (starting it fails with NODE_MISSING, in the manager).
    expect(browserLaunch('/h', false, null).command).toBe('node');
    expect(launch.args).not.toContain('--allow-unrestricted-file-access');
    // Loopback and private networks are blocked for pages, redirects and subresources (M7).
    const blocked = launch.args[launch.args.indexOf('--blocked-origins') + 1]!.split(';');
    expect(blocked).toEqual([...BROWSER_BLOCKED_ORIGINS]);
    expect(
      browserEnv({
        PATH: '/bin',
        PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS: '1',
        playwright_mcp_config: 'x',
      }),
    ).toEqual({ PATH: '/bin' });
  });
});

/*
 * `--blocked-origins` as Playwright reads it: each entry goes through its
 * `originOrHostGlob` (not exported: taken from the bundle's source) and then
 * through `urlMatches`, the matcher of `context.route`. The URLs are the ones
 * the browser requests, already normalised.
 */
describe('browser: blocked origins under Playwright matcher', () => {
  const root = join(import.meta.dirname, '..', '..', '..');
  const fromWeb = createRequire(join(root, 'apps', 'web', 'package.json'));
  const fromTest = createRequire(fromWeb.resolve('@playwright/test/package.json'));
  const fromPw = createRequire(fromTest.resolve('playwright/package.json'));
  const bundlePath = fromPw.resolve('playwright-core/lib/coreBundle');
  const bundle = fromPw(bundlePath) as {
    iso: { urlMatches: (base: string | undefined, url: string, glob: string) => boolean };
  };
  const source = /function originOrHostGlob\(originOrHost\) \{[\s\S]*?\n\}/.exec(
    readFileSync(bundlePath, 'utf8'),
  )?.[0];
  const originOrHostGlob = source
    ? (runInNewContext(`${source}; originOrHostGlob`, { URL }) as (o: string) => string)
    : undefined;
  const blocked = (url: string) => {
    const href = new URL(url).href;
    return BROWSER_BLOCKED_ORIGINS.some((o) =>
      bundle.iso.urlMatches(undefined, href, originOrHostGlob!(o)),
    );
  };

  it('blocks this machine and the local networks, with and without a port', () => {
    expect(originOrHostGlob, 'originOrHostGlob not found in playwright-core').toBeDefined();
    for (const url of [
      'http://127.0.0.1/admin',
      'http://127.0.0.1:4747/api/team',
      'https://127.1.2.3:8443/',
      'http://localhost/',
      'http://localhost:3000/x',
      'http://LOCALHOST./',
      'http://app.localhost:5173/',
      'http://stampante.local/',
      'http://nas.home.arpa:5000/',
      'http://0.0.0.0/',
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://192.168.1.1:8080/cgi',
      'http://172.16.0.1/',
      'http://172.31.255.1:81/',
      'http://169.254.169.254/latest/meta-data',
      'http://100.64.0.7/',
      'http://100.127.1.1:4747/',
      'http://[::1]/',
      'http://[::1]:8080/',
      'http://[::]:80/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fd12:3456::1]:9000/',
      'http://[fe80::1]/',
      'ws://127.0.0.1:4747/ws',
      // IPv4-compatible and NAT64 forms of 127.0.0.1 (review of 19/10, item 12).
      'http://[::127.0.0.1]/',
      'http://[::7f00:1]:8080/',
      'http://[64:ff9b::7f00:1]/',
      'http://0.0.0.0:4747/',
      'http://10.255.255.255:80/',
    ]) {
      expect(blocked(url), url).toBe(true);
    }
  });

  it('lets public pages through', () => {
    for (const url of [
      'https://example.com/',
      'https://www.google.com/search?q=http://127.0.0.1/',
      'https://localhost.example.com/',
      'http://172.15.0.1/',
      'http://172.32.0.1/',
      'http://100.63.0.1/',
      'http://100.128.0.1/',
      'http://8.8.8.8/',
      'https://[2001:4860:4860::8888]/',
      // Public names that start like a private address.
      'https://0.gravatar.com/avatar/x',
      'https://10.example.com/',
      'https://127.example.org:8443/',
      'https://192.168.example.net/',
    ]) {
      expect(blocked(url), url).toBe(false);
    }
  });
});

describe('browser_navigate: only public pages', () => {
  const resolver = (map: Record<string, string>) => (host: string) =>
    Promise.resolve(
      map[host]
        ? [{ address: map[host], family: map[host].includes(':') ? (6 as const) : (4 as const) }]
        : [],
    );
  const check = (url: string, map: Record<string, string> = {}) =>
    assertPublicBrowserUrl(url, { resolver: resolver(map) });

  it('refuses loopback, private and link-local addresses and names', async () => {
    for (const url of [
      'http://127.0.0.1:3000/',
      'http://localhost:8080',
      'localhost:3000',
      'http://192.168.1.1/admin',
      'http://[::1]/',
      'http://169.254.169.254/latest/meta-data',
      'http://router/',
    ]) {
      await expect(check(url), url).rejects.toMatchObject({ code: 'BLOCKED_BY_POLICY' });
    }
  });

  it('refuses a public name that resolves to a private address', async () => {
    await expect(
      check('https://evil.example/', { 'evil.example': '10.0.0.5' }),
    ).rejects.toMatchObject({
      code: 'BLOCKED_BY_POLICY',
    });
  });

  it('lets public pages and non-web URLs through', async () => {
    await expect(
      check('https://example.com/a', { 'example.com': '93.184.216.34' }),
    ).resolves.toBeUndefined();
    await expect(check('about:blank')).resolves.toBeUndefined();
    // A name that does not resolve is the browser's to report.
    await expect(check('https://nope.example/')).resolves.toBeUndefined();
  });
});
