import {
  type Pt,
  add,
  closedSmoothPath,
  cubic,
  f,
  mul,
  norm,
  rot,
  sub,
  sweep,
} from '../geometry.ts';
import { type Ctx, SW, circleEl, group, outlined, pathEl, url } from './common.ts';

/** Head accessories, all drawn BEHIND the body so their roots vanish under the outline. */

const UP: Pt = { x: 0, y: -1 };

/** Bands across a sweep, clipped to it (stripes on horns and tails). */
function bands(
  ctx: Ctx,
  clipD: string,
  spine: (t: number) => Pt,
  ts: number[],
  width: number,
  color: string,
  key: string,
): string {
  const id = ctx.id(`band-${key}`);
  const lines = ts
    .map((t) => {
      const p = spine(t);
      const tan = norm(sub(spine(Math.min(1, t + 0.02)), spine(Math.max(0, t - 0.02))));
      const n = { x: -tan.y, y: tan.x };
      const a = add(p, mul(n, 40));
      const b = sub(p, mul(n, 40));
      return `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`;
    })
    .join('');
  return (
    `<clipPath id="${id}"><path d="${clipD}"/></clipPath>` +
    `<g clip-path="url(#${id})">${pathEl(lines, { stroke: color, 'stroke-width': width, fill: 'none' })}</g>`
  );
}

// ---------------------------------------------------------------- horns

function horn(ctx: Ctx, deg: number, idx: number): string {
  const h = ctx.g.horns;
  if (!h) return '';
  const { a } = ctx.L.body;
  const { p, n } = ctx.L.body.anchor(deg);
  const side = Math.sign(deg) || 1;
  const s = h.size;
  let spine: (t: number) => Pt;
  let width: (t: number) => number;
  let cap: 'round' | 'point' = 'point';
  if (h.kind === 'curved') {
    const L = 0.62 * a * s;
    const root = sub(p, mul(n, 0.2 * L));
    const inward = { x: -side, y: 0 };
    spine = cubic(
      root,
      add(root, mul(n, 0.5 * L)),
      add(add(root, mul(n, 0.78 * L)), mul(UP, 0.3 * L)),
      add(add(add(root, mul(n, 0.62 * L)), mul(UP, 0.82 * L)), mul(inward, 0.1 * L)),
    );
    const W = 0.3 * a * Math.sqrt(s);
    width = (t) => W * (1 - t) ** 0.85;
  } else if (h.kind === 'spike') {
    const L = 0.4 * a * s;
    const root = sub(p, mul(n, 0.25 * L));
    const dir = norm(add(n, mul(UP, 0.6)));
    spine = cubic(
      root,
      add(root, mul(dir, 0.4 * L)),
      add(root, mul(dir, 0.75 * L)),
      add(add(root, mul(dir, L)), { x: side * 0.08 * L, y: 0 }),
    );
    const W = 0.24 * a * Math.sqrt(s);
    width = (t) => W * (1 - t) ** 0.9;
  } else {
    // nubs: a crown of separate stubby cones, each pointing out along the head's normal
    // (radial, like the points of a crown) with a slight outward flick at the tip
    const L = Math.min(0.28 * a, 22) * s;
    const root = sub(p, mul(n, 0.34 * L));
    const dir = norm(add(n, mul(UP, 0.5)));
    const flick = { x: side * 0.08 * L, y: 0 };
    spine = cubic(
      root,
      add(root, mul(dir, 0.4 * L)),
      add(root, mul(dir, 0.8 * L)),
      add(add(root, mul(dir, L)), flick),
    );
    const W = Math.min(0.23 * a, 16) * Math.sqrt(s);
    width = (t) => W * (1 - 0.5 * t ** 1.3);
    cap = 'round';
  }
  const poly = sweep(spine, width, { cap, steps: 12 });
  const d = closedSmoothPath(poly);
  ctx.extend(poly);
  let svg = outlined(ctx, d, url(ctx, 'acc'));
  if (h.kind === 'nubs') {
    // a glint on each cone keeps the crown reading as separate volumes
    const q = spine(0.7);
    const tan = norm(sub(spine(0.74), spine(0.66)));
    const nn = { x: -tan.y, y: tan.x };
    const off = mul(nn, (nn.x < 0 ? 1 : -1) * width(0.7) * 0.22);
    svg += circleEl(add(q, off), Math.max(1.2, width(0.7) * 0.14), {
      fill: '#ffffff',
      opacity: 0.7,
    });
  }
  if (h.stripes)
    svg +=
      bands(ctx, d, spine, [0.3, 0.52, 0.72], 0.07 * a, ctx.P.accentShade, `h${idx}`) +
      pathEl(d, { fill: 'none', stroke: ctx.P.outline, 'stroke-width': SW.outline });
  return svg;
}

export function renderHorns(ctx: Ctx): string {
  return group(
    'horns',
    ctx.L.pivots.head ?? null,
    ctx.L.hornAngles.map((d, i) => horn(ctx, d, i)).join(''),
  );
}

// ---------------------------------------------------------------- ears

function ear(ctx: Ctx, deg: number, idx: number): string {
  const e = ctx.g.ears;
  if (!e) return '';
  const { a } = ctx.L.body;
  const { p, n } = ctx.L.body.anchor(deg);
  const side = Math.sign(deg) || 1;
  const s = e.size;
  const out: string[] = [];
  switch (e.kind) {
    case 'long': {
      const L = 0.95 * a * s;
      const root = sub(p, mul(n, 8));
      const dir = norm(rot(n, side * 8));
      const flop = { x: side * 0.2 * L * (1 - e.spread * 0.5), y: (0.06 + 0.32 * e.spread) * L };
      const spine = cubic(
        root,
        add(root, mul(dir, 0.35 * L)),
        add(root, mul(dir, 0.72 * L)),
        add(add(root, mul(dir, L)), flop),
      );
      const W = 0.36 * a * Math.sqrt(s);
      const width = (t: number) =>
        W * (0.5 + 0.62 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.82)));
      const poly = sweep(spine, width, { cap: 'round' });
      const inner = sweep(
        (t) => spine(0.12 + t * 0.74),
        (t) => width(0.12 + t * 0.74) * 0.46,
        { cap: 'round' },
      );
      out.push(outlined(ctx, closedSmoothPath(poly), url(ctx, 'body')));
      out.push(pathEl(closedSmoothPath(inner), { fill: ctx.P.belly, opacity: 0.9 }));
      ctx.extend(poly);
      break;
    }
    case 'round': {
      const r = 0.22 * a * s;
      const c = add(p, mul(n, r * 0.45));
      out.push(
        circleEl(c, r, {
          fill: url(ctx, 'body'),
          stroke: ctx.P.outline,
          'stroke-width': SW.outline,
        }),
      );
      out.push(circleEl(add(c, mul(n, r * 0.12)), r * 0.55, { fill: ctx.P.belly, opacity: 0.9 }));
      ctx.extend([sub(c, { x: r, y: r }), add(c, { x: r, y: r })]);
      break;
    }
    case 'pointy': {
      const L = 0.46 * a * s;
      const root = sub(p, mul(n, 7));
      const dir = norm(rot(n, side * 10));
      const spine = cubic(
        root,
        add(root, mul(dir, 0.35 * L)),
        add(root, mul(dir, 0.7 * L)),
        add(root, mul(dir, L)),
      );
      const W = 0.4 * a * Math.sqrt(s);
      const width = (t: number) => W * (1 - t) ** 0.8;
      const poly = sweep(spine, width, { cap: 'point' });
      const inner = sweep(
        (t) => spine(0.2 + t * 0.62),
        (t) => width(0.2 + t * 0.62) * 0.48,
        { cap: 'point' },
      );
      out.push(outlined(ctx, closedSmoothPath(poly), url(ctx, 'body')));
      out.push(pathEl(closedSmoothPath(inner), { fill: ctx.P.belly, opacity: 0.9 }));
      ctx.extend(poly);
      break;
    }
    case 'fin': {
      // three soft fronds fanning out from the side of the head
      const fronds = [-30, 0, 30];
      fronds.forEach((da, k) => {
        const L = (k === 1 ? 0.4 : 0.32) * a * s;
        const root = sub(p, mul(n, 6));
        const dir = norm(rot(n, da));
        const spine = cubic(
          root,
          add(root, mul(dir, 0.4 * L)),
          add(add(root, mul(dir, 0.75 * L)), mul(UP, 0.08 * L)),
          add(root, mul(dir, L)),
        );
        const W = 0.13 * a * Math.sqrt(s);
        const poly = sweep(spine, (t) => W * (0.75 + 0.35 * Math.sin(Math.PI * t)), {
          cap: 'round',
          steps: 10,
        });
        out.push(outlined(ctx, closedSmoothPath(poly), url(ctx, 'acc')));
        ctx.extend(poly);
      });
      break;
    }
  }
  return group(`ear${idx}`, p, out.join(''));
}

export function renderEars(ctx: Ctx): string {
  return group('ears', null, ctx.L.earAngles.map((d, i) => ear(ctx, d, i)).join(''));
}

// ---------------------------------------------------------------- topper

export function renderTopper(ctx: Ctx): string {
  const tp = ctx.g.topper;
  if (!tp) return '';
  const { a } = ctx.L.body;
  const { p, n } = ctx.L.body.anchor(0);
  const s = tp.size;
  const out: string[] = [];
  switch (tp.kind) {
    case 'tuft': {
      const strands: [number, number][] = [
        [-26, 0.26],
        [0, 0.36],
        [24, 0.28],
      ];
      for (const [da, l] of strands) {
        const L = l * a * s;
        const root = sub(p, mul(n, 7));
        const dir = norm(rot(n, da));
        const curl = rot(dir, (da === 0 ? -1 : Math.sign(da)) * 70);
        const spine = cubic(
          root,
          add(root, mul(dir, 0.5 * L)),
          add(root, mul(dir, 0.9 * L)),
          add(add(root, mul(dir, L)), mul(curl, 0.3 * L)),
        );
        const W = 0.14 * a * Math.sqrt(s);
        const poly = sweep(spine, (t) => W * (1 - t) ** 0.7, { cap: 'point', steps: 12 });
        out.push(outlined(ctx, closedSmoothPath(poly), url(ctx, 'body')));
        ctx.extend(poly);
      }
      break;
    }
    case 'antenna': {
      const L = 0.5 * a * s;
      const base = sub(p, mul(n, 6));
      const tip = add(add(base, mul(n, L)), { x: 0.12 * L, y: 0 });
      const ctrl = add(add(base, mul(n, 0.6 * L)), { x: -0.12 * L, y: 0 });
      const d = `M${f(base.x)} ${f(base.y)}Q${f(ctrl.x)} ${f(ctrl.y)} ${f(tip.x)} ${f(tip.y)}`;
      const w = Math.max(3.4, 0.06 * a);
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
      const r = 0.11 * a * s;
      out.push(
        circleEl(tip, r, {
          fill: url(ctx, 'acc'),
          stroke: ctx.P.outline,
          'stroke-width': SW.outline - 0.6,
        }),
      );
      out.push(
        circleEl({ x: tip.x - r * 0.35, y: tip.y - r * 0.35 }, r * 0.28, {
          fill: '#ffffff',
          opacity: 0.75,
        }),
      );
      ctx.extend([
        base,
        { x: tip.x - r - 3, y: tip.y - r - 3 },
        { x: tip.x + r + 3, y: tip.y + r },
      ]);
      break;
    }
    case 'crest': {
      const spikes = [-30, -15, 0, 15, 30];
      for (const deg of spikes) {
        const an = ctx.L.body.anchor(deg);
        const L = (0.2 + 0.08 * (1 - Math.abs(deg) / 30)) * a * s;
        const root = sub(an.p, mul(an.n, 6));
        const dir = norm(rot(an.n, 12));
        const spine = cubic(
          root,
          add(root, mul(dir, 0.4 * L)),
          add(root, mul(dir, 0.75 * L)),
          add(root, mul(dir, L)),
        );
        const W = 0.2 * a * Math.sqrt(s);
        const poly = sweep(spine, (t) => W * (1 - t) ** 0.9, { cap: 'point', steps: 10 });
        out.push(outlined(ctx, closedSmoothPath(poly), url(ctx, 'acc')));
        ctx.extend(poly);
      }
      break;
    }
    case 'geyser': {
      // a jet of water ending in a puff of steam, plus two flying droplets.
      // Outline layer first, then fill layer: overlapping shapes share one clean outline.
      const L = 0.42 * a * s;
      const root = sub(p, mul(n, 7));
      const top = add(root, mul(UP, L));
      const col = sweep(
        cubic(root, add(root, { x: 3, y: -0.35 * L }), add(top, { x: -3, y: 0.35 * L }), top),
        (t) => (0.1 + 0.06 * t) * a,
        {
          cap: 'round',
          steps: 10,
        },
      );
      const pr = 0.14 * a * Math.sqrt(s);
      const puffs: [Pt, number][] = [
        [add(top, { x: -pr * 0.95, y: 0 }), pr * 0.85],
        [add(top, { x: pr * 0.95, y: pr * 0.05 }), pr * 0.8],
        [add(top, { x: 0, y: -pr * 0.55 }), pr * 1.05],
      ];
      const drops: Pt[] = [
        add(top, { x: -pr * 2.4, y: pr * 1.2 }),
        add(top, { x: pr * 2.3, y: pr * 0.9 }),
      ];
      const colD = closedSmoothPath(col);
      const sw2 = SW.outline * 2;
      const outlineLayer =
        pathEl(colD, {
          fill: ctx.P.outline,
          stroke: ctx.P.outline,
          'stroke-width': sw2,
          'stroke-linejoin': 'round',
        }) +
        puffs
          .map(([c, r]) =>
            circleEl(c, r, { fill: ctx.P.outline, stroke: ctx.P.outline, 'stroke-width': sw2 }),
          )
          .join('');
      const fillLayer =
        pathEl(colD, { fill: ctx.P.spray }) +
        puffs.map(([c, r]) => circleEl(c, r, { fill: ctx.P.spray })).join('') +
        circleEl(add(top, { x: -pr * 0.3, y: -pr * 0.9 }), pr * 0.32, {
          fill: '#ffffff',
          opacity: 0.9,
        });
      const dropSvg = drops
        .map((c, i) => {
          const r = 0.045 * a * (i ? 0.85 : 1);
          const d =
            `M${f(c.x)} ${f(c.y - 2.1 * r)}C${f(c.x + 0.5 * r)} ${f(c.y - 1.2 * r)} ${f(c.x + r)} ${f(c.y - 0.5 * r)} ${f(c.x + r)} ${f(c.y)}` +
            `A${f(r)} ${f(r)} 0 0 1 ${f(c.x - r)} ${f(c.y)}C${f(c.x - r)} ${f(c.y - 0.5 * r)} ${f(c.x - 0.5 * r)} ${f(c.y - 1.2 * r)} ${f(c.x)} ${f(c.y - 2.1 * r)}Z`;
          return pathEl(d, {
            fill: ctx.P.spray,
            stroke: ctx.P.outline,
            'stroke-width': SW.fine + 0.4,
            'stroke-linejoin': 'round',
          });
        })
        .join('');
      out.push(outlineLayer, fillLayer, dropSvg);
      ctx.extend(col);
      for (const [c, r] of puffs)
        ctx.extend([sub(c, { x: r + 4, y: r + 4 }), add(c, { x: r + 4, y: r + 4 })]);
      for (const c of drops) ctx.extend([sub(c, { x: 5, y: 8 }), add(c, { x: 5, y: 5 })]);
      break;
    }
  }
  return group('topper', p, out.join(''));
}
