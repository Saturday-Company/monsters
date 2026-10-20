import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  loadNativeKeychain,
  openSecretStore,
  secretsAccount,
  type Keychain,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';

/*
 * The real system keychain, only on request (MONSTERS_TEST_KEYCHAIN=1). On
 * Linux run it in a throwaway D-Bus session with its own GNOME Keyring, never
 * the user's: `scripts/test-keychain-linux.sh`. The entry uses a test service
 * name and is deleted at the end.
 */

const enabled = process.env['MONSTERS_TEST_KEYCHAIN'] === '1';
const SERVICE = `Monsters-test-${randomBytes(4).toString('hex')}`;
const created: { keychain: Keychain; account: string }[] = [];

afterAll(async () => {
  for (const { keychain, account } of created) {
    await keychain.delete(SERVICE, account, new AbortController().signal);
  }
});

describe.skipIf(!enabled)('real keychain', () => {
  it('stores the master key, encrypts the secrets, reads them back after a restart', async () => {
    const home = tempHome();
    const dir = join(home, 'secrets');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const secret = `sk-or-v1-${randomBytes(16).toString('hex')}`;
    writeFileSync(join(dir, 'openrouter.key'), `${secret}\n`, { mode: 0o600 });

    const keychain = await loadNativeKeychain();
    created.push({ keychain, account: secretsAccount(home) });
    const first = await openSecretStore({ home, mode: 'keychain', keychain, service: SERVICE });
    expect(first.store.status().backend).toBe('keychain');
    expect(first.migrated).toEqual(['openrouter.key']);
    expect(readdirSync(dir)).toEqual(['openrouter.key.enc']);
    expect(readFileSync(join(dir, 'openrouter.key.enc'), 'utf8')).not.toContain(secret);

    // A new module instance stands in for a new process (CLI after the app, or vice versa).
    const again = await openSecretStore({
      home,
      mode: 'keychain',
      keychain: await loadNativeKeychain(),
      service: SERVICE,
    });
    expect(again.migrated).toEqual([]);
    expect(again.store.read('openrouter.key')).toBe(`${secret}\n`);

    const signal = new AbortController().signal;
    expect(await keychain.delete(SERVICE, secretsAccount(home), signal)).toBe(true);
    expect(await keychain.get(SERVICE, secretsAccount(home), signal)).toBeNull();
  });
});
