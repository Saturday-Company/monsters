/*
 * Files that make the computer run commands later: git hooks and config, shell
 * profiles, autostart entries, editor and package-manager settings that name a
 * program. Writing one is as good as the terminal, so `fs_write` and `fs_move`
 * refuse them to the agents without the terminal permission (docs/security-model.md). The
 * list is not exhaustive: with the terminal permission none of this matters.
 */

/** Any folder or file with this name, at any depth. */
const LAUNCH_SEGMENTS = new Map([
  ['.git', 'a git folder (hooks and config run commands)'],
  ['.husky', 'a folder of git hooks'],
  ['.ssh', 'the SSH folder (authorized_keys and rc run commands)'],
  ['.vscode', 'editor settings (tasks run commands)'],
  // Claude Code and Codex started there by the user read them: hooks and MCP servers run commands.
  ['.claude', 'Claude Code settings (hooks and MCP servers run commands)'],
  ['.codex', 'Codex settings (MCP servers run commands)'],
  // Folders of a repo that run commands at the user's next build, test or commit (review of
  // 18/10, B1).
  ['.devcontainer', 'a dev container (its commands run when the folder is opened)'],
  ['.idea', 'editor settings (run configurations and tasks run commands)'],
]);

/** Files with this name, at any depth. */
const LAUNCH_FILES = new Set([
  '.bashrc',
  '.bash_profile',
  '.bash_login',
  '.bash_logout',
  '.profile',
  '.zshrc',
  '.zshenv',
  '.zprofile',
  '.zlogin',
  '.zlogout',
  '.cshrc',
  '.tcshrc',
  '.login',
  '.kshrc',
  '.envrc',
  '.xprofile',
  '.xinitrc',
  '.xsession',
  '.xsessionrc',
  '.pam_environment',
  '.gitconfig',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.vimrc',
  '.gvimrc',
  '.exrc',
  'profile.ps1',
  // The MCP servers of a folder, started by Claude Code there.
  '.mcp.json',
  // Files of a repo that name commands the user runs next: `make`, `just`, `task`, the git
  // hooks managers, pytest, tox, nox, Python and pnpm set-up code (review of 18/10, B1).
  // `package.json` is not here: it is checked by its content (`packageJsonReason`).
  'makefile',
  'gnumakefile',
  'justfile',
  'taskfile.yml',
  'taskfile.yaml',
  '.pre-commit-config.yaml',
  'lefthook.yml',
  'lefthook.yaml',
  '.lefthook.yml',
  '.lefthook.yaml',
  'conftest.py',
  'tox.ini',
  'noxfile.py',
  'setup.py',
  'build.rs',
  '.pnpmfile.cjs',
]);

/** Consecutive folders, at any depth. */
const LAUNCH_FOLDERS: string[][] = [
  ['.config', 'autostart'],
  ['.config', 'systemd'],
  ['.config', 'environment.d'],
  ['.config', 'fish'],
  ['.config', 'git'],
  ['.config', 'nvim'],
  // Launchers and programs of the user on Linux (review of 18/10, M9).
  ['.local', 'share', 'applications'],
  ['.local', 'bin'],
  ['.cargo', 'config.toml'],
  ['.cargo', 'config'],
  ['.github', 'workflows'],
  ['library', 'launchagents'],
  ['library', 'launchdaemons'],
  ['start menu', 'programs', 'startup'],
];

/**
 * A path segment as the file system sees it: case folded, and without what
 * Windows ignores (trailing dots and spaces, `:stream` suffixes), so `.GIT.`
 * and `.git::$INDEX_ALLOCATION` are `.git`.
 */
export function segment(name: string): string {
  return name
    .toLowerCase()
    .replace(/:.*$/, '')
    .replace(/[. ]+$/, (m) => (m === name ? m : ''));
}

/** Why writing at `path` could run commands, or null. Checked on all platforms. */
export function launchFileReason(path: string): string | null {
  const parts = path
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(segment);
  for (const p of parts) {
    const reason = LAUNCH_SEGMENTS.get(p);
    if (reason) return reason;
  }
  const last = parts.at(-1);
  if (last && (LAUNCH_FILES.has(last) || last.endsWith('_profile.ps1'))) {
    return 'a file that shells or programs run at start';
  }
  for (const seq of LAUNCH_FOLDERS) {
    for (let i = 0; i + seq.length <= parts.length; i++) {
      if (seq.every((s, j) => parts[i + j] === s))
        return 'a folder of programs started automatically';
    }
  }
  return null;
}

/** Keys of a `package.json` that name commands run by the package manager or the git hooks. */
const PACKAGE_COMMAND_KEYS = [
  'scripts',
  'husky',
  'simple-git-hooks',
  'lint-staged',
  'pre-commit',
  'nano-staged',
  'bin',
];

function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sorted(x)]),
    );
  }
  return v;
}

/** The commands a `package.json` text names, in a stable form; null when it is not a JSON object. */
function commandsOf(text: string | null): string | null {
  if (text === null) return '{}';
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const out: Record<string, unknown> = {};
  for (const k of PACKAGE_COMMAND_KEYS) {
    if (k in json) out[k] = (json as Record<string, unknown>)[k];
  }
  return JSON.stringify(sorted(out));
}

/**
 * `package.json` cannot be closed to the agents without the terminal (dependencies, name and
 * version are the daily work of a project), but its `scripts` and hook keys run commands at the
 * user's next `pnpm test` or `git commit` (review of 18/10, B1). Why writing `after` over
 * `before` (null: a new file) changes them, or null when it does not. A text that is not JSON
 * is refused: nothing says what it will be.
 */
export function packageJsonReason(
  path: string,
  before: string | null,
  after: string,
): string | null {
  const last = path
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(segment)
    .at(-1);
  if (last !== 'package.json') return null;
  const now = commandsOf(after);
  if (now === null) {
    return 'a package.json that is not a valid JSON object, so its scripts cannot be checked';
  }
  // A file that was not valid JSON before is a new start: its scripts are checked against none.
  if (now === (commandsOf(before) ?? '{}')) return null;
  return 'a package.json whose scripts or hooks change (they run commands at the next test or commit)';
}
