import type { Expression, MonsterGenome } from '../genome.ts';
import { type Pt, cubic, f, openSmoothPath } from '../geometry.ts';
import { type Ctx, SW, ellipseEl, group, pathEl } from './common.ts';

/** Mouth kinds: smile (closed), grin (open D), canyon (very wide), tiny. Teeth: fangs, row, buck. */

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const MOUTH_SW = SW.detail + 0.4;

type Teeth = Ctx['g']['mouth']['teeth'];

/**
 * Geometry of an open mouth. `c` is the centre of its top edge as placed by the layout,
 * `sag` how far the upper lip dips in the middle (a smile; negative arches it up, as when talking),
 * `h` the opening below the lip.
 */
export interface OpenMouthSpec {
  c: Pt;
  w: number;
  h: number;
  sag: number;
}

/** Where the mouth corners sit above `c.y`: a smiling lip lifts its corners. */
const cornerLift = (s: OpenMouthSpec): number => Math.max(0, s.sag) * 0.45;

/** The open mouth drawn for an expression, or null when that expression uses a line or a closed smile. */
export function openMouthSpec(
  kind: MonsterGenome['mouth']['kind'],
  expr: Expression,
  m: { c: Pt; w: number; maxW: number; maxH: number },
  a: number,
): OpenMouthSpec | null {
  const { c, w, maxW, maxH } = m;
  switch (expr) {
    case 'talk': {
      const tw = clamp(w * 0.62, 0.3 * a, maxW);
      return { c: { x: c.x, y: c.y + 2 }, w: tw, h: Math.min(maxH, 0.72 * tw), sag: -0.16 * tw };
    }
    case 'happy': {
      const hw = Math.min(maxW, Math.max(w, 0.5 * a));
      return { c, w: hw, h: Math.min(maxH, 0.5 * hw), sag: 0.1 * hw };
    }
    case 'think':
    case 'error':
      return null;
    default:
      switch (kind) {
        case 'smile':
          return null;
        case 'grin':
          return { c, w, h: Math.min(maxH, 0.44 * w), sag: 0.09 * w };
        case 'canyon':
          return { c, w, h: Math.min(maxH, 0.3 * w), sag: 0.11 * w };
        case 'tiny':
          return { c, w, h: Math.min(maxH, 0.46 * w), sag: 0.05 * w };
      }
  }
}

/** Points that bound every mouth this genome can show (all expressions), stroke included. */
export function mouthEnvelope(
  kind: MonsterGenome['mouth']['kind'],
  m: { c: Pt; w: number; maxW: number; maxH: number },
  a: number,
): Pt[] {
  const pts: Pt[] = [];
  const pad = MOUTH_SW / 2 + 0.5;
  for (const expr of ['idle', 'talk', 'happy'] as const) {
    const s = openMouthSpec(kind, expr, m, a);
    if (!s) continue;
    const yc = s.c.y - cornerLift(s);
    const bottom = yc + Math.max(0, s.sag) + s.h;
    const top = yc + Math.min(0, s.sag) * 0.75;
    const crease = s.sag > 0 && s.w > 0.75 * a ? clamp(0.07 * s.w, 3, 6) : 0;
    pts.push(
      { x: s.c.x - s.w / 2 - pad - 0.9 * crease, y: yc - pad - 0.9 * crease },
      { x: s.c.x + s.w / 2 + pad + 0.9 * crease, y: yc - pad - 0.9 * crease },
      { x: s.c.x, y: top - pad },
      { x: s.c.x - 0.4 * s.w, y: yc + 0.55 * (bottom - yc) },
      { x: s.c.x + 0.4 * s.w, y: yc + 0.55 * (bottom - yc) },
      { x: s.c.x, y: bottom + pad },
    );
  }
  if (kind === 'smile') {
    const { c, w } = m;
    pts.push(
      { x: c.x - w / 2 - pad, y: c.y - pad },
      { x: c.x + w / 2 + pad, y: c.y - pad },
      { x: c.x, y: c.y + 0.17 * w + 9 },
    );
  }
  return pts;
}

function tooth(ctx: Ctx, pts: Pt[]): string {
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('') + 'Z';
  return pathEl(d, {
    fill: ctx.P.tooth,
    stroke: ctx.P.outline,
    'stroke-width': SW.fine,
    'stroke-linejoin': 'round',
  });
}

/**
 * Open D-shaped mouth. The upper lip is a soft smile curve (corners lifted, middle dipping by
 * `sag`) and every tooth hangs from that curve, so nothing reads as a flat ruled line.
 */
function openMouth(ctx: Ctx, s: OpenMouthSpec, teeth: Teeth, key: string): string {
  const { c, w, h, sag } = s;
  const x0 = c.x - w / 2;
  const x1 = c.x + w / 2;
  const yc = c.y - cornerLift(s);
  // cubic whose middle sits exactly `sag` below the corners
  const k = sag / 0.75;
  const lip = cubic(
    { x: x0, y: yc },
    { x: x0 + 0.27 * w, y: yc + k },
    { x: x1 - 0.27 * w, y: yc + k },
    { x: x1, y: yc },
  );
  const depth = Math.max(0, sag) + h;
  const kb = depth / 0.75;
  const d =
    `M${f(x0)} ${f(yc)}C${f(x0 + 0.27 * w)} ${f(yc + k)} ${f(x1 - 0.27 * w)} ${f(yc + k)} ${f(x1)} ${f(yc)}` +
    `C${f(x1 - 0.03 * w)} ${f(yc + kb)} ${f(x0 + 0.03 * w)} ${f(yc + kb)} ${f(x0)} ${f(yc)}Z`;
  const lipPts: Pt[] = Array.from({ length: 33 }, (_, i) => lip(i / 32));
  const topY = (x: number): number => {
    for (let i = 1; i < lipPts.length; i++) {
      const p = lipPts[i - 1];
      const q = lipPts[i];
      if (p && q && x <= q.x) return p.y + ((x - p.x) / Math.max(1e-6, q.x - p.x)) * (q.y - p.y);
    }
    return yc;
  };
  const bottom = yc + depth;
  const clipId = ctx.id(`mclip-${key}`);
  const inner: string[] = [
    ellipseEl({ x: c.x + 0.08 * w, y: bottom - 0.04 * h }, 0.3 * w, Math.max(3, 0.42 * h), {
      fill: ctx.P.tongue,
    }),
  ];
  if (teeth === 'fangs') {
    const wide = w > 56;
    const bw = clamp(0.15 * w, 4.5, wide ? 12 : 10);
    const th = clamp((wide ? 0.68 : 0.42) * h, 4.5, wide ? 15 : 12);
    for (const sd of [-1, 1]) {
      const x = c.x + sd * 0.3 * w;
      const xa = x - bw / 2;
      const xb = x + bw / 2;
      const tip = { x: x - sd * 0.12 * bw, y: topY(x) + th };
      inner.push(tooth(ctx, [{ x: xa, y: topY(xa) - 2.5 }, { x: xb, y: topY(xb) - 2.5 }, tip]));
    }
  } else if (teeth === 'row') {
    const n = Math.max(3, Math.round(w / 11));
    const tw = (w * 0.86) / n;
    const th = clamp(0.26 * h, 3.5, 8);
    for (let i = 0; i < n; i++) {
      const x = x0 + w * 0.07 + tw * (i + 0.5);
      const xa = x - tw * 0.45;
      const xb = x + tw * 0.45;
      inner.push(
        tooth(ctx, [
          { x: xa, y: topY(xa) - 2.5 },
          { x: xb, y: topY(xb) - 2.5 },
          { x, y: topY(x) + th },
        ]),
      );
    }
  } else if (teeth === 'buck') {
    const tw = clamp(0.13 * w, 4, 8);
    const th = clamp(0.34 * h, 4, 9);
    for (const sd of [-1, 1]) {
      const x = c.x + sd * tw * 0.52;
      const xa = x - tw / 2;
      const xb = x + tw / 2;
      const ty = topY(x);
      inner.push(
        pathEl(
          `M${f(xa)} ${f(topY(xa) - 2.5)}L${f(xb)} ${f(topY(xb) - 2.5)}L${f(xb)} ${f(ty + th - 2)}Q${f(xb)} ${f(ty + th)} ${f(xb - 2)} ${f(ty + th)}L${f(xa + 2)} ${f(ty + th)}Q${f(xa)} ${f(ty + th)} ${f(xa)} ${f(ty + th - 2)}Z`,
          {
            fill: ctx.P.tooth,
            stroke: ctx.P.outline,
            'stroke-width': SW.fine,
            'stroke-linejoin': 'round',
          },
        ),
      );
    }
  }
  // smile creases: a short upturned tick at each corner of a wide smiling mouth
  let creases = '';
  if (sag > 0 && w > 0.75 * ctx.L.body.a) {
    const l = clamp(0.07 * w, 3, 6);
    creases = [-1, 1]
      .map((sd) => {
        const x = sd < 0 ? x0 : x1;
        return pathEl(
          `M${f(x + sd * 0.4 * l)} ${f(yc + 0.9 * l)}Q${f(x + sd * 0.9 * l)} ${f(yc + 0.1 * l)} ${f(x + sd * 0.5 * l)} ${f(yc - 0.9 * l)}`,
          {
            fill: 'none',
            stroke: ctx.P.outline,
            'stroke-width': SW.fine + 0.4,
            'stroke-linecap': 'round',
          },
        );
      })
      .join('');
  }
  ctx.extend({ x0: x0 - 6, y0: Math.min(yc, yc + k * 0.75) - 6, x1: x1 + 6, y1: bottom + 2 });
  return (
    `<clipPath id="${clipId}"><path d="${d}"/></clipPath>` +
    pathEl(d, { fill: ctx.P.mouth }) +
    `<g clip-path="url(#${clipId})">${inner.join('')}</g>` +
    pathEl(d, {
      fill: 'none',
      stroke: ctx.P.outline,
      'stroke-width': MOUTH_SW,
      'stroke-linejoin': 'round',
    }) +
    creases
  );
}

function closedSmile(ctx: Ctx, c: Pt, w: number, teeth: Teeth): string {
  const x0 = c.x - w / 2;
  const x1 = c.x + w / 2;
  const depth = 0.34 * w;
  const curveY = (x: number): number => {
    const t = (x - x0) / w;
    return c.y + 2 * t * (1 - t) * depth;
  };
  const out: string[] = [];
  if (teeth !== 'none') {
    const bw = clamp(0.16 * w, 4, 8);
    const th = clamp(0.18 * w, 4.5, 8.5);
    const xs =
      teeth === 'buck' ? [c.x - bw * 0.52, c.x + bw * 0.52] : [c.x - 0.25 * w, c.x + 0.25 * w];
    for (const x of xs) {
      const y0 = curveY(x - bw / 2);
      const y1 = curveY(x + bw / 2);
      out.push(
        tooth(
          ctx,
          teeth === 'buck'
            ? [
                { x: x - bw / 2, y: y0 },
                { x: x + bw / 2, y: y1 },
                { x: x + bw / 2, y: y1 + th * 0.9 },
                { x: x - bw / 2, y: y0 + th * 0.9 },
              ]
            : [
                { x: x - bw / 2, y: y0 },
                { x: x + bw / 2, y: y1 },
                { x: x + (x < c.x ? 0.8 : -0.8), y: (y0 + y1) / 2 + th },
              ],
        ),
      );
    }
  }
  const d = `M${f(x0)} ${f(c.y)}Q${f(c.x)} ${f(c.y + depth)} ${f(x1)} ${f(c.y)}`;
  out.push(
    pathEl(d, {
      fill: 'none',
      stroke: ctx.P.outline,
      'stroke-width': MOUTH_SW,
      'stroke-linecap': 'round',
    }),
  );
  ctx.extend({ x0: x0 - 3, y0: c.y - 4, x1: x1 + 3, y1: c.y + depth });
  return out.join('');
}

function line(ctx: Ctx, pts: Pt[]): string {
  return pathEl(openSmoothPath(pts), {
    fill: 'none',
    stroke: ctx.P.outline,
    'stroke-width': MOUTH_SW,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
}

export function renderMouth(ctx: Ctx): string {
  const { g, L } = ctx;
  const { c, w, maxW } = L.mouth;
  const a = L.body.a;
  const teeth = g.mouth.teeth;
  const spec = openMouthSpec(g.mouth.kind, ctx.expr, L.mouth, a);
  let svg: string;
  if (spec) {
    const t =
      ctx.expr === 'talk'
        ? teeth === 'row'
          ? 'fangs'
          : teeth
        : ctx.expr === 'idle' && g.mouth.kind === 'tiny' && teeth === 'row'
          ? 'none'
          : teeth;
    svg = openMouth(ctx, spec, t, ctx.expr);
  } else if (ctx.expr === 'think') {
    const x = c.x + 0.07 * a;
    const s = 0.13 * a;
    svg = line(ctx, [
      { x: x - s, y: c.y + 4 },
      { x: x - s * 0.2, y: c.y + 2.2 },
      { x: x + s * 0.5, y: c.y + 3.6 },
      { x: x + s, y: c.y + 1.6 },
    ]);
    ctx.extend({ x0: x - s, y0: c.y, x1: x + s, y1: c.y + 6 });
  } else if (ctx.expr === 'error') {
    const ew = clamp(w * 0.55, 0.28 * a, maxW * 0.8);
    const n = 6;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++)
      pts.push({ x: c.x - ew / 2 + (ew * i) / n, y: c.y + 6 + (i % 2 ? -2.6 : 2.6) });
    svg = line(ctx, pts);
    ctx.extend({ x0: c.x - ew / 2, y0: c.y, x1: c.x + ew / 2, y1: c.y + 10 });
  } else {
    svg = closedSmile(ctx, c, w, teeth);
  }
  return group('mouth', { x: c.x, y: c.y }, svg);
}

/**
 * Pink cheeks: shown when happy; monsters whose eyes sit on stalks wear them always (softer),
 * so the muzzle under the stalks still reads as a face.
 */
export function renderCheeks(ctx: Ctx): string {
  const muzzle = ctx.g.eyes.kind === 'stalk';
  if (ctx.expr !== 'happy' && !muzzle) return '';
  const { c, w, maxW } = ctx.L.mouth;
  const a = ctx.L.body.a;
  const dx = muzzle
    ? Math.min(maxW / 2 + 6, w / 2 + 0.17 * a)
    : Math.min(maxW / 2 + 4, Math.max(w, 0.5 * a) / 2 + 0.1 * a);
  const y = c.y + (muzzle ? 5 : -1);
  const opacity = ctx.expr === 'happy' ? 0.6 : ctx.expr === 'error' ? 0.2 : 0.45;
  const rx = (muzzle ? 0.12 : 0.085) * a;
  return group(
    'cheeks',
    null,
    [-1, 1]
      .map((s) =>
        ellipseEl({ x: c.x + s * dx, y }, rx, (muzzle ? 0.07 : 0.05) * a, {
          fill: ctx.P.cheek,
          opacity,
        }),
      )
      .join(''),
  );
}
