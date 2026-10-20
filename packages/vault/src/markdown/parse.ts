import { titleOf } from '../paths.ts';
import { listProp, readFrontmatter, type Props } from './frontmatter.ts';
import {
  extractInlineTags,
  extractLinks,
  isValidTag,
  normalizeTag,
  type ParsedLink,
} from './links.ts';
import { scanMarkdown, type Heading, type Scan } from './scan.ts';

export interface ParsedNote {
  title: string;
  props: Props;
  frontmatterError: string | undefined;
  /** Stable id from the frontmatter (`id`), when present. */
  uid: string | null;
  type: string | null;
  author: string | null;
  created: string | null;
  updated: string | null;
  private: boolean;
  /** Frontmatter and inline tags, lowercase, deduplicated. */
  tags: string[];
  aliases: string[];
  links: ParsedLink[];
  headings: Heading[];
  /** Body without frontmatter (code included: it is searchable text). */
  body: string;
  scan: Scan;
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 19);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const s = String(value).trim();
    return s === '' ? null : s;
  }
  return null;
}

export function parseNote(path: string, text: string): ParsedNote {
  const scan = scanMarkdown(text);
  const fm = readFrontmatter(text);
  const props = fm.data;
  const links = extractLinks(scan);
  const tagSet = new Set<string>();
  for (const t of listProp(props.tags)) {
    for (const part of t.split(/\s+/)) {
      const tag = normalizeTag(part);
      if (isValidTag(tag)) tagSet.add(tag);
    }
  }
  for (const t of extractInlineTags(scan, links)) tagSet.add(t.tag);

  return {
    title: titleOf(path),
    props,
    frontmatterError: fm.error,
    uid: str(props.id),
    type: str(props.type),
    author: str(props.author),
    created: str(props.created),
    updated: str(props.updated),
    private: props.private === true || props.private === 'true',
    tags: [...tagSet],
    aliases: listProp(props.aliases),
    links,
    headings: scan.headings,
    body: text.slice(scan.bodyStart),
    scan,
  };
}

/** Expands hierarchical tags: `progetto/monsters` → `progetto`, `progetto/monsters`. */
export function expandTag(tag: string): string[] {
  const parts = tag.split('/').filter(Boolean);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}
