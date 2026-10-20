/*
 * Data read once at build time: the releases from the update feed, the stars and contributors
 * from GitHub. Every source has a committed fallback (src/data/fallback.json), so a build
 * without network, or with the repo still private, still produces a complete site.
 */
import fallback from '../data/fallback.json' with { type: 'json' };
import {
  FEEDS,
  FEED_BASE,
  downloadsFrom,
  latestVersion,
  parseFeed,
  type Download,
  type Feed,
} from './feed.ts';
import { starsFromRepo } from './stars.ts';

export interface Contributor {
  login: string;
  name: string;
  url: string;
}

export interface SiteData {
  version: string;
  releaseDate: string | null;
  downloads: Download[];
  stars: number | null;
  contributors: Contributor[];
  /** Which sources came from the fallback (printed by the build). */
  offline: string[];
}

const API = 'https://api.github.com/repos/Saturday-Company/monsters';
const TIMEOUT = 8000;

async function get(url: string, accept: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { accept, 'user-agent': 'monsters-site-build' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

async function feeds(): Promise<Feed[]> {
  return Promise.all(
    Object.values(FEEDS).map(async (file) =>
      parseFeed(await (await get(`${FEED_BASE}/${file}`, 'text/yaml')).text()),
    ),
  );
}

async function contributors(): Promise<Contributor[]> {
  const body = (await (
    await get(`${API}/contributors?per_page=24`, 'application/vnd.github+json')
  ).json()) as unknown;
  if (!Array.isArray(body)) throw new Error('contributors: not a list');
  return body
    .filter((c): c is { login: string; html_url: string; type?: string } => {
      const v = c as { login?: unknown; html_url?: unknown; type?: unknown };
      return typeof v.login === 'string' && typeof v.html_url === 'string' && v.type !== 'Bot';
    })
    .map((c) => ({ login: c.login, name: c.login, url: c.html_url }));
}

let cached: Promise<SiteData> | null = null;

/** Memoised: both language pages share one set of requests per build. */
export function siteData(): Promise<SiteData> {
  cached ??= load();
  return cached;
}

async function load(): Promise<SiteData> {
  const offline: string[] = [];
  const noNetwork = process.env['MONSTERS_SITE_OFFLINE'] === '1';
  const attempt = async <T>(label: string, fn: () => Promise<T>, fb: T): Promise<T> => {
    if (noNetwork) {
      offline.push(label);
      return fb;
    }
    try {
      return await fn();
    } catch (err) {
      console.warn(`[site] ${label}: using the fallback (${(err as Error).message})`);
      offline.push(label);
      return fb;
    }
  };

  const fbFeeds = fallback.feeds as Feed[];
  const fs = await attempt('feed', feeds, fbFeeds);
  const stars = await attempt(
    'stars',
    async () => starsFromRepo(await (await get(API, 'application/vnd.github+json')).json()) ?? null,
    fallback.stars as number | null,
  );
  const people = await attempt('contributors', contributors, fallback.contributors);
  const version = latestVersion(fs);
  const newest = fs.find((f) => f.version === version);
  return {
    version,
    releaseDate: newest?.releaseDate ?? null,
    downloads: downloadsFrom(fs),
    stars,
    contributors: people.length > 0 ? people : fallback.contributors,
    offline,
  };
}
