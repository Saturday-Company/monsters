/*
 * Full CI for a release (D-147, D-152):
 *
 *   pnpm release:ci [--commit <rev>] [--no-probe] [--no-wait]           GitHub Actions (default)
 *   pnpm release:ci --local [--commit <rev>] [--no-probe] [--no-status]  this machine, the VM, the Mac
 *
 * Default (D-152): the full CI runs on GitHub Actions (the `full (linux|windows|macos)` jobs of
 * .github/workflows/ci.yml). For the commit (default HEAD, which must be on origin) the script
 * takes the workflow run of a push or a manual start; when there is none it starts one by hand
 * (`gh workflow run ci.yml --ref <branch>`, on a branch of origin whose head is the commit:
 * workflow_dispatch runs a branch, not a sha). Then it follows it (`gh run watch`), unless
 * `--no-wait`. A finished red run is reported with the command that re-runs its failed jobs.
 *
 * `--local`: the D-147 way, `ci:local`, `ci:windows` and `ci:mac` in sequence for the commit,
 * stopping at the first failure; the three runs write `ci-results/<date>-<sha>-<os>.json`, and at
 * the end (also on failure) the result is published as GitHub commit statuses
 * (scripts/ci-status.ts) when the commit is on origin; `--no-status` skips it. Mac exit 75 means
 * the Mac is off, unreachable or busy with another run: not a red of the code; switch it on and
 * run `pnpm release:ci --local` again (or just `pnpm ci:mac`).
 *
 * Both end with the probe of the harness tools, on this machine (D5 of the review of 19/10,
 * D-127): the real `claude` (and `codex`, when installed) is started as Monsters starts it, and
 * every built-in the run sees must be one it may run. No model request, a few seconds. Exit 3 =
 * no `claude` installed: reported, not a red. `--no-probe` skips it; standalone:
 * `node packages/core/test/fixtures/probe-harness-tools.ts`. Then the release gate is printed
 * (scripts/release-gate.ts: GitHub or local, per platform).
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitOnOrigin, publishStatuses } from './ci-status.ts';
import {
  checkGate,
  formatVerdict,
  type GateVerdict,
  originRepo,
  realRunner,
  resolveCommit,
  type Runner,
} from './release-gate.ts';

export interface CiStepPlan {
  id: 'linux' | 'windows' | 'macos' | 'probe';
  command: string;
  args: string[];
}

export const PROBE_FILE = 'packages/core/test/fixtures/probe-harness-tools.ts';
export const WORKFLOW_FILE = 'ci.yml';

/** Pure: the commands of a local release CI, in order. */
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
        'Switch it on and run `pnpm ci:mac` (or `pnpm release:ci --local`) again.',
    };
  }
  if (id === 'probe' && code === 3) {
    return { continue: true, message: 'probe: skipped, Claude Code is not installed (not a red)' };
  }
  return { continue: false, message: `${id}: FAILED (exit ${code ?? 'signal'})` };
}

// --- GitHub Actions (D-152) --------------------------------------------------------------------

/** A workflow run as `gh run list --json databaseId,event,status,conclusion,url` prints it. */
export interface ListedRun {
  databaseId: number;
  event: string;
  status: string;
  conclusion: string;
  url: string;
}

/** Pure: the run of a push or a manual start to use for the commit (gh lists newest first). */
export function pickRun(runs: ListedRun[]): ListedRun | null {
  const own = runs.filter((r) => r.event === 'push' || r.event === 'workflow_dispatch');
  return own.find((r) => r.status !== 'completed') ?? own[0] ?? null;
}

/**
 * Pure: a branch of origin whose head is `sha`, from `git ls-remote --heads origin` output
 * (main first), or null.
 */
export function branchAt(lsRemote: string, sha: string): string | null {
  const heads = lsRemote
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f[0] === sha && f[1]?.startsWith('refs/heads/'))
    .map((f) => (f[1] ?? '').slice('refs/heads/'.length));
  return heads.includes('main') ? 'main' : (heads[0] ?? null);
}

export type GithubPlan =
  | { kind: 'watch'; run: ListedRun }
  | { kind: 'red'; run: ListedRun }
  | { kind: 'start'; branch: string }
  | { kind: 'cannot'; message: string };

/** Pure: what to do on GitHub for the commit. */
export function planGithub(sha: string, runs: ListedRun[], lsRemote: string): GithubPlan {
  const run = pickRun(runs);
  if (run && (run.status !== 'completed' || run.conclusion === 'success')) {
    return { kind: 'watch', run };
  }
  if (run && run.conclusion !== 'cancelled') return { kind: 'red', run };
  const branch = branchAt(lsRemote, sha);
  if (branch) return { kind: 'start', branch };
  return {
    kind: 'cannot',
    message:
      `no full CI run on GitHub for ${sha.slice(0, 7)}, and no branch of origin has it as its ` +
      'head (a manual run starts a branch, not a commit): push a branch at it, or use --local',
  };
}

function listRuns(runner: Runner, repo: string, sha: string): ListedRun[] {
  const r = runner.run('gh', [
    'run',
    'list',
    '--repo',
    repo,
    '--workflow',
    WORKFLOW_FILE,
    '--commit',
    sha,
    '--limit',
    '20',
    '--json',
    'databaseId,event,status,conclusion,url',
  ]);
  if (r.code !== 0) throw new Error(`gh run list failed (exit ${r.code ?? 'signal'})`);
  return JSON.parse(r.stdout || '[]') as ListedRun[];
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function githubCi(o: {
  commit: string;
  root: string;
  wait: boolean;
  out: (l: string) => void;
}): Promise<number> {
  const runner = realRunner(o.root);
  const repo = originRepo(o.root);
  if (!commitOnOrigin(runner, repo, o.commit)) {
    o.out(`${o.commit.slice(0, 7)} is not on origin (${repo}): push it first.`);
    return 1;
  }
  const ls = runner.run('git', ['ls-remote', '--heads', 'origin']);
  const plan = planGithub(o.commit, listRuns(runner, repo, o.commit), ls.stdout);
  let run: ListedRun | null = null;
  if (plan.kind === 'cannot') {
    o.out(plan.message);
    return 1;
  }
  if (plan.kind === 'red') {
    o.out(
      `the full CI of ${o.commit.slice(0, 7)} on GitHub is red (${plan.run.conclusion}): ` +
        `${plan.run.url}\nfix it, or re-run the failed jobs: gh run rerun ${plan.run.databaseId} --failed`,
    );
    return 1;
  }
  if (plan.kind === 'watch') run = plan.run;
  else {
    o.out(`starting the full CI on GitHub: gh workflow run ${WORKFLOW_FILE} --ref ${plan.branch}`);
    const started = runner.run('gh', [
      'workflow',
      'run',
      WORKFLOW_FILE,
      '--repo',
      repo,
      '--ref',
      plan.branch,
    ]);
    if (started.code !== 0) {
      o.out('gh workflow run failed');
      return 1;
    }
    for (let i = 0; i < 30 && !run; i++) {
      await sleep(4000);
      run = pickRun(listRuns(runner, repo, o.commit));
    }
    if (!run) {
      o.out('the run did not show up on GitHub within two minutes: see the Actions page');
      return 1;
    }
  }
  o.out(`full CI on GitHub: ${run.url}`);
  if (!o.wait || run.status === 'completed') return 0;
  const watched = spawnSync(
    'gh',
    ['run', 'watch', String(run.databaseId), '--repo', repo, '--exit-status', '--interval', '30'],
    { cwd: o.root, stdio: 'inherit' },
  );
  return watched.status === 0 ? 0 : 1;
}

// --- main --------------------------------------------------------------------------------------

/** Publishes the verdict as commit statuses; never changes the exit code of the release CI. */
function postStatuses(verdict: GateVerdict, root: string): void {
  try {
    publishStatuses({
      verdict,
      repo: originRepo(root),
      dryRun: false,
      runner: realRunner(root),
      out: (l) => process.stdout.write(`${l}\n`),
    });
  } catch (err) {
    process.stdout.write(`ci:status: skipped (${err instanceof Error ? err.message : 'error'})\n`);
  }
}

function runProbe(root: string): boolean {
  const step = planReleaseCi('', true).find((s) => s.id === 'probe');
  if (!step) return true;
  process.stdout.write(`\n=== probe: ${step.command} ${step.args.join(' ')}\n`);
  const r = spawnSync(step.command, step.args, { cwd: root, stdio: 'inherit' });
  const outcome = interpretExit('probe', r.status);
  process.stdout.write(`${outcome.message}\n`);
  return outcome.continue;
}

const USAGE =
  'usage: pnpm release:ci [--commit <rev>] [--no-probe] [--no-wait]\n' +
  '       pnpm release:ci --local [--commit <rev>] [--no-probe] [--no-status]\n';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  let rev = 'HEAD';
  let probe = true;
  let status = true;
  let local = false;
  let wait = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--commit' && args[i + 1]) rev = args[++i] ?? rev;
    else if (args[i] === '--no-probe') probe = false;
    else if (args[i] === '--no-status') status = false;
    else if (args[i] === '--local') local = true;
    else if (args[i] === '--no-wait') wait = false;
    else {
      process.stderr.write(USAGE);
      return 2;
    }
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const commit = resolveCommit(rev, root);
  const out = (l: string) => process.stdout.write(`${l}\n`);
  out(`release:ci for ${commit} (${local ? 'local' : 'GitHub Actions'})`);

  if (!local) {
    const code = await githubCi({ commit, root, wait, out });
    if (code !== 0) return code;
    if (!wait) return 0;
    if (probe && !runProbe(root)) return 1;
    const verdict = checkGate(commit, { cwd: root });
    out(`\n${formatVerdict(verdict)}`);
    return verdict.ok ? 0 : 1;
  }

  for (const step of planReleaseCi(commit, false)) {
    out(`\n=== ${step.id}: ${step.command} ${step.args.join(' ')}`);
    const r = spawnSync(step.command, step.args, { cwd: root, stdio: 'inherit' });
    const outcome = interpretExit(step.id, r.status);
    out(outcome.message);
    if (!outcome.continue) {
      const failed = checkGate(commit, { mode: 'local', cwd: root });
      out(`\n${formatVerdict(failed)}`);
      if (status) postStatuses(failed, root);
      return r.status === 75 ? 75 : 1;
    }
  }
  if (probe && !runProbe(root)) {
    const failed = checkGate(commit, { mode: 'local', cwd: root });
    if (status) postStatuses(failed, root);
    return 1;
  }
  const verdict = checkGate(commit, { mode: 'local', cwd: root });
  out(`\n${formatVerdict(verdict)}`);
  if (status) postStatuses(verdict, root);
  return verdict.ok ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main();
