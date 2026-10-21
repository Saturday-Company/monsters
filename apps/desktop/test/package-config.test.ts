import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { electronBinary, fuseMismatches, fusesFor } from '../scripts/after-pack.ts';
import {
  builderConfig,
  buildLabels,
  macIdentityName,
  macSigning,
  RELEASE_KEYS_DIR,
  selectUpdateKeys,
} from '../scripts/package-config.ts';
import { jsignOptions, parseOsslsigncode, winSignMode } from '../scripts/sign-windows.ts';
import { FuseState, FuseV1Options, FuseVersion } from '@electron/fuses';
import { keyId, loadPublicKeys } from '../src/main/update-signature.ts';
import { tempDir } from './helpers.ts';

const base = {
  version: '0.1.0',
  appDir: '/stage/app',
  stageDir: '/stage',
  output: '/out',
  electronVersion: '44.7.1',
  feedUrl: null,
  linuxArchs: ['x64' as const],
  macArchs: ['arm64' as const, 'x64' as const],
  winArchs: ['x64' as const],
};

describe('package configuration', () => {
  it('ships the core outside the ASAR and never looks for updates without a feed', () => {
    const c = builderConfig({ ...base, env: {} });
    expect(c.appId).toBe('it.saturdaycompany.monsters');
    expect(c.productName).toBe('Monsters');
    expect(c.asar).toBe(true);
    expect(c.extraResources).toEqual([
      // Paths of the machine that builds (backslashes on Windows).
      { from: join('/stage', 'core-${os}-${arch}'), to: 'core', filter: ['**/*'] },
      {
        from: join('/stage', 'core-${os}-${arch}', 'node_modules'),
        to: 'core/node_modules',
        filter: ['**/*'],
      },
    ]);
    expect(c.publish).toBeNull();
    expect(c.npmRebuild).toBe(false);
  });

  it('publishes to a generic feed on the alpha channel', () => {
    const c = builderConfig({ ...base, feedUrl: 'https://updates.example/monsters', env: {} });
    expect(c.publish).toEqual([
      { provider: 'generic', url: 'https://updates.example/monsters', channel: 'alpha' },
    ]);
  });

  it('installs per user on Windows, without administrator rights', () => {
    const c = builderConfig({ ...base, env: {} });
    expect(c.nsis).toMatchObject({ oneClick: true, perMachine: false, allowElevation: false });
    // Unsigned alpha (D-040): no sign hook, no publisher check, labelled in the file name.
    expect(c.win?.signtoolOptions).toBeNull();
    expect(c.win?.verifyUpdateCodeSignature).toBe(false);
    expect(c.nsis?.artifactName).toContain('-unsigned');
  });

  it('ships the Windows installer in English and Italian, English first (D-153)', () => {
    const c = builderConfig({ ...base, env: {} });
    expect(c.nsis?.installerLanguages).toEqual(['en_US', 'it_IT']);
    expect(c.nsis?.language).toBe('1033');
  });

  it('describes the Linux packages in English, with an Italian comment', () => {
    const c = builderConfig({ ...base, env: {} });
    expect(c.linux?.synopsis).toBe('Local agent hub');
    expect(c.linux?.description).toMatch(/^Monsters: a team of AI agents/);
    expect(c.linux?.desktop?.entry).toMatchObject({
      Comment: 'Local agent hub',
      'Comment[it]': 'Hub agentico locale',
    });
  });

  it('signs ad-hoc on macOS without an identity, and says it', () => {
    expect(macSigning({})).toMatchObject({ identity: '-', notarize: false });
    const c = builderConfig({ ...base, env: {} });
    expect(c.mac).toMatchObject({ identity: '-', hardenedRuntime: false, notarize: false });
    expect(c.mac?.artifactName).toContain('-adhoc');
  });

  it('signs with the Developer ID and notarizes only with the API key', () => {
    const id = 'Developer ID Application: Giulio Banchini (TEAMID1234)';
    expect(macSigning({ MONSTERS_MAC_IDENTITY: id })).toMatchObject({
      identity: id,
      notarize: false,
      warning: expect.stringContaining('not notarized') as string,
    });
    const env = {
      MONSTERS_MAC_IDENTITY: id,
      APPLE_API_KEY: '/k/AuthKey_X.p8',
      APPLE_API_KEY_ID: 'X',
      APPLE_API_ISSUER: 'uuid',
    };
    const c = builderConfig({ ...base, env });
    // electron-builder refuses the kind in the name ("Please remove prefix").
    expect(c.mac).toMatchObject({
      identity: 'Giulio Banchini (TEAMID1234)',
      hardenedRuntime: true,
      notarize: true,
    });
    expect(buildLabels(env).mac).toBe('');
  });

  it('takes the certificate of a .p12 (CSC_LINK) when no identity is named', () => {
    const c = builderConfig({ ...base, env: { CSC_LINK: '/secrets/id.p12' } });
    expect(c.mac).not.toHaveProperty('identity');
    expect(c.mac).toMatchObject({ hardenedRuntime: true, notarize: false });
  });

  it('notarizes with the API key stored in a keychain (no .p8 on disk, S-A5)', () => {
    const env = {
      CSC_NAME: 'Developer ID Application: Giulio Banchini (TEAMID1234)',
      CSC_KEYCHAIN: '/Users/monsters-sign/Library/Keychains/monsters-signing.keychain-db',
      APPLE_KEYCHAIN_PROFILE: 'monsters-notary',
    };
    expect(macSigning(env)).toMatchObject({ notarize: true, warning: null });
  });
});

describe('Windows signing', () => {
  it('reads the mode', () => {
    expect(winSignMode({})).toBe('off');
    expect(winSignMode({ MONSTERS_WIN_SIGN: 'test' })).toBe('test');
    expect(() => winSignMode({ MONSTERS_WIN_SIGN: 'signtool' })).toThrow(/off, test or jsign/);
  });

  it('passes the real keystore password through the environment, never on the command line', () => {
    const { args, env } = jsignOptions('jsign', {
      MONSTERS_JSIGN_STORETYPE: 'PKCS11',
      MONSTERS_JSIGN_KEYSTORE: '/etc/simplysign.cfg',
      MONSTERS_JSIGN_STOREPASS: 'secret-pin',
      MONSTERS_JSIGN_ALIAS: 'saturday',
    });
    expect(args).not.toContain('secret-pin');
    expect(args.join(' ')).toContain('--storepass env:MONSTERS_JSIGN_STOREPASS');
    expect(args.join(' ')).toContain('--tsaurl http://time.certum.pl');
    expect(env).toEqual({ MONSTERS_JSIGN_STOREPASS: 'secret-pin' });
    expect(() => jsignOptions('jsign', {})).toThrow(/MONSTERS_JSIGN_STORETYPE/);
  });

  it('needs the test certificate for test signing', () => {
    const dir = tempDir();
    expect(() => jsignOptions('test', {}, dir)).toThrow(/setup-signing\.sh --test-cert/);
  });

  it('reads osslsigncode', () => {
    const out = [
      'Signer #0:',
      '\tSubject: /CN=Monsters Test Signing (NON FIDATO)/O=Saturday Company (test)',
      'Current message digest    : 0A1B',
      'Calculated message digest : 0A1B',
      'Signature verification: ok',
      'Number of verified signatures: 1',
      'Succeeded',
    ].join('\n');
    expect(parseOsslsigncode(out)).toEqual({
      signer: '/CN=Monsters Test Signing (NON FIDATO)/O=Saturday Company (test)',
      intact: true,
      verified: true,
    });
    // Without the test certificate as CA: intact, chain not trusted.
    expect(parseOsslsigncode(out.replace('Succeeded', 'Failed'))).toMatchObject({
      intact: true,
      verified: false,
    });
    expect(
      parseOsslsigncode(
        out.replace('Calculated message digest : 0A1B', 'Calculated message digest : FFFF'),
      ).intact,
    ).toBe(false);
  });
});

describe('fuses at pack time', () => {
  it('turns RunAsNode off everywhere and resets the ad-hoc signature only on macOS', () => {
    for (const platform of ['linux', 'darwin', 'win32']) {
      // S-M8: the packaged binary is never a plain Node (ELECTRON_RUN_AS_NODE is ignored).
      expect(fusesFor(platform)[FuseV1Options.RunAsNode]).toBe(false);
      expect(fusesFor(platform)[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false);
      expect(fusesFor(platform)[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false);
    }
    expect(fusesFor('darwin').resetAdHocDarwinSignature).toBe(true);
    expect(fusesFor('win32').resetAdHocDarwinSignature).toBe(false);
  });

  it('checks the wire read back from the binary after flipping it', () => {
    const fuses = fusesFor('linux');
    const wire = { version: FuseVersion.V1 } as Record<string, unknown>;
    for (const [k, v] of Object.entries(fuses)) {
      if (/^\d+$/.test(k)) wire[k] = v ? FuseState.ENABLE : FuseState.DISABLE;
    }
    expect(fuseMismatches(wire as never, fuses)).toEqual([]);
    // A binary where RunAsNode stayed on (or a fuse the wire lacks) stops the build.
    wire[FuseV1Options.RunAsNode] = FuseState.ENABLE;
    delete wire[FuseV1Options.WasmTrapHandlers];
    expect(fuseMismatches(wire as never, fuses)).toEqual(['RunAsNode', 'WasmTrapHandlers']);
  });

  it('finds the binary of each platform', () => {
    const ctx = (platform: string) => ({
      appOutDir: '/o',
      electronPlatformName: platform,
      packager: { appInfo: { productFilename: 'Monsters' }, executableName: 'monsters' },
    });
    expect(electronBinary(ctx('linux'))).toBe('/o/monsters');
    expect(electronBinary(ctx('win32'))).toBe('/o/Monsters.exe');
    expect(electronBinary(ctx('darwin'))).toBe('/o/Monsters.app');
  });
});

describe('update keys of a build (S-A4)', () => {
  const pemOf = () =>
    generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const folder = (pems: string[]) => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    pems.forEach((p, i) => writeFileSync(join(dir, `k${i}.pem`), p));
    return dir;
  };

  it('ships the trusted keys as resources/update-keys', () => {
    const c = builderConfig({
      ...base,
      feedUrl: 'https://u/x',
      updateKeysDir: '/stage/keys',
      env: {},
    });
    expect(c.extraResources).toContainEqual({
      from: '/stage/keys',
      to: 'update-keys',
      filter: ['*.pem'],
    });
    // The .deb's root script verifies with openssl.
    expect(c.deb?.depends).toContain('openssl (>= 3.0.0)');
  });

  it('a build with a feed needs a release key; a test key only in a test build', () => {
    const empty = folder([]);
    expect(() =>
      selectUpdateKeys({ feed: 'https://u/x', testBuild: false, testKey: null, releaseDir: empty }),
    ).toThrow(/no update signing key/);
    // No feed, no updates: no key needed.
    expect(
      selectUpdateKeys({ feed: null, testBuild: false, testKey: null, releaseDir: empty }),
    ).toEqual([]);
    const releaseDir = folder([pemOf()]);
    const keys = selectUpdateKeys({
      feed: 'https://u/x',
      testBuild: false,
      testKey: null,
      releaseDir,
    });
    expect(keys).toHaveLength(1);
    expect(keys[0]!.name).toMatch(/^release-[0-9a-f]{16}\.pem$/);
    const test = join(folder([pemOf()]), 'k0.pem');
    expect(() =>
      selectUpdateKeys({ feed: 'https://u/x', testBuild: false, testKey: test, releaseDir }),
    ).toThrow(/only for a --test-build/);
    const withTest = selectUpdateKeys({
      feed: 'http://127.0.0.1:1/',
      testBuild: true,
      testKey: test,
      releaseDir: empty,
    });
    expect(withTest.map((k) => k.name.split('-')[0])).toEqual(['test']);
    expect(() =>
      selectUpdateKeys({
        feed: 'http://127.0.0.1:1/',
        testBuild: true,
        testKey: null,
        releaseDir: empty,
      }),
    ).toThrow(/--update-test-key/);
  });

  it('the keys a build ships are the ones the app reads back (review wave 5, item 11)', () => {
    const releaseDir = folder([pemOf(), pemOf()]);
    const test = join(folder([pemOf()]), 'k0.pem');
    const keys = selectUpdateKeys({
      feed: 'http://127.0.0.1:1/',
      testBuild: true,
      testKey: test,
      releaseDir,
    });
    expect(keys.map((k) => k.test)).toEqual([false, false, true]);
    // What package.ts stages into resources/update-keys, read as the app reads it.
    const staged = tempDir();
    mkdirSync(staged, { recursive: true });
    for (const k of keys) writeFileSync(join(staged, k.name), k.pem);
    const bad: string[] = [];
    const read = loadPublicKeys(staged, (f) => bad.push(f)).map(keyId);
    expect(read.sort()).toEqual(keys.map((k) => k.id).sort());
    expect(bad).toEqual([]);
    // A broken file among the release keys stops the build, not the app's updates.
    writeFileSync(join(releaseDir, 'zz-broken.pem'), '-----BEGIN PUBLIC KEY-----\nx\n');
    expect(() =>
      selectUpdateKeys({ feed: 'https://u/x', testBuild: false, testKey: null, releaseDir }),
    ).toThrow();
  });

  it('refuses a key that is not an Ed25519 public key', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 })
      .publicKey.export({ format: 'pem', type: 'spki' })
      .toString();
    expect(() =>
      selectUpdateKeys({
        feed: 'https://u/x',
        testBuild: false,
        testKey: null,
        releaseDir: folder([rsa]),
      }),
    ).toThrow(/Ed25519/);
  });

  it('the repo has no private key among the release keys', () => {
    for (const name of existsSync(RELEASE_KEYS_DIR) ? readdirSync(RELEASE_KEYS_DIR) : []) {
      expect(readFileSync(join(RELEASE_KEYS_DIR, name), 'utf8')).not.toMatch(/PRIVATE KEY/);
    }
  });
});

describe('macIdentityName', () => {
  it('drops the kind electron-builder refuses, keeps the rest', () => {
    expect(macIdentityName('Developer ID Application: JANE DOE (ABCDE12345)')).toBe(
      'JANE DOE (ABCDE12345)',
    );
    expect(macIdentityName(' JANE DOE (ABCDE12345) ')).toBe('JANE DOE (ABCDE12345)');
  });
});
