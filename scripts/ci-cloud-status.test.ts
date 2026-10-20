import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  circleRuns,
  exitCode,
  formatRuns,
  gitlabRuns,
  loadSettings,
  type CirclePipeline,
  type CircleWorkflow,
  type GitlabJob,
  type GitlabPipeline,
} from './ci-cloud-status.ts';

const SLUG = 'circleci/org-id/project-id';

describe('circleRuns', () => {
  const pipelines: CirclePipeline[] = [
    {
      id: 'p3',
      number: 3,
      created_at: '2026-10-16T00:05:00Z',
      trigger: { type: 'schedule' },
      vcs: { revision: 'ccc3333aaaa' },
    },
    // A push pipeline with no workflow (the run-* parameters are false).
    { id: 'p2', number: 2, created_at: '2026-10-15T18:00:00Z', trigger: { type: 'webhook' } },
    {
      id: 'p1',
      number: 1,
      created_at: '2026-10-15T00:05:00Z',
      trigger: { type: 'api' },
      vcs: { revision: 'aaa1111bbbb' },
    },
  ];
  const workflows = new Map<string, CircleWorkflow[]>([
    ['p3', [{ id: 'w3', name: 'linux', status: 'failing', created_at: '2026-10-16T00:05:10Z' }]],
    ['p2', []],
    [
      'p1',
      [
        { id: 'w1a', name: 'linux', status: 'success', created_at: '2026-10-15T00:05:10Z' },
        { id: 'w1b', name: 'macos', status: 'success', created_at: '2026-10-15T00:05:11Z' },
        { id: 'w1c', name: 'other', status: 'failed', created_at: '2026-10-15T00:05:12Z' },
      ],
    ],
  ]);

  it('keeps the latest workflow of each platform, in platform order', () => {
    const runs = circleRuns(SLUG, pipelines, workflows);
    expect(runs.map((r) => [r.platform, r.status, r.rawStatus, r.trigger, r.commit])).toEqual([
      ['linux', 'failed', 'failing', 'schedule', 'ccc3333aaaa'],
      ['macos', 'passed', 'success', 'api', 'aaa1111bbbb'],
    ]);
    expect(runs[0]?.url).toBe(`https://app.circleci.com/pipelines/${SLUG}/3/workflows/w3`);
  });

  it('maps running and canceled workflows', () => {
    const runs = circleRuns(
      SLUG,
      [pipelines[0]!],
      new Map([
        [
          'p3',
          [
            { id: 'a', name: 'windows', status: 'on_hold', created_at: '2026-10-16T00:05:00Z' },
            { id: 'b', name: 'macos', status: 'canceled', created_at: '2026-10-16T00:05:00Z' },
          ],
        ],
      ]),
    );
    expect(runs.map((r) => r.status)).toEqual(['running', 'canceled']);
  });
});

describe('gitlabRuns', () => {
  const pipelines: GitlabPipeline[] = [
    { id: 20, sha: 'bbb2222', source: 'web', created_at: '2026-10-16T09:00:00Z' },
    { id: 10, sha: 'aaa1111', source: 'schedule', created_at: '2026-10-15T01:00:00Z' },
  ];
  const job = (id: number, name: string, status: string, created_at: string): GitlabJob => ({
    id,
    name,
    status,
    created_at,
    web_url: `https://gitlab.com/g/monsters/-/jobs/${id}`,
  });
  const jobs = new Map<number, GitlabJob[]>([
    // Manual run of Linux only: the Windows job is not in the pipeline at all.
    [20, [job(201, 'checks-linux', 'running', '2026-10-16T09:00:01Z')]],
    [
      10,
      [
        job(101, 'checks-linux', 'success', '2026-10-15T01:00:01Z'),
        job(102, 'checks-windows', 'failed', '2026-10-15T01:00:02Z'),
        job(103, 'lint', 'failed', '2026-10-15T01:00:02Z'),
      ],
    ],
  ]);

  it('keeps the latest checks-<platform> job of each platform', () => {
    const runs = gitlabRuns(pipelines, jobs);
    expect(runs.map((r) => [r.platform, r.status, r.trigger, r.commit, r.url])).toEqual([
      ['linux', 'running', 'web', 'bbb2222', 'https://gitlab.com/g/monsters/-/jobs/201'],
      ['windows', 'failed', 'schedule', 'aaa1111', 'https://gitlab.com/g/monsters/-/jobs/102'],
    ]);
    expect(exitCode(runs)).toBe(1);
  });

  it('ignores skipped jobs in favour of an older real run', () => {
    const runs = gitlabRuns(
      pipelines,
      new Map([
        [20, [job(202, 'checks-windows', 'skipped', '2026-10-16T09:00:01Z')]],
        [10, [job(102, 'checks-windows', 'success', '2026-10-15T01:00:02Z')]],
      ]),
    );
    expect(runs.map((r) => [r.platform, r.status])).toEqual([['windows', 'passed']]);
    expect(exitCode(runs)).toBe(0);
  });
});

describe('formatRuns', () => {
  it('prints one aligned line per run, time in Europe/Rome', () => {
    const line = formatRuns([
      {
        ci: 'circleci',
        platform: 'linux',
        status: 'passed',
        rawStatus: 'success',
        trigger: 'schedule',
        commit: '1234567890',
        createdAt: '2026-10-15T00:05:00Z',
        url: 'https://example.test/run',
      },
    ]);
    expect(line).toMatch(/^circleci {2}linux {4}verde {6}schedule {2}1234567 {2}15\/10.*02:05/);
    expect(line.endsWith('https://example.test/run')).toBe(true);
  });
});

describe('loadSettings', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('takes the environment over the first file over the next', () => {
    dir = mkdtempSync(join(tmpdir(), 'ci-cloud-status-'));
    const first = join(dir, 'first.env');
    const second = join(dir, 'second.env');
    writeFileSync(first, 'GITLAB_TOKEN=from-first\n# comment\nGITLAB_PROJECT="g/monsters"\n');
    writeFileSync(second, 'GITLAB_TOKEN=from-second\nCIRCLECI_TOKEN=from-second\n');
    const s = loadSettings({ CIRCLECI_TOKEN: 'from-env', EMPTY: '' }, [
      first,
      second,
      join(dir, 'missing.env'),
    ]);
    expect(s['CIRCLECI_TOKEN']).toBe('from-env');
    expect(s['GITLAB_TOKEN']).toBe('from-first');
    expect(s['GITLAB_PROJECT']).toBe('g/monsters');
    expect(s['EMPTY']).toBeUndefined();
  });
});
