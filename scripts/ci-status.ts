/*
 * Publishes the local release CI (D-147) as GitHub commit statuses, so the commit page shows what
 * was verified on this side:
 *
 *   pnpm ci:status [--commit <rev>] [--results <folder>] [--dry-run]
 *
 * Four contexts: `local-ci/linux`, `local-ci/windows`, `local-ci/macos` (one per system) and
 * `local-ci/release-gate` (success only if the three are green). The states come from the same
 * evaluation as `pnpm release:check` (scripts/release-gate.ts). Nothing is posted unless the commit
 * exists on origin (a status on an unpushed sha has nowhere to show). No `target_url`, and the
 * descriptions carry no paths, host names or personal data: only system, mode, step and duration.
 * `pnpm release:ci` calls this at the end (also on failure); `--no-status` there skips it.
 * `--dry-run` prints the `gh` commands and posts nothing.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkReleaseGate,
  type GateVerdict,
  PLATFORMS,
  type PlatformVerdict,
  resolveCommit,
  resultsDir,
  whyNotCounted,
} from './release-gate.ts';

export type StatusState = 'success' | 'failure' | 'pending';

export interface CommitStatus {
  context: string;
  state: StatusState;
  /** At most 140 characters (the GitHub limit). */
  description: string;
}

export const MAX_DESCRIPTION = 140;
export const DEFAULT_REPO = 'Saturday-Company/monsters';

const RUN_COMMAND: Record<string, string> = {
  linux: 'ci:local',
  windows: 'ci:windows',
  macos: 'ci:mac',
};

/** `271000` -> `4m31s`; under a minute `45s`; an hour or more `1h02m`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function clip(text: string, max = MAX_DESCRIPTION): string {
  const flat = text.replace(/`/g, '').replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 3)}...`;
}

/** Pure: the status of one system. */
export function platformStatus(v: PlatformVerdict): CommitStatus {
  const context = `local-ci/${v.platform}`;
  const cmd = RUN_COMMAND[v.platform] ?? v.platform;
  const r = v.result;
  if (v.ok) {
    const dur = typeof r?.durationMs === 'number' ? `, ${formatDuration(r.durationMs)}` : '';
    return { context, state: 'success', description: clip(`${cmd} full + package${dur}`) };
  }
  if (!r) return { context, state: 'pending', description: clip(`${cmd}: no run for this commit`) };
  if (r.status === 'running') {
    return { context, state: 'pending', description: clip(`${cmd}: run in progress`) };
  }
  // Only the reason, never the "run `...`" hint (and nothing from the log path).
  const why = whyNotCounted(r) ?? 'not counted';
  return { context, state: 'failure', description: clip(`${cmd}: ${why}`) };
}

/** Pure: the four statuses for a verdict. */
export function gateStatuses(verdict: GateVerdict): CommitStatus[] {
  const per = PLATFORMS.map((p) => {
    const found = verdict.platforms.find((x) => x.platform === p);
    return platformStatus(found ?? { platform: p, ok: false, detail: 'missing' });
  });
  const green = per.filter((s) => s.state === 'success').length;
  const failed = per.filter((s) => s.state === 'failure').map((s) => s.context.slice(9));
  const waiting = per.filter((s) => s.state === 'pending').map((s) => s.context.slice(9));
  let gate: CommitStatus;
  if (green === per.length) {
    gate = {
      context: 'local-ci/release-gate',
      state: 'success',
      description: 'full local CI green on linux, windows and macos',
    };
  } else if (failed.length > 0) {
    gate = {
      context: 'local-ci/release-gate',
      state: 'failure',
      description: clip(`closed: red on ${failed.join(', ')}`),
    };
  } else {
    gate = {
      context: 'local-ci/release-gate',
      state: 'pending',
      description: clip(`closed: waiting for ${waiting.join(', ')}`),
    };
  }
  return [...per, gate];
}

/** Pure: `owner/repo` from a git remote URL (https or ssh), or the default. */
export function parseRepo(remoteUrl: string): string {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
  return m ? `${m[1]}/${m[2]}` : DEFAULT_REPO;
}

/** Pure: the `gh` arguments that post one status. */
export function ghArgs(repo: string, sha: string, s: CommitStatus): string[] {
  return [
    'api',
    '-X',
    'POST',
    `repos/${repo}/statuses/${sha}`,
    '-f',
    `state=${s.state}`,
    '-f',
    `context=${s.context}`,
    '-f',
    `description=${s.description}`,
  ];
}

function shellQuote(a: string): string {
  return /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`;
}

export function formatCommand(args: string[]): string {
  return ['gh', ...args].map(shellQuote).join(' ');
}

export interface Runner {
  /** Runs a command, returns its exit code and stdout. */
  run(cmd: string, args: string[]): { code: number | null; stdout: string };
}

export function realRunner(cwd: string): Runner {
  return {
    run(cmd, args) {
      const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
      return { code: r.status, stdout: r.stdout ?? '' };
    },
  };
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

/** True when the commit is known to origin: a remote branch contains it, or GitHub has it. */
export function commitOnOrigin(runner: Runner, repo: string, sha: string): boolean {
  const local = runner.run('git', ['branch', '-r', '--contains', sha]);
  if (local.code === 0 && local.stdout.trim() !== '') return true;
  return runner.run('gh', ['api', `repos/${repo}/commits/${sha}`, '--silent']).code === 0;
}

export interface PublishOptions {
  verdict: GateVerdict;
  repo: string;
  dryRun: boolean;
  runner: Runner;
  out: (line: string) => void;
}

/** Posts (or, in a dry run, prints) the statuses. Returns the exit code. */
export function publishStatuses(o: PublishOptions): number {
  const sha = o.verdict.commit;
  const statuses = gateStatuses(o.verdict);
  if (!o.dryRun && !commitOnOrigin(o.runner, o.repo, sha)) {
    o.out(
      `ci:status: ${sha.slice(0, 7)} is not on origin (${o.repo}): push it first, then run ` +
        `\`pnpm ci:status --commit ${sha.slice(0, 7)}\`. Nothing posted.`,
    );
    return 0;
  }
  let failures = 0;
  for (const s of statuses) {
    const args = ghArgs(o.repo, sha, s);
    if (o.dryRun) {
      o.out(formatCommand(args));
      continue;
    }
    const r = o.runner.run('gh', args);
    if (r.code === 0) o.out(`ci:status: ${s.context} ${s.state}`);
    else {
      failures++;
      o.out(`ci:status: ${s.context}: gh failed (exit ${r.code ?? 'signal'})`);
    }
  }
  return failures === 0 ? 0 : 1;
}

function main(): number {
  const args = process.argv.slice(2);
  let rev = 'HEAD';
  let dir = resultsDir();
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--commit' && args[i + 1]) rev = args[++i] ?? rev;
    else if (args[i] === '--results' && args[i + 1]) dir = resolve(args[++i] ?? dir);
    else if (args[i] === '--dry-run') dryRun = true;
    else {
      process.stderr.write(
        'usage: pnpm ci:status [--commit <rev>] [--results <folder>] [--dry-run]\n',
      );
      return 2;
    }
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const verdict = checkReleaseGate(resolveCommit(rev, root), dir);
  return publishStatuses({
    verdict,
    repo: originRepo(root),
    dryRun,
    runner: realRunner(root),
    out: (l) => process.stdout.write(`${l}\n`),
  });
}

if (import.meta.main) process.exitCode = main();
