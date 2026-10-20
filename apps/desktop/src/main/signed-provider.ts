/*
 * The provider electron-updater reads the feed through (review of wave 5, item 1): one read of
 * the channel file and its `.sig`, verified (update-signature.ts `verifyChannel`), and the parsed
 * signed object handed to electron-updater as the update info. electron-updater's own generic
 * provider is never used, so nothing reads the channel file a second time: before, the check and
 * electron-updater fetched it separately, and a feed could answer the check with the signed file
 * and electron-updater with a legacy-only one (`files: []`, `path`, a sha256) that the check let
 * through.
 *
 * `resolveFiles` returns only the signed `files` (never the `path` fallback, never `packages`),
 * and only for an info this feed verified. The Updater (updater.ts) asks `verify` with the info
 * of `update-available`: it is accepted only if it is that same object.
 */
import type { KeyObject } from 'node:crypto';
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider.js';
import {
  Provider,
  type ResolvedUpdateFileInfo,
  type UpdateFileInfo,
  type UpdateInfo,
} from 'electron-updater';
import {
  infoMismatch,
  UpdateRefusedError,
  verifyChannel,
  type FetchText,
  type UpdateInfoLike,
  type VerifiedRelease,
  type VerifyResult,
} from './update-signature.ts';

export interface SignedFeedOptions {
  /** The feed's base URL (null: none, every check is refused). */
  feed: string | null;
  /** The channel file of this system (`channelFileName`). */
  channelFile: string;
  keys: readonly KeyObject[];
  fetchText: FetchText;
  now?: () => number;
}

/** The base URL as electron-updater makes it (util.newBaseUrl): always ending with a slash. */
function baseUrl(feed: string): URL {
  const u = new URL(feed);
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u;
}

/** A file of the feed (util.newUrlFromBase without the cache buster). */
function fileUrl(name: string, base: URL): URL {
  const u = new URL(name, base);
  if (base.search) u.search = base.search;
  return u;
}

/** The feed, verified: what the provider gives electron-updater, and the check of it. */
export class SignedFeed {
  private readonly releases = new WeakMap<object, VerifiedRelease>();
  private readonly o: SignedFeedOptions;

  constructor(options: SignedFeedOptions) {
    this.o = options;
  }

  /** The options of `setFeedURL`. */
  publishOptions(channel: string): {
    provider: 'custom';
    url: string;
    channel: string;
    updateProvider: typeof SignedProvider;
    signedFeed: SignedFeed;
  } {
    return {
      provider: 'custom',
      url: this.o.feed ?? 'https://invalid.invalid/',
      channel,
      updateProvider: SignedProvider,
      signedFeed: this,
    };
  }

  get feed(): string | null {
    return this.o.feed;
  }

  /** One read and check of the feed: the signed info, or a refusal thrown. */
  async latest(): Promise<UpdateInfo> {
    const r = await verifyChannel(this.o);
    if (!r.ok) throw new UpdateRefusedError(r.reason, r.detail, r.version ?? null);
    const info = r.release.info;
    if (!info) throw new UpdateRefusedError('malformed', 'no parsed info', r.release.version);
    this.releases.set(info, r.release);
    return info as unknown as UpdateInfo;
  }

  /** The release of an info this feed verified (the same object), or null. */
  releaseOf(info: object): VerifiedRelease | null {
    return this.releases.get(info) ?? null;
  }

  /** Whether `info` (of `update-available`) is the object this feed verified. */
  verify(info: UpdateInfoLike): VerifyResult {
    const release = this.releaseOf(info);
    if (!release) {
      return {
        ok: false,
        reason: 'mismatch',
        detail: 'not the channel file this app verified',
        version: info.version,
      };
    }
    const mismatch = infoMismatch(info, release.signed);
    if (mismatch) return { ok: false, reason: 'mismatch', detail: mismatch, version: info.version };
    return { ok: true, release };
  }
}

/** electron-updater's `custom` provider: constructed by electron-updater (providerFactory). */
export class SignedProvider extends Provider<UpdateInfo> {
  private readonly signedFeed: SignedFeed;
  private readonly base: URL;

  constructor(
    options: { url: string; signedFeed?: unknown },
    _updater: unknown,
    runtimeOptions: ProviderRuntimeOptions,
  ) {
    super(runtimeOptions);
    if (!(options.signedFeed instanceof SignedFeed)) {
      throw new Error('the signed provider needs its feed');
    }
    this.signedFeed = options.signedFeed;
    this.base = baseUrl(options.url);
  }

  getLatestVersion(): Promise<UpdateInfo> {
    return this.signedFeed.latest();
  }

  resolveFiles(updateInfo: UpdateInfo): ResolvedUpdateFileInfo[] {
    const release = this.signedFeed.releaseOf(updateInfo);
    if (!release) throw new UpdateRefusedError('mismatch', 'not verified', updateInfo.version);
    // Only the signed list: no `path` fallback, no `packages`.
    const files = (updateInfo.files as UpdateFileInfo[] | undefined) ?? [];
    return files.map((f) => {
      if (!release.signed.files.some((s) => s.url === f.url && s.sha512 === f.sha512)) {
        throw new UpdateRefusedError('mismatch', `${f.url} not signed`, updateInfo.version);
      }
      return { url: fileUrl(f.url, this.base), info: f };
    });
  }
}
