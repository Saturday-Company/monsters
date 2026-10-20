/*
 * A throwaway OpenSSH server for tests (this package and the desktop app's e2e, D-044/D-047):
 * sshd runs as the current user on a random port of 127.0.0.1, with its own host key and
 * authorized_keys in a temp folder; clients use an empty ssh_config and their own
 * known_hosts. The user's ~/.ssh is never read or written. `null` when sshd is not installed
 * or cannot start (e.g. Windows): the caller skips.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickLocalPort } from '../ports.ts';

export const SSHD_PATH = '/usr/sbin/sshd';

export interface TestSshd {
  /** Temp folder with keys, configs and whatever the test puts there. */
  dir: string;
  port: number;
  /** `SHA256:…` of the server's host key, as `ssh-keygen -lf` prints it. */
  hostFingerprint: string;
  /** Private key accepted by the server. */
  clientKey: string;
  /** Private key the server does not accept. */
  strangerKey: string;
  /** An empty ssh_config (`ssh -F`), so the user's ~/.ssh/config is not read. */
  sshConfig: string;
  /** Everything sshd printed (LogLevel VERBOSE), for failures. */
  log(): string;
  stop(): Promise<void>;
}

function keygen(file: string): void {
  const r = spawnSync('ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-C',
    'monsters-test',
    '-f',
    file,
  ]);
  if (r.status !== 0) throw new Error(`ssh-keygen failed: ${String(r.stderr)}`);
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect(port, '127.0.0.1');
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
}

/** Starts sshd, or returns the reason it cannot run here. */
export async function startTestSshd(): Promise<TestSshd | { skip: string }> {
  if (process.platform === 'win32' || !existsSync(SSHD_PATH)) {
    return { skip: `${SSHD_PATH} not available` };
  }
  const dir = mkdtempSync(join(tmpdir(), 'monsters-sshd-'));
  keygen(join(dir, 'host_key'));
  keygen(join(dir, 'client'));
  keygen(join(dir, 'stranger'));
  writeFileSync(join(dir, 'authorized_keys'), readFileSync(join(dir, 'client.pub')), {
    mode: 0o600,
  });
  writeFileSync(join(dir, 'ssh_config'), '');
  const hostFingerprint = String(
    spawnSync('ssh-keygen', ['-lf', join(dir, 'host_key.pub')]).stdout,
  ).split(' ')[1]!;
  const port = await pickLocalPort();
  writeFileSync(
    join(dir, 'sshd_config'),
    [
      `Port ${port}`,
      'ListenAddress 127.0.0.1',
      `HostKey ${join(dir, 'host_key')}`,
      'PidFile none',
      `AuthorizedKeysFile ${join(dir, 'authorized_keys')}`,
      'StrictModes no',
      'UsePAM no',
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'AllowTcpForwarding local',
      'AllowAgentForwarding no',
      'X11Forwarding no',
      'PermitTTY no',
      'LogLevel VERBOSE',
      '',
    ].join('\n'),
  );
  let log = '';
  const sshd: ChildProcess = spawn(SSHD_PATH, ['-D', '-e', '-f', join(dir, 'sshd_config')], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  sshd.stderr!.on('data', (d: Buffer) => (log += d.toString()));
  const stop = async () => {
    if (sshd.exitCode === null && sshd.signalCode === null) {
      const exited = new Promise((r) => sshd.once('exit', r));
      sshd.kill('SIGTERM');
      await exited;
    }
    rmSync(dir, { recursive: true, force: true });
  };
  const end = Date.now() + 5_000;
  while (!(await portOpen(port))) {
    if (sshd.exitCode !== null || Date.now() > end) {
      await stop();
      return { skip: `sshd did not start: ${log.trim().split('\n').at(-1) ?? ''}` };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    dir,
    port,
    hostFingerprint,
    clientKey: join(dir, 'client'),
    strangerKey: join(dir, 'stranger'),
    sshConfig: join(dir, 'ssh_config'),
    log: () => log,
    stop,
  };
}
