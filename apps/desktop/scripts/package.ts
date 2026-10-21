/*
 * Packages the desktop app with electron-builder (M3.4, D-046).
 *
 *   pnpm desktop:pack                      unpacked app for this system (release/<os>-unpacked)
 *   pnpm desktop:dist [--linux] [--win] [--mac] [options]
 *
 *   --linux        AppImage + deb (x64; --arch arm64 too)
 *   --win          NSIS installer, per user (x64), built on Linux; signing: MONSTERS_WIN_SIGN
 *   --mac          dmg + zip, arm64 and x64; only on a Mac (`pnpm desktop:dist:mac` builds on
 *                  a Mac via SSH, ci-mac.sh); signing: MONSTERS_MAC_IDENTITY, APPLE_API_*
 *   --arch <list>  x64,arm64 (default: x64 on Linux and Windows, arm64,x64 on macOS)
 *   --dir          unpacked app only (no installers)
 *   --target <t>   only these kinds, e.g. AppImage (default: all of the platform)
 *   --version <v>  version of the build (default: apps/desktop/package.json)
 *   --feed <url>   generic update feed (default MONSTERS_UPDATE_FEED; none → no updates); https,
 *                  or plain http on this computer
 *   --test-feed-host <host>  test builds: also allow a plain-http feed on this host (the update
 *                  e2e in the Windows VM uses 10.0.2.2)
 *   --test-build   update e2e build: the app reads MONSTERS_UPDATE_URL and
 *                  MONSTERS_UPDATE_AUTO_INSTALL (a published build ignores them)
 *   --update-test-key <pem>  test builds only: also trust this public key for the feed's
 *                  signature (the update e2e signs with a key pair of its own run)
 *   --build-only   only the build steps (web UI, core bundle, main and preload), no package:
 *                  the signed macOS build (scripts/mac-sign/sign-build.sh, as monsters-sign)
 *                  builds first with the keychain locked, then packages with --no-build
 *   --out <dir>    output folder (default apps/desktop/release)
 *   --no-build     reuse the core bundle and dist/ already built
 *
 * Steps: `pnpm build:core` (web UI + core bundle), the app's main and preload (scripts/build.ts),
 * a staged app in .package/app (package.json, dist, assets: what goes into app.asar), one staged
 * core per target in .package/core-<linux|mac|win>-<arch> (the bundle plus its native externals
 * installed for that platform with npm), then electron-builder. Signing is driven by the
 * environment, see package-config.ts and sign-windows.ts; docs in docs/signing.md.
 *
 * A build with a feed carries the public keys of the feed's signature in resources/update-keys
 * (S-A4): the release keys of build-resources/update-keys, plus the test key of an update e2e
 * build. Without any key it is refused: it could never accept an update.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Arch, build, Platform } from 'electron-builder';
import { normalizeModes } from './after-pack.ts';
import { buildDesktop } from './build.ts';
import {
  APP,
  buildLabels,
  macIdentityName,
  builderConfig,
  nodePlatform,
  PRODUCT_NAME,
  BUILD_INFO,
  selectUpdateKeys,
  type UpdateKeyFile,
  UPDATE_CHANNEL,
  type TargetArch,
  type TargetPlatform,
} from './package-config.ts';
import { isSafeFeedUrl } from '../src/main/updater.ts';
import { buildCoreManifest, CORE_MANIFESTS_DIR, manifestName } from '../src/main/core-integrity.ts';
import { TEST_SIGNING_DIR, verifyWithOsslsigncode } from './sign-windows.ts';

const ROOT = resolve(APP, '..', '..');
const BUNDLE = join(ROOT, 'packages', 'cli', 'dist-bundle');
const STAGE = join(APP, '.package');

/** Native externals of the bundle that the app ships, with their per-platform packages. */
const NATIVE: Record<string, (p: string, a: TargetArch) => string> = {
  '@node-rs/argon2': (p, a) => `@node-rs/argon2-${nativeSuffix(p, a)}`,
  '@napi-rs/keyring': (p, a) => `@napi-rs/keyring-${nativeSuffix(p, a)}`,
};

/**
 * Not shipped in the alpha (D-046): semantic search needs @huggingface/transformers with
 * onnxruntime-node and sharp, ~476 MB installed (all platforms) or ~90 MB pruned to one, plus a
 * ~120 MB model downloaded on first use. The vault falls back to full-text search.
 */
const LEFT_OUT = ['@huggingface/transformers'];

/**
 * Packages and staging are rebuilt from the repo (and weigh ~1 GB): the nightly restic backup of
 * the projects folder skips folders that carry this tag (--exclude-caches).
 */
function markAsCache(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'CACHEDIR.TAG'),
    'Signature: 8a477f597d28d172789f06886806bc55\n# Monsters desktop packages: rebuilt by pnpm desktop:dist\n',
  );
}

function nativeSuffix(platform: string, arch: TargetArch): string {
  if (platform === 'linux') return `linux-${arch}-gnu`;
  if (platform === 'win32') return `win32-${arch}-msvc`;
  return `darwin-${arch}`;
}

interface Args {
  platforms: TargetPlatform[];
  archs: TargetArch[] | null;
  dir: boolean;
  only: string[] | null;
  version: string;
  feed: string | null;
  testBuild: boolean;
  testKey: string | null;
  out: string;
  build: boolean;
  buildOnly: boolean;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function parse(argv: string[]): Args {
  const { values } = parseArgs({
    args: argv,
    options: {
      linux: { type: 'boolean', default: false },
      mac: { type: 'boolean', default: false },
      win: { type: 'boolean', default: false },
      arch: { type: 'string' },
      dir: { type: 'boolean', default: false },
      target: { type: 'string' },
      version: { type: 'string' },
      feed: { type: 'string' },
      'test-feed-host': { type: 'string' },
      'test-build': { type: 'boolean', default: false },
      'update-test-key': { type: 'string' },
      out: { type: 'string' },
      'no-build': { type: 'boolean', default: false },
      'build-only': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  const platforms: TargetPlatform[] = [];
  if (values.linux) platforms.push('linux');
  if (values.win) platforms.push('win');
  if (values.mac) platforms.push('mac');
  if (platforms.length === 0) {
    platforms.push(
      process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux',
    );
  }
  const archs = values.arch
    ? values.arch.split(',').map((a) => {
        if (a !== 'x64' && a !== 'arm64') throw new Error(`--arch: unknown architecture ${a}`);
        return a;
      })
    : null;
  const pkg = readJson<{ version: string }>(join(APP, 'package.json'));
  const version = values.version ?? pkg.version;
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`--version ${version}: not a semantic version`);
  }
  const feed = values.feed ?? process.env['MONSTERS_UPDATE_FEED'] ?? null;
  const testHosts = values['test-feed-host'] ? [values['test-feed-host']] : [];
  if (feed && !isSafeFeedUrl(feed, testHosts)) {
    throw new Error(`--feed ${feed}: not an https URL (plain http only on this computer)`);
  }
  return {
    platforms,
    archs,
    dir: values.dir,
    only: values.target ? values.target.split(',') : null,
    version,
    feed: feed || null,
    testBuild: values['test-build'],
    testKey: values['update-test-key'] ? resolve(values['update-test-key']) : null,
    out: resolve(values.out ?? join(APP, 'release')),
    build: !values['no-build'],
    buildOnly: values['build-only'],
  };
}

function run(command: string, args: string[], cwd = ROOT): void {
  // On Windows `pnpm` is a .cmd shim: only a shell finds it (an absolute path needs none).
  const shell = process.platform === 'win32' && !isAbsolute(command);
  execFileSync(command, args, { cwd, stdio: 'inherit', shell });
}

/** What goes into app.asar: the esbuild output, the icons, a package.json with no dependencies. */
function stageApp(version: string): string {
  const dir = join(STAGE, 'app');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'dist'), { recursive: true });
  for (const f of ['main.js', 'preload.cjs', 'keychain-helper.cjs']) {
    const src = join(APP, 'dist', f);
    if (!existsSync(src)) throw new Error(`missing ${relative(ROOT, src)}: run without --no-build`);
    cpSync(src, join(dir, 'dist', f));
  }
  cpSync(join(APP, 'assets'), join(dir, 'assets'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'monsters',
        productName: PRODUCT_NAME,
        version,
        description: 'Monsters: un team di agenti AI che lavora sul tuo computer',
        author: { name: 'Saturday Company' },
        homepage: 'https://saturdaycompany.it',
        license: 'Apache-2.0',
        type: 'module',
        main: 'dist/main.js',
        // Electron's Wayland app_id and X11 WM_CLASS: the .desktop file of the packages.
        desktopName: 'monsters.desktop',
      },
      null,
      2,
    )}\n`,
  );
  // The Linux packages copy modes as they are: the icon of a 0660 checkout was unreadable in
  // /usr/share/icons (no icon in the dock).
  normalizeModes(dir);
  return dir;
}

/** The public keys the build trusts, staged as the folder shipped in resources/update-keys. */
function stageUpdateKeys(keys: UpdateKeyFile[]): string | null {
  const dir = join(STAGE, 'update-keys');
  rmSync(dir, { recursive: true, force: true });
  if (keys.length === 0) return null;
  mkdirSync(dir, { recursive: true });
  for (const k of keys) writeFileSync(join(dir, k.name), k.pem, { mode: 0o644 });
  return dir;
}

/** npm of the Node running this script (`node npm-cli.js`, no shell). */
function npmCli(): string {
  const candidates = [
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`npm not found next to ${process.execPath}`);
  return found;
}

/** The core bundle for one target, with its native externals installed for that target. */
function stageCore(platform: TargetPlatform, arch: TargetArch): string {
  const np = nodePlatform(platform);
  const dir = join(STAGE, `core-${platform}-${arch}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(BUNDLE)) {
    if (entry === 'node_modules' || entry === 'package.json' || entry.endsWith('.map')) continue;
    cpSync(join(BUNDLE, entry), join(dir, entry), {
      recursive: true,
      filter: (src) => !src.endsWith('.map'),
    });
  }
  const bundlePkg = readJson<{
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  }>(join(BUNDLE, 'package.json'));
  const deps = { ...bundlePkg.dependencies };
  for (const name of Object.keys(deps)) {
    if (!(name in NATIVE)) throw new Error(`bundle external ${name} is not known to package.ts`);
  }
  for (const name of Object.keys(bundlePkg.optionalDependencies ?? {})) {
    if (!LEFT_OUT.includes(name)) {
      throw new Error(`optional external ${name}: ship it or add it to LEFT_OUT in package.ts`);
    }
  }
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'monsters-core',
        private: true,
        type: 'module',
        main: 'monsters.js',
        dependencies: deps,
      },
      null,
      2,
    )}\n`,
  );
  // Empty user and global npm configuration (two files: npm refuses the same one twice), so
  // nothing comes from this machine's .npmrc.
  const userrc = join(STAGE, 'user.npmrc');
  const globalrc = join(STAGE, 'global.npmrc');
  writeFileSync(userrc, '');
  writeFileSync(globalrc, '');
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !/^npm_config_/i.test(k)) env[k] = v;
  }
  execFileSync(
    process.execPath,
    [
      npmCli(),
      'install',
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      '--registry=https://registry.npmjs.org/',
      `--userconfig=${userrc}`,
      `--globalconfig=${globalrc}`,
      `--os=${np}`,
      `--cpu=${arch}`,
      ...(np === 'linux' ? ['--libc=glibc'] : []),
    ],
    { cwd: dir, env, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  for (const [name, platformPackage] of Object.entries(NATIVE)) {
    const pkg = platformPackage(np, arch);
    const nodeFiles = existsSync(join(dir, 'node_modules', pkg))
      ? readdirSync(join(dir, 'node_modules', pkg)).filter((f) => f.endsWith('.node'))
      : [];
    if (nodeFiles.length === 0)
      throw new Error(`${name}: no native binary ${pkg} for ${np}-${arch}`);
  }
  rmSync(join(dir, 'node_modules', '.package-lock.json'), { force: true });
  return dir;
}

/** Writes `core-manifests/<platform>-<arch>.json` of a staged core into the staged app. */
async function stageCoreManifest(
  appDir: string,
  platform: TargetPlatform,
  arch: TargetArch,
): Promise<void> {
  const np = nodePlatform(platform);
  const started = performance.now();
  const manifest = await buildCoreManifest(join(STAGE, `core-${platform}-${arch}`), {
    platform: np,
    arch,
  });
  const dir = join(appDir, CORE_MANIFESTS_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, manifestName(np, arch)), `${JSON.stringify(manifest)}\n`, {
    mode: 0o644,
  });
  process.stderr.write(
    `desktop: core manifest ${np}-${arch}: ${Object.keys(manifest.files).length} files (${Math.round(performance.now() - started)} ms)\n`,
  );
}

/**
 * NSIS from Linux without Wine. To sign the uninstaller electron-builder must get it out of the
 * installer: on macOS it reads it from the file (UninstallerReader, plain JS), elsewhere it runs
 * the installer under Wine. No Wine here (and the portable Wine of its `toolsets.wine` 1.0.1 lacks
 * its Windows DLLs on Linux): take the macOS branch, which only that check guards (D-046).
 */
function nsisWithoutWine(): void {
  if (process.platform !== 'linux') return;
  const req = createRequire(createRequire(import.meta.url).resolve('electron-builder'));
  const mod = req('app-builder-lib/out/util/macosVersion') as { isMacOsCatalina?: () => boolean };
  if (typeof mod.isMacOsCatalina !== 'function') {
    throw new Error(
      'electron-builder changed: cannot build NSIS without Wine (see nsisWithoutWine)',
    );
  }
  mod.isMacOsCatalina = () => true;
}

function toArch(a: TargetArch): Arch {
  return a === 'arm64' ? Arch.arm64 : Arch.x64;
}

function sizeOf(path: string): number {
  return statSync(path).size;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function duSize(path: string): number {
  const st = statSync(path);
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((n, e) => n + duSize(join(path, e)), 0);
}

export async function packageApp(argv: string[]): Promise<string[]> {
  const args = parse(argv);
  // Files written after afterPack (package-type, apparmor-profile, monsters.desktop) take their
  // mode from the umask: a 002 gave 0664 in the .deb.
  process.umask(0o022);
  if (args.platforms.includes('mac') && process.platform !== 'darwin') {
    throw new Error('macOS packages are built on a Mac: pnpm desktop:dist:mac (a Mac via SSH)');
  }
  const electronVersion = readJson<{ devDependencies: Record<string, string> }>(
    join(APP, 'package.json'),
  ).devDependencies['electron'];
  if (!electronVersion) throw new Error('no electron in apps/desktop devDependencies');
  if (args.buildOnly && !args.build) throw new Error('--build-only goes without --no-build');
  // Checked before the (long) build: a build with a feed and no key is refused.
  const updateKeys = selectUpdateKeys({
    feed: args.dir ? null : args.feed,
    testBuild: args.testBuild,
    testKey: args.testKey,
  });

  if (args.build) {
    // = pnpm build:core, with the version of this build (the core reports it, version.ts).
    run('pnpm', ['--filter', '@monsters/web', 'build']);
    run(process.execPath, [join(ROOT, 'scripts', 'build-core.ts'), '--version', args.version]);
    await buildDesktop();
    if (args.buildOnly) {
      process.stderr.write('desktop: built (--build-only), no package\n');
      return [];
    }
  } else if (!existsSync(join(BUNDLE, 'monsters.js'))) {
    throw new Error('no core bundle: run without --no-build');
  }

  const archsFor = (p: TargetPlatform): TargetArch[] =>
    args.platforms.includes(p) ? (args.archs ?? (p === 'mac' ? ['arm64', 'x64'] : ['x64'])) : [];
  markAsCache(STAGE);
  const appDir = stageApp(args.version);
  const updateKeysDir = stageUpdateKeys(updateKeys);
  for (const p of args.platforms) for (const a of archsFor(p)) stageCore(p, a);
  // The manifest of every staged core, inside app.asar (S-M9): the app checks resources/core
  // against it at every start; after-pack.ts checks the packed core against it.
  for (const p of args.platforms) {
    for (const a of archsFor(p)) await stageCoreManifest(appDir, p, a);
  }

  const config = builderConfig({
    version: args.version,
    appDir,
    stageDir: STAGE,
    output: args.out,
    electronVersion,
    feedUrl: args.feed,
    testBuild: args.testBuild,
    updateKeysDir,
    linuxArchs: archsFor('linux'),
    macArchs: archsFor('mac'),
    winArchs: archsFor('win'),
  });
  // electron-builder reads CSC_NAME itself and refuses the "Developer ID Application:" prefix.
  if (process.env['CSC_NAME']) process.env['CSC_NAME'] = macIdentityName(process.env['CSC_NAME']);
  const labels = buildLabels();
  const targets = new Map<Platform, Map<Arch, string[]>>();
  const platformOf = { linux: Platform.LINUX, mac: Platform.MAC, win: Platform.WINDOWS } as const;
  const kinds = { linux: ['AppImage', 'deb'], mac: ['dmg', 'zip'], win: ['nsis'] } as const;
  for (const p of args.platforms) {
    const byArch = new Map<Arch, string[]>();
    const wanted = kinds[p].filter((k) => !args.only || args.only.includes(k));
    if (!args.dir && wanted.length === 0) throw new Error(`--target: nothing to build for ${p}`);
    for (const a of archsFor(p)) byArch.set(toArch(a), args.dir ? ['dir'] : wanted);
    targets.set(platformOf[p], byArch);
  }

  process.stderr.write(
    `desktop: Monsters ${args.version} for ${args.platforms.join(', ')}` +
      `${args.feed ? `, updates from ${args.feed} (channel alpha)` : ', no update feed'}` +
      `${updateKeys.length > 0 ? `, update keys ${updateKeys.map((k) => k.name).join(', ')}` : ''}\n`,
  );
  if (args.platforms.includes('mac') && labels.macSigning.warning) {
    process.stderr.write(`desktop: macOS: ${labels.macSigning.warning}\n`);
  }
  if (args.platforms.includes('win')) {
    process.stderr.write(
      `desktop: Windows signature: ${labels.winSign}` +
        `${labels.winPublisher ? ` (publisher "${labels.winPublisher}" checked by the updater)` : ''}\n`,
    );
  }
  if (args.platforms.includes('win') && !args.dir) nsisWithoutWine();
  const artifacts = await build({
    projectDir: appDir,
    targets,
    config,
    publish: 'never',
  });
  // Only the default folder: an --out chosen by hand may hold things worth backing up.
  if (args.out === join(APP, 'release')) markAsCache(args.out);
  if (!args.dir) {
    recordBuild(args.out, {
      version: args.version,
      feed: args.feed,
      updateKeys: updateKeys.map((k) => k.id),
      testKeys: updateKeys.filter((k) => k.test).map((k) => k.id),
      testBuild: args.testBuild,
      platforms: args.platforms,
      archsFor,
    });
  }

  for (const f of artifacts) if (f.endsWith('.deb') && existsSync(f)) checkDebModes(f);
  if (args.platforms.includes('mac') && labels.macSigning.identity !== '-') {
    checkMacSignatures(args.out, labels.macSigning.notarize);
  }

  const lines = artifacts
    .filter((f) => existsSync(f))
    .map((f) => {
      let note = '';
      if (f.endsWith('.exe') && labels.winSign !== 'off') {
        const ca = labels.winSign === 'test' ? join(TEST_SIGNING_DIR, 'test-ca.crt') : undefined;
        const v = verifyWithOsslsigncode(f, ca);
        note = !v.signer
          ? '  NOT signed'
          : `  signed by ${v.signer}, ${v.verified ? 'verified' : v.intact ? 'intact (chain not trusted here)' : 'NOT intact'}`;
      }
      return `  ${relative(ROOT, f)}  ${mb(sizeOf(f))}${note}`;
    });
  for (const p of args.platforms) {
    for (const a of archsFor(p)) {
      lines.push(`  core-${p}-${a}: ${mb(duSize(join(STAGE, `core-${p}-${a}`)))} unpacked`);
    }
  }
  process.stderr.write(`desktop: artifacts\n${lines.join('\n')}\n`);
  return artifacts;
}

/**
 * Every file of the .deb must be readable by everyone: the packages copy modes from disk, and a
 * checkout with default ACLs once shipped an unreadable icon and package-type. Throws otherwise.
 */
export function checkDebModes(deb: string): void {
  let listing: string;
  try {
    listing = execFileSync('dpkg-deb', ['--contents', deb], {
      encoding: 'utf8',
      maxBuffer: 64 << 20,
    });
  } catch {
    process.stderr.write(
      `desktop: dpkg-deb not found, modes of ${relative(ROOT, deb)} not checked\n`,
    );
    return;
  }
  const bad = listing
    .split('\n')
    .filter((l) => l && !l.startsWith('l') && l[7] !== 'r')
    .map((l) => l.slice(l.lastIndexOf(' ') + 1));
  if (bad.length > 0) {
    throw new Error(
      `${relative(ROOT, deb)}: not readable by everyone: ${bad.slice(0, 10).join(', ')}`,
    );
  }
}

/**
 * electron-builder only warns when it cannot use the identity ("skipped macOS application code
 * signing") and the files still get the names of a signed build: every app in `out` must carry a
 * Developer ID signature, and a stapled ticket when notarized. Throws otherwise.
 */
export function checkMacSignatures(out: string, notarize: boolean): void {
  const apps = readdirSync(out, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('mac'))
    .flatMap((d) =>
      readdirSync(join(out, d.name))
        .filter((n) => n.endsWith('.app'))
        .map((n) => join(out, d.name, n)),
    );
  if (apps.length === 0) throw new Error(`${relative(ROOT, out)}: no macOS app to check`);
  for (const app of apps) {
    const name = relative(ROOT, app);
    try {
      execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
    } catch (err) {
      throw new Error(
        `${name}: signature not valid: ${String((err as { stderr?: unknown }).stderr ?? err)}`,
        { cause: err },
      );
    }
    // codesign -d writes the details on stderr.
    const details = spawnSync('codesign', ['-d', '--verbose=2', app], { encoding: 'utf8' });
    const info = `${details.stdout ?? ''}${details.stderr ?? ''}`;
    if (!/^Authority=Developer ID Application: /m.test(info)) {
      throw new Error(`${name}: not signed with a Developer ID Application identity`);
    }
    if (notarize) {
      try {
        execFileSync('xcrun', ['stapler', 'validate', app], { stdio: 'pipe' });
      } catch (err) {
        throw new Error(`${name}: no stapled notarization ticket`, { cause: err });
      }
    }
    process.stderr.write(
      `desktop: ${name}: Developer ID${notarize ? ', notarized and stapled' : ''}\n`,
    );
  }
}

/** The channel files electron-builder writes for a platform and architecture. */
export function channelFiles(p: TargetPlatform, archs: TargetArch[]): string[] {
  if (p === 'win') return archs.length > 0 ? [`${UPDATE_CHANNEL}.yml`] : [];
  if (p === 'mac') return archs.length > 0 ? [`${UPDATE_CHANNEL}-mac.yml`] : [];
  return archs.map((a) => `${UPDATE_CHANNEL}-linux${a === 'x64' ? '' : `-${a}`}.yml`);
}

/**
 * build-info.json in the output folder: the version and the feed of the build behind each channel
 * file, merged with what earlier builds into the same folder left. publish-update.ts refuses a
 * channel file whose build checks another feed for updates, does not trust the signing key
 * (`updateKeys`: the ids of the keys in its resources/update-keys), is a test build or trusts a
 * test key (`testBuild`, `testKeys`: review of wave 5, item 7).
 */
export function recordBuild(
  out: string,
  b: {
    version: string;
    feed: string | null;
    updateKeys: string[];
    testKeys: string[];
    testBuild: boolean;
    platforms: TargetPlatform[];
    archsFor: (p: TargetPlatform) => TargetArch[];
  },
): void {
  const file = join(out, BUILD_INFO);
  let info: Record<string, unknown> = {};
  try {
    info = JSON.parse(readFileSync(file, 'utf8')) as typeof info;
  } catch {
    // first build into this folder
  }
  const entry = {
    version: b.version,
    feed: b.feed,
    updateKeys: b.updateKeys,
    testKeys: b.testKeys,
    testBuild: b.testBuild,
  };
  for (const p of b.platforms) {
    for (const name of channelFiles(p, b.archsFor(p))) info[name] = entry;
  }
  writeFileSync(file, `${JSON.stringify(info, null, 2)}\n`);
}

if (import.meta.main) {
  try {
    await packageApp(process.argv.slice(2));
  } catch (err) {
    console.error(`desktop package: ${(err as Error).message}`);
    // Not process.exitCode: electron-builder's temp-file cleanup (async-exit-hook) ends the
    // process itself and the code was lost: a failed deb build exited 0 (M3.5).
    process.exit(1);
  }
}
