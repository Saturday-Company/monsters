import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { HolderProbes, StartTime } from '@monsters/shared/node';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireHomeLock,
  createCoreServices,
  ensureHome,
  HomeLockedError,
  AUTOMATIONS_DIR,
  LOCK_FILE,
  startCore,
  type CoreServer,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';

const cores: CoreServer[] = [];
afterEach(async () => {
  for (const c of cores.splice(0)) await c.close();
});

async function start(home: string) {
  const core = await startCore({ home, port: 0, env: {}, webDist: false });
  cores.push(core);
  return core;
}

// Each test starts one or two real cores (database, vault with git, HTTP
// server): ~0.4 s on a free runner, but a busy Windows runner took 3-6 s per
// start and close, past the default 5 s.
const CORE_TIMEOUT = { timeout: 30_000 };

describe('lock on MONSTERS_HOME', CORE_TIMEOUT, () => {
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'a start that fails after the server listens closes everything and frees the lock (F-M1)',
    async () => {
      const home = tempHome();
      const dir = join(home, AUTOMATIONS_DIR);
      mkdirSync(dir, { recursive: true });
      chmodSync(dir, 0o000);
      try {
        await expect(startCore({ home, port: 0, env: {}, webDist: false })).rejects.toThrow();
      } finally {
        chmodSync(dir, 0o755);
      }
      // No zombie: the lock is free and another core can start on the same home.
      const core = await start(home);
      expect(core.url).toMatch(/^http/);
    },
  );

  it('refuses a second core on the same home without touching the live one', async () => {
    const home = tempHome();
    const core = await start(home);
    const run = core.runs.startRun({ agent: 'titan', goal: 'tono?' });
    const q = core.hub.questions.create({
      agent: 'titan',
      runId: run.id,
      question: 'Che tono?',
      options: [
        { id: '1', label: 'Ironico' },
        { id: '2', label: 'Serio' },
      ],
      blocking: true,
    });
    const setupCode = readFileSync(core.paths.setupCode, 'utf8');
    const cliToken = readFileSync(core.paths.cliToken, 'utf8');

    const second = startCore({ home, port: 0, env: {}, webDist: false });
    await expect(second).rejects.toThrow(HomeLockedError);
    await expect(second).rejects.toThrow(/Monsters is already running on .*home/);
    expect(() => createCoreServices({ home })).toThrow(HomeLockedError);

    expect(core.hub.questions.get(q.id)?.status).toBe('open');
    expect(readFileSync(core.paths.setupCode, 'utf8')).toBe(setupCode);
    expect(readFileSync(core.paths.cliToken, 'utf8')).toBe(cliToken);
    expect(core.log.query({ type: 'run' }).map((e) => e.type === 'run' && e.data.status)).toEqual([
      'started',
    ]);
  });

  it('is released on close, so the next start works', async () => {
    const home = tempHome();
    const core = await start(home);
    expect(existsSync(join(home, LOCK_FILE))).toBe(true);
    await core.close();
    expect(existsSync(join(home, LOCK_FILE))).toBe(false);
    await start(home);
  });

  it('takes over a stale lock left by a core that is gone', async () => {
    const home = tempHome();
    ensureHome(home);
    const dead = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    const pid = dead.pid!;
    await new Promise((r) => dead.once('exit', r));
    writeFileSync(join(home, LOCK_FILE), JSON.stringify({ pid, start: 1, acquiredAt: 1 }));
    const core = await start(home);
    const lock = JSON.parse(readFileSync(join(home, LOCK_FILE), 'utf8')) as { pid: number };
    expect(lock.pid).toBe(process.pid);
    await core.close();

    // Unreadable lock: stale as well.
    writeFileSync(join(home, LOCK_FILE), 'garbage');
    await start(home);
  });

  it('refuses a lock held by another live process', async () => {
    const home = tempHome();
    ensureHome(home);
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
    });
    try {
      await new Promise((r) => other.once('spawn', r));
      writeFileSync(
        join(home, LOCK_FILE),
        JSON.stringify({ pid: other.pid, start: null, acquiredAt: 1 }),
      );
      await expect(start(home)).rejects.toThrow(new RegExp(`process ${other.pid}`));
      expect(existsSync(join(home, 'monsters.db'))).toBe(false);
    } finally {
      other.kill('SIGKILL');
    }
  });
});

/*
 * A lock whose process is gone, or whose pid was reused (macOS and Windows have no /proc), with
 * fake probes: what the system tells is injected, so every case runs on every system.
 */
describe('lock left behind: who holds it now', () => {
  const T0 = Date.UTC(2026, 9, 28, 9, 0, 0);
  const lockFile = (home: string) => join(home, LOCK_FILE);
  const readLockFile = (home: string) =>
    JSON.parse(readFileSync(lockFile(home), 'utf8')) as Record<string, unknown>;
  const probes = (
    over: { alive?: (pid: number) => boolean; boot?: string | null; start?: StartTime | null } = {},
  ): HolderProbes => ({
    exists: over.alive ?? (() => true),
    bootId: () => (over.boot === undefined ? 'boot-now' : over.boot),
    startOf: () => (over.start === undefined ? null : over.start),
  });
  const written = (home: string, lock: object) => {
    ensureHome(home);
    writeFileSync(lockFile(home), JSON.stringify(lock));
  };

  it('records the boot of the computer it was taken in', () => {
    const home = tempHome();
    ensureHome(home);
    const lock = acquireHomeLock(home, { pid: 201, start: 5, probes: probes({ boot: 'b-1' }) });
    expect(readLockFile(home)).toMatchObject({ pid: 201, start: 5, boot: 'b-1' });
    lock.release();
    expect(existsSync(lockFile(home))).toBe(false);
  });

  it('a lock from an earlier boot is taken over even if its pid is alive again', () => {
    const home = tempHome();
    written(home, { pid: 4242, start: 1, boot: 'boot-before', acquiredAt: T0 });
    const lock = acquireHomeLock(home, { pid: 201, probes: probes({ boot: 'boot-now' }) });
    expect(readLockFile(home)).toMatchObject({ pid: 201, boot: 'boot-now' });
    lock.release();
  });

  it('a reused pid is told by its start time: Linux ticks, macOS/Windows milliseconds', () => {
    for (const [lock, start] of [
      [
        { pid: 4242, start: 100, boot: null, acquiredAt: T0 },
        { value: 900, unit: 'ticks' },
      ],
      [
        { pid: 4242, start: T0, boot: null, acquiredAt: T0 },
        { value: T0 + 3_600_000, unit: 'ms' },
      ],
    ] as const) {
      const home = tempHome();
      written(home, lock);
      acquireHomeLock(home, { pid: 201, probes: probes({ start }) }).release();
      expect(existsSync(lockFile(home))).toBe(false);
    }
  });

  it('the core that took the lock, still running, keeps it', () => {
    for (const [lock, start] of [
      [
        { pid: 4242, start: 900, boot: 'boot-now', acquiredAt: T0 },
        { value: 900, unit: 'ticks' },
      ],
      [
        { pid: 4242, start: T0 - 800, boot: 'boot-now', acquiredAt: T0 },
        { value: T0 - 800, unit: 'ms' },
      ],
      // Nothing to compare (PowerShell blocked, no boot id): alive.
      [{ pid: 4242, start: null, boot: null, acquiredAt: T0 }, null],
    ] as const) {
      const home = tempHome();
      written(home, lock);
      expect(() => acquireHomeLock(home, { pid: 201, probes: probes({ start }) })).toThrow(
        new RegExp(`process 4242`),
      );
      // Untouched.
      expect(readLockFile(home)).toMatchObject({ pid: 4242 });
    }
  });

  it('a lock from an older core (no boot id, no time) is judged by its pid alone', () => {
    const home = tempHome();
    written(home, { pid: 4242 });
    expect(() => acquireHomeLock(home, { pid: 201, probes: probes() })).toThrow(HomeLockedError);
    acquireHomeLock(home, { pid: 201, probes: probes({ alive: () => false }) }).release();
  });

  it('two cores finding the same stale lock: one takes it, the other is refused', () => {
    const home = tempHome();
    written(home, { pid: 111, start: null, boot: null, acquiredAt: T0 });
    let other: unknown;
    let calls = 0;
    const a = acquireHomeLock(home, {
      pid: 201,
      probes: probes({
        alive: (pid) => {
          // The second look at the lock is the one inside the takeover: the other core comes now.
          if (pid === 111 && ++calls === 2) {
            try {
              acquireHomeLock(home, {
                pid: 202,
                probes: probes({ alive: (p) => p === 201 }),
                takeoverWaitMs: 0,
              });
            } catch (err) {
              other = err;
            }
          }
          return pid !== 111;
        },
      }),
    });
    expect(other).toBeInstanceOf(HomeLockedError);
    expect(readLockFile(home)).toMatchObject({ pid: 201 });
    expect(existsSync(`${lockFile(home)}.takeover`)).toBe(false);
    a.release();
  });

  it('a core that took the lock over just before is not undone', () => {
    const home = tempHome();
    written(home, { pid: 111, start: null, boot: null, acquiredAt: T0 });
    // While this one judges the stale lock, another core replaces it with its own.
    const live = JSON.stringify({ pid: 303, start: null, boot: null, acquiredAt: T0 + 1 });
    expect(() =>
      acquireHomeLock(home, {
        pid: 201,
        probes: probes({
          alive: (pid) => {
            if (pid === 111) writeFileSync(lockFile(home), live);
            return pid !== 111;
          },
        }),
      }),
    ).toThrow(/process 303/);
    expect(readLockFile(home)).toMatchObject({ pid: 303 });
  });

  it('a takeover abandoned by a core that died does not block the next one', () => {
    const home = tempHome();
    written(home, { pid: 111, start: null, boot: null, acquiredAt: T0 });
    const guard = `${lockFile(home)}.takeover`;
    mkdirSync(guard);
    // Fresh: someone is at it right now.
    expect(() =>
      acquireHomeLock(home, {
        pid: 201,
        probes: probes({ alive: (p) => p !== 111 }),
        takeoverWaitMs: 0,
      }),
    ).toThrow(HomeLockedError);
    // A minute old: abandoned.
    const old = new Date(Date.now() - 60_000);
    utimesSync(guard, old, old);
    acquireHomeLock(home, { pid: 201, probes: probes({ alive: (p) => p !== 111 }) }).release();
    expect(existsSync(guard)).toBe(false);
  });

  it('the lock appears with its content in it (never an empty file for another core to read)', () => {
    const home = tempHome();
    ensureHome(home);
    const lock = acquireHomeLock(home, { pid: 201, probes: probes() });
    expect(readLockFile(home)).toMatchObject({ pid: 201 });
    // No temporary file is left next to it.
    expect(readdirSync(home).filter((n) => n.startsWith(LOCK_FILE) && n !== LOCK_FILE)).toEqual([]);
    lock.release();
  });
});

describe('runs left open by a crashed core', CORE_TIMEOUT, () => {
  it('are closed with run aborted (restart) at the next start', async () => {
    const home = tempHome();
    const crashed = createCoreServices({ home });
    const run = crashed.runs.startRun({ agent: 'titan', goal: 'lavoro a metà' });
    const done = crashed.runs.startRun({ agent: 'rhea' });
    done.finish();
    // Crash: no shutdown, the run stays `started` in the log.
    crashed.db.close();
    crashed.lock.release();

    const core = await start(home);
    const runEvents = core.log
      .query({ type: 'run' })
      .flatMap((e) => (e.type === 'run' ? [{ runId: e.runId, ...e.data }] : []));
    expect(runEvents.filter((e) => e.runId === run.id)).toEqual([
      { runId: run.id, status: 'started', goal: 'lavoro a metà' },
      { runId: run.id, status: 'aborted', reason: 'restart' },
    ]);
    expect(runEvents.filter((e) => e.runId === done.id).map((e) => e.status)).toEqual([
      'started',
      'completed',
    ]);
    expect(core.log.openRuns()).toEqual([]);
  });
});
