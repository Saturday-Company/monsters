/**
 * The remote core accepts only its own origin, `http://127.0.0.1:<its port>`
 * (also `localhost` and `[::1]`). The app window loads the UI through the
 * tunnel from `http://127.0.0.1:<local port>`: when the two ports differ, the
 * app rewrites the `Origin` of its own requests to the tunnel (D-044). These
 * helpers hold that logic so it is tested here; the Electron side only wires
 * them into `session.webRequest.onBeforeSendHeaders`.
 */

const LOOPBACK_NAMES = ['127.0.0.1', 'localhost', '[::1]'];

export interface TunnelPorts {
  localPort: number;
  remotePort: number;
}

/** URL patterns for `webRequest` filters: HTTP and WebSocket to the tunnel. */
export function tunnelUrlPatterns(localPort: number): string[] {
  return LOOPBACK_NAMES.flatMap((h) => [`http://${h}:${localPort}/*`, `ws://${h}:${localPort}/*`]);
}

function isTunnelUrl(url: string, localPort: number): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'ws:') return false;
  return LOOPBACK_NAMES.includes(u.hostname) && u.port === String(localPort);
}

/**
 * Returns the request headers to send, with `Origin` moved from the local
 * port to the remote one. Only the exact local origin is rewritten: any other
 * origin (another local app, a page on another port) goes through untouched
 * and the remote core rejects it, as it would without the tunnel. A missing
 * Origin stays missing. Host is left alone: the core only checks that it is a
 * loopback name, whatever the port.
 */
export function rewriteTunnelHeaders(
  url: string,
  headers: Record<string, string>,
  ports: TunnelPorts,
): Record<string, string> {
  if (ports.localPort === ports.remotePort || !isTunnelUrl(url, ports.localPort)) return headers;
  const name = Object.keys(headers).find((k) => k.toLowerCase() === 'origin');
  if (name === undefined) return headers;
  const origin = headers[name]!.trim().toLowerCase().replace(/\/+$/, '');
  for (const h of LOOPBACK_NAMES) {
    if (origin === `http://${h}:${ports.localPort}`) {
      return { ...headers, [name]: `http://${h}:${ports.remotePort}` };
    }
  }
  return headers;
}
