/*
 * The release key of the update feed, encrypted at rest (review of wave 5, item 3; docs/signing.md
 * "Update signing"). Only node:crypto: the plain key never goes to another program
 * (before, `openssl` found in the PATH got it on its stdin, and a `~/.local/bin/openssl` written
 * by a monster with a terminal would have had key and passphrase).
 *
 * The file is JSON, one object:
 *
 *   {
 *     "format": "monsters-update-key-v1",
 *     "kdf": "scrypt", "N": 1048576, "r": 8, "p": 1, "salt": "<base64, 16 bytes>",
 *     "cipher": "aes-256-gcm", "iv": "<base64, 12 bytes>",
 *     "ciphertext": "<base64: the Ed25519 private key, PKCS#8 DER>",
 *     "tag": "<base64, 16 bytes>"
 *   }
 *
 * key = scrypt(passphrase NFC, salt, 32 bytes, N, r, p); the AAD of AES-256-GCM is the JSON of
 * the fields before `ciphertext`, in that order, so no parameter can be changed without the tag
 * failing. N = 2^20 (1 GiB of memory, a few seconds per try on a desktop CPU): a passphrase of a few
 * words does not fall offline, unlike openssl's PBKDF2 with 2048 iterations.
 *
 * The passphrase is asked on the terminal (/dev/tty, without echo), never read from the
 * environment or from stdin.
 */
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  randomBytes,
  scryptSync,
  type KeyObject,
} from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { ReadStream, WriteStream } from 'node:tty';

export const KEY_FILE_FORMAT = 'monsters-update-key-v1';

export interface ScryptCost {
  N: number;
  r: number;
  p: number;
}

/** The cost of a new file, and the least a file may have to be opened. */
export const SCRYPT_COST: ScryptCost = { N: 2 ** 20, r: 8, p: 1 };
/** A passphrase shorter than this is refused when a key is encrypted. */
export const MIN_PASSPHRASE = 12;

interface KeyFileHeader {
  format: typeof KEY_FILE_FORMAT;
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  cipher: 'aes-256-gcm';
  iv: string;
}

const derive = (passphrase: string, salt: Buffer, c: ScryptCost): Buffer =>
  scryptSync(passphrase.normalize('NFC'), salt, 32, {
    N: c.N,
    r: c.r,
    p: c.p,
    maxmem: 128 * c.N * c.r * c.p + 32 * 1024 * 1024,
  });

const aad = (h: KeyFileHeader): Buffer =>
  Buffer.from(
    JSON.stringify({
      format: h.format,
      kdf: h.kdf,
      N: h.N,
      r: h.r,
      p: h.p,
      salt: h.salt,
      cipher: h.cipher,
      iv: h.iv,
    }),
  );

/** The text of an encrypted key file for `key` (an Ed25519 private key). */
export function encryptSigningKey(
  key: KeyObject,
  passphrase: string,
  cost: ScryptCost = SCRYPT_COST,
): string {
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
    throw new Error('only an Ed25519 private key is encrypted');
  }
  if ([...passphrase].length < MIN_PASSPHRASE) {
    throw new Error(`the passphrase needs at least ${MIN_PASSPHRASE} characters`);
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header: KeyFileHeader = {
    format: KEY_FILE_FORMAT,
    kdf: 'scrypt',
    ...cost,
    salt: salt.toString('base64'),
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
  };
  const k = derive(passphrase, salt, cost);
  const der = key.export({ format: 'der', type: 'pkcs8' });
  try {
    const c = createCipheriv('aes-256-gcm', k, iv);
    c.setAAD(aad(header));
    const ciphertext = Buffer.concat([c.update(der), c.final()]);
    return `${JSON.stringify(
      {
        ...header,
        ciphertext: ciphertext.toString('base64'),
        tag: c.getAuthTag().toString('base64'),
      },
      null,
      2,
    )}\n`;
  } finally {
    k.fill(0);
    der.fill(0);
  }
}

/** Whether `text` is an encrypted key file of this format (not necessarily a valid one). */
export function isEncryptedKeyFile(text: string): boolean {
  try {
    return (JSON.parse(text) as { format?: unknown }).format === KEY_FILE_FORMAT;
  } catch {
    return false;
  }
}

const b64 = (v: unknown, bytes: number | null, what: string): Buffer => {
  if (typeof v !== 'string') throw new Error(`key file: no ${what}`);
  const b = Buffer.from(v, 'base64');
  if (b.toString('base64') !== v || (bytes !== null && b.length !== bytes)) {
    throw new Error(`key file: bad ${what}`);
  }
  return b;
};

/**
 * The private key of an encrypted key file. Throws on a wrong passphrase (or a changed file),
 * and on a file whose scrypt cost is below `minCost` (default: the cost of a new file).
 */
export function decryptSigningKey(
  text: string,
  passphrase: string,
  minCost: ScryptCost = SCRYPT_COST,
): KeyObject {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('key file: not JSON');
  }
  if (o['format'] !== KEY_FILE_FORMAT) throw new Error('key file: unknown format');
  if (o['kdf'] !== 'scrypt' || o['cipher'] !== 'aes-256-gcm') {
    throw new Error('key file: unknown kdf or cipher');
  }
  const cost = { N: o['N'], r: o['r'], p: o['p'] };
  if (
    !Number.isInteger(cost.N) ||
    !Number.isInteger(cost.r) ||
    !Number.isInteger(cost.p) ||
    (cost.N as number) < minCost.N ||
    (cost.r as number) < minCost.r ||
    (cost.p as number) < minCost.p ||
    (cost.N as number) > 2 ** 24 ||
    (cost.r as number) > 32 ||
    (cost.p as number) > 16
  ) {
    throw new Error('key file: scrypt cost out of range');
  }
  const salt = b64(o['salt'], 16, 'salt');
  const iv = b64(o['iv'], 12, 'iv');
  const tag = b64(o['tag'], 16, 'tag');
  const ciphertext = b64(o['ciphertext'], null, 'ciphertext');
  const header: KeyFileHeader = {
    format: KEY_FILE_FORMAT,
    kdf: 'scrypt',
    N: cost.N as number,
    r: cost.r as number,
    p: cost.p as number,
    salt: o['salt'] as string,
    cipher: 'aes-256-gcm',
    iv: o['iv'] as string,
  };
  const k = derive(passphrase, salt, header);
  let der: Buffer;
  try {
    const d = createDecipheriv('aes-256-gcm', k, iv);
    d.setAAD(aad(header));
    d.setAuthTag(tag);
    der = Buffer.concat([d.update(ciphertext), d.final()]);
  } catch {
    throw new Error('key file: wrong passphrase, or the file was changed');
  } finally {
    k.fill(0);
  }
  try {
    const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('key file: not an Ed25519 key');
    return key;
  } finally {
    der.fill(0);
  }
}

/** Asks a passphrase on the terminal. */
export type AskPassphrase = (prompt: string) => Promise<string>;

/**
 * A line typed on the controlling terminal (/dev/tty), without echo: not stdin, which a pipe or
 * another program can feed, and never an environment variable. Ctrl-C or Ctrl-D cancel.
 */
export const askOnTerminal: AskPassphrase = (prompt) => {
  if (process.platform === 'win32') {
    return Promise.reject(
      new Error('no terminal to ask the passphrase on: use MONSTERS_UPDATE_SIGNING_KEY_CMD'),
    );
  }
  let inFd: number | null = null;
  let outFd: number;
  try {
    inFd = openSync('/dev/tty', 'r');
    outFd = openSync('/dev/tty', 'w');
  } catch {
    if (inFd !== null) closeSync(inFd);
    return Promise.reject(new Error('no terminal (/dev/tty) to ask the passphrase on'));
  }
  const input = new ReadStream(inFd);
  const output = new WriteStream(outFd);
  return new Promise<string>((resolve, reject) => {
    let typed = '';
    const finish = (err: Error | null) => {
      input.off('data', onData);
      try {
        input.setRawMode(false);
      } catch {
        // the terminal went away
      }
      output.write('\n');
      // The streams close their descriptors.
      input.destroy();
      output.destroy();
      if (err) reject(err);
      else resolve(typed);
    };
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return finish(null);
        if (ch === '\u0003' || (ch === '\u0004' && typed === '')) {
          return finish(new Error('passphrase not given'));
        }
        if (ch === '\u007f' || ch === '\b') typed = [...typed].slice(0, -1).join('');
        else if (ch === '\u0015') typed = '';
        else if (ch >= ' ') typed += ch;
      }
    };
    output.write(prompt);
    input.setRawMode(true);
    input.on('data', onData);
  });
};
