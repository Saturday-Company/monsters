import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { DEFAULT_PORT } from '@monsters/shared';

export const DEFAULT_HOST = '127.0.0.1';

/** Mode of the data directory and its subdirectories: owner only. */
export const DIR_MODE = 0o700;
/** Mode of sensitive files (db, tokens, secrets): owner read/write only. */
export const FILE_MODE = 0o600;

export interface CoreConfig {
  /** Data directory (`MONSTERS_HOME`, default `~/.monsters`). */
  home: string;
  host: string;
  port: number;
  /**
   * Browser origins allowed to call the API and open the WebSocket. Requests
   * without an `Origin` header (CLI, curl) are not affected.
   */
  allowedOrigins: string[];
  /** Must be true to bind to an address that is not loopback. */
  allowNonLoopback: boolean;
  /** Session lifetime in milliseconds. */
  sessionTtlMs: number;
  /**
   * Development mode (`MONSTERS_DEV=1`): also trusts the Vite dev server
   * origins (port 5173). Never on by default.
   */
  dev: boolean;
  /** Largest request body accepted by the API, in bytes. */
  maxBodyBytes: number;
}

export interface ConfigOverrides {
  home?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
  allowedOrigins?: string[] | undefined;
  allowNonLoopback?: boolean | undefined;
  sessionTtlMs?: number | undefined;
  dev?: boolean | undefined;
  maxBodyBytes?: number | undefined;
}

export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
/** Port of the Vite dev server of the web UI, trusted only in development mode. */
export const DEV_UI_PORT = 5173;

/** Resolves the data directory from an explicit value, `MONSTERS_HOME` or the default. */
export function resolveHome(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = explicit ?? env['MONSTERS_HOME'] ?? join(homedir(), '.monsters');
  const expanded = raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw;
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid port: ${value}`);
  }
  return port;
}

/**
 * Local origins the web UI may be served from, for a given core port: the core
 * itself and, only in development mode, the Vite dev server of apps/web.
 */
export function defaultAllowedOrigins(port: number, dev = false): string[] {
  const hosts = ['127.0.0.1', 'localhost', '[::1]'];
  const ports = dev ? [port, DEV_UI_PORT] : [port];
  return hosts.flatMap((h) => ports.map((p) => `http://${h}:${p}`));
}

function parseFlag(value: string | undefined): boolean {
  return value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseBytes(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid byte size: ${value}`);
  return n;
}

/** Builds the configuration from overrides, environment variables and defaults. */
export function loadConfig(
  overrides: ConfigOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): CoreConfig {
  const port = overrides.port ?? parsePort(env['MONSTERS_PORT']) ?? DEFAULT_PORT;
  const envOrigins = env['MONSTERS_ALLOWED_ORIGINS']
    ?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const dev = overrides.dev ?? parseFlag(env['MONSTERS_DEV']);
  return {
    home: resolveHome(overrides.home, env),
    host: overrides.host ?? env['MONSTERS_HOST'] ?? DEFAULT_HOST,
    port,
    allowedOrigins: overrides.allowedOrigins ?? envOrigins ?? defaultAllowedOrigins(port, dev),
    allowNonLoopback: overrides.allowNonLoopback ?? false,
    sessionTtlMs: overrides.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
    dev,
    maxBodyBytes:
      overrides.maxBodyBytes ??
      parseBytes(env['MONSTERS_MAX_BODY_BYTES']) ??
      DEFAULT_MAX_BODY_BYTES,
  };
}

/** Paths of the files inside the data directory. */
export function homePaths(home: string) {
  return {
    home,
    db: join(home, 'monsters.db'),
    cliToken: join(home, 'cli-token'),
    serverInfo: join(home, 'server.json'),
    setupCode: join(home, 'setup-code'),
    processGroups: join(home, 'process-groups.json'),
    secrets: join(home, 'secrets'),
  };
}

/** Creates the data directory (and parents) with owner-only permissions. */
export function ensureHome(home: string): void {
  mkdirSync(home, { recursive: true, mode: DIR_MODE });
  // mkdir honours the umask and leaves existing directories untouched: enforce.
  chmodSafe(home, DIR_MODE);
}

/** chmod that ignores platforms without POSIX permissions. */
export function chmodSafe(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch (err) {
    if (process.platform !== 'win32') throw err;
  }
}

/** Atomically writes a file readable and writable only by the owner. */
export function writeSensitiveFile(path: string, content: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode: FILE_MODE });
  chmodSafe(tmp, FILE_MODE);
  try {
    renameSyncWithRetry(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * `renameSync` that retries for a moment when Windows refuses to replace a
 * file another program holds open (EPERM, EACCES, EBUSY).
 */
function renameSyncWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      const transient =
        code === 'EBUSY' ||
        (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES'));
      if (!transient || attempt >= 8) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * 2 ** Math.min(attempt, 4));
    }
  }
}

/** True for loopback addresses and `localhost`. */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  if (/^127(\.\d{1,3}){3}$/.test(h)) return true;
  return h.startsWith('::ffff:127.');
}
