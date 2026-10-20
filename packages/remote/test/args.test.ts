import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TunnelError,
  classifySshFailure,
  parseProfile,
  rewriteTunnelHeaders,
  sshFingerprint,
  trustHostKeys,
  tunnelUrlPatterns,
} from '../src/index.ts';
import { knownHostsName, parseKeyscan, parseSshConfigDump } from '../src/host-keys.ts';
import { POSIX_SHELL, killTree, locateOpenSsh, spawnGuarded } from '../src/process.ts';
import {
  discoveryArgs,
  discoveryCommand,
  remoteFileArgs,
  remoteFileCommand,
  resolveArgs,
  tunnelArgs,
} from '../src/ssh-args.ts';
import { backoffDelay } from '../src/tunnel.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'monsters-remote-'));
  dirs.push(d);
  return d;
}

const base = { knownHostsFile: '/data/monsters/known_hosts' };

/** Value of every `-o Name=…` in args. */
function sshOptions(args: string[]): Map<string, string> {
  const map = new Map<string, string>();
  args.forEach((a, i) => {
    if (a === '-o') {
      const v = args[i + 1]!;
      const eq = v.indexOf('=');
      map.set(v.slice(0, eq), v.slice(eq + 1));
    }
  });
  return map;
}

describe('connection profile', () => {
  it('accepts a minimal profile and an ssh config alias', () => {
    expect(parseProfile({ name: 'PC di casa', host: 'casa' })).toEqual({
      name: 'PC di casa',
      host: 'casa',
    });
    expect(
      parseProfile({
        name: 'x',
        host: '100.64.0.7',
        user: 'giulio',
        sshPort: 2222,
        remotePort: 4800,
      }),
    ).toMatchObject({ sshPort: 2222, remotePort: 4800 });
  });

  it('rejects values that ssh would read as options or that hide a user', () => {
    for (const host of ['-oProxyCommand=touch /tmp/x', 'a b', 'giulio@host', 'host\n-o', '']) {
      expect(() => parseProfile({ name: 'x', host })).toThrow();
    }
    expect(() => parseProfile({ name: 'x', host: 'h', user: '-lroot' })).toThrow();
    expect(() => parseProfile({ name: 'x', host: 'h', sshPort: 70000 })).toThrow();
    expect(() => parseProfile({ name: 'x', host: 'h', remoteHome: "a'; rm -rf ~; '" })).toThrow();
    expect(() => parseProfile({ name: 'x', host: 'h', remoteHome: '$(id)' })).toThrow();
  });
});

describe('ssh arguments', () => {
  it('builds a strict, key-only tunnel to 127.0.0.1 on both ends', () => {
    const args = tunnelArgs(
      parseProfile({
        name: 'x',
        host: 'casa',
        user: 'giulio',
        sshPort: 2222,
        identityFile: '/k/id',
      }),
      base,
      4748,
      4747,
    );
    expect(args.slice(-3)).toEqual(['127.0.0.1:4748:127.0.0.1:4747', '--', 'casa']);
    expect(args).toEqual(
      expect.arrayContaining(['-N', '-l', 'giulio', '-p', '2222', '-i', '/k/id']),
    );
    expect(args[args.indexOf('-L') + 1]).toBe('127.0.0.1:4748:127.0.0.1:4747');
    const o = sshOptions(args);
    expect(o.get('BatchMode')).toBe('yes');
    expect(o.get('StrictHostKeyChecking')).toBe('yes');
    expect(o.get('UpdateHostKeys')).toBe('no');
    expect(o.get('ExitOnForwardFailure')).toBe('yes');
    expect(o.get('ServerAliveInterval')).toBe('15');
    expect(o.get('ServerAliveCountMax')).toBe('3');
    expect(o.get('IdentitiesOnly')).toBe('yes');
    expect(o.get('ControlMaster')).toBe('no');
    expect(o.get('UserKnownHostsFile')).toBe(
      '~/.ssh/known_hosts ~/.ssh/known_hosts2 /data/monsters/known_hosts',
    );
  });

  it('leaves user, port and key to the ssh config when the profile has none', () => {
    const args = tunnelArgs(parseProfile({ name: 'x', host: 'casa' }), base, 4747, 4747);
    for (const flag of ['-l', '-p', '-i']) expect(args).not.toContain(flag);
    expect(sshOptions(args).has('IdentitiesOnly')).toBe(false);
  });

  it('quotes known_hosts paths with spaces and uses forward slashes (Windows)', () => {
    const args = tunnelArgs(
      parseProfile({ name: 'x', host: 'casa' }),
      {
        knownHostsFile: 'C:\\Users\\Mario Rossi\\.monsters\\known_hosts',
        userKnownHostsFiles: ['C:\\Users\\Mario Rossi\\.ssh\\known_hosts'],
      },
      4747,
      4747,
    );
    expect(sshOptions(args).get('UserKnownHostsFile')).toBe(
      '"C:/Users/Mario Rossi/.ssh/known_hosts" "C:/Users/Mario Rossi/.monsters/known_hosts"',
    );
  });

  it('reads only the known files of the remote data directory', () => {
    expect(remoteFileCommand('setup-code')).toBe(
      `sh -c 'cat "\${MONSTERS_HOME:-$HOME/.monsters}/setup-code"'`,
    );
    expect(remoteFileCommand('cli-token', '~/m')).toBe(`sh -c 'cat "$1/cli-token"' sh 'm'`);
    expect(() => remoteFileCommand('../etc/passwd' as 'cli-token')).toThrow(/unsupported/);
    const args = remoteFileArgs(parseProfile({ name: 'x', host: 'casa' }), base, 'cli-token');
    expect(args.slice(-3)).toEqual(['--', 'casa', remoteFileCommand('cli-token')]);
    expect(args).toContain('BatchMode=yes');
    expect(args).toContain('StrictHostKeyChecking=yes');
  });

  it('reads server.json through sh, from MONSTERS_HOME or a given folder', () => {
    expect(discoveryCommand()).toBe(`sh -c 'cat "\${MONSTERS_HOME:-$HOME/.monsters}/server.json"'`);
    expect(discoveryCommand('~/.monsters-prova')).toBe(
      `sh -c 'cat "$1/server.json"' sh '.monsters-prova'`,
    );
    expect(discoveryCommand('/srv/monsters')).toBe(
      `sh -c 'cat "$1/server.json"' sh '/srv/monsters'`,
    );
    const args = discoveryArgs(parseProfile({ name: 'x', host: 'casa' }), base);
    expect(args.slice(-3, -1)).toEqual(['--', 'casa']);
    expect(args).not.toContain('-N');
    expect(
      resolveArgs(parseProfile({ name: 'x', host: 'casa', sshPort: 22 }), {
        ...base,
        configFile: '/c',
      }),
    ).toEqual(['-G', '-F', '/c', '-p', '22', '--', 'casa']);
  });
});

describe('ssh failures', () => {
  // Messages printed by OpenSSH 10.2 (see the sshd test for the real thing).
  const cases: [string, string][] = [
    [
      'No ED25519 host key is known for [127.0.0.1]:42222 and you have requested strict checking.\nHost key verification failed.\n',
      'host-key-unknown',
    ],
    [
      '@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\nHost key for [127.0.0.1]:42222 has changed and you have requested strict checking.\nHost key verification failed.\n',
      'host-key-changed',
    ],
    ['giulio@127.0.0.1: Permission denied (publickey).\n', 'auth-failed'],
    [
      'bind [127.0.0.1]:42222: Address already in use\nchannel_setup_fwd_listener_tcpip: cannot listen to port: 42222\nCould not request local forwarding.\n',
      'forward-failed',
    ],
    [
      'ssh: Could not resolve hostname nonexistent.invalid: Name or service not known\n',
      'host-not-found',
    ],
    ['ssh: connect to host 127.0.0.1 port 1: Connection refused\n', 'unreachable'],
    ['channel 2: open failed: connect failed: Connection refused\n', 'core-unreachable'],
    ['channel 2: open failed: administratively prohibited: open failed\n', 'forwarding-disabled'],
    ['ssh: connect to host 10.0.0.9 port 22: Operation timed out\n', 'unreachable'],
    ['Timeout, server casa not responding.\n', 'connection-lost'],
    ['Connection closed by 100.64.0.7 port 22\n', 'connection-lost'],
    ['something else\n', 'ssh-error'],
  ];
  it.each(cases)('classifies %j', (stderr, kind) => {
    expect(classifySshFailure(stderr)).toBe(kind);
  });

  it('has a clear Italian message and knows what a retry can fix', () => {
    const auth = new TunnelError('auth-failed');
    expect(auth.message).toMatch(/solo chiavi SSH/);
    expect(auth.retryable).toBe(false);
    expect(new TunnelError('host-key-changed').retryable).toBe(false);
    expect(new TunnelError('connection-lost').retryable).toBe(true);
  });

  it('backs off doubling up to the cap', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => backoffDelay(n, 1000, 30_000))).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000, 30_000,
    ]);
  });
});

describe('host keys', () => {
  const KEY = 'AAAAC3NzaC1lZDI1NTE5AAAAICjkmTszvNkX0rJ7znWyLnK4+3ggIu3PV8+7fW3RhYmO';

  it('parses ssh-keyscan output, strongest key first', () => {
    const keys = parseKeyscan(
      `# 127.0.0.1:42222 SSH-2.0-OpenSSH_10.2\n[127.0.0.1]:42222 ssh-rsa AAAAB3NzaC1yc2E=\n[127.0.0.1]:42222 ssh-ed25519 ${KEY}\n`,
    );
    expect(keys.map((k) => k.type)).toEqual(['ssh-ed25519', 'ssh-rsa']);
    expect(keys[0]!.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    expect(sshFingerprint(KEY)).toBe(keys[0]!.fingerprint);
  });

  it('stores keys under the name OpenSSH looks up', () => {
    const t = parseSshConfigDump('user giulio\nhostname 100.64.0.7\nport 2222\n', 'casa');
    expect(t).toEqual({
      hostname: '100.64.0.7',
      port: 2222,
      hostKeyAlias: undefined,
      proxied: false,
    });
    expect(knownHostsName(t)).toBe('[100.64.0.7]:2222');
    expect(knownHostsName({ ...t, port: 22 })).toBe('100.64.0.7');
    expect(knownHostsName({ ...t, hostKeyAlias: 'casa-key' })).toBe('casa-key');
    expect(parseSshConfigDump('hostname h\nproxyjump bastion\n', 'h').proxied).toBe(true);
    expect(parseSshConfigDump('hostname h\nproxycommand none\n', 'h').proxied).toBe(false);
  });

  it('appends confirmed keys once, owner-only', () => {
    const file = join(tmp(), 'sub', 'known_hosts');
    const info = {
      host: 'casa',
      hostname: '100.64.0.7',
      port: 2222,
      knownHostsName: '[100.64.0.7]:2222',
      keys: [{ type: 'ssh-ed25519', key: KEY, fingerprint: sshFingerprint(KEY) }],
    };
    trustHostKeys(file, info);
    trustHostKeys(file, info);
    expect(readFileSync(file, 'utf8')).toBe(`[100.64.0.7]:2222 ssh-ed25519 ${KEY}\n`);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(() => trustHostKeys(file, { ...info, knownHostsName: 'a b' })).toThrow();
    writeFileSync(file, 'other ssh-ed25519 AAAA');
    trustHostKeys(file, info);
    expect(readFileSync(file, 'utf8').split('\n')[1]).toBe(`[100.64.0.7]:2222 ssh-ed25519 ${KEY}`);
  });

  it('trusts only the key shown in the dialog, not the extra ones a scan returned', () => {
    const file = join(tmp(), 'known_hosts');
    const other = 'AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY=';
    trustHostKeys(file, {
      host: 'casa',
      hostname: 'casa.lan',
      port: 22,
      knownHostsName: 'casa.lan',
      keys: [
        { type: 'ssh-ed25519', key: KEY, fingerprint: sshFingerprint(KEY) },
        { type: 'ecdsa-sha2-nistp256', key: other, fingerprint: sshFingerprint(other) },
      ],
    });
    expect(readFileSync(file, 'utf8')).toBe(`casa.lan ssh-ed25519 ${KEY}\n`);
  });
});

describe('Origin rewrite for the app window (D-044)', () => {
  const ports = { localPort: 50123, remotePort: 4747 };

  it('moves the exact local origin to the remote port, HTTP and WebSocket', () => {
    expect(
      rewriteTunnelHeaders(
        'http://127.0.0.1:50123/api/team',
        { Origin: 'http://127.0.0.1:50123' },
        ports,
      ),
    ).toEqual({ Origin: 'http://127.0.0.1:4747' });
    expect(
      rewriteTunnelHeaders(
        'ws://localhost:50123/api/stream',
        { origin: 'http://localhost:50123/' },
        ports,
      ),
    ).toEqual({ origin: 'http://localhost:4747' });
    expect(
      rewriteTunnelHeaders(
        'http://[::1]:50123/',
        { Origin: 'http://[::1]:50123', Host: '[::1]:50123' },
        ports,
      ),
    ).toEqual({ Origin: 'http://[::1]:4747', Host: '[::1]:50123' });
  });

  it('never makes a foreign origin acceptable', () => {
    for (const origin of [
      'http://127.0.0.1:5173',
      'https://evil.example',
      'null',
      'http://127.0.0.1:4747',
    ]) {
      const h = { Origin: origin };
      expect(rewriteTunnelHeaders('http://127.0.0.1:50123/api/kill', h, ports)).toBe(h);
    }
  });

  it('leaves alone requests without Origin, to other URLs, or with equal ports', () => {
    const none = { Accept: '*/*' };
    expect(rewriteTunnelHeaders('http://127.0.0.1:50123/', none, ports)).toBe(none);
    const h = { Origin: 'http://127.0.0.1:50123' };
    expect(rewriteTunnelHeaders('http://127.0.0.1:50124/', h, ports)).toBe(h);
    expect(rewriteTunnelHeaders('https://127.0.0.1:50123/', h, ports)).toBe(h);
    expect(
      rewriteTunnelHeaders('http://127.0.0.1:4747/', h, { localPort: 4747, remotePort: 4747 }),
    ).toBe(h);
  });

  it('gives webRequest filters for the tunnel only', () => {
    expect(tunnelUrlPatterns(50123)).toEqual([
      'http://127.0.0.1:50123/*',
      'ws://127.0.0.1:50123/*',
      'http://localhost:50123/*',
      'ws://localhost:50123/*',
      'http://[::1]:50123/*',
      'ws://[::1]:50123/*',
    ]);
  });
});

describe('system ssh', () => {
  const exists = (paths: string[]) => (p: string) => paths.includes(p);

  it('prefers the built-in OpenSSH of Windows, then PATH', () => {
    const env = { SystemRoot: 'C:\\Windows', Path: 'C:\\Program Files\\Git\\usr\\bin;C:\\tools' };
    expect(
      locateOpenSsh('ssh', {
        platform: 'win32',
        env,
        isExecutable: exists(['C:\\Windows\\System32\\OpenSSH\\ssh.exe', 'C:\\tools\\ssh.exe']),
      }),
    ).toBe('C:\\Windows\\System32\\OpenSSH\\ssh.exe');
    expect(
      locateOpenSsh('ssh', {
        platform: 'win32',
        env,
        isExecutable: exists(['C:\\Program Files\\Git\\usr\\bin\\ssh.exe']),
      }),
    ).toBe('C:\\Program Files\\Git\\usr\\bin\\ssh.exe');
    expect(
      locateOpenSsh('ssh-keyscan', { platform: 'win32', env, isExecutable: () => false }),
    ).toBeNull();
  });

  it('searches PATH, then /usr/bin, on Linux and macOS', () => {
    expect(
      locateOpenSsh('ssh', {
        platform: 'darwin',
        env: { PATH: '/opt/homebrew/bin:/usr/bin' },
        isExecutable: exists(['/opt/homebrew/bin/ssh', '/usr/bin/ssh']),
      }),
    ).toBe('/opt/homebrew/bin/ssh');
    expect(
      locateOpenSsh('ssh', { platform: 'darwin', env: {}, isExecutable: exists(['/usr/bin/ssh']) }),
    ).toBe('/usr/bin/ssh');
  });

  it('runs ssh directly on Windows and through the guard elsewhere', () => {
    const seen: { command: string; args: readonly string[]; detached: unknown }[] = [];
    const spawn = ((command: string, args: readonly string[], options: { detached?: boolean }) => {
      seen.push({ command, args, detached: options.detached });
      return { pid: undefined, stdin: null } as never;
    }) as never;
    spawnGuarded('C:\\Windows\\System32\\OpenSSH\\ssh.exe', ['-N', '--', 'casa'], {
      spawn,
      platform: 'win32',
    });
    spawnGuarded('/usr/bin/ssh', ['-N', '--', 'casa'], { spawn, platform: 'linux' });
    expect(seen[0]).toEqual({
      command: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe',
      args: ['-N', '--', 'casa'],
      detached: undefined,
    });
    expect(seen[1]!.command).toBe(POSIX_SHELL);
    expect(seen[1]!.args.slice(3)).toEqual(['/usr/bin/ssh', '-N', '--', 'casa']);
    expect(seen[1]!.detached).toBe(true);
  });

  it('kills the whole tree with taskkill on Windows', () => {
    const calls: unknown[][] = [];
    const spawnSync = ((...a: unknown[]) => {
      calls.push(a);
      return {} as never;
    }) as never;
    killTree({ pid: 4321, stdin: null } as never, { platform: 'win32', spawnSync });
    expect(calls[0]?.slice(0, 2)).toEqual(['taskkill', ['/pid', '4321', '/T', '/F']]);
  });
});
