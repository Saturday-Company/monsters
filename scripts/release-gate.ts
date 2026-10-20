/*
 * Release gate (D-147): a release goes out only if the full local CI passed on the exact commit
 * being released, on Linux, Windows and macOS.
 *
 *   pnpm release:check [--commit <rev>] [--results <folder>]
 *
 * Prints the status of the three platforms for the commit (default HEAD) and exits 0 when the gate
 * is open, 1 when it is closed. `pnpm release:ci` produces the results; `apps/desktop/scripts/
 * publish-update.ts` refuses to publish while the gate is closed (`--skip-ci-gate` overrides it).
 *
 * A platform counts when `ci-results/` holds a result (format `CiResult`, scripts/ci-local.ts)
 * that is for the full hash of the commit, `mode: full`, `status: passed`, not run on a dirty
 * checkout, with every step passed or skipped, and with the `package` step passed: a green
 * `--quick` or `--no-package` run proves less than a release needs.
 */
import { execFileSync } from 'node:child_process';
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
  steps?: { id: string; status: string; note?: string }[];
}

export interface PlatformVerdict {
  platform: Platform;
  ok: boolean;
  /** One line: what is there, or what is missing and what to run. */
  detail: string;
  /** The log of the result that makes it pass (or the latest one that does not). */
  log?: string;
}

export interface GateVerdict {
  commit: string;
  ok: boolean;
  platforms: PlatformVerdict[];
}

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
    if (good) return { platform, ok: true, detail: 'full run passed', log: good.log };
    const run = `run \`${COMMAND[platform]} --commit ${commit.slice(0, 7)}\``;
    const latest = forCommit[0];
    if (latest) {
      return { platform, ok: false, detail: `${whyNotCounted(latest)}: ${run}`, log: latest.log };
    }
    const other = mine[0];
    const seen = other?.commit ? ` (the latest result is for ${other.commit.slice(0, 7)})` : '';
    return { platform, ok: false, detail: `no result for this commit${seen}: ${run}` };
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

export function formatVerdict(v: GateVerdict): string {
  const lines = [`Release gate for ${v.commit.slice(0, 7)}: ${v.ok ? 'OPEN' : 'CLOSED'}`];
  for (const p of v.platforms) {
    lines.push(`  ${p.ok ? 'ok     ' : 'MISSING'} ${p.platform.padEnd(8)} ${p.detail}`);
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

function main(): number {
  const args = process.argv.slice(2);
  let rev = 'HEAD';
  let dir = resultsDir();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--commit' && args[i + 1]) rev = args[++i] ?? rev;
    else if (args[i] === '--results' && args[i + 1]) dir = resolve(args[++i] ?? dir);
    else {
      process.stderr.write('usage: pnpm release:check [--commit <rev>] [--results <folder>]\n');
      return 2;
    }
  }
  const verdict = checkReleaseGate(resolveCommit(rev), dir);
  process.stdout.write(`${formatVerdict(verdict)}\n`);
  return verdict.ok ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();
