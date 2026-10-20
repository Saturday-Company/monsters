import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ConnectionProfile } from './profile.ts';
import { runCapture, type ProcessDeps } from './process.ts';
import { resolveArgs, type SshArgOptions } from './ssh-args.ts';

/** Where ssh will really connect, after `~/.ssh/config` (`ssh -G`). */
export interface SshTarget {
  hostname: string;
  port: number;
  hostKeyAlias?: string | undefined;
  /** Behind ProxyJump/ProxyCommand: ssh-keyscan cannot reach it directly. */
  proxied: boolean;
}

export interface HostKey {
  /** `ssh-ed25519`, `ecdsa-sha2-nistp256`, `ssh-rsa`… */
  type: string;
  /** Base64 public key blob, as in known_hosts. */
  key: string;
  /** `SHA256:…`, as printed by `ssh-keygen -lf` and by ssh itself. */
  fingerprint: string;
}

/** What the user confirms on a first connection. */
export interface HostKeyInfo {
  /** Host of the profile, as the user typed it. */
  host: string;
  hostname: string;
  port: number;
  /** Name the keys are stored under in known_hosts (`[host]:port` when port ≠ 22). */
  knownHostsName: string;
  /** Strongest first: show the first one, compare it with `ssh-keygen -lf` on the server. */
  keys: HostKey[];
}

export function sshFingerprint(base64Key: string): string {
  const digest = createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest('base64');
  return `SHA256:${digest.replace(/=+$/, '')}`;
}

/** Parses `ssh -G` output. */
export function parseSshConfigDump(output: string, fallbackHost: string): SshTarget {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const space = line.indexOf(' ');
    if (space <= 0) continue;
    const key = line.slice(0, space).toLowerCase();
    if (!values.has(key)) values.set(key, line.slice(space + 1).trim());
  }
  const set = (k: string) => {
    const v = values.get(k);
    return v !== undefined && v !== '' && v.toLowerCase() !== 'none' ? v : undefined;
  };
  const port = Number(values.get('port') ?? 22);
  return {
    hostname: set('hostname') ?? fallbackHost,
    port: Number.isInteger(port) && port > 0 ? port : 22,
    hostKeyAlias: set('hostkeyalias'),
    proxied: set('proxyjump') !== undefined || set('proxycommand') !== undefined,
  };
}

/** The name OpenSSH looks up in known_hosts for this target. */
export function knownHostsName(target: SshTarget): string {
  if (target.hostKeyAlias !== undefined) return target.hostKeyAlias;
  return target.port === 22 ? target.hostname : `[${target.hostname}]:${target.port}`;
}

const TYPE_ORDER = [
  'ssh-ed25519',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'ssh-rsa',
];

/** Parses `ssh-keyscan` output (`name type key` lines; comments go to stderr). */
export function parseKeyscan(output: string): HostKey[] {
  const keys: HostKey[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('#')) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const [, type, key] = parts as [string, string, string];
    if (!/^[A-Za-z0-9+/]+=*$/.test(key) || seen.has(`${type} ${key}`)) continue;
    seen.add(`${type} ${key}`);
    keys.push({ type, key, fingerprint: sshFingerprint(key) });
  }
  const rank = (t: string) => {
    const i = TYPE_ORDER.indexOf(t);
    return i < 0 ? TYPE_ORDER.length : i;
  };
  return keys.sort((a, b) => rank(a.type) - rank(b.type));
}

export interface HostKeyDeps extends ProcessDeps {
  sshPath: string;
  keyscanPath: string | null;
  sshArgs: SshArgOptions;
  signal?: AbortSignal;
}

export async function resolveTarget(
  profile: ConnectionProfile,
  deps: HostKeyDeps,
): Promise<SshTarget> {
  const res = await runCapture(deps.sshPath, resolveArgs(profile, deps.sshArgs), 10_000, deps);
  if (res.code !== 0) {
    return { hostname: profile.host, port: profile.sshPort ?? 22, proxied: false };
  }
  return parseSshConfigDump(res.stdout, profile.host);
}

/**
 * Reads the host keys of an unknown host to show their fingerprints. Nothing
 * is trusted here: `trustHostKeys` writes them once the user confirmed.
 * Returns null when the keys cannot be read (proxied host, no ssh-keyscan).
 */
export async function scanHostKeys(
  profile: ConnectionProfile,
  deps: HostKeyDeps,
): Promise<HostKeyInfo | null> {
  const target = await resolveTarget(profile, deps);
  if (target.proxied || deps.keyscanPath === null) return null;
  const res = await runCapture(
    deps.keyscanPath,
    ['-T', '5', '-p', String(target.port), '--', target.hostname],
    15_000,
    deps,
  );
  const keys = parseKeyscan(res.stdout);
  if (keys.length === 0) return null;
  return {
    host: profile.host,
    hostname: target.hostname,
    port: target.port,
    knownHostsName: knownHostsName(target),
    keys,
  };
}

/**
 * Adds the confirmed key to the known_hosts of Monsters (0600). Only `keys[0]`, the one the
 * dialog shows: trusting the others too would let a man in the middle slip an extra key of
 * another type next to the real one and later present only that (problem 22). OpenSSH then
 * negotiates the type it already knows for this host.
 */
export function trustHostKeys(knownHostsFile: string, info: HostKeyInfo): void {
  if (/[\s,]/.test(info.knownHostsName) || info.knownHostsName.startsWith('#')) {
    throw new Error(`invalid host name for known_hosts: ${info.knownHostsName}`);
  }
  mkdirSync(dirname(knownHostsFile), { recursive: true, mode: 0o700 });
  const existing = existsSync(knownHostsFile) ? readFileSync(knownHostsFile, 'utf8') : '';
  const present = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  let add = '';
  for (const k of info.keys.slice(0, 1)) {
    if (!/^[A-Za-z0-9.@-]+$/.test(k.type) || !/^[A-Za-z0-9+/]+=*$/.test(k.key)) continue;
    const line = `${info.knownHostsName} ${k.type} ${k.key}`;
    if (!present.has(line)) add += `${line}\n`;
  }
  if (add === '') return;
  const prefix = existing === '' || existing.endsWith('\n') ? '' : '\n';
  appendFileSync(knownHostsFile, prefix + add, { mode: 0o600 });
  try {
    chmodSync(knownHostsFile, 0o600);
  } catch {
    // Windows: modes are not enforced.
  }
}
