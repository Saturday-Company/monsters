import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
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
    await expect(second).rejects.toThrow(/Monsters è già in esecuzione su .*home/);
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
      await expect(start(home)).rejects.toThrow(new RegExp(`processo ${other.pid}`));
      expect(existsSync(join(home, 'monsters.db'))).toBe(false);
    } finally {
      other.kill('SIGKILL');
    }
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
