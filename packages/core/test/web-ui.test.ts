import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ProviderRegistry } from '@monsters/providers';
import { afterEach, describe, expect, it } from 'vitest';
import { WEB_UI_CSP, startCore, type CoreServer } from '../src/index.ts';
import { rawGet, tempHome } from './helpers.ts';

const cores: CoreServer[] = [];
afterEach(async () => {
  for (const c of cores.splice(0)) await c.close();
});

function writeDist(root: string): void {
  const files: Record<string, string> = {
    'index.html':
      '<!doctype html><title>Monsters</title><script type="module" src="/assets/index-abc123.js"></script>',
    'assets/index-abc123.js': 'console.log("ui")',
    'assets/index-abc123.css': 'body{}',
    'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

async function start(webDist: string | false): Promise<CoreServer> {
  const core = await startCore({
    home: tempHome(),
    port: 0,
    env: {},
    webDist,
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

// Each test starts a real core (database, vault with git, HTTP server): ~0.4 s
// on a free runner, but a busy Windows runner took 3-6 s per start and close,
// past the default 5 s.
const CORE_TIMEOUT = { timeout: 30_000 };

describe('web UI served by the core', CORE_TIMEOUT, () => {
  it('serves the shell, the hashed assets and the SPA routes with the right caching', async () => {
    const dist = join(tempHome(), 'dist');
    writeDist(dist);
    const core = await start(dist);
    expect(core.webUi?.available()).toBe(true);

    const index = await fetch(`${core.url}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(index.headers.get('cache-control')).toBe('no-cache');
    expect(index.headers.get('content-security-policy')).toBe(WEB_UI_CSP);
    expect(index.headers.get('x-frame-options')).toBe('DENY');
    expect(await index.text()).toContain('<title>Monsters</title>');

    // A route of the single-page app gets the same shell.
    const route = await fetch(`${core.url}/impostazioni`);
    expect(route.status).toBe(200);
    expect(await route.text()).toContain('<title>Monsters</title>');

    const js = await fetch(`${core.url}/assets/index-abc123.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(js.headers.get('content-security-policy')).toBeNull();

    const icon = await fetch(`${core.url}/favicon.svg`);
    expect(icon.headers.get('content-type')).toBe('image/svg+xml');
    expect(icon.headers.get('cache-control')).toBe('no-cache');

    // Revalidation with the ETag.
    const etag = index.headers.get('etag')!;
    const again = await fetch(`${core.url}/`, { headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);

    const head = await fetch(`${core.url}/assets/index-abc123.css`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('6');
  });

  it('never leaves the folder and keeps the API answers apart', async () => {
    const dist = join(tempHome(), 'dist');
    writeDist(dist);
    writeFileSync(join(dirname(dist), 'secret.txt'), 'no');
    const core = await start(dist);

    expect((await fetch(`${core.url}/assets/missing-123.js`)).status).toBe(404);
    expect((await fetch(`${core.url}/..%2fsecret.txt`)).status).toBe(404);
    expect((await fetch(`${core.url}/%2e%2e/secret.txt`)).status).toBe(404);

    const api = await fetch(`${core.url}/api/nope`);
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: 'not_found' });
    const health = await fetch(`${core.url}/api/health`);
    expect(health.headers.get('cache-control')).toBe('no-store');

    // Host checks still apply to the pages (DNS rebinding).
    const rebinding = await rawGet(core.port, '/', { host: 'evil.example' });
    expect(rebinding.status).toBe(403);
  });

  it('explains how to build the UI when the build is missing', async () => {
    const core = await start(join(tempHome(), 'no-dist'));
    expect(core.webUi?.available()).toBe(false);
    const res = await fetch(`${core.url}/`);
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('pnpm --filter @monsters/web build');
  });

  it('can be turned off', async () => {
    const core = await start(false);
    expect(core.webUi).toBeNull();
    expect((await fetch(`${core.url}/`)).status).toBe(404);
  });
});
