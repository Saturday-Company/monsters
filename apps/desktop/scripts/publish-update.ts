/*
 * Publishes a release of the desktop app on the update feed (D-050): the R2 bucket
 * `monsters-updates`, served over https by the Worker of apps/update-server.
 *
 *   pnpm desktop:publish [--dir <folder>] [--prefix desktop] [--allow-unsigned] [--force]
 *                        [--dry-run] [--no-github-release] [--skip-ci-gate]
 *
 *   The release key (S-A4, docs/signing.md) signs every channel file: MONSTERS_UPDATE_SIGNING_KEY_FILE
 *   is the key file encrypted by `update-signing-key.ts generate` (signing-key-file.ts, readable
 *   by its owner only), whose passphrase is asked on the terminal; or MONSTERS_UPDATE_SIGNING_KEY_CMD
 *   a command that prints the key on its stdout, as PEM or as that encrypted file (another user or
 *   computer: `/usr/bin/ssh firma@pc cat key`, `/usr/bin/secret-tool lookup …`), run by /bin/sh
 *   with a fixed PATH of system folders. The key is never written anywhere by this script.
 *
 *   --dir             the output folder of `pnpm desktop:dist` (default apps/desktop/release; the
 *                     macOS packages land in release/mac, published with a second run)
 *   --prefix          folder of the feed in the bucket (default `desktop`, the feed of the alpha;
 *                     the update e2e uses desktop/e2e-<run>)
 *   --allow-unsigned  also publish packages not signed for distribution (`-unsigned` Windows,
 *                     `-not-notarized` macOS); test-signed Windows and ad-hoc macOS never go out:
 *                     they cannot update on someone else's computer
 *   --force           publish again a version equal to the one on the feed (never a lower one)
 *   --dry-run         check and print the plan, upload nothing
 *   --skip-ci-gate    publish although the release gate (D-147, scripts/release-gate.ts) is closed.
 *                     Without a full local CI of HEAD on linux, windows and macos the script refuses
 *                     (the real feed and its GitHub Release); this flag overrides it with a loud
 *                     warning. Test prefixes (`desktop/e2e-<run>`) are not gated.
 *
 * What it checks before uploading: every channel file (`alpha*.yml`) lists files that exist in the
 * folder with the size and sha512 it says (they are what electron-updater verifies the download
 * against), and is one the app accepts (update-signature.ts `parseChannel`); the build points at
 * this very feed (`build-info.json`, written by package.ts); it is not a test build and trusts no
 * test key; the version is higher than the one already on the feed for that channel file; the
 * build trusts the signing key (its id is in `build-info.json`). It signs each channel file
 * (`<name>.sig` next to it, see src/main/update-signature.ts).
 *
 * Then it uploads the packages and their blockmaps (skipping those already there with the same
 * MD5), and for each channel file, so that an app checking in the middle never sees a channel
 * file without a valid signature (review of wave 5, item 6):
 *   1. a bridging `.sig` with the signature of the channel file on the feed now (the `key` lines
 *      of its current `.sig`, when they verify it) and the one of the new file: valid for both;
 *   2. reads it back through the Worker: a Worker that does not serve `.sig` (not redeployed)
 *      stops the publication here, before any channel file changed;
 *   3. the channel file, then 4. the `.sig` with the new signature alone.
 * Last it reads everything back through the Worker, checking the signatures again. Uploads use
 * the R2 REST API with the login of the local `cf` CLI (or CLOUDFLARE_API_TOKEN and
 * CLOUDFLARE_ACCOUNT_ID), at most 300 MB per file.
 *
 * Then the GitHub Release (D-145), where the download links of the README and the site point:
 * `gh release create v<version>` on the repo of MONSTERS_GITHUB_REPO (default
 * Saturday-Company/monsters) at the commit of this checkout, a prerelease for a version with a
 * `-` (the alpha), notes from the CHANGELOG.md section of that version; then `gh release upload
 * --clobber` of the packages (not the blockmaps nor the channel files: those are the feed's), so
 * the second run for macOS adds its packages to the same release. The feed stays the source of
 * the updates; the release is for people. Only for `--prefix desktop`; `--no-github-release`
 * skips it; `--dry-run` prints the gh commands.
 */
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse as parseYaml } from 'yaml';
import {
  checkReleaseGate,
  gateDecision,
  resolveCommit,
  resultsDir,
} from '../../../scripts/release-gate.ts';
import {
  keyId,
  parseChannel,
  SIGNATURE_HEADER,
  SIGNATURE_SUFFIX,
  signChannelFile,
  verifyChannelFile,
} from '../src/main/update-signature.ts';
import { APP, BUILD_INFO, UPDATE_BUCKET, UPDATE_CHANNEL, UPDATE_ORIGIN } from './package-config.ts';
import {
  askOnTerminal,
  decryptSigningKey,
  isEncryptedKeyFile,
  SCRYPT_COST,
  type AskPassphrase,
  type ScryptCost,
} from './signing-key-file.ts';

/** Limit of one upload through the R2 REST API. */
const MAX_UPLOAD = 300 * 1024 * 1024;

export interface ChannelFile {
  /** e.g. alpha-linux.yml */
  name: string;
  version: string;
  files: { url: string; sha512: string; size: number }[];
}

export interface Upload {
  key: string;
  file: string;
  size: number;
  contentType: string;
  /** Read back through the Worker right after the upload: the publication stops if it differs. */
  checkServed?: boolean;
}

export interface Plan {
  feed: string;
  channels: ChannelFile[];
  /** Packages and blockmaps, uploaded first. */
  payload: Upload[];
  /**
   * Uploaded last, in this order, per channel file: the bridging `.sig` (checked as served), the
   * channel file, the final `.sig`.
   */
  metadata: Upload[];
  /** The public half of the signing key, to check what the Worker serves afterwards. */
  verifyKey: KeyObject;
}

const CHANNEL_FILE = new RegExp(`^${UPDATE_CHANNEL}(-[a-z0-9-]+)?\\.yml$`);
/** Names of builds that must never reach users, and of those that need --allow-unsigned. */
const NEVER = ['-test-signed', '-adhoc'];
const UNSIGNED = ['-unsigned', '-not-notarized'];

export function feedUrl(prefix: string, origin = UPDATE_ORIGIN): string {
  return `${origin}/${prefix}/`;
}

/** Semantic versions (2.0.0) compared: <0, 0 or >0. Build metadata is ignored. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
    if (!m) throw new Error(`not a semantic version: ${v}`);
    return { core: [m[1], m[2], m[3]].map(Number), pre: m[4]?.split('.') ?? [] };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d !== 0) return d;
  }
  // A version without pre-release is higher than the same one with it.
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      const d = Number(p) - Number(q);
      if (d !== 0) return d;
    } else if (pn !== qn) {
      return pn ? -1 : 1;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return 0;
}

export function parseChannelFile(name: string, text: string): ChannelFile {
  const doc = parseYaml(text) as unknown;
  const o = (doc ?? {}) as Record<string, unknown>;
  if (typeof o['version'] !== 'string') throw new Error(`${name}: no version`);
  if (!Array.isArray(o['files']) || o['files'].length === 0) throw new Error(`${name}: no files`);
  const files = (o['files'] as unknown[]).map((f, i) => {
    const e = (f ?? {}) as Record<string, unknown>;
    const url = e['url'];
    if (typeof url !== 'string' || typeof e['sha512'] !== 'string') {
      throw new Error(`${name}: file ${i} without url or sha512`);
    }
    // Only plain names next to the channel file: an absolute URL or a path would make the
    // client download from somewhere else.
    if (!/^[A-Za-z0-9][A-Za-z0-9._+ -]*$/.test(url)) {
      throw new Error(`${name}: file name ${url} is not a plain name`);
    }
    if (typeof e['size'] !== 'number') throw new Error(`${name}: ${url} without size`);
    return { url, sha512: e['sha512'], size: e['size'] };
  });
  return { name, version: o['version'], files };
}

async function hashFile(file: string, algorithm: 'sha512' | 'md5'): Promise<string> {
  const h = createHash(algorithm);
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest(algorithm === 'sha512' ? 'base64' : 'hex');
}

/** What package.ts recorded about the builds in `dir`: channel file → version, feed, key ids. */
export function buildInfo(dir: string): Record<
  string,
  {
    version?: unknown;
    feed?: unknown;
    updateKeys?: unknown;
    testKeys?: unknown;
    testBuild?: unknown;
  }
> {
  const file = join(dir, BUILD_INFO);
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, { version?: unknown }>;
}

/**
 * The bridging `.sig` of a channel file: the `key` lines of the `.sig` on the feed when they
 * verify the channel file on the feed (with `verifyKey`), plus the new signature. Only lines that
 * already verify are carried over: nothing on the feed is ever signed by this script.
 */
export function bridgeSignature(
  name: string,
  next: string,
  current: { text: string | null; signature: string | null },
  verifyKey: KeyObject,
): string {
  const lines = next.trim().split('\n').slice(1);
  if (current.text !== null && current.signature !== null) {
    const old = current.signature
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('key '));
    const valid = old.filter(
      (l) =>
        verifyChannelFile(name, current.text ?? '', `${SIGNATURE_HEADER}\n${l}\n`, [verifyKey]).ok,
    );
    for (const l of valid) if (!lines.includes(l)) lines.unshift(l);
  }
  return `${SIGNATURE_HEADER}\n${lines.join('\n')}\n`;
}

/** The PATH of MONSTERS_UPDATE_SIGNING_KEY_CMD: system folders only, never the user's. */
export const SIGNING_CMD_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

/**
 * The passphrase of the encrypted key from MONSTERS_UPDATE_SIGNING_PASSPHRASE_CMD (D-126: for
 * example `secret-tool lookup …` on a session keyring), so a release is published without anyone
 * at the terminal. Same /bin/sh and fixed PATH as the key command; one trailing newline is dropped.
 * Undefined when the variable is not set: the passphrase is asked on the terminal.
 */
export function passphraseFromCommand(env: NodeJS.ProcessEnv): AskPassphrase | undefined {
  const cmd = env['MONSTERS_UPDATE_SIGNING_PASSPHRASE_CMD']?.trim();
  if (!cmd) return undefined;
  return () => {
    let out: string;
    try {
      out = execFileSync('/bin/sh', ['-c', cmd], {
        encoding: 'utf8',
        env: { ...process.env, PATH: SIGNING_CMD_PATH },
        stdio: ['ignore', 'pipe', 'inherit'],
        maxBuffer: 4 * 1024,
      });
    } catch (err) {
      return Promise.reject(
        new Error(
          `MONSTERS_UPDATE_SIGNING_PASSPHRASE_CMD failed (exit ${String((err as { status?: unknown }).status)})`,
          { cause: err },
        ),
      );
    }
    const passphrase = out.replace(/\r?\n$/, '');
    if (!passphrase) {
      return Promise.reject(new Error('MONSTERS_UPDATE_SIGNING_PASSPHRASE_CMD printed nothing'));
    }
    return Promise.resolve(passphrase);
  };
}

export interface SigningKeyOptions {
  /** The passphrase of an encrypted key (default: asked on /dev/tty). */
  ask?: AskPassphrase;
  /** Tests: the least scrypt cost accepted. */
  minCost?: ScryptCost;
}

/**
 * The release signing key: the file MONSTERS_UPDATE_SIGNING_KEY_FILE (encrypted, readable by its
 * owner only: the passphrase is asked on the terminal), or the stdout of
 * MONSTERS_UPDATE_SIGNING_KEY_CMD (run with /bin/sh and a PATH of system folders: a PEM, or the
 * encrypted file). The passphrase of an encrypted key comes from `o.ask`, else
 * MONSTERS_UPDATE_SIGNING_PASSPHRASE_CMD, else the terminal. Null when neither is set. Throws when it is not an Ed25519 private key, and
 * on a key file that is not encrypted.
 */
export async function loadSigningKey(
  env: NodeJS.ProcessEnv = process.env,
  o: SigningKeyOptions = {},
): Promise<KeyObject | null> {
  const cmd = env['MONSTERS_UPDATE_SIGNING_KEY_CMD']?.trim();
  const file = env['MONSTERS_UPDATE_SIGNING_KEY_FILE']?.trim();
  let text: string;
  if (cmd) {
    try {
      // stderr goes to the terminal (a prompt of the command), stdout only here. The PATH is
      // fixed: an `openssl` or `ssh` dropped in ~/.local/bin is not the one that runs.
      text = execFileSync('/bin/sh', ['-c', cmd], {
        encoding: 'utf8',
        env: { ...process.env, PATH: SIGNING_CMD_PATH },
        stdio: ['inherit', 'pipe', 'inherit'],
        maxBuffer: 64 * 1024,
      });
    } catch (err) {
      throw new Error(
        `MONSTERS_UPDATE_SIGNING_KEY_CMD failed (exit ${String((err as { status?: unknown }).status)})`,
        { cause: err },
      );
    }
  } else if (file) {
    const mode = statSync(file).mode;
    if (process.platform !== 'win32' && (mode & 0o077) !== 0) {
      throw new Error(
        `${file}: readable by others (mode ${(mode & 0o777).toString(8)}): chmod 600`,
      );
    }
    text = readFileSync(file, 'utf8');
    if (!isEncryptedKeyFile(text)) {
      throw new Error(
        `${file}: not an encrypted key file (update-signing-key.ts generate, or encrypt --in)`,
      );
    }
  } else return null;
  let key: KeyObject;
  if (isEncryptedKeyFile(text)) {
    const ask = o.ask ?? passphraseFromCommand(env) ?? askOnTerminal;
    const passphrase = await ask('Passphrase della chiave degli aggiornamenti: ');
    key = decryptSigningKey(text, passphrase, o.minCost ?? SCRYPT_COST);
  } else {
    try {
      key = createPrivateKey(text);
    } catch {
      throw new Error('the update signing key is not a PEM private key');
    }
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`the update signing key is ${String(key.asymmetricKeyType)}, not Ed25519`);
  }
  return key;
}

const normalizeFeed = (u: string) => (u.endsWith('/') ? u : `${u}/`);

export interface PlanOptions {
  dir: string;
  prefix: string;
  allowUnsigned: boolean;
  /** The channel files already on the feed, by name (null: not there). */
  published: (name: string) => Promise<string | null>;
  /** The release key (`loadSigningKey`); null: nothing can be published. */
  signer: KeyObject | null;
  force?: boolean;
  origin?: string;
  /**
   * The remote update e2e only (never the command line): a test build may go to its own prefix
   * `desktop/e2e-<run>`, removed at the end.
   */
  testFeed?: boolean;
}

/** The prefixes of the remote update e2e (update-e2e.ts). */
const E2E_PREFIX = /^desktop\/e2e-[a-z0-9]+$/;

/** Checks the folder and returns what to upload; throws with every problem found. */
export async function planRelease(o: PlanOptions): Promise<Plan> {
  const feed = feedUrl(o.prefix, o.origin);
  const names = readdirSync(o.dir)
    .filter((f) => CHANNEL_FILE.test(f))
    .sort();
  if (names.length === 0) throw new Error(`no ${UPDATE_CHANNEL}*.yml in ${o.dir}`);
  const problems: string[] = [];
  const info = buildInfo(o.dir);
  const signerId = o.signer ? keyId(o.signer) : null;
  if (!o.signer) {
    problems.push(
      'no update signing key: set MONSTERS_UPDATE_SIGNING_KEY_CMD or MONSTERS_UPDATE_SIGNING_KEY_FILE (docs/signing.md)',
    );
  }
  const channels: ChannelFile[] = [];
  const payload: Upload[] = [];
  /** The channel files on the feed now, for the bridging signatures. */
  const onFeed = new Map<string, string | null>();
  for (const name of names) {
    let ch: ChannelFile;
    try {
      ch = parseChannelFile(name, readFileSync(join(o.dir, name), 'utf8'));
    } catch (err) {
      problems.push((err as Error).message);
      continue;
    }
    channels.push(ch);
    // What the app will accept (one strict parse, the same as the app's).
    try {
      parseChannel(readFileSync(join(o.dir, name), 'utf8'));
    } catch (err) {
      problems.push(`${name}: the app would refuse it (${(err as Error).message})`);
    }
    // The build behind this channel file must look for its updates right here.
    const built = info[name];
    if (!built) {
      problems.push(`${name}: not in ${BUILD_INFO} (built by pnpm desktop:dist?)`);
    } else if (built.version !== ch.version) {
      problems.push(
        `${name}: ${BUILD_INFO} says version ${String(built.version)}, not ${ch.version}`,
      );
    } else if (typeof built.feed !== 'string' || normalizeFeed(built.feed) !== feed) {
      problems.push(
        `${name}: the build checks ${typeof built.feed === 'string' ? built.feed : 'no feed'} for updates, not ${feed} ` +
          '(pnpm desktop:dist --feed)',
      );
    } else {
      // A test build (it reads MONSTERS_UPDATE_URL, trusts a key whose private half sits in a
      // work folder) never reaches users: only the remote update e2e puts one on its own prefix.
      const testFeed = o.testFeed === true && E2E_PREFIX.test(o.prefix);
      const testKeys = Array.isArray(built.testKeys) ? built.testKeys.map(String) : [];
      if (built.testBuild === true && !testFeed) {
        problems.push(`${name}: a test build (--test-build) cannot be published`);
      }
      if (testKeys.length > 0 && !testFeed) {
        problems.push(
          `${name}: the build trusts a test key (${testKeys.join(', ')}): it cannot be published`,
        );
      }
      // The app that will download this must trust the key it is signed with.
      const keys = Array.isArray(built.updateKeys) ? (built.updateKeys as unknown[]) : [];
      if (signerId && !keys.includes(signerId)) {
        problems.push(
          `${name}: the build does not trust the signing key ${signerId} ` +
            `(it trusts ${keys.length > 0 ? keys.join(', ') : 'no key: built before the signature'})`,
        );
      }
    }
    const current = await o.published(name);
    onFeed.set(name, current);
    if (current !== null) {
      const was = parseChannelFile(name, current).version;
      const d = compareVersions(ch.version, was);
      if (d < 0 || (d === 0 && !o.force)) {
        problems.push(
          `${name}: ${ch.version} is not higher than ${was} already on the feed` +
            (d === 0 ? ' (--force to publish it again)' : ''),
        );
      }
    }
    for (const f of ch.files) {
      const never = NEVER.find((l) => f.url.includes(l));
      if (never) problems.push(`${f.url}: a ${never.slice(1)} build cannot be published`);
      const unsigned = UNSIGNED.find((l) => f.url.includes(l));
      if (unsigned && !o.allowUnsigned) {
        problems.push(`${f.url}: ${unsigned.slice(1)} (--allow-unsigned to publish it anyway)`);
      }
      const path = join(o.dir, f.url);
      if (!existsSync(path)) {
        problems.push(`${name}: ${f.url} is not in ${o.dir}`);
        continue;
      }
      const size = statSync(path).size;
      if (size !== f.size) problems.push(`${f.url}: ${size} bytes, ${name} says ${f.size}`);
      else if ((await hashFile(path, 'sha512')) !== f.sha512) {
        problems.push(`${f.url}: sha512 differs from ${name}`);
      }
      if (size > MAX_UPLOAD) problems.push(`${f.url}: ${size} bytes, over the 300 MB upload limit`);
      for (const [file, s] of [
        [f.url, size],
        [`${f.url}.blockmap`, null],
      ] as const) {
        const p = join(o.dir, file);
        if (payload.some((u) => u.file === p) || !existsSync(p)) continue;
        payload.push({
          key: `${o.prefix}/${file}`,
          file: p,
          size: s ?? statSync(p).size,
          contentType: 'application/octet-stream',
        });
      }
    }
  }
  if (problems.length > 0 || !o.signer) {
    throw new Error(`not published:\n  ${problems.join('\n  ')}`);
  }
  const verifyKey = createPublicKey(o.signer);
  const metadata: Upload[] = [];
  for (const c of channels) {
    const file = join(o.dir, c.name);
    const sig = signChannelFile(c.name, readFileSync(file), [o.signer]);
    // Checked before anything leaves this computer.
    if (!verifyChannelFile(c.name, readFileSync(file), sig, [verifyKey]).ok) {
      throw new Error(`${c.name}: the signature just made does not verify`);
    }
    const sigFile = join(o.dir, `${c.name}${SIGNATURE_SUFFIX}`);
    writeFileSync(sigFile, sig);
    const current = onFeed.get(c.name) ?? null;
    const bridge = bridgeSignature(
      c.name,
      sig,
      {
        text: current,
        signature: current === null ? null : await o.published(`${c.name}${SIGNATURE_SUFFIX}`),
      },
      verifyKey,
    );
    const bridgeFile = join(o.dir, `${c.name}${SIGNATURE_SUFFIX}.bridge`);
    writeFileSync(bridgeFile, bridge);
    const sigUpload = (f: string, text: string, checkServed: boolean): Upload => ({
      key: `${o.prefix}/${c.name}${SIGNATURE_SUFFIX}`,
      file: f,
      size: Buffer.byteLength(text),
      contentType: 'text/plain; charset=utf-8',
      ...(checkServed ? { checkServed } : {}),
    });
    metadata.push(
      sigUpload(bridgeFile, bridge, true),
      {
        key: `${o.prefix}/${c.name}`,
        file,
        size: statSync(file).size,
        contentType: 'text/yaml; charset=utf-8',
      },
      sigUpload(sigFile, sig, false),
    );
  }
  return { feed, channels, payload, metadata, verifyKey };
}

function cf(args: string[]): string {
  return execFileSync('cf', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Objects under a prefix of the bucket: key → MD5 (the ETag of a single-part upload). */
export function listObjects(prefix: string): Map<string, string> {
  const out = cf([
    'r2',
    'objects',
    'list',
    '--bucket-name',
    UPDATE_BUCKET,
    '--prefix',
    `${prefix}/`,
  ]);
  const list = JSON.parse(out) as { key: string; etag: string }[];
  return new Map(list.map((o) => [o.key, o.etag]));
}

export function deleteObjects(keys: string[]): void {
  // Without --force `cf` asks, and when it cannot ask it aborts with exit 0: checked by listing.
  for (const key of keys) {
    cf(['r2', 'objects', 'delete', key, '--bucket-name', UPDATE_BUCKET, '--force']);
  }
}

/**
 * Credentials for the R2 REST API: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID when set,
 * otherwise the OAuth login of the local `cf` CLI (`cf auth whoami` refreshes it first).
 */
function r2Credentials(): { token: string; account: string } {
  const env = process.env;
  if (env['CLOUDFLARE_API_TOKEN'] && env['CLOUDFLARE_ACCOUNT_ID']) {
    return { token: env['CLOUDFLARE_API_TOKEN'], account: env['CLOUDFLARE_ACCOUNT_ID'] };
  }
  const who = JSON.parse(cf(['auth', 'whoami'])) as {
    authSource?: string;
    accounts?: { id: string }[];
  };
  const file = /from (\S+\.json)/.exec(who.authSource ?? '')?.[1];
  const account = who.accounts?.[0]?.id;
  if (!file || !account) throw new Error('cf is not logged in (cf auth login)');
  const token = (JSON.parse(readFileSync(file, 'utf8')) as { oauth_token?: string }).oauth_token;
  if (!token) throw new Error(`no OAuth token in ${file}`);
  return { token, account };
}

/**
 * One object into the bucket with the R2 REST API (up to 300 MB in one request). Not through
 * `cf r2 objects put`: its request times out after about a minute, which a ~120 MB package
 * can exceed on a slow home uplink. One retry, with fresh credentials.
 */
async function upload(u: Upload): Promise<void> {
  const body = readFileSync(u.file);
  for (let attempt = 1; ; attempt++) {
    const { token, account } = r2Credentials();
    const url =
      `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${UPDATE_BUCKET}` +
      `/objects/${u.key.split('/').map(encodeURIComponent).join('/')}`;
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': u.contentType },
        body,
        signal: AbortSignal.timeout(15 * 60_000),
      });
      if (res.ok) return;
      throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    } catch (err) {
      if (attempt >= 2)
        throw new Error(`upload of ${u.key} failed: ${(err as Error).message}`, { cause: err });
    }
  }
}

/** The channel file currently on the feed, through the Worker (null when not there). */
export async function fetchPublished(feed: string, name: string): Promise<string | null> {
  const res = await fetch(new URL(name, feed), { signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${name} on the feed: HTTP ${res.status}`);
  return res.text();
}

/** Uploads a checked plan and reads it back through the Worker. */
export async function publish(plan: Plan, log: (line: string) => void): Promise<void> {
  const prefix = plan.feed.slice(UPDATE_ORIGIN.length + 1, -1);
  const existing = listObjects(prefix);
  for (const u of plan.payload) {
    if (existing.get(u.key) === (await hashFile(u.file, 'md5'))) {
      log(`already there: ${u.key}`);
      continue;
    }
    log(`uploading ${u.key} (${(u.size / 1e6).toFixed(1)} MB)`);
    await upload(u);
  }
  for (const u of plan.metadata) {
    log(`uploading ${u.key}`);
    await upload(u);
    if (u.checkServed) {
      const served = await fetchPublished(plan.feed, u.key.slice(prefix.length + 1));
      if (served !== readFileSync(u.file, 'utf8')) {
        throw new Error(
          `${u.key}: the Worker does not serve it (redeploy it: pnpm --filter ` +
            '@monsters/update-server deploy:worker); no channel file was changed',
        );
      }
    }
  }
  // The last upload of each key is what must be there now.
  const last = new Map(plan.metadata.map((u) => [u.key, u]));
  for (const u of last.values()) {
    const text = await fetchPublished(plan.feed, u.key.slice(prefix.length + 1));
    if (text !== readFileSync(u.file, 'utf8')) throw new Error(`${u.key}: not what was uploaded`);
  }
  // What a client gets from the Worker verifies with the key.
  for (const c of plan.channels) {
    const [text, sig] = await Promise.all([
      fetchPublished(plan.feed, c.name),
      fetchPublished(plan.feed, `${c.name}${SIGNATURE_SUFFIX}`),
    ]);
    if (text === null || !verifyChannelFile(c.name, text, sig, [plan.verifyKey]).ok) {
      throw new Error(`${c.name}: the signature served by the Worker does not verify`);
    }
  }
  for (const u of plan.payload) {
    const res = await fetch(new URL(u.key.slice(prefix.length + 1), plan.feed), {
      method: 'HEAD',
      signal: AbortSignal.timeout(20_000),
    });
    const length = Number(res.headers.get('content-length'));
    if (!res.ok || length !== u.size) {
      throw new Error(`${u.key}: HTTP ${res.status}, ${length} bytes instead of ${u.size}`);
    }
  }
  log(
    `published on ${plan.feed}: ${plan.channels.map((c) => `${c.name} ${c.version}`).join(', ')}`,
  );
}

export const GITHUB_REPO = 'Saturday-Company/monsters';

/** The release of a plan: its tag, and the packages to attach (no blockmaps). */
export function githubRelease(plan: Pick<Plan, 'channels' | 'payload'>): {
  version: string;
  tag: string;
  assets: string[];
} {
  const versions = [...new Set(plan.channels.map((c) => c.version))];
  if (versions.length !== 1) {
    throw new Error(`one version per GitHub Release, the channel files say ${versions.join(', ')}`);
  }
  const version = versions[0]!;
  const assets = plan.payload.map((u) => u.file).filter((f) => !f.endsWith('.blockmap'));
  return { version, tag: `v${version}`, assets };
}

/** The notes of a version: its section of CHANGELOG.md (`## <version> · …`), else a pointer. */
export function releaseNotes(changelog: string | null, version: string): string {
  const lines = (changelog ?? '').split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${version} `) || l === `## ${version}`);
  if (start < 0) return `Monsters ${version}. See CHANGELOG.md.`;
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim();
}

/**
 * The gh commands of the release: `create` when it does not exist yet (with the notes in a file),
 * then `upload --clobber` of every package. Pure, for the dry run and the tests.
 */
export function githubReleaseCommands(o: {
  repo: string;
  tag: string;
  version: string;
  assets: string[];
  exists: boolean;
  target: string;
  notesFile: string;
}): string[][] {
  const create = [
    'release',
    'create',
    o.tag,
    '--repo',
    o.repo,
    '--target',
    o.target,
    '--title',
    `Monsters ${o.version}`,
    '--notes-file',
    o.notesFile,
    ...(o.version.includes('-') ? ['--prerelease'] : []),
  ];
  const upload = ['release', 'upload', o.tag, ...o.assets, '--repo', o.repo, '--clobber'];
  return [...(o.exists ? [] : [create]), ...(o.assets.length > 0 ? [upload] : [])];
}

/** Creates or updates the GitHub Release of a published plan with `gh` (logged in). */
function publishGithubRelease(plan: Plan, dryRun: boolean, log: (line: string) => void): void {
  const repo = process.env['MONSTERS_GITHUB_REPO'] ?? GITHUB_REPO;
  const { version, tag, assets } = githubRelease(plan);
  const root = resolve(APP, '..', '..');
  const target = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const changelog = join(root, 'CHANGELOG.md');
  const notesFile = join(APP, 'release', `release-notes-${version}.md`);
  let exists = false;
  if (!dryRun) {
    try {
      execFileSync('gh', ['release', 'view', tag, '--repo', repo], { stdio: 'ignore' });
      exists = true;
    } catch {
      exists = false;
    }
    writeFileSync(
      notesFile,
      releaseNotes(existsSync(changelog) ? readFileSync(changelog, 'utf8') : null, version),
    );
  }
  for (const args of githubReleaseCommands({
    repo,
    tag,
    version,
    assets,
    exists,
    target,
    notesFile,
  })) {
    log(`${dryRun ? 'dry run: ' : ''}gh ${args.join(' ')}`);
    if (!dryRun) execFileSync('gh', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  }
  if (!dryRun) log(`GitHub Release ${tag} on ${repo}: ${assets.length} packages`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string', default: join(APP, 'release') },
      prefix: { type: 'string', default: 'desktop' },
      'allow-unsigned': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'no-github-release': { type: 'boolean', default: false },
      'skip-ci-gate': { type: 'boolean', default: false },
    },
  });
  if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(values.prefix)) {
    throw new Error(`--prefix ${values.prefix}: lowercase folder names only`);
  }
  const log = (line: string) => process.stderr.write(`publish: ${line}\n`);
  // The release gate (D-147): the real feed and its GitHub Release go out only for a commit whose
  // full local CI passed on all three systems. Test prefixes are not releases.
  if (values.prefix === 'desktop') {
    const decision = gateDecision({
      verdict: checkReleaseGate(resolveCommit('HEAD'), resultsDir()),
      skip: values['skip-ci-gate'],
      dryRun: values['dry-run'],
    });
    for (const line of decision.messages) for (const l of line.split('\n')) log(l);
    if (!decision.proceed) throw new Error('release gate closed');
  }
  const feed = feedUrl(values.prefix);
  const plan = await planRelease({
    dir: resolve(values.dir),
    prefix: values.prefix,
    allowUnsigned: values['allow-unsigned'],
    force: values.force,
    published: (name) => fetchPublished(feed, name),
    signer: await loadSigningKey(),
  });
  for (const c of plan.channels)
    log(`${c.name}: ${c.version} (${c.files.map((f) => f.url).join(', ')})`);
  for (const u of [...plan.payload, ...plan.metadata]) log(`  ${u.key}`);
  // Only the real feed has a GitHub Release (a test prefix such as desktop/e2e-<run> never).
  const release = !values['no-github-release'] && values.prefix === 'desktop';
  if (values['dry-run']) {
    log(`dry run: nothing uploaded to ${feed}`);
    if (release) publishGithubRelease(plan, true, log);
    return;
  }
  await publish(plan, log);
  if (release) publishGithubRelease(plan, false, log);
}

if (import.meta.main) {
  main().catch((err: Error) => {
    process.stderr.write(`publish: ${err.message}\n`);
    process.exitCode = 1;
  });
}
