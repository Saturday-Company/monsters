import {
  type Pt,
  add,
  closedSmoothPath,
  cubic,
  f,
  mul,
  norm,
  openSmoothPath,
  sub,
  sweep,
} from '../geometry.ts';
import { type Ctx, SW, group, outlined, pathEl, url } from './common.ts';

/** Tail kinds: plume (feathery, striped), spiky (spade tip), curl (spiral tube). Always on the right, behind the body. */

/**
 * Fluffy outline: the smooth sweep outline is resampled every `step` units and consecutive
 * points are joined by outward arcs, so the edge becomes a row of soft tufts with small notches
 * between them (fur), while the root (hidden in the body) stays a plain line.
 */
function scallopPath(poly: readonly Pt[], hidden: number, step: number): string {
  const n = poly.length;
  // poly runs: left edge root→tip, cap, right edge tip→root; the first and last `hidden`
  // points sit inside the body
  const visible = poly.slice(hidden, n - hidden);
  const lens: number[] = [0];
  for (let i = 1; i < visible.length; i++) {
    const p = visible[i - 1];
    const q = visible[i];
    lens.push((lens[i - 1] ?? 0) + (p && q ? Math.hypot(q.x - p.x, q.y - p.y) : 0));
  }
  const total = lens[lens.length - 1] ?? 0;
  const count = Math.max(4, Math.round(total / step));
  const at = (d: number): Pt => {
    let i = 1;
    while (i < lens.length - 1 && (lens[i] ?? 0) < d) i++;
    const p = visible[i - 1] ?? { x: 0, y: 0 };
    const q = visible[i] ?? p;
    const l0 = lens[i - 1] ?? 0;
    const l1 = lens[i] ?? l0;
    const t = l1 > l0 ? (d - l0) / (l1 - l0) : 0;
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  };
  const pts = Array.from({ length: count + 1 }, (_, i) => at((total * i) / count));
  const first = poly[0] ?? pts[0] ?? { x: 0, y: 0 };
  let d = `M${f(first.x)} ${f(first.y)}`;
  for (const p of poly.slice(1, hidden)) d += `L${f(p.x)} ${f(p.y)}`;
  const p0 = pts[0] ?? first;
  d += `L${f(p0.x)} ${f(p0.y)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1] ?? p0;
    const q = pts[i] ?? p;
    const r = 0.64 * Math.hypot(q.x - p.x, q.y - p.y);
    d += `A${f(r)} ${f(r)} 0 0 0 ${f(q.x)} ${f(q.y)}`;
  }
  for (const p of poly.slice(n - hidden)) d += `L${f(p.x)} ${f(p.y)}`;
  return d + 'Z';
}

/** Light bands across the plume, bowed toward the tip like rings of fur. */
function plumeBands(
  ctx: Ctx,
  clipD: string,
  spine: (t: number) => Pt,
  width: (t: number) => number,
): string {
  const id = ctx.id('tail-bands');
  const d = [0.4, 0.6, 0.8]
    .map((t) => {
      const p = spine(t);
      const tan = norm(sub(spine(Math.min(1, t + 0.02)), spine(Math.max(0, t - 0.02))));
      const n = { x: -tan.y, y: tan.x };
      const w = width(t) * 0.62;
      const s0 = add(p, mul(n, w));
      const s1 = sub(p, mul(n, w));
      const c = add(p, mul(tan, 0.45 * width(t)));
      return `M${f(s0.x)} ${f(s0.y)}Q${f(c.x)} ${f(c.y)} ${f(s1.x)} ${f(s1.y)}`;
    })
    .join('');
  return (
    `<clipPath id="${id}"><path d="${clipD}"/></clipPath>` +
    `<g clip-path="url(#${id})">${pathEl(d, {
      fill: 'none',
      stroke: ctx.P.belly,
      'stroke-width': Math.max(3, 0.11 * ctx.L.body.a),
      'stroke-linecap': 'round',
      opacity: 0.95,
    })}</g>`
  );
}

export function renderTail(ctx: Ctx): string {
  const t = ctx.g.tail;
  if (!t) return '';
  const { a } = ctx.L.body;
  const s = t.size;
  const an = ctx.L.body.anchor(112);
  const out: string[] = [];
  switch (t.kind) {
    case 'plume': {
      // soft, bushy plume (squirrel-like) curling back toward the head
      const root = sub(an.p, mul(an.n, 12));
      const spine = cubic(
        root,
        add(root, { x: 0.5 * a * s, y: 0.08 * a }),
        add(root, { x: 0.92 * a * s, y: -0.4 * a * s }),
        add(root, { x: 0.52 * a * s, y: -1.0 * a * s }),
      );
      const W = 0.56 * a * Math.sqrt(s);
      const width = (u: number) => 0.18 * a + W * Math.sin(Math.PI * (0.08 + 0.7 * u)) * u ** 0.45;
      const steps = 24;
      const poly = sweep(spine, width, { cap: 'round', steps });
      const d = scallopPath(poly, Math.round(steps * 0.18), 0.26 * a);
      out.push(outlined(ctx, d, url(ctx, 'body')));
      if (t.stripes) {
        out.push(plumeBands(ctx, d, spine, width));
        out.push(pathEl(d, { fill: 'none', stroke: ctx.P.outline, 'stroke-width': SW.outline }));
      }
      ctx.extend(poly.map((p) => ({ x: p.x + 2, y: p.y - 2 })));
      break;
    }
    case 'spiky': {
      const root = sub(an.p, mul(an.n, 10));
      const spine = cubic(
        root,
        add(root, { x: 0.5 * a * s, y: 0.12 * a }),
        add(root, { x: 0.85 * a * s, y: 0 }),
        add(root, { x: 0.95 * a * s, y: -0.45 * a * s }),
      );
      const poly = sweep(spine, (u) => 0.22 * a * (1 - 0.65 * u), { cap: 'round', steps: 14 });
      out.push(outlined(ctx, closedSmoothPath(poly), url(ctx, 'body')));
      // spade tip
      const tip = spine(1);
      const dir = norm(sub(tip, spine(0.94)));
      const n = { x: -dir.y, y: dir.x };
      const k = 0.2 * a * Math.sqrt(s);
      const spade = [
        add(tip, mul(dir, -0.15 * k)),
        add(add(tip, mul(n, 0.75 * k)), mul(dir, 0.35 * k)),
        add(tip, mul(dir, 1.35 * k)),
        add(add(tip, mul(n, -0.75 * k)), mul(dir, 0.35 * k)),
      ];
      out.push(outlined(ctx, closedSmoothPath(spade, 0.55), url(ctx, 'acc'), SW.outline - 0.4));
      ctx.extend([...poly, ...spade]);
      break;
    }
    case 'curl': {
      const root = sub(an.p, mul(an.n, 10));
      const c = add(root, { x: 0.62 * a * s, y: -0.32 * a * s });
      const pts: Pt[] = [root];
      const turns = 1.2;
      const r0 = 0.36 * a * s;
      const startAng = Math.atan2(root.y - c.y, root.x - c.x);
      for (let i = 1; i <= 26; i++) {
        const u = i / 26;
        const ang = startAng - u * turns * Math.PI * 2;
        const r = r0 * (1 - 0.68 * u);
        pts.push({ x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r });
      }
      const d = openSmoothPath(pts);
      const w = 0.17 * a * Math.sqrt(s);
      out.push(
        pathEl(d, {
          fill: 'none',
          stroke: ctx.P.outline,
          'stroke-width': w + SW.outline * 2,
          'stroke-linecap': 'round',
        }),
      );
      out.push(
        pathEl(d, {
          fill: 'none',
          stroke: ctx.P.base,
          'stroke-width': w,
          'stroke-linecap': 'round',
        }),
      );
      out.push(
        pathEl(d, {
          fill: 'none',
          stroke: ctx.P.light,
          'stroke-width': w * 0.3,
          'stroke-linecap': 'round',
          opacity: 0.55,
          transform: 'translate(-1 -1.5)',
        }),
      );
      ctx.extend(pts.map((p) => ({ x: p.x + w, y: p.y - w })));
      ctx.extend(pts.map((p) => ({ x: p.x - w, y: p.y + w })));
      break;
    }
  }
  return group('tail', an.p, out.join(''));
}
