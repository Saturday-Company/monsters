import { describe, expect, it } from 'vitest';
import { coreProxyEnv } from '../src/main/system-proxy.ts';

const LOOPBACK = 'localhost,127.0.0.1,::1,[::1]';

describe('the system proxy for the core', () => {
  it('PROXY and HTTPS entries become the core’s variables, loopback always direct', () => {
    expect(coreProxyEnv('PROXY proxy.corp:8080', {}).env).toEqual({
      HTTPS_PROXY: 'http://proxy.corp:8080',
      HTTP_PROXY: 'http://proxy.corp:8080',
      NO_PROXY: LOOPBACK,
    });
    // A PAC answer with a fallback: the first one counts.
    expect(coreProxyEnv('HTTPS secure.corp:443; DIRECT', { no_proxy: '.corp' }).env).toEqual({
      HTTPS_PROXY: 'https://secure.corp:443',
      HTTP_PROXY: 'https://secure.corp:443',
      NO_PROXY: `.corp,${LOOPBACK}`,
    });
  });

  it('DIRECT first: nothing, whatever comes after', () => {
    expect(coreProxyEnv('DIRECT', {})).toEqual({ env: {}, note: 'proxy: none (direct)' });
    expect(coreProxyEnv('DIRECT; PROXY p:1', {}).env).toEqual({});
    expect(coreProxyEnv('', {}).env).toEqual({});
  });

  it('SOCKS cannot be used by Node: logged, skipped for an HTTP fallback', () => {
    const socks = coreProxyEnv('SOCKS5 127.0.0.1:1080', {});
    expect(socks.env).toEqual({});
    expect(socks.note).toContain('SOCKS is not usable');
    const fallback = coreProxyEnv('SOCKS5 s:1080; PROXY p:3128', {});
    expect(fallback.env['HTTPS_PROXY']).toBe('http://p:3128');
    expect(fallback.note).toContain('skipped SOCKS5 s:1080');
  });

  it('a proxy already in the app’s environment wins: nothing added', () => {
    for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
      const out = coreProxyEnv('PROXY proxy.corp:8080', { [k]: 'http://mine:1' });
      expect(out.env).toEqual({});
      expect(out.note).toContain(k);
    }
  });

  it('an entry it cannot read is not passed on', () => {
    expect(coreProxyEnv('PROXY not a host', {}).env).toEqual({});
    expect(coreProxyEnv('QUIC q:443', {}).env).toEqual({});
  });
});
