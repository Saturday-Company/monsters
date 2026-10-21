/*
 * The tunnel against a real OpenSSH server and a real core. sshd runs as the
 * current user on a random port of 127.0.0.1, with its own host key and
 * authorized_keys in a temp folder (`@monsters/remote/testing`); the client
 * uses an empty ssh_config and its own known_hosts. The user's ~/.ssh is never
 * read or written. Skipped when sshd is not installed or cannot start (e.g.
 * Windows).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, request } from 'node:http';
import { dirname, join } from 'node:path';
import { startCore, type CoreServer } from '@monsters/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  openTunnel,
  type ConnectionProfile,
  type HostKeyInfo,
  type Tunnel,
  type TunnelOptions,
  type TunnelState,
} from '../src/index.ts';
import { pickLocalPort } from '../src/ports.ts';
import { startTestSshd, type TestSshd } from '../src/testing/index.ts';

let skipReason: string | null = null;
let sshd: TestSshd | null = null;
let dir = '';
let sshPort = 0;
let core: CoreServer | null = null;
let coreHome = '';
let hostFingerprint = '';

beforeAll(async () => {
  const started = await startTestSshd();
  if ('skip' in started) {
    skipReason = started.skip;
    return;
  }
  sshd = started;
  ({ dir, port: sshPort, hostFingerprint } = started);
  coreHome = join(dir, 'monsters-home');
  core = await startCore({ home: coreHome, port: 0, webDist: false });
}, 30_000);

afterAll(async () => {
  await core?.close();
  await sshd?.stop();
});

const open: Tunnel[] = [];
afterAll(async () => {
  for (const t of open) await t.close();
});

function profile(extra: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    name: 'sshd di prova',
    host: '127.0.0.1',
    sshPort,
    identityFile: join(dir, 'client'),
    remoteHome: coreHome,
    ...extra,
  };
}

function tunnel(p: ConnectionProfile, extra: TunnelOptions = {}): Tunnel {
  const env = { ...process.env };
  delete env['SSH_AUTH_SOCK'];
  const t = openTunnel(p, {
    configFile: join(dir, 'ssh_config'),
    userKnownHostsFiles: [],
    knownHostsFile: join(dir, 'known_hosts'),
    env,
    healthIntervalMs: 200,
    reconnect: { initialDelayMs: 100, maxDelayMs: 400, maxAttempts: 5 },
    ...extra,
  });
  open.push(t);
  return t;
}

function get(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      let body = '';
      res.on('data', (d: Buffer) => (body += d.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function openSocket(url: string, headers: Record<string, string>): Promise<'open' | number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.once('open', () => {
      ws.close();
      resolve('open');
    });
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.once('error', () => resolve(0));
  });
}

function until(t: Tunnel, pred: (s: TunnelState) => boolean, ms = 15_000): Promise<TunnelState> {
  return new Promise((resolve, reject) => {
    if (pred(t.state)) return resolve(t.state);
    const timer = setTimeout(() => reject(new Error(`timeout in ${t.state.status}`)), ms);
    const off = t.onState((s) => {
      if (pred(s)) {
        clearTimeout(timer);
        off();
        resolve(s);
      }
    });
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Command lines of the ssh clients of this test (`-p <sshPort> … -N`). `ps` rather than
 * `pgrep -a`: on macOS `-a` lists ancestors and pgrep prints no arguments.
 */
function sshProcesses(): { stdout: string } {
  const ps = spawnSync('ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8' });
  const mine = new RegExp(`-p ${sshPort} .* -N `);
  return {
    stdout: ps.stdout
      .split('\n')
      .filter((l) => mine.test(l))
      .join('\n'),
  };
}

describe('tunnel through a real sshd to a real core', { timeout: 60_000 }, () => {
  it('confirms the host key on first use, then reaches the core with its own guards', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    const asked: HostKeyInfo[] = [];
    const t = tunnel(profile(), {
      confirmHostKey: (info) => {
        asked.push(info);
        return true;
      },
    });
    const info = await t.connected();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.knownHostsName).toBe(`[127.0.0.1]:${sshPort}`);
    expect(asked[0]!.keys[0]!.fingerprint).toBe(hostFingerprint);
    expect(readFileSync(join(dir, 'known_hosts'), 'utf8')).toMatch(
      new RegExp(`^\\[127\\.0\\.0\\.1\\]:${sshPort} ssh-ed25519 `),
    );

    // Same machine: the core's port is taken here, so the tunnel uses another one.
    expect(info).toMatchObject({
      remotePort: core!.port,
      remotePortSource: 'server.json',
      originRewrite: true,
    });
    expect(info.localPort).not.toBe(core!.port);

    expect((await get(`${info.url}/api/health`, {})).status).toBe(200);
    const origin = { Origin: info.url };
    const refused = await get(`${info.url}/api/setup-status`, origin);
    expect(refused).toMatchObject({ status: 403 });
    expect(refused.body).toContain('origin_not_allowed');
    const rewritten = t.rewriteHeaders(`${info.url}/api/setup-status`, origin);
    expect(rewritten).toEqual({ Origin: `http://127.0.0.1:${core!.port}` });
    expect(await get(`${info.url}/api/setup-status`, rewritten)).toMatchObject({ status: 200 });
    // A page on another local port stays refused.
    expect(
      (await get(`${info.url}/api/setup-status`, { Origin: 'http://127.0.0.1:5173' })).status,
    ).toBe(403);

    // The WebSocket stream, as the app window opens it.
    const token = readFileSync(join(coreHome, 'cli-token'), 'utf8').trim();
    const wsUrl = `ws://127.0.0.1:${info.localPort}/api/stream`;
    const auth = { authorization: `Bearer ${token}` };
    expect(await openSocket(wsUrl, { ...auth, Origin: info.url })).toBe(403);
    expect(
      await openSocket(wsUrl, { ...auth, ...t.rewriteHeaders(wsUrl, { Origin: info.url }) }),
    ).toBe('open');
    await t.close();
  });

  it('reconnects on the same local port when ssh dies, and close() leaves nothing behind', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    const t = tunnel(profile(), {
      confirmHostKey: () => {
        throw new Error('the host is known now');
      },
    });
    const first = await t.connected();
    const pid = t.pid!;
    // As if the network dropped: ssh and its guard die.
    process.kill(-pid, 'SIGKILL');
    await until(t, (s) => s.status === 'reconnecting');
    const again = await until(t, (s) => s.status === 'connected');
    expect(again).toMatchObject({ localPort: first.localPort, remotePort: core!.port });
    expect((await get(`${first.url}/api/health`, {})).status).toBe(200);
    const pid2 = t.pid!;
    expect(pid2).not.toBe(pid);
    await t.close();
    expect(alive(pid2)).toBe(false);
    expect(await get(`${first.url}/api/health`, {}).catch(() => 'down')).toBe('down');
  });

  it('refuses a changed host key without asking', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    const knownHostsFile = join(dir, 'known_hosts_changed');
    const fake = readFileSync(join(dir, 'stranger.pub'), 'utf8').split(' ').slice(0, 2).join(' ');
    writeFileSync(knownHostsFile, `[127.0.0.1]:${sshPort} ${fake}\n`);
    let asked = false;
    const t = tunnel(profile(), { knownHostsFile, confirmHostKey: () => (asked = true) });
    const err = await t.connected().catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'host-key-changed', retryable: false });
    expect((err as { detail: string }).detail).toMatch(/REMOTE HOST IDENTIFICATION HAS CHANGED/);
    expect(asked).toBe(false);
  });

  it('reports a key that the server does not accept', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    const t = tunnel(profile({ identityFile: join(dir, 'stranger') }));
    const err = await t.connected().catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'auth-failed' });
    expect((err as Error).message).toMatch(/only uses SSH keys/);
  });

  it('says when SSH works but no core answers on the remote port', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    // Same machine: with equal ports the tunnel would forward to itself.
    const t = tunnel(profile({ remotePort: await pickLocalPort() }), {
      connectTimeoutMs: 3_000,
      preferSamePort: false,
    });
    const err = await t.connected().catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'core-unreachable' });
    expect((err as { detail: string }).detail).toMatch(/open failed/);
  });

  it('ssh listens on a Unix socket in a private folder; the window port is the tunnel own', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    const t = tunnel(profile());
    const info = await t.connected();
    const ps = sshProcesses();
    const socket = /-L (\/\S+\.sock):127\.0\.0\.1:(\d+)/.exec(ps.stdout);
    expect(socket, ps.stdout).not.toBeNull();
    expect(Number(socket![2])).toBe(core!.port);
    expect(statSync(dirname(socket![1]!)).mode & 0o777).toBe(0o700);
    expect(statSync(socket![1]!).mode & 0o777).toBe(0o600);
    // The port of the window is held by this process, not by ssh.
    const holder = spawnSync('ss', ['-Hltnp', `sport = :${info.localPort}`], { encoding: 'utf8' });
    if (holder.status === 0 && holder.stdout.includes('pid=')) {
      expect(holder.stdout).toContain(`pid=${process.pid},`);
    }
    await t.close();
    expect(existsSync(dirname(socket![1]!))).toBe(false);
  });

  it('the TCP forward of Windows works the same way (proved, behind the tunnel port)', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    const t = tunnel(profile(), { forward: 'tcp' });
    const info = await t.connected();
    const ps = sshProcesses();
    const forward = /-L 127\.0\.0\.1:(\d+):127\.0\.0\.1:(\d+)/.exec(ps.stdout);
    expect(forward, ps.stdout).not.toBeNull();
    expect(Number(forward![1])).not.toBe(info.localPort);
    const rewritten = t.rewriteHeaders(`${info.url}/api/setup-status`, { Origin: info.url });
    expect(await get(`${info.url}/api/setup-status`, rewritten)).toMatchObject({ status: 200 });
    await t.close();
  });

  it('refuses something on the remote port that cannot prove it is the core (S1, S4)', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    // Another user of the remote computer took the port while the core was off and
    // answers like a core; the server.json left there has a key the impostor does not know.
    const requests: string[] = [];
    const impostor = createHttpServer((req, res) => {
      requests.push(`${req.url} ${req.headers.authorization ?? ''}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, version: '0.1.0' }));
    });
    await new Promise<void>((r) => impostor.listen(0, '127.0.0.1', r));
    const port = (impostor.address() as { port: number }).port;
    const home = join(dir, 'impostor-home');
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, 'server.json'),
      JSON.stringify({
        pid: 1,
        host: '127.0.0.1',
        port,
        url: '',
        version: '0.1.0',
        proofKey: 'k'.repeat(43),
      }),
    );
    try {
      const t = tunnel(profile({ remoteHome: home }), { connectTimeoutMs: 5_000 });
      const states: string[] = [];
      t.onState((s) => states.push(s.status));
      const err = await t.connected().catch((e: unknown) => e);
      expect(err).toMatchObject({ kind: 'core-unverified' });
      expect(states).not.toContain('connected');
      expect(requests.length).toBeGreaterThan(0);
      for (const r of requests) expect(r).toMatch(/^\/api\/health\?proof=\S+ $/);
      await t.close();
    } finally {
      await new Promise<void>((r) => impostor.close(() => r()));
    }
  });

  it('follows the core when it stops and starts again', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    const t = tunnel(profile());
    const info = await t.connected();
    const port = core!.port;
    await core!.close();
    const down = await until(t, (s) => s.status === 'reconnecting');
    expect(down).toMatchObject({ error: { kind: 'core-unreachable' } });
    core = await startCore({ home: coreHome, port, webDist: false });
    const back = await until(t, (s) => s.status === 'connected');
    expect(back).toMatchObject({ localPort: info.localPort, remotePort: port });
    await t.close();
  });

  it('reads files of the remote data directory over SSH (setup code, CLI token)', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    const t = tunnel(profile());
    await t.connected();
    const token = readFileSync(join(coreHome, 'cli-token'), 'utf8').trim();
    expect(await t.readRemoteFile('cli-token')).toBe(token);
    // The core of this test has no account yet: the setup code is there.
    const code = readFileSync(join(coreHome, 'setup-code'), 'utf8').trim();
    expect(await t.readRemoteFile('setup-code')).toBe(code);
    // A missing file (another data directory) is null, not an error.
    const other = tunnel(profile({ remoteHome: join(dir, 'nowhere'), remotePort: core!.port }));
    // No server.json there: no key to check the core with, so no connection either.
    await expect(other.connected()).rejects.toMatchObject({ kind: 'core-unreachable' });
    expect(await other.readRemoteFile('setup-code')).toBeNull();
    await other.close();
    await t.close();
    expect(await t.readRemoteFile('cli-token')).toBeNull();
  });

  it('reconnectNow() while connected: a dead link is replaced at once', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    const t = tunnel(profile(), { healthIntervalMs: 60_000, healthTimeoutMs: 500 });
    const first = await t.connected();
    const pid = t.pid!;
    // As after a sleep: ssh is still there but nothing goes through.
    process.kill(-pid, 'SIGSTOP');
    try {
      t.reconnectNow();
      await until(t, (s) => s.status === 'reconnecting', 5_000);
      const again = await until(t, (s) => s.status === 'connected');
      expect(again).toMatchObject({ localPort: first.localPort });
      expect(t.pid).not.toBe(pid);
    } finally {
      try {
        process.kill(-pid, 'SIGCONT');
        process.kill(-pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    // A healthy link stays as it is.
    const pid2 = t.pid;
    t.reconnectNow();
    await new Promise((r) => setTimeout(r, 300));
    expect(t.state.status).toBe('connected');
    expect(t.pid).toBe(pid2);
    await t.close();
  });
});
