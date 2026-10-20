import type { MonsterGenome } from './genome.ts';
import { type Pt, closedSmoothPath, norm, sub } from './geometry.ts';
import { createRng } from './random.ts';

/** Body silhouettes: superellipse with separate top/bottom roundness, taper, lean and optional lumps. */
interface ShapeSpec {
  /** Base half-width and half-height in viewBox units (before genome w/h). */
  a: number;
  b: number;
  /** Superellipse exponent of the upper half (2 = ellipse, higher = boxier). */
  nTop: number;
  nBot: number;
  /** >0 makes the bottom wider than the top. */
  taper: number;
  /** Amplitude of seeded lumps (0 = smooth). */
  lumps: number;
}

export const SHAPES: Record<MonsterGenome['body']['shape'], ShapeSpec> = {
  blob: { a: 56, b: 49, nTop: 2.15, nBot: 2.7, taper: 0.1, lumps: 0 },
  egg: { a: 49, b: 56, nTop: 2.0, nBot: 2.4, taper: 0.17, lumps: 0 },
  pear: { a: 51, b: 55, nTop: 2.0, nBot: 2.7, taper: 0.3, lumps: 0 },
  bean: { a: 46, b: 59, nTop: 2.5, nBot: 3.0, taper: 0.05, lumps: 0 },
  dome: { a: 53, b: 53, nTop: 2.05, nBot: 4.2, taper: 0.07, lumps: 0 },
  lumpy: { a: 52, b: 54, nTop: 2.1, nBot: 2.7, taper: 0.14, lumps: 1 },
};

export const GROUND_Y = 186;
export const CENTER_X = 100;
const SAMPLES = 96;

const sgnPow = (v: number, p: number): number => Math.sign(v) * Math.abs(v) ** p;

export interface BodyGeometry {
  /** Dense outline polygon (clockwise from the right-hand side). */
  outline: Pt[];
  path: string;
  /** Half-width and half-height actually used (after w/h multipliers). */
  a: number;
  b: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Point and outward normal on the outline; `deg` is measured clockwise from straight up. */
  anchor(deg: number): { p: Pt; n: Pt };
  /** Horizontal extent of the body at height y. */
  span(y: number): { x0: number; x1: number };
}

export function buildBody(g: MonsterGenome, lift: number): BodyGeometry {
  const spec = SHAPES[g.body.shape];
  const a = spec.a * g.body.w;
  const b = spec.b * g.body.h;
  const lean = g.body.lean;
  const rng = createRng(g.seed ^ 0x9e3779b9);
  const harmonics =
    spec.lumps > 0
      ? [2, 3, 5].map((k) => ({
          k,
          amp: rng.range(0.018, 0.035) * spec.lumps,
          ph: rng.range(0, Math.PI * 2),
        }))
      : [];

  const local = (t: number): Pt => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    const n = s < 0 ? spec.nTop : spec.nBot;
    let x = a * sgnPow(c, 2 / n);
    let y = b * sgnPow(s, 2 / n);
    x *= 1 + spec.taper * (y / b);
    let r = 1;
    for (const h of harmonics) r += h.amp * Math.cos(h.k * t + h.ph);
    x *= r;
    y *= r;
    const up = Math.max(0, (1 - y / b) / 2);
    x += lean * 0.22 * a * up * up;
    return { x, y };
  };

  const raw: Pt[] = [];
  for (let i = 0; i < SAMPLES; i++) raw.push(local((i / SAMPLES) * Math.PI * 2));
  const maxY = Math.max(...raw.map((p) => p.y));
  const dy = GROUND_Y - lift - maxY;
  const place = (p: Pt): Pt => ({ x: CENTER_X + p.x, y: p.y + dy });
  const outline = raw.map(place);

  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);

  const anchor = (deg: number) => {
    // deg clockwise from up -> parametric angle (0 = right, +90° = down)
    const t = ((deg - 90) * Math.PI) / 180;
    const p = place(local(t));
    const p1 = place(local(t - 0.01));
    const p2 = place(local(t + 0.01));
    const tan = norm(sub(p2, p1));
    // outline runs clockwise in screen space, so the outward normal is (tan.y, -tan.x)
    return { p, n: { x: tan.y, y: -tan.x } };
  };

  const span = (y: number) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i];
      const q = outline[(i + 1) % outline.length];
      if (!p || !q) continue;
      if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) {
        const x = p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }
    }
    if (!Number.isFinite(x0)) return { x0: CENTER_X, x1: CENTER_X };
    return { x0, x1 };
  };

  return {
    outline,
    path: closedSmoothPath(outline.filter((_, i) => i % 3 === 0)),
    a,
    b,
    top: Math.min(...ys),
    bottom: Math.max(...ys),
    left: Math.min(...xs),
    right: Math.max(...xs),
    anchor,
    span,
  };
}
