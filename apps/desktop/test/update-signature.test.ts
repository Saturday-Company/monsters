import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  channelFileName,
  describeRefusal,
  downloadMismatch,
  feedFileUrl,
  infoMismatch,
  keyId,
  loadPublicKeys,
  parseChannel,
  parseSignedChannel,
  publicKeyFromPem,
  signChannelFile,
  signedMessage,
  verifyChannel,
  verifyChannelFile,
  verifyUpdate,
  type FetchText,
} from '../src/main/update-signature.ts';
import { tempDir } from './helpers.ts';

const release = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');

/** sha512 values in electron-builder's form (base64 of 64 bytes). */
const sha = (s: string) => createHash('sha512').update(s).digest('base64');
const A = sha('appimage');
const B = sha('deb');
const APPIMAGE = 'Monsters-0.1.0-alpha.14-linux-x86_64.AppImage';
const CHANNEL =
  'version: 0.1.0-alpha.14\n' +
  'files:\n' +
  `  - url: ${APPIMAGE}\n    sha512: ${A}\n    size: 3\n` +
  `  - url: Monsters-0.1.0-alpha.14-linux-amd64.deb\n    sha512: ${B}\n    size: 4\n` +
  `path: ${APPIMAGE}\nsha512: ${A}\n` +
  "releaseDate: '2026-10-19T08:00:00.000Z'\n";
/** What electron-updater makes of CHANNEL. */
const INFO = {
  version: '0.1.0-alpha.14',
  files: [
    { url: APPIMAGE, sha512: A, size: 3 },
    { url: 'Monsters-0.1.0-alpha.14-linux-amd64.deb', sha512: B, size: 4 },
  ],
  path: APPIMAGE,
  sha512: A,
};

describe('update signature: the channel file', () => {
  it('a valid signature is accepted, with the id of the key', () => {
    const sig = signChannelFile('alpha-linux.yml', CHANNEL, [release.privateKey]);
    expect(sig).toMatch(/^monsters-update-signature-v1\nkey [0-9a-f]{16} [A-Za-z0-9+/]+=*\n$/);
    expect(verifyChannelFile('alpha-linux.yml', CHANNEL, sig, [release.publicKey])).toEqual({
      ok: true,
      keyId: keyId(release.publicKey),
    });
    // The id of a private key is the one of its public half.
    expect(keyId(release.privateKey)).toBe(keyId(release.publicKey));
  });

  it('refuses a missing, empty or garbled signature', () => {
    const keys = [release.publicKey];
    expect(verifyChannelFile('alpha-linux.yml', CHANNEL, null, keys)).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(verifyChannelFile('alpha-linux.yml', CHANNEL, ' \n', keys)).toMatchObject({
      reason: 'missing',
    });
    expect(verifyChannelFile('alpha-linux.yml', CHANNEL, 'not a signature\n', keys)).toMatchObject({
      reason: 'malformed',
    });
    expect(
      verifyChannelFile(
        'alpha-linux.yml',
        CHANNEL,
        'monsters-update-signature-v1\nkey 0123 abc\n',
        keys,
      ),
    ).toMatchObject({ reason: 'malformed' });
  });

  it('refuses a changed file, a signature by another key, and one of another channel file', () => {
    const keys = [release.publicKey];
    const sig = signChannelFile('alpha-linux.yml', CHANNEL, [release.privateKey]);
    // One sha512 changed: the bytes are not the signed ones.
    const forged = CHANNEL.replace(B, sha('evil'));
    expect(verifyChannelFile('alpha-linux.yml', forged, sig, keys)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    // Signed, but with a key this app does not trust.
    const byOther = signChannelFile('alpha-linux.yml', forged, [other.privateKey]);
    expect(verifyChannelFile('alpha-linux.yml', forged, byOther, keys)).toEqual({
      ok: false,
      reason: 'unknown-key',
    });
    // The real signature of beta-linux.yml (or alpha-mac.yml) served as alpha-linux.yml.
    const beta = signChannelFile('beta-linux.yml', CHANNEL, [release.privateKey]);
    expect(verifyChannelFile('alpha-linux.yml', CHANNEL, beta, keys)).toMatchObject({ ok: false });
    const mac = signChannelFile('alpha-mac.yml', CHANNEL, [release.privateKey]);
    expect(verifyChannelFile('alpha-linux.yml', CHANNEL, mac, keys)).toMatchObject({ ok: false });
    // No trusted key at all: nothing is accepted.
    expect(verifyChannelFile('alpha-linux.yml', CHANNEL, sig, [])).toEqual({
      ok: false,
      reason: 'no-keys',
    });
  });

  it('two signatures while a key is rotated: either trusted key is enough', () => {
    const sig = signChannelFile('alpha.yml', CHANNEL, [other.privateKey, release.privateKey]);
    expect(sig.split('\n').filter((l) => l.startsWith('key '))).toHaveLength(2);
    expect(verifyChannelFile('alpha.yml', CHANNEL, sig, [release.publicKey])).toEqual({
      ok: true,
      keyId: keyId(release.publicKey),
    });
  });

  it('signs the file name with the bytes, and only with Ed25519 keys', () => {
    expect(signedMessage('alpha.yml', 'x').toString()).toBe(
      'monsters-update-signature-v1\nalpha.yml\nx',
    );
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 });
    expect(() => signChannelFile('alpha.yml', 'x', [rsa.privateKey])).toThrow(/Ed25519/);
    expect(() => signChannelFile('alpha.yml', 'x', [release.publicKey])).toThrow(/private/);
    expect(() =>
      publicKeyFromPem(rsa.publicKey.export({ format: 'pem', type: 'spki' }).toString()),
    ).toThrow(/Ed25519/);
  });

  it('loads the trusted keys of a build from its resources', () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'release-a.pem'),
      release.publicKey.export({ format: 'pem', type: 'spki' }),
    );
    writeFileSync(join(dir, 'notes.txt'), 'not a key');
    expect(loadPublicKeys(dir).map(keyId)).toEqual([keyId(release.publicKey)]);
    expect(loadPublicKeys(join(dir, 'none'))).toEqual([]);
  });

  it('a broken .pem is skipped and said, the other keys still count (review wave 5, item 11)', () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a-broken.pem'), '-----BEGIN PUBLIC KEY-----\nnope\n');
    writeFileSync(
      join(dir, 'b-rsa.pem'),
      generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({
        format: 'pem',
        type: 'spki',
      }),
    );
    writeFileSync(
      join(dir, 'c-release.pem'),
      release.publicKey.export({ format: 'pem', type: 'spki' }),
    );
    const bad: string[] = [];
    expect(loadPublicKeys(dir, (f) => bad.push(f)).map(keyId)).toEqual([keyId(release.publicKey)]);
    expect(bad).toEqual(['a-broken.pem', 'b-rsa.pem']);
  });
});

describe('update signature: the file electron-updater reads', () => {
  it('names the channel file per system as electron-updater does', () => {
    expect(channelFileName('alpha', 'linux', 'x64')).toBe('alpha-linux.yml');
    expect(channelFileName('alpha', 'linux', 'arm64')).toBe('alpha-linux-arm64.yml');
    expect(channelFileName('beta', 'darwin', 'arm64')).toBe('beta-mac.yml');
    expect(channelFileName('alpha', 'win32', 'x64')).toBe('alpha.yml');
  });

  it('what electron-updater found must be what was signed', () => {
    const signed = parseSignedChannel(CHANNEL);
    expect(infoMismatch(INFO, signed)).toBeNull();
    expect(infoMismatch({ ...INFO, version: '0.1.0-alpha.15' }, signed)).toMatch(/version/);
    expect(
      infoMismatch(
        { ...INFO, files: [{ url: 'Monsters-0.1.0-alpha.14-linux-amd64.deb', sha512: 'EVIL' }] },
        signed,
      ),
    ).toMatch(/not in the signed file/);
    expect(infoMismatch({ ...INFO, files: [{ url: 'evil.deb', sha512: B }] }, signed)).toMatch(
      /evil\.deb/,
    );
    expect(infoMismatch({ ...INFO, sha512: 'EVIL' }, signed)).toMatch(/sha512/);
  });

  it('the legacy fields cannot carry another download (review wave 5, item 1)', () => {
    const signed = parseSignedChannel(CHANNEL);
    // The reviewer's probe: what a hostile feed served to electron-updater's own request.
    expect(
      infoMismatch({ version: INFO.version, files: [], path: APPIMAGE, sha2: 'deadbeef' }, signed),
    ).toMatch(/no sha512/);
    expect(
      infoMismatch({ version: INFO.version, path: APPIMAGE, sha2: 'deadbeef' }, signed),
    ).toMatch(/no sha512/);
    expect(
      infoMismatch(
        { version: INFO.version, files: [], path: APPIMAGE, sha512: sha('evil') },
        signed,
      ),
    ).toMatch(/not in the signed file/);
    expect(infoMismatch({ ...INFO, files: [{ url: APPIMAGE, sha2: 'deadbeef' }] }, signed)).toMatch(
      /no sha512/,
    );
    expect(infoMismatch({ ...INFO, packages: { x64: { path: 'p.7z' } } }, signed)).toMatch(
      /packages/,
    );
  });

  it('accepts only a channel file whose every download has a signed sha512', () => {
    const head = 'version: 0.1.0-alpha.14\n';
    const file = (url: string, extra = `    sha512: ${A}\n`) => `  - url: ${url}\n${extra}`;
    const bad: [string, RegExp][] = [
      // The reviewer's probe, signed: empty files, a path and a sha256.
      [`${head}files: []\npath: ${APPIMAGE}\nsha2: deadbeef\n`, /sha256|no files/],
      [`${head}path: ${APPIMAGE}\nsha512: ${A}\n`, /no files/],
      [`${head}files: []\npath: ${APPIMAGE}\nsha512: ${A}\n`, /no files/],
      [`${head}files:\n${file(APPIMAGE, '    sha2: deadbeef\n')}`, /no sha512/],
      [`${head}files:\n${file(APPIMAGE, `    sha512: ${A}\n    sha2: deadbeef\n`)}`, /sha256/],
      [
        `${head}files:\n${file(APPIMAGE, `    sha512: ${createHash('sha512').update('x').digest('hex')}\n`)}`,
        /no sha512/,
      ],
      [`${head}files:\n${file(APPIMAGE)}packages:\n  x64:\n    path: p.7z\n`, /packages/],
      [`${head}files:\n${file(APPIMAGE)}path: evil.AppImage\n`, /path/],
      [`${head}files:\n${file(APPIMAGE)}path: ${APPIMAGE}\nsha512: ${B}\n`, /sha512/],
      [`${head}files:\n${file(APPIMAGE)}sha512: ${A}\n`, /without path/],
      [`${head}files:\n${file(APPIMAGE)}${file(APPIMAGE)}`, /twice/],
      [`version: latest\nfiles:\n${file(APPIMAGE)}`, /version/],
      ['- a list\n', /not a channel file/],
    ];
    for (const [text, why] of bad) expect(() => parseChannel(text), text).toThrow(why);
    const { info, signed } = parseChannel(CHANNEL);
    expect(signed).toEqual({
      version: '0.1.0-alpha.14',
      files: [
        { url: APPIMAGE, sha512: A },
        { url: 'Monsters-0.1.0-alpha.14-linux-amd64.deb', sha512: B },
      ],
      path: APPIMAGE,
      sha512: A,
    });
    expect(info).toMatchObject({ ...INFO, releaseDate: '2026-10-19T08:00:00.000Z' });
  });

  it('a downloaded file counts only by its own sha512', () => {
    const signed = parseSignedChannel(CHANNEL);
    expect(downloadMismatch('/c/pending/x.deb', B, signed)).toBeNull();
    expect(downloadMismatch('/c/pending/x.deb', sha('evil'), signed)).toMatch(/x\.deb/);
  });

  it('asks the feed uncached, next to the channel file', () => {
    expect(feedFileUrl('https://u.example/desktop', 'alpha.yml.sig', 32)).toBe(
      'https://u.example/desktop/alpha.yml.sig?noCache=10',
    );
  });
});

describe('update signature: verifyUpdate', () => {
  const FEED = 'https://updates.example/desktop/';
  const feed = (files: Record<string, string>): { fetchText: FetchText; asked: string[] } => {
    const asked: string[] = [];
    return {
      asked,
      fetchText: (url) => {
        const name = new URL(url).pathname.replace('/desktop/', '');
        asked.push(name);
        return Promise.resolve(files[name] ?? null);
      },
    };
  };
  const options = (fetchText: FetchText) => ({
    feed: FEED,
    channelFile: 'alpha-linux.yml',
    keys: [release.publicKey],
    fetchText,
  });

  it('a signed feed: accepted, with what root needs to check it again', async () => {
    const sig = signChannelFile('alpha-linux.yml', CHANNEL, [release.privateKey]);
    const f = feed({ 'alpha-linux.yml': CHANNEL, 'alpha-linux.yml.sig': sig });
    const r = await verifyUpdate(INFO, options(f.fetchText));
    expect(r).toMatchObject({
      ok: true,
      release: {
        version: '0.1.0-alpha.14',
        channelFile: 'alpha-linux.yml',
        text: CHANNEL,
        signature: sig,
        keyId: keyId(release.publicKey),
      },
    });
    expect(f.asked.sort()).toEqual(['alpha-linux.yml', 'alpha-linux.yml.sig']);
  });

  it('refuses a feed without the signature, with a wrong one, or of another channel', async () => {
    const plain = feed({ 'alpha-linux.yml': CHANNEL });
    expect(await verifyUpdate(INFO, options(plain.fetchText))).toMatchObject({
      ok: false,
      reason: 'missing',
    });
    const wrong = signChannelFile('alpha-linux.yml', CHANNEL, [other.privateKey]);
    const byOther = feed({ 'alpha-linux.yml': CHANNEL, 'alpha-linux.yml.sig': wrong });
    expect(await verifyUpdate(INFO, options(byOther.fetchText))).toMatchObject({
      ok: false,
      reason: 'unknown-key',
    });
    // The signed file of beta-linux.yml, with its own valid signature, served as alpha's.
    const beta = signChannelFile('beta-linux.yml', CHANNEL, [release.privateKey]);
    const swapped = feed({ 'alpha-linux.yml': CHANNEL, 'alpha-linux.yml.sig': beta });
    expect(await verifyUpdate(INFO, options(swapped.fetchText))).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('refuses when electron-updater got another file than the signed one', async () => {
    // A feed that answers electron-updater with a forged file and this check with the real one.
    const sig = signChannelFile('alpha-linux.yml', CHANNEL, [release.privateKey]);
    const f = feed({ 'alpha-linux.yml': CHANNEL, 'alpha-linux.yml.sig': sig });
    const forged = {
      ...INFO,
      files: [{ url: 'Monsters-0.1.0-alpha.14-linux-amd64.deb', sha512: 'EVIL' }],
    };
    expect(await verifyUpdate(forged, options(f.fetchText))).toMatchObject({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('one read: the signed file is the one returned, a legacy-only signed file is refused', async () => {
    const sig = signChannelFile('alpha-linux.yml', CHANNEL, [release.privateKey]);
    const f = feed({ 'alpha-linux.yml': CHANNEL, 'alpha-linux.yml.sig': sig });
    const r = await verifyChannel(options(f.fetchText));
    expect(f.asked.sort()).toEqual(['alpha-linux.yml', 'alpha-linux.yml.sig']);
    expect(r.ok && r.release.info).toMatchObject(INFO);
    const legacy = `version: 0.1.0-alpha.14\nfiles: []\npath: ${APPIMAGE}\nsha2: deadbeef\n`;
    const signedLegacy = feed({
      'alpha-linux.yml': legacy,
      'alpha-linux.yml.sig': signChannelFile('alpha-linux.yml', legacy, [release.privateKey]),
    });
    expect(await verifyChannel(options(signedLegacy.fetchText))).toMatchObject({
      ok: false,
      reason: 'malformed',
      version: '0.1.0-alpha.14',
    });
  });

  it('no key in the build, no feed, or a network error: refused, nothing trusted', async () => {
    const f = feed({});
    expect(await verifyUpdate(INFO, { ...options(f.fetchText), keys: [] })).toMatchObject({
      reason: 'no-keys',
    });
    expect(await verifyUpdate(INFO, { ...options(f.fetchText), feed: null })).toMatchObject({
      reason: 'fetch',
    });
    const down: FetchText = () => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED'));
    expect(await verifyUpdate(INFO, options(down))).toEqual({
      ok: false,
      reason: 'fetch',
      detail: 'net::ERR_INTERNET_DISCONNECTED',
    });
  });

  it('says why in Italian', () => {
    expect(describeRefusal('0.2.0', 'missing')).toBe(
      'l’aggiornamento 0.2.0 non è firmato: non lo scarico',
    );
    expect(describeRefusal('0.2.0', 'invalid')).toContain('non è valida');
  });
});
