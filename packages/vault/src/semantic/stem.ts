import { stemmer } from '@orama/stemmers/italian';

/*
 * Italian stemming for full-text search (research/04 §2): FTS5 has no Italian
 * stemmer, so the index keeps a second copy of the text made of Snowball
 * stems, and the query is stemmed the same way: "ricette" finds "ricetta".
 */

const WORD = /[\p{L}\p{N}]+/gu;

/** Snowball Italian stem of one word (lowercased first, as the algorithm expects). */
export function stemWord(word: string): string {
  const lower = word.toLowerCase();
  // Numbers, very short words and words with digits stay as they are.
  if (lower.length < 4 || /\d/.test(lower)) return lower;
  try {
    return stemmer(lower);
  } catch {
    return lower;
  }
}

/** The words of a text as stems, space separated (what the `*_stem` FTS columns hold). */
export function stemText(text: string): string {
  const out: string[] = [];
  for (const m of text.matchAll(WORD)) out.push(stemWord(m[0]));
  return out.join(' ');
}
