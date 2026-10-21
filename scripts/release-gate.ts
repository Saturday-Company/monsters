/*
 * Release gate (D-147, D-152): a release goes out only if the full CI passed on the exact commit
 * being released, on Linux, Windows and macOS.
 *
 *   pnpm release:check [--commit <rev>] [--results <folder>] [--source auto|github|local]
 *
 * Prints the status of the three platforms for the commit (default HEAD) and exits 0 when the gate
 * is open, 1 when it is closed. `pnpm release:ci` produces what is missing;
 * `apps/desktop/scripts/publish-update.ts` refuses to publish while the gate is closed
 * (`--skip-ci-gate` overrides it).
 *
 * Two sources, per platform (`auto`, the default: a platform counts when either has it green;
 * MONSTERS_CI_GATE=github|local, or --source, keeps one):
 *
 * - GitHub (D-152): the check run `full (<platform>)` of the commit (`gh api
 *   repos/<owner>/<repo>/commits/<sha>/check-runs`), concluded `success`, made by GitHub Actions
 *   in a workflow run of `.github/workflows/ci.yml` started by a push or by hand
 *   (workflow_dispatch) in this same repository. A pull request's run never counts: a fork's PR
 *   runs the workflow file of the fork, which can name a job anything.
 * - Local (D-147): `ci-results/` holds a result (format `CiResult`, scripts/ci-local.ts) that is
 *   for the full hash of the commit, `mode: full`, `status: passed`, not run on a dirty checkout,
 *   with every step passed or skipped, and with the `package` step passed: a green `--quick` or
 *   `--no-package` run proves less than a release needs.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLATFORMS = ['linux', 'windows', 'macos'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** The part of `CiResult` (scripts/ci-local.ts) the gate reads. */
export interface GateResult {
  schema?: string;
  platform?: string;
  commit?: string;
  dirty?: boolean;
  mode?: string;
  status?: string;
  failedStep?: string | null;
  startedAt?: string;
  log?: string;
  durationMs?: number | null;
  steps?: { id: string; status: string; note?: string }[];
}

export interface PlatformVerdict {
  platform: Platform;
  ok: boolean;
  /** Where the green comes from (or, when not ok, which source the detail is about first). */
  source?: GateSource;
  /** GitHub: the job's page. */
  url?: string;
  /** One line: what is there, or what is missing and what to run. */
  detail: string;
  /** The log of the result that makes it pass (or the latest one that does not). */
  log?: string;
  /** The result that decides the verdict (the passing one, or the latest for the commit). */
  result?: GateResult;
}

export interface GateVerdict {
  commit: string;
  ok: boolean;
  platforms: PlatformVerdict[];
}

export type GateSource = 'github' | 'local';
export type GateMode = 'auto' | GateSource;

const COMMAND: Record<Platform, string> = {
  linux: 'pnpm ci:local',
  windows: 'pnpm ci:windows',
  macos: 'pnpm ci:mac',
};

/** Why a result of this commit and platform does not count, or null if it does. */
export function whyNotCounted(r: GateResult): string | null {
  if (r.status === 'running') return 'a run still in progress';
  if (r.status === 'interrupted') return 'a run that was interrupted';
  if (r.status === 'failed') return `red at step \`${r.failedStep ?? '?'}\``;
  if (r.status !== 'passed') return `status \`${String(r.status)}\``;
  if (r.dirty) return 'run on a checkout with uncommitted changes';
  if (r.mode !== 'full') return `a \`${r.mode ?? 'quick'}\` run (needs a full one)`;
  const pkg = (r.steps ?? []).find((s) => s.id === 'package');
  if (!pkg) return 'no `package` step in the result';
  if (pkg.status !== 'passed') {
    return `\`package\` step ${pkg.status}${pkg.note ? ` (${pkg.note})` : ''}`;
  }
  const bad = (r.steps ?? []).find((s) => s.status === 'failed' || s.status === 'not-run');
  if (bad) return `step \`${bad.id}\` is ${bad.status}`;
  return null;
}

/** Pure: decides the gate for `commit` (full hash) from already parsed results. */
export function evaluateGate(commit: string, results: GateResult[]): GateVerdict {
  const platforms = PLATFORMS.map((platform): PlatformVerdict => {
    const mine = results
      .filter((r) => r.schema === 'monsters-ci/1' && r.platform === platform)
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
    const forCommit = mine.filter((r) => r.commit === commit);
    const good = forCommit.find((r) => whyNotCounted(r) === null);
    if (good) {
      return {
        platform,
        ok: true,
        source: 'local',
        detail: 'full run passed',
        log: good.log,
        result: good,
      };
    }
    const run = `run \`${COMMAND[platform]} --commit ${commit.slice(0, 7)}\``;
    const latest = forCommit[0];
    if (latest) {
      return {
        platform,
        ok: false,
        source: 'local',
        detail: `${whyNotCounted(latest)}: ${run}`,
        log: latest.log,
        result: latest,
      };
    }
    const other = mine[0];
    const seen = other?.commit ? ` (the latest result is for ${other.commit.slice(0, 7)})` : '';
    return {
      platform,
      ok: false,
      source: 'local',
      detail: `no result for this commit${seen}: ${run}`,
    };
  });
  return { commit, ok: platforms.every((p) => p.ok), platforms };
}

/** Reads every `*.json` of the results folder that looks like a CI result; others are ignored. */
export function loadResults(dir: string): GateResult[] {
  if (!existsSync(dir)) return [];
  const out: GateResult[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const r = JSON.parse(readFileSync(join(dir, name), 'utf8')) as GateResult;
      if (r && r.schema === 'monsters-ci/1') out.push(r);
    } catch {
      // A half-written or foreign file is not a result.
    }
  }
  return out;
}

export function checkReleaseGate(commit: string, dir: string): GateVerdict {
  return evaluateGate(commit, loadResults(dir));
}

// --- GitHub (D-152) ----------------------------------------------------------------------------

/** The jobs of `.github/workflows/ci.yml` that run the full CI: their check runs open the gate. */
export const GITHUB_JOBS: Record<Platform, string> = {
  linux: 'full (linux)',
  windows: 'full (windows)',
  macos: 'full (macos)',
};
export const WORKFLOW_PATH = '.github/workflows/ci.yml';
/** Events whose runs use the workflow file of this repository's own branch. */
const TRUSTED_EVENTS = new Set(['push', 'workflow_dispatch']);

/** The part of a check run (GET /repos/{o}/{r}/commits/{sha}/check-runs) the gate reads. */
export interface CheckRun {
  id?: number;
  name: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  details_url?: string | null;
  html_url?: string | null;
  app?: { slug?: string } | null;
}

/** The part of a workflow run (GET /repos/{o}/{r}/actions/runs/{id}) the gate reads. */
export interface WorkflowRun {
  id: number;
  event: string;
  path: string;
  head_sha: string;
  head_repository?: { full_name?: string } | null;
  html_url?: string;
}

export interface GithubData {
  repo: string;
  checkRuns: CheckRun[];
  /** Workflow runs by id, for the check runs that matter. */
  runs: Record<number, WorkflowRun>;
  /** Set when GitHub could not be read: every platform is then "unknown" on that side. */
  error?: string;
}

/** The workflow run id of an Actions check run, from its job URL (`/actions/runs/<id>/job/…`). */
export function workflowRunId(c: CheckRun): number | null {
  for (const url of [c.details_url, c.html_url]) {
    const m = url ? /\/actions\/runs\/(\d+)(?:\/|$)/.exec(url) : null;
    if (m) return Number(m[1]);
  }
  return null;
}

/** Why a workflow run cannot open the gate for `commit` in `repo`, or null if it can. */
export function whyRunNotTrusted(
  run: WorkflowRun | undefined,
  commit: string,
  repo: string,
): string | null {
  if (!run) return 'its workflow run could not be read';
  if (run.head_sha !== commit) return 'its workflow run is for another commit';
  if (run.path.replace(/@.*$/, '') !== WORKFLOW_PATH) return `workflow ${run.path}`;
  if (!TRUSTED_EVENTS.has(run.event)) return `started by \`${run.event}\` (needs push or by hand)`;
  const from = run.head_repository?.full_name ?? '';
  if (from.toLowerCase() !== repo.toLowerCase()) return `run from ${from || 'another repository'}`;
  return null;
}

function minutes(c: CheckRun): string {
  const a = Date.parse(c.started_at ?? '');
  const b = Date.parse(c.completed_at ?? '');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '';
  const s = Math.round((b - a) / 1000);
  return `, ${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/** Pure: the GitHub side of the gate for `commit`, one verdict per platform. */
export function evaluateGithub(commit: string, data: GithubData): PlatformVerdict[] {
  return PLATFORMS.map((platform): PlatformVerdict => {
    const job = GITHUB_JOBS[platform];
    if (data.error) {
      return { platform, ok: false, source: 'github', detail: `GitHub not read (${data.error})` };
    }
    const mine = data.checkRuns
      .filter((c) => c.name === job && c.head_sha === commit && c.app?.slug === 'github-actions')
      .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''));
    const trusted = mine.filter(
      (c) => whyRunNotTrusted(data.runs[workflowRunId(c) ?? -1], commit, data.repo) === null,
    );
    const url = (c: CheckRun) => c.html_url ?? c.details_url ?? undefined;
    const green = trusted.find((c) => c.status === 'completed' && c.conclusion === 'success');
    if (green) {
      return {
        platform,
        ok: true,
        source: 'github',
        detail: `\`${job}\` green on GitHub Actions${minutes(green)}`,
        url: url(green),
      };
    }
    const latest = trusted[0];
    if (latest) {
      const state =
        latest.status === 'completed'
          ? `concluded \`${latest.conclusion ?? '?'}\``
          : `still ${latest.status.replace('_', ' ')}`;
      return {
        platform,
        ok: false,
        source: 'github',
        detail: `\`${job}\` ${state} on GitHub Actions`,
        url: url(latest),
      };
    }
    const untrusted = mine[0];
    const why = untrusted
      ? ` (one exists, but ${whyRunNotTrusted(data.runs[workflowRunId(untrusted) ?? -1], commit, data.repo)})`
      : '';
    return {
      platform,
      ok: false,
      source: 'github',
      detail: `no \`${job}\` of a push or a manual run on GitHub${why}`,
    };
  });
}

/**
 * Pure: the gate from both sources. `auto`: per platform, GitHub green or local green; `github`
 * or `local`: that source only. A closed platform explains both sides in `auto`.
 */
export function combineGate(
  commit: string,
  o: { mode: GateMode; local: GateResult[]; github?: GithubData },
): GateVerdict {
  const local = evaluateGate(commit, o.local).platforms;
  const gh = o.github
    ? evaluateGithub(commit, o.github)
    : PLATFORMS.map((platform): PlatformVerdict => ({
        platform,
        ok: false,
        source: 'github',
        detail: 'GitHub not read',
      }));
  const platforms = PLATFORMS.map((p, i): PlatformVerdict => {
    const g = gh[i] as PlatformVerdict;
    const l = local[i] as PlatformVerdict;
    if (o.mode === 'github') return g;
    if (o.mode === 'local') return l;
    if (g.ok) return g;
    if (l.ok) return l;
    return { ...g, detail: `${g.detail}; local: ${l.detail}`, log: l.log, result: l.result };
  });
  return { commit, ok: platforms.every((p) => p.ok), platforms };
}

/** Runs a command, returns its exit code and stdout (injected in tests). */
export interface Runner {
  run(cmd: string, args: string[]): { code: number | null; stdout: string };
}

export function realRunner(cwd: string): Runner {
  return {
    run(cmd, args) {
      const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      return { code: r.status, stdout: r.stdout ?? '' };
    },
  };
}

export const DEFAULT_REPO = 'Saturday-Company/monsters';

/** Pure: `owner/repo` from a git remote URL (https or ssh), or the default. */
export function parseRepo(remoteUrl: string): string {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
  return m ? `${m[1]}/${m[2]}` : DEFAULT_REPO;
}

/** `owner/repo` of `origin` in the checkout at `cwd`. */
export function originRepo(cwd: string): string {
  try {
    return parseRepo(
      execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' }),
    );
  } catch {
    return DEFAULT_REPO;
  }
}

/** Reads the check runs of the commit and the workflow runs behind the full jobs, with `gh`. */
export function fetchGithub(repo: string, commit: string, runner: Runner): GithubData {
  const list = runner.run('gh', [
    'api',
    `repos/${repo}/commits/${commit}/check-runs?per_page=100&filter=all`,
  ]);
  if (list.code !== 0) {
    return { repo, checkRuns: [], runs: {}, error: `gh api exit ${list.code ?? 'signal'}` };
  }
  let checkRuns: CheckRun[];
  try {
    checkRuns = (JSON.parse(list.stdout) as { check_runs?: CheckRun[] }).check_runs ?? [];
  } catch {
    return { repo, checkRuns: [], runs: {}, error: 'unreadable answer' };
  }
  const names = new Set(Object.values(GITHUB_JOBS));
  const ids = new Set(
    checkRuns
      .filter((c) => names.has(c.name))
      .map(workflowRunId)
      .filter((id): id is number => id !== null),
  );
  const runs: Record<number, WorkflowRun> = {};
  for (const id of ids) {
    const r = runner.run('gh', ['api', `repos/${repo}/actions/runs/${id}`]);
    if (r.code !== 0) continue;
    try {
      runs[id] = JSON.parse(r.stdout) as WorkflowRun;
    } catch {
      // Left out: its check runs do not count.
    }
  }
  return { repo, checkRuns, runs };
}

/** The gate source chosen by MONSTERS_CI_GATE (auto, github or local; default auto). */
export function gateModeFromEnv(env: NodeJS.ProcessEnv = process.env): GateMode {
  const v = (env['MONSTERS_CI_GATE'] ?? '').trim().toLowerCase();
  if (v === '' || v === 'auto') return 'auto';
  if (v === 'github' || v === 'local') return v;
  throw new Error(`MONSTERS_CI_GATE=${v}: use auto, github or local`);
}

/** The gate for a commit from both sources (GitHub read with `gh`, unless mode is local). */
export function checkGate(
  commit: string,
  o: { mode?: GateMode; dir?: string; cwd?: string; runner?: Runner } = {},
): GateVerdict {
  const mode = o.mode ?? gateModeFromEnv();
  const cwd = o.cwd ?? ROOT;
  const local = loadResults(o.dir ?? resultsDir());
  const github =
    mode === 'local'
      ? undefined
      : fetchGithub(originRepo(cwd), commit, o.runner ?? realRunner(cwd));
  return combineGate(commit, { mode, local, github });
}

export function formatVerdict(v: GateVerdict): string {
  const lines = [`Release gate for ${v.commit.slice(0, 7)}: ${v.ok ? 'OPEN' : 'CLOSED'}`];
  for (const p of v.platforms) {
    const from = p.ok && p.source ? ` (${p.source})` : '';
    lines.push(`  ${p.ok ? 'ok     ' : 'MISSING'} ${p.platform.padEnd(8)} ${p.detail}${from}`);
    if (p.url) lines.push(`          ${' '.repeat(8)} ${p.url}`);
  }
  if (!v.ok) lines.push('Run `pnpm release:ci` to produce what is missing.');
  return lines.join('\n');
}

export interface GateDecision {
  proceed: boolean;
  /** Lines to print, in order. */
  messages: string[];
}

/** Pure: what a publishing script does given the verdict and the flags. */
export function gateDecision(o: {
  verdict: GateVerdict;
  skip: boolean;
  /** Dry runs upload nothing: the gate is reported but never blocks. */
  dryRun?: boolean;
}): GateDecision {
  const text = formatVerdict(o.verdict);
  if (o.verdict.ok) return { proceed: true, messages: [text] };
  if (o.skip) {
    return {
      proceed: true,
      messages: [
        text,
        '!!! WARNING: --skip-ci-gate: publishing WITHOUT a full CI on all three systems. !!!',
        '!!! The release gate (D-147) exists for this; do it only on purpose.            !!!',
      ],
    };
  }
  if (o.dryRun) return { proceed: true, messages: [text, '(dry run: the gate does not block)'] };
  return {
    proceed: false,
    messages: [text, 'Refusing to publish. Fix the above, or pass --skip-ci-gate to override.'],
  };
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function resultsDir(): string {
  return process.env.MONSTERS_CI_RESULTS ?? join(ROOT, 'ci-results');
}

export function resolveCommit(rev: string, cwd = ROOT): string {
  return execFileSync('git', ['rev-parse', '--verify', `${rev}^{commit}`], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

const USAGE =
  'usage: pnpm release:check [--commit <rev>] [--results <folder>] [--source auto|github|local]\n';

function main(): number {
  const args = process.argv.slice(2);
  let rev = 'HEAD';
  let dir = resultsDir();
  let mode: GateMode;
  try {
    mode = gateModeFromEnv();
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }
  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1];
    if (args[i] === '--commit' && next) rev = args[++i] ?? rev;
    else if (args[i] === '--results' && next) dir = resolve(args[++i] ?? dir);
    else if (args[i] === '--source' && (next === 'auto' || next === 'github' || next === 'local')) {
      mode = next;
      i++;
    } else {
      process.stderr.write(USAGE);
      return 2;
    }
  }
  const verdict = checkGate(resolveCommit(rev), { mode, dir });
  process.stdout.write(`${formatVerdict(verdict)}\n`);
  return verdict.ok ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();
