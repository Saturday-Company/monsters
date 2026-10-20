/**
 * A small line diff for the UI (`-`/`+`/` ` prefixes, one `@@` hunk): the lines
 * between the common start and the common end. Empty when nothing changed.
 */
export function lineDiff(before: string, after: string): string {
  if (before === after) return '';
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const from = Math.max(0, start - 2);
  return [
    `@@ riga ${from + 1} @@`,
    ...a.slice(from, start).map((l) => ` ${l}`),
    ...a.slice(start, endA).map((l) => `-${l}`),
    ...b.slice(start, endB).map((l) => `+${l}`),
    ...a.slice(endA, endA + 2).map((l) => ` ${l}`),
  ].join('\n');
}
