import { readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DesktopLog, redact } from '../src/main/desktop-log.ts';
import {
  externalUrl,
  navigationVerdict,
  permissionAllowed,
  WEBRTC_IP_POLICY,
  windowOpenVerdict,
} from '../src/main/navigation.ts';
import { statusCopy, statusPageHtml, statusPageUrl } from '../src/main/status-page.ts';
import { fitWindowState, parseWindowState } from '../src/main/window-state.ts';
import { tempDir } from './helpers.ts';

const CORE = 'http://127.0.0.1:4747';

describe('navigation policy', () => {
  it('lets the window move only inside the core', () => {
    expect(navigationVerdict(`${CORE}/impostazioni`, CORE)).toEqual({ action: 'allow' });
    expect(navigationVerdict(`${CORE}/#/log`, CORE)).toEqual({ action: 'allow' });
    // Same host, other port; localhost for 127.0.0.1: not the core.
    expect(navigationVerdict('http://127.0.0.1:4748/', CORE)).toEqual({ action: 'deny' });
    expect(navigationVerdict('http://localhost:4747/', CORE)).toEqual({ action: 'deny' });
    expect(navigationVerdict('http://[::1]:80/', CORE)).toEqual({ action: 'deny' });
    expect(navigationVerdict('http://foo.localhost/', CORE)).toEqual({ action: 'deny' });
    // No core shown (status page): nothing is the core.
    expect(navigationVerdict(`${CORE}/`, null)).toEqual({ action: 'deny' });
  });

  it('sends web links to the browser and drops everything else', () => {
    expect(navigationVerdict('https://openrouter.ai/keys', CORE)).toEqual({
      action: 'external',
      url: 'https://openrouter.ai/keys',
    });
    expect(navigationVerdict('http://example.com', CORE)).toEqual({
      action: 'external',
      url: 'http://example.com/',
    });
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'vscode://open',
      'smb://server/share',
      'https://user:pw@example.com/',
      'not a url',
      'chrome://settings',
    ]) {
      expect(navigationVerdict(url, CORE)).toEqual({ action: 'deny' });
    }
    expect(externalUrl('HTTPS://Example.COM/a b')).toBe('https://example.com/a%20b');
  });

  it('never opens a window, not even on the core', () => {
    expect(windowOpenVerdict(`${CORE}/`, CORE)).toEqual({ action: 'deny' });
    expect(windowOpenVerdict('https://example.com/', CORE)).toEqual({
      action: 'external',
      url: 'https://example.com/',
    });
  });

  it('denies permissions except clipboard writes and fullscreen from the core', () => {
    expect(permissionAllowed('clipboard-sanitized-write', `${CORE}/`, CORE)).toBe(true);
    expect(permissionAllowed('fullscreen', CORE, CORE)).toBe(true);
    for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal'])
      expect(permissionAllowed(p, `${CORE}/`, CORE)).toBe(false);
    expect(permissionAllowed('clipboard-sanitized-write', 'https://evil.example/', CORE)).toBe(
      false,
    );
  });
});

describe('window state', () => {
  const screen = { x: 0, y: 0, width: 1920, height: 1050 };
  it('parses and validates', () => {
    expect(parseWindowState(null)).toBeNull();
    expect(parseWindowState('{')).toBeNull();
    expect(parseWindowState('{"width":"x","height":2}')).toBeNull();
    expect(parseWindowState('{"x":10,"y":20,"width":1000,"height":700,"maximized":true}')).toEqual({
      x: 10,
      y: 20,
      width: 1000,
      height: 700,
      maximized: true,
    });
  });

  it('keeps a visible position, drops one off screen, shrinks to the screen', () => {
    expect(
      fitWindowState({ x: 100, y: 50, width: 1000, height: 700, maximized: false }, [screen]),
    ).toEqual({ x: 100, y: 50, width: 1000, height: 700, maximized: false });
    // The monitor on the right was unplugged.
    expect(
      fitWindowState({ x: 2500, y: 50, width: 1000, height: 700, maximized: false }, [screen]),
    ).toEqual({ width: 1000, height: 700, maximized: false });
    expect(fitWindowState({ width: 4000, height: 3000, maximized: false }, [screen])).toEqual({
      width: 1920,
      height: 1050,
      maximized: false,
    });
    expect(fitWindowState({ width: 100, height: 100, maximized: false }, [screen])).toEqual({
      width: 720,
      height: 560,
      maximized: false,
    });
    expect(fitWindowState(null, [screen])).toEqual({ width: 1280, height: 840, maximized: false });
  });
});

describe('desktop log', () => {
  it('hides setup codes and tokens', () => {
    expect(
      redact(
        'No account yet: create it with this one-time setup code:\n  Setup code: ABCD-EFGH-JKMN',
      ),
    ).toBe('No account yet: create it with this one-time setup code:\n  Setup code: [nascosto]');
    expect(redact('token=abcdefghijklmnopqrstuvwxyz012345')).toBe('token=[nascosto]');
    expect(redact('Authorization: Bearer abc.def')).toBe('Authorization: Bearer [nascosto]');
  });

  it('writes private lines and rotates', () => {
    const path = `${tempDir()}/logs/desktop.log`;
    const log = new DesktopLog(path, { maxBytes: 200 });
    log.info('primo\nsecondo');
    log.write('core', 'Setup code: ABCD-EFGH-JKMN');
    const text = readFileSync(path, 'utf8');
    expect(text).toMatch(
      /\[app\] primo\n.*\[app\] secondo\n.*\[core\] Setup code: \[nascosto\]\n$/,
    );
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    }
    for (let i = 0; i < 10; i++) log.info(`riga ${i}`);
    expect(readFileSync(`${path}.1`, 'utf8')).toContain('[app]');
    expect(statSync(path).size).toBeLessThan(400);
  });
});

describe('status page', () => {
  it('speaks Italian and keeps a strict CSP', () => {
    expect(
      statusCopy({ kind: 'restarting', attempt: 2, maxAttempts: 5, delayMs: 2000 }).body[0],
    ).toBe('Lo riavvio tra 2 secondi (tentativo 2 di 5).');
    const html = statusPageHtml({ kind: 'failed', logPath: '/h/<x>/desktop.log' });
    expect(html).toContain('lang="it"');
    expect(html).toContain('Riprova');
    expect(html).toContain('/h/&#60;x&#62;/desktop.log');
    expect(html).toMatch(/default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-/);
    expect(html).not.toContain('unsafe-eval');
    // Starting: "Connessioni…" is there too (audit UX 1.2), still a script allowed by hash only.
    expect(statusPageHtml({ kind: 'starting' })).toContain('data-action="connections"');
    expect(statusPageUrl({ kind: 'starting' })).toMatch(/^data:text\/html;charset=utf-8;base64,/);
  });
});

describe('WebRTC of the pages (D-085)', () => {
  it('is the strictest policy, set on every web contents the app creates', () => {
    expect(WEBRTC_IP_POLICY).toBe('disable_non_proxied_udp');
    const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
    const hook = main.slice(main.indexOf("app.on('web-contents-created'"));
    expect(hook.slice(0, hook.indexOf('\n  });'))).toContain(
      'contents.setWebRTCIPHandlingPolicy(WEBRTC_IP_POLICY)',
    );
    // Registered in start() before the first window is made.
    const start = main.slice(main.indexOf('async function start()'));
    expect(start.indexOf("app.on('web-contents-created'")).toBeGreaterThan(0);
    expect(start.indexOf("app.on('web-contents-created'")).toBeLessThan(
      start.indexOf('win = createWindow('),
    );
  });
});
