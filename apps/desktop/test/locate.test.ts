import { mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homePaths } from '@monsters/core';
import { tunnelProof } from '@monsters/shared/node';
import { describe, expect, it, vi } from 'vitest';
import {
  isLocalCoreUrl,
  locateCore,
  locateOnce,
  systemLocatorDeps,
  type LocatorDeps,
} from '../src/main/core-locator.ts';
import { HOME_FILES, homeFile } from '../src/main/home.ts';
import { coreChildEnv, LocalCore } from '../src/main/local-core.ts';
import type { CoreChild } from '../src/main/supervisor.ts';
import { tempDir } from './helpers.ts';

function fakeDeps(files: Record<string, string>, opts: Partial<LocatorDeps> = {}): LocatorDeps {
  let t = 0;
  return {
    readFile: (p) => files[p.split(/[\\/]/).pop()!] ?? null,
    isAlive: () => true,
    health: () => Promise.resolve(true),
    sleep: (ms) => {
      t += ms;
      return Promise.resolve();
    },
    now: () => t,
    ...opts,
  };
}

const lock = (pid: number) => JSON.stringify({ pid, start: 1, acquiredAt: 1 });
const KEY = 'k'.repeat(43);
const server = (pid: number, url = 'http://127.0.0.1:4747', proofKey: string | null = KEY) =>
  JSON.stringify({ pid, url, ...(proofKey ? { proofKey } : {}) });

describe('core locator', () => {
  it('uses the same file names as the core', () => {
    const core = homePaths('/h');
    expect(homeFile('/h', 'serverInfo')).toBe(core.serverInfo);
    expect(homeFile('/h', 'cliToken')).toBe(core.cliToken);
    expect(homeFile('/h', 'setupCode')).toBe(core.setupCode);
    expect(HOME_FILES.lock).toBe('core.lock');
  });

  it('starts when nobody owns the directory, or the owner is dead', async () => {
    expect(await locateOnce('/h', fakeDeps({}))).toEqual({ kind: 'start' });
    const dead = fakeDeps(
      { 'core.lock': lock(7), 'server.json': server(7) },
      { isAlive: () => false },
    );
    expect(await locateOnce('/h', dead)).toEqual({ kind: 'start' });
    expect(await locateOnce('/h', fakeDeps({ 'core.lock': 'garbage' }))).toEqual({ kind: 'start' });
  });

  it('attaches to a live core that answers', async () => {
    const deps = fakeDeps({ 'core.lock': lock(7), 'server.json': server(7) });
    expect(await locateOnce('/h', deps)).toEqual({
      kind: 'attach',
      url: 'http://127.0.0.1:4747',
      pid: 7,
    });
  });

  it('waits for a core that is starting, then attaches', async () => {
    const files: Record<string, string> = { 'core.lock': lock(7) };
    const deps = fakeDeps(files, {
      sleep: () => {
        files['server.json'] = server(7);
        return Promise.resolve();
      },
    });
    expect(await locateOnce('/h', deps)).toEqual({ kind: 'wait', reason: 'starting' });
    expect(await locateCore('/h', deps)).toMatchObject({ kind: 'attach' });
  });

  it('gives a hung core a while, then lets the core judge the lock', async () => {
    const health = vi.fn(() => Promise.resolve(false));
    const deps = fakeDeps({ 'core.lock': lock(7), 'server.json': server(7) }, { health });
    expect(await locateCore('/h', deps, { waitMs: 1000, pollMs: 250 })).toEqual({
      kind: 'start',
      afterWait: 'not_responding',
    });
    expect(health).toHaveBeenCalledTimes(5);
  });

  it('never attaches to a URL that is not a local core', async () => {
    for (const url of [
      'http://evil.example:4747',
      'https://127.0.0.1:4747',
      'http://user:pw@127.0.0.1:4747',
      'http://127.0.0.1',
      'http://127.0.0.1:4747/x',
    ]) {
      expect(isLocalCoreUrl(url)).toBe(false);
      const deps = fakeDeps({ 'core.lock': lock(7), 'server.json': server(7, url) });
      expect(await locateOnce('/h', deps)).toEqual({ kind: 'wait', reason: 'starting' });
    }
    expect(isLocalCoreUrl('http://localhost:1234')).toBe(true);
    expect(isLocalCoreUrl('http://[::1]:1234')).toBe(true);
  });

  it('attaches only to a core that proves it has the key of server.json (B12)', async () => {
    const answers = (key: string | null): typeof fetch =>
      ((input: string) => {
        const nonce = new URL(input).searchParams.get('proof');
        const body = { ok: true, ...(key && nonce ? { proof: tunnelProof(key, nonce) } : {}) };
        return Promise.resolve(new Response(JSON.stringify(body)));
      }) as unknown as typeof fetch;
    const files = { 'core.lock': lock(7), 'server.json': server(7) };
    const via = (fetchImpl: typeof fetch, f: Record<string, string> = files) =>
      locateOnce('/h', {
        ...systemLocatorDeps(fetchImpl),
        readFile: (p) => f[p.split(/[\\/]/).pop()!] ?? null,
        isAlive: () => true,
      });
    expect(await via(answers(KEY))).toMatchObject({ kind: 'attach', pid: 7 });
    // A process on the port that answers `ok` without the proof, or with another key.
    expect(await via(answers(null))).toEqual({ kind: 'wait', reason: 'not_responding' });
    expect(await via(answers('x'.repeat(43)))).toEqual({ kind: 'wait', reason: 'not_responding' });
    // A core with no proof key in server.json (older) cannot say who it is: not attached.
    expect(
      await via(answers(KEY), { 'core.lock': lock(7), 'server.json': server(7, undefined, null) }),
    ).toEqual({ kind: 'wait', reason: 'not_responding' });
  });

  it('reads real files and pids', async () => {
    const home = tempDir();
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'core.lock'), lock(process.pid));
    const deps = {
      ...systemLocatorDeps(() => Promise.reject(new Error('down'))),
      sleep: () => Promise.resolve(),
    };
    expect(await locateOnce(home, deps)).toEqual({ kind: 'wait', reason: 'starting' });
    writeFileSync(join(home, 'core.lock'), lock(2 ** 30));
    expect(await locateOnce(home, deps)).toEqual({ kind: 'start' });
  });
});

class Child implements CoreChild {
  readonly pid = 42;
  messages: ((m: unknown) => void)[] = [];
  exits: ((c: number) => void)[] = [];
  postMessage() {}
  kill() {}
  onMessage(l: (m: unknown) => void) {
    this.messages.push(l);
  }
  onExit(l: (c: number) => void) {
    this.exits.push(l);
  }
}

describe('local core: attach or start', () => {
  const base = (files: Record<string, string>, spawn: () => CoreChild, exists = true) =>
    new LocalCore({
      home: '/h',
      coreEntry: '/bundle/monsters.js',
      spawn,
      locator: fakeDeps(files),
      fileExists: () => exists,
      logPath: '/h/logs/desktop.log',
      locate: { waitMs: 0 },
    });

  it('attaches to the CLI core and never starts one; shutdown leaves it running', async () => {
    const spawn = vi.fn(() => new Child());
    const lc = base(
      { 'core.lock': lock(7), 'server.json': server(7), 'setup-code': 'ABCD\n' },
      spawn,
    );
    const targets: string[] = [];
    lc.on('target', (t) => targets.push(`${t.kind} ${t.url}`));
    await lc.connect();
    expect(targets).toEqual(['attached http://127.0.0.1:4747']);
    expect(await lc.target?.setupCode()).toBe('ABCD');
    // No CLI token file: no automatic login, the window shows the login page.
    expect(await lc.target?.loginToken()).toBeNull();
    await lc.shutdown();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('starts its own core when there is none', async () => {
    const child = new Child();
    const lc = base({}, () => child);
    const events: string[] = [];
    lc.on('down', (v) => events.push(v.kind));
    lc.on('target', (t) => events.push(t.kind));
    await lc.connect();
    expect(events).toEqual(['starting']);
    for (const l of child.messages)
      l({
        type: 'ready',
        url: 'http://127.0.0.1:9',
        port: 9,
        home: '/h',
        pid: 42,
        version: '0',
        setupCode: null,
      });
    expect(events).toEqual(['starting', 'owned']);
    expect(lc.target?.url).toBe('http://127.0.0.1:9');
  });

  it('says so when the bundle is missing', async () => {
    const lc = base({}, () => new Child(), false);
    const views: unknown[] = [];
    lc.on('down', (v) => views.push(v));
    await lc.connect();
    expect(views).toEqual([{ kind: 'missing', path: '/bundle/monsters.js', dev: false }]);
  });
});

describe('environment of the core the app starts', () => {
  it('carries the app version and drops ELECTRON_RUN_AS_NODE', () => {
    const env = coreChildEnv(
      {
        PATH: '/usr/bin',
        ELECTRON_RUN_AS_NODE: '1',
        MONSTERS_APP_VERSION: '9.9.9',
        GONE: undefined,
      },
      '0.1.0',
    );
    expect(env).toEqual({ PATH: '/usr/bin', MONSTERS_APP_VERSION: '0.1.0' });
  });

  it('names the installed app to the core, and never takes the list from the outside', () => {
    const env = coreChildEnv({ PATH: '/usr/bin', MONSTERS_INSTALL_DIRS: '/home' }, '0.1.0', [
      '/opt/Monsters/resources',
      '/opt/Monsters',
    ]);
    expect(env['MONSTERS_INSTALL_DIRS']?.split(delimiter)).toEqual([
      '/opt/Monsters/resources',
      '/opt/Monsters',
    ]);
    expect(coreChildEnv({ MONSTERS_INSTALL_DIRS: '/home' }, '0.1.0')).not.toHaveProperty(
      'MONSTERS_INSTALL_DIRS',
    );
  });

  it('confines the packaged core to its folder (review of 19/10, n. 1)', () => {
    const packaged = coreChildEnv(
      { PATH: '/usr/bin', NODE_PATH: '/home/x/node_modules' },
      '0.1.0',
      ['/opt/Monsters/resources'],
    );
    expect(packaged).toMatchObject({
      MONSTERS_CORE_CONFINE: '1',
      WS_NO_BUFFER_UTIL: '1',
      WS_NO_UTF_8_VALIDATE: '1',
    });
    expect(packaged).not.toHaveProperty('NODE_PATH');
    // Development: Node looks up as usual, whatever the app's environment says.
    const dev = coreChildEnv({ MONSTERS_CORE_CONFINE: '1' }, '0.1.0');
    expect(dev).not.toHaveProperty('MONSTERS_CORE_CONFINE');
  });
});
