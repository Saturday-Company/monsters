import { type Pt, add, closedSmoothPath, cubic, dirFromUp, f, mul } from '../geometry.ts';
import { type Ctx, SW, ellipseEl, group, outlined, pathEl, thinkSide, url } from './common.ts';

/** Arms (in front of the body, pivot at the shoulder) and feet (behind the body). */

/** Arm angle in degrees, clockwise from "down", for the right arm (mirrored for the left). */
function armAngle(ctx: Ctx, side: number): number {
  const stubby = ctx.g.arms === 'stubby';
  const rest = stubby ? 52 : 36;
  switch (ctx.expr) {
    case 'happy':
      return 145;
    case 'error':
      return 100;
    case 'talk':
      return side > 0 ? 88 : rest;
    case 'think':
      return side === thinkSide(ctx) ? 64 : rest;
    default:
      return rest;
  }
}

function arm(ctx: Ctx, side: number, shoulder: Pt): string {
  const { a } = ctx.L.body;
  const long = ctx.g.arms === 'long';
  const L = (long ? 0.66 : 0.44) * a;
  const W = (long ? 0.25 : 0.28) * a;
  const ang = armAngle(ctx, side);
  // angles are measured from "down", outward positive; the hand curls back toward the body
  const dir = dirFromUp(side * (180 - ang));
  const handDir = dirFromUp(side * (180 - ang + 10));
  const start = add(shoulder, mul(dir, -0.12 * L));
  const end = add(start, mul(handDir, L));
  const spine = cubic(start, add(start, mul(dir, 0.4 * L)), add(start, mul(dir, 0.78 * L)), end);
  const width = (t: number) => W * (1 - 0.24 * t) + W * 0.3 * Math.max(0, (t - 0.62) / 0.38) ** 1.5;
  // closed outline with round caps at both ends
  const pts: Pt[] = [];
  const steps = 12;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = spine(t);
    const p1 = spine(Math.min(1, t + 0.01));
    const p0 = spine(Math.max(0, t - 0.01));
    const tx = p1.x - p0.x;
    const ty = p1.y - p0.y;
    const l = Math.hypot(tx, ty) || 1;
    const n = { x: -ty / l, y: tx / l };
    const w = width(t) / 2;
    left.push({ x: p.x + n.x * w, y: p.y + n.y * w });
    right.push({ x: p.x - n.x * w, y: p.y - n.y * w });
  }
  const capPts = (c: Pt, from: Pt, toward: Pt, r: number): Pt[] => {
    const out: Pt[] = [];
    const a0 = Math.atan2(from.y - c.y, from.x - c.x);
    const fwd = Math.atan2(toward.y, toward.x);
    let delta = fwd - a0;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const sweepDir = Math.sign(delta) || 1;
    for (let k = 1; k < 6; k++) {
      const ang = a0 + sweepDir * (k / 6) * Math.PI;
      out.push({ x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r });
    }
    return out;
  };
  const endP = spine(1);
  const startP = spine(0);
  const lastL = left[left.length - 1] ?? endP;
  const firstR = right[0] ?? startP;
  pts.push(...left);
  pts.push(...capPts(endP, lastL, mul(dir, 1), width(1) / 2));
  pts.push(...right.reverse());
  pts.push(...capPts(startP, firstR, mul(dir, -1), width(0) / 2));
  ctx.extend(pts);
  let svg = outlined(ctx, closedSmoothPath(pts), url(ctx, 'body'));
  if (long) {
    // two little finger creases on the hand
    const hand = spine(0.97);
    const n = { x: -dir.y, y: dir.x };
    for (const k of [-0.22, 0.22]) {
      const s = add(hand, mul(n, k * W));
      const e = add(s, mul(dir, 0.16 * W));
      svg += pathEl(`M${f(s.x)} ${f(s.y)}L${f(e.x)} ${f(e.y)}`, {
        stroke: ctx.P.outline,
        'stroke-width': SW.fine,
        'stroke-linecap': 'round',
      });
    }
  }
  return group(side < 0 ? 'arm-l' : 'arm-r', shoulder, svg);
}

export function renderArms(ctx: Ctx): string {
  if (ctx.g.arms === 'none') return '';
  const [l, r] = ctx.L.shoulders;
  return arm(ctx, -1, l) + arm(ctx, 1, r);
}

export function renderFeet(ctx: Ctx): string {
  const feet = ctx.L.feet;
  if (!feet) return '';
  const out: string[] = [];
  for (const [i, c] of [feet.l, feet.r].entries()) {
    const toes: string[] = [];
    if (ctx.g.feet === 'claws') {
      for (const k of [-0.5, 0, 0.5]) {
        const x = c.x + k * feet.rx;
        const yb = c.y + feet.ry * Math.sqrt(Math.max(0, 1 - k * k)) - 1.2;
        const r = Math.max(2.4, feet.rx * 0.17);
        toes.push(
          ellipseEl({ x, y: yb }, r, r * 0.85, {
            fill: '#f7f0e1',
            stroke: ctx.P.outline,
            'stroke-width': SW.fine,
          }),
        );
      }
    } else {
      for (const k of [-0.32, 0.32]) {
        const x = c.x + k * feet.rx;
        const yb = c.y + feet.ry * Math.sqrt(1 - k * k);
        toes.push(
          pathEl(`M${f(x)} ${f(yb - 1)}L${f(x)} ${f(yb - feet.ry * 0.55)}`, {
            stroke: ctx.P.outline,
            'stroke-width': SW.fine + 0.2,
            'stroke-linecap': 'round',
          }),
        );
      }
    }
    out.push(
      group(
        i === 0 ? 'foot-l' : 'foot-r',
        { x: c.x, y: c.y + feet.ry },
        ellipseEl(c, feet.rx, feet.ry, {
          fill: url(ctx, 'body'),
          stroke: ctx.P.outline,
          'stroke-width': SW.outline,
        }) + toes.join(''),
      ),
    );
    ctx.extend([
      { x: c.x - feet.rx - 2, y: c.y - feet.ry },
      { x: c.x + feet.rx + 2, y: c.y + feet.ry + 2 },
    ]);
  }
  return group('feet', { x: (feet.l.x + feet.r.x) / 2, y: feet.l.y + feet.ry }, out.join(''));
}
