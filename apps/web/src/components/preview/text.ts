/*
 * Text of the preview pane, pure and tested without a browser: a light
 * colouring of code (strings, numbers, comments, a few keywords: enough to
 * read, not an editor), JSON made readable, CSV split into rows.
 */

export type TokenKind = 'str' | 'num' | 'com' | 'key' | null;
export interface Token {
  text: string;
  kind: TokenKind;
}

const KEYWORDS = new Set(
  (
    'function return const let var if else for while do switch case break continue new class ' +
    'extends import export from default async await try catch finally throw typeof instanceof ' +
    'in of def lambda elif pass raise with as yield None True False null true false undefined ' +
    'fn pub struct impl enum match use mod package func go select interface type public private ' +
    'static void int string bool SELECT FROM WHERE INSERT UPDATE DELETE JOIN AND OR NOT'
  ).split(' '),
);

/** Comment openers by the file's extension (hash for scripts and configs, slashes elsewhere). */
export function commentMarks(name: string): string[] {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (['py', 'rb', 'sh', 'bash', 'zsh', 'yml', 'yaml', 'toml', 'r', 'ini', 'conf'].includes(ext))
    return ['#'];
  if (['sql', 'lua'].includes(ext)) return ['--'];
  if (['html', 'htm', 'xml', 'svg', 'md', 'txt', 'csv', 'json'].includes(ext)) return [];
  return ['//'];
}

const TOKEN =
  /("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b|\b0x[0-9a-f]+\b)|([A-Za-z_$][\w$]*)/gi;

/** One line split into coloured pieces (a comment runs to the end of the line). */
export function tokenizeLine(line: string, comments: readonly string[]): Token[] {
  const out: Token[] = [];
  let rest = line;
  let tail: Token | null = null;
  // The first comment marker outside a string ends the code part.
  for (const mark of comments) {
    const at = commentStart(rest, mark);
    if (at >= 0) {
      tail = { text: rest.slice(at), kind: 'com' };
      rest = rest.slice(0, at);
      break;
    }
  }
  let last = 0;
  for (const m of rest.matchAll(TOKEN)) {
    const at = m.index;
    if (at > last) out.push({ text: rest.slice(last, at), kind: null });
    const kind: TokenKind = m[1] ? 'str' : m[2] ? 'num' : KEYWORDS.has(m[3] ?? '') ? 'key' : null;
    out.push({ text: m[0], kind });
    last = at + m[0].length;
  }
  if (last < rest.length) out.push({ text: rest.slice(last), kind: null });
  if (tail) out.push(tail);
  // Neighbours without a colour become one piece (fewer nodes).
  const merged: Token[] = [];
  for (const t of out) {
    const prev = merged.at(-1);
    if (prev && prev.kind === null && t.kind === null) prev.text += t.text;
    else merged.push({ ...t });
  }
  return merged;
}

function commentStart(line: string, mark: string): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (line.startsWith(mark, i)) {
      // `#` inside a word (a URL fragment, a colour) is not a comment.
      if (mark === '#' && i > 0 && /\S/.test(line[i - 1]!)) continue;
      return i;
    }
  }
  return -1;
}

/** JSON indented by two spaces, or the text as it was when it does not parse. */
export function prettyJsonText(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** The separator of a CSV: tabs, semicolons (Italian spreadsheets) or commas, by the first line. */
export function csvSeparator(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string) => first.split(c).length - 1;
  const tab = count('\t');
  const semi = count(';');
  const comma = count(',');
  if (tab > 0 && tab >= semi && tab >= comma) return '\t';
  return semi > comma ? ';' : ',';
}

/** Rows of a CSV (quotes and doubled quotes understood), at most `maxRows`. */
export function parseCsv(text: string, maxRows = 500): { rows: string[][]; more: boolean } {
  const sep = csvSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length > maxRows) return { rows: rows.slice(0, maxRows), more: true };
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return { rows: rows.slice(0, maxRows), more: rows.length > maxRows };
}

/** Bytes of text read at most (a bigger file shows its beginning, and says so). */
export const TEXT_MAX_BYTES = 512 * 1024;
/** Lines shown at most. */
export const TEXT_MAX_LINES = 4000;
