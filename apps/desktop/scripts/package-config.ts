/*
 * electron-builder configuration of the packages (M3.4, D-046), built from options and the
 * environment so that the same code makes local test builds and signed releases. Used by
 * scripts/package.ts; kept free of side effects so the tests can check it.
 */
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Configuration } from 'electron-builder';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { keyId, publicKeyFromPem, UPDATE_KEYS_DIR } from '../src/main/update-signature.ts';
import { CORE_MANIFESTS_DIR } from '../src/main/core-integrity.ts';
import afterPack from './after-pack.ts';
import {
  signWithJsign,
  testCertificateName,
  winSignMode,
  type WinSignMode,
} from './sign-windows.ts';

export const APP = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const APP_ID = 'it.saturdaycompany.monsters';
export const PRODUCT_NAME = 'Monsters';
/**
 * Update channel of the build: written as `channel:` in its `app-update.yml`, and the updater
 * reads `<channel>*.yml` from the feed. `alpha` until `MONSTERS_UPDATE_CHANNEL=beta` builds the
 * first beta: installed apps follow the channel of the file they carry, so the move from alpha
 * to beta is a last alpha-feed release built with that variable (see updater.ts).
 */
export const UPDATE_CHANNEL = channelFromEnv(process.env['MONSTERS_UPDATE_CHANNEL']);

export function channelFromEnv(value: string | undefined): string {
  const channel = value?.trim() || 'alpha';
  if (!/^[a-z0-9-]+$/.test(channel)) throw new Error(`MONSTERS_UPDATE_CHANNEL: "${channel}"`);
  return channel;
}
/**
 * Where the published updates live (D-050): the private R2 bucket below, served over https by the
 * Worker of apps/update-server. The alpha's feed is `${UPDATE_ORIGIN}/desktop/`.
 */
export const UPDATE_BUCKET = 'monsters-updates';
/** Written by package.ts next to the packages: version and feed behind each channel file. */
export const BUILD_INFO = 'build-info.json';
export const UPDATE_ORIGIN = 'https://monsters-updates.saturdaycompany.workers.dev';

/**
 * The public keys of the release signature of the feed (S-A4, docs/signing.md): `*.pem` here are
 * trusted by every build. Only public keys: the private one never enters the repo.
 */
export const RELEASE_KEYS_DIR = join(APP, 'build-resources', 'update-keys');

export interface UpdateKeyFile {
  /** File name in resources/update-keys. */
  name: string;
  pem: string;
  id: string;
  /** The key of an update e2e run (`--update-test-key`): such a build is never published. */
  test: boolean;
}

/**
 * The keys a build trusts: the release keys, plus `testKey` (a PEM file) for an update e2e build
 * only. A build with a feed and no key could never accept an update: refused.
 */
export function selectUpdateKeys(o: {
  feed: string | null;
  testBuild: boolean;
  testKey: string | null;
  releaseDir?: string;
}): UpdateKeyFile[] {
  const read = (file: string, kind: string): UpdateKeyFile => {
    const pem = readFileSync(file, 'utf8');
    const id = keyId(publicKeyFromPem(pem, file));
    return {
      name: `${kind}-${id}.pem`,
      pem: pem.endsWith('\n') ? pem : `${pem}\n`,
      id,
      test: kind === 'test',
    };
  };
  const dir = o.releaseDir ?? RELEASE_KEYS_DIR;
  const release = existsSync(dir)
    ? readdirSync(dir)
        .filter((n) => n.endsWith('.pem'))
        .sort()
        .map((n) => read(join(dir, n), 'release'))
    : [];
  if (o.testKey && !o.testBuild) {
    throw new Error(
      '--update-test-key: only for a --test-build (a published app trusts release keys only)',
    );
  }
  const keys = [...release, ...(o.testKey ? [read(o.testKey, 'test')] : [])];
  if (o.feed && keys.length === 0) {
    throw new Error(
      o.testBuild
        ? 'a test build with a feed needs --update-test-key <public key .pem> to verify its updates'
        : `no update signing key in ${dir}: a build with a feed could never accept an update ` +
            '(docs/signing.md, "Update signing")',
    );
  }
  return keys;
}

export type TargetPlatform = 'linux' | 'mac' | 'win';
export type TargetArch = 'x64' | 'arm64';

/** Node's platform name of a target (the `${platform}` macro of electron-builder). */
export function nodePlatform(p: TargetPlatform): 'linux' | 'darwin' | 'win32' {
  return p === 'mac' ? 'darwin' : p === 'win' ? 'win32' : 'linux';
}

export interface MacSigning {
  /**
   * "Developer ID Application: …", "-" (ad-hoc), or undefined: the one certificate of the .p12
   * in CSC_LINK (electron-builder imports it into a temporary keychain, the way to sign over SSH
   * where the login keychain is locked).
   */
  identity: string | undefined;
  notarize: boolean;
  /** Why the build is not signed and notarized for distribution, when it is not. */
  warning: string | null;
}

/**
 * macOS signing from the environment: MONSTERS_MAC_IDENTITY (or CSC_NAME) is the Developer ID
 * Application identity in the keychain (CSC_KEYCHAIN: which one); APPLE_API_KEY, APPLE_API_KEY_ID
 * and APPLE_API_ISSUER the App Store Connect API key for notarytool, or APPLE_KEYCHAIN_PROFILE
 * (and APPLE_KEYCHAIN) the same key stored in a keychain. Without an identity the build is signed ad-hoc (Apple
 * Silicon does not run unsigned code) and labelled as such.
 */
/**
 * electron-builder wants the identity (CSC_NAME, `mac.identity`) without its kind ("Developer ID Application: …" there is refused:
 * "Please remove prefix"), while `security find-identity` and docs/signing.md write it whole.
 */
export function macIdentityName(name: string): string {
  return name
    .trim()
    .replace(
      /^(?:Developer ID Application|Apple Development|Apple Distribution|Mac Developer|3rd Party Mac Developer Application):\s*/,
      '',
    );
}

export function macSigning(env: NodeJS.ProcessEnv = process.env): MacSigning {
  const named = (env['MONSTERS_MAC_IDENTITY'] || env['CSC_NAME'] || '').trim();
  const identity = named || (env['CSC_LINK'] ? undefined : '');
  if (identity === '' || identity === '-') {
    return {
      identity: '-',
      notarize: false,
      warning:
        'ad-hoc signature: Gatekeeper blocks it on other Macs and it cannot update itself (no Developer ID)',
    };
  }
  // The API key as files (APPLE_API_*), or stored in a keychain with `notarytool
  // store-credentials` (APPLE_KEYCHAIN_PROFILE, APPLE_KEYCHAIN: no .p8 on disk, docs/signing.md).
  const apiKey =
    ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'].every((k) => !!env[k]) ||
    !!env['APPLE_KEYCHAIN_PROFILE'];
  const notarize = apiKey && env['MONSTERS_MAC_NOTARIZE'] !== '0';
  return {
    identity,
    notarize,
    warning: notarize
      ? null
      : 'signed but not notarized (APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER missing): Gatekeeper warns on other Macs',
  };
}

export interface ConfigOptions {
  version: string;
  /** Folder with the staged app (package.json, dist/, assets/). */
  appDir: string;
  /** Folder with one staged core per target: `core-<linux|mac|win>-<arch>/`. */
  stageDir: string;
  output: string;
  electronVersion: string;
  /** Generic update feed; null builds packages that never look for updates. */
  feedUrl: string | null;
  /** The update e2e build: ships `update-test-build`, so the app reads the test environment. */
  testBuild?: boolean;
  /**
   * Folder with the public keys the build trusts for the feed's signature (`*.pem`, staged by
   * package.ts): shipped as resources/update-keys. Null: none (a build without a feed).
   */
  updateKeysDir?: string | null;
  linuxArchs: TargetArch[];
  macArchs: TargetArch[];
  winArchs: TargetArch[];
  env?: NodeJS.ProcessEnv;
}

export interface BuildLabels {
  mac: string;
  win: string;
  winSign: WinSignMode;
  macSigning: MacSigning;
  winPublisher: string | null;
}

export function buildLabels(env: NodeJS.ProcessEnv = process.env): BuildLabels {
  const mac = macSigning(env);
  const winSign = winSignMode(env);
  let winPublisher: string | null = null;
  if (winSign === 'jsign') winPublisher = env['MONSTERS_WIN_PUBLISHER_NAME']?.trim() || null;
  if (winSign === 'test') winPublisher = testCertificateName();
  return {
    // Builds that are not for distribution say so in their file name.
    mac: mac.identity === '-' ? '-adhoc' : mac.notarize ? '' : '-not-notarized',
    win: winSign === 'off' ? '-unsigned' : winSign === 'test' ? '-test-signed' : '',
    winSign,
    macSigning: mac,
    winPublisher,
  };
}

export function builderConfig(o: ConfigOptions): Configuration {
  const env = o.env ?? process.env;
  const labels = buildLabels(env);
  const mac = labels.macSigning;
  // The staged copy: its modes are normalized (stageApp), the checkout's may not be world-readable.
  const icon = join(o.appDir, 'assets', 'icon.png');
  const buildResources = join(APP, 'build-resources');
  return {
    appId: APP_ID,
    productName: PRODUCT_NAME,
    copyright: 'Copyright © 2026 Saturday Company',
    electronVersion: o.electronVersion,
    // The app is bundled by esbuild (scripts/build.ts): no node_modules, nothing to rebuild.
    npmRebuild: false,
    nodeGypRebuild: false,
    buildDependenciesFromSource: false,
    directories: { output: o.output, buildResources },
    files: ['**/*', '!**/*.map'],
    asar: true,
    // The core outside the ASAR (D-045, D-046): the utility process, its worker, the web UI it
    // serves and its native modules (argon2, keyring) are plain files in resources/core.
    extraResources: [
      {
        // `${os}` is the target (linux, mac, win); `${platform}` would be this machine's.
        from: join(o.stageDir, 'core-${os}-${arch}'),
        to: 'core',
        filter: ['**/*'],
      },
      // electron-builder always drops the top-level node_modules of a `from` folder: a second
      // entry copies it as a folder of its own.
      {
        from: join(o.stageDir, 'core-${os}-${arch}', 'node_modules'),
        to: 'core/node_modules',
        filter: ['**/*'],
      },
      // Only the update e2e builds: a published app ignores MONSTERS_UPDATE_URL and
      // MONSTERS_UPDATE_AUTO_INSTALL (updateSetup reads this file).
      ...(o.testBuild
        ? [{ from: join(buildResources, 'update-test-build'), to: 'update-test-build' }]
        : []),
      // The public keys of the feed's signature (S-A4): read by the updater and, in the .deb,
      // by the root script from /opt/Monsters/resources/update-keys (root's files).
      ...(o.updateKeysDir
        ? [{ from: o.updateKeysDir, to: UPDATE_KEYS_DIR, filter: ['*.pem'] }]
        : []),
    ],
    icon,
    afterPack: (context) => afterPack(context, { manifests: join(o.appDir, CORE_MANIFESTS_DIR) }),
    publish: o.feedUrl ? [{ provider: 'generic', url: o.feedUrl, channel: UPDATE_CHANNEL }] : null,
    detectUpdateChannel: false,
    // AppImage with the static type2 runtime (needs only fusermount3): the default one dlopens
    // libfuse.so.2, which Ubuntu 22.04+ no longer installs ("AppImages require FUSE to run").
    toolsets: { appimage: '1.0.3' },
    generateUpdatesFilesForAllChannels: false,

    linux: {
      target: [
        { target: 'AppImage', arch: o.linuxArchs },
        { target: 'deb', arch: o.linuxArchs },
      ],
      executableName: 'monsters',
      artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
      category: 'Development',
      maintainer: 'Saturday Company',
      vendor: 'Saturday Company',
      synopsis: 'Local agent hub',
      description: 'Monsters: a team of AI agents that works on your computer.',
      syncDesktopName: true,
      desktop: {
        entry: {
          Name: PRODUCT_NAME,
          Comment: 'Local agent hub',
          'Comment[it]': 'Hub agentico locale',
        },
      },
    },
    deb: {
      packageName: 'monsters',
      // electron-builder's after-install installs the AppArmor profile that lets Chromium's
      // sandbox create user namespaces on Ubuntu 24.04+ (D-045, D-046).
      priority: 'optional',
      packageCategory: 'utils',
      // electron-builder's list plus what Electron 44 links and the list misses (found by
      // scripts/test-deb.sh on a clean Ubuntu 24.04): ALSA and GBM.
      depends: [
        'libgtk-3-0',
        'libnotify4',
        'libnss3',
        'libxss1',
        'libxtst6',
        'xdg-utils',
        'libatspi2.0-0',
        'libuuid1',
        'libsecret-1-0',
        'libasound2t64 | libasound2',
        'libgbm1',
        // The root script of the updates checks the feed's signature with it (deb-install.ts):
        // Ed25519 with `pkeyutl -rawin` needs 3.0 (1.1.1 has neither).
        'openssl (>= 3.0.0)',
      ],
    },
    appImage: {
      artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
    },

    mac: {
      target: [
        { target: 'dmg', arch: o.macArchs },
        { target: 'zip', arch: o.macArchs },
      ],
      artifactName: `\${productName}-\${version}-\${os}-\${arch}${labels.mac}.\${ext}`,
      category: 'public.app-category.developer-tools',
      darkModeSupport: true,
      ...(mac.identity !== undefined ? { identity: macIdentityName(mac.identity) } : {}),
      // The hardened runtime is what notarization requires; an ad-hoc build skips it (library
      // validation with no Team ID would need disable-library-validation, D-046).
      hardenedRuntime: mac.identity !== '-',
      entitlements: join(buildResources, 'entitlements.mac.plist'),
      entitlementsInherit: join(buildResources, 'entitlements.mac.plist'),
      gatekeeperAssess: false,
      notarize: mac.notarize,
    },
    dmg: {
      artifactName: `\${productName}-\${version}-\${os}-\${arch}${labels.mac}.\${ext}`,
      sign: false,
    },

    win: {
      target: [{ target: 'nsis', arch: o.winArchs }],
      artifactName: `\${productName}-Setup-\${version}-\${arch}${labels.win}.\${ext}`,
      signtoolOptions:
        labels.winSign === 'off'
          ? null
          : {
              sign: (task) => signWithJsign(task),
              signingHashAlgorithms: ['sha256'],
              ...(labels.winPublisher ? { publisherName: labels.winPublisher } : {}),
            },
      verifyUpdateCodeSignature: labels.winPublisher !== null,
    },
    nsis: {
      // Per-user, no administrator rights, no questions (D-046).
      oneClick: true,
      perMachine: false,
      allowElevation: false,
      artifactName: `\${productName}-Setup-\${version}-\${arch}${labels.win}.\${ext}`,
      shortcutName: PRODUCT_NAME,
      uninstallDisplayName: PRODUCT_NAME,
      deleteAppDataOnUninstall: false,
      // English and Italian (D-153): NSIS picks the language of the Windows UI when it is one of
      // these and falls back to the first (English) for every other one.
      installerLanguages: ['en_US', 'it_IT'],
      language: '1033',
    },
  };
}
