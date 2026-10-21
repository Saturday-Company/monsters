import { describe, expect, it } from 'vitest';
import { githubAlreadyGreen } from './ci-status.ts';
import { branchAt, type ListedRun, pickRun, planGithub } from './release-ci.ts';
import {
  type CheckRun,
  combineGate,
  evaluateGithub,
  fetchGithub,
  formatVerdict,
  gateModeFromEnv,
  type GateResult,
  GITHUB_JOBS,
  type GithubData,
  PLATFORMS,
  type Runner,
  whyRunNotTrusted,
  type WorkflowRun,
  workflowRunId,
} from './release-gate.ts';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const REPO = 'Acme/monsters';

function run(id: number, over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id,
    event: 'push',
    path: '.github/workflows/ci.yml',
    head_sha: SHA,
    head_repository: { full_name: REPO },
    ...over,
  };
}

function check(name: string, runId: number, over: Partial<CheckRun> = {}): CheckRun {
  return {
    name,
    head_sha: SHA,
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-10-20T10:00:00Z',
    completed_at: '2026-10-20T10:21:30Z',
    details_url: `https://github.com/${REPO}/actions/runs/${runId}/job/${runId * 10}`,
    html_url: `https://github.com/${REPO}/actions/runs/${runId}/job/${runId * 10}`,
    app: { slug: 'github-actions' },
    ...over,
  };
}

const fullChecks = (runId: number, over: Partial<CheckRun> = {}) =>
  PLATFORMS.map((p) => check(GITHUB_JOBS[p], runId, over));

function data(checkRuns: CheckRun[], runs: WorkflowRun[]): GithubData {
  return { repo: REPO, checkRuns, runs: Object.fromEntries(runs.map((r) => [r.id, r])) };
}

function local(platform: string, over: Partial<GateResult> = {}): GateResult {
  return {
    schema: 'monsters-ci/1',
    platform,
    commit: SHA,
    dirty: false,
    mode: 'full',
    status: 'passed',
    failedStep: null,
    startedAt: '2026-10-20T10:00:00.000Z',
    log: `x-${platform}.log`,
    steps: [{ id: 'package', status: 'passed' }],
    ...over,
  };
}

describe('evaluateGithub', () => {
  it('opens on the three full jobs green in a push run of ci.yml of this repo', () => {
    const v = evaluateGithub(SHA, data(fullChecks(7), [run(7)]));
    expect(v.every((p) => p.ok && p.source === 'github')).toBe(true);
    expect(v[0]?.detail).toContain('21m30s');
    expect(v[0]?.url).toContain('/actions/runs/7/');
  });

  it('a manual run (workflow_dispatch) counts too', () => {
    const v = evaluateGithub(SHA, data(fullChecks(7), [run(7, { event: 'workflow_dispatch' })]));
    expect(v.every((p) => p.ok)).toBe(true);
  });

  it('never trusts a pull request run, another workflow, a fork or another commit', () => {
    for (const bad of [
      run(7, { event: 'pull_request' }),
      run(7, { event: 'pull_request_target' }),
      run(7, { path: '.github/workflows/other.yml' }),
      run(7, { head_repository: { full_name: 'Mallory/monsters' } }),
      run(7, { head_sha: OTHER }),
    ]) {
      const v = evaluateGithub(SHA, data(fullChecks(7), [bad]));
      expect(v.some((p) => p.ok)).toBe(false);
      expect(v[0]?.detail).toContain('one exists, but');
    }
    // No workflow run read at all.
    expect(evaluateGithub(SHA, data(fullChecks(7), [])).some((p) => p.ok)).toBe(false);
  });

  it('ignores check runs of other apps, other names and other commits', () => {
    const v = evaluateGithub(
      SHA,
      data(
        [
          check('full (linux)', 7, { app: { slug: 'someone-else' } }),
          check('full (windows)', 7, { head_sha: OTHER }),
          check('linux', 7),
        ],
        [run(7)],
      ),
    );
    expect(v.some((p) => p.ok)).toBe(false);
  });

  it('a green attempt counts even if a later one is red; a red or running one explains itself', () => {
    const ok = evaluateGithub(
      SHA,
      data(
        [
          check('full (linux)', 7, { started_at: '2026-10-20T09:00:00Z' }),
          check('full (linux)', 8, { conclusion: 'failure', started_at: '2026-10-20T11:00:00Z' }),
        ],
        [run(7), run(8)],
      ),
    );
    expect(ok[0]?.ok).toBe(true);
    const red = evaluateGithub(
      SHA,
      data(
        [
          check('full (linux)', 8, { conclusion: 'failure' }),
          check('full (windows)', 8, { status: 'in_progress', conclusion: null }),
        ],
        [run(8)],
      ),
    );
    expect(red[0]?.detail).toContain('concluded `failure`');
    expect(red[1]?.detail).toContain('still in progress');
    expect(red[2]?.detail).toContain('no `full (macos)`');
  });

  it('says GitHub could not be read', () => {
    const v = evaluateGithub(SHA, { repo: REPO, checkRuns: [], runs: {}, error: 'gh api exit 4' });
    expect(v[0]?.detail).toContain('GitHub not read');
  });
});

describe('helpers', () => {
  it('takes the workflow run id from the job URL', () => {
    expect(workflowRunId(check('x', 123))).toBe(123);
    expect(workflowRunId({ ...check('x', 1), details_url: null, html_url: null })).toBeNull();
  });

  it('whyRunNotTrusted accepts a push run of ci.yml of the repo, whatever the case', () => {
    expect(whyRunNotTrusted(run(1), SHA, REPO)).toBeNull();
    expect(
      whyRunNotTrusted(run(1, { head_repository: { full_name: 'acme/MONSTERS' } }), SHA, REPO),
    ).toBeNull();
    expect(whyRunNotTrusted(undefined, SHA, REPO)).toContain('could not be read');
  });

  it('reads the gate source from MONSTERS_CI_GATE', () => {
    expect(gateModeFromEnv({})).toBe('auto');
    expect(gateModeFromEnv({ MONSTERS_CI_GATE: 'Local' })).toBe('local');
    expect(gateModeFromEnv({ MONSTERS_CI_GATE: 'github' })).toBe('github');
    expect(() => gateModeFromEnv({ MONSTERS_CI_GATE: 'yes' })).toThrow('auto, github or local');
  });
});

describe('combineGate', () => {
  const allLocal = PLATFORMS.map((p) => local(p));

  it('auto: GitHub green is enough, without any local result', () => {
    const v = combineGate(SHA, { mode: 'auto', local: [], github: data(fullChecks(7), [run(7)]) });
    expect(v.ok).toBe(true);
    expect(formatVerdict(v)).toContain('(github)');
  });

  it('auto: the local results are the fallback, per platform', () => {
    const v = combineGate(SHA, {
      mode: 'auto',
      local: [local('macos')],
      github: data([check('full (linux)', 7), check('full (windows)', 7)], [run(7)]),
    });
    expect(v.ok).toBe(true);
    expect(v.platforms.map((p) => p.source)).toEqual(['github', 'github', 'local']);
  });

  it('auto: GitHub unreachable falls back to local; closed explains both sides', () => {
    const down: GithubData = { repo: REPO, checkRuns: [], runs: {}, error: 'offline' };
    expect(combineGate(SHA, { mode: 'auto', local: allLocal, github: down }).ok).toBe(true);
    const closed = combineGate(SHA, { mode: 'auto', local: [], github: down });
    expect(closed.ok).toBe(false);
    expect(closed.platforms[0]?.detail).toContain('GitHub not read');
    expect(closed.platforms[0]?.detail).toContain('local: no result for this commit');
  });

  it('github or local keeps only that source', () => {
    const gh = data(fullChecks(7), [run(7)]);
    expect(combineGate(SHA, { mode: 'github', local: [], github: gh }).ok).toBe(true);
    expect(combineGate(SHA, { mode: 'local', local: [], github: gh }).ok).toBe(false);
    expect(combineGate(SHA, { mode: 'github', local: allLocal }).ok).toBe(false);
    expect(combineGate(SHA, { mode: 'local', local: allLocal }).ok).toBe(true);
  });
});

describe('fetchGithub', () => {
  it('reads the check runs, then only the workflow runs of the full jobs', () => {
    const calls: string[] = [];
    const runner: Runner = {
      run(_cmd, args) {
        const path = args[1] ?? '';
        calls.push(path);
        if (path.includes('/check-runs')) {
          return {
            code: 0,
            stdout: JSON.stringify({ check_runs: [...fullChecks(7), check('linux', 9)] }),
          };
        }
        if (path.endsWith('/actions/runs/7')) return { code: 0, stdout: JSON.stringify(run(7)) };
        return { code: 1, stdout: '' };
      },
    };
    const d = fetchGithub(REPO, SHA, runner);
    expect(calls[0]).toBe(`repos/${REPO}/commits/${SHA}/check-runs?per_page=100&filter=all`);
    expect(calls.slice(1)).toEqual([`repos/${REPO}/actions/runs/7`]);
    expect(evaluateGithub(SHA, d).every((p) => p.ok)).toBe(true);
    expect(githubAlreadyGreen(SHA, d)).toBe(true);
  });

  it('turns a gh failure into an error, not a crash', () => {
    const d = fetchGithub(REPO, SHA, { run: () => ({ code: 1, stdout: '' }) });
    expect(d.error).toContain('exit 1');
    expect(githubAlreadyGreen(SHA, d)).toBe(false);
  });
});

describe('release-ci on GitHub', () => {
  const listed = (over: Partial<ListedRun>): ListedRun => ({
    databaseId: 1,
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    url: 'https://example.test/run/1',
    ...over,
  });

  it('picks a push or manual run, an unfinished one first, never a pull request', () => {
    expect(pickRun([listed({ event: 'pull_request' })])).toBeNull();
    const running = listed({ databaseId: 2, status: 'in_progress', conclusion: '' });
    expect(pickRun([listed({}), running])?.databaseId).toBe(2);
    expect(pickRun([listed({ event: 'workflow_dispatch', databaseId: 3 })])?.databaseId).toBe(3);
  });

  it('finds a branch of origin at the commit, main first', () => {
    const ls = `${OTHER}\trefs/heads/main\n${SHA}\trefs/heads/feature\n${SHA}\trefs/heads/main\n`;
    expect(branchAt(ls, SHA)).toBe('main');
    expect(branchAt(`${SHA}\trefs/heads/feature\n`, SHA)).toBe('feature');
    expect(branchAt(`${OTHER}\trefs/heads/main\n`, SHA)).toBeNull();
  });

  it('watches, reports a red, starts a run on a branch, or explains why it cannot', () => {
    const ls = `${SHA}\trefs/heads/main\n`;
    expect(planGithub(SHA, [listed({})], ls).kind).toBe('watch');
    expect(planGithub(SHA, [listed({ status: 'queued', conclusion: '' })], ls).kind).toBe('watch');
    expect(planGithub(SHA, [listed({ conclusion: 'failure' })], ls).kind).toBe('red');
    expect(planGithub(SHA, [listed({ conclusion: 'cancelled' })], ls)).toEqual({
      kind: 'start',
      branch: 'main',
    });
    expect(planGithub(SHA, [], ls)).toEqual({ kind: 'start', branch: 'main' });
    const no = planGithub(SHA, [], '');
    expect(no.kind).toBe('cannot');
  });
});
