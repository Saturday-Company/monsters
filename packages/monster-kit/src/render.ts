import { GROUND_Y } from './body.ts';
import { type Expression, type MonsterGenomeInput, parseGenome } from './genome.ts';
import { type Box, type Pt, boxOf, f } from './geometry.ts';
import { layoutMonster } from './layout.ts';
import { derivePalette } from './palette.ts';
import { type Ctx, SW, circleEl, ellipseEl, group, pathEl, thinkSide } from './parts/common.ts';
import { renderEyes, renderStalks } from './parts/eyes.ts';
import { renderEars, renderHorns, renderTopper } from './parts/head.ts';
import { renderArms, renderFeet } from './parts/limbs.ts';
import { renderBelly, renderHighlight, renderMarks } from './parts/marks.ts';
import { renderCheeks, renderMouth } from './parts/mouth.ts';
import { renderTail } from './parts/tail.ts';
import { createRng, hashString } from './random.ts';

export interface RenderOptions {
  expression?: Expression;
  /** Width and height in px of the <svg> element (viewBox is always 200×200). */
  size?: number;
  /** Prefix for ids inside the SVG; set it when the same page shows the same monster twice. */
  idPrefix?: string;
  /** Accessible name; defaults to the genome id. */
  title?: string;
}

export const VIEWBOX = 200;
const MARGIN = 5;

/** Renders a monster as a self-contained SVG string. Throws only if the genome is invalid. */
export function renderMonster(genomeInput: MonsterGenomeInput, opts: RenderOptions = {}): string {
  const g = parseGenome(genomeInput);
  const expr: Expression = opts.expression ?? 'idle';
  const L = layoutMonster(g);
  const P = derivePalette(g, { desaturate: expr === 'error' });
  const prefix = opts.idPrefix ?? `m${hashString(`${g.id}:${g.seed}:${expr}`).toString(36)}`;
  const extents: Pt[] = [...L.body.outline];
  const ctx: Ctx = {
    g,
    L,
    P,
    expr,
    rng: createRng(g.seed ^ 0x51ed270b),
    id: (name) => `${prefix}-${name}`,
    extend: (pts) => {
      if (Array.isArray(pts)) extents.push(...(pts as Pt[]));
      else {
        const b = pts as Box;
        extents.push({ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 });
      }
    },
  };
  const id = ctx.id;
  const body = L.body;

  const defs =
    `<defs>` +
    `<radialGradient id="${id('body')}" cx="0.4" cy="0.32" r="0.78" fx="0.34" fy="0.24">` +
    `<stop offset="0" stop-color="${P.light}"/><stop offset="0.55" stop-color="${P.base}"/><stop offset="1" stop-color="${P.shade}"/></radialGradient>` +
    `<radialGradient id="${id('acc')}" cx="0.38" cy="0.3" r="0.8">` +
    `<stop offset="0" stop-color="${P.accentLight}"/><stop offset="0.6" stop-color="${P.accent}"/><stop offset="1" stop-color="${P.accentShade}"/></radialGradient>` +
    `<radialGradient id="${id('scl')}" cx="0.42" cy="0.36" r="0.7">` +
    `<stop offset="0.6" stop-color="${P.sclera}"/><stop offset="1" stop-color="${P.scleraShade}"/></radialGradient>` +
    `<radialGradient id="${id('iris')}" cx="0.5" cy="0.4" r="0.6">` +
    `<stop offset="0.25" stop-color="${P.iris}"/><stop offset="1" stop-color="${P.irisDark}"/></radialGradient>` +
    `<path id="${id('shape')}" d="${body.path}"/>` +
    `<clipPath id="${id('clip')}"><use href="#${id('shape')}"/></clipPath>` +
    `</defs>`;

  // back to front
  const tail = renderTail(ctx);
  const ears = renderEars(ctx);
  const horns = renderHorns(ctx);
  const topper = renderTopper(ctx);
  const stalks = renderStalks(ctx);
  const feet = renderFeet(ctx);
  const torso = group(
    'torso',
    L.pivots.body ?? null,
    `<use href="#${id('shape')}" fill="url(#${id('body')})"/>` +
      `<g clip-path="url(#${id('clip')})">${renderBelly(ctx)}${renderMarks(ctx)}${renderHighlight(ctx)}</g>` +
      `<use href="#${id('shape')}" fill="none" stroke="${P.outline}" stroke-width="${SW.outline}" stroke-linejoin="round"/>`,
  );
  const arms = renderArms(ctx);
  const face = group(
    'face',
    L.pivots.head ?? null,
    renderMouth(ctx) + renderCheeks(ctx) + renderEyes(ctx),
  );
  const fx = renderFx(ctx);

  // Fit everything inside the viewBox, scaling around the ground point if needed.
  const box = boxOf(extents);
  const groundShadowRx = Math.min(90, (body.right - body.left) * 0.52 + 6);
  const sx = Math.min(
    1,
    (100 - MARGIN) / Math.max(1, 100 - box.x0),
    (100 - MARGIN) / Math.max(1, box.x1 - 100),
  );
  const sy = Math.min(1, (GROUND_Y - MARGIN) / Math.max(1, GROUND_Y - box.y0));
  const s = Math.min(sx, sy);
  const fit =
    s < 0.999
      ? ` transform="translate(100 ${GROUND_Y}) scale(${s.toFixed(3)}) translate(-100 -${GROUND_Y})"`
      : '';

  const shadowC = { x: (body.left + body.right) / 2, y: GROUND_Y + 2 };
  const shadow = `<g class="m-shadow" style="transform-origin:${f(shadowC.x)}px ${f(shadowC.y)}px">${ellipseEl(
    shadowC,
    groundShadowRx,
    7,
    {
      fill: P.shadow,
      opacity: 0.2,
    },
  )}</g>`;

  const size = opts.size ?? VIEWBOX;
  const title = escapeXml(opts.title ?? g.id);
  // Everything that stands on the ground breathes together: `m-body` pivots on the feet, so the
  // feet barely move while the head rises. The shadow stays outside so it can shrink on a hop.
  const figure =
    `<g class="m-body" style="transform-origin:${f(L.pivots.body?.x ?? 100)}px ${GROUND_Y}px">` +
    tail +
    ears +
    horns +
    topper +
    stalks +
    feet +
    arms +
    torso +
    face +
    fx +
    `</g>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" width="${f(size)}" height="${f(size)}" role="img" aria-label="${title}" data-monster="${escapeXml(g.id)}" data-expression="${expr}" style="${personalityStyle(g)}">` +
    defs +
    // no transform-origin here: browsers would apply it to the fit transform as well
    `<g class="m-root"${fit}>` +
    shadow +
    figure +
    `</g></svg>`
  );
}

function renderFx(ctx: Ctx): string {
  const { body, H } = ctx.L;
  const a = body.a;
  if (ctx.expr === 'think') {
    const side = thinkSide(ctx);
    const x = side > 0 ? body.right - 0.05 * a : body.left + 0.05 * a;
    const y = body.top + 0.08 * H;
    const dots = [
      { c: { x: x + side * 4, y: y + 2 }, r: 2.6 },
      { c: { x: x + side * 11, y: y - 6 }, r: 3.6 },
      { c: { x: x + side * 20, y: y - 17 }, r: 5 },
    ];
    ctx.extend(dots.flatMap((d) => [{ x: d.c.x + side * (d.r + 2), y: d.c.y - d.r - 2 }]));
    return group(
      'fx',
      null,
      dots
        .map((d) =>
          circleEl(d.c, d.r, {
            fill: '#ffffff',
            stroke: ctx.P.outline,
            'stroke-width': SW.fine + 0.2,
          }),
        )
        .join(''),
    );
  }
  if (ctx.expr === 'error') {
    // the sweat drop goes on the side away from the tail, like the thought bubbles
    const x = thinkSide(ctx) > 0 ? body.right - 0.12 * a : body.left + 0.12 * a;
    const y = body.top + 0.2 * H;
    const s = 5.5;
    const d =
      `M${f(x)} ${f(y - 1.6 * s)}C${f(x + 0.35 * s)} ${f(y - 0.9 * s)} ${f(x + s)} ${f(y - 0.35 * s)} ${f(x + s)} ${f(y + 0.25 * s)}` +
      `A${f(s)} ${f(s)} 0 0 1 ${f(x - s)} ${f(y + 0.25 * s)}C${f(x - s)} ${f(y - 0.35 * s)} ${f(x - 0.35 * s)} ${f(y - 0.9 * s)} ${f(x)} ${f(y - 1.6 * s)}Z`;
    ctx.extend([
      { x: x + s + 2, y: y - 1.6 * s - 2 },
      { x: x - s - 2, y: y + s },
    ]);
    return group(
      'fx',
      null,
      pathEl(d, {
        fill: '#cdeeff',
        stroke: ctx.P.outline,
        'stroke-width': SW.fine + 0.2,
        'stroke-linejoin': 'round',
      }) + circleEl({ x: x - 0.35 * s, y: y + 0.1 * s }, 1.3, { fill: '#ffffff' }),
    );
  }
  return '';
}

/**
 * CSS custom properties read by `monsterCss`: personality (0–1) and a per-monster phase so that
 * several monsters on one page never blink or breathe in sync.
 */
function personalityStyle(g: ReturnType<typeof parseGenome>): string {
  const phase = ((g.seed % 9973) / 9973) * 7;
  return `--m-bounce:${g.personality.bounce.toFixed(2)};--m-speed:${g.personality.speed.toFixed(2)};--m-phase:-${phase.toFixed(2)}s`;
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c,
  );
}
