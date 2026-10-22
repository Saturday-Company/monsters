/*
 * The repository's own text, read at build time: the user guides of `docs/` (published under
 * /docs/) and the two changelogs (/changelog/). Nothing is copied into the site; the files stay
 * the single source and the build fails if one goes missing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { REPO_URL } from './feed.ts';

export interface Guide {
  /** File in `docs/`. */
  file: string;
  /** URL segment under /docs/. */
  slug: string;
  /** Short name, for lists, navigation and llms.txt. */
  title: string;
}

/**
 * The guides that make sense for someone who uses Monsters, in reading order. DECISIONS,
 * research, eval, signing, ci, design and i18n are for people working on the code: they stay on
 * GitHub only.
 */
export type GuideSlug =
  'architecture' | 'security-model' | 'subscriptions' | 'mcp-vault' | 'remote' | 'roadmap';

export const GUIDES: readonly (Guide & { slug: GuideSlug })[] = [
  {
    file: 'ARCHITECTURE.md',
    slug: 'architecture',
    title: 'Architecture',
  },
  {
    file: 'security-model.md',
    slug: 'security-model',
    title: 'Security model',
  },
  {
    file: 'subscriptions.md',
    slug: 'subscriptions',
    title: 'Subscriptions',
  },
  {
    file: 'mcp-vault.md',
    slug: 'mcp-vault',
    title: 'The vault as an MCP server',
  },
  {
    file: 'remote.md',
    slug: 'remote',
    title: 'Remote use: SSH and Telegram',
  },
  {
    file: 'ROADMAP.md',
    slug: 'roadmap',
    title: 'Roadmap',
  },
] as const;

export const guideBySlug = (slug: string): Guide | undefined => GUIDES.find((g) => g.slug === slug);

export const blob = (path: string): string => `${REPO_URL}/blob/main/${path}`;

/** The repository root, found by walking up from the build's working directory. */
export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, 'docs', 'ARCHITECTURE.md'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('docs/ not found: run the build from inside the repository');
}

export const docsDir = (): string => resolve(repoRoot(), 'docs');

export function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot(), path), 'utf8');
}

/**
 * Relative Markdown links of a guide become absolute: a link to another published guide stays
 * on the site (`/docs/<slug>/`), anything else points at the file on GitHub.
 */
export function absolutizeLinks(
  markdown: string,
  fromFile: string,
  onSite: ReadonlyMap<string, string> = new Map(),
): string {
  return markdown.replace(/\]\(([^)\s]+)\)/g, (m, target: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return m;
    const [path = '', anchor] = target.split('#');
    const abs = posix.normalize(posix.join('docs', dirname(fromFile), path));
    const local = onSite.get(abs);
    const hash = anchor ? `#${anchor}` : '';
    return local ? `](${local}${hash})` : `](${blob(abs)}${hash})`;
  });
}

/** Published guide files (`docs/<file>`) mapped to their page on the site. */
export const SITE_LINKS: ReadonlyMap<string, string> = new Map(
  GUIDES.map((g) => [`docs/${g.file}`, `/docs/${g.slug}/`]),
);

/** The guide's text for a page: its first heading is dropped (the page prints its own), links fixed. */
export function guideMarkdown(guide: Guide): { title: string; body: string } {
  const text = readFileSync(resolve(docsDir(), guide.file), 'utf8').trim();
  const m = /^#\s+(.+)\r?\n/.exec(text);
  const title = m?.[1]?.trim() ?? guide.title;
  const body = m ? text.slice(m[0].length) : text;
  return { title, body: absolutizeLinks(body.trim(), guide.file, SITE_LINKS) };
}

export interface ReleaseNote {
  version: string;
  /** The date as written in the changelog ("21 October 2026"). */
  dateText: string;
  /** ISO date, or '' when the text could not be read. */
  date: string;
  body: string;
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  maggio: 5,
  giugno: 6,
  luglio: 7,
  agosto: 8,
  settembre: 9,
  ottobre: 10,
  novembre: 11,
  dicembre: 12,
};

/** "21 October 2026" or "21 ottobre 2026" to "2026-10-21". */
export function isoDate(text: string): string {
  const m = /^(\d{1,2})\s+([^\s]+)\s+(\d{4})$/.exec(text.trim());
  const month = m?.[2] ? MONTHS[m[2].toLowerCase()] : undefined;
  if (!m || !month) return '';
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

/** Splits a changelog (`## <version> · <date>` sections) into releases, newest first as written. */
export function parseChangelog(text: string): ReleaseNote[] {
  const parts = text.split(/^## /m).slice(1);
  return parts.map((part) => {
    const nl = part.indexOf('\n');
    const head = (nl === -1 ? part : part.slice(0, nl)).trim();
    const [version = '', dateText = ''] = head.split(/\s+·\s+/);
    return {
      version: version.trim(),
      dateText: dateText.trim(),
      date: isoDate(dateText),
      body: nl === -1 ? '' : part.slice(nl + 1).trim(),
    };
  });
}

export const changelogFile = (lang: 'en' | 'it'): string =>
  lang === 'it' ? 'CHANGELOG.it.md' : 'CHANGELOG.md';
