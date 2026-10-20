/*
 * `@Nome` at the start of a message (D-097, D-103): names may have spaces and
 * a middle dot ("Rhea · Saturday", "Sito di Saturday"), so the longest name
 * that the text starts with wins, as the web's composer does (D-100): "@Rhea ·
 * Saturday fai X" is the copy in the project, not Rhea.
 */

const WORD_CHAR = /[\p{L}\p{N}_-]/u;
const LEADING_WORD = /^@([\p{L}\p{N}_-]+)/u;

/**
 * The candidate named right after a leading `@` (the longest name that fits,
 * then a single word for an id), and the text after it without the
 * separators; null when the text does not start with `@`.
 */
export function leadingMention(
  text: string,
  candidates: readonly string[],
): { key: string; rest: string } | null {
  if (!text.startsWith('@')) return null;
  const lower = text.toLowerCase();
  const byLength = [...new Set(candidates)]
    .filter((c) => c.trim().length > 0)
    .sort((a, b) => b.length - a.length);
  const strip = (from: number) =>
    text
      .slice(from)
      .replace(/^[\s,:]+/u, '')
      .trim();
  for (const name of byLength) {
    const n = name.toLowerCase();
    if (lower.startsWith(n, 1) && !WORD_CHAR.test(lower.charAt(1 + n.length))) {
      return { key: name, rest: strip(1 + n.length) };
    }
  }
  const word = LEADING_WORD.exec(text);
  return word ? { key: word[1]!, rest: strip(word[0].length) } : null;
}
