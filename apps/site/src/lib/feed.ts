/*
 * The desktop releases, read at build time from the update feed of the app (electron-updater's
 * `alpha*.yml`, served by apps/update-server). Only the few keys the site needs are parsed: the
 * format is the flat YAML electron-builder writes, so a tiny line parser is enough and keeps the
 * site free of a YAML dependency.
 */
import type { Os } from './os.ts';

export const REPO_URL = 'https://github.com/Saturday-Company/monsters';
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
export const FEED_BASE = 'https://monsters-updates.saturdaycompany.workers.dev/desktop';
/** One feed per system (apps/desktop/scripts/package-config.ts, channel `alpha`). */
export const FEEDS = { linux: 'alpha-linux.yml', windows: 'alpha.yml', mac: 'alpha-mac.yml' };

export interface FeedFile {
  url: string;
  size: number;
}

export interface Feed {
  version: string;
  releaseDate: string | null;
  files: FeedFile[];
}

const unquote = (v: string): string => v.trim().replace(/^(['"])(.*)\1$/, '$2');

/** Parses one `alpha*.yml`. Throws when there is no version or no file. */
export function parseFeed(text: string): Feed {
  let version = '';
  let releaseDate: string | null = null;
  const files: FeedFile[] = [];
  let current: FeedFile | null = null;
  let inFiles = false;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const top = /^([A-Za-z]\w*):\s*(.*)$/.exec(raw);
    if (top) {
      inFiles = top[1] === 'files';
      if (top[1] === 'version') version = unquote(top[2] ?? '');
      if (top[1] === 'releaseDate') releaseDate = unquote(top[2] ?? '') || null;
      continue;
    }
    if (!inFiles) continue;
    const item = /^\s*-\s+url:\s*(.+)$/.exec(raw);
    if (item) {
      current = { url: unquote(item[1] ?? ''), size: 0 };
      files.push(current);
      continue;
    }
    const size = /^\s+size:\s*(\d+)\s*$/.exec(raw);
    if (size && current) current.size = Number(size[1]);
  }
  if (!version) throw new Error('feed without a version');
  if (files.length === 0) throw new Error('feed without files');
  return { version, releaseDate, files };
}

export type DownloadId = 'appimage' | 'deb' | 'dmg-arm64' | 'dmg-x64' | 'exe';

export interface Download {
  id: DownloadId;
  os: Exclude<Os, 'unknown'>;
  /** Short name of the format, shown on the key. */
  format: string;
  file: string;
  size: number;
  url: string;
}

const MATCHERS: { id: DownloadId; os: Download['os']; format: string; test: RegExp }[] = [
  { id: 'appimage', os: 'linux', format: 'AppImage', test: /\.AppImage$/ },
  { id: 'deb', os: 'linux', format: '.deb', test: /\.deb$/ },
  { id: 'dmg-arm64', os: 'mac', format: '.dmg', test: /-arm64[^/]*\.dmg$/ },
  { id: 'dmg-x64', os: 'mac', format: '.dmg', test: /-x64[^/]*\.dmg$/ },
  { id: 'exe', os: 'windows', format: '.exe', test: /\.exe$/ },
];

/** Direct link to a file of the latest GitHub release. */
export const downloadUrl = (file: string): string =>
  `${REPO_URL}/releases/latest/download/${encodeURIComponent(file)}`;

/** The installers the site offers, in a fixed order, from the three feeds. */
export function downloadsFrom(feeds: readonly Feed[]): Download[] {
  const all = feeds.flatMap((f) => f.files);
  const out: Download[] = [];
  for (const m of MATCHERS) {
    const file = all.find((f) => m.test.test(f.url));
    if (file)
      out.push({
        id: m.id,
        os: m.os,
        format: m.format,
        file: file.url,
        size: file.size,
        url: downloadUrl(file.url),
      });
  }
  return out;
}

/** `123295747` → `118 MB` (binary megabytes, like the file managers). */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/** The newest version among the feeds (they normally agree). */
export function latestVersion(feeds: readonly Feed[]): string {
  const sorted = [...feeds].sort((a, b) => compareVersions(b.version, a.version));
  return sorted[0]?.version ?? '';
}

/** Semver-ish comparison that understands `-alpha.N`. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = '', pre = ''] = v.split('-', 2);
    const nums = core.split('.').map((n) => Number(n) || 0);
    const preNum = Number(/(\d+)$/.exec(pre)?.[1] ?? Number.POSITIVE_INFINITY);
    return { nums, pre, preNum };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  if (pa.preNum !== pb.preNum) return Math.sign(pa.preNum - pb.preNum);
  return pa.pre < pb.pre ? -1 : 1;
}
