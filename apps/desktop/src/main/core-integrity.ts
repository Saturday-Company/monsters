import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { coreIntegrityStrings } from './core-integrity.strings.ts';

/*
 * The core of the packaged app runs from plain files in resources/core (D-045, D-046): its
 * JavaScript, its web UI, its node_modules and native modules. The ASAR is covered by the
 * integrity fuse, resources/core is not (review of 18/10, S-M9). So the package carries, inside
 * app.asar, a manifest of resources/core per target (`core-manifests/<platform>-<arch>.json`,
 * sha256 of every file, written by scripts/package.ts from the staged core and checked against
 * the packed one by scripts/after-pack.ts), and the app checks resources/core against it before
 * every start of the core: a file changed, added or missing and the core does not start.
 *
 * On macOS the native modules (`.node`, Mach-O) are signed in place after packing: their content
 * is not hashed, only their presence. The library validation of the hardened runtime refuses
 * one not signed with the app's Team ID (docs/security-model.md).
 *
 * The check narrows, it does not close, the window between check and start: who can write in
 * resources/core can change a file right after it (docs/security-model.md).
 */

export const CORE_MANIFESTS_DIR = 'core-manifests';

export interface CoreManifest {
  version: 1;
  /** `process.platform` and `process.arch` of the target. */
  platform: string;
  arch: string;
  /** Relative path (with `/`) → sha256 in hex, or `signed` (a native module signed after packing). */
  files: Record<string, string>;
  /** Relative path → target of a symbolic link. */
  links?: Record<string, string>;
}

export type CoreCheck =
  | { ok: true; files: number; ms: number }
  | {
      ok: false;
      problem: 'changed' | 'extra' | 'missing' | 'not_a_file' | 'manifest';
      /** Relative to resources/core (`/`), or the manifest's path for `manifest`. */
      file: string;
      ms: number;
    };

/** The manifest file of a target inside the app (`app.getAppPath()`). */
export function manifestName(platform: string, arch: string): string {
  return `${platform}-${arch}.json`;
}

/** Native modules whose content the target's signing changes after packing (macOS). */
function signedInPlace(platform: string, rel: string): boolean {
  return platform === 'darwin' && rel.endsWith('.node');
}

const toPosix = (rel: string) => rel.split(sep).join('/');

interface Entry {
  rel: string;
  kind: 'file' | 'link' | 'other';
}

/** Every entry of `dir`, links not followed, sorted. */
async function walk(dir: string): Promise<Entry[]> {
  const out: Entry[] = [];
  const queue = [dir];
  while (queue.length > 0) {
    const d = queue.shift()!;
    for (const item of await readdir(d, { withFileTypes: true })) {
      const full = join(d, item.name);
      const rel = toPosix(relative(dir, full));
      if (item.isSymbolicLink()) out.push({ rel, kind: 'link' });
      else if (item.isDirectory()) queue.push(full);
      else if (item.isFile()) out.push({ rel, kind: 'file' });
      else out.push({ rel, kind: 'other' });
    }
  }
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** Files up to this size are read in one go (faster than a stream for the core's ~150 files). */
const READ_WHOLE_BYTES = 32 * 1024 * 1024;

/** sha256 of a file, in hex. */
export async function sha256File(path: string): Promise<string> {
  const info = await lstat(path);
  if (info.size <= READ_WHOLE_BYTES) {
    return createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  }
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Runs `job` on every item, at most `limit` at a time; stops at the first non-null answer. */
async function firstOf<T, R>(
  items: readonly T[],
  limit: number,
  job: (item: T) => Promise<R | null>,
): Promise<R | null> {
  let next = 0;
  let found: R | null = null;
  const worker = async () => {
    while (found === null && next < items.length) {
      const item = items[next++]!;
      const r = await job(item);
      if (r !== null && found === null) found = r;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return found;
}

/** The manifest of a staged (or packed) core for a target. */
export async function buildCoreManifest(
  dir: string,
  target: { platform: string; arch: string },
): Promise<CoreManifest> {
  const files: Record<string, string> = {};
  const links: Record<string, string> = {};
  const entries = await walk(dir);
  for (const e of entries) {
    if (e.kind === 'other') throw new Error(`${e.rel}: not a file, a folder or a link`);
    if (e.kind === 'link') links[e.rel] = await readlink(join(dir, e.rel));
  }
  await firstOf(
    entries.filter((e) => e.kind === 'file'),
    16,
    async (e) => {
      files[e.rel] = signedInPlace(target.platform, e.rel)
        ? 'signed'
        : await sha256File(join(dir, e.rel));
      return null;
    },
  );
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    version: 1,
    platform: target.platform,
    arch: target.arch,
    files: sorted,
    ...(Object.keys(links).length > 0 ? { links } : {}),
  };
}

/** A manifest read from JSON, or null when it is not one. */
export function parseCoreManifest(text: string): CoreManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m['version'] !== 1 || typeof m['platform'] !== 'string' || typeof m['arch'] !== 'string') {
    return null;
  }
  const files = m['files'];
  if (!files || typeof files !== 'object' || Array.isArray(files)) return null;
  for (const v of Object.values(files)) {
    if (typeof v !== 'string' || !(v === 'signed' || /^[0-9a-f]{64}$/.test(v))) return null;
  }
  const links = m['links'];
  if (links !== undefined) {
    if (!links || typeof links !== 'object' || Array.isArray(links)) return null;
    for (const v of Object.values(links)) if (typeof v !== 'string') return null;
  }
  if (Object.keys(files).length === 0) return null;
  return raw as CoreManifest;
}

/**
 * Checks `dir` against the manifest: every file there with its hash, nothing more (a file, a
 * link or anything else not in it), nothing missing. Hashes are computed in parallel; the
 * first problem found is the answer.
 */
export async function checkCore(
  dir: string,
  manifest: CoreManifest,
  now: () => number = performance.now.bind(performance),
): Promise<CoreCheck> {
  const started = now();
  const fail = (problem: Exclude<CoreCheck, { ok: true }>['problem'], file: string): CoreCheck => ({
    ok: false,
    problem,
    file,
    ms: Math.round(now() - started),
  });
  let entries: Entry[];
  try {
    entries = await walk(dir);
  } catch {
    return fail('missing', '.');
  }
  const links = manifest.links ?? {};
  const seen = new Set<string>();
  for (const e of entries) {
    seen.add(e.rel);
    if (e.kind === 'other') return fail('not_a_file', e.rel);
    if (e.kind === 'link') {
      if (!(e.rel in links)) return fail('extra', e.rel);
      const target = await readlink(join(dir, e.rel)).catch(() => null);
      if (target !== links[e.rel]) return fail('changed', e.rel);
      continue;
    }
    if (!Object.hasOwn(manifest.files, e.rel)) return fail('extra', e.rel);
  }
  for (const rel of [...Object.keys(manifest.files), ...Object.keys(links)]) {
    if (!seen.has(rel)) return fail('missing', rel);
  }
  const changed = await firstOf(
    entries.filter((e) => e.kind === 'file' && manifest.files[e.rel] !== 'signed'),
    16,
    async (e) => {
      const hash = await sha256File(join(dir, e.rel)).catch(() => null);
      return hash === manifest.files[e.rel] ? null : e.rel;
    },
  );
  if (changed !== null) return fail('changed', changed);
  return { ok: true, files: entries.length, ms: Math.round(now() - started) };
}

/**
 * What the manifest says of a file of the core (`file` absolute, inside `coreDir`): its sha256,
 * `signed` (a native module signed after packing, macOS), or null when it is not in the
 * manifest (or not in the core). The keychain helper checks the keyring's binary with it right
 * before loading it (review of 19/10, n. 12).
 */
export function manifestHashOf(
  manifest: CoreManifest,
  coreDir: string,
  file: string,
): string | null {
  const rel = relative(coreDir, file);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return Object.hasOwn(manifest.files, toPosix(rel)) ? manifest.files[toPosix(rel)]! : null;
}

/** What the status page says of a failed check (in the app's language). */
export function checkProblemText(check: Exclude<CoreCheck, { ok: true }>): string {
  const t = coreIntegrityStrings();
  const where = check.problem === 'manifest' ? check.file : `resources/core/${check.file}`;
  switch (check.problem) {
    case 'changed':
      return t.changed(where);
    case 'extra':
      return t.extra(where);
    case 'missing':
      return t.missing(where);
    case 'not_a_file':
      return t.notAFile(where);
    case 'manifest':
      return t.manifest(where);
  }
}

/**
 * The check of the packaged app: the manifest of this platform and architecture from the app
 * (inside app.asar), then resources/core against it. A missing or unreadable manifest fails.
 */
export async function checkPackagedCore(o: {
  appPath: string;
  coreDir: string;
  platform?: string;
  arch?: string;
  read?: (path: string) => Promise<string>;
}): Promise<CoreCheck> {
  const platform = o.platform ?? process.platform;
  const arch = o.arch ?? process.arch;
  const file = join(o.appPath, CORE_MANIFESTS_DIR, manifestName(platform, arch));
  const read = o.read ?? ((p: string) => readFile(p, 'utf8'));
  const text = await read(file).catch(() => null);
  const manifest = text === null ? null : parseCoreManifest(text);
  if (!manifest || manifest.platform !== platform || manifest.arch !== arch) {
    return {
      ok: false,
      problem: 'manifest',
      file: `${CORE_MANIFESTS_DIR}/${manifestName(platform, arch)}`,
      ms: 0,
    };
  }
  // Exists before the walk: a missing folder says so.
  if (!(await lstat(o.coreDir).catch(() => null))?.isDirectory()) {
    return { ok: false, problem: 'missing', file: '.', ms: 0 };
  }
  return checkCore(o.coreDir, manifest);
}
