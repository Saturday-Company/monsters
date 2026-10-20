import { createHash, generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UPDATE_ORIGIN } from '../scripts/package-config.ts';
import {
  bridgeSignature,
  buildInfo,
  compareVersions,
  feedUrl,
  githubRelease,
  githubReleaseCommands,
  loadSigningKey,
  parseChannelFile,
  planRelease,
  releaseNotes,
} from '../scripts/publish-update.ts';
import { keyId, signChannelFile, verifyChannelFile } from '../src/main/update-signature.ts';
import { encryptSigningKey } from '../scripts/signing-key-file.ts';
import { tempDir } from './helpers.ts';

const FEED = feedUrl('desktop');
/** The release key of these tests: the builds of `release()` trust it. */
const RELEASE = generateKeyPairSync('ed25519');
const SIGNER = RELEASE.privateKey;

/** A release folder as `pnpm desktop:dist` leaves it: packages, channel files, build-info.json. */
function release(
  files: Record<string, string>,
  opts: {
    version?: string;
    feed?: string | null;
    lie?: 'size' | 'sha512';
    updateKeys?: string[];
    testBuild?: boolean;
    testKeys?: string[];
  } = {},
): string {
  const dir = tempDir();
  mkdirSync(dir, { recursive: true });
  const byChannel = new Map<string, string[]>();
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
    const channel = name.endsWith('.AppImage')
      ? 'alpha-linux.yml'
      : name.endsWith('.exe')
        ? 'alpha.yml'
        : name.endsWith('.zip')
          ? 'alpha-mac.yml'
          : null;
    if (channel) byChannel.set(channel, [...(byChannel.get(channel) ?? []), name]);
  }
  for (const [channel, names] of byChannel) {
    const entries = names.map((n) => {
      const body = Buffer.from(files[n] ?? '');
      const sha = createHash('sha512').update(body).digest('base64');
      const size = body.length + (opts.lie === 'size' ? 1 : 0);
      const lie = createHash('sha512').update('a lie').digest('base64');
      return `  - url: ${n}\n    sha512: ${opts.lie === 'sha512' ? lie : sha}\n    size: ${size}\n`;
    });
    writeFileSync(
      join(dir, channel),
      `version: ${opts.version ?? '0.1.0-alpha.2'}\nfiles:\n${entries.join('')}` +
        `path: ${names[0]}\nreleaseDate: '2026-10-15T08:00:00.000Z'\n`,
    );
  }
  if (opts.feed !== null) {
    const info = Object.fromEntries(
      [...byChannel.keys()].map((c) => [
        c,
        {
          version: opts.version ?? '0.1.0-alpha.2',
          feed: opts.feed ?? FEED,
          updateKeys: opts.updateKeys ?? [keyId(RELEASE.publicKey)],
          ...(opts.testBuild !== undefined ? { testBuild: opts.testBuild } : {}),
          ...(opts.testKeys ? { testKeys: opts.testKeys } : {}),
        },
      ]),
    );
    writeFileSync(join(dir, 'build-info.json'), JSON.stringify(info));
  }
  return dir;
}

const none = () => Promise.resolve(null);

describe('versions', () => {
  it('orders semantic versions with pre-releases like electron-updater', () => {
    const ordered = [
      '0.1.0-alpha.1',
      '0.1.0-alpha.2',
      '0.1.0-alpha.10',
      '0.1.0-alpha.beta',
      '0.1.0-beta',
      '0.1.0-beta.2',
      '0.1.0-rc.1',
      '0.1.0',
      '0.1.1',
      '0.2.0',
      '1.0.0',
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareVersions(ordered[i]!, ordered[i + 1]!)).toBeLessThan(0);
      expect(compareVersions(ordered[i + 1]!, ordered[i]!)).toBeGreaterThan(0);
    }
    expect(compareVersions('0.1.0-alpha.1', '0.1.0-alpha.1+build.5')).toBe(0);
    expect(compareVersions('0.1.0-alpha', '0.1.0-alpha.1')).toBeLessThan(0);
    expect(() => compareVersions('latest', '0.1.0')).toThrow(/semantic/);
  });
});

describe('channel files', () => {
  it('reads version and files, and refuses names that point elsewhere', () => {
    const ch = parseChannelFile(
      'alpha-linux.yml',
      'version: 0.1.0\nfiles:\n  - url: Monsters-0.1.0-linux-x86_64.AppImage\n    sha512: abc\n    size: 3\n',
    );
    expect(ch).toEqual({
      name: 'alpha-linux.yml',
      version: '0.1.0',
      files: [{ url: 'Monsters-0.1.0-linux-x86_64.AppImage', sha512: 'abc', size: 3 }],
    });
    for (const url of ['https://evil.example/x.AppImage', '../x.AppImage', 'a/b.exe', '.hidden']) {
      expect(() =>
        parseChannelFile(
          'alpha.yml',
          `version: 0.1.0\nfiles:\n  - url: '${url}'\n    sha512: a\n    size: 1\n`,
        ),
      ).toThrow(/plain name/);
    }
    expect(() => parseChannelFile('alpha.yml', 'files: []\n')).toThrow(/no version/);
  });

  it('reads version and feed of each build from build-info.json', () => {
    const dir = release({ 'Monsters-0.1.0-linux-x86_64.AppImage': 'x' }, { feed: 'https://f/x/' });
    expect(buildInfo(dir)['alpha-linux.yml']).toEqual({
      version: '0.1.0-alpha.2',
      feed: 'https://f/x/',
      updateKeys: [keyId(RELEASE.publicKey)],
    });
  });
});

describe('release plan', () => {
  it('uploads packages and blockmaps first, channel files last', async () => {
    const dir = release({
      'Monsters-0.1.0-alpha.2-linux-x86_64.AppImage': 'linux',
      'Monsters-Setup-0.1.0-alpha.2-x64.exe': 'windows',
      'Monsters-Setup-0.1.0-alpha.2-x64.exe.blockmap': 'map',
      'Monsters-0.1.0-alpha.2-mac-arm64.zip': 'arm',
      'Monsters-0.1.0-alpha.2-mac-x64.zip': 'intel',
    });
    const plan = await planRelease({
      dir,
      prefix: 'desktop',
      allowUnsigned: false,
      published: none,
      signer: SIGNER,
    });
    expect(plan.feed).toBe(`${UPDATE_ORIGIN}/desktop/`);
    expect(plan.payload.map((u) => u.key).sort()).toEqual([
      'desktop/Monsters-0.1.0-alpha.2-linux-x86_64.AppImage',
      'desktop/Monsters-0.1.0-alpha.2-mac-arm64.zip',
      'desktop/Monsters-0.1.0-alpha.2-mac-x64.zip',
      'desktop/Monsters-Setup-0.1.0-alpha.2-x64.exe',
      'desktop/Monsters-Setup-0.1.0-alpha.2-x64.exe.blockmap',
    ]);
    // Per channel file: the bridging signature (read back from the Worker before anything
    // else), the channel file, the final signature.
    expect(plan.metadata.map((u) => [u.key, u.checkServed === true])).toEqual([
      ['desktop/alpha-linux.yml.sig', true],
      ['desktop/alpha-linux.yml', false],
      ['desktop/alpha-linux.yml.sig', false],
      ['desktop/alpha-mac.yml.sig', true],
      ['desktop/alpha-mac.yml', false],
      ['desktop/alpha-mac.yml.sig', false],
      ['desktop/alpha.yml.sig', true],
      ['desktop/alpha.yml', false],
      ['desktop/alpha.yml.sig', false],
    ]);
    expect(plan.metadata[0]!.contentType).toMatch(/^text\/plain/);
    expect(plan.metadata[1]!.contentType).toMatch(/^text\/yaml/);
    // Each signature next to its channel file, valid for the release key.
    for (const name of ['alpha-linux.yml', 'alpha-mac.yml', 'alpha.yml']) {
      const sig = readFileSync(join(dir, `${name}.sig`), 'utf8');
      expect(
        verifyChannelFile(name, readFileSync(join(dir, name)), sig, [RELEASE.publicKey]),
      ).toMatchObject({ ok: true });
    }
  });

  it('refuses a build that checks another feed, or none', async () => {
    const other = release({ 'Monsters-0.1.0-linux-x86_64.AppImage': 'x' }, { feed: 'https://x/' });
    await expect(
      planRelease({
        dir: other,
        prefix: 'desktop',
        allowUnsigned: false,
        published: none,
        signer: SIGNER,
      }),
    ).rejects.toThrow(/checks https:\/\/x\/ for updates/);
    const no = release({ 'Monsters-0.1.0-linux-x86_64.AppImage': 'x' }, { feed: null });
    await expect(
      planRelease({
        dir: no,
        prefix: 'desktop',
        allowUnsigned: false,
        published: none,
        signer: SIGNER,
      }),
    ).rejects.toThrow(/not in build-info.json/);
    // The same build, published under another prefix: it would never find its updates.
    const ok = release({ 'Monsters-0.1.0-linux-x86_64.AppImage': 'x' });
    await expect(
      planRelease({
        dir: ok,
        prefix: 'e2e/1',
        allowUnsigned: false,
        published: none,
        signer: SIGNER,
      }),
    ).rejects.toThrow(/not .*\/e2e\/1\//);
  });

  it('refuses files whose size or sha512 differ from the channel file', async () => {
    for (const lie of ['size', 'sha512'] as const) {
      const dir = release({ 'Monsters-0.1.0-linux-x86_64.AppImage': 'x' }, { lie });
      await expect(
        planRelease({
          dir,
          prefix: 'desktop',
          allowUnsigned: false,
          published: none,
          signer: SIGNER,
        }),
      ).rejects.toThrow(lie === 'size' ? /1 bytes, alpha-linux.yml says 2/ : /sha512 differs/);
    }
  });

  it('never publishes test-signed or ad-hoc builds, unsigned ones only when asked', async () => {
    const test = release({ 'Monsters-Setup-0.1.0-x64-test-signed.exe': 'x' });
    await expect(
      planRelease({
        dir: test,
        prefix: 'desktop',
        allowUnsigned: true,
        published: none,
        signer: SIGNER,
      }),
    ).rejects.toThrow(/test-signed build cannot be published/);
    const adhoc = release({ 'Monsters-0.1.0-mac-arm64-adhoc.zip': 'x' });
    await expect(
      planRelease({
        dir: adhoc,
        prefix: 'desktop',
        allowUnsigned: true,
        published: none,
        signer: SIGNER,
      }),
    ).rejects.toThrow(/adhoc build cannot be published/);
    const unsigned = release({ 'Monsters-Setup-0.1.0-x64-unsigned.exe': 'x' });
    await expect(
      planRelease({
        dir: unsigned,
        prefix: 'desktop',
        allowUnsigned: false,
        published: none,
        signer: SIGNER,
      }),
    ).rejects.toThrow(/--allow-unsigned/);
    const plan = await planRelease({
      dir: unsigned,
      prefix: 'desktop',
      allowUnsigned: true,
      published: none,
      signer: SIGNER,
    });
    expect(plan.payload).toHaveLength(1);
  });

  it('only goes forward: a lower version never, the same one with --force', async () => {
    const dir = release({ 'Monsters-0.1.0-alpha.2-linux-x86_64.AppImage': 'x' });
    const on = (version: string) => () =>
      Promise.resolve(
        `version: ${version}\nfiles:\n  - url: a.AppImage\n    sha512: a\n    size: 1\n`,
      );
    const plan = (published: () => Promise<string>, force = false) =>
      planRelease({
        dir,
        prefix: 'desktop',
        allowUnsigned: false,
        published,
        force,
        signer: SIGNER,
      });
    await expect(plan(on('0.1.0-alpha.1'))).resolves.toBeTruthy();
    await expect(plan(on('0.1.0-alpha.2'))).rejects.toThrow(/--force/);
    await expect(plan(on('0.1.0-alpha.2'), true)).resolves.toBeTruthy();
    await expect(plan(on('0.1.0'), true)).rejects.toThrow(/not higher than 0.1.0/);
  });

  it('never publishes a test build, or one that trusts a test key (review wave 5, item 7)', async () => {
    const plan = (dir: string, prefix = 'desktop', testFeed?: boolean) =>
      planRelease({
        dir,
        prefix,
        allowUnsigned: false,
        published: none,
        signer: SIGNER,
        ...(testFeed ? { testFeed, origin: UPDATE_ORIGIN } : {}),
      });
    const files = { 'Monsters-0.1.0-alpha.2-linux-x86_64.AppImage': 'x' };
    await expect(plan(release(files, { testBuild: true }))).rejects.toThrow(
      /a test build \(--test-build\) cannot be published/,
    );
    await expect(plan(release(files, { testKeys: ['0123456789abcdef'] }))).rejects.toThrow(
      /trusts a test key \(0123456789abcdef\)/,
    );
    // Only the remote update e2e, on its own prefix, may put one on the feed.
    const e2e = release(files, {
      testBuild: true,
      testKeys: [keyId(RELEASE.publicKey)],
      feed: feedUrl('desktop/e2e-abc1'),
    });
    await expect(plan(e2e, 'desktop/e2e-abc1', true)).resolves.toBeTruthy();
    const official = release(files, { testBuild: true, testKeys: ['0123456789abcdef'] });
    await expect(plan(official, 'desktop', true)).rejects.toThrow(/test build/);
  });

  it('refuses a channel file the app would refuse', async () => {
    const dir = release({ 'Monsters-0.1.0-alpha.2-linux-x86_64.AppImage': 'x' });
    const text = readFileSync(join(dir, 'alpha-linux.yml'), 'utf8');
    writeFileSync(join(dir, 'alpha-linux.yml'), `${text}sha2: deadbeef\n`);
    await expect(
      planRelease({
        dir,
        prefix: 'desktop',
        allowUnsigned: false,
        published: none,
        signer: SIGNER,
      }),
    ).rejects.toThrow(/the app would refuse it \(a sha256/);
  });

  it('collects every problem at once', async () => {
    const dir = release(
      { 'Monsters-Setup-0.1.0-x64-unsigned.exe': 'x' },
      { feed: 'https://x/', lie: 'sha512' },
    );
    const err = await planRelease({
      dir,
      prefix: 'desktop',
      allowUnsigned: false,
      published: none,
      signer: SIGNER,
    }).catch((e: Error) => e);
    expect((err as Error).message.split('\n').length).toBe(4);
  });
});

describe('build info', () => {
  it('names the channel files electron-builder writes', async () => {
    const { channelFiles } = await import('../scripts/package.ts');
    expect(channelFiles('linux', ['x64', 'arm64'])).toEqual([
      'alpha-linux.yml',
      'alpha-linux-arm64.yml',
    ]);
    expect(channelFiles('win', ['x64'])).toEqual(['alpha.yml']);
    expect(channelFiles('mac', ['arm64', 'x64'])).toEqual(['alpha-mac.yml']);
    expect(channelFiles('mac', [])).toEqual([]);
  });

  it('refuses a channel file whose build has another version', async () => {
    const dir = release({ 'Monsters-0.1.0-linux-x86_64.AppImage': 'x' });
    writeFileSync(
      join(dir, 'build-info.json'),
      JSON.stringify({ 'alpha-linux.yml': { version: '0.1.0-alpha.1', feed: FEED } }),
    );
    await expect(
      planRelease({
        dir,
        prefix: 'desktop',
        allowUnsigned: false,
        published: none,
        signer: SIGNER,
      }),
    ).rejects.toThrow(/says version 0.1.0-alpha.1/);
  });
});

describe('signature of the channel files (S-A4)', () => {
  it('nothing is published without the signing key', async () => {
    const dir = release({ 'Monsters-0.1.0-linux-x86_64.AppImage': 'x' });
    await expect(
      planRelease({ dir, prefix: 'desktop', allowUnsigned: false, published: none, signer: null }),
    ).rejects.toThrow(/MONSTERS_UPDATE_SIGNING_KEY_CMD/);
  });

  it('refuses a key the build does not trust, and a build made before the signature', async () => {
    const stranger = generateKeyPairSync('ed25519').privateKey;
    const dir = release({ 'Monsters-0.1.0-linux-x86_64.AppImage': 'x' });
    await expect(
      planRelease({
        dir,
        prefix: 'desktop',
        allowUnsigned: false,
        published: none,
        signer: stranger,
      }),
    ).rejects.toThrow(new RegExp(`does not trust the signing key ${keyId(stranger)}`));
    const old = release({ 'Monsters-0.1.0-linux-x86_64.AppImage': 'x' }, { updateKeys: [] });
    await expect(
      planRelease({
        dir: old,
        prefix: 'desktop',
        allowUnsigned: false,
        published: none,
        signer: SIGNER,
      }),
    ).rejects.toThrow(/built before the signature/);
  });

  it('reads the key from an encrypted file (passphrase on the terminal) or from a command', async () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    const cost = { N: 2 ** 12, r: 8, p: 1 };
    const plain = join(dir, 'release.pem');
    writeFileSync(plain, RELEASE.privateKey.export({ format: 'pem', type: 'pkcs8' }), {
      mode: 0o600,
    });
    const file = join(dir, 'release.key');
    writeFileSync(file, encryptSigningKey(RELEASE.privateKey, 'quattro parole a caso', cost), {
      mode: 0o600,
    });
    const asked: string[] = [];
    const o = {
      minCost: cost,
      ask: (prompt: string) => {
        asked.push(prompt);
        return Promise.resolve('quattro parole a caso');
      },
    };
    expect(await loadSigningKey({}, o)).toBeNull();
    const fromFile = await loadSigningKey({ MONSTERS_UPDATE_SIGNING_KEY_FILE: file }, o);
    expect(fromFile && keyId(fromFile)).toBe(keyId(RELEASE.publicKey));
    expect(asked).toEqual(['Passphrase della chiave degli aggiornamenti: ']);
    // The default cost is the floor: a file made cheaper is refused.
    await expect(
      loadSigningKey({ MONSTERS_UPDATE_SIGNING_KEY_FILE: file }, { ask: o.ask }),
    ).rejects.toThrow(/scrypt cost/);
    await expect(
      loadSigningKey(
        { MONSTERS_UPDATE_SIGNING_KEY_FILE: file },
        { ...o, ask: () => Promise.resolve('sbagliata sbagliata') },
      ),
    ).rejects.toThrow(/wrong passphrase/);
    // A plain key in a file is refused: it would sit readable in the agents' user.
    await expect(loadSigningKey({ MONSTERS_UPDATE_SIGNING_KEY_FILE: plain }, o)).rejects.toThrow(
      /not an encrypted key file/,
    );
    // Publishing is done from Linux or macOS: the command runs under /bin/sh and the file modes
    // are POSIX, so the rest of this test does not apply on Windows.
    if (process.platform === 'win32') return;
    const fromCmd = await loadSigningKey({ MONSTERS_UPDATE_SIGNING_KEY_CMD: `cat '${plain}'` }, o);
    expect(fromCmd && keyId(fromCmd)).toBe(keyId(RELEASE.publicKey));
    const encryptedCmd = await loadSigningKey(
      { MONSTERS_UPDATE_SIGNING_KEY_CMD: `cat '${file}'` },
      o,
    );
    expect(encryptedCmd && keyId(encryptedCmd)).toBe(keyId(RELEASE.publicKey));
    await expect(loadSigningKey({ MONSTERS_UPDATE_SIGNING_KEY_CMD: 'exit 3' }, o)).rejects.toThrow(
      /failed \(exit 3\)/,
    );
    // The passphrase from a command (D-126: e.g. a session keyring), without a terminal.
    const pass = join(dir, 'pass.txt');
    writeFileSync(pass, 'quattro parole a caso\n', { mode: 0o600 });
    const fromKeyring = await loadSigningKey(
      {
        MONSTERS_UPDATE_SIGNING_KEY_FILE: file,
        MONSTERS_UPDATE_SIGNING_PASSPHRASE_CMD: `cat '${pass}'`,
      },
      { minCost: cost },
    );
    expect(fromKeyring && keyId(fromKeyring)).toBe(keyId(RELEASE.publicKey));
    await expect(
      loadSigningKey(
        {
          MONSTERS_UPDATE_SIGNING_KEY_FILE: file,
          MONSTERS_UPDATE_SIGNING_PASSPHRASE_CMD: 'exit 1',
        },
        { minCost: cost },
      ),
    ).rejects.toThrow(/PASSPHRASE_CMD failed \(exit 1\)/);
    await expect(
      loadSigningKey(
        { MONSTERS_UPDATE_SIGNING_KEY_FILE: file, MONSTERS_UPDATE_SIGNING_PASSPHRASE_CMD: 'true' },
        { minCost: cost },
      ),
    ).rejects.toThrow(/printed nothing/);
    {
      // The command's PATH is fixed: a `cat` dropped in a folder of the user's PATH is not run.
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'cat'), '#!/bin/sh\necho stolen >&2\nexit 7\n', { mode: 0o755 });
      const path = process.env['PATH'];
      process.env['PATH'] = `${bin}:${path ?? ''}`;
      try {
        const k = await loadSigningKey({ MONSTERS_UPDATE_SIGNING_KEY_CMD: `cat '${plain}'` }, o);
        expect(k && keyId(k)).toBe(keyId(RELEASE.publicKey));
      } finally {
        process.env['PATH'] = path;
      }
      chmodSync(file, 0o644);
      await expect(loadSigningKey({ MONSTERS_UPDATE_SIGNING_KEY_FILE: file }, o)).rejects.toThrow(
        /readable by others/,
      );
    }
    const rsa = join(dir, 'rsa.key');
    writeFileSync(
      rsa,
      generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({
        format: 'pem',
        type: 'pkcs8',
      }),
      { mode: 0o600 },
    );
    await expect(
      loadSigningKey({ MONSTERS_UPDATE_SIGNING_KEY_CMD: `cat '${rsa}'` }, o),
    ).rejects.toThrow(/Ed25519/);
  });
});

describe('publication without a gap in the signature (review wave 5, item 6)', () => {
  const OTHER = generateKeyPairSync('ed25519');
  const old = `version: 0.1.0-alpha.1\nfiles:\n  - url: a.AppImage\n    sha512: a\n    size: 1\n`;

  it('the bridging signature verifies the file on the feed and the new one', async () => {
    const dir = release({ 'Monsters-0.1.0-alpha.2-linux-x86_64.AppImage': 'x' });
    const oldSig = signChannelFile('alpha-linux.yml', old, [RELEASE.privateKey]);
    const feed: Record<string, string> = { 'alpha-linux.yml': old, 'alpha-linux.yml.sig': oldSig };
    const plan = await planRelease({
      dir,
      prefix: 'desktop',
      allowUnsigned: false,
      published: (name) => Promise.resolve(feed[name] ?? null),
      signer: SIGNER,
    });
    const [bridge, yml, final] = plan.metadata;
    const bridgeText = readFileSync(bridge!.file, 'utf8');
    const next = readFileSync(yml!.file, 'utf8');
    const keys = [RELEASE.publicKey];
    expect(verifyChannelFile('alpha-linux.yml', old, bridgeText, keys)).toMatchObject({ ok: true });
    expect(verifyChannelFile('alpha-linux.yml', next, bridgeText, keys)).toMatchObject({
      ok: true,
    });
    // The final one is the new signature alone.
    const finalText = readFileSync(final!.file, 'utf8');
    expect(finalText.split('\n').filter((l) => l.startsWith('key '))).toHaveLength(1);
    expect(verifyChannelFile('alpha-linux.yml', next, finalText, keys)).toMatchObject({ ok: true });
    expect(verifyChannelFile('alpha-linux.yml', old, finalText, keys)).toMatchObject({ ok: false });
  });

  it('carries over only lines that verify the file on the feed: it never signs it', () => {
    const next = signChannelFile('alpha-linux.yml', 'new', [RELEASE.privateKey]);
    const verifyKey = RELEASE.publicKey;
    // A forged file on the feed with a signature by another key, or none: nothing carried.
    const forged = signChannelFile('alpha-linux.yml', old, [OTHER.privateKey]);
    for (const signature of [forged, null, 'garbage']) {
      const b = bridgeSignature('alpha-linux.yml', next, { text: old, signature }, verifyKey);
      expect(b).toBe(next);
      expect(verifyChannelFile('alpha-linux.yml', old, b, [verifyKey]).ok).toBe(false);
    }
    expect(
      bridgeSignature('alpha-linux.yml', next, { text: null, signature: null }, verifyKey),
    ).toBe(next);
  });
});

describe('GitHub Release (D-145)', () => {
  const channel = (name: string, version: string) => ({ name, version, files: [] });
  const upload = (file: string) => ({
    key: `desktop/${file}`,
    file: `/r/${file}`,
    size: 1,
    contentType: 'x',
  });

  it('one tag per version, the packages without their blockmaps', () => {
    const plan = {
      channels: [
        channel('alpha-linux.yml', '0.1.0-alpha.19'),
        channel('alpha.yml', '0.1.0-alpha.19'),
      ],
      payload: [
        upload('Monsters-0.1.0-alpha.19-linux-x86_64.AppImage'),
        upload('Monsters-0.1.0-alpha.19-win-x64.exe'),
        upload('Monsters-0.1.0-alpha.19-win-x64.exe.blockmap'),
      ],
    };
    expect(githubRelease(plan)).toEqual({
      version: '0.1.0-alpha.19',
      tag: 'v0.1.0-alpha.19',
      assets: [
        '/r/Monsters-0.1.0-alpha.19-linux-x86_64.AppImage',
        '/r/Monsters-0.1.0-alpha.19-win-x64.exe',
      ],
    });
    expect(() =>
      githubRelease({
        channels: [channel('a.yml', '1.0.0'), channel('b.yml', '1.0.1')],
        payload: [],
      }),
    ).toThrow(/one version per GitHub Release/);
  });

  it('creates the release once (prerelease for an alpha), then uploads with --clobber', () => {
    const o = {
      repo: 'Saturday-Company/monsters',
      tag: 'v0.1.0-alpha.19',
      version: '0.1.0-alpha.19',
      assets: ['/r/a.AppImage', '/r/b.deb'],
      exists: false,
      target: 'abc123',
      notesFile: '/r/notes.md',
    };
    expect(githubReleaseCommands(o)).toEqual([
      [
        'release',
        'create',
        'v0.1.0-alpha.19',
        '--repo',
        'Saturday-Company/monsters',
        '--target',
        'abc123',
        '--title',
        'Monsters 0.1.0-alpha.19',
        '--notes-file',
        '/r/notes.md',
        '--prerelease',
      ],
      [
        'release',
        'upload',
        'v0.1.0-alpha.19',
        '/r/a.AppImage',
        '/r/b.deb',
        '--repo',
        'Saturday-Company/monsters',
        '--clobber',
      ],
    ]);
    // The second run (macOS) only adds its packages; a stable version is not a prerelease.
    expect(githubReleaseCommands({ ...o, exists: true })).toHaveLength(1);
    expect(githubReleaseCommands({ ...o, version: '1.0.0', tag: 'v1.0.0' })[0]).not.toContain(
      '--prerelease',
    );
  });

  it('takes the notes from the CHANGELOG section of the version', () => {
    const changelog =
      '# Changelog\n\n## 0.2.0 · 1 nov\n\n- Nuovo.\n\n## 0.1.0 · 1 ott\n\n- Vecchio.\n';
    expect(releaseNotes(changelog, '0.2.0')).toBe('- Nuovo.');
    expect(releaseNotes(changelog, '0.1.0')).toBe('- Vecchio.');
    expect(releaseNotes(changelog, '0.3.0')).toBe('Monsters 0.3.0. See CHANGELOG.md.');
    expect(releaseNotes(null, '0.3.0')).toBe('Monsters 0.3.0. See CHANGELOG.md.');
  });
});
