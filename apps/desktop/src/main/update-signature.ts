/*
 * Our own signature of the update feed (review 18/10, S-A4), independent of the Cloudflare
 * account that hosts it: whoever can write to the R2 bucket cannot make the apps install a
 * package that was not signed with the release key.
 *
 * What is signed: each channel file (`alpha-linux.yml`, `alpha-mac.yml`, `alpha.yml`…), which
 * lists every package with its sha512. electron-updater checks the downloaded package against
 * that sha512, so a valid signature on the channel file covers the packages too. The signature
 * sits next to it as `<channel file>.sig`:
 *
 *   monsters-update-signature-v1
 *   key <key id> <base64 Ed25519 signature>
 *
 * (one `key` line per signing key, so a key can be rotated with two signatures for a while). The
 * signed message binds the file name: `monsters-update-signature-v1\n<channel file>\n<bytes>`,
 * so the signed file of another channel or platform (beta-linux.yml served as alpha-linux.yml)
 * does not verify. The key id is the first 16 hex digits of the sha256 of the raw 32-byte public
 * key: a hint for the logs, every trusted key is tried anyway.
 *
 * The public keys the app trusts are PEM files in `resources/update-keys/` (written by package.ts:
 * the release keys of build-resources/update-keys, plus a test key only in update e2e builds).
 * The .deb's root script verifies the same signature again with openssl and the copy of those
 * keys in /opt/Monsters/resources (deb-install.ts).
 *
 * One read (review of wave 5, item 1): the app fetches the channel file and its `.sig` once
 * (`verifyChannel`, called by the provider of signed-provider.ts), and electron-updater is handed
 * that same parsed object: it never reads the feed's channel file itself, so a feed cannot
 * answer the check with the signed file and electron-updater with another one. The parse is
 * strict: every file has a sha512 (no sha256-only entry, no `packages`), and the legacy
 * single-file fields `path`/`sha512` must name one of `files`, so electron-updater's own
 * fallback to them (Provider.getFileList) can never pick something else.
 *
 * Signing (publish-update.ts) and verification share this module; no Electron imports, the
 * network comes in as a function (tests: a fake; the app: Electron's net.fetch).
 */
import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export const SIGNATURE_HEADER = 'monsters-update-signature-v1';
export const SIGNATURE_SUFFIX = '.sig';
/** Folder of the trusted public keys in the app's resources. */
export const UPDATE_KEYS_DIR = 'update-keys';
/** Channel files are a few hundred bytes; anything much larger is not one. */
const MAX_CHANNEL_BYTES = 1024 * 1024;
const MAX_SIGNATURE_BYTES = 16 * 1024;

/** The bytes that are signed for a channel file. */
export function signedMessage(channelFile: string, content: Uint8Array | string): Buffer {
  return Buffer.concat([
    Buffer.from(`${SIGNATURE_HEADER}\n${channelFile}\n`, 'utf8'),
    typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content),
  ]);
}

function assertEd25519(key: KeyObject, what: string): void {
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`${what}: not an Ed25519 key (${key.asymmetricKeyType ?? key.type})`);
  }
}

/** The id of a key (public, or private: its public half): 16 hex digits. */
export function keyId(key: KeyObject): string {
  const pub = key.type === 'private' ? createPublicKey(key) : key;
  assertEd25519(pub, 'key id');
  const raw = Buffer.from((pub.export({ format: 'jwk' }) as { x: string }).x, 'base64url');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/** A trusted public key from its PEM text; throws when it is not an Ed25519 public key. */
export function publicKeyFromPem(pem: string, what = 'public key'): KeyObject {
  const key = createPublicKey(pem);
  assertEd25519(key, what);
  return key;
}

/**
 * The trusted keys of a build: every `*.pem` of the folder. Empty when there is none. A file that
 * is not an Ed25519 public key is skipped and told through `onBad` (the other keys still count:
 * one broken file must not stop every update).
 */
export function loadPublicKeys(
  dir: string,
  onBad: (file: string, error: string) => void = () => {},
): KeyObject[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.pem'));
  } catch {
    return [];
  }
  const keys: KeyObject[] = [];
  for (const n of names.sort()) {
    try {
      keys.push(publicKeyFromPem(readFileSync(join(dir, n), 'utf8'), n));
    } catch (err) {
      onBad(n, (err as Error).message.split('\n')[0] ?? 'unreadable');
    }
  }
  return keys;
}

/** The `.sig` file of a channel file, signed with each of `keys` (private Ed25519 keys). */
export function signChannelFile(
  channelFile: string,
  content: Uint8Array | string,
  keys: readonly KeyObject[],
): string {
  if (keys.length === 0) throw new Error('no signing key');
  const message = signedMessage(channelFile, content);
  const lines = keys.map((k) => {
    if (k.type !== 'private') throw new Error('signing needs a private key');
    assertEd25519(k, 'signing key');
    return `key ${keyId(k)} ${sign(null, message, k).toString('base64')}`;
  });
  return `${SIGNATURE_HEADER}\n${lines.join('\n')}\n`;
}

export type SignatureCheck =
  | { ok: true; keyId: string }
  | { ok: false; reason: 'missing' | 'malformed' | 'unknown-key' | 'invalid' | 'no-keys' };

/** Whether `signature` (the `.sig` text) is a valid signature of the channel file by a trusted key. */
export function verifyChannelFile(
  channelFile: string,
  content: Uint8Array | string,
  signature: string | null,
  keys: readonly KeyObject[],
): SignatureCheck {
  if (keys.length === 0) return { ok: false, reason: 'no-keys' };
  if (signature === null || signature.trim() === '') return { ok: false, reason: 'missing' };
  const lines = signature.split('\n').map((l) => l.trim());
  if (lines[0] !== SIGNATURE_HEADER) return { ok: false, reason: 'malformed' };
  const entries = lines
    .slice(1)
    .filter(Boolean)
    .map((l) => /^key ([0-9a-f]{16}) ([A-Za-z0-9+/]+={0,2})$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ id: m[1]!, sig: Buffer.from(m[2]!, 'base64') }))
    .filter((e) => e.sig.length === 64);
  if (entries.length === 0) return { ok: false, reason: 'malformed' };
  const message = signedMessage(channelFile, content);
  const trusted = keys.map((k) => ({ key: k, id: keyId(k) }));
  for (const e of entries) {
    for (const t of trusted) {
      if (verify(null, message, t.key, e.sig)) return { ok: true, keyId: t.id };
    }
  }
  const known = entries.some((e) => trusted.some((t) => t.id === e.id));
  return { ok: false, reason: known ? 'invalid' : 'unknown-key' };
}

/**
 * The channel file electron-updater reads for a channel on this system (Provider.
 * getCustomChannelName): `alpha.yml` on Windows, `alpha-mac.yml`, `alpha-linux.yml` (x64) or
 * `alpha-linux-arm64.yml`.
 */
export function channelFileName(channel: string, platform: NodeJS.Platform, arch: string): string {
  if (platform === 'linux') return `${channel}-linux${arch === 'x64' ? '' : `-${arch}`}.yml`;
  return platform === 'darwin' ? `${channel}-mac.yml` : `${channel}.yml`;
}

/** A package of a channel file: its url (relative to the feed) and its sha512 (base64). */
export interface SignedFile {
  url: string;
  sha512: string;
}

/** What of a channel file decides what is downloaded: the version and every file's sha512. */
export interface SignedChannel {
  version: string;
  files: SignedFile[];
  /** The legacy single-file fields, when present (always one of `files`). */
  path?: string;
  sha512?: string;
}

/** A sha512 as electron-builder writes it: base64 of 64 bytes. */
const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A channel file, parsed once and checked: `info` is the object electron-updater is given
 * (nothing parses the bytes again), `signed` what decides the download. Throws when the file is
 * not one the app accepts:
 * - no `version`, no `files` or an empty list (electron-updater would fall back to `path`);
 * - a file without url, or without a sha512 in electron-builder's form (with a sha256 `sha2`
 *   alone, that is what electron-updater would check), or the same url twice;
 * - `sha2` anywhere, `packages` (the NSIS web installer, not built here);
 * - a legacy `path` that is not one of `files`, a top-level `sha512` without `path` or other
 *   than the one of that file.
 */
export function parseChannel(text: string): {
  info: Record<string, unknown>;
  signed: SignedChannel;
} {
  const o: unknown = parseYaml(text);
  if (!isRecord(o)) throw new Error('not a channel file');
  const version = o['version'];
  if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('no version');
  if ('sha2' in o) throw new Error('a sha256 (sha2) instead of a sha512');
  if ('packages' in o) throw new Error('packages are not accepted');
  const list = o['files'];
  if (!Array.isArray(list) || list.length === 0) throw new Error('no files');
  const files = list.map((f: unknown) => {
    if (!isRecord(f)) throw new Error('a file entry that is not an object');
    const url = f['url'];
    const sha512 = f['sha512'];
    if (typeof url !== 'string' || url === '') throw new Error('a file without url');
    if (typeof sha512 !== 'string' || !SHA512_BASE64.test(sha512)) {
      throw new Error(`${url} has no sha512`);
    }
    if ('sha2' in f) throw new Error(`${url} has a sha256 (sha2)`);
    return { url, sha512 };
  });
  if (new Set(files.map((f) => f.url)).size !== files.length) {
    throw new Error('a file listed twice');
  }
  const signed: SignedChannel = { version, files };
  if ('path' in o) {
    const path = o['path'];
    const file = typeof path === 'string' ? files.find((f) => f.url === path) : undefined;
    if (!file) throw new Error('path is not one of the files');
    signed.path = file.url;
    if ('sha512' in o) {
      if (o['sha512'] !== file.sha512) throw new Error('sha512 is not the one of path');
      signed.sha512 = file.sha512;
    }
  } else if ('sha512' in o) {
    throw new Error('sha512 without path');
  }
  return { info: o, signed };
}

/** The fields of a signed channel file; throws when it is not one (see `parseChannel`). */
export function parseSignedChannel(text: string): SignedChannel {
  return parseChannel(text).signed;
}

/** The update info electron-updater works with. */
export interface UpdateInfoLike {
  version: string;
  files?: readonly { url: string; sha512?: string; sha2?: string }[];
  path?: string;
  sha512?: string;
  sha2?: string;
  packages?: unknown;
}

/**
 * Why the info electron-updater works with is not the signed one (null: it is). Defense in depth
 * behind the single read: the list is rebuilt as electron-updater does (Provider.getFileList:
 * `files`, or else the legacy `path` with its `sha2`/`sha512`), and every entry of it must have
 * a sha512 and be in the signed file with that url and that sha512.
 */
export function infoMismatch(info: UpdateInfoLike, signed: SignedChannel): string | null {
  if (info.version !== signed.version) {
    return `version ${info.version}, the signed file says ${signed.version}`;
  }
  if (info.packages !== undefined && info.packages !== null) return 'packages are not signed';
  const effective =
    info.files && info.files.length > 0
      ? info.files
      : info.path !== undefined
        ? [{ url: info.path, sha512: info.sha512, sha2: info.sha2 }]
        : [];
  // Nothing to download from (electron-updater throws ERR_UPDATER_NO_FILES_PROVIDED): nothing
  // unsigned can come of it. The file actually downloaded is checked on its own (`downloadMismatch`).
  for (const f of effective) {
    if (typeof f.sha512 !== 'string') return `${f.url} has no sha512`;
    if (!signed.files.some((s) => s.url === f.url && s.sha512 === f.sha512)) {
      return `${f.url} is not in the signed file with that sha512`;
    }
  }
  if (info.path !== undefined && info.path !== signed.path) return `path ${info.path} not signed`;
  if (info.sha512 !== undefined && info.sha512 !== signed.sha512) return 'sha512 not signed';
  return null;
}

/** Why a downloaded file is not one of the signed packages (null: it is), from its sha512. */
export function downloadMismatch(
  file: string,
  sha512: string,
  signed: SignedChannel,
): string | null {
  if (signed.files.some((f) => f.sha512 === sha512)) return null;
  return `${file.split(/[\\/]/).pop() ?? file}: its sha512 is not in the signed file`;
}

/** A channel file whose signature checked out: what the app may download, and the proof. */
export interface VerifiedRelease {
  version: string;
  channelFile: string;
  /** The signed bytes and their `.sig`, as fetched (the .deb's root script checks them again). */
  text: string;
  signature: string;
  keyId: string;
  signed: SignedChannel;
  /** The parsed signed file: the very object electron-updater is given (signed-provider.ts). */
  info?: Record<string, unknown>;
}

export type VerifyRefusal =
  'missing' | 'malformed' | 'unknown-key' | 'invalid' | 'no-keys' | 'mismatch' | 'fetch';

export type VerifyResult =
  | { ok: true; release: VerifiedRelease }
  | { ok: false; reason: VerifyRefusal; detail: string; version?: string };

/** GET of a small text file: its body, null on 404, throws on anything else. */
export type FetchText = (url: string) => Promise<string | null>;

export interface VerifyOptions {
  /** The feed (generic provider base URL). */
  feed: string | null;
  channelFile: string;
  keys: readonly KeyObject[];
  fetchText: FetchText;
  now?: () => number;
}

/** A URL of the feed, uncached (as electron-updater asks for the channel file). */
export function feedFileUrl(feed: string, name: string, now = Date.now()): string {
  const u = new URL(name, feed.endsWith('/') ? feed : `${feed}/`);
  u.search = `noCache=${now.toString(32)}`;
  return u.href;
}

/** The version a channel file claims, for the messages only (it is not trusted). */
function claimedVersion(text: string): { version?: string } {
  const m = /^version:\s*['"]?([0-9A-Za-z.+-]{1,64})['"]?\s*$/m.exec(text);
  return m?.[1] ? { version: m[1] } : {};
}

/**
 * Fetches the channel file and its `.sig` from the feed, once, and verifies the signature with
 * the trusted keys and the file with `parseChannel`. The release carries the parsed object to
 * hand to electron-updater.
 */
export async function verifyChannel(o: VerifyOptions): Promise<VerifyResult> {
  if (o.keys.length === 0) {
    return { ok: false, reason: 'no-keys', detail: 'this build has no update key' };
  }
  if (!o.feed) return { ok: false, reason: 'fetch', detail: 'no feed' };
  const now = (o.now ?? Date.now)();
  let text: string | null;
  let signature: string | null;
  try {
    [text, signature] = await Promise.all([
      o.fetchText(feedFileUrl(o.feed, o.channelFile, now)),
      o.fetchText(feedFileUrl(o.feed, `${o.channelFile}${SIGNATURE_SUFFIX}`, now)),
    ]);
  } catch (err) {
    return { ok: false, reason: 'fetch', detail: (err as Error).message.split('\n')[0] ?? '' };
  }
  if (text === null) return { ok: false, reason: 'fetch', detail: `no ${o.channelFile}` };
  if (Buffer.byteLength(text) > MAX_CHANNEL_BYTES) {
    return { ok: false, reason: 'malformed', detail: `${o.channelFile} too large` };
  }
  const v = claimedVersion(text);
  if (signature !== null && Buffer.byteLength(signature) > MAX_SIGNATURE_BYTES) {
    return { ok: false, reason: 'malformed', detail: 'signature too large', ...v };
  }
  const check = verifyChannelFile(o.channelFile, text, signature, o.keys);
  if (!check.ok) {
    return { ok: false, reason: check.reason, detail: `${o.channelFile}${SIGNATURE_SUFFIX}`, ...v };
  }
  let parsed: ReturnType<typeof parseChannel>;
  try {
    parsed = parseChannel(text);
  } catch (err) {
    return { ok: false, reason: 'malformed', detail: (err as Error).message, ...v };
  }
  return {
    ok: true,
    release: {
      version: parsed.signed.version,
      channelFile: o.channelFile,
      text,
      signature: signature ?? '',
      keyId: check.keyId,
      signed: parsed.signed,
      info: parsed.info,
    },
  };
}

/**
 * `verifyChannel`, then that `info` (what electron-updater is about to download) is what was
 * signed. For tools and tests: the app hands electron-updater the signed object itself.
 */
export async function verifyUpdate(info: UpdateInfoLike, o: VerifyOptions): Promise<VerifyResult> {
  const r = await verifyChannel(o);
  if (!r.ok) return r;
  const mismatch = infoMismatch(info, r.release.signed);
  if (mismatch) return { ok: false, reason: 'mismatch', detail: mismatch, version: info.version };
  return r;
}

/** A check refused by our signature: thrown by the provider, so electron-updater stops there. */
export class UpdateRefusedError extends Error {
  readonly reason: VerifyRefusal;
  readonly detail: string;
  readonly version: string | null;
  constructor(reason: VerifyRefusal, detail: string, version: string | null) {
    super(describeRefusal(version, reason));
    this.name = 'UpdateRefusedError';
    this.reason = reason;
    this.detail = detail;
    this.version = version;
  }
}

/** The refusal an error is, if it is one. */
export function refusalOf(err: unknown): UpdateRefusedError | null {
  return err instanceof UpdateRefusedError ? err : null;
}

/** The refusal in a few words for the user (the menu, the dialog after "Cerca aggiornamenti"). */
export function describeRefusal(version: string | null, reason: VerifyRefusal): string {
  if (version === null) {
    if (reason === 'no-keys') return describeRefusal('', reason);
    if (reason === 'fetch') {
      return 'non riesco a leggere l’aggiornamento e la sua firma: riprovo più tardi';
    }
    if (reason === 'missing') return 'l’aggiornamento non è firmato: non lo scarico';
    return 'la firma dell’aggiornamento non è valida: non lo scarico';
  }
  switch (reason) {
    case 'missing':
      return `l’aggiornamento ${version} non è firmato: non lo scarico`;
    case 'no-keys':
      return 'questa versione non ha la chiave per verificare gli aggiornamenti: scarica Monsters dal sito';
    case 'unknown-key':
      return `l’aggiornamento ${version} è firmato con una chiave che non conosco: non lo scarico`;
    case 'mismatch':
      return `l’aggiornamento ${version} non corrisponde a quello firmato: non lo scarico`;
    case 'fetch':
      return `non riesco a leggere la firma dell’aggiornamento ${version}: riprovo più tardi`;
    case 'malformed':
    case 'invalid':
      return `la firma dell’aggiornamento ${version} non è valida: non lo scarico`;
  }
}
