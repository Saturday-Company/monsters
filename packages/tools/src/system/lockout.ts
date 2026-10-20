import { lstatSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { isInside, mayBeInside } from './paths.ts';

/*
 * The data folder of Monsters (`MONSTERS_HOME`: agents, secrets, database,
 * settings, logs, browser profile…) is off limits to the agents' own
 * terminal and files, except each agent's working folder inside it (D-078).
 *
 * Paths given to a file tool are checked exactly: `~`, `~user`, `$HOME` and
 * the home variables of PowerShell and cmd expanded, relative to the working
 * folder, `..` resolved, symlinks followed (the deepest existing ancestor; on
 * Windows the native realpath, which also expands 8.3 short names).
 *
 * A command line is a brake, NOT a security boundary (like the elevation
 * check of `shell`, D-079). Every word that looks like a path is resolved
 * against the working folder, the folders it `cd`s into, the user's home and
 * the folder that holds the data folder, in several readings of the line: as
 * written, without quotes, without backslash escapes, without PowerShell's
 * backtick and cmd's caret, with `$HOME`, `${HOME}`, `$env:X`, `%X%` and
 * `~user` expanded and `\\?\` stripped on Windows. The data folder named in
 * any of those spellings (also inside a quoted script) is refused, and so is
 * a glob or an 8.3 short name (`MONSTE~1`) that could match it or something
 * inside it, and a recursive command (find, grep -r, du, tar…) on a folder
 * (or a glob) that contains it. Case is folded on Windows and macOS.
 *
 * Not covered, by design of a brake: a path built at run time (variables of
 * the command itself, `$(…)`, base64, string operations in python/node/
 * PowerShell, `Get-ChildItem | …` pipelines), other environment variables
 * than the home ones, nested brace expansions. What such a command reads is
 * still the user's own computer, and the file tools are checked exactly.
 */

/** What the model reads when a call reaches the data folder of Monsters. */
export const INTERNAL_FILES_DENIED =
  'I file interni di Monsters non sono accessibili: usa gli strumenti di Monsters.';
/** The same for a recursive command on a folder that contains the data folder. */
export const INTERNAL_FILES_TREE_DENIED =
  'Questo comando passerebbe dai file interni di Monsters: restringilo a una cartella precisa, oppure usa gli strumenti di Monsters.';
const HINT =
  'Work in your own folder or in a folder the user granted you; notes go through the vault_* tools, the team through delegate.';

export interface DataDirLock {
  /** The data folder of Monsters. */
  dataDir: string;
  /** Folders inside it the agent may use (its working folder). */
  allowed: readonly string[];
  /** The user's home, for `~`, `$HOME`, `$env:USERPROFILE`, `%USERPROFILE%`. Default `os.homedir()`. */
  home?: string;
  platform?: NodeJS.Platform;
  /** Environment for `%APPDATA%`, `$env:LOCALAPPDATA`… Default `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
}

export interface LockVerdict {
  /** The message for the model (`INTERNAL_FILES_DENIED` or the recursive variant). */
  message: string;
  hint: string;
  /** The path that reached the data folder, as resolved. */
  path: string;
}

type PathApi = typeof posix;

interface Prepared {
  P: PathApi;
  data: string[];
  allowed: string[];
  home: string;
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  /** The platform's path rules are not the host's (a test): no file system lookups. */
  simulated: boolean;
}

/** `\\?\C:\x` and `\\.\C:\x` (Win32 namespaces) → `C:\x`; `\\?\UNC\srv\x` → `\\srv\x`. */
function stripNamespace(path: string): string {
  return path.replace(/^[\\/]{2}[?.][\\/]UNC[\\/]/i, '\\\\').replace(/^[\\/]{2}[?.][\\/]/, '');
}

/** Real path of `path`, also when it does not exist yet (the deepest existing ancestor, followed). */
function realOf(path: string, p: Pick<Prepared, 'P' | 'simulated'>, depth = 0): string {
  const { P } = p;
  const abs = P.resolve(path);
  if (p.simulated) return abs;
  try {
    // `native` on Windows: the long names of 8.3 short ones (`MONSTE~1` → `.monsters`).
    const real = process.platform === 'win32' ? realpathSync.native(abs) : realpathSync(abs);
    return P === win32 ? stripNamespace(real) : real;
  } catch {
    // missing (or unreadable): resolve what exists above it
  }
  try {
    if (depth < 40 && lstatSync(abs).isSymbolicLink()) {
      return realOf(P.resolve(P.dirname(abs), readlinkSync(abs)), p, depth + 1);
    }
  } catch {
    // not there
  }
  const parent = P.dirname(abs);
  if (parent === abs) return abs;
  return P.join(realOf(parent, p, depth), P.basename(abs));
}

function prepare(lock: DataDirLock): Prepared {
  const platform = lock.platform ?? process.platform;
  const P = platform === 'win32' ? win32 : posix;
  const base = { P, simulated: (P === win32) !== (process.platform === 'win32') };
  const data = [...new Set([P.resolve(lock.dataDir), realOf(lock.dataDir, base)])];
  const allowed = lock.allowed.flatMap((a) => [P.resolve(a), realOf(a, base)]);
  return {
    ...base,
    data,
    allowed: [...new Set(allowed)],
    home: lock.home ?? homedir(),
    platform,
    env: lock.env ?? process.env,
  };
}

/** Variables that may hold (an ancestor of) the data folder, besides the home ones. */
const PATH_VARIABLES = new Set([
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
]);

/** The value of a variable named in a command, when it can lead to the data folder. */
function variable(name: string, p: Prepared, dataDir: string): string | undefined {
  const n = name.toUpperCase();
  const drive = /^[A-Za-z]:/.exec(p.home)?.[0];
  switch (n) {
    case 'HOME':
    case 'USERPROFILE':
      return p.home;
    case 'MONSTERS_HOME':
      return dataDir;
    case 'HOMEDRIVE':
      return drive;
    case 'HOMEPATH':
      return drive ? p.home.slice(drive.length) : undefined;
    default:
      return PATH_VARIABLES.has(n) ? p.env[n] || undefined : undefined;
  }
}

/** The home of `~name`: the current user's, or a sibling of it. */
function homeOf(name: string, p: Prepared): string {
  return name === p.P.basename(p.home) ? p.home : p.P.join(p.P.dirname(p.home), name);
}

/**
 * `~`, `~user`, `$HOME`, `${HOME}`, `$env:X`, `${env:X}`, `%X%` spelled out
 * (only the variables of `variable`; word starts only for `~`). On Windows
 * PowerShell's names ignore case (`$home`).
 */
function expandWords(text: string, p: Prepared, dataDir: string): string {
  const win = p.platform === 'win32';
  const value = (m: string, name: string) => variable(name, p, dataDir) ?? m;
  return text
    .replace(/\$\{env:([A-Za-z_]\w*)\}|\$env:([A-Za-z_]\w*)/gi, (m, a?: string, b?: string) =>
      value(m, a ?? b ?? ''),
    )
    .replace(/%([A-Za-z_]\w*)%/g, (m, name: string) => value(m, name))
    .replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)\b/g, (m, a?: string, b?: string) => {
      const name = a ?? b ?? '';
      // bash and sh: the exact name; PowerShell: any case.
      return win || name === name.toUpperCase() ? value(m, name) : m;
    })
    .replace(
      /(^|[\s=:'"(,;|&])~([A-Za-z_][\w.-]*)(?=[/\\]|$|[\s'";|&)])/g,
      (_m, pre: string, name: string) => `${pre}${homeOf(name, p)}`,
    )
    .replace(/(^|[\s=:'"(,;|&])~(?=[/\\]|$|[\s'";|&)])/g, (_m, pre: string) => `${pre}${p.home}`);
}

/** Win32 namespaces (`\\?\`, `\\.\`) dropped at every word start. */
function stripNamespaces(text: string): string {
  return text.replace(
    /(^|[\s'"=(,;|&])[\\/]{2}[?.][\\/](UNC[\\/])?/gi,
    (_m, pre: string, unc?: string) => `${pre}${unc ? '\\\\' : ''}`,
  );
}

/**
 * The readings of a command line a shell may give: as written, without
 * quotes (`.mon''sters`), without backslash escapes (`.mon\sters`), without
 * PowerShell's backtick and cmd's caret escapes (`.mon`sters`, `.mon^sters`).
 */
function readings(command: string, p: Prepared): string[] {
  const unquoted = command.replace(/["']/g, '');
  const out = [
    command,
    unquoted,
    unquoted.replace(/\\(.)/g, '$1'),
    unquoted.replace(/[`^](.)/g, '$1'),
  ];
  return [...new Set(p.platform === 'win32' ? out.map(stripNamespaces) : out)];
}

function expandPath(raw: string, p: Prepared): string {
  const t = p.platform === 'win32' ? stripNamespace(raw.trim()) : raw.trim();
  return expandWords(t, p, p.data[0]!);
}

const GLOB = /[*?[{]/;

/** A glob or (Windows) an 8.3 short name: the word names a pattern, not one path. */
function fuzzy(word: string, p: Prepared): boolean {
  return GLOB.test(word) || (p.platform === 'win32' && /~\d/.test(word));
}

/** The source of a regular expression for one glob segment (`*`, `?`, `[…]`, `{a,b}`). */
function globSource(pat: string): string {
  let out = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i]!;
    if (c === '*') {
      out += '.*';
    } else if (c === '?') {
      out += '.';
    } else if (c === '[') {
      const end = pat.indexOf(']', i + 2);
      if (end < 0) {
        out += '\\[';
        continue;
      }
      let body = pat.slice(i + 1, end);
      const negate = body.startsWith('!') || body.startsWith('^');
      if (negate) body = body.slice(1);
      out += `[${negate ? '^' : ''}${body.replace(/[\\\]^[]/g, '\\$&')}]`;
      i = end;
    } else if (c === '{') {
      const end = pat.indexOf('}', i);
      const body = end < 0 ? '' : pat.slice(i + 1, end);
      if (end < 0 || !body.includes(',')) {
        out += '\\{';
        continue;
      }
      out += `(?:${body.split(',').map(globSource).join('|')})`;
      i = end;
    } else {
      out += c.replace(/[.+^$()|\\\]{}]/g, '\\$&');
    }
  }
  return out;
}

/** `MONSTE~1` (or the hashed `MO1A2B~1`) could be the short name of `.monsters`. */
function shortNameOf(pat: string, real: string): boolean {
  const m = /^([^~]{1,6})~\d+(?:\.[^.]{0,3})?$/.exec(pat);
  if (!m) return false;
  const base = m[1]!.toUpperCase();
  const long = real.toUpperCase().replace(/[\s.]/g, '');
  if (long.startsWith(base)) return true;
  return (
    base.length === 6 && /^[0-9A-F]{4}$/.test(base.slice(2)) && long.startsWith(base.slice(0, 2))
  );
}

interface MatchRules {
  platform: NodeJS.Platform;
  /** A shell glob: `*` and `?` skip names that start with a dot (on Windows only in the last segment). */
  dots: boolean;
}

/** One segment of a pattern against one real name. */
function segmentMatches(pat: string, real: string, rules: MatchRules, last: boolean): boolean {
  const fold = rules.platform === 'win32' || rules.platform === 'darwin';
  const a = pat.normalize('NFC');
  const b = real.normalize('NFC');
  if (!GLOB.test(a)) {
    if (fold ? a.toLowerCase() === b.toLowerCase() : a === b) return true;
    return rules.platform === 'win32' && shortNameOf(a, b);
  }
  if (rules.dots && b.startsWith('.') && !a.startsWith('.')) {
    if (rules.platform !== 'win32' || last) return false;
  }
  try {
    return new RegExp(`^${globSource(a)}$`, fold ? 'iu' : 'u').test(b);
  } catch {
    // A pattern we cannot read: it could match.
    return true;
  }
}

/** How far a pattern reaches a target: not at all, an ancestor, the target, inside it. */
type Reach = 0 | 1 | 2 | 3;
const NONE: Reach = 0;
const ANCESTOR: Reach = 1;
const EXACT: Reach = 2;
const INSIDE: Reach = 3;

function reach(c: string[], t: string[], ci: number, ti: number, rules: MatchRules): Reach {
  if (ti === t.length) return ci === c.length ? EXACT : INSIDE;
  if (ci === c.length) return ANCESTOR;
  const seg = c[ci]!;
  if (seg === '**') {
    let best = reach(c, t, ci + 1, ti, rules);
    const name = t[ti]!;
    const skips = rules.dots && rules.platform !== 'win32' && name.startsWith('.');
    if (best < INSIDE && !skips) best = Math.max(best, reach(c, t, ci, ti + 1, rules)) as Reach;
    return best;
  }
  if (!segmentMatches(seg, t[ti]!, rules, ci === c.length - 1)) return NONE;
  return reach(c, t, ci + 1, ti + 1, rules);
}

function segmentsOf(path: string, p: Prepared): string[] {
  return path.split(p.P === win32 ? /[\\/]/ : '/').filter((s, i) => i === 0 || s !== '');
}

/** The part of an absolute pattern before its first glob or short name. */
function fixedPart(abs: string, p: Prepared): string {
  const segs = segmentsOf(abs, p);
  const i = segs.findIndex((s) => fuzzy(s, p));
  const fixed = (i < 0 ? segs : segs.slice(0, i)).join(p.P.sep);
  return p.P.resolve(fixed === '' || /^[A-Za-z]:$/.test(fixed) ? `${fixed}${p.P.sep}` : fixed);
}

/**
 * How far the absolute pattern `abs` (a glob, a short name) reaches the data
 * folder, outside the allowed folders: a pattern whose fixed part is in an
 * allowed folder stays there.
 */
function patternReach(abs: string, p: Prepared, dots: boolean): Reach {
  const fixed = fixedPart(abs, p);
  if (p.allowed.some((a) => isInside(a, fixed, p.platform))) return NONE;
  const c = segmentsOf(abs, p);
  const rules = { platform: p.platform, dots };
  let best: Reach = NONE;
  for (const d of p.data) best = Math.max(best, reach(c, segmentsOf(d, p), 0, 0, rules)) as Reach;
  return best;
}

/**
 * True when the absolute `path` is in the data folder and not in an allowed
 * folder, as written (`..` resolved) or as it really is (a link in the
 * working folder that leads into the data folder).
 */
function lockedAbs(path: string, p: Prepared): boolean {
  const locked = (c: string) =>
    p.data.some((d) => mayBeInside(d, c, p.platform)) &&
    !p.allowed.some((a) => isInside(a, c, p.platform));
  return locked(p.P.resolve(path)) || locked(realOf(path, p));
}

/** True when the absolute `path` holds the data folder (`~`, `/`): a tree walk there reaches it. */
function holdsData(path: string, p: Prepared): boolean {
  const c = realOf(path, p);
  return p.data.some((d) => mayBeInside(c, d, p.platform) && !mayBeInside(d, c, p.platform));
}

const denied = (path: string): LockVerdict => ({
  message: INTERNAL_FILES_DENIED,
  hint: HINT,
  path,
});
const treeDenied = (path: string): LockVerdict => ({
  message: INTERNAL_FILES_TREE_DENIED,
  hint: HINT,
  path,
});

/**
 * The entries of the data folder outside the allowed folders, for deny rules
 * that cannot say "except": every entry, and inside a folder that holds an
 * allowed one, its other entries (down to the allowed folder).
 */
export function forbiddenEntries(lock: DataDirLock): string[] {
  const p = prepare(lock);
  const root = realOf(lock.dataDir, p);
  const allowed = lock.allowed.map((a) => realOf(a, p));
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const entry = p.P.join(dir, n);
      if (allowed.some((a) => isInside(entry, a, p.platform))) {
        // `entry` is an allowed folder or holds one: only its other entries are closed.
        if (!allowed.some((a) => isInside(a, entry, p.platform)) && depth < 8) {
          walk(entry, depth + 1);
        }
      } else {
        out.push(entry);
      }
    }
  };
  walk(root, 0);
  return out;
}

/** A path given to a file tool (absolute, `~/…`, `$HOME/…` or relative to `cwd`). */
export function lockedPath(raw: string, cwd: string, lock: DataDirLock): LockVerdict | null {
  if (!raw.trim()) return null;
  const p = prepare(lock);
  const expanded = expandPath(raw, p);
  const abs = p.P.isAbsolute(expanded) ? p.P.resolve(expanded) : p.P.resolve(cwd, expanded);
  if (lockedAbs(abs, p)) return denied(abs);
  // A short name the file system did not expand (or a name the tool may glob).
  if (fuzzy(abs, p) && patternReach(abs, p, false) >= EXACT) return denied(abs);
  return null;
}

/** The fixed part of a glob pattern, before its first wildcard. */
function globBase(pattern: string): string {
  const i = pattern.search(GLOB);
  const fixed = i < 0 ? pattern : pattern.slice(0, i);
  return i < 0 ? fixed : fixed.replace(/[^/\\]*$/, '');
}

/**
 * A search of the harness (Claude Code `Grep`, `Glob`): its folder and the
 * fixed part of its pattern. A folder that holds the data folder is refused
 * when the search walks the tree (always for `Grep`, `**` for `Glob`); a
 * pattern that could match a file inside the data folder is refused too.
 */
export function lockedSearch(
  input: { path?: string | undefined; pattern?: string | undefined; recursive: boolean },
  cwd: string,
  lock: DataDirLock,
): LockVerdict | null {
  const p = prepare(lock);
  const toAbs = (raw: string, from: string) => {
    const e = expandPath(raw, p);
    return p.P.isAbsolute(e) ? p.P.resolve(e) : p.P.resolve(from, e);
  };
  const rootAbs = toAbs(input.path?.trim() ? input.path : '.', cwd);
  if (lockedAbs(rootAbs, p)) return denied(rootAbs);
  const pattern = (input.pattern ?? '').trim();
  const base = globBase(pattern);
  // An absolute pattern searches from its own fixed part.
  const from = base ? toAbs(base, rootAbs) : rootAbs;
  if (lockedAbs(from, p)) return denied(from);
  const deep = input.recursive || pattern.includes('**');
  if (deep && holdsData(from, p)) return treeDenied(from);
  // The whole pattern (`~/.mon*/settings.json`): a match inside the data folder.
  if (pattern && fuzzy(pattern, p)) {
    const full = toAbs(pattern, rootAbs);
    if (patternReach(full, p, false) === INSIDE) return denied(full);
  }
  return null;
}

/** Characters that end a word of a command line. */
const DELIMITERS = /[\s'"`;|&<>(){}=,]+/;
/** The same without braces and commas, for globs (`{a,b}`). */
const GLOB_DELIMITERS = /[\s'"`;|&<>()=]+/;
/** Commands that walk a whole tree. */
const RECURSIVE =
  /(?:^|[\s;&|(`])(?:find|rg|ag|ack|fd|fdfind|du|tree|tar|zip|7z|rsync|locate|grep\s+(?:[^\s;&|]+\s+)*-[a-zA-Z]*[rR]|egrep\s+(?:[^\s;&|]+\s+)*-[a-zA-Z]*[rR]|ls\s+(?:[^\s;&|]+\s+)*-[a-zA-Z]*R|cp\s+(?:[^\s;&|]+\s+)*-[a-zA-Z]*[rRa]|scp\s+(?:[^\s;&|]+\s+)*-[a-zA-Z]*r|chmod\s+-R|chown\s+-R|rm\s+(?:[^\s;&|]+\s+)*-[a-zA-Z]*[rR]|Get-ChildItem\b[^;&|]*-Recurse)(?=\s|$|[;&|)])/i;
/** `cd x`, `pushd x`, `Set-Location x` at command position. */
const CD = /(?:^|[;&|(\n]|&&|\|\|)\s*(?:cd|pushd|Set-Location|sl|chdir)(?:\s+([^\s;&|)]+))?/gi;

const looksLikePath = (w: string) =>
  w === '.' || w === '..' || /[/\\]/.test(w) || /^\.[^.]/.test(w) || /^[A-Za-z]:/.test(w);
const OPTION = /^-{1,2}[A-Za-z][\w-]*=/;

/** One reading of a command line, variables already expanded. */
function lockedText(text: string, cwd: string, p: Prepared): LockVerdict | null {
  const { P } = p;
  const recursive = RECURSIVE.test(text);
  // Where relative words may point: the cwd, the folders it changes to, home, the data folder's parent.
  const bases = [P.resolve(cwd)];
  for (const m of text.matchAll(CD)) {
    const target = (m[1] ?? '').replace(/^['"]|['"]$/g, '');
    for (const b of [...bases]) {
      const abs =
        !target || target === '~'
          ? p.home
          : P.isAbsolute(target)
            ? P.resolve(target)
            : P.resolve(b, target);
      if (lockedAbs(abs, p)) return denied(abs);
      if (fuzzy(target, p) && patternReach(abs, p, true) >= EXACT) return denied(abs);
      if (!bases.includes(abs)) bases.push(abs);
    }
  }
  const extra = [p.home, ...p.data.map((d) => P.dirname(d))];
  const words = text.split(DELIMITERS).filter(Boolean);
  // The data folder written out, anywhere (a path inside a quoted script of python or node).
  for (const d of p.data) {
    const fold = (s: string) =>
      p.platform === 'win32' || p.platform === 'darwin' ? s.toLowerCase() : s;
    const hay = fold(text);
    const needle = fold(d);
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
      const rest = text.slice(at).split(DELIMITERS)[0] ?? '';
      if (rest && lockedAbs(rest, p)) return denied(P.resolve(rest));
    }
  }
  let holds: string | null = null;
  for (const raw of words) {
    const w = raw.replace(OPTION, '');
    if (!looksLikePath(w)) continue;
    if (P.isAbsolute(w)) {
      const abs = P.resolve(w);
      if (lockedAbs(abs, p)) return denied(abs);
      if (!holds && holdsData(abs, p)) holds = abs;
      continue;
    }
    for (const b of [...bases, ...extra]) {
      const abs = P.resolve(b, w);
      if (lockedAbs(abs, p)) return denied(abs);
      // Only the folders the command really is in can make a relative word hold the data.
      if (!holds && bases.includes(b) && holdsData(abs, p)) holds = abs;
    }
  }
  // Globs and short names (`~/.mon*/x`, `MONSTE~1`): what they could match.
  for (const raw of text.split(GLOB_DELIMITERS)) {
    const w = raw.replace(OPTION, '');
    if (!w || !fuzzy(w, p) || !looksLikePath(w.replace(/[*?[{]/g, 'x'))) continue;
    // Relative patterns only from the folders the command is in: `.*` in the cwd is not home's.
    const candidates = P.isAbsolute(w) ? [P.resolve(w)] : bases.map((b) => P.resolve(b, w));
    for (const abs of candidates) {
      const r = patternReach(abs, p, true);
      if (r >= EXACT) return denied(abs);
      if (r === ANCESTOR && recursive && !holds) holds = abs;
    }
  }
  // A recursive walk from a folder that holds the data folder (also with no path: its cwd).
  if (recursive) {
    const from = holds ?? bases.find((b) => holdsData(b, p)) ?? null;
    if (from) return treeDenied(from);
  }
  return null;
}

/**
 * A command line that names the data folder of Monsters outside the allowed
 * folders (see the comment at the top: a brake, not a boundary).
 */
export function lockedCommand(command: string, cwd: string, lock: DataDirLock): LockVerdict | null {
  const p = prepare(lock);
  const dataDir = p.P.resolve(lock.dataDir);
  let tree: LockVerdict | null = null;
  for (const text of readings(command, p)) {
    const v = lockedText(expandWords(text, p, dataDir), cwd, p);
    if (v?.message === INTERNAL_FILES_DENIED) return v;
    tree ??= v;
  }
  return tree;
}
