import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openTunnel } from '../src/index.ts';
import { pickLocalPort } from '../src/ports.ts';

// Real processes: the POSIX guard around ssh (Windows relies on the job object of libuv).
const posix = process.platform !== 'win32';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(pred: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * A fake `ssh`: the remote `cat server.json` prints one with a proof key; the tunnel
 * (`-N`) records its pid and blocks like `ssh -N`.
 */
function fakeSshScript(body = 'exec sleep 600'): { dir: string; script: string; pidFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'monsters-guard-'));
  const pidFile = join(dir, 'ssh.pid');
  const script = join(dir, 'ssh');
  const info = JSON.stringify({ port: 4747, proofKey: 'k'.repeat(43) });
  writeFileSync(
    script,
    `#!/bin/sh\ncase " $* " in\n*" -N "*)\necho $$ > '${pidFile}'\n${body}\n;;\n*) echo '${info}' ;;\nesac\n`,
  );
  chmodSync(script, 0o755);
  cleanups.push(() => {
    if (existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, 'utf8'));
      if (alive(pid)) process.kill(pid, 'SIGKILL');
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, script, pidFile };
}

describe.runIf(posix)('ssh never outlives Monsters', { timeout: 20_000 }, () => {
  it('close() kills ssh', async () => {
    const { dir, script, pidFile } = fakeSshScript();
    const tunnel = openTunnel(
      { name: 't', host: 'casa', remotePort: 4747 },
      {
        sshPath: script,
        knownHostsFile: join(dir, 'kh'),
        localPort: await pickLocalPort(),
        connectTimeoutMs: 60_000,
      },
    );
    cleanups.push(() => tunnel.close());
    await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(alive(pid)).toBe(true);
    await tunnel.close();
    await waitFor(() => !alive(pid), 3_000);
  });

  it('a parent killed with SIGKILL leaves no ssh behind', async () => {
    const { dir, script, pidFile } = fakeSshScript();
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, 'fixtures', 'hold-tunnel.ts')],
      {
        env: {
          ...process.env,
          HOLD_SSH: script,
          HOLD_KNOWN_HOSTS: join(dir, 'kh'),
          HOLD_LOCAL_PORT: String(await pickLocalPort()),
        },
        stdio: ['ignore', 'ignore', 'inherit'],
      },
    );
    cleanups.push(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });
    await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '', 10_000);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(alive(pid)).toBe(true);
    child.kill('SIGKILL');
    await waitFor(() => !alive(pid), 5_000);
  });

  it('passes the exit status and stderr of ssh through the guard', async () => {
    const { dir, script } = fakeSshScript(
      `echo 'giulio@casa: Permission denied (publickey).' >&2\nexit 255`,
    );
    const tunnel = openTunnel(
      { name: 't', host: 'casa', remotePort: 4747 },
      { sshPath: script, knownHostsFile: join(dir, 'kh'), localPort: await pickLocalPort() },
    );
    cleanups.push(() => tunnel.close());
    await expect(tunnel.connected()).rejects.toMatchObject({
      kind: 'auth-failed',
      detail: 'giulio@casa: Permission denied (publickey).',
    });
  });
});
