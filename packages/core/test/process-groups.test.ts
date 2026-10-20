import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCoreServices,
  ensureHome,
  homePaths,
  ProcessRegistry,
  type ControlScope,
  type CoreServices,
} from '../src/index.ts';
import { isPidRunning, tempHome, waitFor } from './helpers.ts';

const posix = process.platform !== 'win32';
const opened: CoreServices[] = [];
const strays: number[] = [];

afterEach(async () => {
  for (const s of opened.splice(0)) {
    await s.runs.shutdown();
    s.db.close();
  }
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone: that is the point of these tests.
    }
  }
});

// Background jobs of `sh` ignore SIGINT: a short grace keeps the SIGKILL tests fast.
function services(home = tempHome(), killGraceMs = 300) {
  const s = createCoreServices({ home, killGraceMs });
  opened.push(s);
  return s;
}

/**
 * Spawns `sh -c "sleep 60 & echo $!; exit 0"`: the leader exits at once and
 * leaves a grandchild in its process group. Resolves with the grandchild pid
 * once the leader has exited.
 */
async function orphanedGrandchild(scope: ControlScope): Promise<number> {
  const leader = scope.spawn('sh', ['-c', 'sleep 60 & echo $!; exit 0'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let out = '';
  leader.stdout?.on('data', (c: Buffer) => (out += c.toString()));
  await new Promise((r) => leader.once('exit', r));
  const pid = Number(out.trim());
  strays.push(pid);
  expect(isPidRunning(pid)).toBe(true);
  return pid;
}

function exitOf(child: ChildProcess): Promise<void> {
  return new Promise((r) => {
    if (child.exitCode !== null || child.signalCode !== null) r();
    else child.once('exit', () => r());
  });
}

describe.skipIf(!posix)('kill switch and process groups', () => {
  it('kills a grandchild whose group leader has already exited', async () => {
    const { runs } = services();
    const run = runs.startRun({ agent: 'titan' });
    const grandchild = await orphanedGrandchild(run.toolCall('shell-1'));

    // The leader is gone but its group is still alive: it is still counted.
    expect(runs.activeRuns()[0]?.processes).toBe(1);
    const report = await runs.kill({ by: 'cli' });
    expect(report.processesKilled).toBe(1);
    await waitFor(() => !isPidRunning(grandchild), 2000);
  });

  it('terminates the processes of a run closed with finish()', async () => {
    const { runs } = services();
    const run = runs.startRun({ agent: 'titan' });
    const child = run.spawn('sleep', ['60'], { stdio: 'ignore' });
    strays.push(child.pid ?? -1);
    const grandchild = await orphanedGrandchild(run.agent('rhea').toolCall('c1'));
    const exited = exitOf(child);

    run.finish('completed');
    await run.settled;
    await exited;
    expect(isPidRunning(child.pid ?? -1)).toBe(false);
    await waitFor(() => !isPidRunning(grandchild), 2000);
    expect(runs.activeRuns()).toHaveLength(0);
  });

  it('keeps a finished run attached to the kill switch while its processes are alive', async () => {
    const { runs } = services(tempHome(), 1000);
    const run = runs.startRun({ agent: 'titan' });
    const child = run.spawn(
      process.execPath,
      ['-e', "process.on('SIGINT', () => {}); setInterval(() => {}, 1000)"],
      { stdio: 'ignore' },
    );
    strays.push(child.pid ?? -1);
    await new Promise((r) => child.once('spawn', r));
    await sleep(200); // let the child install its SIGINT handler
    const exited = exitOf(child);

    run.finish('completed');
    expect(runs.activeRuns()).toHaveLength(0);
    // The kill switch still sees (and stops) the process of the finished run.
    const t0 = performance.now();
    const killed = runs.kill({ by: 'ui' });
    await exited;
    expect((await killed).processesKilled).toBe(1);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(isPidRunning(child.pid ?? -1)).toBe(false);
  });

  it('records spawned process groups on disk and forgets them once gone', async () => {
    const home = tempHome();
    const { runs } = services(home);
    const registry = new ProcessRegistry(homePaths(home).processGroups);
    const run = runs.startRun({ agent: 'titan' });
    const child = run.spawn('sleep', ['60'], { stdio: 'ignore' });
    strays.push(child.pid ?? -1);
    expect(registry.list().map((g) => g.pgid)).toEqual([child.pid]);
    await runs.kill({ by: 'cli' });
    expect(registry.list()).toEqual([]);
  });

  it('terminates orphan process groups left by a crashed core at the next start', async () => {
    const home = tempHome();
    const fixture = fileURLToPath(new URL('./fixtures/crash-core.ts', import.meta.url));
    const crashed = spawn(process.execPath, [fixture, home], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    crashed.stdout.on('data', (c: Buffer) => (out += c.toString()));
    const signal = await new Promise<NodeJS.Signals | null>((r) =>
      crashed.once('exit', (_code, s) => r(s)),
    );
    expect(signal).toBe('SIGKILL');
    const pids = JSON.parse(out.trim()) as { sleeper: number; grandchild: number };
    strays.push(pids.sleeper, pids.grandchild);
    // The core died without cleaning up: its children are still running.
    expect(isPidRunning(pids.sleeper)).toBe(true);
    expect(isPidRunning(pids.grandchild)).toBe(true);
    expect(existsSync(homePaths(home).processGroups)).toBe(true);

    const s = services(home);
    await waitFor(() => !isPidRunning(pids.sleeper) && !isPidRunning(pids.grandchild), 2000);
    expect(new ProcessRegistry(homePaths(home).processGroups).list()).toEqual([]);
    const errors = s.log.query({ type: 'error' });
    expect(errors.map((e) => (e.type === 'error' ? e.data.code : ''))).toContain(
      'orphan_processes',
    );
  });

  it('does not kill a process group whose id was reused by someone else', () => {
    const home = tempHome();
    ensureHome(home);
    const path = homePaths(home).processGroups;
    // An unrelated process group (not spawned by any core).
    const other = spawn('sleep', ['60'], { stdio: 'ignore', detached: true });
    strays.push(other.pid ?? -1);
    const registry = new ProcessRegistry(path);
    const stale = registry.record(other.pid ?? -1, 1);
    // Recorded by a core that is gone, with another leader start time.
    registry.add({ ...stale, ownerPid: 2 ** 22 + 1, ownerStart: 1 });

    const report = new ProcessRegistry(path).reapOrphans();
    expect(report.killed).toEqual([]);
    expect(isPidRunning(other.pid ?? -1)).toBe(true);
    expect(registry.list()).toEqual([]);
  });
});
