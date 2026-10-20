import type { CoreConfig } from '../config.ts';
import { isLoopbackHost } from '../config.ts';

export const SESSION_COOKIE = 'monsters_session';
/** Long-lived cookie identifying a browser that logged in before (own rate-limit bucket). */
export const DEVICE_COOKIE = 'monsters_device';

/**
 * Anti-CSRF header required on every state-changing request that does not use
 * a bearer token (i.e. browser requests authenticated by cookie).
 */
export const CSRF_HEADER = 'X-Monsters-Request';
export const CSRF_HEADER_VALUE = '1';

/** True for `application/json`, with optional parameters (`; charset=utf-8`). */
export function isJsonContentType(header: string | undefined): boolean {
  if (!header) return false;
  const type = header.split(';', 1)[0]?.trim().toLowerCase();
  return type === 'application/json';
}

/** Hostname part of a `Host` header (handles `[::1]:4747`). */
export function hostnameOf(hostHeader: string): string {
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']');
    return end > 0 ? hostHeader.slice(0, end + 1) : hostHeader;
  }
  const colon = hostHeader.lastIndexOf(':');
  return colon > 0 ? hostHeader.slice(0, colon) : hostHeader;
}

/**
 * DNS-rebinding protection: the `Host` header must name a loopback address
 * (or the configured host when binding elsewhere was explicitly allowed).
 */
export function isAllowedHost(hostHeader: string | undefined, config: CoreConfig): boolean {
  if (!hostHeader) return false;
  const host = hostnameOf(hostHeader.trim().toLowerCase());
  if (isLoopbackHost(host)) return true;
  return config.allowNonLoopback && host === config.host.toLowerCase();
}

/**
 * Origin check for browser requests. A missing Origin means a non-browser
 * client (CLI, curl), which still needs a valid token or session.
 */
export function isAllowedOrigin(origin: string | undefined, config: CoreConfig): boolean {
  if (origin === undefined) return true;
  const normalized = normalizeOrigin(origin);
  return config.allowedOrigins.some((o) => normalizeOrigin(o) === normalized);
}

function normalizeOrigin(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, '');
}

/** Reads one cookie from a `Cookie` header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      const raw = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return undefined;
}

/** Extracts the token from `Authorization: Bearer <token>`. */
export function readBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}
