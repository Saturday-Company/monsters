import { secretStoreFor } from '../secrets/store.ts';

/*
 * The Brave Search key (DECISIONS D-016): the secret `brave.key` in
 * `MONSTERS_HOME/secrets/` (keychain or file backend, D-042), or
 * `BRAVE_API_KEY`. Optional: with it `web_search` tries Brave first. Never
 * returned by the API.
 */

export const BRAVE_KEY_FILE = 'brave.key';

export function readBraveKey(
  secretsDir: string,
  env: NodeJS.ProcessEnv = process.env,
): { key: string; source: 'file' | 'env' } | null {
  const key = secretStoreFor(secretsDir).read(BRAVE_KEY_FILE)?.trim();
  if (key) return { key, source: 'file' };
  const fromEnv = env['BRAVE_API_KEY']?.trim();
  return fromEnv ? { key: fromEnv, source: 'env' } : null;
}

export function saveBraveKey(secretsDir: string, key: string): void {
  secretStoreFor(secretsDir).write(BRAVE_KEY_FILE, `${key.trim()}\n`);
}
