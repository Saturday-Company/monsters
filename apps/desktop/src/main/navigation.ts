/*
 * What the window may load (D-045): only the core's own origin. Links to the web open in the
 * system browser (http and https only, no credentials in the URL); anything else (file:,
 * javascript:, data:, custom schemes, other local ports) is dropped. New windows are never
 * created. Pure functions, used by the Electron handlers in index.ts.
 */

export type NavigationVerdict =
  { action: 'allow' } | { action: 'external'; url: string } | { action: 'deny' };

/** `scheme://host:port` of a URL, or null when it does not parse or has no origin. */
export function originOf(raw: string): string | null {
  try {
    const origin = new URL(raw).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

export function isCoreUrl(raw: string, coreOrigin: string | null): boolean {
  return coreOrigin !== null && originOf(raw) === coreOrigin;
}

/** The URL to hand to the system browser, or null when it must not leave the app. */
export function externalUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || !url.hostname) return null;
  return url.href;
}

/** A navigation of the window started by the page (link, `location`, form, redirect). */
export function navigationVerdict(raw: string, coreOrigin: string | null): NavigationVerdict {
  if (isCoreUrl(raw, coreOrigin)) return { action: 'allow' };
  const url = externalUrl(raw);
  // The core's host on another port is not "the web": never handed to the browser.
  if (url && !isLoopbackUrl(url)) return { action: 'external', url };
  return { action: 'deny' };
}

/** `window.open` and `target=_blank`: never a new window; web links go to the browser. */
export function windowOpenVerdict(raw: string, coreOrigin: string | null): NavigationVerdict {
  const verdict = navigationVerdict(raw, coreOrigin);
  return verdict.action === 'allow' ? { action: 'deny' } : verdict;
}

function isLoopbackUrl(raw: string): boolean {
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127(\.\d{1,3}){3}$/.test(host) ||
    host === '0.0.0.0'
  );
}

/**
 * How many links the page may hand to the system browser (M3.6, D-049): at most `max` in any
 * `windowMs`. The core the window shows (a remote one too) decides which https pages open, as
 * any web page can; what it cannot do is flood the browser with tabs.
 */
export class ExternalOpenLimiter {
  readonly #max: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  #times: number[] = [];

  constructor(opts: { max?: number; windowMs?: number; now?: () => number } = {}) {
    this.#max = opts.max ?? 5;
    this.#windowMs = opts.windowMs ?? 10_000;
    this.#now = opts.now ?? Date.now;
  }

  /** True (and counted) if one more link may open now. */
  allow(): boolean {
    const now = this.#now();
    this.#times = this.#times.filter((t) => now - t < this.#windowMs);
    if (this.#times.length >= this.#max) return false;
    this.#times.push(now);
    return true;
  }
}

/**
 * Permissions the page may get (all others are denied): writing to the clipboard (the
 * "copy" buttons) and fullscreen, only for the core's origin.
 */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  'clipboard-sanitized-write',
  'fullscreen',
]);

export function permissionAllowed(
  permission: string,
  requestingUrl: string,
  coreOrigin: string | null,
): boolean {
  return ALLOWED_PERMISSIONS.has(permission) && isCoreUrl(requestingUrl, coreOrigin);
}

/**
 * WebRTC of every page of the app (`webContents.setWebRTCIPHandlingPolicy`, D-085): the
 * strictest value Electron has. No UDP unless a proxy carries it (the app sets none, so no
 * STUN request leaves) and no local address in the ICE candidates. It does not take
 * RTCPeerConnection away, and TCP to a TURN server still works: the core's HTML pages get a
 * lockdown script for that (packages/core/src/server/file-headers.ts).
 */
export const WEBRTC_IP_POLICY = 'disable_non_proxied_udp' as const;
