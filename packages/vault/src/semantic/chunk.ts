import { contentHash } from '../fsutil.ts';
import type { Heading, Scan } from '../markdown/scan.ts';

/*
 * Chunking for semantic search (research/04 §3.4): one chunk per section of
 * the note, cut on headings. Short sections are merged with the previous
 * one, long ones are split on paragraphs with a small overlap. What gets
 * embedded is the title and the heading path followed by the text, so a
 * chunk keeps the context of the note it comes from.
 */

/** About 600 tokens: long enough for a section, short enough to stay specific. */
export const CHUNK_MAX_CHARS = 2400;
/** Sections shorter than this are merged into the previous chunk when it has room. */
export const CHUNK_MIN_CHARS = 300;
/** Text repeated at the start of the next part when a long section is split (~12%). */
export const CHUNK_OVERLAP_CHARS = 300;

export interface NoteChunk {
  ord: number;
  /** Headings above the chunk, outermost first, joined by " › " ("" before the first heading). */
  headingPath: string;
  text: string;
  /** Rough estimate (4 characters per token). */
  tokenCount: number;
  /** Hash of `embedText(...)`: equal text, equal vector (vectors are stored by hash). */
  hash: string;
}

const PATH_SEPARATOR = ' › ';

/** What the embedding model sees for a chunk. */
export function embedText(title: string, headingPath: string, text: string): string {
  const head = headingPath ? `${title}${PATH_SEPARATOR}${headingPath}` : title;
  const body = text.replace(/\n{3,}/g, '\n\n').trim();
  return body ? `${head}\n\n${body}` : head;
}

interface Piece {
  path: string;
  text: string;
}

/** Splits a long text on paragraphs (then on words) into parts of at most `max` characters. */
export function splitLong(
  text: string,
  max = CHUNK_MAX_CHARS,
  overlap = CHUNK_OVERLAP_CHARS,
): string[] {
  if (text.length <= max) return [text];
  const units: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    if (para.length <= max) {
      units.push(para);
      continue;
    }
    // A paragraph longer than a chunk: cut on spaces.
    let rest = para;
    while (rest.length > max) {
      const cut = rest.lastIndexOf(' ', max);
      const at = cut > max / 2 ? cut : max;
      units.push(rest.slice(0, at));
      rest = rest.slice(at).trimStart();
    }
    if (rest) units.push(rest);
  }
  const parts: string[] = [];
  let current = '';
  for (const unit of units) {
    if (current && current.length + unit.length + 2 > max) {
      parts.push(current);
      current = tail(current, overlap);
      if (current.length + unit.length + 2 > max) current = '';
    }
    current = current ? `${current}\n\n${unit}` : unit;
  }
  if (current) parts.push(current);
  return parts;
}

/** The last `chars` characters of a text, starting at a word boundary. */
function tail(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const start = text.indexOf(' ', text.length - chars);
  return start === -1 ? '' : text.slice(start + 1);
}

function sections(title: string, scan: Scan): Piece[] {
  const { text, bodyStart } = scan;
  const out: Piece[] = [];
  const stack: Heading[] = [];
  let pos = bodyStart;
  let path = '';
  const push = (end: number) => {
    const body = text.slice(pos, end).trim();
    if (body) out.push({ path, text: body });
  };
  for (const h of scan.headings) {
    if (h.start < bodyStart) continue;
    push(h.start);
    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= h.level) stack.pop();
    stack.push(h);
    // A top heading that repeats the title adds nothing to the path.
    path = stack
      .filter((s) => !(s.level === 1 && s.text.trim().toLowerCase() === title.toLowerCase()))
      .map((s) => s.text.trim())
      .join(PATH_SEPARATOR);
    pos = h.lineEnd;
  }
  push(text.length);
  return out;
}

/** The chunks of a note (at least one: an empty note is embedded by its title). */
export function chunkNote(note: { title: string; scan: Scan }): NoteChunk[] {
  const pieces: Piece[] = [];
  for (const s of sections(note.title, note.scan)) {
    const last = pieces.at(-1);
    const leaf = s.path.split(PATH_SEPARATOR).at(-1) ?? '';
    const merged = leaf ? `${leaf}\n${s.text}` : s.text;
    if (
      last &&
      last.text.length < CHUNK_MIN_CHARS &&
      last.text.length + merged.length + 2 <= CHUNK_MAX_CHARS
    ) {
      last.text = `${last.text}\n\n${merged}`;
      continue;
    }
    for (const part of splitLong(s.text)) pieces.push({ path: s.path, text: part });
  }
  if (pieces.length === 0) pieces.push({ path: '', text: '' });
  return pieces.map((p, ord) => ({
    ord,
    headingPath: p.path,
    text: p.text,
    tokenCount: Math.ceil(embedText(note.title, p.path, p.text).length / 4),
    hash: contentHash(embedText(note.title, p.path, p.text)),
  }));
}
