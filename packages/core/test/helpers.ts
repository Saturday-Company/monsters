import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

const homes: string[] = [];

/** Creates a temporary MONSTERS_HOME removed after each test. */
export function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'monsters-test-'));
  homes.push(dir);
  return join(dir, 'home');
}

afterEach(() => {
  // Windows: a file just closed (database, a child's directory) may stay busy for a moment.
  for (const dir of homes.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

export const EMAIL = 'giulio@example.com';
export const PASSWORD = 'correct horse battery';

/** Extracts `name=value` of the session cookie from a response. */
export function sessionCookie(res: Response): string | undefined {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith('monsters_session='));
  return raw?.split(';')[0];
}

/**
 * What a browser's session sends from the answer of setup or login (S-B13): the cookie and, in
 * its header, the secret the UI keeps in its tab.
 */
export async function browserSession(
  res: Response,
): Promise<{ cookie: string; 'x-monsters-session': string }> {
  const body = (await res.clone().json()) as { sessionSecret?: unknown };
  return {
    cookie: sessionCookie(res) ?? '',
    'x-monsters-session': typeof body.sessionSecret === 'string' ? body.sessionSecret : '',
  };
}

/** Headers a browser client of the core sends on state-changing requests. */
export const BROWSER_HEADERS = {
  'content-type': 'application/json',
  'x-monsters-request': '1',
} as const;

export function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { ...BROWSER_HEADERS, ...headers },
    body: JSON.stringify(body),
  });
}

/** Creates the local user through the API, with the core's one-time setup code. */
export function setupUser(
  core: { url: string; setupCode: string | null },
  headers: Record<string, string> = {},
) {
  return postJson(
    `${core.url}/api/setup`,
    { email: EMAIL, password: PASSWORD, setupCode: core.setupCode ?? '' },
    headers,
  );
}

/** Raw HTTP request that lets the test set any Host header. */
export function rawGet(
  port: number,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Like `isPidAlive`, but a zombie (exited, not yet reaped) counts as dead. */
export function isPidRunning(pid: number): boolean {
  if (!isPidAlive(pid)) return false;
  if (process.platform !== 'linux') return true;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    return stat.slice(close + 2, close + 3) !== 'Z';
  } catch {
    return false;
  }
}

export async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}
