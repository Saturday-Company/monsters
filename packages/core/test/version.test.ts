import { readFileSync } from 'node:fs';
import { ProviderRegistry } from '@monsters/providers';
import { afterEach, describe, expect, it } from 'vitest';
import { CORE_VERSION, resolveCoreVersion, startCore, type CoreServer } from '../src/index.ts';
import { tempHome } from './helpers.ts';

const desktopVersion = (
  JSON.parse(
    readFileSync(new URL('../../../apps/desktop/package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

const cores: CoreServer[] = [];
afterEach(async () => {
  for (const c of cores.splice(0)) await c.close();
});

describe('core version', () => {
  it('is the product version, not the 0.0.0 of the workspace packages', async () => {
    expect(desktopVersion).not.toBe('0.0.0');
    expect(CORE_VERSION).toBe(desktopVersion);

    const core = await startCore({
      home: tempHome(),
      port: 0,
      env: {},
      webDist: false,
      hub: {
        providers: new ProviderRegistry(),
        webTools: [],
        decisionPort: null,
        settings: { watchVault: false },
      },
    });
    cores.push(core);
    const health = (await (await fetch(`${core.url}/api/health`)).json()) as { version: string };
    expect(health).toEqual({ ok: true, version: desktopVersion });
  });

  it('prefers the version of the app, then the bundle, then the sources', () => {
    const source = () => '0.1.0';
    expect(
      resolveCoreVersion({ env: { MONSTERS_APP_VERSION: '0.0.2' }, bundled: '0.0.1', source }),
    ).toBe('0.0.2');
    expect(resolveCoreVersion({ env: {}, bundled: '0.0.1', source })).toBe('0.0.1');
    expect(resolveCoreVersion({ env: {}, bundled: undefined, source })).toBe('0.1.0');
    expect(resolveCoreVersion({ env: {}, bundled: undefined, source: () => null })).toBe('0.0.0');
    expect(
      resolveCoreVersion({
        env: { MONSTERS_APP_VERSION: '1.2.3-alpha.1' },
        bundled: undefined,
        source,
      }),
    ).toBe('1.2.3-alpha.1');
  });

  it('ignores a version that is not a semantic version', () => {
    const source = () => 'not-a-version';
    expect(
      resolveCoreVersion({ env: { MONSTERS_APP_VERSION: 'v1; rm -rf' }, bundled: 'x', source }),
    ).toBe('0.0.0');
    expect(
      resolveCoreVersion({ env: { MONSTERS_APP_VERSION: ' ' }, bundled: '0.3.0', source }),
    ).toBe('0.3.0');
  });
});
