import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/*
 * The data directory the app shares with the CLI (`MONSTERS_HOME`, default `~/.monsters`)
 * and the files of the core the app reads in it. Same names as `homePaths()` of
 * @monsters/core (checked by a test): the app does not import the core.
 */

export const HOME_FILES = {
  /** `{pid, start, acquiredAt}` of the core that owns the directory. */
  lock: 'core.lock',
  /** `{pid, host, port, url, …}` of the core listening, written once it listens. */
  serverInfo: 'server.json',
  /** Bearer token of the CLI (mode 600), rotated at every start of the core. */
  cliToken: 'cli-token',
  /** One-time code of `POST /api/setup` (mode 600) while no account exists. */
  setupCode: 'setup-code',
} as const;

/** Same rule as the core: explicit, then `MONSTERS_HOME`, then `~/.monsters`. */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env['MONSTERS_HOME'] ?? join(homedir(), '.monsters');
  const expanded = raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw;
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

export function homeFile(home: string, name: keyof typeof HOME_FILES): string {
  return join(home, HOME_FILES[name]);
}

/** The app's own log, next to the data it manages. */
export function desktopLogPath(home: string): string {
  return join(home, 'logs', 'desktop.log');
}

/** Creates a directory readable only by the user (like the core does with the home). */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Windows: no POSIX modes.
  }
}

/** A file's text, or null when it is missing or unreadable. */
export function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
