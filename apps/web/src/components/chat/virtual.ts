/*
 * The arithmetic of a virtual list (VirtualList.tsx): which rows to render for a scroll position,
 * from heights that are measured once a row has been on screen and guessed before. Pure, tested
 * without a browser.
 */

/** Up to this many rows the whole transcript renders, as before (find-in-page sees everything). */
export const VIRTUAL_FROM = 80;

/** First guesses of a row's height, by kind, until rows of that kind have been measured. */
export const FIRST_GUESS: Readonly<Record<string, number>> = {
  day: 36,
  gap: 36,
  turn: 260,
  item: 110,
};

/** The rendered rows, inclusive, by index. */
export interface Span {
  start: number;
  end: number;
}

/** Where each row starts (`n + 1` entries, the last is the total height). */
export function offsets(heights: readonly number[]): number[] {
  const out = new Array<number>(heights.length + 1);
  out[0] = 0;
  for (let i = 0; i < heights.length; i++) out[i + 1] = out[i]! + heights[i]!;
  return out;
}

/** The first index whose row ends below `y` (the row at `y`), by bisection over `offsets`. */
export function rowAt(off: readonly number[], y: number): number {
  const n = off.length - 1;
  if (n <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (off[mid + 1]! <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The rows that cover `[top - over, bottom + over]` of the list's own coordinates. */
export function spanFor(off: readonly number[], top: number, bottom: number, over: number): Span {
  const n = off.length - 1;
  if (n <= 0) return { start: 0, end: -1 };
  const start = rowAt(off, Math.max(0, top - over));
  const end = Math.max(start, rowAt(off, Math.max(0, bottom + over - 0.5)));
  return { start, end: Math.min(n - 1, end) };
}

/**
 * Whether the rendered span still serves the screen: it covers the visible part with a margin
 * (a quarter of a screen each way) and is not far larger than needed (it shrinks after a jump).
 * Otherwise a new span is worth a render; within the margin a scroll changes nothing.
 */
export function spanServes(
  off: readonly number[],
  span: Span,
  top: number,
  bottom: number,
  view: number,
): boolean {
  const n = off.length - 1;
  if (n <= 0 || span.end < span.start) return n <= 0;
  const from = off[span.start]!;
  const to = off[span.end + 1]!;
  const total = off[n]!;
  const margin = view / 4;
  const coversTop = from <= Math.max(0, top - margin);
  const coversBottom = to >= Math.min(total, bottom + margin);
  return coversTop && coversBottom && to - from <= view * 6;
}

/** The span from the end of the list up, about `height` tall: a chat opens at its latest words. */
export function spanFromEnd(heights: readonly number[], height: number): Span {
  const end = heights.length - 1;
  let start = end;
  let acc = end >= 0 ? heights[end]! : 0;
  while (start > 0 && acc < height) {
    start--;
    acc += heights[start]!;
  }
  return { start: Math.max(0, start), end };
}

/** A span widened to hold row `i`, if it is near (a focused row is not taken away). */
export function withRow(span: Span, i: number, near = 60): Span {
  if (i < 0) return span;
  if (i < span.start && span.start - i <= near) return { start: i, end: span.end };
  if (i > span.end && i - span.end <= near) return { start: span.start, end: i };
  return span;
}
