import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ProviderRegistry } from '@monsters/providers';
import { checkTunnelProof, newTunnelProofNonce } from '@monsters/shared/node';
import { afterEach, describe, expect, it } from 'vitest';
import { startCore, type CoreServer } from '../src/index.ts';
import { tempHome } from './helpers.ts';

const cores: CoreServer[] = [];
afterEach(async () => {
  for (const c of cores.splice(0)) await c.close();
});

async function start(home: string): Promise<CoreServer> {
  const core = await startCore({
    home,
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
  return core;
}

function serverJson(home: string): { proofKey?: string } {
  return JSON.parse(readFileSync(join(home, 'server.json'), 'utf8')) as { proofKey?: string };
}

describe('proof of the core for the SSH tunnel (D-044, M3.6)', () => {
  it('answers a nonce with the HMAC of the key in server.json (600), new at every start', async () => {
    const home = tempHome();
    const core = await start(home);
    const { proofKey } = serverJson(home);
    expect(proofKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (process.platform !== 'win32') {
      expect(statSync(join(home, 'server.json')).mode & 0o777).toBe(0o600);
    }
    const nonce = newTunnelProofNonce();
    const body = (await (await fetch(`${core.url}/api/health?proof=${nonce}`)).json()) as {
      ok: boolean;
      proof?: string;
    };
    expect(body.ok).toBe(true);
    expect(checkTunnelProof(proofKey!, nonce, body.proof)).toBe(true);
    expect(checkTunnelProof(proofKey!, newTunnelProofNonce(), body.proof)).toBe(false);

    // Without a nonce, or with one that is not a nonce: the plain answer.
    expect(await (await fetch(`${core.url}/api/health`)).json()).not.toHaveProperty('proof');
    expect(await (await fetch(`${core.url}/api/health?proof=x`)).json()).not.toHaveProperty(
      'proof',
    );

    await core.close();
    cores.length = 0;
    const again = await start(home);
    expect(serverJson(home).proofKey).not.toBe(proofKey);
    const old = (await (await fetch(`${again.url}/api/health?proof=${nonce}`)).json()) as {
      proof?: string;
    };
    expect(checkTunnelProof(proofKey!, nonce, old.proof)).toBe(false);
  });
});
