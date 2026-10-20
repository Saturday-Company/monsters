import { type Pt, f, lerp } from '../geometry.ts';
import type { EyeSpot } from '../layout.ts';
import { type Ctx, SW, circleEl, group, pathEl, thinkSide, url } from './common.ts';

/** Eye kinds: round (2), cyclops (1 big), stalk (2 on antennae), trio (3). */

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const eyeStroke = (r: number): number => clamp(r * 0.17, 2.3, SW.detail + 0.4);

function lookFor(ctx: Ctx): Pt {
  switch (ctx.expr) {
    case 'think':
      return { x: 0.55 * thinkSide(ctx), y: -0.7 };
    case 'talk':
      return { x: 0.05, y: 0.12 };
    case 'error':
      return { x: 0, y: 0 };
    default:
      return { x: 0.1, y: 0.08 };
  }
}

function openEye(ctx: Ctx, e: EyeSpot, look: Pt, small = false): string {
  const { c, r } = e;
  const irisR = r * (small ? 0.4 : 0.6);
  const off = r - irisR - r * 0.12;
  const ic = { x: c.x + look.x * off, y: c.y + look.y * off };
  const pupilR = irisR * (small ? 0.62 : 0.55);
  // how far the pupil may wander when the monster looks around (CSS reads --m-look)
  const roam = Math.max(0, off * (1 - Math.max(Math.abs(look.x), Math.abs(look.y))) * 0.75);
  const pupil = [
    circleEl(ic, irisR, { fill: url(ctx, 'iris') }),
    circleEl(ic, pupilR, { fill: '#1c1724' }),
    circleEl({ x: ic.x - irisR * 0.38, y: ic.y - irisR * 0.42 }, Math.max(1.2, irisR * 0.3), {
      fill: '#ffffff',
    }),
    circleEl({ x: ic.x + irisR * 0.32, y: ic.y + irisR * 0.34 }, Math.max(0.7, irisR * 0.13), {
      fill: '#ffffff',
      opacity: 0.9,
    }),
  ].join('');
  return (
    circleEl(c, r, { fill: url(ctx, 'scl'), stroke: ctx.P.outline, 'stroke-width': eyeStroke(r) }) +
    `<g class="m-pupil" style="--m-look:${f(roam)}px">${pupil}</g>` +
    lid(ctx, e)
  );
}

/**
 * Eyelid for blinking: a skin-coloured disc over the eye with a closed-eye line, collapsed by
 * default (`scale(1 0)`, so static renderers never show it). The CSS blink scales it open from
 * the top of the eye.
 */
function lid(ctx: Ctx, e: EyeSpot): string {
  const { c, r } = e;
  const R = r + 0.4;
  const line = `M${f(c.x - 0.68 * r)} ${f(c.y + 0.05 * r)}Q${f(c.x)} ${f(c.y + 0.5 * r)} ${f(c.x + 0.68 * r)} ${f(c.y + 0.05 * r)}`;
  return (
    `<g class="m-lid" transform="scale(1 0)" style="transform-origin:${f(c.x)}px ${f(c.y - R)}px">` +
    circleEl(c, R, {
      fill: url(ctx, 'body'),
      stroke: ctx.P.outline,
      'stroke-width': eyeStroke(r),
    }) +
    pathEl(line, {
      fill: 'none',
      stroke: ctx.P.outline,
      'stroke-width': clamp(r * 0.2, 2.6, 4.4),
      'stroke-linecap': 'round',
    }) +
    `</g>`
  );
}

function closedEye(ctx: Ctx, e: EyeSpot): string {
  const { c, r } = e;
  const w = r * 0.7;
  return pathEl(
    `M${f(c.x - w)} ${f(c.y + r * 0.18)}Q${f(c.x)} ${f(c.y - r * 0.72)} ${f(c.x + w)} ${f(c.y + r * 0.18)}`,
    {
      fill: 'none',
      stroke: ctx.P.outline,
      'stroke-width': clamp(r * 0.24, 3.2, 5),
      'stroke-linecap': 'round',
    },
  );
}

/** Eyebrow above an eye; `tilt` > 0 raises the inner end (worried), `lift` raises it all. */
function brow(ctx: Ctx, e: EyeSpot, side: number, tilt: number, lift: number): string {
  const { c, r } = e;
  // eyes on the face keep their brows on the body; eyes on stalks wear them in the air
  const y = e.stalkBase
    ? c.y - r - 2.5 - lift * 0.5
    : Math.max(c.y - r - 4 - lift, ctx.L.body.top + 7);
  const w = r * 0.75;
  const inner = { x: c.x - side * w, y: y - tilt * r * 0.35 };
  const outer = { x: c.x + side * w, y: y + tilt * r * 0.15 };
  const mid = lerp(inner, outer, 0.5);
  mid.y -= r * 0.18;
  ctx.extend([
    { x: inner.x - 3, y: Math.min(inner.y, mid.y) - 3 },
    { x: outer.x + 3, y: outer.y + 3 },
  ]);
  return pathEl(
    `M${f(inner.x)} ${f(inner.y)}Q${f(mid.x)} ${f(mid.y)} ${f(outer.x)} ${f(outer.y)}`,
    {
      fill: 'none',
      stroke: ctx.P.outline,
      'stroke-width': clamp(r * 0.2, 2.8, 4),
      'stroke-linecap': 'round',
    },
  );
}

/** Stalks are drawn behind the body so their roots disappear under the silhouette. */
export function renderStalks(ctx: Ctx): string {
  const out: string[] = [];
  const w = Math.max(5, 0.1 * ctx.L.body.a);
  for (const e of ctx.L.eyes) {
    if (!e.stalkBase) continue;
    const b = e.stalkBase;
    const side = Math.sign(e.c.x - ctx.L.faceX) || 1;
    const mid = lerp(b, e.c, 0.5);
    const ctrl = { x: mid.x + side * 6, y: mid.y + 2 };
    const d = `M${f(b.x)} ${f(b.y)}Q${f(ctrl.x)} ${f(ctrl.y)} ${f(e.c.x)} ${f(e.c.y)}`;
    out.push(
      pathEl(d, {
        fill: 'none',
        stroke: ctx.P.outline,
        'stroke-width': w + SW.outline * 2,
        'stroke-linecap': 'round',
      }),
      pathEl(d, { fill: 'none', stroke: ctx.P.base, 'stroke-width': w, 'stroke-linecap': 'round' }),
      pathEl(d, {
        fill: 'none',
        stroke: ctx.P.light,
        'stroke-width': w * 0.35,
        'stroke-linecap': 'round',
        opacity: 0.6,
        transform: `translate(${f(-w * 0.2)} 0)`,
      }),
    );
    ctx.extend([b, { x: e.c.x - e.r, y: e.c.y - e.r }, { x: e.c.x + e.r, y: e.c.y + e.r }]);
  }
  return group('stalks', null, out.join(''));
}

export function renderEyes(ctx: Ctx): string {
  const look = lookFor(ctx);
  const eyes = ctx.L.eyes;
  const out: string[] = [];
  const single = eyes.length === 1;
  eyes.forEach((e, i) => {
    const side = single ? 0 : Math.sign(e.c.x - ctx.L.faceX) || (i === 0 ? -1 : 1);
    let svg: string;
    // happy and sleep close the eyes (sleep is the dot monsters' halted state; here it only shuts them)
    if (ctx.expr === 'happy' || ctx.expr === 'sleep') {
      svg = e.stalkBase
        ? circleEl(e.c, e.r, {
            fill: url(ctx, 'body'),
            stroke: ctx.P.outline,
            'stroke-width': eyeStroke(e.r),
          }) + closedEye(ctx, { c: { x: e.c.x, y: e.c.y + e.r * 0.15 }, r: e.r * 0.85 })
        : closedEye(ctx, e);
    } else {
      svg = openEye(ctx, e, look, ctx.expr === 'error');
      // the top eye of a trio sits too high for a brow
      const browable = !(eyes.length === 3 && i === 2);
      let brows = '';
      if (browable && ctx.expr === 'error') {
        brows = single ? brow(ctx, e, 1, 0, 2) : brow(ctx, e, side, 1, 1);
      }
      if (browable && ctx.expr === 'think' && (side * thinkSide(ctx) >= 0 || single)) {
        brows = brow(ctx, e, thinkSide(ctx), -0.5, 4);
      }
      if (browable && ctx.expr === 'talk' && e.stalkBase) {
        // stalk eyes have no face around them: a lifted brow keeps them lively
        brows = brow(ctx, e, side, -0.25, 3);
      }
      if (brows) svg += `<g class="m-brow">${brows}</g>`;
    }
    out.push(group(`eye${i}`, e.c, svg));
  });
  return group('eyes', null, out.join(''));
}
