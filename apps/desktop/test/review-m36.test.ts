import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LocatorDeps } from '../src/main/core-locator.ts';
import { debugSwitchVerdict, type DebugSwitchInput } from '../src/main/debug-switches.ts';
import { LocalCore, type CoreTarget } from '../src/main/local-core.ts';
import { ExternalOpenLimiter } from '../src/main/navigation.ts';
import { newerFileMessage, ProfileStore } from '../src/main/profiles.ts';
import { TargetSwitcher, type CoreHost } from '../src/main/target-switch.ts';
import { UPDATE_CHANNEL } from '../src/main/updater.ts';
import { tempDir } from './helpers.ts';

/*
 * Fixes of the M3.6 review (app side). The first tests were reproductions of the wrong
 * behaviour (commit e9c4311), inverted together with the fixes.
 */

class SlowHost extends EventEmitter implements CoreHost {
  target: CoreTarget | null = null;
  closed = false;
  release!: () => void;
  readonly gate = new Promise<void>((r) => (this.release = r));
  connect(): Promise<void> {
    return Promise.resolve();
  }
  retry(): void {}
  async shutdown(): Promise<void> {
    await this.gate;
    this.closed = true;
  }
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('M3.6 review: quitting', () => {
  it('a second "Esci" waits for the core to stop like the first one (C4)', async () => {
    const host = new SlowHost();
    const s = new TargetSwitcher<string>({ create: () => host });
    await s.switchTo('local');
    const first = s.shutdown();
    let secondDone = false;
    // index.ts before-quit: a second app.quit() must not let Electron exit before the core.
    const second = s.shutdown().then(() => (secondDone = true));
    await tick();
    expect(secondDone).toBe(false);
    expect(host.closed).toBe(false);
    host.release();
    await Promise.all([first, second]);
    expect(secondDone).toBe(true);
    expect(host.closed).toBe(true);
  });

  it('quitting does not wait for the 15 s search of a hung CLI core', async () => {
    const home = tempDir();
    let sleeping = 0;
    const locator: LocatorDeps = {
      readFile: (p) =>
        p.endsWith('core.lock')
          ? JSON.stringify({ pid: 7 })
          : p.endsWith('server.json')
            ? JSON.stringify({ pid: 7, url: 'http://127.0.0.1:4747' })
            : null,
      isAlive: () => true,
      // A CLI core holds the lock but does not answer (stopped with SIGSTOP, swapping…).
      health: () => Promise.resolve(false),
      sleep: () => {
        sleeping += 1;
        return new Promise<void>(() => {}); // never wakes by itself
      },
      now: () => 0,
    };
    let started = false;
    const core = new LocalCore({
      home,
      coreEntry: '/nope/monsters.js',
      spawn: () => {
        started = true;
        throw new Error('not started in this test');
      },
      locator,
      fileExists: () => true,
      logPath: join(home, 'desktop.log'),
    });
    void core.connect();
    await tick(10);
    expect(sleeping).toBe(1);
    let stopped = false;
    const stopping = core.shutdown().then(() => (stopped = true));
    await tick(50);
    expect(stopped).toBe(true);
    await stopping;
    expect(started).toBe(false);
  });
});

describe('M3.6 review: connections.json (C5)', () => {
  const good = {
    version: 1,
    profiles: [
      { id: 'aaaaaaaa-1', name: 'Casa', host: 'casa.local', autoLogin: false },
      { id: 'bbbbbbbb-2', name: 'Ufficio', host: 'ufficio', autoLogin: true },
    ],
    last: 'aaaaaaaa-1',
  };

  it('a damaged file is kept aside before being replaced', () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'connections.json');
    const damaged = JSON.stringify(good).slice(0, -3);
    writeFileSync(file, damaged);
    const log: string[] = [];
    const store = new ProfileStore(file, {
      log: (l) => log.push(l),
      now: () => new Date('2026-10-15T10:20:30Z'),
    });
    expect(store.list()).toEqual([]);
    expect(store.readOnly).toBe(false);
    store.setLast('local');
    const copy = join(dir, 'connections.json.corrupt-20261015-102030');
    expect(readFileSync(copy, 'utf8')).toBe(damaged);
    expect(log.join('\n')).toContain('damaged, kept as');
    // The next start reads a good (empty) file and keeps nothing else aside.
    new ProfileStore(file).setLast('local');
    expect(readdirSync(dir).filter((f) => f.includes('.corrupt-'))).toHaveLength(1);
  });

  it('a file with a broken profile keeps a copy too', () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'connections.json');
    const raw = JSON.stringify({ ...good, profiles: [...good.profiles, { id: 'x' }] });
    writeFileSync(file, raw);
    const store = new ProfileStore(file);
    expect(store.list()).toHaveLength(2);
    expect(readdirSync(dir).some((f) => f.startsWith('connections.json.corrupt-'))).toBe(true);
  });

  it('a file written by a newer app is used but never rewritten', () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'connections.json');
    const raw = JSON.stringify({
      version: 2,
      profiles: [
        { id: 'aaaaaaaa-1', name: 'Casa', host: 'casa.local', autoLogin: false, proxyJump: 'b' },
      ],
      last: 'aaaaaaaa-1',
    });
    writeFileSync(file, raw);
    const store = new ProfileStore(file);
    expect(store.readOnly).toBe(true);
    expect(store.list().map((p) => p.name)).toEqual(['Casa']);
    store.setLast('local');
    expect(store.last).toBe('local');
    expect(store.save({ name: 'Nuovo', host: 'nuovo' })).toEqual({
      ok: false,
      errors: { name: newerFileMessage() },
    });
    expect(store.remove('aaaaaaaa-1')).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(raw);
  });
});

describe('M3.6 review: switching to a profile removed meanwhile', () => {
  it('opens "Questo PC", never a local core in the session of the removed profile', async () => {
    const hosts: string[] = [];
    const closing = new SlowHost();
    const profiles = new Set(['p1']);
    const s = new TargetSwitcher<string>({
      create: (c) => {
        hosts.push(c);
        return c === 'first' ? closing : new SlowHost();
      },
      available: (c) => c === 'local' || c === 'first' || profiles.has(c),
      fallback: 'local',
    });
    const active: string[] = [];
    s.on('active', (c) => active.push(c));
    await s.switchTo('first');
    const switching = s.switchTo('p1');
    await tick();
    // The profile is removed while the previous core is closing.
    profiles.delete('p1');
    closing.release();
    await switching;
    expect(hosts).toEqual(['first', 'local']);
    expect(active).toEqual(['first', 'local']);
    expect(s.choice).toBe('local');
  });
});

describe('M3.6 review: DevTools switches of the packaged app (S2)', () => {
  const base: DebugSwitchInput = {
    isPackaged: true,
    platform: 'linux',
    present: [],
    home: '/home/u/.monsters',
    defaultHome: '/home/u/.monsters',
    userData: '/home/u/.config/Monsters',
    defaultUserData: '/home/u/.config/Monsters',
  };
  const remote = ['remote-debugging-port'];

  it('refuses them on the real data (a tampered shortcut)', () => {
    expect(debugSwitchVerdict({ ...base, present: remote })).toMatchObject({
      action: 'refuse',
      switches: remote,
    });
    expect(debugSwitchVerdict({ ...base, present: ['remote-debugging-pipe'] }).action).toBe(
      'refuse',
    );
    // Another data directory but the real cookies and connections: refused.
    expect(debugSwitchVerdict({ ...base, present: remote, home: '/tmp/x/home' }).action).toBe(
      'refuse',
    );
    // The default home spelled differently (trailing slash, case on macOS) is still the default.
    expect(
      debugSwitchVerdict({
        ...base,
        present: remote,
        home: '/home/u/.monsters/',
        userData: '/tmp/x/userdata',
      }).action,
    ).toBe('refuse');
    expect(
      debugSwitchVerdict({
        ...base,
        platform: 'darwin',
        present: remote,
        home: '/home/u/.Monsters',
        userData: '/tmp/x/userdata',
      }).action,
    ).toBe('refuse');
  });

  it('accepts them on throwaway data (the package tests) and in development', () => {
    expect(
      debugSwitchVerdict({
        ...base,
        present: remote,
        home: '/tmp/x/home',
        userData: '/tmp/x/userdata',
      }),
    ).toEqual({ action: 'allow', debugging: true });
    expect(debugSwitchVerdict({ ...base, isPackaged: false, present: remote })).toEqual({
      action: 'allow',
      debugging: true,
    });
    expect(debugSwitchVerdict(base)).toEqual({ action: 'allow', debugging: false });
  });

  it("never accepts Node's inspector in the package", () => {
    expect(
      debugSwitchVerdict({
        ...base,
        present: ['inspect'],
        home: '/tmp/x/home',
        userData: '/tmp/x/userdata',
      }).action,
    ).toBe('refuse');
  });
});

describe('M3.6 review: links to the browser (S6)', () => {
  it('at most 5 links every 10 s', () => {
    let now = 0;
    const l = new ExternalOpenLimiter({ now: () => now });
    for (let i = 0; i < 5; i++) expect(l.allow()).toBe(true);
    expect(l.allow()).toBe(false);
    now = 9_999;
    expect(l.allow()).toBe(false);
    now = 10_000;
    expect(l.allow()).toBe(true);
  });
});

describe('M3.6 review: version of the alpha (C8)', () => {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version: string };
  // The same semver electron-updater compares versions with.
  const semver = createRequire(createRequire(import.meta.url).resolve('electron-updater'))(
    'semver',
  ) as {
    valid(v: string): string | null;
    prerelease(v: string): (string | number)[] | null;
    gt(a: string, b: string): boolean;
  };

  it('is a prerelease of the alpha channel, older than the final release', () => {
    expect(semver.valid(pkg.version)).toBe(pkg.version);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
    expect(semver.prerelease(pkg.version)?.[0]).toBe(UPDATE_CHANNEL);
    // 0.1.0-alpha.N < 0.1.0: the final release reaches the alpha users (a bare "0.1.0" alpha
    // would never be updated to it).
    const final = pkg.version.split('-')[0]!;
    expect(semver.gt(final, pkg.version)).toBe(true);
    const next = pkg.version.replace(/\d+$/, (n) => String(Number(n) + 1));
    expect(semver.gt(next, pkg.version)).toBe(true);
    expect(existsSync(fileURLToPath(new URL('../package.json', import.meta.url)))).toBe(true);
  });
});
