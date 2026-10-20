/*
 * Small line diff (LCS on the part between the common prefix and suffix),
 * enough to show an agent what changed in a note.
 */

type Op = { kind: ' ' | '-' | '+'; line: string };

const MAX_CELLS = 4_000_000;

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    return [
      ...a.map((line) => ({ kind: '-' as const, line })),
      ...b.map((line) => ({ kind: '+' as const, line })),
    ];
  }
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!;
    const below = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? below[j + 1]! + 1 : Math.max(below[j]!, row[j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: '-', line: a[i++]! });
    } else {
      ops.push({ kind: '+', line: b[j++]! });
    }
  }
  while (i < n) ops.push({ kind: '-', line: a[i++]! });
  while (j < m) ops.push({ kind: '+', line: b[j++]! });
  return ops;
}

/** Unified-style diff with `context` lines around each change; "" when equal. */
export function lineDiff(before: string, after: string, context = 2, maxLines = 200): string {
  if (before === after) return '';
  const bothEndWithNewline = before.endsWith('\n') && after.endsWith('\n');
  const a = (bothEndWithNewline ? before.slice(0, -1) : before).split('\n');
  const b = (bothEndWithNewline ? after.slice(0, -1) : after).split('\n');
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  const ops: Op[] = [
    ...a.slice(0, prefix).map((line) => ({ kind: ' ' as const, line })),
    ...lcsOps(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix)),
    ...a.slice(a.length - suffix).map((line) => ({ kind: ' ' as const, line })),
  ];

  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.kind === ' ') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++)
      keep[k] = true;
  });
  const out: string[] = [];
  let skipped = false;
  ops.forEach((op, idx) => {
    if (!keep[idx]) {
      skipped = true;
      return;
    }
    if (skipped || (idx > 0 && out.length === 0)) out.push('@@');
    skipped = false;
    out.push(`${op.kind}${op.line}`);
  });
  if (out.length > maxLines) {
    return [...out.slice(0, maxLines), `… (${out.length - maxLines} more lines)`].join('\n');
  }
  return out.join('\n');
}
