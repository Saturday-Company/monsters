import type { ConnectionProfile } from './profile.ts';

/** The files OpenSSH reads by default; ssh expands `~` itself (also on Windows). */
export const DEFAULT_USER_KNOWN_HOSTS = ['~/.ssh/known_hosts', '~/.ssh/known_hosts2'];

export interface SshArgOptions {
  /** known_hosts managed by Monsters, where confirmed keys are added. */
  knownHostsFile: string;
  /**
   * Known-hosts files of the user, read but never written (keys accepted with
   * the user's own `ssh` keep working). Default `DEFAULT_USER_KNOWN_HOSTS`.
   */
  userKnownHostsFiles?: readonly string[] | undefined;
  /** `ssh -F`: an SSH config file instead of `~/.ssh/config` (tests). */
  configFile?: string | undefined;
  /** Seconds to wait for the TCP connection and the SSH handshake. */
  connectTimeoutSec?: number | undefined;
}

/** A path inside an ssh_config value: quoted, forward slashes (Windows too). */
function configPath(path: string): string {
  if (path.includes('"')) throw new Error(`unsupported character in path: ${path}`);
  const normalized = path.replace(/\\/g, '/');
  return /\s/.test(normalized) ? `"${normalized}"` : normalized;
}

/**
 * Options shared by every ssh run of Monsters. They come before the user's
 * config (the first value wins in OpenSSH), so `~/.ssh/config` keeps HostName,
 * User, Port, IdentityFile, ProxyJump… but cannot weaken host key checks.
 */
export function baseSshArgs(profile: ConnectionProfile, opts: SshArgOptions): string[] {
  const args: string[] = [];
  if (opts.configFile !== undefined) args.push('-F', opts.configFile);
  if (profile.user !== undefined) args.push('-l', profile.user);
  if (profile.sshPort !== undefined) args.push('-p', String(profile.sshPort));
  if (profile.identityFile !== undefined) {
    args.push('-i', profile.identityFile, '-o', 'IdentitiesOnly=yes');
  }
  const knownHosts = [
    ...(opts.userKnownHostsFiles ?? DEFAULT_USER_KNOWN_HOSTS),
    opts.knownHostsFile,
  ].map(configPath);
  const options = [
    // Keys and agent only: never a password or passphrase prompt.
    'BatchMode=yes',
    // Never accept an unknown or changed host key by ourselves (D-044).
    'StrictHostKeyChecking=yes',
    `UserKnownHostsFile=${knownHosts.join(' ')}`,
    // ...and never rewrite the user's known_hosts.
    'UpdateHostKeys=no',
    `ConnectTimeout=${opts.connectTimeoutSec ?? 10}`,
    'ServerAliveInterval=15',
    'ServerAliveCountMax=3',
    // A multiplexed master would own the forwarding and outlive us.
    'ControlMaster=no',
    'ControlPath=none',
    'ForwardAgent=no',
    'ForwardX11=no',
    'PermitLocalCommand=no',
    'RequestTTY=no',
    'RemoteCommand=none',
  ];
  for (const o of options) args.push('-o', o);
  return args;
}

/**
 * Local end of the forward that ssh listens on: a Unix socket path (Linux and macOS,
 * in a private folder of ours) or a port of 127.0.0.1 (Windows). Only the tunnel talks
 * to it; the window talks to the tunnel's own listener (D-044, M3.6).
 */
export type ForwardEnd = number | string;

/**
 * `ssh -N -L <local end>:127.0.0.1:<remote> host`: the tunnel itself. A Unix socket is
 * created with mode 600 (`StreamLocalBindMask`) and replaces a stale one.
 */
export function tunnelArgs(
  profile: ConnectionProfile,
  opts: SshArgOptions,
  local: ForwardEnd,
  remotePort: number,
): string[] {
  const socket = typeof local === 'string';
  // ssh splits the spec on ':' and takes the first field as a path only with a '/'.
  if (socket && (!local.startsWith('/') || local.includes(':'))) {
    throw new Error(`unsupported socket path: ${local}`);
  }
  return [
    ...baseSshArgs(profile, opts),
    '-N',
    '-o',
    'ExitOnForwardFailure=yes',
    ...(socket ? ['-o', 'StreamLocalBindUnlink=yes', '-o', 'StreamLocalBindMask=0177'] : []),
    '-L',
    socket ? `${local}:127.0.0.1:${remotePort}` : `127.0.0.1:${local}:127.0.0.1:${remotePort}`,
    '--',
    profile.host,
  ];
}

/** Files of the remote data directory that Monsters reads over SSH (fixed names only). */
export type RemoteHomeFile = 'server.json' | 'setup-code' | 'cli-token';

const REMOTE_FILES: readonly RemoteHomeFile[] = ['server.json', 'setup-code', 'cli-token'];

/**
 * Remote command printing a file of the remote data directory. Run through
 * `sh -c` so it works whatever the login shell is (bash, zsh, fish).
 */
export function remoteFileCommand(file: RemoteHomeFile, remoteHome?: string): string {
  // Never a name from outside: the command is a shell string on the remote side.
  if (!REMOTE_FILES.includes(file)) throw new Error(`unsupported remote file: ${String(file)}`);
  if (remoteHome === undefined) {
    return `sh -c 'cat "\${MONSTERS_HOME:-$HOME/.monsters}/${file}"'`;
  }
  // ssh starts the command in the home folder: `~/x` is just `x`.
  const home = remoteHome === '~' ? '.' : remoteHome.replace(/^~\//, '');
  return `sh -c 'cat "$1/${file}"' sh '${home}'`;
}

/** Remote command printing the `server.json` of the remote core. */
export function discoveryCommand(remoteHome?: string): string {
  return remoteFileCommand('server.json', remoteHome);
}

/** `ssh … host <cat file>`: reads one file of the remote data directory. */
export function remoteFileArgs(
  profile: ConnectionProfile,
  opts: SshArgOptions,
  file: RemoteHomeFile,
): string[] {
  return [
    ...baseSshArgs(profile, opts),
    '-T',
    '--',
    profile.host,
    remoteFileCommand(file, profile.remoteHome),
  ];
}

export function discoveryArgs(profile: ConnectionProfile, opts: SshArgOptions): string[] {
  return remoteFileArgs(profile, opts, 'server.json');
}

/** `ssh -G`: the configuration ssh would use (real HostName, Port, aliases). */
export function resolveArgs(profile: ConnectionProfile, opts: SshArgOptions): string[] {
  const args = ['-G'];
  if (opts.configFile !== undefined) args.push('-F', opts.configFile);
  if (profile.user !== undefined) args.push('-l', profile.user);
  if (profile.sshPort !== undefined) args.push('-p', String(profile.sshPort));
  args.push('--', profile.host);
  return args;
}
