import * as http from 'node:http';
import * as https from 'node:https';
import * as tls from 'node:tls';

/*
 * The core's way out to the internet, made closer to the browser's (where the user sees it
 * work). Behind a VPN or a corporate network the browser trusts the certificates of the
 * operating system (a TLS-inspecting proxy installs its own root there) and goes through the
 * system proxy; Node trusts only its bundled list and connects directly. Both are set once,
 * before the core opens any connection (`prepareCoreProcess`), and never stop the start.
 */

/** The parts of `node:tls` used here (tests pass their own). */
export interface CaStore {
  getCACertificates?: (type?: 'default' | 'system' | 'bundled' | 'extra') => string[];
  setDefaultCACertificates?: (certs: string[]) => void;
}

export type SystemCaResult =
  { ok: true; added: number; total: number } | { ok: false; reason: string };

const pemKey = (pem: string) => pem.replace(/\r\n/g, '\n').trim();

/**
 * Adds the certificates of the operating system's store to Node's defaults (bundled +
 * NODE_EXTRA_CA_CERTS): every later TLS connection without its own `ca` trusts them, the
 * `fetch` of undici and `https.request` alike (grammY's keep-alive agent sets no `ca`).
 * `MONSTERS_SYSTEM_CA=0` leaves Node's list alone.
 */
export function trustSystemCertificates(
  store: CaStore = tls,
  env: NodeJS.ProcessEnv = process.env,
): SystemCaResult {
  if (env['MONSTERS_SYSTEM_CA'] === '0') return { ok: false, reason: 'off (MONSTERS_SYSTEM_CA=0)' };
  const { getCACertificates, setDefaultCACertificates } = store;
  if (typeof getCACertificates !== 'function' || typeof setDefaultCACertificates !== 'function') {
    return { ok: false, reason: 'this Node has no tls.setDefaultCACertificates' };
  }
  try {
    const current = getCACertificates('default');
    const system = getCACertificates('system');
    const seen = new Set(current.map(pemKey));
    const extra = system.filter((pem) => {
      const key = pemKey(pem);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (extra.length > 0) setDefaultCACertificates([...current, ...extra]);
    return { ok: true, added: extra.length, total: current.length + extra.length };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Never through a proxy: the core's own API, Ollama, local MCP servers. Both IPv6 spellings
 * (Node's agent compares `::1`, undici keeps the brackets). */
export const LOOPBACK_NO_PROXY = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** A NO_PROXY list with the loopback names added (once). */
export function withLoopbackNoProxy(noProxy: string | undefined): string {
  const entries = (noProxy ?? '')
    .split(/[,\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  const lower = new Set(entries.map((e) => e.toLowerCase()));
  for (const name of LOOPBACK_NO_PROXY) if (!lower.has(name)) entries.push(name);
  return entries.join(',');
}

/** The proxy variables of an environment (lowercase wins, as in Node and curl), or null. */
export function proxyEnvOf(env: NodeJS.ProcessEnv): http.ProxyEnv | null {
  const httpsProxy = env['https_proxy'] || env['HTTPS_PROXY'];
  const httpProxy = env['http_proxy'] || env['HTTP_PROXY'];
  if (!httpsProxy && !httpProxy) return null;
  const noProxy = withLoopbackNoProxy(env['no_proxy'] || env['NO_PROXY']);
  return {
    ...(httpsProxy ? { HTTPS_PROXY: httpsProxy } : {}),
    ...(httpProxy ? { HTTP_PROXY: httpProxy } : {}),
    NO_PROXY: noProxy,
  };
}

/** A proxy URL without its user and password, for the log. */
export function proxyForLog(url: string): string {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return '(invalid URL)';
  }
}

let activeProxyEnv: http.ProxyEnv | null = null;
const agents = new Map<string, http.Agent>();

export type EnvProxyResult = { ok: true; proxy: string } | { ok: false; reason: string } | null;

/**
 * HTTPS_PROXY / HTTP_PROXY / NO_PROXY (and lowercase) for the whole core: global `fetch`
 * (undici's EnvHttpProxyAgent) and `https.request` without an agent (Node's global agents),
 * with loopback always direct. NO_PROXY is also written back to `process.env`, so the
 * programs the core starts (Codex, Claude, MCP servers) keep reaching it directly. Null when
 * no proxy is set.
 */
export function useEnvProxy(
  env: NodeJS.ProcessEnv = process.env,
  setGlobal: ((proxyEnv: http.ProxyEnv) => unknown) | undefined = http.setGlobalProxyFromEnv,
): EnvProxyResult {
  const proxyEnv = proxyEnvOf(env);
  if (!proxyEnv) return null;
  const shown = proxyForLog((proxyEnv.HTTPS_PROXY ?? proxyEnv.HTTP_PROXY)!);
  if (typeof setGlobal !== 'function') {
    return {
      ok: false,
      reason: `${shown} not applied: this Node has no http.setGlobalProxyFromEnv`,
    };
  }
  try {
    env['NO_PROXY'] = proxyEnv.NO_PROXY;
    env['no_proxy'] = proxyEnv.NO_PROXY;
    setGlobal(proxyEnv);
    activeProxyEnv = proxyEnv;
    agents.clear();
    return { ok: true, proxy: shown };
  } catch (err) {
    return {
      ok: false,
      reason: `${shown} not applied: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * A keep-alive agent through the proxy for a library that brings its own agent (grammY:
 * node-fetch with `new https.Agent()`, which the global one would never replace). Undefined
 * without a proxy: the library keeps its own.
 */
export function proxyAgentFor(url: string): http.Agent | undefined {
  if (!activeProxyEnv) return undefined;
  const secure = url.startsWith('https:');
  const key = secure ? 'https' : 'http';
  let agent = agents.get(key);
  if (!agent) {
    const options = { keepAlive: true, proxyEnv: activeProxyEnv };
    agent = secure ? new https.Agent(options) : new http.Agent(options);
    agents.set(key, agent);
  }
  return agent;
}

/** Test hook: back to "no proxy" for `proxyAgentFor`. */
export function resetEnvProxyForTests(): void {
  activeProxyEnv = null;
  agents.clear();
}

/** Both, with one line each for the start log. */
export function prepareNetwork(env: NodeJS.ProcessEnv = process.env): string[] {
  const lines: string[] = [];
  const ca = trustSystemCertificates(tls, env);
  lines.push(
    ca.ok
      ? `TLS: ${ca.added} certificates of the system store trusted (${ca.total} in all)`
      : `TLS: system certificates not added: ${ca.reason}`,
  );
  const proxy = useEnvProxy(env);
  if (proxy) lines.push(proxy.ok ? `Proxy: ${proxy.proxy}` : `Proxy: ${proxy.reason}`);
  return lines;
}
