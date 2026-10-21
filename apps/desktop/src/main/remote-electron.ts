import { join } from 'node:path';
import type { HostKeyInfo, TunnelOptions } from '@monsters/remote';
import { dialog, net, powerMonitor, type BrowserWindow } from 'electron';
import type { ConnectionsView } from './connections-page.ts';
import { connectionsStrings } from './connections-page.strings.ts';
import { LOCAL_CHOICE, profileAddress, type StoredProfile, type TargetChoice } from './profiles.ts';
import { hostKeyDialog, linkStatusText, TRUST_BUTTON } from './remote-copy.ts';
import type { LinkState } from './remote-core.ts';

/*
 * Pieces of the client mode (M3.3, D-047) that index.ts wires: the host key dialog, the
 * wake/network watch, the options of the tunnel, the list of the connections page. Kept
 * here so the main module only connects them to the window.
 */

/** First connection to a computer: the user compares the fingerprint. Default "Cancel". */
export async function confirmHostKey(
  win: BrowserWindow | null,
  info: HostKeyInfo,
  profile: StoredProfile,
  log: (line: string) => void,
): Promise<boolean> {
  const options = { ...hostKeyDialog(info, profile.name), noLink: true };
  log(`host key of "${profile.name}": ${info.keys[0]?.fingerprint ?? '?'}, asking`);
  const { response } =
    win && !win.isDestroyed() && win.isVisible()
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);
  const trusted = response === TRUST_BUTTON;
  log(`host key of "${profile.name}": ${trusted ? 'trusted' : 'refused'}`);
  return trusted;
}

/**
 * Options of every tunnel: the app's own known_hosts in its user data folder. Tests point
 * ssh at their own config and known_hosts files (never the user's ~/.ssh) with
 * MONSTERS_DESKTOP_SSH_CONFIG and MONSTERS_DESKTOP_SSH_KNOWN_HOSTS (comma-separated, empty
 * for none).
 */
export function tunnelOptions(
  userData: string,
  env: NodeJS.ProcessEnv = process.env,
): TunnelOptions {
  const config = env['MONSTERS_DESKTOP_SSH_CONFIG'];
  const known = env['MONSTERS_DESKTOP_SSH_KNOWN_HOSTS'];
  return {
    knownHostsFile: join(userData, 'known_hosts'),
    ...(config ? { configFile: config } : {}),
    ...(known !== undefined ? { userKnownHostsFiles: known ? known.split(',') : [] } : {}),
  };
}

/** Wake from sleep, screen unlocked, network back: `poke` checks the SSH link at once. */
export function watchWakeAndNetwork(poke: (why: string) => void): void {
  powerMonitor.on('resume', () => poke('resume'));
  powerMonitor.on('unlock-screen', () => poke('unlock'));
  let online = net.isOnline();
  setInterval(() => {
    const now = net.isOnline();
    if (now && !online) poke('network back');
    online = now;
  }, 5000).unref();
}

/**
 * What the connections page lists: "This computer", then the profiles with their form
 * values. `current` is null at the first start, before anything is chosen.
 */
export function connectionsView(opts: {
  current: TargetChoice | null;
  link: LinkState | null;
  localReady: boolean;
  home: string;
  profiles: StoredProfile[];
}): ConnectionsView {
  return {
    current: opts.current,
    status: linkStatusText(opts.link, opts.localReady),
    rows: [
      {
        choice: LOCAL_CHOICE,
        name: connectionsStrings().localName,
        address: connectionsStrings().localAddress,
      },
      ...opts.profiles.map((p) => ({
        choice: p.id,
        name: p.name,
        address: profileAddress(p),
        form: {
          name: p.name,
          host: p.host,
          user: p.user ?? '',
          sshPort: p.sshPort?.toString() ?? '',
          identityFile: p.identityFile ?? '',
          remotePort: p.remotePort?.toString() ?? '',
          remoteHome: p.remoteHome ?? '',
          autoLogin: p.autoLogin,
        },
      })),
    ],
  };
}
