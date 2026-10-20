import dns, { type LookupAddress } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { ToolError } from '@monsters/shared';
import { Agent } from 'undici';

/*
 * SSRF guard of `web_fetch` (DECISIONS D-019): a page may only be fetched from
 * public addresses. The host is resolved once, every address is checked (not
 * only the first), and the connection is pinned to the checked addresses, so a
 * DNS answer that changes between the check and the connection (rebinding)
 * cannot reach the core, the LAN or the cloud metadata service.
 */

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** Resolves a hostname to every address (tests inject their own). */
export type Resolver = (hostname: string, signal?: AbortSignal) => Promise<ResolvedAddress[]>;

/** The system resolver (`dns.lookup`, all addresses, as the OS would connect). */
export const systemResolver: Resolver = (hostname, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason as Error);
    // `dns.lookup` cannot be cancelled (it runs in the thread pool): a slow
    // resolver is abandoned when the signal (timeout or stop) fires.
    const onAbort = () => reject(signal?.reason as Error);
    signal?.addEventListener('abort', onAbort, { once: true });
    // Read at call time: `dns.lookup` is what `net` itself would use.
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses: LookupAddress[]) => {
      signal?.removeEventListener('abort', onAbort);
      if (err) return reject(err);
      resolve(
        addresses
          .filter((a) => a.family === 4 || a.family === 6)
          .map((a) => ({ address: a.address, family: a.family as 4 | 6 })),
      );
    });
  });

function ipv4Bytes(ip: string): number[] | null {
  if (isIP(ip) !== 4) return null;
  return ip.split('.').map(Number);
}

/** Private, loopback, link-local, CGNAT, documentation, benchmark, multicast or reserved. */
function isBlockedIPv4([a = 0, b = 0, c = 0]: number[]): boolean {
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Eight 16-bit groups, or null. Accepts `::` and a trailing dotted quad. */
function ipv6Groups(ip: string): number[] | null {
  let v = ip.toLowerCase();
  const zone = v.indexOf('%');
  if (zone >= 0) v = v.slice(0, zone);
  if (isIP(v) !== 6) return null;
  const quad = /(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (quad) {
    const bytes = ipv4Bytes(quad[1]!);
    if (!bytes) return null;
    const hex = `${((bytes[0]! << 8) | bytes[1]!).toString(16)}:${((bytes[2]! << 8) | bytes[3]!).toString(16)}`;
    v = v.slice(0, quad.index) + hex;
  }
  const [head = '', tail] = v.split('::');
  const parse = (s: string) => (s ? s.split(':').map((g) => parseInt(g, 16)) : []);
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array<number>(fill).fill(0), ...right];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0) ? groups : null;
}

const v4From = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];

function isBlockedIPv6(g: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  // ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d
  if (zeroTo(6)) return true;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-translated ::ffff:0:a.b.c.d
  if (zeroTo(5) && g5 === 0xffff) return isBlockedIPv4(v4From(g6, g7));
  if (zeroTo(4) && g4 === 0xffff && g5 === 0) return isBlockedIPv4(v4From(g6, g7));
  // NAT64 well-known prefix 64:ff9b::/96: the embedded IPv4 decides
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isBlockedIPv4(v4From(g6, g7));
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return true; // local-use NAT64 64:ff9b:1::/48
  if (g0 === 0x2002) return isBlockedIPv4(v4From(g1, g2)); // 6to4: IPv4 in bits 16-48
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // discard 100::/64
  if (g0 === 0x2001 && g1 < 0x200) return true; // IETF protocol assignments, Teredo
  if (g0 === 0x2001 && g1 === 0xdb8) return true; // documentation
  if (g0 === 0x3fff && g1 < 0x1000) return true; // documentation 3fff::/20
  if ((g0 & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) return true; // link/site-local
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/**
 * True for addresses that are not on the public Internet: loopback, private,
 * link-local, CGNAT, ULA, multicast, reserved, documentation, and IPv6 forms
 * that embed one of them (IPv4-mapped, NAT64, 6to4). Non-IP input is blocked.
 */
export function isBlockedAddress(ip: string): boolean {
  const v = ip.replace(/^\[|\]$/g, '');
  const v4 = ipv4Bytes(v);
  if (v4) return isBlockedIPv4(v4);
  const v6 = ipv6Groups(v);
  return v6 ? isBlockedIPv6(v6) : true;
}

/** Lowercase, without brackets and trailing dots (`localhost.` is `localhost`). */
export function normalizeHost(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.+$/, '');
}

/** Names that are local by definition, whatever the DNS says. */
export function isLocalName(host: string): boolean {
  const h = normalizeHost(host);
  return (
    h === '' ||
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.home.arpa') ||
    !h.includes('.') // single-label names go to the LAN search domain
  );
}

/**
 * True for hosts on this machine or the local network, from the literal host
 * only (IP literals and local names). `web_fetch` also checks what a name
 * resolves to: see `resolvePublic`.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (isIP(host)) return isBlockedAddress(host);
  return isLocalName(host);
}

function denied(host: string, why: string): ToolError {
  return new ToolError('BLOCKED_BY_POLICY', `${host} ${why}`, {
    hint: 'Only public web pages can be fetched.',
  });
}

/**
 * Resolves the host of `url` and refuses it when any address is not public.
 * Returns the checked addresses, to pin the connection to them.
 */
export async function resolvePublic(
  url: URL,
  options: { resolver: Resolver; allowPrivate: boolean; signal?: AbortSignal },
): Promise<ResolvedAddress[]> {
  const host = normalizeHost(url.hostname);
  const literal = isIP(host);
  if (literal) {
    if (!options.allowPrivate && isBlockedAddress(host)) {
      throw denied(host, 'is a local or private address');
    }
    return [{ address: host, family: literal as 4 | 6 }];
  }
  if (!options.allowPrivate && isLocalName(host)) {
    throw denied(host, 'is a local or private address');
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await options.resolver(host, options.signal);
  } catch (err) {
    if (options.signal?.aborted) throw err;
    const code = (err as NodeJS.ErrnoException).code ?? (err as Error).message;
    throw new ToolError('UNAVAILABLE', `cannot resolve ${host}: ${code}`, {
      hint: 'Check the address: the site name does not exist or the network is down.',
    });
  }
  if (addresses.length === 0) {
    throw new ToolError('UNAVAILABLE', `cannot resolve ${host}`, {
      hint: 'Check the address: the site name does not exist.',
    });
  }
  if (!options.allowPrivate) {
    const bad = addresses.find((a) => isBlockedAddress(a.address));
    if (bad) throw denied(host, `resolves to a local or private address (${bad.address})`);
  }
  return addresses;
}

/** A `net` lookup that always answers with the checked addresses. */
export function pinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(
        null,
        addresses.map((a) => ({ address: a.address, family: a.family })),
      );
      return;
    }
    const wanted = options.family === 6 || options.family === 4 ? options.family : 0;
    const pick = addresses.find((a) => wanted === 0 || a.family === wanted) ?? addresses[0]!;
    callback(null, pick.address, pick.family);
  };
}

/** An HTTP dispatcher that connects only to `addresses`, whatever the DNS says later. */
export function pinnedDispatcher(addresses: ResolvedAddress[]): Agent {
  return new Agent({ connect: { lookup: pinnedLookup(addresses) }, connections: 4 });
}
