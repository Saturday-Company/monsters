/*
 * The release the site describes, read from the build's own data: the version of the desktop app
 * in this checkout and its date from the changelog (the feed may still carry the previous build).
 */
import desktop from '../../../desktop/package.json' with { type: 'json' };
import type { SiteData } from './build-data.ts';
import { formatDate } from './dates.ts';
import { changelogFile, parseChangelog, readRepoFile } from './docs.ts';

export interface CurrentRelease {
  version: string;
  /** ISO day, or '' when no source has it. */
  date: string;
}

/** The app's version and the day it was released: the changelog first, then the feed. */
export function currentRelease(data: Pick<SiteData, 'version' | 'releaseDate'>): CurrentRelease {
  const version = desktop.version;
  let date = '';
  try {
    date =
      parseChangelog(readRepoFile(changelogFile('en'))).find((r) => r.version === version)?.date ??
      '';
  } catch {
    // no changelog next to the build: fall through to the feed
  }
  if (!date && data.version === version && data.releaseDate) date = data.releaseDate.slice(0, 10);
  return { version, date };
}

/** "0.1.0-alpha.27, 28 October 2026", or just the version when the day is unknown. */
export function releaseLabel(release: CurrentRelease, lang: string): string {
  return release.date ? `${release.version}, ${formatDate(release.date, lang)}` : release.version;
}
