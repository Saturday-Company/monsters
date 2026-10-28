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

/**
 * Heading text reduced to what a person means by it: case, Unicode form, markdown
 * emphasis and code markers, backslash escapes (`Z\_One`), link syntax, dash and quote
 * variants, spacing and a trailing `:` or `.` do not count.
 */
export function normalizeHeading(h: string): string {
  return h
    .normalize('NFKC')
    .replace(/\\([\\`*_{}[\]()#+\-.!~|<>])/g, '$1')
    .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#+\s*/, '')
    .replace(/[*_`]|~~/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/[\s:.]+$/, '')
    .trim()
    .toLowerCase();
}

function sectionAt(scan: Scan, idx: number): Section {
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

/**
 * Finds a section by heading text, with the tolerant comparison of `normalizeHeading`.
 * This is the strict equality used by every caller, edits included. With two headings of
 * the same name the first wins: edits go through `lookupSections`, which refuses that case.
 */
export function findSection(scan: Scan, heading: string): Section | null {
  const wanted = normalizeHeading(heading);
  const idx = scan.headings.findIndex((h) => normalizeHeading(h.text) === wanted);
  return idx === -1 ? null : sectionAt(scan, idx);
}

/** A heading that matched a section lookup, with where it is. */
export interface SectionMatch {
  section: Section;
  /** Heading text with its parents, `Parent > Child`: what to pass to pick this one. */
  path: string;
  /** 1-based line of the heading in the note. */
  line: number;
}

/** Index of the headings that contain heading `idx`, outermost first. */
function ancestorsOf(scan: Scan, idx: number): number[] {
  const out: number[] = [];
  let level = scan.headings[idx]!.level;
  for (let i = idx - 1; i >= 0 && level > 1; i--) {
    const h = scan.headings[i]!;
    if (h.level < level) {
      out.unshift(i);
      level = h.level;
    }
  }
  return out;
}

const PATH_SEPARATOR = '>';

/**
 * Every section a heading asked for can mean. `heading` is the heading text (same comparison
 * as `findSection`) or a path `Parent > Child` to tell apart two headings of the same name:
 * the parts after the first must be the headings that contain the last one, in order (levels
 * may be skipped). A heading that really contains `>` is matched as written first.
 */
export function lookupSections(scan: Scan, heading: string): SectionMatch[] {
  const wanted = normalizeHeading(heading);
  const parts = heading.includes(PATH_SEPARATOR)
    ? heading.split(PATH_SEPARATOR).map(normalizeHeading)
    : [wanted];
  const hits: number[] = [];
  scan.headings.forEach((h, i) => {
    if (normalizeHeading(h.text) === wanted) hits.push(i);
  });
  if (hits.length === 0 && parts.length > 1 && parts.every((p) => p !== '')) {
    const last = parts[parts.length - 1]!;
    scan.headings.forEach((h, i) => {
      if (normalizeHeading(h.text) !== last) return;
      const chain = ancestorsOf(scan, i).map((a) => normalizeHeading(scan.headings[a]!.text));
      let from = 0;
      const inOrder = parts.slice(0, -1).every((p) => {
        const at = chain.indexOf(p, from);
        from = at + 1;
        return at !== -1;
      });
      if (inOrder) hits.push(i);
    });
  }
  return hits.map((i) => ({
    section: sectionAt(scan, i),
    path: [...ancestorsOf(scan, i), i].map((a) => scan.headings[a]!.text).join(' > '),
    line: scan.text.slice(0, scan.headings[i]!.start).split('\n').length,
  }));
}

/** A part of a note found by a loose match, for reading only. */
export interface LooseSection {
  /** Offsets into the original text. */
  start: number;
  end: number;
  /** The heading or the line that matched. */
  matched: string;
}

const LEADING_NUMBER = /^(\d+(?:\.\d+)*)(?=[.):]?(?:\s|$))/;

const leadingNumber = (normalized: string): string | null =>
  LEADING_NUMBER.exec(normalized)?.[1] ?? null;

/** `a` starts with `b` (or the reverse) on a word boundary, the shorter one at least 3 characters. */
function prefixMatch(a: string, b: string): boolean {
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  if (short.length < 3 || !long.startsWith(short)) return false;
  return long.length === short.length || !/[\p{L}\p{N}]/u.test(long.charAt(short.length));
}

/** The forms a body line can be read as a title: without `>` and `#`, and also without a list marker. */
function lineForms(line: string): string[] {
  const quoted = line.replace(/^\s*(?:>\s*)+/, '').replace(/^\s*#{1,6}\s+/, '');
  const unlisted = quoted.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
  return [...new Set([normalizeHeading(quoted), normalizeHeading(unlisted)])].filter(Boolean);
}

/**
 * Looser lookup for reading, when `findSection` found nothing: (1) a unique heading that starts
 * with the wanted text or the reverse, or that has the same section number; (2) a body line
 * (outside code and comments) that reads as a title, like `**4.3 Title**`, a list item or a
 * quoted heading, running to the next real heading. Null if nothing fits clearly.
 */
export function findSectionLoose(scan: Scan, heading: string): LooseSection | null {
  const wanted = normalizeHeading(heading);
  if (!wanted) return null;
  const normalized = scan.headings.map((h) => normalizeHeading(h.text));

  const fromHeading = (idx: number): LooseSection => {
    const s = sectionAt(scan, idx);
    return { start: s.heading.start, end: s.end, matched: s.heading.text };
  };
  const unique = (idxs: number[]): number | null => (idxs.length === 1 ? idxs[0]! : null);
  const indexes = (test: (n: string) => boolean): number[] =>
    normalized.flatMap((n, i) => (test(n) ? [i] : []));

  const number = leadingNumber(wanted);
  // A title is also recognized without its number (`Struttura` for `4. Struttura`).
  const unnumbered = (n: string) => n.replace(/^\d+(?:\.\d+)*[.):]?\s+/, '');
  const byPrefix = unique(
    indexes((n) => n !== '' && (prefixMatch(n, wanted) || prefixMatch(unnumbered(n), wanted))),
  );
  if (byPrefix !== null) return fromHeading(byPrefix);
  if (number) {
    const byNumber = unique(indexes((n) => leadingNumber(n) === number));
    if (byNumber !== null) return fromHeading(byNumber);
  }

  const headingStarts = new Set(scan.headings.map((h) => h.start));
  const candidates: { start: number; end: number; forms: string[] }[] = [];
  let pos = scan.bodyStart;
  while (pos < scan.masked.length) {
    const nl = scan.masked.indexOf('\n', pos);
    const lineEnd = nl === -1 ? scan.masked.length : nl;
    const raw = scan.masked.slice(pos, lineEnd).replace(/\r$/, '');
    if (raw.trim() !== '' && !headingStarts.has(pos)) {
      candidates.push({ start: pos, end: lineEnd, forms: lineForms(raw) });
    }
    pos = lineEnd + 1;
  }
  const sameNumber = (c: { forms: string[] }) => c.forms.some((f) => leadingNumber(f) === number);
  const hit =
    candidates.find((c) => c.forms.includes(wanted)) ??
    candidates.find((c) =>
      c.forms.some((f) => f.length > wanted.length && prefixMatch(f, wanted)),
    ) ??
    (number && candidates.filter(sameNumber).length === 1
      ? candidates.find(sameNumber)
      : undefined);
  if (!hit) return null;
  const next = scan.headings.find((h) => h.start > hit.start);
  return {
    start: hit.start,
    end: next?.start ?? scan.text.length,
    matched: scan.text.slice(hit.start, hit.end).replace(/\r$/, '').trim(),
  };
}
