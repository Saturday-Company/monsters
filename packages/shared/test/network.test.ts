import { afterEach, describe, expect, it } from 'vitest';
import {
  proxyAgentFor,
  proxyEnvOf,
  proxyForLog,
  resetEnvProxyForTests,
  trustSystemCertificates,
  useEnvProxy,
  withLoopbackNoProxy,
  type CaStore,
} from '../src/node/index.ts';

afterEach(() => resetEnvProxyForTests());

const pem = (n: string) => `-----BEGIN CERTIFICATE-----\n${n}\n-----END CERTIFICATE-----\n`;

/** A CA store with `default` and `system` lists, recording what was set. */
function fakeStore(defaults: string[], system: string[]) {
  const set: string[][] = [];
  const store: CaStore = {
    getCACertificates: (type) => (type === 'system' ? system : defaults),
    setDefaultCACertificates: (certs) => {
      set.push(certs);
    },
  };
  return { store, set };
}

describe('the system’s certificates', () => {
  it('adds the system ones to the defaults, without duplicates', () => {
    const { store, set } = fakeStore(
      [pem('A'), pem('B')],
      [pem('B').replace(/\n/g, '\r\n'), pem('C'), pem('C')],
    );
    expect(trustSystemCertificates(store, {})).toEqual({ ok: true, added: 1, total: 3 });
    expect(set).toEqual([[pem('A'), pem('B'), pem('C')]]);
  });

  it('nothing new: Node’s list is left alone', () => {
    const { store, set } = fakeStore([pem('A')], [pem('A')]);
    expect(trustSystemCertificates(store, {})).toEqual({ ok: true, added: 0, total: 1 });
    expect(set).toEqual([]);
  });

  it('never fatal: an old Node, a store that throws, the switch off', () => {
    expect(trustSystemCertificates({}, {})).toMatchObject({ ok: false });
    const throwing: CaStore = {
      getCACertificates: () => {
        throw new Error('no keychain');
      },
      setDefaultCACertificates: () => {},
    };
    expect(trustSystemCertificates(throwing, {})).toEqual({ ok: false, reason: 'no keychain' });
    const { store, set } = fakeStore([pem('A')], [pem('B')]);
    expect(trustSystemCertificates(store, { MONSTERS_SYSTEM_CA: '0' })).toMatchObject({
      ok: false,
    });
    expect(set).toEqual([]);
  });
});

describe('the proxy of the environment', () => {
  it('loopback is always direct, added once to what is there', () => {
    expect(withLoopbackNoProxy(undefined)).toBe('localhost,127.0.0.1,::1,[::1]');
    expect(withLoopbackNoProxy('.corp.example, LOCALHOST')).toBe(
      '.corp.example,LOCALHOST,127.0.0.1,::1,[::1]',
    );
  });

  it('reads the variables, lowercase first, or null without a proxy', () => {
    expect(proxyEnvOf({ NO_PROXY: 'x' })).toBeNull();
    expect(
      proxyEnvOf({ https_proxy: 'http://low:1', HTTPS_PROXY: 'http://up:2', no_proxy: 'a.b' }),
    ).toEqual({ HTTPS_PROXY: 'http://low:1', NO_PROXY: 'a.b,localhost,127.0.0.1,::1,[::1]' });
    expect(proxyForLog('http://user:secret@proxy.corp:3128/')).toBe('http://proxy.corp:3128');
  });

  it('applies it globally, writes NO_PROXY back for the children, and gives grammY an agent', () => {
    const env: NodeJS.ProcessEnv = { HTTPS_PROXY: 'http://u:p@proxy.corp:3128' };
    const applied: unknown[] = [];
    expect(proxyAgentFor('https://api.telegram.org')).toBeUndefined();
    expect(useEnvProxy(env, (e) => applied.push(e))).toEqual({
      ok: true,
      proxy: 'http://proxy.corp:3128',
    });
    expect(applied).toEqual([
      { HTTPS_PROXY: 'http://u:p@proxy.corp:3128', NO_PROXY: 'localhost,127.0.0.1,::1,[::1]' },
    ]);
    expect(env['NO_PROXY']).toBe('localhost,127.0.0.1,::1,[::1]');
    expect(env['no_proxy']).toBe('localhost,127.0.0.1,::1,[::1]');
    const agent = proxyAgentFor('https://api.telegram.org');
    expect(agent).toBeDefined();
    // One keep-alive agent, reused.
    expect(proxyAgentFor('https://api.telegram.org/other')).toBe(agent);
  });

  it('no proxy: nothing is touched; a refused configuration is reported, not thrown', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(useEnvProxy(env, () => {})).toBeNull();
    expect(env).toEqual({});
    const bad = useEnvProxy({ HTTPS_PROXY: 'nonsense' }, () => {
      throw new Error('Invalid proxy URL');
    });
    expect(bad?.ok).toBe(false);
    expect(bad && !bad.ok ? bad.reason : '').toContain('Invalid proxy URL');
    expect(proxyAgentFor('https://api.telegram.org')).toBeUndefined();
  });
});
