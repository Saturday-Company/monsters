import { isAbsolute } from 'node:path';

/*
 * What the keychain helper may touch (review of wave 5, n. 10): only the entries of Monsters.
 * The core keeps one entry per data directory, service "Monsters" (SECRETS_SERVICE in
 * packages/core/src/secrets/store.ts), account `home-` and 24 hex digits of a hash of the
 * path (`secretsAccount`, `legacySecretsAccount`); test/keychain-host.test.ts checks that the
 * two stay in step. A request for any other entry (another app's, which macOS would show under
 * the name of Monsters) is refused by the host and again by the helper.
 *
 * Also where the native part of `@napi-rs/keyring` is (review of wave 5, n. 4): the helper loads
 * only that binary (`process.dlopen`), never the package's JavaScript loader, which lives in
 * resources/core outside the ASAR and its integrity check.
 */

export const KEYCHAIN_SERVICE = 'Monsters';
const ACCOUNT = /^home-[0-9a-f]{24}$/;

/** Whether a keychain entry is one of Monsters. */
export function isMonstersEntry(service: string, account: string): boolean {
  return service === KEYCHAIN_SERVICE && ACCOUNT.test(account);
}

/** The platform part of `@napi-rs/keyring`'s package and binary names, as package.ts ships it. */
export function keyringTriple(platform: NodeJS.Platform, arch: string): string | null {
  if (arch !== 'x64' && arch !== 'arm64') return null;
  if (platform === 'linux') return `linux-${arch}-gnu`;
  if (platform === 'win32') return `win32-${arch}-msvc`;
  if (platform === 'darwin') return `darwin-${arch}`;
  return null;
}

/** A path the helper may load: absolute, a `.node` named after this platform's binary. */
export function isKeyringBinary(path: string, platform: NodeJS.Platform, arch: string): boolean {
  const triple = keyringTriple(platform, arch);
  if (!triple || !isAbsolute(path)) return false;
  const name = path.split(/[\\/]/).at(-1);
  return name === `keyring.${triple}.node`;
}
