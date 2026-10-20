/*
 * A line diff of two texts for people (D-113): the proposals of CLAUDE.md and
 * AGENTS.md in the app and on Telegram. Lines prefixed `-`, `+` or ` `, in
 * hunks with a few lines of context around each change; a long run of equal
 * lines is left out, the next hunk starts with `@@ riga N @@` (N: its first
 * line in the new text). The same format as the notes' history.
 *
 * Nothing that changes is hidden: a character that does not show (format,
 * control, Unicode tag, D-113) becomes `⟨U+XXXX⟩`, a carriage return `␍`, and
 * a last line without its newline carries `⟨senza a capo finale⟩`.
 */

/** The mark of a last line without its newline. */
export const NO_FINAL_NEWLINE = '⟨senza a capo finale⟩';

/** Characters that do not show: format, controls but the tab, tags and smuggled selectors. */
// eslint-disable-next-line no-misleading-character-class
const UNSEEN = /[\p{Cf}\p{Cc}\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

/** The text with every character that does not show written as `⟨U+XXXX⟩` (`\r` as `␍`). */
export function showInvisible(text: string): string {
  return text.replace(UNSEEN, (c) => {
    if (c === '\t' || c === '\n') return c;
    if (c === '\r') return '␍';
    return `⟨U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟩`;
  });
}

/** Lines of the middle part compared one by one at most (beyond: removed, then added). */
const MAX_CELLS = 4_000_000;

type Op = { op: ' ' | '-' | '+'; text: string };

/** The operations from `a` to `b`: common start and end, an LCS in between. */
function ops(a: readonly string[], b: readonly string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head = a.slice(0, start).map((text): Op => ({ op: ' ', text }));
  const tail = a.slice(endA).map((text): Op => ({ op: ' ', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  const mid: Op[] = [];
  if (n * m > MAX_CELLS) {
    mid.push(...midA.map((text): Op => ({ op: '-', text })));
    mid.push(...midB.map((text): Op => ({ op: '+', text })));
  } else {
    // lcs[i][j]: the longest common subsequence of midA[i..] and midB[j..].
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] =
          midA[i] === midB[j]
            ? lcs[(i + 1) * w + j + 1]! + 1
            : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        mid.push({ op: ' ', text: midA[i]! });
        i++;
        j++;
      } else if (i < n && (j === m || lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!)) {
        // On a tie the removed line first, as people read a change.
        mid.push({ op: '-', text: midA[i]! });
        i++;
      } else {
        mid.push({ op: '+', text: midB[j]! });
        j++;
      }
    }
  }
  return [...head, ...mid, ...tail];
}

/**
 * The diff from `before` to `after` (null: the file is new), empty when
 * nothing changed. `context`: equal lines kept around each change.
 */
export function textDiff(
  before: string | null,
  after: string,
  options: { context?: number } = {},
): string {
  const context = options.context ?? 3;
  if (before === after) return '';
  // The newline at the end is no line of its own; a last line without one says so.
  const lines = (text: string | null) => {
    if (!text) return [];
    const out = text.split('\n').map(showInvisible);
    if (out.at(-1) === '') out.pop();
    else out[out.length - 1] += NO_FINAL_NEWLINE;
    return out;
  };
  const all = ops(lines(before), lines(after));
  // Line numbers in the new text, for the hunk headers.
  const newLine: number[] = [];
  let at = 0;
  for (const o of all) {
    newLine.push(at + 1);
    if (o.op !== '-') at++;
  }
  const keep = new Array<boolean>(all.length).fill(false);
  all.forEach((o, i) => {
    if (o.op === ' ') return;
    for (let k = Math.max(0, i - context); k <= Math.min(all.length - 1, i + context); k++) {
      keep[k] = true;
    }
  });
  const out: string[] = [];
  let open = false;
  all.forEach((o, i) => {
    if (!keep[i]) {
      open = false;
      return;
    }
    if (!open) out.push(`@@ riga ${newLine[i]} @@`);
    open = true;
    out.push(`${o.op}${o.text}`);
  });
  return out.join('\n');
}
