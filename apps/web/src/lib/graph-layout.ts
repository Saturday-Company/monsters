import type { VaultEdge, VaultNoteSummary } from '@monsters/shared';

/*
 * Small force layout for the link graph of the vault (no dependency): many-body
 * repulsion with a Barnes-Hut quadtree (O(n log n) per tick), springs on the
 * links and a weak pull to the centre, with the same constants as d3-force.
 * About 300 ticks settle it; 2,000 notes take well under a second in total, so
 * the view runs a few ticks per frame and draws while it settles.
 */

export interface GraphLayout {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly degree: Uint32Array;
  /** Current temperature: the layout is settled under `ALPHA_MIN`. */
  readonly alpha: number;
  /** Runs `n` ticks (default 1); returns true while it is still moving. */
  tick(n?: number): boolean;
  /** Runs until settled (tests, reduced motion). */
  settle(): void;
  /** Moves one node (dragging); it stays where it is put. */
  pin(i: number, x: number, y: number): void;
  unpin(i: number): void;
  /** Warms the layout up again (after a drag). */
  reheat(alpha?: number): void;
}

export const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);
const VELOCITY_DECAY = 0.4;
const CHARGE = -36;
const LINK_DISTANCE = 42;
const CENTER = 0.035;
const THETA2 = 0.81;
const DIST_MAX2 = 900 * 900;

interface Quad {
  cx: number;
  cy: number;
  mass: number;
  size: number;
  /** Leaf bodies (or null for an internal node). */
  bodies: number[] | null;
  kids: Quad[];
}

function build(
  idx: number[],
  x: Float64Array,
  y: Float64Array,
  x0: number,
  y0: number,
  size: number,
  depth: number,
): Quad {
  if (idx.length <= 1 || depth > 24 || size < 1e-6) {
    let cx = 0;
    let cy = 0;
    for (const i of idx) {
      cx += x[i]!;
      cy += y[i]!;
    }
    const m = idx.length;
    return { cx: m ? cx / m : 0, cy: m ? cy / m : 0, mass: m, size, bodies: idx, kids: [] };
  }
  const half = size / 2;
  const mx = x0 + half;
  const my = y0 + half;
  const parts: number[][] = [[], [], [], []];
  for (const i of idx) parts[(x[i]! >= mx ? 1 : 0) + (y[i]! >= my ? 2 : 0)]!.push(i);
  const kids: Quad[] = [];
  let cx = 0;
  let cy = 0;
  let mass = 0;
  parts.forEach((p, q) => {
    if (p.length === 0) return;
    const k = build(p, x, y, q & 1 ? mx : x0, q & 2 ? my : y0, half, depth + 1);
    kids.push(k);
    cx += k.cx * k.mass;
    cy += k.cy * k.mass;
    mass += k.mass;
  });
  return { cx: cx / mass, cy: cy / mass, mass, size, bodies: null, kids };
}

/** Deterministic start: a sunflower spiral, so the same vault always looks the same. */
function seed(n: number, x: Float64Array, y: Float64Array): void {
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = 10 * Math.sqrt(0.5 + i);
    x[i] = r * Math.cos(i * golden);
    y[i] = r * Math.sin(i * golden);
  }
}

export interface LayoutStart {
  /** Where each note was before (null = new): a refresh keeps the places the user knows. */
  positions?: readonly ({ x: number; y: number } | null)[];
  /** Starting temperature: low for a refresh of a laid out graph, 1 (default) for a first layout. */
  alpha?: number;
}

/** The temperature a refresh of a laid-out graph starts from: the notes shift, they do not explode. */
export const REFRESH_ALPHA = 0.25;

/**
 * Starting points for a refresh: the places of the notes that were already there (by path); a new
 * note starts next to the notes it links to, or, with none placed, on the seed spiral.
 */
export function startPositions(
  paths: readonly string[],
  links: readonly [number, number][],
  before: ReadonlyMap<string, { x: number; y: number }>,
): ({ x: number; y: number } | null)[] {
  const out = paths.map((p) => before.get(p) ?? null);
  const near = new Map<number, { x: number; y: number }[]>();
  for (const [a, b] of links) {
    if (out[a] && !out[b]) near.set(b, [...(near.get(b) ?? []), out[a]]);
    if (out[b] && !out[a]) near.set(a, [...(near.get(a) ?? []), out[b]]);
  }
  for (const [i, ps] of near) {
    const x = ps.reduce((sum, p) => sum + p.x, 0) / ps.length;
    const y = ps.reduce((sum, p) => sum + p.y, 0) / ps.length;
    // A small deterministic offset, so two new notes on the same neighbour do not overlap.
    out[i] = { x: x + ((i * 7) % 11) - 5, y: y + ((i * 13) % 11) - 5 };
  }
  return out;
}

export function createGraphLayout(
  n: number,
  links: readonly [number, number][],
  start: LayoutStart = {},
): GraphLayout {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const fixed = new Uint8Array(n);
  const degree = new Uint32Array(n);
  const valid = links.filter(([a, b]) => a !== b && a >= 0 && b >= 0 && a < n && b < n);
  for (const [a, b] of valid) {
    degree[a]!++;
    degree[b]!++;
  }
  const strength = valid.map(([a, b]) => 1 / Math.max(1, Math.min(degree[a]!, degree[b]!)));
  const bias = valid.map(([a, b]) => degree[a]! / Math.max(1, degree[a]! + degree[b]!));
  seed(n, x, y);
  if (start.positions) {
    for (let i = 0; i < n; i++) {
      const p = start.positions[i];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        x[i] = p.x;
        y[i] = p.y;
      }
    }
  }
  let alpha = n > 0 ? (start.alpha ?? 1) : 0;
  const all = Array.from({ length: n }, (_, i) => i);

  const repel = (root: Quad, i: number) => {
    const xi = x[i]!;
    const yi = y[i]!;
    const stack: Quad[] = [root];
    while (stack.length > 0) {
      const q = stack.pop()!;
      if (q.mass === 0) continue;
      const dx = q.cx - xi;
      const dy = q.cy - yi;
      let l = dx * dx + dy * dy;
      if (q.bodies === null && (q.size * q.size) / Math.max(l, 1e-9) >= THETA2) {
        for (const k of q.kids) stack.push(k);
        continue;
      }
      if (q.bodies !== null) {
        // Leaf: exact forces, skipping the node itself.
        for (const j of q.bodies) {
          if (j === i) continue;
          let ddx = x[j]! - xi;
          let ddy = y[j]! - yi;
          let d = ddx * ddx + ddy * ddy;
          if (d === 0) {
            // Same spot: a tiny deterministic nudge.
            ddx = ((i * 7 + j * 13) % 11) / 11 - 0.5 || 0.1;
            ddy = ((i * 11 + j * 5) % 13) / 13 - 0.5 || 0.1;
            d = ddx * ddx + ddy * ddy;
          }
          if (d > DIST_MAX2) continue;
          if (d < 1) d = Math.sqrt(d);
          const w = (CHARGE * alpha) / d;
          vx[i] = vx[i]! + ddx * w;
          vy[i] = vy[i]! + ddy * w;
        }
        continue;
      }
      if (l > DIST_MAX2) continue;
      if (l < 1) l = Math.sqrt(l);
      const w = (CHARGE * q.mass * alpha) / l;
      vx[i] = vx[i]! + dx * w;
      vy[i] = vy[i]! + dy * w;
    }
  };

  const step = () => {
    if (n === 0) return;
    alpha += (0 - alpha) * ALPHA_DECAY;
    // Links.
    valid.forEach(([s, t], k) => {
      let dx = x[t]! + vx[t]! - x[s]! - vx[s]!;
      let dy = y[t]! + vy[t]! - y[s]! - vy[s]!;
      let l = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      l = ((l - LINK_DISTANCE) / l) * alpha * strength[k]!;
      dx *= l;
      dy *= l;
      const b = bias[k]!;
      vx[t] = vx[t]! - dx * b;
      vy[t] = vy[t]! - dy * b;
      vx[s] = vx[s]! + dx * (1 - b);
      vy[s] = vy[s]! + dy * (1 - b);
    });
    // Many-body.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, x[i]!);
      minY = Math.min(minY, y[i]!);
      maxX = Math.max(maxX, x[i]!);
      maxY = Math.max(maxY, y[i]!);
    }
    const size = Math.max(maxX - minX, maxY - minY, 1);
    const root = build(all, x, y, minX, minY, size, 0);
    for (let i = 0; i < n; i++) repel(root, i);
    // Centre, then move.
    for (let i = 0; i < n; i++) {
      if (fixed[i]) {
        vx[i] = 0;
        vy[i] = 0;
        continue;
      }
      vx[i] = (vx[i]! - x[i]! * CENTER * alpha) * (1 - VELOCITY_DECAY);
      vy[i] = (vy[i]! - y[i]! * CENTER * alpha) * (1 - VELOCITY_DECAY);
      x[i] = x[i]! + vx[i]!;
      y[i] = y[i]! + vy[i]!;
    }
  };

  return {
    x,
    y,
    degree,
    get alpha() {
      return alpha;
    },
    tick(count = 1) {
      for (let k = 0; k < count && alpha >= ALPHA_MIN; k++) step();
      return alpha >= ALPHA_MIN;
    },
    settle() {
      while (alpha >= ALPHA_MIN) step();
    },
    pin(i, px, py) {
      if (i < 0 || i >= n) return;
      fixed[i] = 1;
      x[i] = px;
      y[i] = py;
    },
    unpin(i) {
      if (i >= 0 && i < n) fixed[i] = 0;
    },
    reheat(a = 0.3) {
      alpha = Math.max(alpha, a);
    },
  };
}

/** Bounding box of the layout, for fitting it in the view. */
export function layoutBounds(layout: GraphLayout): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < layout.x.length; i++) {
    minX = Math.min(minX, layout.x[i]!);
    minY = Math.min(minY, layout.y[i]!);
    maxX = Math.max(maxX, layout.x[i]!);
    maxY = Math.max(maxY, layout.y[i]!);
  }
  if (!Number.isFinite(minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

/** A box on screen (x, y of the top-left corner), for the labels of the graph. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Which labels to draw so that none touches another (docs/design.md, "Note"):
 * in the order given (the most important first), a label whose box hits one
 * already placed, or a dot other than its own, is left out; it shows on hover
 * or zoomed in.
 */
export function placeLabels(
  candidates: readonly { id: number; box: Box }[],
  dots: readonly { id: number; box: Box }[] = [],
): Set<number> {
  const placed: Box[] = [];
  const out = new Set<number>();
  for (const c of candidates) {
    const b = c.box;
    if (placed.some((p) => overlaps(p, b))) continue;
    if (dots.some((d) => d.id !== c.id && overlaps(d.box, b))) continue;
    placed.push(b);
    out.add(c.id);
  }
  return out;
}

/** What the graph draws of the vault: who is there, how they are called, who wrote them, the links. */
export interface GraphInput {
  notes: readonly Pick<VaultNoteSummary, 'path' | 'title' | 'author'>[];
  edges: readonly VaultEdge[];
}

/**
 * True when two reads of the vault look the same on the graph: a refresh after an agent edited the
 * body of a note (new `updated`, same links) must not lay the graph out again.
 */
export function sameGraph(a: GraphInput, b: GraphInput): boolean {
  if (a === b) return true;
  if (a.notes.length !== b.notes.length || a.edges.length !== b.edges.length) return false;
  for (let i = 0; i < a.notes.length; i++) {
    const p = a.notes[i]!;
    const q = b.notes[i]!;
    if (p.path !== q.path || p.title !== q.title || p.author !== q.author) return false;
  }
  for (let i = 0; i < a.edges.length; i++) {
    if (a.edges[i]!.from !== b.edges[i]!.from || a.edges[i]!.to !== b.edges[i]!.to) return false;
  }
  return true;
}
