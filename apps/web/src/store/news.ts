import { create } from 'zustand';
import { compareVersions } from '../lib/changelog.ts';

/*
 * "Novità": the last version whose news the user opened, per browser
 * (localStorage, a convenience: without storage there is never a light).
 * First run ever: the version in use is stored silently, so a new install
 * does not start with a light.
 */

export const NEWS_SEEN_KEY = 'monsters-news-seen';

function read(): string | null {
  try {
    return window.localStorage.getItem(NEWS_SEEN_KEY);
  } catch {
    return null;
  }
}

function write(version: string): boolean {
  try {
    window.localStorage.setItem(NEWS_SEEN_KEY, version);
    return true;
  } catch {
    return false;
  }
}

export const useNews = create<{ seen: string | null }>()(() => ({ seen: read() }));

/** First run: remembers the version in use without lighting the key. */
export function initNewsSeen(version: string): void {
  if (!version || useNews.getState().seen !== null) return;
  if (read() === null && write(version)) useNews.setState({ seen: version });
}

/** The user looked at the news of `version`. */
export function markNewsSeen(version: string): void {
  if (!version) return;
  const cur = useNews.getState().seen;
  if (cur !== null && compareVersions(version, cur) <= 0) return;
  if (write(version)) useNews.setState({ seen: version });
}

/** Whether the version in use is newer than the last one looked at. */
export function hasNews(version: string, seen: string | null): boolean {
  return !!version && seen !== null && compareVersions(version, seen) > 0;
}
