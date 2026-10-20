/*
 * ci-mac.sh and the Apple signing secrets (review 18/10 S-A5, review 19/10 wave 5 item 2): the
 * user of the CI (`monsters-ci`) holds no secret. The signed build is a fixed script
 * (scripts/mac-sign/sign-build.sh, installed by root) run as `monsters-sign` through sudo, on a
 * checkout and an install of its own. Static checks of both scripts, the package block of the
 * runner run for real with stand-ins for sudo, git, pnpm, node and nice, and the argument checks
 * of the signer run for real.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = readFileSync(fileURLToPath(new URL('ci-mac.sh', import.meta.url)), 'utf8');
const SIGNER_PATH = fileURLToPath(new URL('mac-sign/sign-build.sh', import.meta.url));
const SIGNER_TEXT = readFileSync(SIGNER_PATH, 'utf8');
/** The signer's code, without its header comment. */
const SIGNER = SIGNER_TEXT.slice(SIGNER_TEXT.indexOf('\nset -u\n'));
const SHA = '0581d99aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RUN = '20261019-000359-0581d99-mac';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The runner's code only: what runs on the Mac as monsters-ci. */
const RUNNER = SCRIPT.slice(SCRIPT.indexOf("cat <<'RUNNER'"), SCRIPT.indexOf('\nRUNNER\n'));

describe('ci-mac.sh: monsters-ci holds no signing secret (wave 5, item 2)', () => {
  it('never reads secrets: no source, no set -a, no Apple variables', () => {
    expect(RUNNER).not.toContain('signing.env');
    expect(RUNNER).not.toMatch(/^\s*set -a$/m);
    expect(RUNNER).not.toMatch(/^\s*\.\s/m);
    expect(RUNNER).not.toMatch(/CSC_LINK|CSC_KEY_PASSWORD|APPLE_API_KEY|KEYCHAIN_PASSWORD/);
    // A leftover secrets/ folder is only told.
    expect(RUNNER).toContain('if [ -e "$R/secrets" ]; then');
  });

  it('the signed build goes through sudo to monsters-sign, with the sha and the run', () => {
    expect(RUNNER).toContain('SIGN_USER=monsters-sign');
    expect(RUNNER).toContain(
      'SIGNER="${CI_MAC_SIGNER:-/usr/local/libexec/monsters/sign-build.sh}"',
    );
    expect(RUNNER).toContain('sudo -n -u "$SIGN_USER" -H "$SIGNER" "$COMMIT" "$RUN" $sargs');
    // The clean environment of a run never carries the test overrides.
    const envLine = RUNNER.slice(
      RUNNER.indexOf('exec /usr/bin/env -i'),
      RUNNER.indexOf('/bin/bash "$0" run'),
    );
    expect(envLine).not.toContain('CI_MAC_SIGNER');
    expect(envLine).not.toContain('CI_MAC_SHARED');
  });

  function runPackageBlock(o: { signer: boolean; pkgArgs: string; secrets?: boolean }) {
    const dir = mkdtempSync(join(tmpdir(), 'monsters-ci-mac-'));
    dirs.push(dir);
    const bin = join(dir, 'bin');
    const log = join(dir, 'calls.log');
    const shared = join(dir, 'shared');
    mkdirSync(join(shared, 'inbox'), { recursive: true });
    mkdirSync(join(shared, 'outbox', RUN), { recursive: true });
    writeFileSync(join(shared, 'outbox', RUN, 'Monsters-0.1.0-arm64.dmg'), 'dmg');
    mkdirSync(join(dir, 'R', ...(o.secrets ? ['secrets'] : [])), { recursive: true });
    mkdirSync(join(dir, 'results', RUN), { recursive: true });
    mkdirSync(bin);
    const recorder = (name: string) =>
      `#!/bin/sh\necho "${name} $* ID=\${MONSTERS_MAC_IDENTITY:-}" >> '${log}'\n`;
    writeFileSync(join(bin, 'pnpm'), recorder('pnpm'));
    // node: the ad-hoc package step writes its dmg where it was told.
    writeFileSync(
      join(bin, 'node'),
      `${recorder('node')}while [ $# -gt 0 ]; do [ "$1" = --out ] && mkdir -p "$2" && touch "$2/M-adhoc.dmg"; shift; done\n`,
    );
    writeFileSync(join(bin, 'nice'), '#!/bin/sh\nshift 2\nexec "$@"\n');
    // sudo: `-l` answers whether the signer is allowed; a run is recorded.
    writeFileSync(
      join(bin, 'sudo'),
      `#!/bin/sh\ncase " $* " in *" -l "*) exit ${o.signer ? 0 : 1} ;; esac\necho "sudo $*" >> '${log}'\n`,
    );
    writeFileSync(
      join(bin, 'git'),
      `#!/bin/sh\necho "git $*" >> '${log}'\nfor a; do last=$a; done\n` +
        `case " $* " in *" bundle create "*) for a; do case $a in *.bundle) touch "$a";; esac; done;; esac\n`,
    );
    for (const f of ['pnpm', 'node', 'nice', 'sudo', 'git']) chmodSync(join(bin, f), 0o755);
    const signer = join(dir, 'sign-build.sh');
    writeFileSync(signer, '#!/bin/sh\n');
    chmodSync(signer, 0o755);
    // The package block of the runner, as it is in the script, up to its `exit`.
    const start = SCRIPT.indexOf('  if [ -e "$R/secrets" ]; then');
    const end = SCRIPT.indexOf('    cleanup\n    exit "$pcode"', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block =
      `say() { echo "say $*" >> '${log}'; }\nfatal() { echo "fatal $*" >> '${log}'; exit 2; }\n` +
      `f() {\n${SCRIPT.slice(start, end)}\necho "exit $pcode" >> '${log}'\nfi\n}\nf\n`;
    const r = spawnSync('/bin/bash', ['-c', block], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        R: join(dir, 'R'),
        RESULTS: join(dir, 'results'),
        REPO: join(dir, 'repo'),
        RUN,
        COMMIT: SHA,
        CI_MAC_MODE: 'package',
        CI_MAC_PKG_ARGS: o.pkgArgs,
        CI_MAC_SIGNER: signer,
        CI_MAC_SHARED: shared,
        SIGN_USER: 'monsters-sign',
        SIGNER: signer,
        SHARED: shared,
      },
    });
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    return { calls, dir, shared, signer, status: r.status };
  }

  it.skipIf(process.platform === 'win32')(
    'with the signer: a bundle of the commit, sudo to monsters-sign, the packages copied back',
    () => {
      const { calls, dir, shared, signer } = runPackageBlock({
        signer: true,
        pkgArgs:
          '--version 0.1.0 --feed https://monsters-updates.saturdaycompany.workers.dev/desktop/',
      });
      expect(calls).toEqual([
        `git -C ${join(dir, 'repo')} bundle create -q ${join(shared, 'inbox', `${RUN}.bundle`)} refs/ci-mac/run`,
        `say info signed build of ${SHA} as monsters-sign (${signer})`,
        `sudo -n -u monsters-sign -H ${signer} ${SHA} ${RUN} --version 0.1.0 --feed https://monsters-updates.saturdaycompany.workers.dev/desktop/`,
        `say results ${RUN}`,
        'exit 0',
      ]);
      // No install, no build, no node as monsters-ci.
      expect(calls.some((c) => c.startsWith('pnpm') || c.startsWith('node'))).toBe(false);
      expect(
        readFileSync(join(dir, 'results', RUN, 'artifacts', 'Monsters-0.1.0-arm64.dmg'), 'utf8'),
      ).toBe('dmg');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'with the signer: any other package option is refused before anything runs',
    () => {
      const { calls } = runPackageBlock({ signer: true, pkgArgs: '--version 0.1.0 --dir' });
      expect(calls).toEqual(['fatal the signed build takes only --version and --feed, not --dir']);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'without the signer: built here, ad-hoc, and a leftover secrets/ is told',
    () => {
      const { calls, dir } = runPackageBlock({
        signer: false,
        pkgArgs: '--version 0.1.0',
        secrets: true,
      });
      const artifacts = join(dir, 'results', RUN, 'artifacts');
      expect(calls[0]).toContain('WARNING');
      expect(calls.slice(1)).toEqual([
        expect.stringContaining('say info no signer'),
        'pnpm install --frozen-lockfile ID=',
        `node apps/desktop/scripts/package.ts --mac --version 0.1.0 --out ${artifacts} ID=-`,
        `say results ${RUN}`,
        'exit 0',
      ]);
      expect(calls.some((c) => c.startsWith('sudo'))).toBe(false);
    },
  );
});

describe('mac-sign/sign-build.sh: the fixed script of monsters-sign', () => {
  it('installs with --ignore-scripts on its own checkout, unlocks only around the packaging', () => {
    expect(SIGNER).toContain('pnpm install --frozen-lockfile --ignore-scripts');
    expect(SIGNER).not.toMatch(/pnpm install --frozen-lockfile\s*(<|\|\||$)/m);
    const fetch = SIGNER.indexOf('fetch -q --no-tags "$BUNDLE"');
    const check = SIGNER.indexOf('[ "$got" = "$SHA" ]');
    const install = SIGNER.indexOf('pnpm install --frozen-lockfile --ignore-scripts');
    const buildOnly = SIGNER.indexOf('--build-only');
    const unlock = SIGNER.indexOf('security unlock-keychain');
    const noBuild = SIGNER.indexOf('--no-build');
    const lock = SIGNER.indexOf('security lock-keychain', noBuild);
    expect(fetch).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(fetch);
    expect(install).toBeGreaterThan(check);
    expect(buildOnly).toBeGreaterThan(install);
    expect(unlock).toBeGreaterThan(buildOnly);
    expect(noBuild).toBeGreaterThan(unlock);
    expect(lock).toBeGreaterThan(noBuild);
    // The keychain password is cleared before the commit's code runs, and never in its env.
    expect(SIGNER.indexOf('KEYCHAIN_PASSWORD=\n', unlock)).toBeLessThan(noBuild);
    const runClean = SIGNER.slice(
      SIGNER.indexOf('run_clean() {'),
      SIGNER.indexOf('\n}\n', SIGNER.indexOf('run_clean() {')),
    );
    expect(runClean).toContain('/usr/bin/env -i');
    expect(runClean).not.toContain('PASSWORD');
    // signing.env is parsed, not sourced.
    expect(SIGNER).not.toMatch(/^\s*\.\s+"?\$ENV_FILE/m);
    expect(SIGNER).not.toMatch(/^\s*source\s/m);
    expect(SIGNER).not.toMatch(/^\s*set -a$/m);
  });

  it.skipIf(process.platform === 'win32')('checks its arguments before anything else', () => {
    const run = (...args: string[]) =>
      spawnSync('/bin/bash', [SIGNER_PATH, ...args], {
        encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin' },
      });
    const cases: [string[], string][] = [
      [[], 'usage'],
      [['HEAD', RUN], 'not a full commit sha'],
      [[SHA, 'x; rm -rf /'], 'not a run id'],
      [[SHA, '20261019-000359-1234567-mac'], 'is not of commit'],
      [[SHA, RUN, '--version', '1.0; id'], 'not a version'],
      [[SHA, RUN, '--feed', 'https://evil.example/'], '--feed: only'],
      [[SHA, RUN, '--dir'], 'unsupported argument'],
    ];
    for (const [args, message] of cases) {
      const r = run(...args);
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stderr).toContain(message);
    }
    // Good arguments, wrong user: refused before reading anything.
    const ok = run(SHA, RUN, '--version', '0.1.0-alpha.14');
    expect(ok.status).toBe(2);
    expect(ok.stderr).toContain('must run as monsters-sign');
    expect(execFileSync('/bin/bash', ['-n', SIGNER_PATH]).toString()).toBe('');
  });
});
