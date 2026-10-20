/*
 * The GitHub star counter on the LED display. The count comes from the build (fallback) and, in
 * the browser, from the GitHub API without a token (60 requests an hour per address), cached in
 * localStorage. Every storage access is guarded: private windows and blocked storage throw.
 */

export const STAR_CACHE_KEY = 'monsters.stars.v1';
/** One hour: stars do not move that fast, and the anonymous API limit is low. */
export const STAR_CACHE_TTL = 60 * 60 * 1000;
export const LED_DIGITS = 4;

/**
 * What the four 7-segment cells show. Up to 9999 the plain number, then `12k`, `1.2M`. `null`
 * (unknown, private repo, API down) shows dashes.
 */
export function formatStars(n: number | null | undefined, digits = LED_DIGITS): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return '-'.repeat(digits);
  const v = Math.floor(n);
  let s: string;
  if (v < 10 ** digits) s = String(v);
  else if (v < 1_000_000) s = `${Math.floor(v / 1000)}k`;
  else s = `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  return s.length >= digits ? s.slice(0, digits + 1) : s.padStart(digits, ' ');
}

/** Long form for screen readers and the big number of the open source section. */
export function formatStarsLong(n: number | null | undefined, locale = 'en'): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return '';
  return new Intl.NumberFormat(locale).format(Math.floor(n));
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StarCache {
  count: number;
  at: number;
}

/** The cached count when it is still fresh; null when missing, stale, broken or unreadable. */
export function readStarCache(
  storage: StorageLike | null | undefined,
  now: number,
  ttl = STAR_CACHE_TTL,
): StarCache | null {
  try {
    const raw = storage?.getItem(STAR_CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StarCache>;
    if (typeof v.count !== 'number' || typeof v.at !== 'number') return null;
    if (now - v.at > ttl || v.at > now) return null;
    return { count: v.count, at: v.at };
  } catch {
    return null;
  }
}

export function writeStarCache(
  storage: StorageLike | null | undefined,
  count: number,
  now: number,
) {
  try {
    storage?.setItem(STAR_CACHE_KEY, JSON.stringify({ count, at: now }));
  } catch {
    // Storage full or blocked: the counter simply asks again next time.
  }
}

/** `stargazers_count` from a `GET /repos/{owner}/{repo}` body, or null. */
export function starsFromRepo(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const n = (body as { stargazers_count?: unknown }).stargazers_count;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}
