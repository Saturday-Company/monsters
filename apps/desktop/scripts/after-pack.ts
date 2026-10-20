/*
 * electron-builder `afterPack` hook (M3.4, D-046): flips the fuses of src/fuses.ts on the packed
 * Electron binary. electron-builder runs it after copying the app and the extra resources and
 * before signing, which is what the fuses need (they change the binary, the signature must
 * come after). Its own `electronFuses` option is not used because it cannot set every fuse of
 * src/fuses.ts (WasmTrapHandlers) nor `strictlyRequireAllFuses`.
 *
 * Can also be run by hand on a packed app:
 *
 *   node scripts/after-pack.ts <path to the app's Electron binary or .app>
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FuseState,
  FuseV1Options,
  flipFuses,
  getCurrentFuseWire,
  type FuseConfig,
} from '@electron/fuses';
import { FUSES } from '../src/fuses.ts';
import { checkCore, manifestName, parseCoreManifest } from '../src/main/core-integrity.ts';

/** The subset of electron-builder's AfterPackContext used here. */
export interface AfterPackContext {
  appOutDir: string;
  electronPlatformName: string;
  /** electron-builder's Arch: 0 ia32, 1 x64, 2 armv7l, 3 arm64, 4 universal. */
  arch?: number;
  packager: {
    appInfo: { productFilename: string };
    /** Linux packagers only: the executable (`monsters`). */
    executableName?: string;
  };
}

/** The file the fuses live in: the binary on Linux and Windows, the .app on macOS. */
export function electronBinary(context: AfterPackContext): string {
  const name = context.packager.appInfo.productFilename;
  switch (context.electronPlatformName) {
    case 'darwin':
    case 'mas':
      return `${context.appOutDir}/${name}.app`;
    case 'win32':
      return `${context.appOutDir}/${name}.exe`;
    default:
      return `${context.appOutDir}/${context.packager.executableName ?? name.toLowerCase()}`;
  }
}

export function fusesFor(platform: string): FuseConfig {
  return {
    ...FUSES,
    // Flipping a fuse breaks the ad-hoc signature Electron ships with; on Apple Silicon an
    // unsigned binary does not run. electron-builder signs again after this hook anyway.
    resetAdHocDarwinSignature: platform === 'darwin' || platform === 'mas',
  };
}

/**
 * Fuses of the wire read back from a binary that differ from `config` (names; empty when all
 * match). A fuse missing from the wire counts as different.
 */
export function fuseMismatches(wire: FuseConfig<FuseState>, config: FuseConfig): string[] {
  const out: string[] = [];
  const read = wire as unknown as Record<string, FuseState | undefined>;
  const want = config as unknown as Record<string, boolean | undefined>;
  for (const [name, index] of Object.entries(FuseV1Options)) {
    if (typeof index !== 'number' || want[index] === undefined) continue;
    const expected = want[index] ? FuseState.ENABLE : FuseState.DISABLE;
    if (read[index] !== expected) out.push(name);
  }
  return out;
}

/** Reads the fuses back from the flipped binary: a wrong one (RunAsNode on, S-M8) stops the build. */
export async function checkFuses(binary: string, config: FuseConfig): Promise<void> {
  const wrong = fuseMismatches(await getCurrentFuseWire(binary), config);
  if (wrong.length > 0) {
    throw new Error(`fuses not as in src/fuses.ts after flipping ${binary}: ${wrong.join(', ')}`);
  }
}

/**
 * Linux packages copy file modes as they are on disk: a checkout with default ACLs or a strict
 * umask gave a .deb whose /opt/Monsters was 0770 root:root (nobody else could start the app).
 * Directories and executables become 0755, everything else 0644; chrome-sandbox is left to the
 * deb's postinst (setuid only where user namespaces are missing).
 */
export function normalizeModes(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const st = lstatSync(path);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      chmodSync(path, 0o755);
      normalizeModes(path);
    } else if (entry !== 'chrome-sandbox') {
      chmodSync(path, st.mode & 0o111 ? 0o755 : 0o644);
    }
  }
}

/**
 * Drops the ACLs the packed app inherited from the checkout. A default ACL with `other::---`
 * (as on a shared /srv checkout) wins over the umask, so what electron-builder writes after this hook
 * (resources/package-type, read by the updater) came out 0660 root:root in the .deb.
 */
export function dropAcls(dir: string): void {
  try {
    execFileSync('setfacl', ['-R', '-b', dir], { stdio: 'ignore' });
  } catch {
    // No setfacl: no ACL tools, so most likely no ACLs either.
  }
}

const ARCHS: Record<number, string> = { 1: 'x64', 3: 'arm64' };

/** Where the core lands in the packed app. */
export function coreDir(context: AfterPackContext): string {
  const name = context.packager.appInfo.productFilename;
  return context.electronPlatformName === 'darwin' || context.electronPlatformName === 'mas'
    ? join(context.appOutDir, `${name}.app`, 'Contents', 'Resources', 'core')
    : join(context.appOutDir, 'resources', 'core');
}

/**
 * The native module of the core must be the one of the target (a Windows package once shipped
 * the Linux binary: the core did not start). Throws otherwise.
 */
export function checkCoreNatives(context: AfterPackContext): void {
  const arch = ARCHS[context.arch ?? 1];
  if (!arch) return;
  const suffix =
    context.electronPlatformName === 'win32'
      ? `win32-${arch}-msvc`
      : context.electronPlatformName === 'linux'
        ? `linux-${arch}-gnu`
        : `darwin-${arch}`;
  const pkg = join(coreDir(context), 'node_modules', '@node-rs', `argon2-${suffix}`);
  if (!existsSync(pkg)) {
    throw new Error(
      `the packed core has no ${pkg}: wrong or missing native modules for the target`,
    );
  }
}

/** `process.platform` of a target of electron-builder. */
function nodePlatformOf(electronPlatformName: string): string {
  return electronPlatformName === 'mas' ? 'darwin' : electronPlatformName;
}

/**
 * The packed resources/core is exactly the staged core the manifest in app.asar was made from
 * (S-M9): the app checks it at every start, so a file electron-builder dropped, added or changed
 * would keep the core from starting. Throws otherwise.
 */
export async function checkPackedCore(context: AfterPackContext, manifests: string): Promise<void> {
  const arch = ARCHS[context.arch ?? 1];
  if (!arch) return;
  const platform = nodePlatformOf(context.electronPlatformName);
  const file = join(manifests, manifestName(platform, arch));
  const manifest = existsSync(file) ? parseCoreManifest(readFileSync(file, 'utf8')) : null;
  if (!manifest) throw new Error(`no core manifest ${file}: package.ts writes it after staging`);
  const check = await checkCore(coreDir(context), manifest);
  if (!check.ok) {
    throw new Error(
      `the packed core does not match its manifest (${check.problem}: ${check.file}): the app would not start it`,
    );
  }
  process.stderr.write(
    `desktop: core ${platform}-${arch}: ${check.files} files match the manifest (checked in ${check.ms} ms)\n`,
  );
}

export default async function afterPack(
  context: AfterPackContext,
  options: { manifests?: string } = {},
): Promise<void> {
  checkCoreNatives(context);
  if (options.manifests) await checkPackedCore(context, options.manifests);
  if (context.electronPlatformName === 'linux') {
    dropAcls(context.appOutDir);
    chmodSync(context.appOutDir, 0o755);
    normalizeModes(context.appOutDir);
  }
  const fuses = fusesFor(context.electronPlatformName);
  await flipFuses(electronBinary(context), fuses);
  await checkFuses(electronBinary(context), fuses);
}

if (import.meta.main) {
  const binary = process.argv[2];
  if (!binary) {
    console.error('usage: node scripts/after-pack.ts <electron binary>');
    process.exit(2);
  }
  await flipFuses(binary, fusesFor(binary.endsWith('.app') ? 'darwin' : process.platform));
  console.warn(JSON.stringify(await getCurrentFuseWire(binary)));
}
