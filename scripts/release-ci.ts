/*
 * Full CI for a release (D-147): `pnpm release:ci [--commit <rev>] [--no-probe]`.
 *
 * Runs `ci:local`, `ci:windows` and `ci:mac` in sequence for the commit (default HEAD), stopping at
 * the first failure, then the probe of the harness tools, and prints the release gate
 * (scripts/release-gate.ts). The three runs write `ci-results/<date>-<sha>-<os>.json`.
 *
 * Mac exit 75 means the Mac is off, unreachable or busy with another run: not a red of the code;
 * switch it on and run `pnpm release:ci` again (or just `pnpm ci:mac`).
 *
 * The probe (D5 of the review of 19/10, D-127): in this checkout, the real `claude` (and `codex`,
 * when installed) is started as Monsters starts it, and every built-in the run sees must be one it
 * may run. No model request, a few seconds. Exit 3 = no `claude` installed: reported, not a red.
 * `--no-probe` skips it; standalone: `node packages/core/test/fixtures/probe-harness-tools.ts`.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReleaseGate, formatVerdict, resolveCommit, resultsDir } from './release-gate.ts';

export interface CiStepPlan {
  id: 'linux' | 'windows' | 'macos' | 'probe';
  command: string;
  args: string[];
}

export const PROBE_FILE = 'packages/core/test/fixtures/probe-harness-tools.ts';

/** Pure: the commands of a release CI, in order. */
export function planReleaseCi(commit: string, probe = true): CiStepPlan[] {
  const plan: CiStepPlan[] = [
    { id: 'linux', command: 'pnpm', args: ['-s', 'ci:local', '--commit', commit] },
    { id: 'windows', command: 'pnpm', args: ['-s', 'ci:windows', '--commit', commit] },
    { id: 'macos', command: 'pnpm', args: ['-s', 'ci:mac', '--commit', commit] },
  ];
  if (probe) plan.push({ id: 'probe', command: 'pnpm', args: ['exec', 'node', PROBE_FILE] });
  return plan;
}

export interface StepOutcome {
  /** Keep going after this step? */
  continue: boolean;
  message: string;
}

/** Pure: what an exit code means for a step. */
export function interpretExit(id: CiStepPlan['id'], code: number | null): StepOutcome {
  if (code === 0) return { continue: true, message: `${id}: ok` };
  if (id === 'macos' && code === 75) {
    return {
      continue: false,
      message:
        'macos: exit 75, the Mac is off, unreachable or busy with another run (not a red of the code). ' +
        'Switch it on and run `pnpm ci:mac` (or `pnpm release:ci`) again.',
    };
  }
  if (id === 'probe' && code === 3) {
    return { continue: true, message: 'probe: skipped, Claude Code is not installed (not a red)' };
  }
  return { continue: false, message: `${id}: FAILED (exit ${code ?? 'signal'})` };
}

function main(): number {
  const args = process.argv.slice(2);
  let rev = 'HEAD';
  let probe = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--commit' && args[i + 1]) rev = args[++i] ?? rev;
    else if (args[i] === '--no-probe') probe = false;
    else {
      process.stderr.write('usage: pnpm release:ci [--commit <rev>] [--no-probe]\n');
      return 2;
    }
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const commit = resolveCommit(rev, root);
  process.stdout.write(`release:ci for ${commit}\n`);
  for (const step of planReleaseCi(commit, probe)) {
    process.stdout.write(`\n=== ${step.id}: ${step.command} ${step.args.join(' ')}\n`);
    const r = spawnSync(step.command, step.args, { cwd: root, stdio: 'inherit' });
    const outcome = interpretExit(step.id, r.status);
    process.stdout.write(`${outcome.message}\n`);
    if (!outcome.continue) {
      process.stdout.write(`\n${formatVerdict(checkReleaseGate(commit, resultsDir()))}\n`);
      return r.status === 75 ? 75 : 1;
    }
  }
  const verdict = checkReleaseGate(commit, resultsDir());
  process.stdout.write(`\n${formatVerdict(verdict)}\n`);
  return verdict.ok ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();
