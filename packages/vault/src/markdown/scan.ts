/*
 * Lightweight Markdown scanner. It does not build an AST: it finds the regions
 * where links, tags and headings must be ignored (frontmatter, fenced code,
 * inline code, HTML and Obsidian comments) and the headings, with offsets into
 * the original text so edits can replace exact ranges.
 *
 * Indented code blocks are not detected on purpose: in Obsidian notes indented
 * lines are almost always nested lists.
 */

export interface Range {
  start: number;
  end: number;
}

export interface FrontmatterBlock {
  /** Whole block, from the opening `---` to the end of the closing line. */
  range: Range;
  /** The YAML text between the fences. */
  yaml: string;
  yamlStart: number;
}

export interface Heading {
  level: number;
  text: string;
  /** Start of the heading line. */
  start: number;
  /** End of the heading line, newline included when present. */
  lineEnd: number;
}

export interface Scan {
  text: string;
  frontmatter: FrontmatterBlock | null;
  /** Offset where the body starts (after the frontmatter). */
  bodyStart: number;
  /** Ranges to ignore (code, comments); the frontmatter is not included. */
  excluded: Range[];
  /** Text where excluded ranges are blanked (newlines kept): offsets match `text`. */
  masked: string;
  headings: Heading[];
}

const FENCE_OPEN = /^((?:[ \t]*>)*[ \t]*)(`{3,}|~{3,})(.*)$/;

interface Line {
  start: number;
  /** End without the newline. */
  end: number;
  /** End including the newline. */
  next: number;
}

function splitLines(text: string, from = 0): Line[] {
  const lines: Line[] = [];
  let pos = from;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    if (nl === -1) {
      lines.push({ start: pos, end: text.length, next: text.length });
      break;
    }
    const end = nl > pos && text.charAt(nl - 1) === '\r' ? nl - 1 : nl;
    lines.push({ start: pos, end, next: nl + 1 });
    pos = nl + 1;
  }
  return lines;
}

export function findFrontmatter(text: string): FrontmatterBlock | null {
  const first = /^---[ \t]*\r?\n/.exec(text);
  if (!first) return null;
  const yamlStart = first[0].length;
  for (const line of splitLines(text, yamlStart)) {
    const content = text.slice(line.start, line.end);
    if (/^(---|\.\.\.)[ \t]*$/.test(content)) {
      return {
        range: { start: 0, end: line.next },
        yaml: text.slice(yamlStart, line.start),
        yamlStart,
      };
    }
  }
  return null;
}

function fencedBlocks(text: string, from: number): Range[] {
  const ranges: Range[] = [];
  let open: { char: string; len: number; start: number } | null = null;
  for (const line of splitLines(text, from)) {
    const content = text.slice(line.start, line.end);
    if (open) {
      const m = FENCE_OPEN.exec(content);
      if (
        m &&
        m[2]?.charAt(0) === open.char &&
        (m[2]?.length ?? 0) >= open.len &&
        (m[3] ?? '').trim() === ''
      ) {
        ranges.push({ start: open.start, end: line.next });
        open = null;
      }
      continue;
    }
    const m = FENCE_OPEN.exec(content);
    if (m?.[2]) {
      const char = m[2].charAt(0);
      // A backtick fence cannot have backticks in its info string.
      if (char === '`' && (m[3] ?? '').includes('`')) continue;
      open = { char, len: m[2].length, start: line.start };
    }
  }
  if (open) ranges.push({ start: open.start, end: text.length });
  return ranges;
}

/** Comments and inline code inside a segment that has no fenced code. */
function inlineRegions(text: string, start: number, end: number): Range[] {
  const ranges: Range[] = [];
  let i = start;
  while (i < end) {
    const c = text.charAt(i);
    if (c === '<' && text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      const stop = close === -1 || close + 3 > end ? end : close + 3;
      ranges.push({ start: i, end: stop });
      i = stop;
      continue;
    }
    if (c === '%' && text.charAt(i + 1) === '%') {
      const close = text.indexOf('%%', i + 2);
      const stop = close === -1 || close + 2 > end ? end : close + 2;
      ranges.push({ start: i, end: stop });
      i = stop;
      continue;
    }
    if (c === '`') {
      let n = 0;
      while (text.charAt(i + n) === '`') n++;
      const close = findClosingBackticks(text, i + n, end, n);
      if (close === -1) {
        i += n;
        continue;
      }
      ranges.push({ start: i, end: close + n });
      i = close + n;
      continue;
    }
    i++;
  }
  return ranges;
}

/** Finds a run of exactly `n` backticks before the end of the paragraph. */
function findClosingBackticks(text: string, from: number, end: number, n: number): number {
  let j = from;
  while (j < end) {
    const c = text.charAt(j);
    if (c === '\n' && /^\n[ \t]*\r?\n/.test(text.slice(j, j + 64))) return -1;
    if (c === '`') {
      let m = 0;
      while (text.charAt(j + m) === '`') m++;
      if (m === n) return j;
      j += m;
      continue;
    }
    j++;
  }
  return -1;
}

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

export function scanMarkdown(text: string): Scan {
  const frontmatter = findFrontmatter(text);
  const bodyStart = frontmatter?.range.end ?? 0;
  const fences = fencedBlocks(text, bodyStart);

  const excluded: Range[] = [];
  let cursor = bodyStart;
  for (const fence of fences) {
    excluded.push(...inlineRegions(text, cursor, fence.start), fence);
    cursor = fence.end;
  }
  excluded.push(...inlineRegions(text, cursor, text.length));

  const masked = maskRanges(text, excluded);
  const headings: Heading[] = [];
  for (const line of splitLines(masked, bodyStart)) {
    const m = HEADING.exec(masked.slice(line.start, line.end));
    if (!m?.[1]) continue;
    const original = HEADING.exec(text.slice(line.start, line.end));
    headings.push({
      level: m[1].length,
      text: (original?.[2] ?? m[2] ?? '').trim(),
      start: line.start,
      lineEnd: line.next,
    });
  }
  return { text, frontmatter, bodyStart, excluded, masked, headings };
}

/** Replaces every character inside the ranges with a space (newlines are kept). */
export function maskRanges(text: string, ranges: readonly Range[]): string {
  if (ranges.length === 0) return text;
  let out = '';
  let pos = 0;
  for (const r of ranges) {
    out += text.slice(pos, r.start) + text.slice(r.start, r.end).replace(/[^\n]/g, ' ');
    pos = r.end;
  }
  return out + text.slice(pos);
}

export interface Section {
  heading: Heading;
  /** Start of the content (after the heading line). */
  contentStart: number;
  /** End of the section: next heading of the same or a higher level, or end of text. */
  end: number;
}

function normalizeHeading(h: string): string {
  return h
    .replace(/^#+\s*/, '')
    .trim()
    .toLowerCase();
}

/** Finds a section by heading text (case-insensitive, leading `#` ignored). */
export function findSection(scan: Scan, heading: string): Section | null {
  const wanted = normalizeHeading(heading);
  const idx = scan.headings.findIndex((h) => normalizeHeading(h.text) === wanted);
  if (idx === -1) return null;
  const h = scan.headings[idx]!;
  let end = scan.text.length;
  for (const next of scan.headings.slice(idx + 1)) {
    if (next.level <= h.level) {
      end = next.start;
      break;
    }
  }
  return { heading: h, contentStart: h.lineEnd, end };
}
