import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacySecretsAccount, SECRETS_SERVICE, secretsAccount } from '@monsters/core';
import type { DesktopToCoreMessage, KeychainReply } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { isKeyringBinary, isMonstersEntry } from '../src/keychain-helper/entries.ts';
import { runKeychainOp, type HelperRequest } from '../src/keychain-helper/index.ts';
import {
  KeychainHost,
  keyringNativePath,
  parseKeychainRequest,
  type HelperProcess,
} from '../src/main/keychain-host.ts';
import { CoreSupervisor, type CoreChild } from '../src/main/supervisor.ts';

/*
 * The core's keychain calls run by the app (S-M8: RunAsNode off, so the core cannot start the
 * app's binary as Node for its keychain helper any more): one utility process per call.
 */

class FakeHelper extends EventEmitter implements HelperProcess {
  static next = 5000;
  readonly pid = FakeHelper.next++;
  readonly got: HelperRequest[] = [];
  readonly answer: (r: HelperRequest) => unknown;
  constructor(answer: (r: HelperRequest) => unknown) {
    super();
    this.answer = answer;
  }
  postMessage(m: HelperRequest) {
    this.got.push(m);
    const reply = this.answer(m);
    if (reply !== undefined) queueMicrotask(() => this.emit('message', reply));
  }
  onMessage(l: (m: unknown) => void) {
    this.on('message', l);
  }
  onExit(l: (code: number) => void) {
    this.on('exit', l);
  }
  kill() {
    this.emit('exit', 0);
  }
}

function setup(answer: (r: HelperRequest) => unknown, nativePath: string | null = NATIVE) {
  const helpers: FakeHelper[] = [];
  const killed: number[] = [];
  const replies: KeychainReply[] = [];
  const host = new KeychainHost({
    fork: () => {
      const h = new FakeHelper(answer);
      helpers.push(h);
      return h;
    },
    nativePath: () => nativePath,
    forceKill: (pid) => {
      killed.push(pid);
      helpers.find((h) => h.pid === pid)?.emit('exit', 137);
    },
    timeoutMs: 200,
  });
  const session = host.open((m) => replies.push(m));
  return { helpers, killed, replies, session };
}

/** A Monsters entry (`secretsAccount` of some home), and another for the slow helper. */
const ACCOUNT = 'home-0123456789abcdef01234567';
const SLOW = 'home-89abcdef0123456789abcdef';
const NATIVE = '/core/node_modules/@napi-rs/keyring-linux-x64-gnu/keyring.linux-x64-gnu.node';
const linux = { platform: 'linux', arch: 'x64' } as const;

const tick = () => new Promise((r) => setTimeout(r, 0));
const store = new Map<string, string>();
const fakeKeyring = {
  Entry: class {
    readonly service: string;
    readonly account: string;
    constructor(service: string, account: string, options: unknown) {
      if ((options as { linux?: { store?: string } }).linux?.store !== 'secret-service') {
        throw new Error('not pinned to Secret Service');
      }
      this.service = service;
      this.account = account;
    }
    getPassword() {
      return store.get(`${this.service}/${this.account}`) ?? null;
    }
    setPassword(v: string) {
      store.set(`${this.service}/${this.account}`, v);
    }
    deleteCredential() {
      return store.delete(`${this.service}/${this.account}`);
    }
  },
};

describe('keychain helper (utility process)', () => {
  const req = (op: HelperRequest['op'], value?: string): HelperRequest => ({
    nativePath: NATIVE,
    op,
    service: 'Monsters',
    account: ACCOUNT,
    ...(value !== undefined ? { value } : {}),
  });

  it('gets, sets and deletes through the module, pinned to Secret Service', () => {
    const load = (p: string) => {
      expect(p).toBe(NATIVE);
      return fakeKeyring;
    };
    expect(runKeychainOp(req('get'), load, linux)).toEqual({ ok: true, value: null });
    expect(runKeychainOp(req('set', 'k3y'), load, linux)).toEqual({ ok: true, value: null });
    expect(runKeychainOp(req('get'), load, linux)).toEqual({ ok: true, value: 'k3y' });
    expect(runKeychainOp(req('delete'), load, linux)).toEqual({ ok: true, value: true });
    expect(runKeychainOp(req('delete'), load, linux)).toEqual({ ok: true, value: false });
  });

  it('says why: no module, or the store refused', () => {
    expect(
      runKeychainOp(
        req('get'),
        () => {
          throw new Error('Cannot find module');
        },
        linux,
      ),
    ).toEqual({ ok: false, kind: 'module', message: 'Cannot find module' });
    const locked = {
      Entry: class {
        getPassword(): string {
          throw new Error('the keyring is locked');
        }
      },
    };
    expect(runKeychainOp(req('get'), () => locked, linux)).toEqual({
      ok: false,
      kind: 'store',
      message: 'the keyring is locked',
    });
  });
});

describe('keychain host', () => {
  it('runs each call in a helper of its own, answers and kills it', async () => {
    const { helpers, killed, replies, session } = setup((r) => ({ ok: true, value: `v-${r.op}` }));
    expect(
      session.handle({
        type: 'keychain',
        id: 1,
        op: 'get',
        service: 'Monsters',
        account: ACCOUNT,
      }),
    ).toBe(true);
    await tick();
    expect(helpers).toHaveLength(1);
    // The module path is the app's (next to its core), never the core's say.
    expect(helpers[0]!.got).toEqual([
      {
        nativePath: NATIVE,
        op: 'get',
        service: 'Monsters',
        account: ACCOUNT,
      },
    ]);
    expect(replies).toEqual([{ type: 'keychain', id: 1, ok: true, value: 'v-get' }]);
    expect(killed).toEqual([helpers[0]!.pid]);
    // The value to store goes on the port, not on a command line.
    session.handle({
      type: 'keychain',
      id: 2,
      op: 'set',
      service: 'Monsters',
      account: ACCOUNT,
      value: 'secret',
    });
    await tick();
    expect(helpers[1]!.got[0]!.value).toBe('secret');
    // Messages that are not keychain ones are left to the supervisor.
    expect(session.handle({ type: 'ready' })).toBe(false);
    expect(session.handle(null)).toBe(false);
  });

  it('kills the helper when the core gives up, and answers nothing', async () => {
    const { helpers, killed, replies, session } = setup(() => undefined);
    session.handle({ type: 'keychain', id: 7, op: 'get', service: 'Monsters', account: ACCOUNT });
    expect(session.handle({ type: 'keychain-abort', id: 7 })).toBe(true);
    await tick();
    expect(killed).toEqual([helpers[0]!.pid]);
    expect(replies).toEqual([]);
  });

  it('a helper that dies or hangs gets an error answer', async () => {
    const { helpers, killed, replies, session } = setup(() => undefined);
    session.handle({ type: 'keychain', id: 1, op: 'get', service: 'Monsters', account: ACCOUNT });
    helpers[0]!.emit('exit', 6);
    expect(replies).toEqual([
      {
        type: 'keychain',
        id: 1,
        ok: false,
        message: 'portachiavi non raggiungibile: il processo è uscito (codice 6)',
      },
    ]);
    session.handle({ type: 'keychain', id: 2, op: 'get', service: 'Monsters', account: ACCOUNT });
    await new Promise((r) => setTimeout(r, 300));
    expect(replies[1]).toEqual({
      type: 'keychain',
      id: 2,
      ok: false,
      message: 'il portachiavi non ha risposto entro 0 s',
    });
    expect(killed).toContain(helpers[1]!.pid);
  });

  it('refuses malformed requests, a missing module and too many at once', () => {
    const refused = (raw: Record<string, unknown>) => {
      const parsed = parseKeychainRequest({ type: 'keychain', id: 1, ...raw });
      return parsed !== null && 'error' in parsed && parsed.id === 1;
    };
    expect(parseKeychainRequest({ type: 'keychain', id: 0, op: 'get' })).toBeNull();
    expect(refused({ op: 'list', service: 'Monsters', account: ACCOUNT })).toBe(true);
    expect(refused({ op: 'set', service: 'Monsters', account: ACCOUNT })).toBe(true);
    expect(refused({ op: 'get', service: 'Monsters', account: ACCOUNT, value: 'x' })).toBe(true);
    expect(refused({ op: 'get', service: '', account: ACCOUNT })).toBe(true);
    expect(
      refused({ op: 'set', service: 'Monsters', account: ACCOUNT, value: 'x'.repeat(70_000) }),
    ).toBe(true);
    expect(refused({ op: 'set', service: 'Monsters', account: ACCOUNT, value: 'x' })).toBe(false);

    const none = setup(() => ({ ok: true, value: null }), null);
    none.session.handle({
      type: 'keychain',
      id: 3,
      op: 'get',
      service: 'Monsters',
      account: ACCOUNT,
    });
    expect(none.helpers).toHaveLength(0);
    expect(none.replies).toEqual([
      { type: 'keychain', id: 3, ok: false, message: 'modulo del portachiavi non disponibile' },
    ]);

    const busy = setup(() => undefined);
    for (let id = 1; id <= 5; id++) {
      busy.session.handle({
        type: 'keychain',
        id,
        op: 'get',
        service: 'Monsters',
        account: ACCOUNT,
      });
    }
    expect(busy.helpers).toHaveLength(4);
    expect(busy.replies).toEqual([
      { type: 'keychain', id: 5, ok: false, message: 'troppe richieste al portachiavi' },
    ]);
    busy.session.close();
    expect(busy.killed).toHaveLength(4);
  });
});

class FakeCore extends EventEmitter implements CoreChild {
  readonly pid = 4242;
  readonly sent: DesktopToCoreMessage[] = [];
  postMessage(m: DesktopToCoreMessage) {
    this.sent.push(m);
  }
  kill() {
    this.emit('exit', 0);
  }
  onMessage(l: (m: unknown) => void) {
    this.on('message', l);
  }
  onExit(l: (code: number) => void) {
    this.on('exit', l);
  }
}

describe('supervisor and keychain', () => {
  it("answers the core's keychain calls while it starts, and kills them when it dies", async () => {
    const helpers: FakeHelper[] = [];
    const killed: number[] = [];
    const host = new KeychainHost({
      fork: () => {
        const h = new FakeHelper((r) =>
          r.account === SLOW ? undefined : { ok: true, value: 'key' },
        );
        helpers.push(h);
        return h;
      },
      nativePath: () => NATIVE,
      forceKill: (pid) => killed.push(pid),
    });
    const core = new FakeCore();
    const sup = new CoreSupervisor(() => core, {
      keychain: host,
      policy: { maxAttempts: 0, baseDelayMs: 1, maxDelayMs: 1, stableAfterMs: 1 },
    });
    sup.start();
    core.emit('message', {
      type: 'keychain',
      id: 1,
      op: 'get',
      service: 'Monsters',
      account: ACCOUNT,
    });
    await tick();
    expect(core.sent).toEqual([{ type: 'keychain', id: 1, ok: true, value: 'key' }]);
    expect(sup.state).toBe('starting');
    core.emit('message', {
      type: 'keychain',
      id: 2,
      op: 'get',
      service: 'Monsters',
      account: SLOW,
    });
    core.emit('exit', 1);
    expect(killed).toContain(helpers[1]!.pid);
    sup.removeAllListeners();
  });
});

describe('only the entries of Monsters, only the keyring binary (review of wave 5, n. 4, 10)', () => {
  it('the host refuses any other service or account, before a helper starts', async () => {
    const { helpers, replies, session } = setup(() => ({ ok: true, value: 'x' }));
    const others = [
      { service: 'com.apple.account.IdentityServices', account: ACCOUNT },
      { service: 'monsters', account: ACCOUNT },
      { service: 'Monsters', account: 'home-1' },
      { service: 'Monsters', account: `${ACCOUNT}x` },
      { service: 'Monsters', account: 'giulio@example.com' },
    ];
    others.forEach((o, i) => session.handle({ type: 'keychain', id: i + 1, op: 'get', ...o }));
    await tick();
    expect(helpers).toHaveLength(0);
    expect(replies.map((r) => (r.ok ? 'ok' : r.message))).toEqual(
      others.map(() => 'voce del portachiavi che non è di Monsters'),
    );
  });

  it('the helper refuses them too, and loads nothing but the platform binary', () => {
    const loaded: string[] = [];
    const load = (p: string) => {
      loaded.push(p);
      return fakeKeyring;
    };
    const base: HelperRequest = {
      nativePath: NATIVE,
      op: 'get',
      service: 'Monsters',
      account: ACCOUNT,
    };
    expect(runKeychainOp({ ...base, service: 'Other' }, load, linux)).toEqual({
      ok: false,
      kind: 'store',
      message: 'voce del portachiavi che non è di Monsters',
    });
    for (const nativePath of [
      '/core/node_modules/@napi-rs/keyring/index.js',
      'keyring.linux-x64-gnu.node',
      '/core/keyring.darwin-arm64.node',
    ]) {
      expect(runKeychainOp({ ...base, nativePath }, load, linux)).toMatchObject({
        ok: false,
        kind: 'module',
      });
    }
    expect(loaded).toEqual([]);
    expect(runKeychainOp(base, load, linux)).toEqual({ ok: true, value: null });
    expect(loaded).toEqual([NATIVE]);
  });

  it('checks the binary against the manifest right before loading it (review 19/10, n. 12)', async () => {
    const loaded: string[] = [];
    const load = (p: string) => {
      loaded.push(p);
      return fakeKeyring;
    };
    const base: HelperRequest = {
      nativePath: NATIVE,
      sha256: 'a'.repeat(64),
      op: 'get',
      service: 'Monsters',
      account: ACCOUNT,
    };
    // Changed after the check at the core's start: not loaded.
    expect(runKeychainOp(base, load, linux, () => 'b'.repeat(64))).toMatchObject({
      ok: false,
      kind: 'module',
    });
    expect(
      runKeychainOp(base, load, linux, () => {
        throw new Error('gone');
      }),
    ).toMatchObject({ ok: false, kind: 'module' });
    expect(loaded).toEqual([]);
    expect(runKeychainOp(base, load, linux, () => 'a'.repeat(64))).toEqual({
      ok: true,
      value: null,
    });
    expect(loaded).toEqual([NATIVE]);

    // The host passes the manifest's hash on, and refuses a binary the manifest does not list.
    const sent: HelperRequest[] = [];
    const replies: KeychainReply[] = [];
    let hash: string | null | undefined = 'c'.repeat(64);
    const host = new KeychainHost({
      fork: () => {
        const h = new FakeHelper((r) => {
          sent.push(r);
          return { ok: true, value: null };
        });
        return h;
      },
      nativePath: () => NATIVE,
      nativeHash: () => hash,
      forceKill: () => {},
    });
    const session = host.open((m) => replies.push(m));
    session.handle({ type: 'keychain', id: 1, op: 'get', service: 'Monsters', account: ACCOUNT });
    await tick();
    expect(sent[0]?.sha256).toBe('c'.repeat(64));
    hash = null;
    session.handle({ type: 'keychain', id: 2, op: 'get', service: 'Monsters', account: ACCOUNT });
    await tick();
    expect(sent).toHaveLength(1);
    expect(replies.find((r) => r.id === 2)).toMatchObject({ ok: false });
  });

  it('the accounts the core uses pass, whatever the home', () => {
    for (const home of ['/home/andrea/.monsters', 'C:\\Users\\Andrea\\.monsters', '/tmp/x y']) {
      expect(isMonstersEntry(SECRETS_SERVICE, secretsAccount(home))).toBe(true);
      expect(isMonstersEntry(SECRETS_SERVICE, legacySecretsAccount(home))).toBe(true);
    }
  });

  it('finds the binary of the platform package next to the core, never index.js', () => {
    // Real: the resolver gives back real paths (`/private/var/…` on macOS, long names on Windows).
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'monsters-keyring-')));
    try {
      const core = join(root, 'core');
      const main = join(core, 'node_modules', '@napi-rs', 'keyring');
      const native = join(core, 'node_modules', '@napi-rs', 'keyring-linux-x64-gnu');
      mkdirSync(main, { recursive: true });
      mkdirSync(native, { recursive: true });
      writeFileSync(join(core, 'monsters.js'), '');
      writeFileSync(join(main, 'package.json'), '{"name":"@napi-rs/keyring","main":"index.js"}');
      writeFileSync(join(main, 'index.js'), '');
      writeFileSync(
        join(native, 'package.json'),
        '{"name":"@napi-rs/keyring-linux-x64-gnu","main":"evil.js"}',
      );
      expect(keyringNativePath(join(core, 'monsters.js'), 'linux', 'x64')).toBeNull();
      writeFileSync(join(native, 'keyring.linux-x64-gnu.node'), '');
      expect(keyringNativePath(join(core, 'monsters.js'), 'linux', 'x64')).toBe(
        join(native, 'keyring.linux-x64-gnu.node'),
      );
      expect(keyringNativePath(join(core, 'monsters.js'), 'linux', 'ia32')).toBeNull();
      expect(isKeyringBinary(join(native, 'keyring.linux-x64-gnu.node'), 'linux', 'x64')).toBe(
        true,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
