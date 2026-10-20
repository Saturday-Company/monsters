import type { Scan } from './scan.ts';

/*
 * Tokenizer for Obsidian links and tags. It works on the masked text of a scan
 * (code and comments blanked) so offsets always point into the original text.
 */

export interface ParsedLink {
  kind: 'wiki' | 'markdown';
  embed: boolean;
  /** Target as written, without heading/block/alias ("Progetti/Monsters", "img.png"). Empty = same note. */
  target: string;
  heading: string | null;
  block: string | null;
  /** Display text (`[[A|alias]]`) or the text of a Markdown link. */
  alias: string | null;
  /** Whole link, `!` included. */
  start: number;
  end: number;
  /** Range of the target name only: renames rewrite exactly this range. */
  targetStart: number;
  targetEnd: number;
  /** Link written in a frontmatter property (`rel: "[[Marco]]"`). */
  inProperty: boolean;
}

export interface ParsedTag {
  /** Lowercase, without `#`. */
  tag: string;
  start: number;
  end: number;
}

const WIKILINK = /(!?)\[\[([^[\]\n]+?)\]\]/g;
// [text](target "title") or [text](<target with spaces>)
const MDLINK = /(!?)\[([^\]\n]*)\]\((<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\)/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const INLINE_TAG = /(^|[\s(,;])#([\p{L}\p{N}_/-]+)/gu;

function splitTarget(inner: string): {
  name: string;
  heading: string | null;
  block: string | null;
} {
  const hash = inner.indexOf('#');
  if (hash !== -1) {
    const name = inner.slice(0, hash);
    const rest = inner.slice(hash + 1);
    if (rest.startsWith('^')) return { name, heading: null, block: rest.slice(1) };
    return { name, heading: rest, block: null };
  }
  const caret = inner.indexOf('^');
  if (caret !== -1)
    return { name: inner.slice(0, caret), heading: null, block: inner.slice(caret + 1) };
  return { name: inner, heading: null, block: null };
}

function wikiLinks(source: string, offset: number, inProperty: boolean): ParsedLink[] {
  const links: ParsedLink[] = [];
  for (const m of source.matchAll(WIKILINK)) {
    const embed = m[1] === '!';
    const inner = m[2] ?? '';
    // `\|` is the escaped pipe used inside tables.
    const pipe = inner.search(/\\?\|/);
    const targetPart = pipe === -1 ? inner : inner.slice(0, pipe);
    const alias = pipe === -1 ? null : inner.slice(pipe).replace(/^\\?\|/, '');
    const { name, heading, block } = splitTarget(targetPart);
    const lead = name.length - name.trimStart().length;
    const start = offset + (m.index ?? 0);
    const targetStart = start + m[1]!.length + 2 + lead;
    links.push({
      kind: 'wiki',
      embed,
      target: name.trim(),
      heading: heading?.trim() || null,
      block: block?.trim() || null,
      alias,
      start,
      end: start + m[0].length,
      targetStart,
      targetEnd: targetStart + name.trim().length,
      inProperty,
    });
  }
  return links;
}

function markdownLinks(source: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  for (const m of source.matchAll(MDLINK)) {
    let raw = m[3] ?? '';
    const start = m.index ?? 0;
    const hrefStart = start + m[0].indexOf(`](${raw}`) + 2;
    let rawStart = hrefStart;
    if (raw.startsWith('<')) {
      raw = raw.slice(1, -1);
      rawStart++;
    }
    if (raw === '' || raw.startsWith('#') || SCHEME.test(raw)) continue;
    const hash = raw.indexOf('#');
    const pathPart = hash === -1 ? raw : raw.slice(0, hash);
    const fragment = hash === -1 ? null : raw.slice(hash + 1);
    let decoded: string;
    try {
      decoded = decodeURI(pathPart);
    } catch {
      decoded = pathPart;
    }
    const isBlock = fragment?.startsWith('^') ?? false;
    links.push({
      kind: 'markdown',
      embed: m[1] === '!',
      target: decoded,
      heading: fragment && !isBlock ? safeDecode(fragment) : null,
      block: fragment && isBlock ? fragment.slice(1) : null,
      alias: m[2] ?? null,
      start,
      end: start + m[0].length,
      targetStart: rawStart,
      targetEnd: rawStart + pathPart.length,
      inProperty: false,
    });
  }
  return links;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** All links of a note: body (code excluded) and frontmatter properties. */
export function extractLinks(scan: Scan): ParsedLink[] {
  const links: ParsedLink[] = [];
  if (scan.frontmatter) {
    links.push(...wikiLinks(scan.frontmatter.yaml, scan.frontmatter.yamlStart, true));
  }
  const body =
    scan.masked.slice(0, scan.bodyStart).replace(/[^\n]/g, ' ') + scan.masked.slice(scan.bodyStart);
  const wiki = wikiLinks(body, 0, false);
  // Markdown links must not be matched inside wikilinks.
  const md = markdownLinks(body).filter(
    (l) => !wiki.some((w) => l.start < w.end && w.start < l.end),
  );
  links.push(...wiki, ...md);
  return links.sort((a, b) => a.start - b.start);
}

/** A tag is valid when it has at least one non-digit character (Obsidian rule). */
export function isValidTag(tag: string): boolean {
  return tag.length > 0 && !/^[\d/]+$/.test(tag);
}

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#/, '').toLowerCase();
}

/** Inline `#tags` of the body (code, comments and links excluded). */
export function extractInlineTags(scan: Scan, links: readonly ParsedLink[]): ParsedTag[] {
  let body =
    scan.masked.slice(0, scan.bodyStart).replace(/[^\n]/g, ' ') + scan.masked.slice(scan.bodyStart);
  for (const l of links) {
    if (!l.inProperty)
      body = body.slice(0, l.start) + ' '.repeat(l.end - l.start) + body.slice(l.end);
  }
  const tags: ParsedTag[] = [];
  for (const m of body.matchAll(INLINE_TAG)) {
    const raw = (m[2] ?? '').replace(/\/+$/, '');
    if (!isValidTag(raw)) continue;
    const start = (m.index ?? 0) + (m[1]?.length ?? 0);
    tags.push({ tag: raw.toLowerCase(), start, end: start + 1 + raw.length });
  }
  return tags;
}
