import { type Pt, closedSmoothPath, f, insidePolygon, quad, sweep } from '../geometry.ts';
import { type Ctx, circleEl, ellipseEl, pathEl } from './common.ts';

/** Everything painted ON the body (clipped to it): belly, marks, specular highlight. */

export function renderBelly(ctx: Ctx): string {
  const b = ctx.L.belly;
  if (!b) return '';
  return `<g class="m-belly">${ellipseEl(b.c, b.rx, b.ry, { fill: ctx.P.belly })}</g>`;
}

interface Spot {
  c: Pt;
  r: number;
}

function scatter(
  ctx: Ctx,
  count: number,
  rMin: number,
  rMax: number,
  area: (p: Pt, r: number) => boolean,
  gap: number,
  avoid: readonly Spot[] = [],
): Spot[] {
  const { body } = ctx.L;
  const spots: Spot[] = [];
  const face = ctx.L.boxes.face;
  for (let tries = 0; tries < count * 40 && spots.length < count; tries++) {
    const r = ctx.rng.range(rMin, rMax);
    const c = {
      x: ctx.rng.range(body.left, body.right),
      y: ctx.rng.range(body.top + 0.12 * ctx.L.H, body.bottom - 4),
    };
    if (!insidePolygon(c, body.outline)) continue;
    if (
      c.x + r > face.x0 - 3 &&
      c.x - r < face.x1 + 3 &&
      c.y + r > face.y0 - 3 &&
      c.y - r < face.y1 + 3
    )
      continue;
    if (!area(c, r)) continue;
    if ([...avoid, ...spots].some((s) => Math.hypot(s.c.x - c.x, s.c.y - c.y) < s.r + r + gap))
      continue;
    spots.push({ c, r });
  }
  return spots;
}

function blob(ctx: Ctx, c: Pt, r: number): string {
  const n = 7;
  const pts: Pt[] = [];
  const ph = ctx.rng.range(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const ang = ph + (i / n) * Math.PI * 2;
    const rr = r * ctx.rng.range(0.72, 1.18);
    pts.push({ x: c.x + Math.cos(ang) * rr, y: c.y + Math.sin(ang) * rr * 0.9 });
  }
  return closedSmoothPath(pts);
}

export function renderMarks(ctx: Ctx): string {
  const m = ctx.g.marks;
  if (!m) return '';
  const { a } = ctx.L.body;
  const P = ctx.P;
  const belly = ctx.L.belly;
  const inBelly = (p: Pt, r: number): boolean =>
    !belly ||
    ((p.x - belly.c.x) / (belly.rx - r)) ** 2 + ((p.y - belly.c.y) / (belly.ry - r)) ** 2 <= 1;
  const outBelly = (p: Pt, r: number): boolean =>
    !belly ||
    ((p.x - belly.c.x) / (belly.rx + r)) ** 2 + ((p.y - belly.c.y) / (belly.ry + r)) ** 2 >= 1;
  const out: string[] = [];
  switch (m.kind) {
    case 'spots': {
      const spots = scatter(ctx, Math.round(3 + m.density * 7), 0.05 * a, 0.11 * a, outBelly, 4);
      for (const s of spots)
        out.push(
          ellipseEl(s.c, s.r, s.r * 0.82, { fill: P.mark, opacity: 0.9 }, ctx.rng.range(-40, 40)),
        );
      break;
    }
    case 'craters': {
      const onBelly = Boolean(belly);
      const spots = scatter(
        ctx,
        Math.round(3 + m.density * 4),
        0.065 * a,
        0.12 * a,
        onBelly ? inBelly : () => true,
        3,
      );
      const bowl = onBelly ? P.bellyShade : P.mark;
      const floor = onBelly ? P.belly : P.shade;
      for (const s of spots) {
        out.push(circleEl(s.c, s.r, { fill: bowl }));
        out.push(
          circleEl({ x: s.c.x + s.r * 0.16, y: s.c.y + s.r * 0.18 }, s.r * 0.76, {
            fill: floor,
            opacity: 0.85,
          }),
        );
        const r = s.r * 1.05;
        out.push(
          pathEl(
            `M${f(s.c.x + r)} ${f(s.c.y - s.r * 0.15)}A${f(r)} ${f(r)} 0 0 1 ${f(s.c.x - s.r * 0.15)} ${f(s.c.y + r)}`,
            {
              fill: 'none',
              stroke: onBelly ? '#ffffff' : P.markRim,
              'stroke-width': 1.6,
              'stroke-linecap': 'round',
              opacity: 0.8,
            },
          ),
        );
      }
      break;
    }
    case 'sponge': {
      const big = scatter(ctx, Math.round(6 + m.density * 6), 0.06 * a, 0.11 * a, () => true, 3);
      const small = scatter(
        ctx,
        Math.round(6 + m.density * 10),
        0.025 * a,
        0.05 * a,
        () => true,
        2.5,
        big,
      );
      for (const s of [...big, ...small]) {
        out.push(pathEl(blob(ctx, s.c, s.r), { fill: P.mark, opacity: 0.88 }));
        out.push(
          pathEl(blob(ctx, { x: s.c.x + s.r * 0.18, y: s.c.y + s.r * 0.22 }, s.r * 0.55), {
            fill: P.shade,
            opacity: 0.5,
          }),
        );
      }
      break;
    }
    case 'stripes': {
      const { body, H } = ctx.L;
      const n = 2 + Math.round(m.density * 2);
      for (let i = 0; i < n; i++) {
        const y = body.top + H * (0.22 + i * 0.13);
        const sp = body.span(y);
        for (const side of [-1, 1]) {
          const x = side < 0 ? sp.x0 - 4 : sp.x1 + 4;
          const L = 0.3 * a * (1 - i * 0.08);
          const start = { x, y };
          const end = { x: x - side * L, y: y - 0.12 * L };
          const mid = { x: (x + end.x) / 2, y: y + 0.05 * L };
          const spine = quad(start, mid, end);
          out.push(
            pathEl(
              closedSmoothPath(
                sweep(spine, (t) => 0.1 * a * (1 - t) ** 0.8, { cap: 'point', steps: 8 }),
              ),
              { fill: P.mark, opacity: 0.9 },
            ),
          );
        }
      }
      break;
    }
  }
  return `<g class="m-marks">${out.join('')}</g>`;
}

export function renderHighlight(ctx: Ctx): string {
  const { body, H } = ctx.L;
  const y = body.top + 0.16 * H;
  const sp = body.span(y);
  const x = sp.x0 + (sp.x1 - sp.x0) * 0.24;
  const a = body.a;
  return (
    `<g class="m-shine">` +
    ellipseEl({ x, y }, 0.17 * a, 0.075 * H, { fill: '#ffffff', opacity: 0.42 }, -38) +
    circleEl({ x: x + 0.2 * a, y: y - 0.06 * H }, 0.045 * a, { fill: '#ffffff', opacity: 0.5 }) +
    `</g>`
  );
}
