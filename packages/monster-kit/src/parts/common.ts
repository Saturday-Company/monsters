import type { Expression, MonsterGenome } from '../genome.ts';
import { type Box, type Pt, f } from '../geometry.ts';
import type { Layout } from '../layout.ts';
import type { MonsterPalette } from '../palette.ts';
import type { Rng } from '../random.ts';

/** Stroke widths in viewBox units (viewBox is 200×200). See STYLE.md. */
export const SW = {
  /** Silhouette of body and attached parts. */
  outline: 3.8,
  /** Eyes, mouth, inner details. */
  detail: 3,
  /** Teeth, claws, small marks. */
  fine: 1.8,
} as const;

export interface Ctx {
  g: MonsterGenome;
  L: Layout;
  P: MonsterPalette;
  expr: Expression;
  rng: Rng;
  /** Namespaced id for defs (gradients, clip paths). */
  id: (name: string) => string;
  /** Registers drawn geometry so the renderer can keep everything inside the viewBox. */
  extend(pts: readonly Pt[] | Box): void;
}

/** Side the monster thinks toward (bubbles, gaze): away from the tail, which always sits right. */
export const thinkSide = (ctx: Ctx): number => (ctx.g.tail ? -1 : 1);

export const url = (ctx: Ctx, name: string): string => `url(#${ctx.id(name)})`;

export const attrs = (a: Record<string, string | number | undefined>): string =>
  Object.entries(a)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${typeof v === 'number' ? f(v) : v}"`)
    .join(' ');

export const pathEl = (d: string, a: Record<string, string | number | undefined>): string =>
  `<path d="${d}" ${attrs(a)}/>`;

export const circleEl = (
  c: Pt,
  r: number,
  a: Record<string, string | number | undefined>,
): string => `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}" ${attrs(a)}/>`;

export const ellipseEl = (
  c: Pt,
  rx: number,
  ry: number,
  a: Record<string, string | number | undefined>,
  rotate = 0,
): string =>
  `<ellipse cx="${f(c.x)}" cy="${f(c.y)}" rx="${f(rx)}" ry="${f(ry)}"${
    rotate ? ` transform="rotate(${f(rotate)} ${f(c.x)} ${f(c.y)})"` : ''
  } ${attrs(a)}/>`;

/** A group tagged for animation: class `m-<slot>` and a pivot usable as transform-origin. */
export const group = (slot: string, pivot: Pt | null, body: string, extra = ''): string =>
  body
    ? `<g class="m-${slot}"${
        pivot
          ? ` data-pivot="${f(pivot.x)} ${f(pivot.y)}" style="transform-origin:${f(pivot.x)}px ${f(pivot.y)}px"`
          : ''
      }${extra}>${body}</g>`
    : '';

export const outlined = (ctx: Ctx, d: string, fill: string, sw: number = SW.outline): string =>
  pathEl(d, { fill, stroke: ctx.P.outline, 'stroke-width': sw, 'stroke-linejoin': 'round' });
