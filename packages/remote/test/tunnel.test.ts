import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { connect, createServer, type Server } from 'node:net';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openTunnel,
  sshFingerprint,
  type ConnectionProfile,
  type Tunnel,
  type TunnelOptions,
  type TunnelState,
} from '../src/index.ts';
import { pickLocalPort } from '../src/ports.ts';
import { FAKE_PROOF_KEY, fakeSsh, forwardOf, type FakeSshConfig } from './fake-ssh.ts';

const KEY = 'AAAAC3NzaC1lZDI1NTE5AAAAICjkmTszvNkX0rJ7znWyLnK4+3ggIu3PV8+7fW3RhYmO';
const profile: ConnectionProfile = { name: 'PC di casa', host: 'casa' };

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'monsters-tunnel-'));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

function serverJson(port: number, proofKey: string | null = FAKE_PROOF_KEY) {
  return () => ({
    code: 0,
    stdout: JSON.stringify({
      pid: 1,
      host: '127.0.0.1',
      port,
      url: '',
      version: 'x',
      ...(proofKey ? { proofKey } : {}),
    }),
  });
}

function start(config: FakeSshConfig, p: ConnectionProfile = profile, extra: TunnelOptions = {}) {
  const fake = fakeSsh({ discovery: serverJson(4747), ...config });
  const states: TunnelState[] = [];
  const tunnel = openTunnel(p, {
    spawn: fake.spawn,
    sshPath: '/usr/bin/ssh',
    keyscanPath: '/usr/bin/ssh-keyscan',
    knownHostsFile: join(tmp(), 'known_hosts'),
    connectTimeoutMs: 3_000,
    healthIntervalMs: 50,
    healthTimeoutMs: 500,
    reconnect: { initialDelayMs: 10, maxDelayMs: 40, maxAttempts: 3 },
    ...extra,
  });
  tunnel.onState((s) => states.push(s));
  cleanups.push(() => tunnel.close());
  return { fake, tunnel, states };
}

function until(
  tunnel: Tunnel,
  pred: (s: TunnelState) => boolean,
  ms = 5_000,
): Promise<TunnelState> {
  return new Promise((resolve, reject) => {
    if (pred(tunnel.state)) return resolve(tunnel.state);
    const timer = setTimeout(() => reject(new Error(`timeout, state ${tunnel.state.status}`)), ms);
    const off = tunnel.onState((s) => {
      if (pred(s)) {
        clearTimeout(timer);
        off();
        resolve(s);
      }
    });
  });
}

async function occupy(): Promise<{ port: number; server: Server }> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  return { port, server };
}

/** What a local client (the window) gets from the tunnel's listener: an answer or a closed socket. */
function poke(port: number, path = '/api/me'): Promise<string> {
  return new Promise((resolve) => {
    const s = connect(port, '127.0.0.1');
    let data = '';
    s.on('connect', () =>
      s.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer secret\r\n\r\n`),
    );
    s.on('data', (d: Buffer) => {
      data += d.toString();
      s.destroy();
    });
    s.on('error', () => resolve('closed'));
    s.on('close', () => resolve(data === '' ? 'closed' : data));
  });
}

describe('openTunnel with a fake ssh', () => {
  // OpenSSH for Windows has no usable Unix-socket forwards: there ssh gets an inner TCP port
  // (D-044), covered by the `forward: 'tcp'` tests below.
  it.skipIf(process.platform === 'win32')(
    'by default listens on a port chosen by the system, ssh on a private Unix socket',
    async () => {
      const remotePort = await pickLocalPort();
      const { tunnel, fake } = start({
        discovery: serverJson(remotePort),
        tunnels: [{ serve: true }],
      });
      const info = await tunnel.connected();
      expect(info.localPort).not.toBe(remotePort);
      expect(info.originRewrite).toBe(true);
      const { local } = forwardOf(fake.tunnels()[0]!.args);
      expect(typeof local).toBe('string');
      const dir = dirname(local as string);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(fake.tunnels()[0]!.args).toEqual(
        expect.arrayContaining(['StreamLocalBindUnlink=yes', 'StreamLocalBindMask=0177']),
      );
      // The window's requests go through the tunnel's listener to ssh.
      expect(await poke(info.localPort, '/api/health')).toMatch(/^HTTP\/1\.1 200/);
      await tunnel.close();
      expect(existsSync(dir)).toBe(false);
      expect(await poke(info.localPort)).toBe('closed');
    },
  );

  it('uses the remote port locally when asked and free: no Origin rewrite', async () => {
    const remotePort = await pickLocalPort();
    const { tunnel, states, fake } = start(
      {
        discovery: serverJson(remotePort),
        tunnels: [{ serve: true }],
      },
      profile,
      { preferSamePort: true, forward: 'tcp' },
    );
    const info = await tunnel.connected();
    expect(info).toMatchObject({
      localPort: remotePort,
      remotePort,
      remotePortSource: 'server.json',
      url: `http://127.0.0.1:${remotePort}`,
      coreVersion: 'fake',
      originRewrite: false,
    });
    expect(states.map((s) => s.status)).toEqual(['connected']);
    expect(tunnel.state.status).toBe('connected');
    // ssh listens on another port of 127.0.0.1 (Windows): only the tunnel talks to it.
    const { local } = forwardOf(fake.tunnels()[0]!.args);
    expect(typeof local).toBe('number');
    expect(local).not.toBe(remotePort);
    // The tunnel runs through the guard (POSIX) or directly (Windows).
    expect(fake.calls.map((c) => c.kind)).toEqual(['discovery', 'tunnel']);
  });

  it('picks another local port when the remote one is taken here, and rewrites Origin', async () => {
    const { port: busy } = await occupy();
    const { tunnel } = start({ discovery: serverJson(busy), tunnels: [{ serve: true }] }, profile, {
      preferSamePort: true,
    });
    const info = await tunnel.connected();
    expect(info.remotePort).toBe(busy);
    expect(info.localPort).not.toBe(busy);
    expect(info.originRewrite).toBe(true);
    expect(
      tunnel.rewriteHeaders(`http://127.0.0.1:${info.localPort}/api/x`, {
        Origin: `http://127.0.0.1:${info.localPort}`,
      }),
    ).toEqual({ Origin: `http://127.0.0.1:${busy}` });
  });

  it('without a server.json (core off) says so and starts no ssh', async () => {
    const { tunnel, fake } = start(
      { discovery: () => ({ code: 1, stderr: 'cat: no such file\n' }), tunnels: [{ serve: true }] },
      { ...profile, remotePort: 4747 },
    );
    await expect(tunnel.connected()).rejects.toMatchObject({ kind: 'core-unreachable' });
    expect(fake.tunnels()).toHaveLength(0);
  });

  it('a remote core too old to prove who it is is refused', async () => {
    const { tunnel, fake } = start({
      discovery: serverJson(4747, null),
      tunnels: [{ serve: true }],
    });
    const err = await tunnel.connected().catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'core-outdated', retryable: false });
    expect((err as Error).message).toMatch(/update it and restart it/);
    expect(fake.tunnels()).toHaveLength(0);
  });

  it("uses the profile's port, with the key of server.json", async () => {
    const remotePort = await pickLocalPort();
    const { tunnel, fake } = start({ tunnels: [{ serve: true }] }, { ...profile, remotePort });
    expect(await tunnel.connected()).toMatchObject({ remotePortSource: 'profile', remotePort });
    expect(fake.calls.map((c) => c.kind)).toEqual(['discovery', 'tunnel']);
  });

  it('never says connected to something that cannot prove it is the core (S1)', async () => {
    // Someone else answers {ok:true} where ssh should listen (another local user who took
    // the port of a TCP forward, or another user of the remote computer on the core's
    // port): no proof for the key of server.json.
    const { tunnel, fake } = start(
      {
        tunnels: [
          {
            serve: true,
            health: () => ({ status: 200, body: { ok: true, version: 'x' }, noProof: true }),
          },
        ],
      },
      { ...profile, remotePort: 4747 },
      { forward: 'tcp' },
    );
    const states: string[] = [];
    tunnel.onState((s) => states.push(s.status));
    const err = await tunnel.connected().catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'core-unverified' });
    expect((err as Error).message).toMatch(/doesn’t prove/);
    expect(states).not.toContain('connected');
    expect(fake.tunnels().length).toBeGreaterThan(0);
  });

  it('forwards nothing from the window before the proof: a squatter never sees a token (S1)', async () => {
    // ssh is still authenticating (it never listens) and someone else listens where it
    // will: the old tunnel took its {ok:true} for the core and the app sent the CLI token.
    const requests: string[] = [];
    const squatter = createHttpServer((req, res) => {
      requests.push(`${req.url} ${req.headers.authorization ?? ''}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, version: 'evil' }));
    });
    cleanups.push(() => new Promise<void>((r) => squatter.close(() => r())));
    const { tunnel, fake } = start(
      { tunnels: [{ hang: true }] },
      { ...profile, remotePort: 4747 },
      { forward: 'tcp', connectTimeoutMs: 1_500 },
    );
    const until2 = Date.now() + 2_000;
    while (fake.tunnels().length === 0 && Date.now() < until2) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const { local } = forwardOf(fake.tunnels()[0]!.args);
    await new Promise<void>((r) => squatter.listen(local as number, '127.0.0.1', r));
    const states: string[] = [];
    tunnel.onState((s) => states.push(s.status));
    // The window (or the app's automatic login) tries the tunnel's port meanwhile.
    const localPort = tunnel.localPort!;
    expect(localPort).toBeGreaterThan(0);
    expect(await poke(localPort)).toBe('closed');
    await expect(tunnel.connected()).rejects.toMatchObject({ kind: 'core-unverified' });
    expect(states).not.toContain('connected');
    // Only health checks with a nonce reached the squatter: no Authorization, no /api/me.
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) expect(r).toMatch(/^\/api\/health\?proof=[A-Za-z0-9_-]{43} $/);
  });

  it('closes the forwarding at once when ssh exits, until the core proves itself again', async () => {
    const remotePort = await pickLocalPort();
    const { tunnel, fake } = start(
      { tunnels: [{ serve: true }, { hang: true }] },
      { ...profile, remotePort },
      { reconnect: { initialDelayMs: 10, maxDelayMs: 10, maxAttempts: 50 } },
    );
    const info = await tunnel.connected();
    expect(await poke(info.localPort, '/api/health')).toMatch(/^HTTP\/1\.1 200/);
    fake.liveTunnel()!.exit(255, 'Connection closed by casa\n');
    await until(tunnel, (s) => s.status === 'reconnecting');
    // Same port, still ours, but nothing goes through while ssh is not proved.
    expect(await poke(info.localPort)).toBe('closed');
  });

  it('fails at once on refused keys, with a clear message and no retry', async () => {
    const { tunnel, states, fake } = start({
      discovery: () => ({ code: 255, stderr: 'giulio@casa: Permission denied (publickey).\n' }),
      tunnels: [{ serve: true }],
    });
    const err = await tunnel.connected().catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'auth-failed', retryable: false });
    expect((err as Error).message).toMatch(/only uses SSH keys/);
    expect((err as { detail: string }).detail).toMatch(/Permission denied/);
    expect(states.map((s) => s.status)).toEqual(['failed']);
    expect(fake.tunnels()).toHaveLength(0);
  });

  it('does not retry the first connection when the host is unreachable', async () => {
    const remotePort = await pickLocalPort();
    const { tunnel, states } = start(
      { tunnels: [{ fail: 'ssh: connect to host casa port 22: Connection refused\n' }] },
      { ...profile, remotePort },
    );
    await expect(tunnel.connected()).rejects.toMatchObject({ kind: 'unreachable' });
    expect(states.map((s) => s.status)).toEqual(['failed']);
  });

  it('reports a missing ssh', async () => {
    const { tunnel } = start({ spawnError: 'ENOENT', tunnels: [{ serve: true }] });
    await expect(tunnel.connected()).rejects.toMatchObject({ kind: 'ssh-missing' });
    const { tunnel: t2 } = start(
      { tunnels: [{ fail: 'monsters-ssh: 1: /usr/bin/ssh: not found\n', code: 127 }] },
      { ...profile, remotePort: 4747 },
      { localPort: await pickLocalPort() },
    );
    await expect(t2.connected()).rejects.toMatchObject({ kind: 'ssh-missing' });
  });

  it('asks to confirm an unknown host key, trusts it and connects', async () => {
    const remotePort = await pickLocalPort();
    const knownHostsFile = join(tmp(), 'kh');
    const asked: unknown[] = [];
    const { tunnel, fake } = start(
      {
        tunnels: [
          {
            fail: 'No ED25519 host key is known for casa and you have requested strict checking.\nHost key verification failed.\n',
          },
          { serve: true },
        ],
        resolve: 'hostname 100.64.0.7\nport 22\n',
        keyscan: `100.64.0.7 ssh-ed25519 ${KEY}\n`,
      },
      { ...profile, remotePort },
      {
        knownHostsFile,
        confirmHostKey: (info) => {
          asked.push(info);
          return true;
        },
      },
    );
    await tunnel.connected();
    expect(asked).toEqual([
      {
        host: 'casa',
        hostname: '100.64.0.7',
        port: 22,
        knownHostsName: '100.64.0.7',
        keys: [{ type: 'ssh-ed25519', key: KEY, fingerprint: sshFingerprint(KEY) }],
      },
    ]);
    expect(readFileSync(knownHostsFile, 'utf8')).toBe(`100.64.0.7 ssh-ed25519 ${KEY}\n`);
    expect(fake.calls.map((c) => c.kind)).toEqual([
      'discovery',
      'tunnel',
      'resolve',
      'keyscan',
      'discovery',
      'tunnel',
    ]);
    expect(fake.calls.find((c) => c.kind === 'keyscan')!.args).toEqual([
      '-T',
      '5',
      '-p',
      '22',
      '--',
      '100.64.0.7',
    ]);
  });

  it('without confirmation fails and hands the fingerprint to the caller', async () => {
    const { tunnel } = start(
      {
        discovery: () => ({
          code: 255,
          stderr: 'No ED25519 host key is known for casa\nHost key verification failed.\n',
        }),
        tunnels: [{ serve: true }],
        keyscan: `casa ssh-ed25519 ${KEY}\n`,
      },
      profile,
      { confirmHostKey: () => false },
    );
    const err = await tunnel.connected().catch((e: unknown) => e);
    expect(err).toMatchObject({
      kind: 'host-key-unknown',
      hostKey: { keys: [{ fingerprint: sshFingerprint(KEY) }] },
    });
  });

  it('a changed host key is a hard error: nothing is asked or written', async () => {
    let asked = false;
    const knownHostsFile = join(tmp(), 'kh');
    const { tunnel, fake } = start(
      {
        discovery: () => ({
          code: 255,
          stderr:
            '@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed.\n',
        }),
        tunnels: [{ serve: true }],
        keyscan: `casa ssh-ed25519 ${KEY}\n`,
      },
      profile,
      { knownHostsFile, confirmHostKey: () => (asked = true) },
    );
    await expect(tunnel.connected()).rejects.toMatchObject({
      kind: 'host-key-changed',
      retryable: false,
    });
    expect(asked).toBe(false);
    expect(fake.calls.map((c) => c.kind)).toEqual(['discovery']);
    expect(() => readFileSync(knownHostsFile)).toThrow();
  });

  it('reconnects with backoff on the same local port after a drop', async () => {
    const remotePort = await pickLocalPort();
    const { tunnel, states, fake } = start(
      {
        tunnels: [
          { serve: true },
          { fail: 'ssh: connect to host casa port 22: Connection refused\n' },
          { serve: true },
        ],
      },
      { ...profile, remotePort },
    );
    const first = await tunnel.connected();
    fake.liveTunnel()!.exit(255, 'Connection closed by 100.64.0.7 port 22\n');
    await until(tunnel, (s) => s.status === 'connected' && states.length > 1);
    expect(states.map((s) => s.status)).toEqual([
      'connected',
      'reconnecting',
      'reconnecting',
      'connected',
    ]);
    expect(states[1]).toMatchObject({
      attempt: 1,
      delayMs: 10,
      error: { kind: 'connection-lost' },
    });
    expect(states[2]).toMatchObject({ attempt: 2, delayMs: 20, error: { kind: 'unreachable' } });
    expect(tunnel.state).toMatchObject({ localPort: first.localPort });
  });

  it('gives up after maxAttempts', async () => {
    const remotePort = await pickLocalPort();
    const { tunnel, states, fake } = start(
      {
        tunnels: [
          { serve: true },
          { fail: 'ssh: connect to host casa port 22: Connection timed out\n' },
        ],
      },
      { ...profile, remotePort },
    );
    await tunnel.connected();
    fake.liveTunnel()!.exit(255, 'Timeout, server casa not responding.\n');
    await until(tunnel, (s) => s.status === 'failed');
    expect(states.map((s) => s.status)).toEqual([
      'connected',
      'reconnecting',
      'reconnecting',
      'reconnecting',
      'failed',
    ]);
    expect(tunnel.state).toMatchObject({ error: { kind: 'unreachable' } });
  });

  it('notices a remote core that stopped answering', async () => {
    const remotePort = await pickLocalPort();
    let healthy = true;
    const { tunnel, states } = start(
      {
        tunnels: [
          {
            serve: true,
            health: () =>
              healthy ? { status: 200, body: { ok: true } } : { status: 502, body: {} },
          },
        ],
      },
      { ...profile, remotePort },
    );
    await tunnel.connected();
    healthy = false;
    await until(tunnel, (s) => s.status === 'reconnecting');
    expect(states[1]).toMatchObject({
      status: 'reconnecting',
      error: { kind: 'core-unreachable' },
    });
    healthy = true;
    await until(tunnel, (s) => s.status === 'connected' && states.length > 2);
  });

  it('says when ssh works but no core answers', async () => {
    const remotePort = await pickLocalPort();
    const { tunnel } = start(
      { tunnels: [{ serve: true, health: () => ({ status: 404, body: 'not found' }) }] },
      { ...profile, remotePort },
      { connectTimeoutMs: 600 },
    );
    const err = await tunnel.connected().catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'core-unreachable' });
    expect((err as Error).message).toMatch(/monsters start/);
  });

  it('reconnectNow skips the wait, and starts over after failed', async () => {
    const remotePort = await pickLocalPort();
    const { tunnel, fake } = start(
      { tunnels: [{ serve: true }, { fail: 'Connection refused\n' }, { serve: true }] },
      { ...profile, remotePort },
      { reconnect: { initialDelayMs: 60_000, maxDelayMs: 60_000, maxAttempts: 1 } },
    );
    await tunnel.connected();
    fake.liveTunnel()!.exit(255, 'Connection closed by casa\n');
    await until(tunnel, (s) => s.status === 'reconnecting');
    tunnel.reconnectNow();
    await until(tunnel, (s) => s.status === 'failed');
    tunnel.reconnectNow();
    await until(tunnel, (s) => s.status === 'connected');
    expect(fake.tunnels()).toHaveLength(3);
  });

  it('reconnectNow after a first failure retries with backoff (DNS not ready after a wake)', async () => {
    const remotePort = await pickLocalPort();
    const dns = 'ssh: Could not resolve hostname casa: Name or service not known\n';
    const { tunnel, fake } = start(
      { tunnels: [{ fail: dns }, { fail: dns }, { serve: true }] },
      { ...profile, remotePort },
    );
    await until(tunnel, (s) => s.status === 'failed');
    tunnel.reconnectNow();
    await until(tunnel, (s) => s.status === 'connected');
    expect(fake.tunnels()).toHaveLength(3);
  });

  it('after giving up on a retryable error, a slow round starts by itself', async () => {
    const remotePort = await pickLocalPort();
    const { tunnel, fake } = start(
      {
        tunnels: [
          { fail: 'Connection refused\n' },
          { fail: 'Connection refused\n' },
          { serve: true },
        ],
      },
      { ...profile, remotePort },
      { reconnect: { initialDelayMs: 5, maxDelayMs: 5, maxAttempts: 1, slowRetryMs: 50 } },
    );
    await tunnel.connected().catch(() => undefined);
    await until(tunnel, (s) => s.status === 'connected');
    expect(fake.tunnels().length).toBeGreaterThanOrEqual(3);
  });

  it('after "Annulla" on the host key, reconnectNow() (wake, network) asks nothing; retry() does', async () => {
    let asked = 0;
    const { tunnel } = start(
      {
        discovery: () => ({
          code: 255,
          stderr: 'No ED25519 host key is known for casa\nHost key verification failed.\n',
        }),
        tunnels: [{ serve: true }],
        keyscan: `casa ssh-ed25519 ${KEY}\n`,
      },
      profile,
      {
        confirmHostKey: () => {
          asked += 1;
          return false;
        },
      },
    );
    await until(tunnel, (s) => s.status === 'failed');
    expect(asked).toBe(1);
    tunnel.reconnectNow();
    tunnel.reconnectNow();
    await new Promise((r) => setTimeout(r, 100));
    expect(asked).toBe(1);
    expect(tunnel.state).toMatchObject({ status: 'failed', error: { kind: 'host-key-unknown' } });
    // The user presses "Riprova": the fingerprint is shown again.
    tunnel.retry();
    await until(tunnel, (s) => s.status === 'connecting');
    await until(tunnel, (s) => s.status === 'failed');
    expect(asked).toBe(2);
  });

  it('a changed host key is not retried by reconnectNow() either', async () => {
    const { tunnel, fake } = start({
      discovery: () => ({
        code: 255,
        stderr: '@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\n',
      }),
      tunnels: [{ serve: true }],
    });
    await until(tunnel, (s) => s.status === 'failed');
    tunnel.reconnectNow();
    await new Promise((r) => setTimeout(r, 100));
    expect(fake.calls.filter((c) => c.kind === 'discovery')).toHaveLength(1);
    expect(tunnel.state.status).toBe('failed');
  });

  it('close() stops ssh and ends in closed', async () => {
    const remotePort = await pickLocalPort();
    const { tunnel, fake, states } = start(
      { tunnels: [{ serve: true }] },
      { ...profile, remotePort },
    );
    await tunnel.connected();
    const child = fake.liveTunnel()!;
    await tunnel.close();
    expect(child.exitCode).toBeNull();
    expect(fake.liveTunnel()).toBeUndefined();
    expect(states.at(-1)).toEqual({ status: 'closed' });
    await expect(tunnel.connected()).rejects.toThrow(/closed/);
    await tunnel.close();
  });

  it('close() while connecting stops the attempt', async () => {
    const { tunnel, fake } = start(
      { tunnels: [{ hang: true }] },
      { ...profile, remotePort: 4747 },
      {
        localPort: await pickLocalPort(),
        connectTimeoutMs: 60_000,
      },
    );
    await new Promise((r) => setTimeout(r, 50));
    await tunnel.close();
    expect(tunnel.state.status).toBe('closed');
    expect(fake.children.at(-1)!.stdin.destroyed).toBe(true);
  });
});
