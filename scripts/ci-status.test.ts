import { describe, expect, it } from 'vitest';
import {
  formatCommand,
  formatDuration,
  gateStatuses,
  ghArgs,
  parseRepo,
  publishStatuses,
  type Runner,
} from './ci-status.ts';
import { evaluateGate, type GateResult, PLATFORMS } from './release-gate.ts';

const SHA = 'c'.repeat(40);

function result(platform: string, over: Partial<GateResult> = {}): GateResult {
  return {
    schema: 'monsters-ci/1',
    platform,
    commit: SHA,
    dirty: false,
    mode: 'full',
    status: 'passed',
    failedStep: null,
    startedAt: '2026-10-20T10:00:00.000Z',
    durationMs: 271_000,
    log: 'x.log',
    steps: [{ id: 'package', status: 'passed' }],
    ...over,
  };
}

describe('gateStatuses', () => {
  it('is all green with durations when the three systems passed', () => {
    const s = gateStatuses(
      evaluateGate(
        SHA,
        PLATFORMS.map((p) => result(p)),
      ),
    );
    expect(s.map((x) => x.context)).toEqual([
      'local-ci/linux',
      'local-ci/windows',
      'local-ci/macos',
      'local-ci/release-gate',
    ]);
    expect(s.every((x) => x.state === 'success')).toBe(true);
    expect(s[0]?.description).toBe('ci:local full + package, 4m31s');
  });

  it('marks a missing system pending and keeps the gate from being green', () => {
    const s = gateStatuses(
      evaluateGate(
        SHA,
        PLATFORMS.filter((p) => p !== 'macos').map((p) => result(p)),
      ),
    );
    expect(s[2]).toMatchObject({ context: 'local-ci/macos', state: 'pending' });
    expect(s[3]).toMatchObject({ state: 'pending' });
    expect(s[3]?.description).toContain('macos');
  });

  it('marks a red system failure with the failed step and closes the gate as failure', () => {
    const s = gateStatuses(
      evaluateGate(SHA, [
        result('linux'),
        result('windows', { status: 'failed', failedStep: 'test' }),
      ]),
    );
    expect(s[1]).toMatchObject({ state: 'failure' });
    expect(s[1]?.description).toContain('test');
    expect(s[3]).toMatchObject({ state: 'failure' });
  });

  it('treats a run in progress as pending and a quick run as failure', () => {
    const s = gateStatuses(
      evaluateGate(SHA, [
        result('linux', { status: 'running' }),
        result('windows', { mode: 'quick' }),
      ]),
    );
    expect(s[0]?.state).toBe('pending');
    expect(s[1]?.state).toBe('failure');
  });

  it('never leaks paths or hints, and stays within 140 characters', () => {
    const verdicts = [
      evaluateGate(
        SHA,
        PLATFORMS.map((p) => result(p)),
      ),
      evaluateGate(SHA, [result('linux', { status: 'failed', failedStep: 'x'.repeat(300) })]),
      evaluateGate(SHA, []),
    ];
    for (const v of verdicts) {
      for (const s of gateStatuses(v)) {
        expect(s.description.length).toBeLessThanOrEqual(140);
        expect(s.description).not.toMatch(/\/home|\/srv|ci-results|\.log|`|run pnpm/);
      }
    }
  });
});

describe('helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(271_000)).toBe('4m31s');
    expect(formatDuration(3_720_000)).toBe('1h02m');
  });

  it('parses the repo from https and ssh remotes, with a default', () => {
    expect(parseRepo('https://github.com/Acme/thing.git\n')).toBe('Acme/thing');
    expect(parseRepo('git@github.com:Acme/thing.git')).toBe('Acme/thing');
    expect(parseRepo('git@gitlab.com:x/y.git')).toBe('Saturday-Company/monsters');
    expect(parseRepo('')).toBe('Saturday-Company/monsters');
  });

  it('builds the gh command without target_url', () => {
    const args = ghArgs('A/b', SHA, {
      context: 'local-ci/linux',
      state: 'success',
      description: 'ok it',
    });
    expect(args.slice(0, 4)).toEqual(['api', '-X', 'POST', `repos/A/b/statuses/${SHA}`]);
    expect(formatCommand(args)).toContain("'description=ok it'");
    expect(args.join(' ')).not.toContain('target_url');
  });
});

describe('publishStatuses', () => {
  const verdict = evaluateGate(
    SHA,
    PLATFORMS.map((p) => result(p)),
  );
  const make = (onOrigin: boolean) => {
    const calls: string[][] = [];
    const runner: Runner = {
      run(cmd, args) {
        calls.push([cmd, ...args]);
        if (cmd === 'git') return { code: 0, stdout: onOrigin ? 'origin/main\n' : '' };
        if (args[0] === 'api' && args[1]?.includes('/commits/')) return { code: 1, stdout: '' };
        return { code: 0, stdout: '' };
      },
    };
    return { calls, runner };
  };

  it('dry run prints four gh commands and runs nothing', () => {
    const { calls, runner } = make(true);
    const lines: string[] = [];
    const code = publishStatuses({
      verdict,
      repo: 'A/b',
      dryRun: true,
      runner,
      out: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^gh api -X POST repos\/A\/b\/statuses\/c{40} /);
  });

  it('posts four statuses when the commit is on origin', () => {
    const { calls, runner } = make(true);
    const code = publishStatuses({ verdict, repo: 'A/b', dryRun: false, runner, out: () => {} });
    expect(code).toBe(0);
    expect(calls.filter((c) => c[0] === 'gh')).toHaveLength(4);
  });

  it('explains and posts nothing when the commit is not on origin', () => {
    const { calls, runner } = make(false);
    const lines: string[] = [];
    publishStatuses({ verdict, repo: 'A/b', dryRun: false, runner, out: (l) => lines.push(l) });
    expect(calls.some((c) => c.includes('-X'))).toBe(false);
    expect(lines.join('\n')).toContain('not on origin');
  });
});
