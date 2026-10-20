import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { SecretsStatus } from '@monsters/shared';
import { DIR_MODE, FILE_MODE, chmodSafe, homePaths, writeSensitiveFile } from '../config.ts';
import {
  KeychainAbortedError,
  KeychainTimeoutError,
  keychainName,
  loadNativeKeychain,
  withKeychainTimeout,
  type Keychain,
} from './keychain.ts';

/*
 * Secrets of the core (API keys, bot tokens, MCP variables, ChatGPT tokens),
 * by name (`openrouter.key`, `mcp-github.json`, `chatgpt.json`) in
 * `MONSTERS_HOME/secrets/` (DECISIONS D-042):
 *
 * - keychain backend: each secret is a file `<name>.enc`, AES-256-GCM with a
 *   random 256-bit master key kept in the system keychain (service
 *   "Monsters", one account per data directory). One small entry, so the size
 *   limit of Windows Credential Manager does not matter, and the keychain is
 *   touched once per start: reads and writes stay synchronous.
 * - file backend (declared fallback: no keychain, `MONSTERS_SECRETS=file`):
 *   plain files with mode 600, as before.
 *
 * At start, plain files left by the file backend (or written by hand) are
 * encrypted, verified and only then removed. Every step can be repeated: a
 * plain file always wins over its `.enc` twin, so an interrupted migration
 * simply runs again. Nothing here ever logs a value.
 */

export type SecretsMode = 'auto' | 'keychain' | 'file';

export const SECRETS_SERVICE = 'Monsters';
/** Keychain calls wait this long by default: a locked keyring may be showing its password prompt. */
export const DEFAULT_KEYCHAIN_TIMEOUT_MS = 20_000;

const ENC_SUFFIX = '.enc';
const ENC_PREFIX = 'monsters-secret:v1:';
const QUARANTINE_PREFIX = 'unreadable-';
const NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;

export interface SecretStore {
  /** The `secrets/` directory. */
  readonly dir: string;
  readonly backend: 'keychain' | 'file';
  /** The value saved under `name`, or null (missing, or unreadable: see `status()`). */
  read(name: string): string | null;
  write(name: string, value: string): void;
  /** Removes the secret in every form (plain and encrypted). */
  remove(name: string): void;
  /** Names of the saved secrets (readable or not). */
  list(): string[];
  status(): SecretsStatus;
}

export function assertSecretName(name: string): void {
  if (!NAME.test(name) || name.endsWith(ENC_SUFFIX) || name.endsWith('.tmp')) {
    throw new Error(`invalid secret name ${JSON.stringify(name)}`);
  }
}

function accountOf(path: string): string {
  return `home-${createHash('sha256').update(path).digest('hex').slice(0, 24)}`;
}

/**
 * Keychain account of a data directory: several homes on one machine never share a key.
 * The path is the one the system gives back (`realpath.native`): on macOS and Windows the
 * file system ignores case, and `~/Monsters` and `~/monsters` (or `c:\Users` and
 * `C:\users`) are the same folder, so they must give the same account.
 */
export function secretsAccount(
  home: string,
  realpath: (path: string) => string = realpathSync.native,
): string {
  let path = resolve(home);
  try {
    path = realpath(path);
  } catch {
    // not created yet: the resolved path
  }
  return accountOf(path);
}

/** The account of the first versions (M3.2): the case of the path as given. */
export function legacySecretsAccount(home: string): string {
  let path = resolve(home);
  try {
    path = realpathSync(path);
  } catch {
    // not created yet
  }
  return accountOf(path);
}

/** `MONSTERS_SECRETS`: `file` anywhere wins (tests and CI set it in the process environment). */
export function secretsMode(env: NodeJS.ProcessEnv = process.env): SecretsMode {
  const values = [process.env['MONSTERS_SECRETS'], env['MONSTERS_SECRETS']]
    .map((v) => v?.trim().toLowerCase())
    .filter((v): v is string => !!v);
  for (const v of values) {
    if (v !== 'auto' && v !== 'keychain' && v !== 'file') {
      throw new Error(`MONSTERS_SECRETS non valido: ${v} (auto, keychain o file)`);
    }
  }
  if (values.includes('file')) return 'file';
  if (values.includes('keychain')) return 'keychain';
  return 'auto';
}

function keychainTimeout(env: NodeJS.ProcessEnv): number {
  const raw = env['MONSTERS_SECRETS_TIMEOUT_MS'] ?? process.env['MONSTERS_SECRETS_TIMEOUT_MS'];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_KEYCHAIN_TIMEOUT_MS;
}

// --- files ---------------------------------------------------------------------

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  chmodSafe(dir, DIR_MODE);
}

function readOptional(path: string): string | null {
  try {
    const text = readFileSync(path, 'utf8');
    // Keep the file private even if someone loosened its mode.
    if ((statSync(path).mode & 0o077) !== 0) chmodSafe(path, FILE_MODE);
    return text;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

interface DirListing {
  plain: string[];
  encrypted: string[];
}

function listDir(dir: string): DirListing {
  const out: DirListing = { plain: [], encrypted: [] };
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out;
    throw err;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (e.name.endsWith(ENC_SUFFIX)) {
      const name = e.name.slice(0, -ENC_SUFFIX.length);
      if (NAME.test(name)) out.encrypted.push(name);
    } else if (NAME.test(e.name) && !e.name.endsWith('.tmp')) {
      out.plain.push(e.name);
    }
  }
  out.plain.sort();
  out.encrypted.sort();
  return out;
}

/** Temporary files of writes interrupted by a crash (`<name>.<pid>.tmp`). */
function removeStaleTemp(dir: string): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) if (n.endsWith('.tmp')) rmSync(join(dir, n), { force: true });
}

// --- encryption ----------------------------------------------------------------

/** An encrypted secret that cannot be opened: wrong key, damaged or tampered file. */
export class SecretDecryptError extends Error {
  constructor(name: string) {
    super(`il segreto ${name} non si può decifrare (chiave diversa o file danneggiato)`);
    this.name = 'SecretDecryptError';
  }
}

function aad(name: string): Buffer {
  // Binds the ciphertext to its name: a file copied over another one fails.
  return Buffer.from(`monsters-secret:${name}`, 'utf8');
}

export function encryptSecret(key: Buffer, name: string, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(name));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}\n`;
}

export function decryptSecret(key: Buffer, name: string, text: string): string {
  const body = text.trim();
  if (!body.startsWith(ENC_PREFIX)) throw new SecretDecryptError(name);
  const [ivB64, tagB64, dataB64, ...rest] = body.slice(ENC_PREFIX.length).split(':');
  if (ivB64 === undefined || tagB64 === undefined || dataB64 === undefined || rest.length > 0) {
    throw new SecretDecryptError(name);
  }
  try {
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    if (iv.length !== 12 || tag.length !== 16) throw new SecretDecryptError(name);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad(name));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new SecretDecryptError(name);
  }
}

function parseMasterKey(value: string): Buffer | null {
  const key = Buffer.from(value.trim(), 'base64');
  return key.length === 32 ? key : null;
}

// --- backends ------------------------------------------------------------------

interface FileStatus {
  reason: Exclude<SecretsStatus['reason'], 'keychain'>;
  keychain?: string;
  detail?: string;
}

/** Plain files with mode 600: the declared fallback. */
export class FileSecretStore implements SecretStore {
  readonly backend = 'file' as const;
  readonly dir: string;
  readonly #status: FileStatus;

  constructor(dir: string, status: FileStatus = { reason: 'forced' }) {
    this.dir = dir;
    this.#status = status;
  }

  read(name: string): string | null {
    assertSecretName(name);
    return readOptional(join(this.dir, name));
  }

  write(name: string, value: string): void {
    assertSecretName(name);
    ensureDir(this.dir);
    writeSensitiveFile(join(this.dir, name), value);
  }

  remove(name: string): void {
    assertSecretName(name);
    rmSync(join(this.dir, name), { force: true });
    // An encrypted copy nobody can read anymore goes too: the user asked to remove it.
    rmSync(join(this.dir, name + ENC_SUFFIX), { force: true });
  }

  list(): string[] {
    const { plain, encrypted } = listDir(this.dir);
    return [...new Set([...plain, ...encrypted])].sort();
  }

  status(): SecretsStatus {
    const { plain, encrypted } = listDir(this.dir);
    return {
      backend: 'file',
      ...this.#status,
      // Encrypted by an earlier start whose keychain is not reachable now.
      unreadable: encrypted.filter((n) => !plain.includes(n)),
    };
  }
}

/** `<name>.enc` files encrypted with the master key from the keychain. */
export class KeychainSecretStore implements SecretStore {
  readonly backend = 'keychain' as const;
  readonly dir: string;
  readonly #key: Buffer;
  readonly #keychain: string;
  readonly #quarantined: string[];

  constructor(dir: string, key: Buffer, keychain: string, quarantined: string[] = []) {
    this.dir = dir;
    this.#key = key;
    this.#keychain = keychain;
    this.#quarantined = quarantined;
  }

  read(name: string): string | null {
    assertSecretName(name);
    // A plain file is newer (written while the keychain was away, or by hand): it wins.
    const plain = readOptional(join(this.dir, name));
    if (plain !== null) {
      try {
        this.write(name, plain);
      } catch {
        // Stays plain for now: the next start tries again.
      }
      return plain;
    }
    const text = readOptional(join(this.dir, name + ENC_SUFFIX));
    if (text === null) return null;
    try {
      return decryptSecret(this.#key, name, text);
    } catch {
      return null;
    }
  }

  write(name: string, value: string): void {
    assertSecretName(name);
    ensureDir(this.dir);
    const path = join(this.dir, name + ENC_SUFFIX);
    writeSensitiveFile(path, encryptSecret(this.#key, name, value));
    // Verify before dropping the plain copy: what is on disk must open again.
    if (decryptSecret(this.#key, name, readFileSync(path, 'utf8')) !== value) {
      throw new SecretDecryptError(name);
    }
    // On SSDs overwriting is no guarantee of erasure: unlinking is what we can do.
    rmSync(join(this.dir, name), { force: true });
  }

  remove(name: string): void {
    assertSecretName(name);
    rmSync(join(this.dir, name), { force: true });
    rmSync(join(this.dir, name + ENC_SUFFIX), { force: true });
  }

  list(): string[] {
    const { plain, encrypted } = listDir(this.dir);
    return [...new Set([...plain, ...encrypted])].sort();
  }

  /** Encrypts every plain secret still on disk. Returns the names moved. */
  migrate(): string[] {
    const moved: string[] = [];
    for (const name of listDir(this.dir).plain) {
      const value = readOptional(join(this.dir, name));
      if (value === null) continue;
      this.write(name, value);
      moved.push(name);
    }
    return moved;
  }

  status(): SecretsStatus {
    const unreadable: string[] = [];
    const { plain, encrypted } = listDir(this.dir);
    for (const name of encrypted) {
      if (plain.includes(name)) continue;
      const text = readOptional(join(this.dir, name + ENC_SUFFIX));
      if (text === null) continue;
      try {
        decryptSecret(this.#key, name, text);
      } catch {
        unreadable.push(name);
      }
    }
    return {
      backend: 'keychain',
      reason: 'keychain',
      keychain: this.#keychain,
      unreadable,
      ...(this.#quarantined.length > 0 ? { quarantined: [...this.#quarantined] } : {}),
    };
  }

  /** Decrypts every secret back to a plain file (mode 600) and removes the `.enc` copy. */
  exportToFiles(): { exported: string[]; failed: string[] } {
    const exported: string[] = [];
    const failed: string[] = [];
    for (const name of listDir(this.dir).encrypted) {
      const plainPath = join(this.dir, name);
      const encPath = join(this.dir, name + ENC_SUFFIX);
      try {
        const existing = readOptional(plainPath);
        if (existing === null) {
          const value = decryptSecret(this.#key, name, readFileSync(encPath, 'utf8'));
          writeSensitiveFile(plainPath, value);
          if (readFileSync(plainPath, 'utf8') !== value) throw new SecretDecryptError(name);
        }
        rmSync(encPath, { force: true });
        exported.push(name);
      } catch {
        failed.push(name);
      }
    }
    return { exported, failed };
  }
}

// --- opening -------------------------------------------------------------------

export interface OpenSecretStoreOptions {
  /** The data directory (`MONSTERS_HOME`). */
  home: string;
  env?: NodeJS.ProcessEnv;
  /** Overrides `MONSTERS_SECRETS`. */
  mode?: SecretsMode;
  /** The keychain (tests: a fake one). Default: the native module, loaded now. */
  keychain?: Keychain | (() => Promise<Keychain>);
  /** Deadline of each keychain call. Default `MONSTERS_SECRETS_TIMEOUT_MS` or 20 s. */
  timeoutMs?: number;
  /** Keychain service name. Default "Monsters" (tests use their own). */
  service?: string;
  now?: () => Date;
  /**
   * The explicit step (`monsters secrets reset`): the keychain has no key for this home
   * and some encrypted secrets have no plain copy. Without it the core does not make a
   * new key (a keychain that wrongly says "no entry" would get its real key overwritten)
   * and goes on with files; with it those files are set aside, but only once the new key
   * has been saved and read back.
   */
  resetKey?: boolean;
  /** Test hook: the account of the first versions (default `legacySecretsAccount`). */
  legacyAccount?: string;
  /**
   * Aborted when the core is asked to stop while it starts: a keychain call in progress
   * (e.g. waiting for the password prompt of a locked keyring) is killed at once and the
   * start fails with `KeychainAbortedError`.
   */
  signal?: AbortSignal;
}

export interface OpenedSecretStore {
  store: SecretStore;
  /** Plain secrets encrypted at this start. */
  migrated: string[];
}

type Probe =
  | { kind: 'file'; status: FileStatus }
  | {
      kind: 'keychain';
      keychain: Keychain;
      name: string;
      service: string;
      account: string;
      ms: number;
      /** The master key in the keychain, or null when there is none yet. */
      stored: string | null;
    };

/** Which backend applies, reading the keychain once (never creating anything). */
async function probe(options: OpenSecretStoreOptions, mode: SecretsMode): Promise<Probe> {
  if (mode === 'file') return { kind: 'file', status: { reason: 'forced' } };
  const env = options.env ?? process.env;
  const ms = options.timeoutMs ?? keychainTimeout(env);
  const service = options.service ?? SECRETS_SERVICE;
  const account = secretsAccount(options.home);
  let keychain: Keychain;
  try {
    const k = options.keychain ?? loadNativeKeychain;
    keychain = typeof k === 'function' ? await k() : k;
  } catch (err) {
    return { kind: 'file', status: failure('unavailable', keychainName(), err) };
  }
  try {
    const stored = await withKeychainTimeout(
      (s) => keychain.get(service, account, s),
      ms,
      options.signal,
    );
    const legacy = options.legacyAccount ?? legacySecretsAccount(options.home);
    if (stored === null && legacy !== account) {
      // A key saved by M3.2 under the path as it was typed: read it there (never moved).
      const old = await withKeychainTimeout(
        (s) => keychain.get(service, legacy, s),
        ms,
        options.signal,
      );
      if (old !== null) {
        return {
          kind: 'keychain',
          keychain,
          name: keychain.name,
          service,
          account: legacy,
          ms,
          stored: old,
        };
      }
    }
    return { kind: 'keychain', keychain, name: keychain.name, service, account, ms, stored };
  } catch (err) {
    if (err instanceof KeychainAbortedError) throw err;
    const reason = err instanceof KeychainTimeoutError ? 'timeout' : 'unavailable';
    return { kind: 'file', status: failure(reason, keychain.name, err) };
  }
}

function failure(reason: FileStatus['reason'], keychain: string, err: unknown): FileStatus {
  return { reason, keychain, detail: err instanceof Error ? err.message : String(err) };
}

function fileFallback(dir: string, mode: SecretsMode, status: FileStatus): OpenedSecretStore {
  if (mode === 'keychain') {
    throw new Error(
      `portachiavi richiesto (MONSTERS_SECRETS=keychain) ma non usabile: ${status.detail ?? status.reason}`,
    );
  }
  return { store: new FileSecretStore(dir, status), migrated: [] };
}

function timestamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

/** Moves encrypted files nobody can open anymore aside (never deleted: the old keychain may come back). */
function quarantine(dir: string, names: string[], now: Date): void {
  const target = join(dir, `${QUARANTINE_PREFIX}${timestamp(now)}`);
  mkdirSync(target, { recursive: true, mode: DIR_MODE });
  chmodSafe(target, DIR_MODE);
  for (const name of names) {
    renameSync(join(dir, name + ENC_SUFFIX), join(target, name + ENC_SUFFIX));
  }
}

/**
 * Opens the secrets of a data directory: the keychain when it answers (master
 * key read or created, plain secrets migrated), otherwise the declared file
 * fallback with the reason. Never waits on the keychain longer than the
 * deadline; with `MONSTERS_SECRETS=keychain` a missing keychain is an error.
 */
export async function openSecretStore(options: OpenSecretStoreOptions): Promise<OpenedSecretStore> {
  const mode = options.mode ?? secretsMode(options.env ?? process.env);
  const dir = homePaths(options.home).secrets;
  ensureDir(dir);
  removeStaleTemp(dir);
  const p = await probe(options, mode);
  if (p.kind === 'file') return fileFallback(dir, mode, p.status);

  let key: Buffer | null;
  const quarantined: string[] = [];
  if (p.stored !== null) {
    key = parseMasterKey(p.stored);
    if (!key) {
      return fileFallback(dir, mode, {
        reason: 'error',
        keychain: p.name,
        detail: 'la chiave nel portachiavi non è valida',
      });
    }
  } else {
    // No key for this home: keychain reset, data directory copied from another machine,
    // or a keychain that answered "no entry" by mistake. Encrypted secrets without a
    // plain copy would be lost with a new key (and a wrong "no entry" would overwrite the
    // real one): never without the explicit step. The user can also save them again,
    // then nothing is lost and the new key is made at the next start.
    const { plain, encrypted } = listDir(dir);
    const locked = encrypted.filter((n) => !plain.includes(n));
    if (locked.length > 0 && !options.resetKey) {
      return fileFallback(dir, mode, {
        reason: 'missing-key',
        keychain: p.name,
        detail: `il portachiavi non ha la chiave di questa cartella; cifrate: ${locked.join(', ')}`,
      });
    }
    const freshKey = randomBytes(32);
    const fresh = freshKey.toString('base64');
    try {
      await withKeychainTimeout(
        (s) => p.keychain.set(p.service, p.account, fresh, s),
        p.ms,
        options.signal,
      );
      const back = await withKeychainTimeout(
        (s) => p.keychain.get(p.service, p.account, s),
        p.ms,
        options.signal,
      );
      if (back !== fresh)
        throw new Error('il portachiavi non restituisce la chiave appena salvata');
    } catch (err) {
      if (err instanceof KeychainAbortedError) throw err;
      // Nothing was moved: the encrypted files are where they were.
      const reason = err instanceof KeychainTimeoutError ? 'timeout' : 'error';
      return fileFallback(dir, mode, failure(reason, p.name, err));
    }
    key = freshKey;
    // Only now, with the new key saved and read back, what it cannot open goes aside.
    if (locked.length > 0) {
      quarantine(dir, locked, (options.now ?? (() => new Date()))());
      quarantined.push(...locked);
    }
  }

  const store = new KeychainSecretStore(dir, key, p.name, quarantined);
  return { store, migrated: store.migrate() };
}

export interface SecretsReport {
  status: SecretsStatus;
  /** Plain secrets on disk (with the keychain: waiting to be encrypted at the next start). */
  plain: string[];
  encrypted: string[];
  /** Whether the keychain holds the master key of this home (unknown without a keychain). */
  masterKey: 'present' | 'missing' | 'unknown';
}

/** What `openSecretStore` would find, without creating keys or moving files (CLI). */
export async function inspectSecrets(options: OpenSecretStoreOptions): Promise<SecretsReport> {
  const mode = options.mode ?? secretsMode(options.env ?? process.env);
  const dir = homePaths(options.home).secrets;
  const { plain, encrypted } = listDir(dir);
  const p = await probe(options, mode);
  if (p.kind === 'file') {
    return {
      status: new FileSecretStore(dir, p.status).status(),
      plain,
      encrypted,
      masterKey: 'unknown',
    };
  }
  const key = p.stored === null ? null : parseMasterKey(p.stored);
  const locked = encrypted.filter((n) => !plain.includes(n));
  if (p.stored === null && locked.length > 0) {
    // What openSecretStore does: files, until they are saved again or `secrets reset`.
    return {
      status: {
        backend: 'file',
        reason: 'missing-key',
        keychain: p.name,
        detail: `il portachiavi non ha la chiave di questa cartella; cifrate: ${locked.join(', ')}`,
        unreadable: locked,
      },
      plain,
      encrypted,
      masterKey: 'missing',
    };
  }
  if (!key) {
    return {
      status: {
        backend: 'keychain',
        reason: p.stored === null ? 'keychain' : 'error',
        keychain: p.name,
        ...(p.stored !== null ? { detail: 'la chiave nel portachiavi non è valida' } : {}),
        // Without the key nothing encrypted can be opened.
        unreadable: locked,
      },
      plain,
      encrypted,
      masterKey: p.stored === null ? 'missing' : 'present',
    };
  }
  const status = new KeychainSecretStore(dir, key, p.name).status();
  return { status, plain, encrypted, masterKey: 'present' };
}

/**
 * Turns the encrypted secrets of a home back into plain files (mode 600), e.g.
 * before moving the data directory to another machine. The caller holds the
 * home lock (no core running). The master key stays in the keychain: without
 * `MONSTERS_SECRETS=file` the next start encrypts the files again.
 */
export async function exportSecretsToFiles(
  options: OpenSecretStoreOptions,
): Promise<{ exported: string[]; failed: string[]; status: SecretsStatus }> {
  const dir = homePaths(options.home).secrets;
  const mode = options.mode ?? secretsMode(options.env ?? process.env);
  // Probe with the keychain even under MONSTERS_SECRETS=file: that is when export is useful.
  const p = await probe(options, mode === 'file' ? 'auto' : mode);
  const key = p.kind === 'keychain' && p.stored !== null ? parseMasterKey(p.stored) : null;
  if (p.kind === 'file' || !key) {
    const status =
      p.kind === 'file'
        ? new FileSecretStore(dir, p.status).status()
        : new FileSecretStore(dir, { reason: 'error', keychain: p.name }).status();
    return { exported: [], failed: status.unreadable, status };
  }
  const store = new KeychainSecretStore(dir, key, p.name);
  const result = store.exportToFiles();
  return { ...result, status: new FileSecretStore(dir).status() };
}

// --- registry ------------------------------------------------------------------

/*
 * The store opened by the hub, by `secrets/` directory. The helpers that take
 * a `secretsDir` (readProviderKey, readOpenRouterKey…) find it here; without
 * one (tests that build a service alone) they use plain files, as before.
 */
const registry = new Map<string, SecretStore>();

export function registerSecretStore(store: SecretStore): () => void {
  const key = resolve(store.dir);
  registry.set(key, store);
  return () => {
    if (registry.get(key) === store) registry.delete(key);
  };
}

export function secretStoreFor(secretsDir: string): SecretStore {
  return registry.get(resolve(secretsDir)) ?? new FileSecretStore(secretsDir);
}
