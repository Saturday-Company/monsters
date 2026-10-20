/**
 * Simulates a core that crashes while agents are running processes: starts a
 * run, spawns a child and a grandchild whose leader exits, prints their pids
 * and kills itself with SIGKILL (no cleanup runs).
 *
 * Usage: node crash-core.ts <home>
 */
import { createCoreServices } from '../../src/index.ts';

const home = process.argv[2];
if (!home) throw new Error('usage: crash-core.ts <home>');

const services = createCoreServices({ home });
const run = services.runs.startRun({ agent: 'titan', goal: 'crash test' });

const sleeper = run.spawn('sleep', ['60'], { stdio: 'ignore' });
const leader = run.spawn('sh', ['-c', 'sleep 60 & echo $!; exit 0'], {
  stdio: ['ignore', 'pipe', 'ignore'],
});

let out = '';
leader.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString()));
leader.once('exit', () => {
  const grandchild = Number(out.trim());
  process.stdout.write(`${JSON.stringify({ sleeper: sleeper.pid, grandchild })}\n`, () => {
    process.kill(process.pid, 'SIGKILL');
  });
});
