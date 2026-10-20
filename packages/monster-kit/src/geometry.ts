/** Small 2D geometry toolkit used by the parts (all coordinates in the 200×200 viewBox). */

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Formats a number with at most one decimal (keeps SVGs short and deterministic). */
export const f = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
};

export const pt = (x: number, y: number): Pt => ({ x, y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const len = (a: Pt): number => Math.hypot(a.x, a.y);
export const norm = (a: Pt): Pt => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const rot = (p: Pt, deg: number, o: Pt = { x: 0, y: 0 }): Pt => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  return { x: o.x + dx * c - dy * s, y: o.y + dx * s + dy * c };
};
/** Unit vector for an angle measured clockwise from "up" (0° = up, 90° = right). */
export const dirFromUp = (deg: number): Pt => {
  const r = (deg * Math.PI) / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
};

const at = <T>(arr: readonly T[], i: number): T => {
  const n = arr.length;
  const v = arr[((i % n) + n) % n];
  if (v === undefined) throw new Error('empty point list');
  return v;
};

/** Closed Catmull-Rom spline through the points, as cubic Bézier path data. */
export function closedSmoothPath(pts: readonly Pt[], tension = 1): string {
  if (pts.length < 3) throw new Error('need at least 3 points');
  const k = tension / 6;
  let d = `M${f(at(pts, 0).x)} ${f(at(pts, 0).y)}`;
  for (let i = 0; i < pts.length; i++) {
    const p0 = at(pts, i - 1);
    const p1 = at(pts, i);
    const p2 = at(pts, i + 1);
    const p3 = at(pts, i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) * k, y: p1.y + (p2.y - p0.y) * k };
    const c2 = { x: p2.x - (p3.x - p1.x) * k, y: p2.y - (p3.y - p1.y) * k };
    d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d + 'Z';
}

/** Open Catmull-Rom spline through the points. */
export function openSmoothPath(pts: readonly Pt[], tension = 1): string {
  if (pts.length < 2) throw new Error('need at least 2 points');
  const k = tension / 6;
  const first = at(pts, 0);
  let d = `M${f(first.x)} ${f(first.y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? at(pts, i);
    const p1 = at(pts, i);
    const p2 = at(pts, i + 1);
    const p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) * k, y: p1.y + (p2.y - p0.y) * k };
    const c2 = { x: p2.x - (p3.x - p1.x) * k, y: p2.y - (p3.y - p1.y) * k };
    d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

export const polygonPath = (pts: readonly Pt[]): string =>
  pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p.x)} ${f(p.y)}`).join('') + 'Z';

/** Cubic Bézier evaluated at t. */
export const cubic =
  (p0: Pt, p1: Pt, p2: Pt, p3: Pt) =>
  (t: number): Pt => {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return {
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    };
  };

export const quad =
  (p0: Pt, p1: Pt, p2: Pt) =>
  (t: number): Pt => {
    const u = 1 - t;
    return {
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    };
  };

export interface SweepOptions {
  steps?: number;
  /** Shape of the far end: a round cap or a sharp point. */
  cap?: 'round' | 'point';
}

/**
 * Outline polygon of a limb-like shape: a spine curve with a width profile.
 * The root (t = 0) is left open-ish because it is always hidden inside the body.
 */
export function sweep(
  spine: (t: number) => Pt,
  width: (t: number) => number,
  opts: SweepOptions = {},
): Pt[] {
  const steps = opts.steps ?? 14;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = spine(t);
    const a = spine(Math.max(0, t - 0.01));
    const b = spine(Math.min(1, t + 0.01));
    const tan = norm(sub(b, a));
    const n = { x: -tan.y, y: tan.x };
    const w = Math.max(0, width(t)) / 2;
    if (opts.cap === 'point' && i === steps) {
      left.push(p);
      continue;
    }
    left.push(add(p, mul(n, w)));
    right.push(sub(p, mul(n, w)));
  }
  const pts = [...left];
  if (opts.cap !== 'point') {
    const end = spine(1);
    const tan = norm(sub(end, spine(0.99)));
    const w = Math.max(0.5, width(1)) / 2;
    const n = { x: -tan.y, y: tan.x };
    for (let k = 1; k < 6; k++) {
      const ang = (k / 6) * Math.PI;
      // rotate from +n through +tan to -n
      const v = add(mul(n, Math.cos(ang)), mul(tan, Math.sin(ang)));
      pts.push(add(end, mul(v, w)));
    }
  }
  for (let i = right.length - 1; i >= 0; i--) {
    const r = right[i];
    if (r) pts.push(r);
  }
  return pts;
}

export function boxOf(pts: readonly Pt[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

export const circleBox = (c: Pt, r: number): Box => ({
  x0: c.x - r,
  y0: c.y - r,
  x1: c.x + r,
  y1: c.y + r,
});

export const boxesOverlap = (a: Box, b: Box, gap = 0): boolean =>
  a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

export const unionBox = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

/** Even-odd point-in-polygon test. */
export function insidePolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
