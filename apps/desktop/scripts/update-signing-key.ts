/*
 * The key pair of the update feed's signature (S-A4, docs/signing.md "Update signing").
 *
 *   node apps/desktop/scripts/update-signing-key.ts generate --out <key file> [--install] [--plain]
 *       a new Ed25519 key pair: the private key in <key file> (mode 600, never inside this repo,
 *       never over an existing file), encrypted with a passphrase asked twice on the terminal
 *       (signing-key-file.ts: scrypt N=2^20 + AES-256-GCM, only node:crypto, no other program
 *       ever sees the key); the public one in <key file>.pub and on stdout. Publishing then asks
 *       the passphrase again: MONSTERS_UPDATE_SIGNING_KEY_FILE=<key file>.
 *       --plain: a plain PKCS#8 PEM instead, for a signer that keeps it elsewhere (its own
 *       keychain, another computer) and prints it through MONSTERS_UPDATE_SIGNING_KEY_CMD.
 *       --install also copies the public key into apps/desktop/build-resources/update-keys/,
 *       where the builds take the keys they trust.
 *   node apps/desktop/scripts/update-signing-key.ts encrypt --in <private.pem> --out <key file>
 *       an existing plain key, encrypted the same way (the plain file is left to remove).
 *   node apps/desktop/scripts/update-signing-key.ts public
 *       the public key and id of the key that publish-update.ts would use
 *       (MONSTERS_UPDATE_SIGNING_KEY_FILE or MONSTERS_UPDATE_SIGNING_KEY_CMD): checks the setup
 *       without publishing anything.
 *
 * The private key is never printed, logged or written into the repo.
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { keyId } from '../src/main/update-signature.ts';
import { APP, RELEASE_KEYS_DIR } from './package-config.ts';
import { loadSigningKey } from './publish-update.ts';
import {
  askOnTerminal,
  encryptSigningKey,
  MIN_PASSPHRASE,
  SCRYPT_COST,
  type AskPassphrase,
  type ScryptCost,
} from './signing-key-file.ts';

const ROOT = resolve(APP, '..', '..');

/** Whether `path` is inside `dir` (after resolving the symlinks of the parts that exist). */
export function isInside(path: string, dir: string): boolean {
  const real = (p: string): string => {
    let cur = resolve(p);
    const rest: string[] = [];
    while (!existsSync(cur)) {
      rest.unshift(cur.slice(dirname(cur).length + 1));
      const up = dirname(cur);
      if (up === cur) break;
      cur = up;
    }
    return join(realpathSync(cur), ...rest);
  };
  const rel = relative(real(dir), real(path));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/** The passphrase of a new key file, asked twice. */
export async function newPassphrase(ask: AskPassphrase = askOnTerminal): Promise<string> {
  const first = await ask(
    `Passphrase nuova (almeno ${MIN_PASSPHRASE} caratteri, meglio 4 parole): `,
  );
  if ([...first].length < MIN_PASSPHRASE) {
    throw new Error(`the passphrase needs at least ${MIN_PASSPHRASE} characters`);
  }
  const again = await ask('Ripetila: ');
  if (again !== first) throw new Error('the two passphrases differ');
  return first;
}

/** Writes `text` into a new file (mode 600, never over an existing one) outside the repo. */
function writeKeyFile(file: string, text: string, repo: string): void {
  if (isInside(file, repo)) {
    throw new Error(`${file}: inside the repo; the private key must live outside it`);
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  // O_EXCL: never over an existing key.
  const fd = openSync(file, 'wx', 0o600);
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

/** The key file of `key`: encrypted with `passphrase`, plain PKCS#8 PEM when it is null. */
function keyFileText(key: KeyObject, passphrase: string | null, cost?: ScryptCost): string {
  return passphrase === null
    ? key.export({ format: 'pem', type: 'pkcs8' }).toString()
    : encryptSigningKey(key, passphrase, cost ?? SCRYPT_COST);
}

/**
 * Writes a new key pair; returns the public PEM and the id. `passphrase`: the private key is
 * encrypted with it (signing-key-file.ts); null writes it plain.
 */
export function generate(
  out: string,
  o: { repo?: string; passphrase: string | null; cost?: ScryptCost },
): { pem: string; id: string } {
  const file = resolve(out);
  const repo = o.repo ?? ROOT;
  if (isInside(file, repo)) {
    throw new Error(`${file}: inside the repo; the private key must live outside it`);
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const id = keyId(publicKey);
  writeKeyFile(file, keyFileText(privateKey, o.passphrase, o.cost), repo);
  writeFileSync(`${file}.pub`, pem, { mode: 0o644 });
  return { pem, id };
}

/** An existing plain PEM key, encrypted into a new file. Returns the key id. */
export function encryptExisting(
  input: string,
  out: string,
  o: { repo?: string; passphrase: string; cost?: ScryptCost },
): string {
  const key = createPrivateKey(readFileSync(input, 'utf8'));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`${input}: not an Ed25519 key`);
  writeKeyFile(resolve(out), keyFileText(key, o.passphrase, o.cost), o.repo ?? ROOT);
  return keyId(key);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      in: { type: 'string' },
      install: { type: 'boolean', default: false },
      plain: { type: 'boolean', default: false },
    },
  });
  const say = (line: string) => process.stderr.write(`update-signing-key: ${line}\n`);
  if (positionals[0] === 'generate') {
    if (!values.out) throw new Error('generate needs --out <key file> (outside the repo)');
    const out = resolve(values.out);
    if (isInside(out, ROOT)) {
      throw new Error(`${out}: inside the repo; the private key must live outside it`);
    }
    const passphrase = values.plain ? null : await newPassphrase();
    const { pem, id } = generate(out, { passphrase });
    say(
      `private key in ${out} (mode 600, ${values.plain ? 'NOT encrypted' : 'encrypted'}): ` +
        'keep it there, never in the repo',
    );
    if (!values.plain) say(`to publish: MONSTERS_UPDATE_SIGNING_KEY_FILE='${out}'`);
    say(`public key ${id} in ${out}.pub`);
    if (values.install) {
      mkdirSync(RELEASE_KEYS_DIR, { recursive: true });
      const target = join(RELEASE_KEYS_DIR, `${id}.pem`);
      copyFileSync(`${out}.pub`, target);
      say(`public key copied to ${relative(ROOT, target)}: commit it`);
    }
    process.stdout.write(pem);
    return;
  }
  if (positionals[0] === 'encrypt') {
    if (!values.in || !values.out)
      throw new Error('encrypt needs --in <private.pem> --out <key file>');
    const id = encryptExisting(values.in, values.out, { passphrase: await newPassphrase() });
    say(`key ${id} encrypted in ${resolve(values.out)}: remove ${resolve(values.in)} (shred -u)`);
    return;
  }
  if (positionals[0] === 'public') {
    const key = await loadSigningKey();
    if (!key) {
      throw new Error('set MONSTERS_UPDATE_SIGNING_KEY_FILE or MONSTERS_UPDATE_SIGNING_KEY_CMD');
    }
    const pub = createPublicKey(key);
    const id = keyId(pub);
    const trusted = existsSync(join(RELEASE_KEYS_DIR, `${id}.pem`));
    say(
      `key ${id}${trusted ? ', in build-resources/update-keys' : ', NOT in build-resources/update-keys'}`,
    );
    process.stdout.write(pub.export({ format: 'pem', type: 'spki' }).toString());
    return;
  }
  throw new Error(
    'usage: update-signing-key.ts generate --out <key file> [--install] [--plain] | ' +
      'encrypt --in <private.pem> --out <key file> | public',
  );
}

if (import.meta.main) {
  main().catch((err: Error) => {
    process.stderr.write(`update-signing-key: ${err.message}\n`);
    process.exitCode = 1;
  });
}
