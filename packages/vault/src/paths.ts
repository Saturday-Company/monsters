import { posix } from 'node:path';
import { ToolError } from '@monsters/shared';

/*
 * Vault paths are always relative, POSIX-style ("Progetti/Monsters.md"), never
 * starting with "/" and never escaping the vault root.
 */

/** Folders only the system may touch (Obsidian config, git, trash). */
export const SYSTEM_DIRS = ['.obsidian', '.git', '.trash'] as const;

/** Suffix of temporary files written before an atomic rename. */
export const TMP_SUFFIX = '.monsters-tmp';

/** Characters Obsidian or the OS do not accept in note names. */
const FORBIDDEN_NAME_CHARS = /[#|^:[\]\\/?*"<>]|%%/;

export const MAX_NAME_LENGTH = 120;

/**
 * Longest vault-relative path the system creates: with the vault folder in
 * front it stays usable by Windows programs limited to 260 characters.
 */
export const MAX_PATH_LENGTH = 200;

/**
 * Device names Windows reserves in every folder, also with an extension
 * ("CON", "nul.md", "COM1.txt"): such a file cannot be created there.
 */
const WINDOWS_RESERVED_NAME =
  /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** Control characters: refused by Windows and invisible in Obsidian. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Normalizes a user/model supplied path to a vault-relative POSIX path (no validation of names). */
export function normalizePath(input: string): string {
  let p = input.trim().replace(/\\/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  p = p.replace(/^\/+/, '').replace(/\/+$/, '');
  if (p === '' || p === '.') return '';
  const norm = posix.normalize(p);
  if (norm === '..' || norm.startsWith('../') || posix.isAbsolute(norm)) {
    throw new ToolError('INVALID_INPUT', `path outside the vault: ${input}`);
  }
  return norm === '.' ? '' : norm;
}

/** Normalizes a note path: adds `.md` when the name has no extension. */
export function normalizeNotePath(input: string): string {
  const p = normalizePath(input);
  if (p === '') throw new ToolError('INVALID_INPUT', 'empty path');
  return hasExtension(p) ? p : `${p}.md`;
}

/**
 * Extensions of files Obsidian opens (notes, canvases, bases, images, audio,
 * video, PDF) plus plain data files. Anything else after a dot is part of the
 * name: "Bozze post 14.10.2026" is a note, not a ".2026" file.
 */
export const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  'md',
  'canvas',
  'base',
  'avif',
  'bmp',
  'gif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
  'flac',
  'm4a',
  'mp3',
  'ogg',
  'wav',
  'webm',
  '3gp',
  'mkv',
  'mov',
  'mp4',
  'ogv',
  'pdf',
  'txt',
  'csv',
  'json',
]);

export function hasExtension(path: string): boolean {
  const base = posix.basename(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 && KNOWN_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

export function isMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

/** Note title = file name without the `.md` extension (non-Markdown files keep theirs). */
export function titleOf(path: string): string {
  const base = posix.basename(path);
  return isMarkdown(base) ? base.slice(0, -3) : base;
}

/** True for paths inside hidden folders or hidden files (ignored by Obsidian and by the index). */
export function isHidden(path: string): boolean {
  return path.split('/').some((seg) => seg.startsWith('.'));
}

/**
 * Form of a path used to compare protected locations: Unicode NFC and lower
 * case, because macOS and Windows file systems treat `privato/` as `Privato/`
 * and `.Git` as `.git` (and macOS also equates NFD and NFC names).
 */
export function foldPath(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

/**
 * What the file system under a vault treats as the same name. macOS and Windows ignore case
 * (`Idee.md` is `idee.md`), macOS also ignores the Unicode form (NFC and NFD); Linux ignores
 * neither. It is a property of the vault's folder, probed once (`probePathIdentity`), not of
 * the platform: a case-insensitive volume can be mounted on Linux and a case-sensitive one on
 * macOS.
 */
export interface PathIdentity {
  foldCase: boolean;
  foldUnicode: boolean;
}

/** Names are what they are: how Linux file systems behave. */
export const EXACT_PATHS: PathIdentity = { foldCase: false, foldUnicode: false };

/**
 * The identity of a vault path for the index and the lookups: two spellings with the same
 * identity are the same file on this file system. The path stored and shown stays the real
 * on-disk spelling; this is only the key.
 */
export function pathId(path: string, identity: PathIdentity): string {
  const p = identity.foldUnicode ? path.normalize('NFC') : path;
  return identity.foldCase ? p.toLowerCase() : p;
}

/**
 * Key of the per-file locks: Unicode NFC always (a lock wider than needed only waits a bit),
 * and case-folded where the file system folds it.
 */
export function lockKeyOf(path: string, identity: PathIdentity): string {
  return pathId(path, { foldCase: identity.foldCase, foldUnicode: true });
}

/*
 * The folder of the files of Monsters (attachments, screenshots, pages made by
 * the monsters, D-075): Obsidian sees it, the vault does not (no index, no
 * history, no vault tools). Its usual name is the layout's (`File/`, `Files/`,
 * D-154); the core picks the real one (a folder of the user with that name
 * stays a folder of notes) and gives it as `filesDir`.
 */

/** A path inside the files folder of Monsters (`<dir>/...`, any case); never without a folder. */
export function isFilesPath(path: string, dir: string | null | undefined): boolean {
  if (!dir) return false;
  const parts = path.split('/');
  return parts.length > 1 && foldPath(parts[0] ?? '') === foldPath(dir);
}

export function isSystemPath(path: string): boolean {
  const first = foldPath(path.split('/')[0] ?? '');
  return (SYSTEM_DIRS as readonly string[]).includes(first);
}

export function isTmpPath(path: string): boolean {
  return path.endsWith(TMP_SUFFIX);
}

/** Validates every segment of a path the system is about to create. */
export function assertValidNewPath(path: string, filesDir?: string | null): void {
  if (isSystemPath(path) || isHidden(path)) {
    throw new ToolError(
      'BLOCKED_BY_POLICY',
      `hidden and system folders are managed by the system: ${path}`,
    );
  }
  if (isFilesPath(path, filesDir)) {
    throw new ToolError(
      'BLOCKED_BY_POLICY',
      `${filesDir}/ holds the files of Monsters (attachments, screenshots, pages): it is not part of the notes`,
    );
  }
  if (path.length > MAX_PATH_LENGTH) {
    throw new ToolError(
      'INVALID_INPUT',
      `path longer than ${MAX_PATH_LENGTH} characters: ${path}`,
      {
        hint: 'Use shorter folder or note names.',
      },
    );
  }
  for (const seg of path.split('/')) {
    const name = seg === posix.basename(path) ? titleOf(seg) : seg;
    if (name.trim() === '') throw new ToolError('INVALID_INPUT', `empty name in path: ${path}`);
    if (FORBIDDEN_NAME_CHARS.test(name) || CONTROL_CHARS.test(name)) {
      throw new ToolError('INVALID_INPUT', `invalid characters in "${name}"`, {
        hint: 'Names cannot contain # | ^ : %% [ ] \\ / ? * " < > or control characters',
      });
    }
    if (WINDOWS_RESERVED_NAME.test(seg.trimEnd())) {
      throw new ToolError('INVALID_INPUT', `"${name}" is a name reserved by Windows`, {
        hint: 'CON, PRN, AUX, NUL, COM1-9 and LPT1-9 cannot be used as names: add a word.',
      });
    }
    if (/[. ]$/.test(seg)) {
      throw new ToolError('INVALID_INPUT', `name ending with a dot or a space: "${seg}"`, {
        hint: 'Windows drops a final dot or space from names: remove it.',
      });
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new ToolError(
        'INVALID_INPUT',
        `name longer than ${MAX_NAME_LENGTH} characters: ${name}`,
      );
    }
  }
}

/** Key used to resolve wikilinks: lowercase path without the `.md` extension. */
export function linkKey(pathOrTarget: string): string {
  const p = pathOrTarget.trim().normalize('NFC').toLowerCase();
  return p.endsWith('.md') ? p.slice(0, -3) : p;
}

/**
 * True when `path` is inside `folder` (or is the folder itself); "" means the
 * whole vault. Case and Unicode form are ignored (see `foldPath`), so checks
 * on protected folders hold on case-insensitive file systems too.
 */
export function isInside(path: string, folder: string): boolean {
  if (folder === '') return true;
  const p = foldPath(path);
  const f = foldPath(folder);
  return p === f || p.startsWith(`${f}/`);
}

/** Converts a simple glob (`*`, `**`, `?`) to a RegExp over vault paths. */
export function globToRegExp(glob: string): RegExp {
  const g = normalizePath(glob);
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g.charAt(i);
    if (c === '*') {
      if (g.charAt(i + 1) === '*') {
        i++;
        if (g.charAt(i + 1) === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}
