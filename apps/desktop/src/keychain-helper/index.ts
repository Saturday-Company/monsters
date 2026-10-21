import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { KeychainOp } from '@monsters/shared';
import { helperStrings } from './index.strings.ts';
import { isKeyringBinary, isMonstersEntry } from './entries.ts';

/*
 * The keychain helper of the desktop app (D-042, S-M8): one call to the system keychain, in a
 * short-lived Electron utility process that the main process starts for each request of the
 * core (main/keychain-host.ts). Before, the core ran the same few lines with the app's binary
 * as Node (ELECTRON_RUN_AS_NODE); with the RunAsNode fuse off that binary is never a Node, so
 * the keychain's "Allow always" is given to a process that runs only this file, from the app.
 *
 * Built as dist/keychain-helper.cjs (inside the signed app.asar, checked by the integrity fuse).
 * All the JavaScript it runs is in that file (review of wave 5, n. 4): of `@napi-rs/keyring` it
 * loads only the native binary, with `process.dlopen`, never the package's `index.js` in
 * resources/core (outside the ASAR, not covered by the integrity check). On macOS that binary
 * passes the library validation of the hardened runtime (signed with the app's Team ID). It
 * touches only the entries of Monsters (entries.ts). In the packaged app (not on macOS, where
 * the library validation does it) the binary must still have the sha256 the manifest in
 * app.asar gives it, read right before `dlopen`: a binary changed after the check at the
 * core's start, hours earlier, is not loaded (review of 19/10, n. 12). The request comes on the
 * process's parent port (the value to store never on a command line), the answer goes back the
 * same way; the main process then ends the process, or kills it at the core's deadline: a
 * keychain may block without end (a locked GNOME Keyring waiting for its password).
 */

export interface HelperRequest {
  /** The `.node` of `@napi-rs/keyring` next to the core (resolved by the main process). */
  nativePath: string;
  /** Its sha256 in the manifest of the core (packaged app, not macOS): checked before loading. */
  sha256?: string;
  op: KeychainOp;
  service: string;
  account: string;
  value?: string;
  /** The app's language, for the messages (the helper does not hold it). */
  lang?: 'en' | 'it';
}

export type HelperReply =
  | { ok: true; value: string | boolean | null }
  | { ok: false; kind: 'module' | 'store'; message: string };

interface KeyringEntry {
  getPassword(): string | null | undefined;
  setPassword(value: string): void;
  deleteCredential(): boolean;
}
type EntryClass = new (
  service: string,
  account: string,
  options: { linux: { store: 'secret-service' } },
) => KeyringEntry;

const message = (err: unknown) => String((err as Error | undefined)?.message ?? err);

/** sha256 of a file, in hex. */
export function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Loads a native binary by its absolute path (no JavaScript, no module resolution). */
export function loadNative(path: string): unknown {
  const module = { exports: {} as unknown };
  process.dlopen(module, path);
  return module.exports;
}

/**
 * Runs one call. On Linux the entry is pinned to Secret Service: the library would otherwise
 * fall back to the kernel keyring, which forgets everything at reboot (and with it the key of
 * every encrypted secret). Same behaviour as the helper of packages/core/src/secrets/keychain.ts.
 */
export function runKeychainOp(
  request: HelperRequest,
  load: (path: string) => unknown = loadNative,
  system: { platform: NodeJS.Platform; arch: string } = process,
  hashOf: (path: string) => string = sha256Of,
): HelperReply {
  if (!isMonstersEntry(request.service, request.account)) {
    return { ok: false, kind: 'store', message: helperStrings(request.lang).notMonstersEntry };
  }
  if (!isKeyringBinary(request.nativePath, system.platform, system.arch)) {
    return { ok: false, kind: 'module', message: helperStrings(request.lang).badBinary };
  }
  if (request.sha256 !== undefined) {
    let hash: string | null;
    try {
      hash = hashOf(request.nativePath);
    } catch {
      hash = null;
    }
    if (hash !== request.sha256) {
      return {
        ok: false,
        kind: 'module',
        message: helperStrings(request.lang).binaryMismatch,
      };
    }
  }
  let Entry: EntryClass;
  try {
    Entry = (load(request.nativePath) as { Entry: EntryClass }).Entry;
    if (typeof Entry !== 'function') throw new Error('no Entry in the keyring module');
  } catch (err) {
    return { ok: false, kind: 'module', message: message(err) };
  }
  try {
    const entry = new Entry(request.service, request.account, {
      linux: { store: 'secret-service' },
    });
    if (request.op === 'get') return { ok: true, value: entry.getPassword() ?? null };
    if (request.op === 'set') {
      entry.setPassword(request.value ?? '');
      return { ok: true, value: null };
    }
    if (request.op === 'delete') return { ok: true, value: entry.deleteCredential() };
    return { ok: false, kind: 'store', message: 'unknown operation' };
  } catch (err) {
    return { ok: false, kind: 'store', message: message(err) };
  }
}

interface ParentPort {
  once(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  postMessage(message: unknown): void;
}

const port = (process as { parentPort?: ParentPort }).parentPort;
if (port) {
  port.once('message', (event) => {
    port.postMessage(runKeychainOp(event.data as HelperRequest));
  });
}
