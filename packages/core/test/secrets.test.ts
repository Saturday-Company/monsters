import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FileSecretStore,
  KeychainAbortedError,
  KeychainSecretStore,
  exportSecretsToFiles,
  inspectSecrets,
  loadNativeKeychain,
  openSecretStore,
  readMcpSecrets,
  readOpenRouterKey,
  readProviderKey,
  registerSecretStore,
  removeProviderKey,
  saveMcpSecrets,
  saveProviderKey,
  secretStoreFor,
  secretsAccount,
  secretsMode,
  type Keychain,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { startTestHub } from './hub-helpers.ts';

const posix = process.platform !== 'win32';
const SERVICE = 'Monsters-test';
const OPENROUTER = 'sk-or-v1-0123456789abcdef0123456789abcdef';
const BRAVE = 'BSA-brave-key-0123456789';
const MCP = { env: { GITHUB_TOKEN: 'ghp_secret_token_value_123' }, headers: {} };

/** In-memory keychain: entries by service and account, with failure modes. */
class FakeKeychain implements Keychain {
  readonly name = 'Portachiavi finto';
  readonly entries = new Map<string, string>();
  calls = 0;
  /** `hang`: never answers (locked keyring waiting for a password). */
  mode: 'ok' | 'hang' | 'fail' | 'lose-writes' = 'ok';

  #k(service: string, account: string): string {
    return `${service}\u0000${account}`;
  }

  #gate(): Promise<void> {
    this.calls++;
    if (this.mode === 'hang') return new Promise(() => {});
    if (this.mode === 'fail') return Promise.reject(new Error('Secret Service: no result found'));
    return Promise.resolve();
  }

  async get(service: string, account: string): Promise<string | null> {
    await this.#gate();
    return this.entries.get(this.#k(service, account)) ?? null;
  }

  async set(service: string, account: string, value: string): Promise<void> {
    await this.#gate();
    if (this.mode !== 'lose-writes') this.entries.set(this.#k(service, account), value);
  }

  async delete(service: string, account: string): Promise<boolean> {
    await this.#gate();
    return this.entries.delete(this.#k(service, account));
  }
}

function secretsDir(home: string): string {
  return join(home, 'secrets');
}

/** Writes secrets the way the file backend of earlier versions did. */
function writePlain(home: string, files: Record<string, string>): void {
  const dir = secretsDir(home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(dir, name), value, { mode: 0o600 });
  }
}

/** Every byte under `secrets/`, recursively: no secret may appear in it in clear. */
function diskText(home: string): string {
  const dir = secretsDir(home);
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => readFileSync(join(e.parentPath, e.name), 'utf8'))
    .join('\n');
}

function open(home: string, keychain: Keychain, extra: { timeoutMs?: number } = {}) {
  return openSecretStore({ home, mode: 'auto', keychain, service: SERVICE, ...extra });
}

describe('secret store: keychain backend', () => {
  it('migrates plain secrets: encrypted, verified, plain copies removed', async () => {
    const home = tempHome();
    writePlain(home, {
      'openrouter.key': `${OPENROUTER}\n`,
      'brave.key': `${BRAVE}\n`,
      'mcp-github.json': JSON.stringify(MCP),
    });
    const keychain = new FakeKeychain();
    const { store, migrated } = await open(home, keychain);

    expect(store.backend).toBe('keychain');
    expect(migrated).toEqual(['brave.key', 'mcp-github.json', 'openrouter.key']);
    expect(readdirSync(secretsDir(home)).sort()).toEqual([
      'brave.key.enc',
      'mcp-github.json.enc',
      'openrouter.key.enc',
    ]);
    const disk = diskText(home);
    for (const secret of [OPENROUTER, BRAVE, MCP.env.GITHUB_TOKEN]) {
      expect(disk).not.toContain(secret);
    }
    if (posix) {
      expect(statSync(join(secretsDir(home), 'brave.key.enc')).mode & 0o777).toBe(0o600);
    }
    expect(store.read('openrouter.key')).toBe(`${OPENROUTER}\n`);
    expect(JSON.parse(store.read('mcp-github.json') ?? '')).toEqual(MCP);
    expect(store.status()).toEqual({
      backend: 'keychain',
      reason: 'keychain',
      keychain: 'Portachiavi finto',
      unreadable: [],
    });
    // One entry in the keychain: the master key of this home.
    expect([...keychain.entries.keys()]).toEqual([`${SERVICE}\u0000${secretsAccount(home)}`]);
  });

  it('is idempotent: a second start reuses the key and finds nothing to migrate', async () => {
    const home = tempHome();
    writePlain(home, { 'brave.key': BRAVE });
    const keychain = new FakeKeychain();
    await open(home, keychain);
    const key = [...keychain.entries.values()][0];

    const again = await open(home, keychain);
    expect(again.migrated).toEqual([]);
    expect([...keychain.entries.values()]).toEqual([key]);
    expect(again.store.read('brave.key')).toBe(BRAVE);
    expect(again.store.status().quarantined).toBeUndefined();
  });

  it('recovers an interrupted migration: plain copy wins, stale temp files go', async () => {
    const home = tempHome();
    const keychain = new FakeKeychain();
    const first = await open(home, keychain);
    first.store.write('brave.key', 'old-value');
    // Crash after writing the encrypted copy but before removing the plain one, while a
    // newer plain value was saved (e.g. during a file fallback), plus a half-written temp.
    writePlain(home, { 'brave.key': BRAVE, 'openrouter.key.12345.tmp': 'partial' });

    const { store, migrated } = await open(home, keychain);
    expect(migrated).toEqual(['brave.key']);
    expect(store.read('brave.key')).toBe(BRAVE);
    expect(readdirSync(secretsDir(home))).toEqual(['brave.key.enc']);
  });

  it('a plain file dropped by hand while running is encrypted at the first read', async () => {
    const home = tempHome();
    const { store } = await open(home, new FakeKeychain());
    writePlain(home, { 'typesafe.key': 'ts-key-1234567890' });
    expect(store.read('typesafe.key')).toBe('ts-key-1234567890');
    expect(readdirSync(secretsDir(home))).toEqual(['typesafe.key.enc']);
  });

  it('one account per folder whatever the case of its path (macOS, Windows)', async () => {
    // A case-insensitive file system: the system gives back one spelling for both.
    const canonical = (p: string) => p.replace(/monsters-home/i, 'Monsters-Home');
    expect(secretsAccount('/Users/g/monsters-home', canonical)).toBe(
      secretsAccount('/Users/g/MONSTERS-HOME', canonical),
    );
    expect(secretsAccount('/Users/g/a')).not.toBe(secretsAccount('/Users/g/b'));

    // A key saved by M3.2 under the account of the path as typed is still found.
    const home = tempHome();
    const keychain = new FakeKeychain();
    (await open(home, keychain)).store.write('brave.key', BRAVE);
    const [entry] = [...keychain.entries.entries()];
    keychain.entries.clear();
    keychain.entries.set(`${SERVICE}\u0000home-legacy`, entry![1]);
    const { store } = await openSecretStore({
      home,
      mode: 'auto',
      keychain,
      service: SERVICE,
      legacyAccount: 'home-legacy',
    });
    expect(store.backend).toBe('keychain');
    expect(store.read('brave.key')).toBe(BRAVE);
    expect(keychain.entries.size).toBe(1);
  });

  it('keeps homes apart: different accounts, a file copied across cannot be opened', async () => {
    const a = tempHome();
    const b = tempHome();
    const keychain = new FakeKeychain();
    const sa = (await open(a, keychain)).store;
    const sb = (await open(b, keychain)).store;
    expect(secretsAccount(a)).not.toBe(secretsAccount(b));
    expect(keychain.entries.size).toBe(2);

    sa.write('brave.key', BRAVE);
    cpSync(join(secretsDir(a), 'brave.key.enc'), join(secretsDir(b), 'brave.key.enc'));
    expect(sb.read('brave.key')).toBeNull();
    expect(sb.status().unreadable).toEqual(['brave.key']);
  });

  it('detects tampering (GCM): damaged or swapped files read as missing, never crash', async () => {
    const home = tempHome();
    const { store } = await open(home, new FakeKeychain());
    store.write('brave.key', BRAVE);
    store.write('openrouter.key', OPENROUTER);
    const dir = secretsDir(home);

    // Flip one bit of the ciphertext.
    const path = join(dir, 'brave.key.enc');
    const parts = readFileSync(path, 'utf8').trim().split(':');
    const data = Buffer.from(parts.at(-1) ?? '', 'base64');
    data[0] = (data[0] ?? 0) ^ 1;
    writeFileSync(path, `${[...parts.slice(0, -1), data.toString('base64')].join(':')}\n`);
    expect(store.read('brave.key')).toBeNull();

    // A valid file of another secret copied over this one (bound to its name).
    cpSync(join(dir, 'openrouter.key.enc'), join(dir, 'mcp-x.json.enc'));
    expect(store.read('mcp-x.json')).toBeNull();
    writeFileSync(join(dir, 'garbage.key.enc'), 'not encrypted at all');
    expect(store.read('garbage.key')).toBeNull();

    expect(store.status().unreadable).toEqual(['brave.key', 'garbage.key', 'mcp-x.json']);
    // Saving again repairs it.
    store.write('brave.key', BRAVE);
    expect(store.read('brave.key')).toBe(BRAVE);
  });

  it('keychain without the key of this home: files, nothing moved, no new key (C2)', async () => {
    const home = tempHome();
    const keychain = new FakeKeychain();
    (await open(home, keychain)).store.write('brave.key', BRAVE);
    const before = readFileSync(join(secretsDir(home), 'brave.key.enc'), 'utf8');
    keychain.entries.clear();

    const { store } = await open(home, keychain, {});
    expect(store.backend).toBe('file');
    expect(store.status()).toMatchObject({
      backend: 'file',
      reason: 'missing-key',
      unreadable: ['brave.key'],
    });
    expect(store.status().detail).toMatch(/brave\.key/);
    expect(readdirSync(secretsDir(home))).toEqual(['brave.key.enc']);
    expect(readFileSync(join(secretsDir(home), 'brave.key.enc'), 'utf8')).toBe(before);
    expect(keychain.entries.size).toBe(0);
    const report = await inspectSecrets({ home, mode: 'auto', keychain, service: SERVICE });
    expect(report).toMatchObject({ masterKey: 'missing', status: { reason: 'missing-key' } });
  });

  it('a keychain that says "no entry" by mistake never gets its real key overwritten (C2)', async () => {
    const home = tempHome();
    const keychain = new FakeKeychain();
    (await open(home, keychain)).store.write('brave.key', BRAVE);
    const real = [...keychain.entries.values()][0];
    // One wrong "no entry", then a keychain that saves whatever it is given.
    const get = keychain.get.bind(keychain);
    let lies = 1;
    keychain.get = async (service, account) => (lies-- > 0 ? null : get(service, account));

    const first = await open(home, keychain);
    expect(first.store.status()).toMatchObject({ backend: 'file', reason: 'missing-key' });
    expect([...keychain.entries.values()]).toEqual([real]);
    // Next start: the keychain answers again and everything opens.
    const { store } = await open(home, keychain);
    expect(store.backend).toBe('keychain');
    expect(store.read('brave.key')).toBe(BRAVE);
  });

  it('secrets saved again during the fallback: the new key is made without asking', async () => {
    const home = tempHome();
    const keychain = new FakeKeychain();
    (await open(home, keychain)).store.write('brave.key', BRAVE);
    keychain.entries.clear();
    const fallback = (await open(home, keychain)).store;
    fallback.write('brave.key', 'BSA-new-value-0123456789');

    const { store } = await open(home, keychain);
    expect(store.backend).toBe('keychain');
    expect(store.read('brave.key')).toBe('BSA-new-value-0123456789');
    expect(store.status()).toMatchObject({ unreadable: [] });
    expect(store.status().quarantined).toBeUndefined();
    expect(existsSync(join(secretsDir(home), 'brave.key'))).toBe(false);
  });

  it('secrets reset: set aside only after the new key is saved and read back (C2)', async () => {
    const home = tempHome();
    const keychain = new FakeKeychain();
    (await open(home, keychain)).store.write('brave.key', BRAVE);
    keychain.entries.clear();

    // A keychain that says "no entry" and then does not keep the new key: nothing moves.
    keychain.mode = 'lose-writes';
    const failed = await openSecretStore({
      home,
      mode: 'auto',
      keychain,
      service: SERVICE,
      resetKey: true,
    });
    expect(failed.store.status()).toMatchObject({
      backend: 'file',
      reason: 'error',
      unreadable: ['brave.key'],
    });
    expect(readdirSync(secretsDir(home))).toEqual(['brave.key.enc']);

    keychain.mode = 'ok';
    const { store } = await openSecretStore({
      home,
      mode: 'auto',
      keychain,
      service: SERVICE,
      resetKey: true,
    });
    expect(store.backend).toBe('keychain');
    expect(store.status()).toMatchObject({ unreadable: [], quarantined: ['brave.key'] });
    const aside = readdirSync(secretsDir(home)).filter((n) => n.startsWith('unreadable-'));
    expect(aside).toHaveLength(1);
    expect(readdirSync(join(secretsDir(home), aside[0] ?? ''))).toEqual(['brave.key.enc']);
    expect(keychain.entries.size).toBe(1);
  });

  it('refuses a keychain that does not keep what it is given', async () => {
    const home = tempHome();
    writePlain(home, { 'brave.key': BRAVE });
    const keychain = new FakeKeychain();
    keychain.mode = 'lose-writes';
    const { store } = await open(home, keychain);
    expect(store.status()).toMatchObject({ backend: 'file', reason: 'error' });
    // Nothing migrated: the plain secret is still there and readable.
    expect(store.read('brave.key')).toBe(BRAVE);
  });

  it('an invalid master key in the keychain is reported, not used', async () => {
    const home = tempHome();
    const keychain = new FakeKeychain();
    keychain.entries.set(`${SERVICE}\u0000${secretsAccount(home)}`, 'too-short');
    const { store } = await open(home, keychain);
    expect(store.status()).toMatchObject({ backend: 'file', reason: 'error' });
  });

  it('exports back to plain files (reverse path)', async () => {
    const home = tempHome();
    const keychain = new FakeKeychain();
    writePlain(home, { 'brave.key': BRAVE, 'mcp-github.json': JSON.stringify(MCP) });
    await open(home, keychain);

    const result = await exportSecretsToFiles({ home, mode: 'file', keychain, service: SERVICE });
    expect(result.exported).toEqual(['brave.key', 'mcp-github.json']);
    expect(result.failed).toEqual([]);
    expect(readdirSync(secretsDir(home)).sort()).toEqual(['brave.key', 'mcp-github.json']);
    expect(readFileSync(join(secretsDir(home), 'brave.key'), 'utf8')).toBe(BRAVE);
    if (posix) expect(statSync(join(secretsDir(home), 'brave.key')).mode & 0o777).toBe(0o600);
  });
});

describe('secret store: declared file fallback', () => {
  it('MONSTERS_SECRETS=file never touches the keychain', async () => {
    const home = tempHome();
    writePlain(home, { 'brave.key': BRAVE });
    const keychain = new FakeKeychain();
    const { store } = await openSecretStore({ home, mode: 'file', keychain });
    expect(keychain.calls).toBe(0);
    expect(store.status()).toEqual({ backend: 'file', reason: 'forced', unreadable: [] });
    expect(store.read('brave.key')).toBe(BRAVE);
  });

  it('no keychain module or Secret Service: files, with the reason', async () => {
    const home = tempHome();
    writePlain(home, { 'brave.key': BRAVE });
    const missing = () => Promise.reject(new Error('Cannot find module @napi-rs/keyring'));
    const { store } = await openSecretStore({ home, mode: 'auto', keychain: missing });
    expect(store.status()).toMatchObject({
      backend: 'file',
      reason: 'unavailable',
      detail: 'Cannot find module @napi-rs/keyring',
    });
    expect(store.read('brave.key')).toBe(BRAVE);

    const keychain = new FakeKeychain();
    keychain.mode = 'fail';
    const second = await open(home, keychain);
    expect(second.store.status()).toMatchObject({ backend: 'file', reason: 'unavailable' });
    expect(readdirSync(secretsDir(home))).toEqual(['brave.key']);
  });

  it('a keychain helper that hangs is killed at the deadline: start goes on, process exits', () => {
    // A child process standing in for a core: its keychain helper never answers (a
    // locked keyring waiting for its password). It must fall back and exit by itself.
    const home = tempHome();
    const store = pathToFileURL(join(import.meta.dirname, '../src/secrets/store.ts')).href;
    const keychain = pathToFileURL(join(import.meta.dirname, '../src/secrets/keychain.ts')).href;
    const hang = encodeURIComponent('await new Promise(() => setInterval(() => {}, 1000));');
    const script = `
      import { openSecretStore } from ${JSON.stringify(store)};
      import { loadNativeKeychain } from ${JSON.stringify(keychain)};
      const runtime = { command: process.execPath, env: { NODE_OPTIONS: '--import=data:text/javascript,${hang}' } };
      const t0 = Date.now();
      const { store } = await openSecretStore({
        home: ${JSON.stringify(home)}, mode: 'auto', timeoutMs: 300, service: 'Monsters-test',
        keychain: () => loadNativeKeychain({ runtime }),
      });
      console.log(JSON.stringify({ ...store.status(), ms: Date.now() - t0 }));
    `;
    const t0 = Date.now();
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(res.error).toBeUndefined();
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout) as { backend: string; reason: string; ms: number };
    expect(out).toMatchObject({ backend: 'file', reason: 'timeout' });
    expect(out.ms).toBeLessThan(5000);
    expect(Date.now() - t0).toBeLessThan(15_000);
  });

  it('stopping the core while it waits for the keychain kills the helper at once', async () => {
    const home = tempHome();
    const pidFile = join(home, 'helper.pid');
    // The helper records its pid, then hangs like a locked keyring waiting for its password.
    const hang = encodeURIComponent(
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); await new Promise(() => setInterval(() => {}, 1000));`,
    );
    const runtime = {
      command: process.execPath,
      env: { NODE_OPTIONS: `--import=data:text/javascript,${hang}` },
    };
    const stop = new AbortController();
    const t0 = Date.now();
    const opening = openSecretStore({
      home,
      mode: 'auto',
      timeoutMs: 60_000,
      service: SERVICE,
      keychain: () => loadNativeKeychain({ runtime }),
      signal: stop.signal,
    });
    const until = Date.now() + 10_000;
    while (!existsSync(pidFile) && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    const pid = Number(readFileSync(pidFile, 'utf8'));
    stop.abort();
    await expect(opening).rejects.toBeInstanceOf(KeychainAbortedError);
    expect(Date.now() - t0).toBeLessThan(10_000);
    const gone = Date.now() + 5_000;
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    while (alive() && Date.now() < gone) await new Promise((r) => setTimeout(r, 20));
    expect(alive()).toBe(false);
  });

  it('a helper that cannot start means no keychain', async () => {
    const keychain = await loadNativeKeychain({ runtime: { command: '/nonexistent/node' } });
    const { store } = await openSecretStore({
      home: tempHome(),
      mode: 'auto',
      keychain,
      service: SERVICE,
    });
    expect(store.status()).toMatchObject({ backend: 'file', reason: 'unavailable' });
  });

  it('MONSTERS_SECRETS=keychain makes a missing keychain an error', async () => {
    const keychain = new FakeKeychain();
    keychain.mode = 'fail';
    await expect(
      openSecretStore({ home: tempHome(), mode: 'keychain', keychain, service: SERVICE }),
    ).rejects.toThrow(/portachiavi richiesto/);
  });

  it('a locked keychain that never answers does not block the start', async () => {
    const home = tempHome();
    const keychain = new FakeKeychain();
    (await open(home, keychain)).store.write('brave.key', BRAVE);

    keychain.mode = 'hang';
    const t0 = Date.now();
    const { store } = await open(home, keychain, { timeoutMs: 100 });
    expect(Date.now() - t0).toBeLessThan(2000);
    // What was encrypted cannot be read now, and the status says so.
    expect(store.status()).toMatchObject({
      backend: 'file',
      reason: 'timeout',
      unreadable: ['brave.key'],
    });
    expect(store.read('brave.key')).toBeNull();
    // A key saved meanwhile goes to a protected file…
    store.write('brave.key', 'new-brave-key');
    expect(store.status().unreadable).toEqual([]);

    // …and is encrypted (over the old copy) once the keychain is back.
    keychain.mode = 'ok';
    const back = await open(home, keychain);
    expect(back.migrated).toEqual(['brave.key']);
    expect(back.store.read('brave.key')).toBe('new-brave-key');
    expect(readdirSync(secretsDir(home))).toEqual(['brave.key.enc']);
  });

  it('removing a secret in fallback also drops its unreadable encrypted copy', () => {
    const home = tempHome();
    mkdirSync(secretsDir(home), { recursive: true });
    writeFileSync(join(secretsDir(home), 'brave.key.enc'), 'monsters-secret:v1:x:y:z\n');
    const store = new FileSecretStore(secretsDir(home), { reason: 'unavailable' });
    expect(store.status().unreadable).toEqual(['brave.key']);
    store.remove('brave.key');
    expect(existsSync(join(secretsDir(home), 'brave.key.enc'))).toBe(false);
  });

  it('reads MONSTERS_SECRETS: file wins, unknown values are refused', () => {
    // The process environment of the tests says `file` (vitest.config.ts).
    expect(secretsMode({ MONSTERS_SECRETS: 'keychain' })).toBe('file');
    const saved = process.env['MONSTERS_SECRETS'];
    try {
      delete process.env['MONSTERS_SECRETS'];
      expect(secretsMode({})).toBe('auto');
      expect(secretsMode({ MONSTERS_SECRETS: 'Keychain' })).toBe('keychain');
      expect(() => secretsMode({ MONSTERS_SECRETS: 'vault' })).toThrow(/MONSTERS_SECRETS/);
    } finally {
      if (saved !== undefined) process.env['MONSTERS_SECRETS'] = saved;
    }
  });

  it('rejects names that could escape the folder', () => {
    const store = new FileSecretStore(secretsDir(tempHome()));
    for (const bad of ['../x', 'a/b', '.hidden', 'x.enc', 'x.tmp', 'UPPER']) {
      expect(() => store.read(bad)).toThrow(/invalid secret name/);
    }
  });
});

describe('secret store: helpers keep their API', () => {
  it('readProviderKey & co. go through the registered store', async () => {
    const home = tempHome();
    const dir = secretsDir(home);
    const { store } = await open(home, new FakeKeychain());
    expect(store).toBeInstanceOf(KeychainSecretStore);
    const unregister = registerSecretStore(store);
    try {
      expect(secretStoreFor(dir)).toBe(store);
      saveProviderKey(dir, 'anthropic', ` ${OPENROUTER} `);
      saveMcpSecrets(dir, 'github', MCP);
      expect(readProviderKey(dir, 'anthropic', [], {})).toEqual({
        key: OPENROUTER,
        source: 'file',
      });
      expect(readMcpSecrets(dir, 'github')).toEqual(MCP);
      expect(readOpenRouterKey(dir, { OPENROUTER_API_KEY: 'from-env' })).toEqual({
        key: 'from-env',
        source: 'env',
      });
      expect(diskText(home)).not.toContain(OPENROUTER);
      removeProviderKey(dir, 'anthropic');
      saveMcpSecrets(dir, 'github', { env: {}, headers: {} });
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      unregister();
    }
    expect(secretStoreFor(dir)).toBeInstanceOf(FileSecretStore);
  });

  it('inspect reports without creating keys or moving files', async () => {
    const home = tempHome();
    writePlain(home, { 'brave.key': BRAVE });
    const keychain = new FakeKeychain();
    const report = await inspectSecrets({ home, mode: 'auto', keychain, service: SERVICE });
    expect(report).toMatchObject({ masterKey: 'missing', plain: ['brave.key'], encrypted: [] });
    expect(keychain.entries.size).toBe(0);
    expect(readdirSync(secretsDir(home))).toEqual(['brave.key']);

    await open(home, keychain);
    const after = await inspectSecrets({ home, mode: 'auto', keychain, service: SERVICE });
    expect(after).toMatchObject({
      masterKey: 'present',
      plain: [],
      encrypted: ['brave.key'],
      status: { backend: 'keychain', unreadable: [] },
    });
  });
});

describe('secret store in the core', () => {
  it('migrates at start, saves new keys encrypted, shows the backend in settings', async () => {
    const home = tempHome();
    writePlain(home, { 'typesafe.key': 'ts-0123456789abcdef' });
    const keychain = new FakeKeychain();
    const secrets = { mode: 'auto' as const, keychain, service: SERVICE };
    const t = await startTestHub({}, { home, withoutTeam: true, hub: { secrets } });

    expect(readdirSync(secretsDir(home))).toEqual(['typesafe.key.enc']);
    const res = await t.api('PUT', '/api/settings/brave-key', { key: BRAVE });
    expect(res.status).toBe(200);
    expect(readdirSync(secretsDir(home)).sort()).toEqual(['brave.key.enc', 'typesafe.key.enc']);
    expect(diskText(home)).not.toContain(BRAVE);

    const settings = await t.json<{ secrets: unknown; braveKey: { set: boolean } }>(
      'GET',
      '/api/settings',
    );
    expect(settings.secrets).toEqual({
      backend: 'keychain',
      reason: 'keychain',
      keychain: 'Portachiavi finto',
      unreadable: [],
    });
    await t.core.close();

    // Same home, keychain locked: the core starts anyway and says why the keys are missing.
    keychain.mode = 'hang';
    const locked = await startTestHub(
      {},
      { home, withoutTeam: true, hub: { secrets: { ...secrets, timeoutMs: 100 } } },
    );
    const view = await locked.json<{ secrets: unknown; braveKey: { set: boolean } }>(
      'GET',
      '/api/settings',
    );
    expect(view.braveKey.set).toBe(false);
    expect(view.secrets).toMatchObject({
      backend: 'file',
      reason: 'timeout',
      unreadable: ['brave.key', 'typesafe.key'],
    });
    const logged = locked.core.log
      .query({ limit: 100 })
      .filter((e) => e.type === 'error')
      .map((e) => (e.data as { code?: string }).code);
    expect(logged).toEqual(expect.arrayContaining(['secrets_fallback', 'secrets_unreadable']));
  });
});
