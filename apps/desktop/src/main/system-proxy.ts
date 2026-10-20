import { withLoopbackNoProxy } from '@monsters/shared/node';

/*
 * The system proxy for the core (the browser's, PAC included). Chromium knows it, Node does
 * not: before every start of the core the app asks its session which proxy reaches
 * api.telegram.org and hands it to the core as HTTPS_PROXY / HTTP_PROXY, which the core
 * applies to everything it fetches (shared/node/network.ts). A proxy already in the app's
 * environment wins: the user chose it. SOCKS cannot be used by Node's agents: only logged.
 */

/** The address the app asks about: a host the core must reach, outside the local network. */
export const PROXY_PROBE_URL = 'https://api.telegram.org';

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'];

export interface CoreProxy {
  /** Variables to add to the core's environment (empty: none). */
  env: Record<string, string>;
  /** What happened, for the app's log. */
  note: string;
}

/**
 * From Chromium's answer (`DIRECT`, `PROXY host:port`, `HTTPS host:port`, `SOCKS5 host:port`,
 * several separated by `;` in the order to try) and the app's environment, the proxy variables
 * for the core. The first entry decides: `DIRECT` first means no proxy (the others are only
 * fallbacks); SOCKS entries are skipped for the next HTTP one, and logged.
 */
export function coreProxyEnv(resolved: string, env: NodeJS.ProcessEnv): CoreProxy {
  const own = PROXY_VARS.find((k) => env[k]);
  if (own) return { env: {}, note: `proxy: ${own} from the environment, as it is` };
  const entries = resolved
    .split(';')
    .map((e) => e.trim())
    .filter(Boolean);
  const skipped: string[] = [];
  for (const entry of entries) {
    const [scheme = '', hostPort = ''] = entry.split(/\s+/, 2);
    const kind = scheme.toUpperCase();
    if (kind === 'DIRECT') break;
    if (kind === 'SOCKS' || kind === 'SOCKS4' || kind === 'SOCKS5') {
      skipped.push(entry);
      continue;
    }
    if ((kind === 'PROXY' || kind === 'HTTPS') && /^[^\s/]+:\d{1,5}$/.test(hostPort)) {
      const url = `${kind === 'HTTPS' ? 'https' : 'http'}://${hostPort}`;
      const noProxy = withLoopbackNoProxy(env['no_proxy'] || env['NO_PROXY']);
      return {
        env: { HTTPS_PROXY: url, HTTP_PROXY: url, NO_PROXY: noProxy },
        note: `proxy: ${url} from the system settings${skipped.length > 0 ? ` (skipped ${skipped.join(', ')}: SOCKS is not usable by the core)` : ''}`,
      };
    }
    skipped.push(entry);
  }
  if (skipped.some((e) => /^SOCKS/i.test(e))) {
    return {
      env: {},
      note: `proxy: the system says ${skipped.join(', ')}: SOCKS is not usable by the core, it connects directly`,
    };
  }
  return { env: {}, note: 'proxy: none (direct)' };
}
