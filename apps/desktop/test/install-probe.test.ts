import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopLog, hasStartedLine, startedLine } from '../src/main/desktop-log.ts';
import { tempDir } from './helpers.ts';

const PROBE = resolve(import.meta.dirname, '..', 'scripts', 'install-probe.mjs');

describe('the line install-test.ts waits for (macOS without a graphical session)', () => {
  it('is in desktop.log once start() ran, not before', () => {
    const home = tempDir();
    const file = join(home, 'logs', 'desktop.log');
    const log = new DesktopLog(file);
    // What a Mac without a graphical session leaves: Electron never gets to `ready`.
    log.info('DevTools protocol on (throwaway data directory)');
    expect(hasStartedLine(readFileSync(file, 'utf8'))).toBe(false);
    log.info(startedLine('0.1.0-alpha.3', '44.7.1', '/Users/x/Library/Application Support/M'));
    expect(hasStartedLine(readFileSync(file, 'utf8'))).toBe(true);
  });

  it('is not matched by the core output', () => {
    expect(
      hasStartedLine(
        '2026-10-15T19:51:13.719Z [core] Monsters desktop 0.1.0 (Electron 1), data /h\n',
      ),
    ).toBe(false);
  });
});

/** A fake first-start core: server.json in `home`, health, setup status, setup. */
function fakeCore(home: string, version: string): Promise<{ server: Server; setups: unknown[] }> {
  const setups: unknown[] = [];
  let hasAccount = false;
  const server = createServer((req, res) => {
    const json = (body: unknown) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (req.url === '/api/health') return json({ ok: true, version });
    if (req.url === '/api/setup-status') return json({ needsSetup: !hasAccount });
    if (req.url === '/api/setup' && req.method === 'POST') {
      let body = '';
      req.on('data', (d: Buffer) => (body += d.toString()));
      req.on('end', () => {
        setups.push({ header: req.headers['x-monsters-request'], ...JSON.parse(body) });
        hasAccount = true;
        json({ ok: true });
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, 'setup-code'), 'ABCD-1234\n');
      writeFileSync(join(home, 'server.json'), JSON.stringify({ url: `http://127.0.0.1:${port}` }));
      ok({ server, setups });
    }),
  );
}

function probe(args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((ok) => {
    execFile(process.execPath, [PROBE, ...args], (err, stdout, stderr) => {
      ok({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: stdout + stderr });
    });
  });
}

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

describe('install-probe.mjs --window none (the core without the app)', () => {
  it('checks the core and the first start, registers through the API, exits 3', async () => {
    const home = tempDir();
    const core = await fakeCore(home, '0.1.0');
    server = core.server;
    const { code, out } = await probe([
      '--home',
      home,
      '--version',
      '0.1.0',
      '--window',
      'none',
      '--timeout',
      '10',
    ]);
    expect(out).toContain('core healthy');
    expect(out).toContain('no app window in this run (--window none): the window is NOT verified');
    expect(out).toContain('OK, window NOT verified');
    expect(code).toBe(3);
    expect(core.setups).toEqual([
      {
        header: '1',
        email: 'ci@monsters.invalid',
        password: 'ci-install-probe-password',
        setupCode: 'ABCD-1234',
      },
    ]);
  });

  it('fails on a core of another version', async () => {
    const home = tempDir();
    server = (await fakeCore(home, '0.0.9')).server;
    const { code, out } = await probe(['--home', home, '--version', '0.1.0', '--window', 'none']);
    expect(code).toBe(1);
    expect(out).toContain('the core reports version 0.0.9, the package is 0.1.0');
  });

  it('still wants --cdp for the window modes, and a known mode', async () => {
    const home = tempDir();
    expect((await probe(['--home', home, '--version', '0.1.0'])).code).toBe(2);
    const bad = await probe(['--home', home, '--version', '0.1.0', '--window', 'maybe']);
    expect(bad.code).toBe(2);
  });
});
