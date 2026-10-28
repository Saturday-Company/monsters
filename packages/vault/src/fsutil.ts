import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ToolError } from '@monsters/shared';
import { EXACT_PATHS, TMP_SUFFIX, pathId, type PathIdentity } from './paths.ts';

/** Content hash returned by `vault_read` and required as `base_hash` (sha-256, 16 hex chars). */
export function contentHash(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/** Git blob id of some content (sha-1 of "blob <len>\0<data>"). */
export function gitBlobOid(data: Uint8Array): string {
  return createHash('sha1').update(`blob ${data.byteLength}\0`).update(data).digest('hex');
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ToolError('ABORTED', 'stopped before writing: nothing was changed');
  }
}

/** True when `abs` (already resolved) is `root` or inside it. */
export function isWithin(root: string, abs: string): boolean {
  if (abs === root) return true;
  const rel = relative(root, abs);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * The same entry for the file system: without trailing separators, and where the file system
 * ignores case or Unicode form (see `probePathIdentity`), folded.
 */
function samePath(a: string, b: string, identity: PathIdentity): boolean {
  const norm = (p: string) => pathId(p.replace(/[\\/]+$/, '') || p, identity);
  return norm(a) === norm(b);
}

/**
 * Resolves a vault-relative path to an absolute one that is guaranteed to stay
 * inside the vault: the path is resolved with `realpath` (for a file that does
 * not exist yet, on its nearest existing ancestor) and the result must be
 * inside `realRoot`. Dangling links are refused too: following them on write
 * could create files outside the vault. A link inside the vault is refused as
 * well: the permissions (`Privato/`, the areas) are those of the path asked.
 * Run this before every I/O.
 */
export async function resolveInVault(
  realRoot: string,
  path: string,
  identity: PathIdentity,
): Promise<string> {
  const abs = join(realRoot, path);
  let probe = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(probe);
      if (!isWithin(realRoot, real)) break;
      const resolved = tail.length === 0 ? real : join(real, ...tail.reverse());
      // A link inside the vault (`Inbox/Link.md -> Privato/Diario.md`, `Agenti/Rhea/p ->
      // Privato`): the permissions are judged on the path asked, so it is never followed
      // (review of 18/10, B2). The vault neither lists nor indexes links either.
      if (!samePath(resolved, abs, identity)) {
        throw new ToolError(
          'BLOCKED_BY_POLICY',
          `${path} goes through a symbolic link inside the vault: links are not followed`,
          { hint: 'Use the path of the note itself (vault_search finds it).' },
        );
      }
      return resolved;
    } catch (err) {
      if (!isNotFound(err)) throw err;
      // A path component that exists but cannot be resolved is a dangling link.
      if (
        await lstat(probe).then(
          () => true,
          () => false,
        )
      )
        break;
      const parent = dirname(probe);
      if (parent === probe || !isWithin(realRoot, parent)) break;
      tail.push(probe.slice(parent.length + 1));
      probe = parent;
    }
  }
  throw new ToolError('BLOCKED_BY_POLICY', `${path} points outside the vault (symbolic link)`, {
    hint: 'Links that leave the vault folder are ignored: copy the file into the vault instead.',
  });
}

/**
 * Finds out how the file system under `root` compares names, by asking it: a probe file is
 * created in the vault's root (hidden and temporary, so neither the index nor Obsidian nor git
 * sees it) and looked up with another case and another Unicode form. Never assumed from the
 * platform. When the folder cannot be written (a read-only mount, a full disk), what the index
 * was built with (`recorded`) stands: a guess from the platform may differ from it and would
 * rebuild the index with the wrong folding, and again when the probe works. Without a record,
 * the usual behaviour of the platform is assumed: wider than needed is safe (more serialization,
 * no duplicates), narrower is not.
 */
export async function probePathIdentity(
  root: string,
  recorded?: PathIdentity | null,
): Promise<PathIdentity> {
  const guess: PathIdentity =
    recorded ??
    (process.platform === 'darwin'
      ? { foldCase: true, foldUnicode: true }
      : process.platform === 'win32'
        ? { foldCase: true, foldUnicode: false }
        : EXACT_PATHS);
  // Mixed case and a letter with a composed accent (e acute, U+00E9) that has a decomposed form.
  const accent = String.fromCodePoint(0xe9);
  const name = `.monsters-names-${randomBytes(4).toString('hex')}-aB${accent}${TMP_SUFFIX}`;
  try {
    await writeFile(join(root, name), '', { flag: 'wx' });
  } catch {
    return guess;
  }
  try {
    const seen = (other: string) =>
      stat(join(root, other)).then(
        () => true,
        () => false,
      );
    // Same name in another case, and in the other Unicode form: found means the same entry.
    return {
      foldCase: await seen(name.toLowerCase()),
      foldUnicode: await seen(name.normalize('NFD')),
    };
  } finally {
    await rm(join(root, name), { force: true });
  }
}

/**
 * Largest file the vault reads whole into memory (reading a note or an attachment to edit,
 * move or restore it) or hashes by content. Above this a file is only ever seen by its size
 * and modification time: `readFile` would fail past 2 GiB anyway (ERR_FS_FILE_TOO_LARGE).
 */
export const WHOLE_FILE_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Largest file the history records on its own (the first commit of an existing vault, the
 * snapshot of what the user changed outside Monsters): isomorphic-git reads and compresses a
 * file whole in memory. Bigger ones (videos) stay out of the history.
 */
export const GIT_AUTO_MAX_BYTES = 64 * 1024 * 1024;

/** Largest Markdown file whose content is parsed and indexed (links, tags, full text, vectors). */
export const NOTE_INDEX_MAX_BYTES = 8 * 1024 * 1024;

/** Reads a file whole; null if it does not exist. A file over `maxBytes` is refused, not read. */
export async function readIfExists(
  abs: string,
  maxBytes = WHOLE_FILE_MAX_BYTES,
): Promise<Buffer | null> {
  try {
    const st = await stat(abs);
    if (st.isFile() && st.size > maxBytes) {
      throw new ToolError(
        'INVALID_INPUT',
        `the file is too large to be read (${Math.round(st.size / 1024 / 1024)} MiB, the limit is ${Math.round(maxBytes / 1024 / 1024)} MiB)`,
        { hint: 'Large files such as videos are kept in the vault but never read by Monsters.' },
      );
    }
    return await readFile(abs);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** What is at a path before an action touches it. */
export interface Peeked {
  /** The content; null when there is no file, or when it is too big to be read (`big`). */
  bytes: Buffer | null;
  /** A file over `WHOLE_FILE_MAX_BYTES`: it exists and is never read, only renamed (D-214). */
  big: boolean;
}

/**
 * `readIfExists` that does not fail on a big file but reports it, so deleting or moving a big
 * attachment (a rename, no content needed) and listing a folder that holds one keep working.
 */
export async function peekFile(abs: string): Promise<Peeked> {
  try {
    const st = await stat(abs);
    if (st.isFile() && st.size > WHOLE_FILE_MAX_BYTES) return { bytes: null, big: true };
    return { bytes: await readFile(abs), big: false };
  } catch (err) {
    if (isNotFound(err)) return { bytes: null, big: false };
    throw err;
  }
}

/** What the index needs to know about a file on disk, without holding its content. */
export interface DiskFile {
  size: number;
  mtimeMs: number;
  /** Content hash (`contentHash`); for a file over `WHOLE_FILE_MAX_BYTES` a fingerprint of size and time. */
  hash: string;
}

/**
 * Size, time and hash of a file, or null if it does not exist (or is not a file). The content is
 * streamed through the hash, never held whole, so a video costs time but not memory; past
 * `WHOLE_FILE_MAX_BYTES` it is not read at all and the hash is `~size-mtime`.
 */
export async function hashOnDisk(abs: string): Promise<DiskFile | null> {
  let st;
  try {
    st = await stat(abs);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  if (!st.isFile()) return null;
  const base = { size: st.size, mtimeMs: st.mtimeMs };
  if (st.size > WHOLE_FILE_MAX_BYTES) {
    return { ...base, hash: `~${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}` };
  }
  const sha = createHash('sha256');
  try {
    for await (const chunk of createReadStream(abs)) sha.update(chunk as Buffer);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  return { ...base, hash: sha.digest('hex').slice(0, 16) };
}

export async function existsFile(abs: string): Promise<boolean> {
  try {
    return (await stat(abs)).isFile();
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

export function isNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Writes `data` to `abs` atomically: a temporary sibling file, then rename.
 * Obsidian sees a single change event. The temporary file never survives a
 * failure or an abort.
 */
export async function atomicWrite(
  abs: string,
  data: string | Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await mkdir(dirname(abs), { recursive: true });
  const tmp = `${abs}.${randomBytes(4).toString('hex')}${TMP_SUFFIX}`;
  try {
    await writeFile(tmp, data, { flag: 'wx' });
    throwIfAborted(signal);
    await renameWithRetry(tmp, abs);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Errors of a rename that may be transient: on Windows a file that another
 * program (Obsidian, the search indexer, an antivirus) holds open cannot be
 * replaced or moved for a moment (EPERM, EACCES, EBUSY).
 */
function isTransientRenameError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'EBUSY') return true;
  return process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES');
}

/** `rename` that retries briefly (under two seconds) while the file is held open by another program. */
export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      if (attempt >= 8 || !isTransientRenameError(err)) throw err;
      await sleep(20 * 2 ** Math.min(attempt, 4));
    }
  }
}
