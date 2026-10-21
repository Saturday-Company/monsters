import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { interpretExit, planReleaseCi } from './release-ci.ts';
import {
  checkReleaseGate,
  evaluateGate,
  formatVerdict,
  gateDecision,
  type GateResult,
  loadResults,
  PLATFORMS,
  whyNotCounted,
} from './release-gate.ts';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

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
    log: `x-${platform}.log`,
    steps: [
      { id: 'test', status: 'passed' },
      { id: 'package', status: 'passed' },
    ],
    ...over,
  };
}

const allGreen = () => PLATFORMS.map((p) => result(p));

describe('evaluateGate', () => {
  it('opens when the three platforms have a full passing result for the commit', () => {
    const v = evaluateGate(SHA, allGreen());
    expect(v.ok).toBe(true);
    expect(v.platforms.map((p) => p.ok)).toEqual([true, true, true]);
  });

  it('closes and names the missing platform and the command to run', () => {
    const v = evaluateGate(
      SHA,
      allGreen().filter((r) => r.platform !== 'macos'),
    );
    expect(v.ok).toBe(false);
    const mac = v.platforms.find((p) => p.platform === 'macos');
    expect(mac?.detail).toContain('no result for this commit');
    expect(mac?.detail).toContain('pnpm ci:mac --commit aaaaaaa');
  });

  it('ignores results of another commit, and says which one it saw', () => {
    const v = evaluateGate(SHA, [result('linux', { commit: OTHER })]);
    expect(v.platforms[0]?.ok).toBe(false);
    expect(v.platforms[0]?.detail).toContain('latest result is for bbbbbbb');
  });

  it('does not take a prefix of the hash for the commit', () => {
    const v = evaluateGate(SHA, [result('linux', { commit: SHA.slice(0, 7) })]);
    expect(v.platforms[0]?.ok).toBe(false);
  });

  it('rejects quick runs, skipped package, dirty runs, red and interrupted runs', () => {
    expect(whyNotCounted(result('linux', { mode: 'quick' }))).toContain('quick');
    expect(
      whyNotCounted(
        result('linux', {
          steps: [{ id: 'package', status: 'skipped', note: '--no-package' }],
        }),
      ),
    ).toContain('--no-package');
    expect(whyNotCounted(result('linux', { steps: [{ id: 'test', status: 'passed' }] }))).toContain(
      'no `package` step',
    );
    expect(whyNotCounted(result('linux', { dirty: true }))).toContain('uncommitted');
    expect(whyNotCounted(result('linux', { status: 'failed', failedStep: 'test' }))).toContain(
      '`test`',
    );
    expect(whyNotCounted(result('linux', { status: 'interrupted' }))).toContain('interrupted');
    expect(whyNotCounted(result('linux', { status: 'running' }))).toContain('progress');
    expect(whyNotCounted(result('linux'))).toBeNull();
  });

  it('a later red does not hide an earlier full green of the same commit', () => {
    const green = result('linux', { startedAt: '2026-10-20T09:00:00.000Z' });
    const red = result('linux', {
      startedAt: '2026-10-20T11:00:00.000Z',
      status: 'failed',
      failedStep: 'e2e-core',
    });
    const v = evaluateGate(SHA, [green, red, result('windows'), result('macos')]);
    expect(v.ok).toBe(true);
  });

  it('explains the latest result of the commit when none counts', () => {
    const v = evaluateGate(SHA, [
      result('linux', { mode: 'quick' }),
      result('windows'),
      result('macos'),
    ]);
    expect(v.ok).toBe(false);
    expect(formatVerdict(v)).toContain('CLOSED');
    expect(formatVerdict(v)).toContain('MISSING linux');
    expect(formatVerdict(v)).toContain('pnpm release:ci');
  });
});

describe('gateDecision', () => {
  const open = evaluateGate(SHA, allGreen());
  const closed = evaluateGate(SHA, []);

  it('lets an open gate through quietly', () => {
    const d = gateDecision({ verdict: open, skip: false });
    expect(d.proceed).toBe(true);
    expect(d.messages.join('\n')).not.toContain('WARNING');
  });

  it('refuses a closed gate', () => {
    const d = gateDecision({ verdict: closed, skip: false });
    expect(d.proceed).toBe(false);
    expect(d.messages.join('\n')).toContain('--skip-ci-gate');
  });

  it('--skip-ci-gate goes on with a loud warning', () => {
    const d = gateDecision({ verdict: closed, skip: true });
    expect(d.proceed).toBe(true);
    expect(d.messages.join('\n')).toContain('WARNING');
  });

  it('a dry run reports the gate but is never blocked by it', () => {
    const d = gateDecision({ verdict: closed, skip: false, dryRun: true });
    expect(d.proceed).toBe(true);
    expect(d.messages.join('\n')).toContain('CLOSED');
  });
});

describe('loadResults', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const folder = () => {
    const d = mkdtempSync(join(tmpdir(), 'release-gate-'));
    dirs.push(d);
    return d;
  };

  it('reads results from a folder and ignores junk and other json', () => {
    const d = folder();
    for (const p of PLATFORMS) {
      writeFileSync(join(d, `20261020-100000-aaaaaaa-${p}.json`), JSON.stringify(result(p)));
    }
    writeFileSync(join(d, 'broken.json'), '{ not json');
    writeFileSync(join(d, '20261020-aaaaaaa-harness.json'), JSON.stringify({ schema: 'other' }));
    writeFileSync(join(d, 'notturna.md'), 'old');
    expect(loadResults(d)).toHaveLength(3);
    expect(checkReleaseGate(SHA, d).ok).toBe(true);
    expect(checkReleaseGate(OTHER, d).ok).toBe(false);
  });

  it('a missing folder gives a closed gate, not a crash', () => {
    expect(checkReleaseGate(SHA, join(folder(), 'nope')).ok).toBe(false);
  });
});

describe('publish-update.ts and the gate', () => {
  it('refuses to publish on the real feed when the gate is closed (before any key)', () => {
    const empty = mkdtempSync(join(tmpdir(), 'release-gate-'));
    try {
      const script = fileURLToPath(
        new URL('../apps/desktop/scripts/publish-update.ts', import.meta.url),
      );
      const r = spawnSync(process.execPath, [script], {
        encoding: 'utf8',
        // Local source only: no gh call, whatever GitHub says about HEAD.
        env: { ...process.env, MONSTERS_CI_RESULTS: empty, MONSTERS_CI_GATE: 'local' },
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('Release gate for');
      expect(r.stderr).toContain('CLOSED');
      expect(r.stderr).toContain('release gate closed');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('release-ci', () => {
  it('runs linux, windows, macos and then the probe, all on the same commit', () => {
    const plan = planReleaseCi(SHA);
    expect(plan.map((s) => s.id)).toEqual(['linux', 'windows', 'macos', 'probe']);
    for (const s of plan.slice(0, 3)) expect(s.args).toContain(SHA);
    expect(planReleaseCi(SHA, false).map((s) => s.id)).toEqual(['linux', 'windows', 'macos']);
  });

  it('stops on a failure, says clearly that Mac 75 is unreachable, tolerates a missing claude', () => {
    expect(interpretExit('linux', 0).continue).toBe(true);
    expect(interpretExit('linux', 1).continue).toBe(false);
    const mac = interpretExit('macos', 75);
    expect(mac.continue).toBe(false);
    expect(mac.message).toContain('unreachable');
    expect(mac.message).toContain('not a red');
    expect(interpretExit('probe', 3).continue).toBe(true);
    expect(interpretExit('probe', 1).continue).toBe(false);
    expect(interpretExit('windows', 75).message).toContain('FAILED');
  });
});
