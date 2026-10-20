import { describe, expect, it } from 'vitest';
import {
  ALPHA_MIN,
  createGraphLayout,
  layoutBounds,
  placeLabels,
} from '../src/lib/graph-layout.ts';

/** Deterministic pseudo-random links: mostly between near notes, like a real vault. */
function vault(n: number, perNote = 1.5): [number, number][] {
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const links: [number, number][] = [];
  for (let i = 1; i < n; i++) {
    const k = Math.floor(rnd() * perNote * 2);
    for (let j = 0; j < k; j++) {
      const t = rnd() < 0.75 ? Math.max(0, i - 1 - Math.floor(rnd() * 12)) : Math.floor(rnd() * n);
      links.push([i, t]);
    }
  }
  return links;
}

const dist = (l: ReturnType<typeof createGraphLayout>, a: number, b: number) =>
  Math.hypot(l.x[a]! - l.x[b]!, l.y[a]! - l.y[b]!);

describe('graph layout', () => {
  it('settles with finite positions, linked notes closer than unlinked ones', () => {
    const links: [number, number][] = [
      [0, 1],
      [1, 2],
      [2, 0],
      [3, 4],
    ];
    const l = createGraphLayout(6, links);
    l.settle();
    expect(l.alpha).toBeLessThan(ALPHA_MIN);
    for (let i = 0; i < 6; i++) {
      expect(Number.isFinite(l.x[i])).toBe(true);
      expect(Number.isFinite(l.y[i])).toBe(true);
    }
    expect([...l.degree]).toEqual([2, 2, 2, 1, 1, 0]);
    expect(dist(l, 0, 1)).toBeLessThan(dist(l, 0, 5));
    expect(dist(l, 3, 4)).toBeLessThan(dist(l, 3, 0));
  });

  it('ignores self links and out-of-range ends, and handles an empty vault', () => {
    const l = createGraphLayout(2, [
      [0, 0],
      [0, 7],
      [-1, 1],
    ]);
    expect([...l.degree]).toEqual([0, 0]);
    l.settle();
    expect(dist(l, 0, 1)).toBeGreaterThan(1);
    const empty = createGraphLayout(0, []);
    expect(empty.tick()).toBe(false);
    expect(layoutBounds(empty)).toEqual({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
  });

  it('is deterministic (the same vault always looks the same)', () => {
    const a = createGraphLayout(50, vault(50));
    const b = createGraphLayout(50, vault(50));
    a.settle();
    b.settle();
    expect([...a.x]).toEqual([...b.x]);
  });

  it('keeps a pinned note where it is put', () => {
    const l = createGraphLayout(3, [
      [0, 1],
      [1, 2],
    ]);
    l.pin(1, 500, -200);
    l.reheat(1);
    l.settle();
    expect(l.x[1]).toBe(500);
    expect(l.y[1]).toBe(-200);
  });

  it('lays out 2,000 notes fast enough for the browser', () => {
    const n = 2000;
    const links = vault(n);
    const started = performance.now();
    const l = createGraphLayout(n, links);
    l.settle();
    const ms = performance.now() - started;
    const b = layoutBounds(l);
    expect(Number.isFinite(b.maxX - b.minX)).toBe(true);
    // ~300 ticks; measured ~1 s here: the view spreads them over frames.
    expect(ms).toBeLessThan(8000);
  });
});

describe('labels of the graph (audit UI-26)', () => {
  const box = (x: number, y: number, w = 100, h = 15) => ({ x, y, w, h });

  it('never draws a label on another: the first in the order wins', () => {
    const shown = placeLabels([
      { id: 1, box: box(0, 0) },
      { id: 2, box: box(60, 5) },
      { id: 3, box: box(0, 40) },
    ]);
    expect([...shown]).toEqual([1, 3]);
  });

  it('keeps a label off the dots of other notes, not off its own', () => {
    const dots = [
      { id: 1, box: box(40, -12, 10, 10) },
      { id: 2, box: box(50, 4, 10, 10) },
    ];
    expect([...placeLabels([{ id: 1, box: box(0, 0) }], dots)]).toEqual([]);
    expect([...placeLabels([{ id: 2, box: box(0, 0) }], dots)]).toEqual([2]);
  });
});
