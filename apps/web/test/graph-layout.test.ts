import { describe, expect, it } from 'vitest';
import {
  ALPHA_MIN,
  createGraphLayout,
  layoutBounds,
  placeLabels,
  REFRESH_ALPHA,
  sameGraph,
  startPositions,
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

describe('refreshing a laid-out graph (W-11)', () => {
  const paths = (n: number) => Array.from({ length: n }, (_, i) => `N${i}.md`);

  it('starts from the places of the notes already there and does not scatter them', () => {
    const n = 120;
    const links = vault(n);
    const first = createGraphLayout(n, links);
    first.settle();
    const before = new Map(paths(n).map((p, i) => [p, { x: first.x[i]!, y: first.y[i]! }]));
    // The same vault plus one new note linked to note 3.
    const more = [...links, [n, 3] as [number, number]];
    const start = startPositions([...paths(n), 'New.md'], more, before);
    expect(start[5]).toEqual(before.get('N5.md'));
    const fresh = createGraphLayout(n + 1, more);
    const warm = createGraphLayout(n + 1, more, { positions: start, alpha: REFRESH_ALPHA });
    fresh.settle();
    warm.settle();
    const drift = (l: ReturnType<typeof createGraphLayout>) => {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += Math.hypot(l.x[i]! - first.x[i]!, l.y[i]! - first.y[i]!);
      return sum / n;
    };
    // The refresh keeps the picture the user knows; a layout from the seed does not.
    expect(drift(warm)).toBeLessThan(drift(fresh) / 2);
    expect(Number.isFinite(warm.x[n])).toBe(true);
  });

  it('puts a new note next to the notes it links to, any other on the seed', () => {
    const before = new Map([
      ['A.md', { x: 100, y: 100 }],
      ['B.md', { x: 200, y: 100 }],
    ]);
    const start = startPositions(
      ['A.md', 'B.md', 'C.md', 'D.md'],
      [
        [0, 2],
        [1, 2],
      ],
      before,
    );
    expect(Math.abs(start[2]!.x - 150)).toBeLessThan(10);
    expect(Math.abs(start[2]!.y - 100)).toBeLessThan(10);
    expect(start[3]).toBeNull();
  });

  it('settles sooner than a first layout', () => {
    const n = 200;
    const links = vault(n);
    const first = createGraphLayout(n, links);
    first.settle();
    const warm = createGraphLayout(n, links, {
      positions: paths(n).map((_, i) => ({ x: first.x[i]!, y: first.y[i]! })),
      alpha: REFRESH_ALPHA,
    });
    let ticks = 0;
    while (warm.tick()) ticks++;
    expect(ticks).toBeLessThan(300 * 0.85);
  });

  it('sameGraph: a note edited in place is the same graph, a new link or title is not', () => {
    const notes = [
      { path: 'A.md', title: 'A', author: 'x', updated: 1 },
      { path: 'B.md', title: 'B', author: null, updated: 1 },
    ];
    const edges = [{ from: 'A.md', to: 'B.md' }];
    expect(
      sameGraph(
        { notes, edges },
        { notes: notes.map((n) => ({ ...n, updated: 2 })), edges: [...edges] },
      ),
    ).toBe(true);
    expect(sameGraph({ notes, edges }, { notes, edges: [] })).toBe(false);
    expect(
      sameGraph({ notes, edges }, { notes: [notes[0]!, { ...notes[1]!, title: 'C' }], edges }),
    ).toBe(false);
    expect(
      sameGraph({ notes, edges }, { notes: [notes[0]!, { ...notes[1]!, author: 'y' }], edges }),
    ).toBe(false);
    expect(sameGraph({ notes, edges }, { notes: notes.slice(0, 1), edges })).toBe(false);
  });
});
