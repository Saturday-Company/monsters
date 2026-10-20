import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tunnelProof } from '@monsters/shared/node';
import { run, verifyCore, type Io } from '../src/main.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function home() {
  const dir = mkdtempSync(join(tmpdir(), 'monsters-cli-'));
  dirs.push(dir);
  return join(dir, 'home');
}

function capture(): Io & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (l) => lines.push(l), err: (l) => errors.push(l) };
}

async function waitFor(check: () => boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('the CLI token goes only to the core of the data folder (B12)', () => {
  const KEY = 'k'.repeat(43);
  const url = 'http://127.0.0.1:4747';
  const answers = (key: string | null): typeof fetch =>
    ((input: string) => {
      const nonce = new URL(input).searchParams.get('proof');
      const body = { ok: true, ...(key && nonce ? { proof: tunnelProof(key, nonce) } : {}) };
      return Promise.resolve(new Response(JSON.stringify(body)));
    }) as unknown as typeof fetch;

  it('accepts the right proof; refuses a missing one, a wrong key or no key in server.json', async () => {
    const h = home();
    mkdirSync(h, { recursive: true });
    await expect(verifyCore(url, h, answers(KEY))).rejects.toThrow(/not running/);
    writeFileSync(join(h, 'server.json'), JSON.stringify({ url, proofKey: KEY }));
    await expect(verifyCore(url, h, answers(KEY))).resolves.toBeUndefined();
    await expect(verifyCore(url, h, answers(null))).rejects.toThrow(/not the Monsters core/);
    await expect(verifyCore(url, h, answers('x'.repeat(43)))).rejects.toThrow(
      /not the Monsters core/,
    );
    await expect(verifyCore(url, h, () => Promise.reject(new Error('down')))).rejects.toThrow(
      /not running/,
    );
    writeFileSync(join(h, 'server.json'), JSON.stringify({ url }));
    await expect(verifyCore(url, h, answers(KEY))).rejects.toThrow(/no proof key/);
  });
});

describe('monsters CLI', () => {
  it('prints help and rejects unknown commands', async () => {
    const io = capture();
    expect(await run(['help'], io)).toBe(0);
    expect(io.lines.join('\n')).toMatch(/Usage: monsters/);
    expect(await run(['explode'], io)).toBe(2);
    expect(await run(['--nope'], io)).toBe(2);
  });

  it('secrets: tells where the keys are (files under MONSTERS_SECRETS=file in tests)', async () => {
    const h = home();
    const io = capture();
    expect(await run(['secrets', '--home', h], io)).toBe(0);
    const text = io.lines.join('\n');
    expect(text).toMatch(/protected files \(mode 600\), not in the keychain/);
    expect(text).toMatch(/MONSTERS_SECRETS=file/);
    expect(await run(['secrets', 'rotate', '--home', h], io)).toBe(2);
  });

  it('reports a clear error when the core is not running', async () => {
    const io = capture();
    expect(await run(['status', '--home', home()], io)).toBe(1);
    expect(io.errors.join('\n')).toMatch(/start the core first|not running/);
  });

  it('start, status, kill, resume against a real core', async () => {
    const h = home();
    const stop = new AbortController();
    const startIo = capture();
    const started = run(['start', '--home', h, '--port', '0'], startIo, stop.signal);
    await waitFor(() => existsSync(join(h, 'server.json')));
    const info = JSON.parse(readFileSync(join(h, 'server.json'), 'utf8')) as { url: string };
    expect(startIo.lines[0]).toContain(info.url);
    // No account yet: the one-time setup code is printed (and kept in setup-code, mode 600).
    const code = readFileSync(join(h, 'setup-code'), 'utf8').trim();
    expect(startIo.lines.join('\n')).toContain(`Setup code: ${code}`);

    const io = capture();
    expect(await run(['status', '--home', h], io)).toBe(0);
    expect(io.lines.join('\n')).toMatch(/Kill switch: off/);

    // Automations (D-094): none yet; running one that is not there is an error of the core.
    expect(await run(['automations', '--home', h], io)).toBe(0);
    expect(io.lines.at(-1)).toBe('Nessuna automazione.');
    const missing = capture();
    expect(await run(['automations', 'run', 'nessuna', '--home', h], missing)).toBe(1);
    expect(missing.errors.join('\n')).toMatch(/automazione/);
    expect(await run(['automations', 'explode', '--home', h], missing)).toBe(2);

    expect(await run(['kill', '--home', h, '--reason', 'cli test'], io)).toBe(0);
    expect(io.lines.join('\n')).toMatch(/Stopped\. Runs aborted: 0/);

    const json = capture();
    expect(await run(['status', '--home', h, '--json'], json)).toBe(0);
    expect(JSON.parse(json.lines[0] ?? '{}')).toMatchObject({
      halted: true,
      haltedReason: 'cli test',
    });

    expect(await run(['resume', '--home', h], io)).toBe(0);
    expect(io.lines.at(-1)).toMatch(/Resumed/);
    expect(await run(['resume', '--home', h], io)).toBe(0);
    expect(io.lines.at(-1)).toMatch(/was not stopped/);

    stop.abort();
    expect(await started).toBe(0);
    expect(existsSync(join(h, 'server.json'))).toBe(false);
    // A clean stop revokes the CLI token.
    expect(existsSync(join(h, 'cli-token'))).toBe(false);
    expect(existsSync(join(h, 'setup-code'))).toBe(false);
    // Two real starts of the core: about 4.5 s on a Windows runner.
  }, 20_000);
});
