/*
 * Word boundaries for Italian text. In JavaScript `\b` is ASCII even with the
 * `u` flag: "ì" is not a word character, so `\blunedì\b` never matches
 * "lunedì o martedì?" (review AG-02). The rules are written with `\b` and
 * `\w` and compiled here with Unicode ones instead: letters, digits and `_` of
 * every script are word characters (so "pagherò" ends where the word ends).
 */

const WORD = '[\\p{L}\\p{N}_]';
/** Start or end of a word, Unicode-aware. */
export const UNICODE_BOUNDARY = `(?:(?<!${WORD})(?=${WORD})|(?<=${WORD})(?!${WORD}))`;

/**
 * `\b` and `\w` become Unicode-aware (`\W` too, outside character classes);
 * every other escape stays as it is.
 */
export function withUnicodeBoundaries(source: string): string {
  let out = '';
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === '\\') {
      const next = source[i + 1] ?? '';
      if (next === 'w') out += inClass ? '\\p{L}\\p{N}_' : WORD;
      else if (next === 'W' && !inClass) out += '[^\\p{L}\\p{N}_]';
      else if (next === 'b' && !inClass) out += UNICODE_BOUNDARY;
      else out += c + next;
      i++;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    out += c;
  }
  return out;
}

const compiled = new Map<string, RegExp>();

/**
 * A rule pattern compiled once (case-insensitive, Unicode, Unicode `\b`). The
 * cache is keyed by pattern: user rules from the settings share it.
 */
export function wordRegex(pattern: string): RegExp {
  let re = compiled.get(pattern);
  if (!re) {
    re = new RegExp(withUnicodeBoundaries(pattern), 'iu');
    compiled.set(pattern, re);
  }
  return re;
}

/** The same regular expression with Unicode `\b` (flags kept, `u` added). */
export function unicodeWords(re: RegExp): RegExp {
  const flags = re.flags.includes('u') || re.flags.includes('v') ? re.flags : `${re.flags}u`;
  return new RegExp(withUnicodeBoundaries(re.source), flags);
}
