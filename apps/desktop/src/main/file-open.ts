import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';

/*
 * "Apri con il sistema" and "Mostra nella cartella" for a file of the notes folder (preview
 * pane of the web UI, plan of 16/10), without Electron (tested in test/file-open.test.ts).
 *
 * The page sends the file's path relative to the notes folder, as the core's FileMeta gives
 * it (`File/2026-10/foto.png`, packages/shared/src/files.ts). Only files under the files
 * folder of Monsters are reached, after resolving symlinks, and only regular files. That
 * folder is the one the core marked (`.monsters`, D-083): `File/` when it is Monsters', else
 * `File di Monsters/` (a `File/` the user made is a folder of notes and stays closed). Anything that could run when
 * opened (by extension on every system, or with an execute bit on POSIX) is never opened: the
 * app shows it in its folder instead.
 */

/** Folder names of the core (packages/core/src/team/settings.ts; checked by a test). */
export const VAULT_DIR_NAME = 'Monsters Note';
export const LEGACY_VAULT_DIR_NAME = 'Monsters Vault';
export const SETTINGS_FILE = 'settings.json';
/** The folder of the notes folder that holds the files (packages/shared/src/files.ts). */
export const FILES_DIR = 'File';
/** Its name when the user has a `File/` of their own (packages/core/src/files/store.ts). */
export const FILES_DIR_ALT = 'File di Monsters';
/** The file the core writes in its files folder (packages/core/src/files/store.ts). */
export const FILES_MARKER = '.monsters';
/** Names the files folder may have: `File`, `File di Monsters`, `File di Monsters 2`… */
const FILES_DIR_NAME = /^(?:File|File di Monsters(?: [1-9]\d{0,15})?)$/;

const isMarked = (dir: string) => {
  try {
    return statSync(join(dir, FILES_MARKER)).isFile();
  } catch {
    return false;
  }
};

/**
 * The files folder of the core in `vault`, like `filesDirFor()` of the core: the first of
 * `File`, `File di Monsters`, `File di Monsters 2`…`20` that has the marker; a candidate
 * that does not exist yet ends the search (the core would make it there: no file to open).
 * Null when no folder is Monsters'.
 */
export function filesDirOf(vault: string): string | null {
  const candidates = [FILES_DIR, FILES_DIR_ALT];
  for (let n = 2; n <= 20; n++) candidates.push(`${FILES_DIR_ALT} ${n}`);
  for (const name of candidates) {
    const dir = join(vault, name);
    if (!existsSync(dir)) return null;
    if (isMarked(dir)) return name;
  }
  return null;
}

/** Same rule as `expand()` of the core's settings, relative paths against the home. */
function expand(path: string, home: string, userHome: string): string {
  const p = path.startsWith('~') ? join(userHome, path.slice(1)) : path;
  return isAbsolute(p) ? p : resolve(home, p);
}

/** Same as `defaultVaultDir()` of the core. */
export function defaultVaultDir(home: string, userHome: string = homedir()): string {
  const standard = resolve(join(userHome, '.monsters'));
  const parent = resolve(home) === standard ? userHome : home;
  const legacy = join(parent, LEGACY_VAULT_DIR_NAME);
  return existsSync(legacy) ? legacy : join(parent, VAULT_DIR_NAME);
}

/**
 * The notes folder of the core on `home`, like `loadHubSettings()` of the core:
 * `MONSTERS_VAULT`, then `vault` of `settings.json`, then the default. A relative path is
 * taken against the home (the app starts the core with the home as working directory).
 * Null when `settings.json` is unreadable or invalid: the core would not run on it either.
 */
export function resolveVaultDir(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir(),
): string | null {
  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const setting = (raw as Record<string, unknown>)['vault'];
  if (setting !== undefined && (typeof setting !== 'string' || setting.length === 0)) return null;
  const fromEnv = env['MONSTERS_VAULT'];
  const chosen = fromEnv !== undefined && fromEnv !== '' ? fromEnv : setting;
  return chosen !== undefined ? expand(chosen, home, userHome) : defaultVaultDir(home, userHome);
}

/**
 * Extensions that run something when opened with the system's default app, on any system
 * (a file made on one system may be opened on another; refusing costs nothing).
 */
const RUNNABLE_EXTENSIONS: ReadonlySet<string> = new Set(
  [
    // Windows
    'exe bat cmd com pif scr cpl msi msix msixbundle msp mst appx appxbundle application',
    'appref-ms gadget hta htt inf ins isp jar js jse lnk url website mht mhtml msc ps1',
    'ps1xml ps2 ps2xml psc1 psc2 psd1 psm1 reg scf sct shb shs vb vbe vbs ws wsc wsf wsh',
    'xll xbap chm hlp dll sys drv ocx diagcab diagcfg diagpkg settingcontent-ms library-ms',
    'search-ms searchconnector-ms iso img vhd vhdx ade adp mda mdb mde mdt mdw mdz accde',
    'crt cer der p7b mof udl wcx theme themepack deskthemepack appinstaller cab xnk jnlp',
    // Web pages and SVG: in the system's browser a page made by a monster would run outside
    // the preview pane's sandbox (no CSP, network on): the app shows them in their folder.
    'html htm xhtml shtml xht svg svgz xsl xslt',
    // macOS
    'app command tool pkg mpkg terminal workflow action scpt scptd applescript osax',
    'prefpane kext plugin bundle dmg webloc inetloc fileloc mobileconfig dylib',
    // Linux and scripts anywhere
    'desktop sh bash zsh ksh csh tcsh fish run bin appimage out elf so deb rpm snap flatpak',
    'flatpakref flatpakrepo py pyw pyc pyo pyz pyzw pl pm rb php lua tcl ps x86_64',
  ]
    .join(' ')
    .split(' '),
);

/** Windows device names: `con.txt` opens the console, not a file. */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * The segments of a path from the page, or null when it is not a plain relative path under
 * a folder that may be the files folder (`File/`, `File di Monsters/`…): no absolute or drive paths, no `..` or `.`, no NUL or control characters, no
 * backslash, no `:` (drives, NTFS streams), no names Windows rewrites (trailing dot or
 * space, device names).
 */
export function fileSegments(path: unknown): string[] | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 1024) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\:]/.test(path)) return null;
  if (isAbsolute(path) || win32.isAbsolute(path)) return null;
  const segments = path.split('/');
  if (segments.length < 2 || !FILES_DIR_NAME.test(segments[0]!)) return null;
  for (const s of segments) {
    if (s === '' || s === '.' || s === '..') return null;
    if (s.endsWith('.') || s.endsWith(' ') || WINDOWS_DEVICE.test(s)) return null;
  }
  return segments;
}

/** True when opening `name` would run something (by extension). */
export function runnableByName(name: string): boolean {
  const ext = extname(name).slice(1).toLowerCase();
  return ext !== '' && RUNNABLE_EXTENSIONS.has(ext);
}

export type VaultFileCheck =
  | {
      ok: true;
      /** The real path of the file (symlinks resolved). */
      path: string;
      /** Opening it could run something: show it in its folder instead. */
      runnable: boolean;
    }
  | { ok: false; reason: string };

/**
 * Checks a path from the page against the notes folder `vault`: it must name an existing
 * regular file inside the files folder of the core (`filesDirOf`) once symlinks are resolved.
 */
export function checkVaultFile(
  vault: string,
  path: unknown,
  platform: NodeJS.Platform = process.platform,
): VaultFileCheck {
  const segments = fileSegments(path);
  if (!segments) return { ok: false, reason: 'not a path under File/' };
  // Only the folder the core marked: a `File/` of the user's notes, or an old path to it
  // from before the move to `File di Monsters/`, is not one.
  const filesDir = filesDirOf(vault);
  if (filesDir === null || segments[0] !== filesDir) {
    return { ok: false, reason: 'not the files folder of Monsters' };
  }
  let root: string;
  let real: string;
  try {
    root = realpathSync.native(join(vault, filesDir));
    real = realpathSync.native(join(vault, ...segments));
  } catch {
    return { ok: false, reason: 'missing' };
  }
  const rel = relative(root, real);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return { ok: false, reason: 'outside File/' };
  }
  let mode: number;
  try {
    const st = statSync(real);
    if (!st.isFile()) return { ok: false, reason: 'not a regular file' };
    mode = st.mode;
  } catch {
    return { ok: false, reason: 'missing' };
  }
  const runnable =
    runnableByName(segments[segments.length - 1]!) ||
    runnableByName(real) ||
    (platform !== 'win32' && (mode & 0o111) !== 0);
  return { ok: true, path: real, runnable };
}

/** What the main process needs from Electron's `shell`. */
export interface FileShell {
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
}

/**
 * "Apri con il sistema": opens the file with the system's default app. A file that could run
 * is shown in its folder instead (false). False also when the check fails or the system
 * cannot open it.
 */
export async function openVaultFile(
  vault: string | null,
  path: unknown,
  shell: FileShell,
  log: (line: string) => void,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (!vault) return false;
  const check = checkVaultFile(vault, path, platform);
  if (!check.ok) {
    log(`file not opened: ${check.reason}`);
    return false;
  }
  if (check.runnable) {
    log('file not opened (it could run): shown in its folder');
    shell.showItemInFolder(check.path);
    return false;
  }
  const error = await shell.openPath(check.path);
  if (error) {
    log(`file not opened: ${error}`);
    return false;
  }
  log('file opened with the system');
  return true;
}

/** "Mostra nella cartella": the file selected in the system's file manager. */
export function showVaultFile(
  vault: string | null,
  path: unknown,
  shell: FileShell,
  log: (line: string) => void,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!vault) return false;
  const check = checkVaultFile(vault, path, platform);
  if (!check.ok) {
    log(`file not shown: ${check.reason}`);
    return false;
  }
  shell.showItemInFolder(check.path);
  return true;
}
