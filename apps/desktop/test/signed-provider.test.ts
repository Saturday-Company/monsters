import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SignedFeed, SignedProvider } from '../src/main/signed-provider.ts';
import {
  signChannelFile,
  UpdateRefusedError,
  type FetchText,
} from '../src/main/update-signature.ts';

/*
 * The provider electron-updater reads the feed through (review of wave 5, item 1): one read of
 * the channel file and its signature, and electron-updater gets that signed object.
 */

const release = generateKeyPairSync('ed25519');
const sha = (s: string) => createHash('sha512').update(s).digest('base64');
const APPIMAGE = 'Monsters-0.1.0-alpha.14-linux-x86_64.AppImage';
const DEB = 'Monsters-0.1.0-alpha.14-linux-amd64.deb';
const CHANNEL =
  'version: 0.1.0-alpha.14\n' +
  'files:\n' +
  `  - url: ${APPIMAGE}\n    sha512: ${sha('a')}\n    size: 3\n` +
  `  - url: ${DEB}\n    sha512: ${sha('d')}\n    size: 4\n` +
  `path: ${APPIMAGE}\nsha512: ${sha('a')}\n`;
/** The reviewer's probe: a legacy-only file whose download electron-updater checks by sha256. */
const LEGACY = `version: 0.1.0-alpha.14\nfiles: []\npath: ${APPIMAGE}\nsha2: deadbeef\n`;

/** A feed that counts the reads, and answers each read of a file with the next of its texts. */
function feed(files: Record<string, string[]>): { fetchText: FetchText; reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    fetchText: (url) => {
      const name = new URL(url).pathname.replace('/desktop/', '');
      reads.push(name);
      const queue = files[name];
      return Promise.resolve(queue?.shift() ?? null);
    },
  };
}

const runtime = {
  isUseMultipleRangeRequest: true,
  platform: 'linux' as const,
  executor: null as never,
};

function make(files: Record<string, string[]>) {
  const f = feed(files);
  const signed = new SignedFeed({
    feed: 'https://updates.example/desktop',
    channelFile: 'alpha-linux.yml',
    keys: [release.publicKey],
    fetchText: f.fetchText,
  });
  const options = signed.publishOptions('alpha');
  const provider = new options.updateProvider(options, null, runtime);
  return { signed, provider, reads: f.reads, options };
}

const sig = (text: string) => signChannelFile('alpha-linux.yml', text, [release.privateKey]);

describe('signed provider', () => {
  it('reads the channel file and its signature once, and gives electron-updater that object', async () => {
    const { signed, provider, reads, options } = make({
      'alpha-linux.yml': [CHANNEL, LEGACY],
      'alpha-linux.yml.sig': [sig(CHANNEL)],
    });
    expect(options).toMatchObject({ provider: 'custom', channel: 'alpha' });
    const info = await provider.getLatestVersion();
    // One read each: the second answer of the feed (the legacy file) is never asked for.
    expect(reads.sort()).toEqual(['alpha-linux.yml', 'alpha-linux.yml.sig']);
    expect(info.version).toBe('0.1.0-alpha.14');
    expect(signed.verify(info)).toMatchObject({ ok: true, release: { version: '0.1.0-alpha.14' } });
    // Only the signed files, resolved on the feed.
    expect(provider.resolveFiles(info).map((f) => f.url.href)).toEqual([
      `https://updates.example/desktop/${APPIMAGE}`,
      `https://updates.example/desktop/${DEB}`,
    ]);
  });

  it('an info that is not the object it verified is refused (a copy, or another parse)', async () => {
    const { signed, provider } = make({
      'alpha-linux.yml': [CHANNEL],
      'alpha-linux.yml.sig': [sig(CHANNEL)],
    });
    const info = await provider.getLatestVersion();
    expect(signed.verify({ ...info })).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(() => provider.resolveFiles({ ...info })).toThrow(UpdateRefusedError);
    // A file added to the verified object after the check is not resolved.
    info.files.push({ url: 'evil.AppImage', sha512: sha('evil') });
    const thrown = (() => {
      try {
        provider.resolveFiles(info);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(thrown).toMatchObject({ reason: 'mismatch', detail: 'evil.AppImage not signed' });
  });

  it('the reviewer’s probe: a legacy-only file is refused even when it is signed', async () => {
    const { provider } = make({
      'alpha-linux.yml': [LEGACY],
      'alpha-linux.yml.sig': [sig(LEGACY)],
    });
    const err = await provider.getLatestVersion().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpdateRefusedError);
    expect(err).toMatchObject({ reason: 'malformed', version: '0.1.0-alpha.14' });
  });

  it('no signature, or a wrong one: refused with the reason, nothing returned', async () => {
    const unsigned = make({ 'alpha-linux.yml': [CHANNEL] });
    await expect(unsigned.provider.getLatestVersion()).rejects.toMatchObject({
      name: 'UpdateRefusedError',
      reason: 'missing',
      message: 'update 0.1.0-alpha.14 isn’t signed: I’m not downloading it',
    });
    const changed = make({
      'alpha-linux.yml': [CHANNEL.replace(sha('d'), sha('evil'))],
      'alpha-linux.yml.sig': [sig(CHANNEL)],
    });
    await expect(changed.provider.getLatestVersion()).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('is built only with its feed', () => {
    expect(() => new SignedProvider({ url: 'https://u.example/' }, null, runtime)).toThrow(
      /needs its feed/,
    );
  });
});
