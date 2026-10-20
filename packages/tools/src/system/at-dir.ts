import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readlink, realpath, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/*
 * The folders of a path between the checks of `fs_*` and the operation (review of 18/10, S-B4,
 * residual): a folder of the path swapped for a link after the checks would lead a `mkdir`, a
 * move or a delete outside the granted folders. Node has no `openat`/`renameat`/`mkdirat`, so:
 * on Linux the operation reaches the entry through its folder opened as a descriptor
 * (`/proc/self/fd/<n>/<name>`, resolved by the kernel from that folder, whatever happens to the
 * path meanwhile), after checking that the descriptor is the folder that was checked; elsewhere
 * the folder's real path is read again right before the operation (a smaller window, not none).
 */

/** A folder of the path is not the one that was checked any more (a link put in its place). */
export class PathChangedError extends Error {
  readonly folder: string;
  constructor(folder: string) {
    super(`${folder} changed while it was being used (a link in the path)`);
    this.folder = folder;
  }
}

const DIRECTORY = fsConstants.O_DIRECTORY ?? 0;
const NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

async function openFolder(folder: string): Promise<FileHandle> {
  try {
    return await open(folder, fsConstants.O_RDONLY | DIRECTORY | NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // The folder itself is a link now (ELOOP), or not a folder (ENOTDIR).
    if (code === 'ELOOP' || code === 'ENOTDIR' || code === 'EMLINK') {
      throw new PathChangedError(folder);
    }
    throw err;
  }
}

/**
 * Runs `op` on the entry `path`, whose folder was resolved to its real path by the checks,
 * through that folder: `op` gets the path to use (relative to the folder's descriptor on
 * Linux). Throws `PathChangedError` when the folder is not that real path any more.
 */
export async function atParent<T>(path: string, op: (p: string) => Promise<T>): Promise<T> {
  const folder = dirname(path);
  const name = basename(path);
  if (process.platform === 'linux') {
    const dir = await openFolder(folder);
    try {
      const now = await readlink(`/proc/self/fd/${dir.fd}`).catch(() => null);
      if (now !== null) {
        if (now !== folder) throw new PathChangedError(folder);
        return await op(join(`/proc/self/fd/${dir.fd}`, name));
      }
    } finally {
      await dir.close();
    }
  }
  const real = await realpath(folder).catch(() => null);
  if (real !== folder) throw new PathChangedError(folder);
  return op(path);
}

/**
 * `mkdir -p` of a folder whose path the checks resolved, one level at a time through the
 * folder above (`atParent`): a missing level is created in the folder that was checked, never
 * through a link put in place meanwhile. An existing level that is not a folder throws.
 */
export async function mkdirAt(folder: string): Promise<void> {
  const info = await lstat(folder).catch(() => null);
  if (info) {
    if (info.isDirectory()) return;
    throw new PathChangedError(folder);
  }
  const parent = dirname(folder);
  if (parent === folder) return;
  await mkdirAt(parent);
  await atParent(folder, async (p) => {
    try {
      await mkdir(p);
    } catch (err) {
      // Made meanwhile by another call: fine if it is a folder.
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (!(await lstat(p)).isDirectory()) throw new PathChangedError(folder);
    }
  });
}
