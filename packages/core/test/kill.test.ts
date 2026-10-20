import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCoreServices,
  HaltedError,
  RunController,
  startCore,
  type CoreServer,
  type CoreServices,
  type ControlScope,
} from '../src/index.ts';
import { isPidAlive, tempHome } from './helpers.ts';

const posix = process.platform !== 'win32';
const opened: CoreServices[] = [];
let core: CoreServer | undefined;

afterEach(async () => {
  await core?.close();
  core = undefined;
  for (const s of opened.splice(0)) s.db.close();
});

function services(home = tempHome(), killGraceMs = 1500) {
  const s = createCoreServices({ home, killGraceMs });
  opened.push(s);
  return s;
}

/** A long-running child: `sleep 60` (node equivalent on Windows). */
function spawnSleeper(scope: ControlScope) {
  return posix
    ? scope.spawn('sleep', ['60'], { stdio: 'ignore' })
    : scope.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
}

/** A fake tool call: waits up to 60 s unless its scope is aborted. */
function pendingCall(scope: ControlScope) {
  return sleep(60_000, undefined, { signal: scope.signal });
}

describe('kill switch', () => {
  it('stops a run with 3 pending calls and a child process in under 2 s, then refuses new runs until resume', async () => {
    const home = tempHome();
    const { runs, log, state } = services(home);

    const run = runs.startRun({ agent: 'titan', goal: 'fake run' });
    const rhea = run.agent('rhea');
    const dione = run.agent('dione');
    const calls = [
      pendingCall(rhea.toolCall('c1')),
      pendingCall(rhea.toolCall('c2')),
      pendingCall(dione.toolCall('c3')),
    ];
    const settled = Promise.allSettled(calls);
    const child = spawnSleeper(dione.toolCall('shell-1'));
    await new Promise((r) => child.once('spawn', r));
    const pid = child.pid ?? -1;
    const exited = new Promise<void>((r) => child.once('exit', () => r()));
    expect(isPidAlive(pid)).toBe(true);
    expect(runs.activeRuns()[0]).toMatchObject({ pendingCalls: 4, processes: 1 });

    const t0 = performance.now();
    const report = await runs.kill({ by: 'cli', reason: 'test' });
    const results = await settled;
    await exited;
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(2000);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    for (const r of results) {
      if (r.status === 'rejected') expect((r.reason as Error).name).toBe('AbortError');
    }
    expect(isPidAlive(pid)).toBe(false);
    expect(report).toMatchObject({ runsAborted: 1, processesKilled: 1 });
    expect(run.aborted && rhea.aborted && dione.aborted).toBe(true);

    // Halted: nothing new starts, even across a restart (state is persisted).
    expect(runs.halted).toBe(true);
    expect(() => runs.startRun({ agent: 'titan' })).toThrow(HaltedError);
    const reloaded = new RunController({ log, state });
    expect(reloaded.halted).toBe(true);
    expect(() => reloaded.startRun({ agent: 'titan' })).toThrow(HaltedError);

    // Events: run started, kill, run aborted, then resume.
    expect(runs.resume({ by: 'cli' })).toBe(true);
    expect(runs.resume({ by: 'cli' })).toBe(false);
    const types = log.query({ type: ['run', 'kill', 'resume'] }).map((e) => {
      if (e.type === 'run') return `run:${e.data.status}`;
      return e.type;
    });
    expect(types).toEqual(['run:started', 'kill', 'run:aborted', 'resume']);

    const next = runs.startRun({ agent: 'titan' });
    expect(next.aborted).toBe(false);
    next.finish();
    expect(runs.activeRuns()).toHaveLength(0);
  });

  // On Windows there is no SIGINT to ignore: the first step already ends the
  // tree with `taskkill /T /F` (TerminateProcess, exit code 1, no signal).
  it('SIGKILLs a process that ignores SIGINT after the grace period', async () => {
    const { runs } = services(tempHome(), 300);
    const run = runs.startRun({ agent: 'titan' });
    const child = run.spawn(
      process.execPath,
      ['-e', "process.on('SIGINT', () => {}); setInterval(() => {}, 1000)"],
      { stdio: 'ignore' },
    );
    await new Promise((r) => child.once('spawn', r));
    await sleep(200); // let the child install its SIGINT handler
    const pid = child.pid ?? -1;
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) =>
      child.once('exit', (code, signal) => r({ code, signal })),
    );
    const t0 = performance.now();
    await runs.kill({ by: 'system' });
    expect(await exit).toEqual(
      posix ? { code: null, signal: 'SIGKILL' } : { code: 1, signal: null },
    );
    expect(isPidAlive(pid)).toBe(false);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('creates new scopes already aborted once their parent is stopped', async () => {
    const { runs } = services();
    const run = runs.startRun({ agent: 'titan' });
    await runs.killRun(run.id, { by: 'ui' });
    expect(runs.halted).toBe(false);
    const late = run.agent('rhea').toolCall('late');
    expect(late.aborted).toBe(true);
    expect(() => late.throwIfAborted()).toThrow();
  });

  it('runs kill hooks (e.g. to flush queues)', async () => {
    const { runs } = services();
    const reasons: (string | undefined)[] = [];
    runs.onKill((r) => {
      reasons.push(r);
    });
    await runs.kill({ by: 'ui', reason: 'stop' });
    expect(reasons).toEqual(['stop']);
  });

  it('works end to end over HTTP: kill, status, rejected run, resume', async () => {
    core = await startCore({ home: tempHome(), port: 0 });
    const token = readFileSync(core.paths.cliToken, 'utf8').trim();
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const run = core.runs.startRun({ agent: 'titan' });
    const call = pendingCall(run.toolCall('c1')).then(
      () => 'resolved',
      (err: unknown) => (err as Error).name,
    );

    const killed = await fetch(`${core.url}/api/kill`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ reason: 'from test' }),
    });
    expect(killed.status).toBe(200);
    expect(await killed.json()).toMatchObject({ halted: true, haltedReason: 'from test' });
    expect(await call).toBe('AbortError');
    expect(() => core?.runs.startRun({ agent: 'titan' })).toThrow(HaltedError);

    const kills = core.log.query({ type: 'kill' });
    expect(kills).toHaveLength(1);
    expect(kills[0]?.type === 'kill' && kills[0].data.by).toBe('cli');

    const resumed = await fetch(`${core.url}/api/resume`, { method: 'POST', headers: auth });
    expect(await resumed.json()).toMatchObject({ halted: false, resumed: true });
    const status = await fetch(`${core.url}/api/status`, { headers: auth });
    expect(await status.json()).toMatchObject({ halted: false, runs: [] });
    expect(core.log.query({ type: 'resume' })).toHaveLength(1);
  });
});
