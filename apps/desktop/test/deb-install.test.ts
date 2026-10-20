import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  debInstallCommand,
  describeDebFailure,
  dpkgDetail,
  failureBeforeReady,
  manualInstallCommand,
  missingDepends,
  parseDepends,
  READY_LINE,
  rootScript,
  sha512Hex,
  startDebInstall,
  type CommandRunner,
  type DebUpdate,
} from '../src/main/deb-install.ts';
import { signChannelFile } from '../src/main/update-signature.ts';

const sha512 = (data: string) => createHash('sha512').update(data).digest('base64');

describe('deb install: command line', () => {
  it('pkexec with the desktop agent only, the script as root, dpkg and never apt', () => {
    const hex = 'ab'.repeat(64);
    const channel = {
      yml: '/tmp/c/channel.yml',
      sig: '/tmp/c/channel.yml.sig',
      name: 'alpha-linux.yml',
    };
    const { command, args } = debInstallCommand({ file: '/home/u/x.deb' }, hex, channel);
    expect(command).toBe('/usr/bin/pkexec');
    expect(args.slice(0, 3)).toEqual(['--disable-internal-agent', '/bin/sh', '-c']);
    expect(args.slice(4)).toEqual([
      'monsters-update',
      '/home/u/x.deb',
      hex,
      '/tmp/c/channel.yml',
      '/tmp/c/channel.yml.sig',
      'alpha-linux.yml',
    ]);
    const script = args[3] ?? '';
    expect(script).toContain(`'/usr/bin/dpkg' -i "$dir/update.deb"`);
    expect(script).toContain("mktemp -d '/var/tmp/monsters-update.XXXXXXXX'");
    expect(script).toContain('sha512sum -c --status');
    expect(script).not.toMatch(/\bapt(-get)?\b|allow-unauthenticated/);
    // The signature with root's keys, the package's name and version, all before "ready".
    expect(script).toContain("for key in '/opt/Monsters/resources/update-keys'/*.pem; do");
    expect(script).toContain("'/usr/bin/openssl' pkeyutl -verify -pubin");
    // OpenSSL 3.0 at least, by its absolute path, before anything else.
    expect(script).toContain("[ -x '/usr/bin/openssl' ] || exit 96");
    expect(script).toContain(
      `case "$('/usr/bin/openssl' version 2>/dev/null)" in 'OpenSSL '[3-9].*`,
    );
    expect(script).toContain(`'/usr/bin/dpkg-deb' -f "$dir/update.deb" Package`);
    expect(script).toContain(`'/usr/bin/dpkg' --compare-versions "$new" gt "$old"`);
    for (const check of ['sha512sum', 'pkeyutl', 'dpkg-deb', '--compare-versions']) {
      expect(script.indexOf(check)).toBeLessThan(script.indexOf(READY_LINE));
    }
    // dpkg -i only after "go".
    expect(script.indexOf(READY_LINE)).toBeLessThan(script.indexOf("' -i "));
    // As root already (no pkexec): the same script.
    expect(debInstallCommand({ file: '/x.deb' }, hex, channel, { asRoot: true })).toEqual({
      command: '/bin/sh',
      args: [
        '-c',
        rootScript(),
        'monsters-update',
        '/x.deb',
        hex,
        channel.yml,
        channel.sig,
        channel.name,
      ],
    });
  });

  it('the hex of the feed sha512, the manual command quoted when needed', () => {
    const b64 = sha512('x');
    expect(sha512Hex(b64)).toBe(createHash('sha512').update('x').digest('hex'));
    expect(sha512Hex('deb-sha')).toBeNull();
    expect(manualInstallCommand('/home/u/.cache/m/Monsters-0.0.2-linux-amd64.deb')).toBe(
      'sudo apt install /home/u/.cache/m/Monsters-0.0.2-linux-amd64.deb',
    );
    expect(manualInstallCommand("/home/Andrea B/it's.deb")).toBe(
      `sudo apt install '/home/Andrea B/it'\\''s.deb'`,
    );
  });

  it('reads the exits of pkexec', () => {
    expect(failureBeforeReady(126, '')).toEqual({ kind: 'cancelled' });
    expect(
      failureBeforeReady(
        127,
        'Error executing command as another user: No authentication agent found.',
      ),
    ).toEqual({ kind: 'no-agent' });
    expect(
      failureBeforeReady(
        127,
        'Error executing command as another user: Not authorized\n\nThis incident has been reported.',
      ),
    ).toEqual({ kind: 'not-authorized' });
    expect(failureBeforeReady(91, '')).toEqual({ kind: 'mismatch' });
    expect(failureBeforeReady(93, '')).toEqual({ kind: 'signature' });
    expect(failureBeforeReady(94, '')).toEqual({ kind: 'not-ours' });
    expect(failureBeforeReady(95, '')).toEqual({ kind: 'not-newer' });
    expect(failureBeforeReady(96, '')).toEqual({ kind: 'openssl' });
  });

  it("keeps dpkg's own words", () => {
    // As seen in test-deb-update.sh (the app's binary immutable): the postinst's noise first.
    expect(
      dpkgDetail(
        'unshare: unshare failed: Operation not permitted\n' +
          "dpkg: error processing archive /var/tmp/m/update.deb (--install):\n unable to make backup link of './opt/Monsters/monsters' before installing new version: Operation not permitted\n" +
          'Errors were encountered while processing:\n /var/tmp/m/update.deb\n',
      ),
    ).toBe(
      'dpkg: error processing archive /var/tmp/m/update.deb (--install): unable to make backup ' +
        "link of './opt/Monsters/monsters' before installing new version: Operation not permitted",
    );
    expect(dpkgDetail('something\nelse\n')).toBe('something · else');
  });
});

// The root script for real, with a pkexec that does not elevate and a dpkg that records; the
// signature is checked by the real openssl, the package by fake dpkg-deb and dpkg-query.
const hasOpenssl = existsSync('/usr/bin/openssl') && existsSync('/usr/bin/dpkg');
describe.skipIf(process.platform !== 'linux' || !hasOpenssl)('deb install: the root script', () => {
  let dir = '';
  let pkexec = '';
  let dpkg = '';
  let dpkgDeb = '';
  let dpkgQuery = '';
  let workDir = '';
  let keysDir = '';
  let update: DebUpdate;
  const release = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');
  const channelFor = (deb: string) =>
    `version: 0.0.2\nfiles:\n  - url: Monsters-0.0.2-linux-amd64.deb\n    sha512: ${sha512(deb)}\n    size: ${deb.length}\n`;
  const calls = () =>
    existsSync(join(dir, 'dpkg.log')) ? readFileSync(join(dir, 'dpkg.log'), 'utf8') : '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'monsters-deb-'));
    // Root's folder for its copy (/var/tmp in the app).
    workDir = join(dir, 'root-work');
    mkdirSync(workDir);
    pkexec = join(dir, 'pkexec');
    dpkg = join(dir, 'dpkg');
    dpkgDeb = join(dir, 'dpkg-deb');
    dpkgQuery = join(dir, 'dpkg-query');
    // Root's copy of the trusted keys (/opt/Monsters/resources/update-keys in the app).
    keysDir = join(dir, 'keys');
    mkdirSync(keysDir);
    writeFileSync(
      join(keysDir, 'release-test.pem'),
      release.publicKey.export({ format: 'pem', type: 'spki' }),
    );
    // MODE: ok (run the command), cancel (126), no-agent (127).
    writeFileSync(
      pkexec,
      `#!/bin/sh
[ "$1" = --disable-internal-agent ] || { echo "pkexec: agent flag missing" >&2; exit 3; }
shift
case "$FAKE_PKEXEC" in
  cancel) echo 'Error executing command as another user: Request dismissed' >&2; exit 126;;
  no-agent) echo 'Error executing command as another user: No authentication agent found.' >&2; exit 127;;
esac
exec "$@"
`,
    );
    // Records its arguments and what the package it got contains (root's copy, not the cache);
    // --compare-versions is the real one.
    writeFileSync(
      dpkg,
      `#!/bin/sh
[ "$1" = --compare-versions ] && exec /usr/bin/dpkg "$@"
printf '%s\\n' "$*" >> '${join(dir, 'dpkg.log')}'
cat "$2" >> '${join(dir, 'dpkg.log')}'
[ "$FAKE_DPKG" = fail ] && { echo 'dpkg: error processing archive: dependency problems' >&2; exit 1; }
exit 0
`,
    );
    // The package's control fields, and the version installed.
    writeFileSync(
      dpkgDeb,
      `#!/bin/sh
[ "$1" = -f ] || exit 2
case $3 in
  Package) echo "\${FAKE_PACKAGE:-monsters}";;
  Version) echo "\${FAKE_VERSION:-0.0.2}";;
esac
`,
    );
    writeFileSync(dpkgQuery, '#!/bin/sh\necho "${FAKE_INSTALLED:-0.0.1}"\n');
    for (const f of [pkexec, dpkg, dpkgDeb, dpkgQuery]) chmodSync(f, 0o755);
    // The downloaded package in the user's cache (electron-updater's pending folder).
    mkdirSync(join(dir, 'cache'));
    const file = join(dir, 'cache', 'Monsters-0.0.2-linux-amd64.deb');
    writeFileSync(file, 'the 0.0.2 package\n');
    const text = channelFor('the 0.0.2 package\n');
    update = {
      version: '0.0.2',
      file,
      sha512: sha512('the 0.0.2 package\n'),
      url: null,
      channel: {
        name: 'alpha-linux.yml',
        text,
        signature: signChannelFile('alpha-linux.yml', text, [release.privateKey]),
      },
    };
    clearFakes();
  });

  const clearFakes = () => {
    for (const k of [
      'FAKE_PKEXEC',
      'FAKE_DPKG',
      'FAKE_PACKAGE',
      'FAKE_VERSION',
      'FAKE_INSTALLED',
    ]) {
      delete process.env[k];
    }
  };

  afterEach(() => {
    clearFakes();
    rmSync(dir, { recursive: true, force: true });
  });

  const start = () =>
    startDebInstall(update, {
      pkexec,
      dpkg,
      dpkgDeb,
      dpkgQuery,
      keysDir,
      workDir,
      tmpDir: dir,
      asRoot: false,
    });
  /** Left behind: root's work folder and the app's copies of the channel file, both empty. */
  const leftovers = () => [
    ...readdirSync(workDir),
    ...readdirSync(dir).filter((n) => n.startsWith('monsters-update-')),
  ];

  it('waits after the check, runs dpkg on its own copy after "go", leaves nothing behind', async () => {
    const run = start();
    expect(await run.ready).toBeNull();
    // Ready: the copy is checked, dpkg has not run (the core would be stopped now).
    expect(calls()).toBe('');
    expect(readdirSync(workDir)).toHaveLength(1);
    // Changing the user's file now changes nothing: root installs its checked copy.
    writeFileSync(update.file, 'something else\n');
    expect(await run.go()).toBeNull();
    const [args, content] = calls().split('\n');
    expect(args).toMatch(new RegExp(`^-i ${workDir}/monsters-update\\.\\w{8}/update\\.deb$`));
    expect(content).toBe('the 0.0.2 package');
    expect(leftovers()).toEqual([]);
  });

  it('a channel file signed by another key, or not signed: never ready (S-A4)', async () => {
    const text = update.channel!.text;
    update.channel = {
      ...update.channel!,
      signature: signChannelFile('alpha-linux.yml', text, [other.privateKey]),
    };
    expect(await start().ready).toEqual({ kind: 'signature' });
    update.channel = { ...update.channel, signature: '' };
    expect(await start().ready).toEqual({ kind: 'signature' });
    // The app has no signed channel file: root is never asked.
    update.channel = null;
    expect(await start().ready).toEqual({ kind: 'signature' });
    expect(calls()).toBe('');
    expect(leftovers()).toEqual([]);
  });

  it('a signature of another channel file, or a package the signed file does not list', async () => {
    const text = update.channel!.text;
    // The valid signature of alpha-linux-arm64.yml presented for alpha-linux.yml.
    update.channel = {
      name: 'alpha-linux.yml',
      text,
      signature: signChannelFile('alpha-linux-arm64.yml', text, [release.privateKey]),
    };
    expect(await start().ready).toEqual({ kind: 'signature' });
    // A correctly signed channel file that lists another package (with the app's own sha512).
    const otherText = channelFor('another package\n');
    update.channel = {
      name: 'alpha-linux.yml',
      text: otherText,
      signature: signChannelFile('alpha-linux.yml', otherText, [release.privateKey]),
    };
    expect(await start().ready).toEqual({ kind: 'signature' });
    expect(calls()).toBe('');
  });

  it('an OpenSSL older than 3.0, or none: its own failure, not a forged package (review wave 5, item 8)', async () => {
    // OpenSSL 1.1.1 (Debian 11, Ubuntu 20.04) has no `pkeyutl -rawin`.
    const old = join(dir, 'openssl-1.1');
    writeFileSync(
      old,
      `#!/bin/sh\n[ "$1" = version ] && { echo 'OpenSSL 1.1.1w  11 Sep 2023'; exit 0; }\nexec /usr/bin/openssl "$@"\n`,
    );
    chmodSync(old, 0o755);
    const run = (openssl: string) =>
      startDebInstall(update, {
        pkexec,
        dpkg,
        dpkgDeb,
        dpkgQuery,
        keysDir,
        workDir,
        tmpDir: dir,
        asRoot: false,
        openssl,
      });
    expect(await run(old).ready).toEqual({ kind: 'openssl' });
    expect(await run(join(dir, 'no-openssl')).ready).toEqual({ kind: 'openssl' });
    expect(calls()).toBe('');
    expect(leftovers()).toEqual([]);
    const dialog = describeDebFailure({ kind: 'openssl' });
    expect(dialog).toContain('OpenSSL 3.0');
    expect(dialog).not.toContain('manomesso');
  });

  it('a package that is not monsters, or not newer than the one installed: never ready', async () => {
    process.env['FAKE_PACKAGE'] = 'evil-tools';
    expect(await start().ready).toEqual({ kind: 'not-ours' });
    delete process.env['FAKE_PACKAGE'];
    process.env['FAKE_INSTALLED'] = '0.0.2';
    expect(await start().ready).toEqual({ kind: 'not-newer' });
    process.env['FAKE_INSTALLED'] = '0.1.0~alpha.13';
    process.env['FAKE_VERSION'] = '0.1.0~alpha.9';
    expect(await start().ready).toEqual({ kind: 'not-newer' });
    // The prereleases of electron-builder's .deb (0.1.0-alpha.14 → 0.1.0~alpha.14) in order.
    process.env['FAKE_VERSION'] = '0.1.0~alpha.14';
    const run = start();
    expect(await run.ready).toBeNull();
    run.cancel();
    expect(calls()).toBe('');
  });

  it('a package that does not match the feed: never ready, dpkg never runs', async () => {
    writeFileSync(update.file, 'changed after the download\n');
    const run = start();
    expect(await run.ready).toEqual({ kind: 'mismatch' });
    expect(await run.go()).toEqual({ kind: 'mismatch' });
    expect(calls()).toBe('');
    expect(leftovers()).toEqual([]);
  });

  it('the password cancelled or no agent: never ready, nothing run', async () => {
    process.env['FAKE_PKEXEC'] = 'cancel';
    expect(await start().ready).toEqual({ kind: 'cancelled' });
    process.env['FAKE_PKEXEC'] = 'no-agent';
    expect(await start().ready).toEqual({ kind: 'no-agent' });
    expect(calls()).toBe('');
  });

  it('dpkg failing: its exit and its last words', async () => {
    process.env['FAKE_DPKG'] = 'fail';
    const run = start();
    expect(await run.ready).toBeNull();
    expect(await run.go()).toEqual({
      kind: 'dpkg',
      code: 1,
      detail: 'dpkg: error processing archive: dependency problems',
    });
    expect(leftovers()).toEqual([]);
  });

  it('cancelled after ready: root exits without installing', async () => {
    const run = start();
    expect(await run.ready).toBeNull();
    run.cancel();
    await new Promise((r) => setTimeout(r, 300));
    expect(calls()).toBe('');
    expect(leftovers()).toEqual([]);
  });

  it('no pkexec on the computer: said at once', async () => {
    const run = startDebInstall(update, { pkexec: join(dir, 'none'), asRoot: false });
    expect(await run.ready).toEqual({ kind: 'no-pkexec' });
  });
});

describe('deb install: dependencies checked before the update is offered (review 18/10, item 23)', () => {
  it('reads Depends with alternatives, versions and architecture qualifiers', () => {
    expect(
      parseDepends('libgbm1 (>= 21), libasound2t64 | libasound2:amd64 (>= 1.0),\n xdg-utils'),
    ).toEqual([
      [{ name: 'libgbm1', op: '>=', version: '21' }],
      [{ name: 'libasound2t64' }, { name: 'libasound2', op: '>=', version: '1.0' }],
      [{ name: 'xdg-utils' }],
    ]);
  });

  /** dpkg-deb -f / dpkg-query / dpkg --compare-versions, as a computer with these packages. */
  const computer = (depends: string, installed: string[]): CommandRunner => {
    return (command, args) => {
      if (command.endsWith('dpkg-deb')) {
        return Promise.resolve({ code: 0, stdout: `Depends: ${depends}\n` });
      }
      if (command.endsWith('dpkg-query')) {
        return Promise.resolve({ code: 0, stdout: installed.join('\n') + '\n' });
      }
      // dpkg --compare-versions <have> <op> <need>: numeric comparison is enough here.
      const [, have, op, need] = args;
      const h = Number.parseFloat(have!);
      const n = Number.parseFloat(need!);
      return Promise.resolve({ code: (op === '>=' ? h >= n : h === n) ? 0 : 1, stdout: '' });
    };
  };
  const pkg = (name: string, version: string, provides = '') =>
    `${name}\t${version}\tii \t${provides}`;

  it('nothing missing: empty', async () => {
    const run = computer('libgbm1 (>= 21), xdg-utils', [
      pkg('libgbm1', '22'),
      pkg('xdg-utils', '1'),
    ]);
    expect(await missingDepends('/x.deb', run)).toEqual([]);
  });

  it('a missing package, a too old one, and an alternative or virtual package that is there', async () => {
    const run = computer(
      'libgbm1 (>= 21), libnew1 (>= 2), libasound2t64 | libasound2, dbus-session-bus, absent-lib | other-lib',
      [
        pkg('libgbm1', '20'),
        pkg('libnew1', '3'),
        pkg('libasound2', '1.2'),
        pkg('dbus-daemon', '1', 'dbus-session-bus'),
        // removed but configured: not installed
        'other-lib\t1\trc \t',
      ],
    );
    expect(await missingDepends('/x.deb', run)).toEqual([
      'libgbm1 (>= 21)',
      'absent-lib | other-lib',
    ]);
  });

  it('a virtual package with a version condition is met by the version its provider gives (review of 19/10, 19)', async () => {
    const run = computer('libasound2 (>= 1.2), libold (>= 2), libplain (>= 1)', [
      pkg('libasound2t64', '1.2.11', 'libasound2 (= 1.2.11)'),
      pkg('libold-new', '3', 'libold (= 1.5)'),
      pkg('libplain-impl', '1', 'libplain'),
    ]);
    expect(await missingDepends('/x.deb', run)).toEqual(['libold (>= 2)', 'libplain (>= 1)']);
  });

  it('a tool that does not answer never blocks an update', async () => {
    expect(
      await missingDepends('/x.deb', () => Promise.resolve({ code: 127, stdout: '' })),
    ).toEqual([]);
  });
});
