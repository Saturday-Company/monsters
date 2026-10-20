import { ProviderRegistry } from '@monsters/providers';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FILE_CONTENT_PATH,
  HTML_FILE_CSP,
  INERT_FILE_CSP,
  INERT_HTML_CSP,
  LOCKDOWN_SCRIPT,
  fileContentBody,
  WEB_UI_CSP,
  fileContentHeaders,
  startCore,
  type CoreServer,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';

/*
 * Headers of the bytes of a file (`GET /api/files/:id/content`, D-075): served
 * from the core's origin, they never run there; HTML runs only in an opaque
 * sandbox without network, framed only by the core's own pages.
 */

describe('fileContentHeaders', () => {
  it('HTML: scripts in an opaque sandbox, no network, framed only by the core', () => {
    const h = fileContentHeaders({ mime: 'text/html; charset=utf-8', name: 'grafico.html' });
    expect(h['Content-Security-Policy']).toBe(HTML_FILE_CSP);
    expect(HTML_FILE_CSP).toMatch(/^sandbox allow-scripts; default-src 'none';/);
    expect(HTML_FILE_CSP).not.toContain('allow-same-origin');
    expect(HTML_FILE_CSP).not.toMatch(/connect-src|'self' 'unsafe|https:/);
    expect(HTML_FILE_CSP).toContain("frame-ancestors 'self'");
    expect(fileContentHeaders({ mime: 'application/xhtml+xml', name: 'a.xhtml' })).toMatchObject({
      'Content-Security-Policy': HTML_FILE_CSP,
    });
  });

  it('HTML: no frames, no workers, Trusted Types; a page of a tainted run without scripts (D-085)', () => {
    for (const d of [
      "frame-src 'none'",
      "child-src 'none'",
      "worker-src 'none'",
      "require-trusted-types-for 'script'",
      'trusted-types default',
    ]) {
      expect(HTML_FILE_CSP).toContain(d);
    }
    const inert = fileContentHeaders({ mime: 'text/html', name: 'a.html', inert: true });
    expect(inert['Content-Security-Policy']).toBe(INERT_HTML_CSP);
    expect(INERT_HTML_CSP).toMatch(/^sandbox; default-src 'none';/);
    expect(INERT_HTML_CSP).not.toContain('script');
    expect(inert['X-DNS-Prefetch-Control']).toBe('off');
  });

  it('the body of a scripted page has the lockdown first; inert pages and other files as they are', () => {
    const page = Buffer.from(
      '<!DOCTYPE html><p>x</p><iframe srcdoc="y"></iframe><script>1</script>',
    );
    const served = Buffer.from(
      fileContentBody({ mime: 'text/html; charset=utf-8' }, page),
    ).toString();
    expect(served.startsWith(`<!DOCTYPE html>${LOCKDOWN_SCRIPT}<p>x</p>`)).toBe(true);
    expect(served).toContain('<monsters-blocked-iframe srcdoc="y"></monsters-blocked-iframe>');
    expect(fileContentBody({ mime: 'text/html', inert: true }, page)).toBe(page);
    expect(fileContentBody({ mime: 'image/png' }, page)).toBe(page);
  });

  it('everything else, SVG included: a sandbox without scripts', () => {
    for (const mime of ['image/svg+xml', 'image/png', 'application/pdf', 'text/plain']) {
      const h = fileContentHeaders({ mime, name: 'x' });
      expect(h['Content-Security-Policy']).toBe(INERT_FILE_CSP);
    }
    expect(INERT_FILE_CSP).toMatch(/^sandbox; default-src 'none';/);
    expect(INERT_FILE_CSP).not.toContain('script-src');
  });

  it('the common headers, with the name encoded for the download', () => {
    expect(fileContentHeaders({ mime: 'image/png', name: 'Città "nuova".png' })).toEqual({
      'Content-Security-Policy': INERT_FILE_CSP,
      'X-Content-Type-Options': 'nosniff',
      'X-DNS-Prefetch-Control': 'off',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Disposition':
        'inline; filename="Citta _nuova_.png"; filename*=UTF-8\'\'Citt%C3%A0%20%22nuova%22.png',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'private, no-store',
    });
    const odd = fileContentHeaders({ mime: 'text/plain', name: "a\r\nb'(1)*.txt" });
    expect(odd['Content-Disposition']).toBe(
      "inline; filename=\"ab'(1)*.txt\"; filename*=UTF-8''ab%27%281%29%2A.txt",
    );
    expect(fileContentHeaders({ mime: 'text/plain', name: '日本' })['Content-Disposition']).toBe(
      'inline; filename="__"; filename*=UTF-8\'\'%E6%97%A5%E6%9C%AC',
    );
  });
});

describe('framing of the API answers', { timeout: 30_000 }, () => {
  const cores: CoreServer[] = [];
  afterEach(async () => {
    for (const c of cores.splice(0)) await c.close();
  });

  it('only the content of a file may be framed, by the core itself', async () => {
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
    const frame = async (path: string) =>
      (await fetch(`${core.url}${path}`)).headers.get('x-frame-options');
    expect(await frame('/api/files/01JFILE/content')).toBe('SAMEORIGIN');
    expect(await frame('/api/files/01JFILE')).toBe('DENY');
    expect(await frame('/api/files/01JFILE/thumb')).toBe('DENY');
    expect(await frame('/api/health')).toBe('DENY');
    expect(FILE_CONTENT_PATH.test('/api/files/a/b/content')).toBe(false);
  });

  it('the UI frames and runs workers only from the core; remote images allowed for the click', () => {
    expect(WEB_UI_CSP).toContain("img-src 'self' data: blob: https:");
    expect(WEB_UI_CSP).toContain("frame-src 'self'");
    expect(WEB_UI_CSP).toContain("worker-src 'self'");
    expect(WEB_UI_CSP).toContain("script-src 'self';");
    expect(WEB_UI_CSP).not.toMatch(/unsafe-eval|wasm-unsafe-eval/);
  });
});
