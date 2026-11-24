/*
 * The `<lastmod>` of every page in the sitemap, each from where the page's content really comes
 * from: the guides from the git history of their Markdown file, the comparisons from the day their
 * facts were checked, the changelog from its newest release, the home from the build.
 */
import { VERIFIED } from '../i18n/compare.ts';
import { FRAMEWORKS_VERIFIED } from '../i18n/frameworks.ts';
import { GUIDES, changelogFile, parseChangelog, readRepoFile } from './docs.ts';
import { fileDates } from './history.ts';

export interface LastmodInput {
  /** ISO day of this build. */
  buildDay: string;
  /** ISO day of the newest release, '' when unknown. */
  releaseDay: string;
}

const newest = (days: string[]): string =>
  days.filter(Boolean).reduce((a, b) => (a > b ? a : b), '');

/** The ISO day of the newest release in the changelog ('' when it cannot be read). */
export function changelogDay(): string {
  try {
    return newest(parseChangelog(readRepoFile(changelogFile('en'))).map((r) => r.date));
  } catch {
    return '';
  }
}

/** The day a guide changed: its git history, then the release, then the build. */
export function guideDay(file: string, input: LastmodInput): string {
  return fileDates(`docs/${file}`)?.modified ?? (input.releaseDay || input.buildDay);
}

/** A function from the path of a page (either language) to its `<lastmod>` day. */
export function lastmodResolver(input: LastmodInput): (path: string) => string {
  const clean = (path: string): string => path.replace(/^\/it(?=\/)/, '') || '/';
  return (raw) => {
    const path = clean(raw);
    if (path === '/') return input.buildDay;
    if (path === '/changelog/') return changelogDay() || input.releaseDay || input.buildDay;
    if (path === '/compare/frameworks/') return FRAMEWORKS_VERIFIED;
    if (path.startsWith('/compare/')) return VERIFIED;
    if (path === '/docs/getting-started/')
      return fileDates('apps/site/src/i18n/getting-started.ts')?.modified ?? input.buildDay;
    if (path === '/docs/') return newest(GUIDES.map((g) => guideDay(g.file, input)));
    const guide = GUIDES.find((g) => path === `/docs/${g.slug}/`);
    if (guide) return guideDay(guide.file, input);
    return input.buildDay;
  };
}
