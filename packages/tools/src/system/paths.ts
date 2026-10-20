import { lstat, readlink, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, posix, resolve, win32 } from 'node:path';

/*
 * Containment checks for folders granted outside the vault (same approach as
 * the vault, DECISIONS D-023): `realpath` before any I/O, so a symlink that
 * leads out of a granted folder is refused.
 *
 * Two comparisons, each failing on the safe side. `isInside` (what an agent may
 * reach) compares real paths exactly: `realpath` already gives the spelling on
 * disk (case on Windows and macOS), and folding case or Unicode form would let
 * a twin folder (`/x/café` in NFD next to the granted NFC one, `/x/Work` next
 * to `/x/work` on a case-sensitive volume) pass for the granted one.
 * `mayBeInside` (what must stay out of reach: vault, data folder, granted
 * folders as targets of a move or delete) also folds Unicode form and, on
 * Windows and macOS, case: it may refuse a twin, never miss the real folder.
 */

/** `~` and `~/x` → the user's home. Other paths are returned as given. */
export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2));
  return path;
}

function contains(
  parent: string,
  child: string,
  platform: NodeJS.Platform,
  fold: (p: string) => string,
): boolean {
  const rules = platform === 'win32' ? win32 : posix;
  // Without a trailing separator, except for a root (`/`, `C:\`).
  const clean = (p: string) => {
    const n = fold(rules.normalize(p));
    return n.length > 1 && n.endsWith(rules.sep) && rules.dirname(n) !== n ? n.slice(0, -1) : n;
  };
  const a = clean(parent);
  const b = clean(child);
  return a === b || b.startsWith(a.endsWith(rules.sep) ? a : a + rules.sep);
}

/**
 * True when `child` is `parent` or inside it (both absolute and real),
 * comparing them exactly. The path rules (separator, drive letters) are those
 * of `platform`, not of the host, so a check is the same wherever it runs.
 */
export function isInside(
  parent: string,
  child: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return contains(parent, child, platform, (p) => p);
}

/**
 * True when `child` could be `parent` or inside it on a file system that
 * ignores Unicode form or (Windows, macOS) case: for folders that must stay
 * out of reach.
 */
export function mayBeInside(
  parent: string,
  child: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const folds = platform === 'win32' || platform === 'darwin';
  return contains(parent, child, platform, (p) => {
    const n = p.normalize('NFC');
    return folds ? n.toLowerCase() : n;
  });
}

/**
 * Real path of `path`, also when it does not exist yet: the deepest existing
 * ancestor is resolved (following its symlinks) and the missing part appended.
 */
export async function realPathOf(path: string, depth = 0): Promise<string> {
  const abs = resolve(path);
  try {
    return await realpath(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
  }
  // A dangling symlink: writing to it would create its target, wherever it points.
  try {
    if ((await lstat(abs)).isSymbolicLink()) {
      if (depth > 40) throw new Error(`too many symlinks: ${abs}`);
      return realPathOf(resolve(dirname(abs), await readlink(abs)), depth + 1);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
  }
  const parent = dirname(abs);
  if (parent === abs) return abs;
  return join(await realPathOf(parent, depth), basename(abs));
}

/**
 * Real path of the folder that holds `path`, plus its last element as given:
 * the entry itself, not followed if it is a symlink (to move or delete a link,
 * not what it points to).
 */
export async function entryPathOf(path: string): Promise<string> {
  const abs = resolve(path);
  const parent = dirname(abs);
  if (parent === abs) return abs;
  return join(await realPathOf(parent), basename(abs));
}
