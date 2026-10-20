import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import type { ConnectionProfile, TunnelErrorKind, TunnelState } from '@monsters/remote';
import { remoteFailureCopy, type FixField } from './remote-copy.ts';
import type { TunnelLike } from './remote-core.ts';

/*
 * Checks of the connections form (audit UX 1.1, 1.4, 1.6, 1.7), with ssh and the DNS
 * injected so they are tested without a network:
 * - `sshDefaults`: what `ssh -G` would use for a host (user, port, real address, proxy), shown
 *   as the defaults of the advanced options and used to look the address up;
 * - `hostCheck`: at save time, an address that the DNS does not know ("Casa") is reported
 *   once; a host behind ProxyJump/ProxyCommand or an alias of ~/.ssh/config is not looked up
 *   here (ssh finds it);
 * - `testConnection` ("Prova"): opens a tunnel to the profile, waits for the remote core's
 *   proof, closes it. The current destination is never touched (the local core keeps running);
 * - `forgetHostKey`: removes a host from the app's own known_hosts (never the user's files).
 */

export interface SshDefaults {
  /** Where ssh really connects (HostName of ~/.ssh/config, else the host). */
  hostname: string;
  user: string;
  port: number;
  /** Behind ProxyJump or ProxyCommand: the DNS of this computer may not know the host. */
  proxied: boolean;
  /** HostKeyAlias, when set: the name of the host in known_hosts. */
  hostKeyAlias: string | null;
}

/** Parses `ssh -G` (lower-case keys, first value wins). */
export function parseSshG(output: string, host: string): SshDefaults {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const space = line.indexOf(' ');
    if (space <= 0) continue;
    const key = line.slice(0, space).toLowerCase();
    if (!values.has(key)) values.set(key, line.slice(space + 1).trim());
  }
  const set = (k: string) => {
    const v = values.get(k);
    return v !== undefined && v !== '' && v.toLowerCase() !== 'none' ? v : null;
  };
  const port = Number(values.get('port') ?? 22);
  return {
    hostname: set('hostname') ?? host,
    user: set('user') ?? '',
    port: Number.isInteger(port) && port > 0 && port < 65_536 ? port : 22,
    proxied: set('proxyjump') !== null || set('proxycommand') !== null,
    hostKeyAlias: set('hostkeyalias'),
  };
}

export interface SshRunner {
  /** `ssh -G …`: stdout, or null when ssh is missing or fails. */
  dump(args: string[]): Promise<string | null>;
}

/** The system ssh (path from @monsters/remote's locateOpenSsh). */
export function systemSshRunner(sshPath: string | null): SshRunner {
  return {
    dump: (args) =>
      new Promise((resolve) => {
        if (!sshPath) {
          resolve(null);
          return;
        }
        execFile(sshPath, args, { timeout: 5_000, windowsHide: true }, (err, stdout) =>
          resolve(err ? null : stdout),
        );
      }),
  };
}

/** `ssh -G` for a profile of the form: the same options the tunnel would pass. */
export async function sshDefaults(
  profile: Pick<ConnectionProfile, 'host' | 'user' | 'sshPort'>,
  ssh: SshRunner,
  configFile?: string,
): Promise<SshDefaults | null> {
  if (!profile.host || profile.host.startsWith('-') || /\s/.test(profile.host)) return null;
  const args = ['-G'];
  if (configFile) args.push('-F', configFile);
  if (profile.user) args.push('-l', profile.user);
  if (profile.sshPort) args.push('-p', String(profile.sshPort));
  args.push('--', profile.host);
  const out = await ssh.dump(args);
  return out === null ? null : parseSshG(out, profile.host);
}

export type Lookup = (hostname: string) => Promise<boolean | null>;

/** The system resolver (hosts file, mDNS, Tailscale's MagicDNS…), at most 3 s. */
export const systemLookup: Lookup = (hostname) =>
  Promise.race([
    lookup(hostname).then(
      () => true,
      (err: NodeJS.ErrnoException) =>
        err.code === 'ENOTFOUND' || err.code === 'EAI_NONAME' ? false : null,
    ),
    new Promise<null>((r) => setTimeout(() => r(null), 3_000).unref()),
  ]);

/** Unknown name: a message for the host field; null when the address is fine or unknown. */
export async function hostCheck(
  profile: Pick<ConnectionProfile, 'host' | 'user' | 'sshPort'>,
  ssh: SshRunner,
  resolve: Lookup,
  configFile?: string,
): Promise<string | null> {
  const d = await sshDefaults(profile, ssh, configFile);
  if (d?.proxied) return null;
  const hostname = d?.hostname ?? profile.host;
  if ((await resolve(hostname)) !== false) return null;
  return `Non trovo «${profile.host}» in rete. Controlla l’indirizzo (per esempio 192.168.1.20 o pc-casa.local) e, se usi una VPN come Tailscale, che sia accesa. Se sei sicuro, premi di nuovo «Salva».`;
}

export type TestResult =
  | { ok: true; message: string }
  | { ok: false; kind: TunnelErrorKind; message: string; field: FixField | null };

/**
 * "Prova": a tunnel of its own, closed at the end, whatever happens. The first attempt of a
 * tunnel is never retried by itself (D-044), so `failed` comes quickly with the reason.
 */
export async function testConnection(
  profile: ConnectionProfile & { name: string },
  open: (p: ConnectionProfile) => TunnelLike,
  timeoutMs = 90_000,
): Promise<TestResult> {
  const tunnel = open(profile);
  const address = profile.host;
  try {
    const state = await new Promise<TunnelState | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      const done = (s: TunnelState) => {
        if (s.status === 'connected' || s.status === 'failed' || s.status === 'reconnecting') {
          clearTimeout(timer);
          off();
          resolve(s);
        }
      };
      const off = tunnel.onState(done);
      done(tunnel.state);
    });
    if (state?.status === 'connected') {
      return {
        ok: true,
        message: `Funziona: Monsters ${state.coreVersion} risponde su «${profile.name}».`,
      };
    }
    const error =
      state?.status === 'failed' || state?.status === 'reconnecting' ? state.error : null;
    const kind: TunnelErrorKind = error?.kind ?? 'unreachable';
    const copy = remoteFailureCopy(kind, profile.name, address, error?.message ?? '');
    const message = copy.tip ? `${copy.message} ${copy.tip}` : copy.message;
    return { ok: false, kind, message, field: copy.fix };
  } finally {
    await tunnel.close().catch(() => {});
  }
}

/** The names a host has in known_hosts (as OpenSSH writes them). */
export function knownHostsNames(d: SshDefaults): string[] {
  if (d.hostKeyAlias) return [d.hostKeyAlias];
  return d.port === 22 ? [d.hostname] : [`[${d.hostname}]:${d.port}`];
}

/**
 * Removes the lines of `names` from the app's known_hosts (written by trustHostKeys: plain
 * names, never hashed). Returns how many lines went; 0 when the old key is elsewhere (the
 * user's ~/.ssh/known_hosts, which Monsters never writes).
 */
export function forgetHostKey(file: string, names: readonly string[]): number {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return 0;
  }
  const { kept, removed } = withoutHosts(text, names);
  if (removed > 0) writeFileSync(file, kept, { mode: 0o600 });
  return removed;
}

export function withoutHosts(
  text: string,
  names: readonly string[],
): { kept: string; removed: number } {
  let removed = 0;
  const lines = text.split(/\r?\n/).filter((line) => {
    const first = line.trim().split(/\s+/)[0] ?? '';
    const hit = !line.trim().startsWith('#') && first.split(',').some((n) => names.includes(n));
    if (hit) removed += 1;
    return !hit;
  });
  return { kept: lines.join('\n'), removed };
}
