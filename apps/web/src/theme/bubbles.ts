import {
  composite,
  contrast,
  parseColor,
  rgbToOklch,
  oklchToRgb,
  toHex,
  type Rgb,
} from '../lib/color.ts';
import { THEMES, type ThemeName } from './tokens.ts';

/** Minimum contrast we aim for (WCAG AA is 4.5; a little margin for rounding). */
export const TARGET_CONTRAST = 4.6;

/** How much of the monster's colour tints its bubble over `--raised` (docs/design.md, 7-9%). */
export const BUBBLE_TINT: Record<ThemeName, number> = { light: 0.08, dark: 0.09 };

export interface BubbleColors {
  /** Fill of the bubble: a light tint of the monster's colour over `--raised`. */
  bg: string;
  /** Text colour: the theme's ink. */
  fg: string;
  /** Background of code and note chips inside the bubble. */
  codeBg: string;
  contrast: number;
}

const FALLBACK: Rgb = { r: 150, g: 140, b: 200 };

const cache = new Map<string, BubbleColors>();

/**
 * Colours of a monster's chat bubble: the monster's colour at `BUBBLE_TINT`
 * over `--raised`, with the theme's ink on it. The identity of the monster is
 * in the avatar and the name; the tint only hints at it. Should a colour ever
 * bring the text under 4.5:1, the tint is thinned until it does not.
 */
export function bubbleColors(agentColor: string, theme: ThemeName): BubbleColors {
  const key = `${agentColor}|${theme}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const t = THEMES[theme];
  const base = parseColor(agentColor) ?? { ...FALLBACK, a: 1 };
  const content = parseColor(t.raised)!;
  const ink = parseColor(t.ink)!;
  let alpha = BUBBLE_TINT[theme];
  let bg = composite({ ...base, a: alpha }, content);
  let ratio = contrast(ink, bg);
  while (ratio < TARGET_CONTRAST && alpha > 0) {
    alpha = Math.max(0, alpha - 0.02);
    bg = composite({ ...base, a: alpha }, content);
    ratio = contrast(ink, bg);
  }
  const codeBg = composite(parseColor(t.fill)!, bg);
  const out = { bg: toHex(bg), fg: t.ink, codeBg: toHex(codeBg), contrast: ratio };
  cache.set(key, out);
  return out;
}

function shade(c: Rgb, l: number, chromaScale: number): Rgb {
  const o = rgbToOklch(c);
  return oklchToRgb({ l, c: Math.min(o.c * chromaScale, 0.09), h: o.h });
}

/** A readable ink for small accents (icons, tags) coloured like the agent, on the surfaces. */
export function accentInk(agentColor: string, theme: ThemeName): string {
  const base = parseColor(agentColor) ?? { ...FALLBACK, a: 1 };
  return toHex(shade(base, theme === 'dark' ? 0.86 : 0.42, 1.2));
}
