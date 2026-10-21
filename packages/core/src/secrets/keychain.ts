import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { nodeMissing, nodeRuntime } from '@monsters/shared/node';

/*
 * The operating system's keychain (DECISIONS D-042): macOS Keychain, Windows
 * Credential Manager, Secret Service on Linux (GNOME Keyring, KWallet,
 * KeePassXC). Monsters keeps a single entry there per data directory, the
 * master key that encrypts the files in `secrets/`.
 *
 * The native module (`@napi-rs/keyring`, N-API, prebuilt binaries) runs in a
 * short-lived child process, one per call: a keychain may block without end
 * (a locked GNOME Keyring waiting for its password prompt), and a native call
 * stuck in this process could neither be interrupted nor let the process exit
 * (Node joins its threads at exit). A child is killed at the deadline. When
 * the module is missing (unsupported platform, a bundle without it) the core
 * falls back to protected files. It must stay external when the core is bundled.
 */

export interface Keychain {
  /** Name of the keychain for the user ("Secret Service", "Portachiavi di macOS"…). */
  readonly name: string;
  /** The stored value, or null when there is no entry. Rejects when the keychain cannot be read. */
  get(service: string, account: string, signal: AbortSignal): Promise<string | null>;
  set(service: string, account: string, value: string, signal: AbortSignal): Promise<void>;
  /** True when an entry was deleted, false when there was none. */
  delete(service: string, account: string, signal: AbortSignal): Promise<boolean>;
}

/** The keychain cannot be used on this machine (no module, no Secret Service…). */
export class KeychainUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'KeychainUnavailableError';
  }
}

/** The keychain did not answer in time (locked and waiting for a prompt, hung daemon). */
export class KeychainTimeoutError extends Error {
  constructor(ms: number) {
    super(`il portachiavi non ha risposto entro ${Math.round(ms / 1000)} s`);
    this.name = 'KeychainTimeoutError';
  }
}

export function keychainName(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return 'Portachiavi di macOS';
  if (platform === 'win32') return 'Gestione credenziali di Windows';
  return 'Secret Service';
}

/**
 * How to run Node for the helper: the children's Node runtime. Not used by the core of the
 * desktop app, whose binary is never a Node (RunAsNode off): there the app runs the helper in
 * a utility process of its own, asked over the message port (`desktopKeychain` in the CLI).
 */
export interface KeychainRuntime {
  command: string;
  env?: Record<string, string>;
}

export function defaultKeychainRuntime(): KeychainRuntime {
  const runtime = nodeRuntime();
  if (!runtime) throw new KeychainUnavailableError(nodeMissing());
  return { command: runtime.command };
}

/*
 * The helper (CommonJS, run with `-e`): argv = module path, operation, service,
 * account; the value to store comes on stdin, never on the command line. On
 * Linux the entry is pinned to Secret Service: the library would otherwise fall
 * back to the kernel keyring, which forgets everything at reboot (and with it
 * the key of every encrypted secret).
 */
const HELPER = `
const [modPath, op, service, account] = process.argv.slice(1);
const out = (v) => process.stdout.write(JSON.stringify(v));
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  let Entry;
  try {
    Entry = require(modPath).Entry;
  } catch (err) {
    return out({ ok: false, kind: 'module', message: String((err && err.message) || err) });
  }
  try {
    const entry = new Entry(service, account, { linux: { store: 'secret-service' } });
    if (op === 'get') return out({ ok: true, value: entry.getPassword() ?? null });
    if (op === 'set') {
      entry.setPassword(input);
      return out({ ok: true, value: null });
    }
    if (op === 'delete') return out({ ok: true, value: entry.deleteCredential() });
    out({ ok: false, kind: 'store', message: 'unknown operation' });
  } catch (err) {
    out({ ok: false, kind: 'store', message: String((err && err.message) || err) });
  }
});
`;

type HelperReply =
  | { ok: true; value: string | boolean | null }
  | { ok: false; kind: 'module' | 'store'; message: string };

function runHelper(
  runtime: KeychainRuntime,
  modulePath: string,
  args: [op: 'get' | 'set' | 'delete', service: string, account: string],
  input: string,
  signal: AbortSignal,
): Promise<string | boolean | null> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const child = spawn(runtime.command, ['-e', HELPER, modulePath, ...args], {
      env: { ...process.env, ...runtime.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      signal,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', (err) => reject(new KeychainUnavailableError(err.message, { cause: err })));
    child.on('close', (code) => {
      let reply: HelperReply;
      try {
        reply = JSON.parse(stdout) as HelperReply;
      } catch {
        const why = stderr.trim().split('\n').at(-1) ?? `exit ${code}`;
        return reject(new KeychainUnavailableError(`portachiavi non raggiungibile: ${why}`));
      }
      if (reply.ok) return resolve(reply.value);
      reject(new KeychainUnavailableError(reply.message));
    });
    child.stdin.on('error', () => {
      // The helper may have died before reading: its exit tells why.
    });
    child.stdin.end(input);
  });
}

/** Loads the native keychain: finds the module now, runs every call in a helper process. */
export function loadNativeKeychain(options: { runtime?: KeychainRuntime } = {}): Promise<Keychain> {
  let modulePath: string;
  try {
    modulePath = createRequire(import.meta.url).resolve('@napi-rs/keyring');
  } catch (err) {
    return Promise.reject(
      new KeychainUnavailableError(
        `modulo del portachiavi non disponibile: ${(err as Error).message}`,
        { cause: err },
      ),
    );
  }
  let runtime: KeychainRuntime;
  try {
    runtime = options.runtime ?? defaultKeychainRuntime();
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
  const call = (
    op: 'get' | 'set' | 'delete',
    service: string,
    account: string,
    signal: AbortSignal,
    input = '',
  ) => runHelper(runtime, modulePath, [op, service, account], input, signal);
  return Promise.resolve({
    name: keychainName(),
    async get(service, account, signal) {
      const value = await call('get', service, account, signal);
      return typeof value === 'string' ? value : null;
    },
    async set(service, account, value, signal) {
      await call('set', service, account, signal, value);
    },
    async delete(service, account, signal) {
      return (await call('delete', service, account, signal)) === true;
    },
  });
}

/** The start of the core was stopped while waiting for the keychain. */
export class KeychainAbortedError extends Error {
  constructor() {
    super('attesa del portachiavi interrotta: il core si sta fermando');
    this.name = 'KeychainAbortedError';
  }
}

/**
 * Runs a keychain call with a deadline; the call gets aborted (its helper killed) at the
 * deadline, or at once when `stop` aborts (the core is asked to stop while it starts).
 */
export async function withKeychainTimeout<T>(
  call: (signal: AbortSignal) => Promise<T>,
  ms: number,
  stop?: AbortSignal,
): Promise<T> {
  if (stop?.aborted) throw new KeychainAbortedError();
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let onStop: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new KeychainTimeoutError(ms));
    }, ms);
    onStop = () => {
      controller.abort();
      reject(new KeychainAbortedError());
    };
    stop?.addEventListener('abort', onStop, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(() => call(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
    if (onStop) stop?.removeEventListener('abort', onStop);
  }
}
