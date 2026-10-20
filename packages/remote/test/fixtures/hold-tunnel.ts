/*
 * Child process for the "no orphan ssh" test: opens a tunnel with the ssh
 * given in HOLD_SSH and waits to be killed (SIGKILL, so no cleanup runs here).
 */
import { openTunnel } from '../../src/index.ts';

const tunnel = openTunnel(
  { name: 'test', host: 'casa', remotePort: 4747 },
  {
    sshPath: process.env['HOLD_SSH']!,
    knownHostsFile: process.env['HOLD_KNOWN_HOSTS']!,
    localPort: Number(process.env['HOLD_LOCAL_PORT']),
    connectTimeoutMs: 600_000,
  },
);
tunnel.onState((s) => process.stdout.write(`${s.status}\n`));
setInterval(() => {}, 1_000);
