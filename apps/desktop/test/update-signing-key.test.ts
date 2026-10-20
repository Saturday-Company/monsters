import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keyId, publicKeyFromPem } from '../src/main/update-signature.ts';
import { APP } from '../scripts/package-config.ts';
import {
  decryptSigningKey,
  encryptSigningKey,
  isEncryptedKeyFile,
  KEY_FILE_FORMAT,
  SCRYPT_COST,
} from '../scripts/signing-key-file.ts';
import {
  encryptExisting,
  generate,
  isInside,
  newPassphrase,
} from '../scripts/update-signing-key.ts';
import { tempDir } from './helpers.ts';

/** A cheap cost for the tests (the real one takes 1 GiB and seconds per try). */
const CHEAP = { N: 2 ** 12, r: 8, p: 1 };
const PASS = 'quattro parole a caso';
const repo = resolve(APP, '..', '..');

describe('update signing key pair (S-A4)', () => {
  it('writes the private key outside the repo only, mode 600, never over another one', () => {
    const dir = tempDir();
    const out = join(dir, 'keys', 'monsters-update.key');
    const { pem, id } = generate(out, { repo, passphrase: null });
    // Windows has no POSIX modes.
    if (process.platform !== 'win32') expect(statSync(out).mode & 0o777).toBe(0o600);
    const priv = createPrivateKey(readFileSync(out, 'utf8'));
    expect(keyId(priv)).toBe(id);
    expect(readFileSync(`${out}.pub`, 'utf8')).toBe(pem);
    expect(keyId(publicKeyFromPem(pem))).toBe(id);
    expect(pem).not.toMatch(/PRIVATE/);
    expect(() => generate(out, { passphrase: null })).toThrow(/EEXIST/);
  });

  it('refuses a path inside the repo, also through ..', () => {
    expect(() =>
      generate(join(repo, 'apps', 'desktop', 'release.key'), { repo, passphrase: null }),
    ).toThrow(/inside the repo/);
    expect(isInside(join(repo, 'x', '..', 'y.key'), repo)).toBe(true);
    expect(isInside(join(repo, '..', 'elsewhere.key'), repo)).toBe(false);
  });

  it('encrypts with node:crypto only: the file holds no key in the clear', () => {
    const out = join(tempDir(), 'monsters-update.key');
    const { id } = generate(out, { repo, passphrase: PASS, cost: CHEAP });
    const text = readFileSync(out, 'utf8');
    // Windows has no POSIX modes.
    if (process.platform !== 'win32') expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(text).not.toMatch(/PRIVATE KEY/);
    expect(isEncryptedKeyFile(text)).toBe(true);
    expect(JSON.parse(text)).toMatchObject({
      format: KEY_FILE_FORMAT,
      kdf: 'scrypt',
      ...CHEAP,
      cipher: 'aes-256-gcm',
    });
    expect(keyId(decryptSigningKey(text, PASS, CHEAP))).toBe(id);
  });
});

describe('the encrypted key file (review of wave 5, item 3)', () => {
  const key = generateKeyPairSync('ed25519').privateKey;

  it('a new file has the high cost: scrypt N=2^20, r=8', () => {
    expect(SCRYPT_COST).toEqual({ N: 2 ** 20, r: 8, p: 1 });
  });

  it('refuses a wrong passphrase, a changed file, a cheaper cost, a short passphrase', () => {
    const text = encryptSigningKey(key, PASS, CHEAP);
    expect(() => decryptSigningKey(text, 'quattro parole a casa', CHEAP)).toThrow(
      /wrong passphrase/,
    );
    const o = JSON.parse(text) as Record<string, unknown>;
    // A parameter changed: the tag covers it.
    const salt = Buffer.from(o['salt'] as string, 'base64');
    salt[0] = (salt[0] ?? 0) ^ 1;
    expect(() =>
      decryptSigningKey(JSON.stringify({ ...o, salt: salt.toString('base64') }), PASS, CHEAP),
    ).toThrow(/wrong passphrase|changed/);
    const ct = Buffer.from(o['ciphertext'] as string, 'base64');
    ct[3] = (ct[3] ?? 0) ^ 1;
    expect(() =>
      decryptSigningKey(JSON.stringify({ ...o, ciphertext: ct.toString('base64') }), PASS, CHEAP),
    ).toThrow(/wrong passphrase|changed/);
    // Below the floor (the default floor is the cost of a new file).
    expect(() => decryptSigningKey(text, PASS)).toThrow(/scrypt cost/);
    expect(() => decryptSigningKey(JSON.stringify({ ...o, N: 2 ** 25 }), PASS, CHEAP)).toThrow(
      /scrypt cost/,
    );
    expect(() => encryptSigningKey(key, 'corta', CHEAP)).toThrow(/at least 12/);
    expect(() =>
      encryptSigningKey(
        generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey,
        PASS,
        CHEAP,
      ),
    ).toThrow(/Ed25519/);
  });

  it('an existing plain key is encrypted into a new file', () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    const plain = join(dir, 'old.pem');
    writeFileSync(plain, key.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
    const out = join(dir, 'new.key');
    const id = encryptExisting(plain, out, { repo, passphrase: PASS, cost: CHEAP });
    expect(id).toBe(keyId(key));
    expect(keyId(decryptSigningKey(readFileSync(out, 'utf8'), PASS, CHEAP))).toBe(id);
  });

  it('the passphrase of a new key is asked twice, and must be long enough', async () => {
    const answers =
      (...a: string[]) =>
      () =>
        Promise.resolve(a.shift() ?? '');
    await expect(newPassphrase(answers(PASS, PASS))).resolves.toBe(PASS);
    await expect(newPassphrase(answers(PASS, 'altro'))).rejects.toThrow(/differ/);
    await expect(newPassphrase(answers('corta'))).rejects.toThrow(/at least 12/);
  });
});
