import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ToolError } from '@monsters/shared';
import { TMP_SUFFIX } from './paths.ts';

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
 * The same entry for the file system: without trailing separators, and where
 * case and Unicode form do not count (macOS, Windows), folded.
 */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const trimmed = p.replace(/[\\/]+$/, '') || p;
    return process.platform === 'darwin' || process.platform === 'win32'
      ? trimmed.normalize('NFC').toLowerCase()
      : trimmed;
  };
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
export async function resolveInVault(realRoot: string, path: string): Promise<string> {
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
      if (!samePath(resolved, abs)) {
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

export async function readIfExists(abs: string): Promise<Buffer | null> {
  try {
    return await readFile(abs);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
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
