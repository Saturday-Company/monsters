import { secretStoreFor } from '../secrets/store.ts';

/*
 * API keys of the providers (ARCHITECTURE §5.8): the secret `<id>.key` in
 * `MONSTERS_HOME/secrets/` (encrypted with the keychain's master key, or a
 * plain file with mode 600 as fallback: D-042), or the provider's environment
 * variable. A key saved from the UI wins over the environment. Keys are never
 * returned by the API nor logged (they are registered with the log's redactor
 * as soon as they are read).
 */

export interface StoredKey {
  key: string;
  /** `file`: saved by Monsters (keychain or file backend); `env`: from a variable. */
  source: 'file' | 'env';
  /** The variable the key came from (source `env`). */
  envVar?: string;
}

/** Name of the secret holding the key of a provider. */
export function providerKeyName(id: string): string {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(id)) throw new Error(`invalid provider id ${id}`);
  return `${id}.key`;
}

export function readProviderKey(
  secretsDir: string,
  id: string,
  envVars: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): StoredKey | null {
  const key = secretStoreFor(secretsDir).read(providerKeyName(id))?.trim();
  if (key) return { key, source: 'file' };
  for (const name of envVars) {
    const value = env[name]?.trim();
    if (value) return { key: value, source: 'env', envVar: name };
  }
  return null;
}

export function saveProviderKey(secretsDir: string, id: string, key: string): void {
  secretStoreFor(secretsDir).write(providerKeyName(id), `${key.trim()}\n`);
}

export function removeProviderKey(secretsDir: string, id: string): void {
  secretStoreFor(secretsDir).remove(providerKeyName(id));
}
