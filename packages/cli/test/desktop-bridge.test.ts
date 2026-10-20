import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOGIN_EXCHANGE_PATH, type CoreToDesktopMessage } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { KeychainUnavailableError } from '@monsters/core';
import { desktopKeychain, type ParentPort } from '../src/desktop-bridge.ts';
import { run, type Io } from '../src/main.ts';

/* `monsters start` inside the desktop app's utility process (M3.1, D-045), with a fake port. */

const dirs: string[] = [];
afterEach(() => {
  delete (process as { parentPort?: unknown }).parentPort;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function home() {
  const dir = mkdtempSync(join(tmpdir(), 'monsters-bridge-'));
  dirs.push(dir);
  return join(dir, 'home');
}

const quiet: Io = { out: () => {}, err: () => {} };

class FakePort implements ParentPort {
  readonly sent: CoreToDesktopMessage[] = [];
  readonly listeners = new Set<(event: { data: unknown }) => void>();
  postMessage(message: unknown) {
    this.sent.push(message as CoreToDesktopMessage);
  }
  on(_event: 'message', listener: (event: { data: unknown }) => void) {
    this.listeners.add(listener);
  }
  off(_event: 'message', listener: (event: { data: unknown }) => void) {
    this.listeners.delete(listener);
  }
  send(data: unknown) {
    for (const l of this.listeners) l({ data });
  }
  async next<T extends CoreToDesktopMessage['type']>(type: T) {
    const start = Date.now();
    for (;;) {
      const found = this.sent.find((m) => m.type === type);
      if (found) return found as Extract<CoreToDesktopMessage, { type: T }>;
      if (Date.now() - start > 10_000) throw new Error(`no ${type} message`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

describe('desktop bridge', () => {
  it('announces the core, issues login tokens and stops on request', async () => {
    const port = new FakePort();
    (process as { parentPort?: unknown }).parentPort = port;
    const h = home();
    const started = run(['start', '--home', h, '--port', '0'], quiet);

    const ready = await port.next('ready');
    expect(ready.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(ready.home).toBe(h);
    expect(ready.setupCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    // Garbage is ignored; a request gets a token, here exchanged before any account exists.
    port.send({ type: 'login-token', id: 'x' });
    port.send({ type: 'login-token', id: 7 });
    const answer = await port.next('login-token');
    expect(answer.id).toBe(7);
    expect(answer.token).toBeTruthy();
    const res = await fetch(`${ready.url}${LOGIN_EXCHANGE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-monsters-request': '1' },
      body: JSON.stringify({ token: answer.token }),
    });
    expect(res.status).toBe(409);

    port.send({ type: 'stop' });
    expect(await started).toBe(0);
    expect(port.listeners.size).toBe(0);
  });

  it('hears "stop" while the core is still starting: no core is left running', async () => {
    const port = new FakePort();
    (process as { parentPort?: unknown }).parentPort = port;
    const h = home();
    const started = run(['start', '--home', h, '--port', '0'], quiet);
    // The app quits during the start (login shell, keychain prompt…): it sends "stop" at once.
    while (port.listeners.size === 0) await new Promise((r) => setTimeout(r, 1));
    port.send({ type: 'stop' });
    expect(await started).toBe(0);
    expect(port.sent.filter((m) => m.type === 'ready')).toEqual([]);
    expect(port.listeners.size).toBe(0);
    expect(existsSync(join(h, 'server.json'))).toBe(false);
    // The home is free again: a new start works.
    delete (process as { parentPort?: unknown }).parentPort;
    const again = new AbortController();
    const second = run(['start', '--home', h, '--port', '0'], quiet, again.signal);
    while (!existsSync(join(h, 'server.json'))) await new Promise((r) => setTimeout(r, 20));
    again.abort();
    expect(await second).toBe(0);
  });

  it('a stop asked before the start began is not lost', async () => {
    const stop = new AbortController();
    stop.abort();
    const h = home();
    expect(await run(['start', '--home', h, '--port', '0'], quiet, stop.signal)).toBe(0);
    expect(existsSync(join(h, 'server.json'))).toBe(false);
  });

  it("asks the app for the keychain (the app's binary is never a Node, S-M8)", async () => {
    const port = new FakePort();
    const entries = new Map<string, string>();
    // The app's side: each call answered from memory, as keychain-host.ts would from a helper.
    port.postMessage = (message: unknown) => {
      const m = message as CoreToDesktopMessage;
      port.sent.push(m);
      if (m.type !== 'keychain') return;
      const key = `${m.service}/${m.account}`;
      const value =
        m.op === 'get'
          ? (entries.get(key) ?? null)
          : m.op === 'set'
            ? (entries.set(key, m.value ?? ''), null)
            : entries.delete(key);
      queueMicrotask(() => port.send({ type: 'keychain', id: m.id, ok: true, value }));
    };
    (process as { parentPort?: unknown }).parentPort = port;
    const before = process.env['MONSTERS_SECRETS'];
    process.env['MONSTERS_SECRETS'] = 'keychain';
    try {
      const h = home();
      const started = run(['start', '--home', h, '--port', '0'], quiet);
      await port.next('ready');
      const calls = port.sent.filter((m) => m.type === 'keychain');
      expect(calls.map((m) => m.op)).toEqual(expect.arrayContaining(['get', 'set']));
      // A new master key, stored in the app's keychain and nowhere on the command line.
      expect([...entries.values()]).toHaveLength(1);
      expect(calls.find((m) => m.op === 'set')?.value).toBe([...entries.values()][0]);
      port.send({ type: 'stop' });
      expect(await started).toBe(0);
      expect(port.listeners.size).toBe(0);
    } finally {
      if (before === undefined) delete process.env['MONSTERS_SECRETS'];
      else process.env['MONSTERS_SECRETS'] = before;
    }
  });

  it('a keychain call the core gives up on is dropped and the app told', async () => {
    const port = new FakePort();
    const keychain = desktopKeychain(port, 'Test');
    const stop = new AbortController();
    const pending = keychain.get('S', 'a', stop.signal);
    expect(port.listeners.size).toBe(1);
    stop.abort();
    await expect(pending).rejects.toThrow('aborted');
    expect(port.sent).toEqual([
      { type: 'keychain', id: 1, op: 'get', service: 'S', account: 'a' },
      { type: 'keychain-abort', id: 1 },
    ]);
    expect(port.listeners.size).toBe(0);
    // An error of the app's helper is a keychain that cannot be used, not a crash.
    const failing = keychain.set('S', 'a', 'v', new AbortController().signal);
    port.send({ type: 'keychain', id: 2, ok: false, message: 'locked' });
    await expect(failing).rejects.toBeInstanceOf(KeychainUnavailableError);
    // Answers to calls nobody waits for are ignored.
    port.send({ type: 'keychain', id: 99, ok: true, value: 'x' });
    expect(port.listeners.size).toBe(0);
  });

  it('reports why the core did not start', async () => {
    const h = home();
    const first = new AbortController();
    const running = run(['start', '--home', h, '--port', '0'], quiet, first.signal);
    const port = new FakePort();
    // Wait for the first core to own the home.
    while (!existsSync(join(h, 'server.json'))) await new Promise((r) => setTimeout(r, 20));
    (process as { parentPort?: unknown }).parentPort = port;
    expect(await run(['start', '--home', h, '--port', '0'], quiet)).toBe(1);
    expect(port.sent).toEqual([
      expect.objectContaining({ type: 'start-failed', code: 'home_locked' }),
    ]);
    first.abort();
    expect(await running).toBe(0);
  });
});
