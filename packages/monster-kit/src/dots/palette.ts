import { maxChroma, oklchToHex } from '../color.ts';
import type { MonsterGenome } from '../genome.ts';

/** LED colours of one monster on the black screen. */
export interface DotPalette {
  /** Full-light dots: the body. */
  lit: string;
  /** Half-light dots: belly, marks, inner ears, shading. */
  dim: string;
  /** Second colour: horns, crests, claws, stripes (from `palette.accent`). */
  accent: string;
  accentDim: string;
  /** Belly: a pale tint of the body (`light`) or a neighbouring hue (`contrast`). */
  belly: string;
  /** Pink blush (happy). */
  cheek: string;
}

/** The screen the dots sit on. */
export const DOT_SCREEN = '#0d0d0c';
/** An LED that is off. */
export const DOT_OFF = 'rgba(255,255,255,.07)';
export const DOT_GLINT = '#ffffff';
/** Minimum contrast of every light colour on the screen. */
export const DOT_MIN_CONTRAST = 3;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = ch;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** OKLCH → hex, raising the lightness until the colour reaches 3:1 on the screen. */
function led(l: number, c: number, h: number): string {
  let L = l;
  let out = oklchToHex({ l: L, c, h });
  while (contrastRatio(out, DOT_SCREEN) < DOT_MIN_CONTRAST + 0.15 && L < 0.98) {
    L += 0.01;
    out = oklchToHex({ l: L, c, h });
  }
  return out;
}

/**
 * LED colours from the genome. The body light is bright and saturated whatever the glossy
 * lightness was (a dark monster is still a lit LED): L from 0.78, C up to 0.22. Where the
 * screen cannot show that chroma (yellows, limes) the light climbs towards the hue's most
 * colourful lightness instead of turning olive.
 */
export function dotPalette(g: MonsterGenome): DotPalette {
  const { hue, chroma, lightness } = g.palette;
  let L = 0.78 + (clamp(lightness, 0.45, 0.85) - 0.45) * 0.1;
  const C = clamp(chroma * 1.35 + 0.03, 0.11, 0.22);
  while (L < 0.91 && maxChroma(L, hue) < C && maxChroma(L + 0.01, hue) > maxChroma(L, hue))
    L += 0.01;
  const lit = led(L, C, hue);
  const dim = led(0.55, C * 0.8, hue);

  let acc: { l: number; c: number; h: number };
  switch (g.palette.accent) {
    case 'cream':
      acc = { l: 0.93, c: 0.05, h: 88 };
      break;
    case 'gold':
      acc = { l: 0.87, c: 0.17, h: 82 };
      break;
    case 'analogous':
      acc = { l: L + 0.02, c: Math.max(C, 0.12), h: hue + 38 };
      break;
    case 'complement':
      acc = { l: L + 0.02, c: Math.max(C, 0.12), h: hue + 180 };
      break;
    case 'tone':
      acc = { l: 0.94, c: C * 0.45, h: hue };
      break;
  }
  const accent = led(acc.l, acc.c, acc.h);
  const accentDim = led(0.6, acc.c * 0.8, acc.h);
  const belly =
    g.palette.belly === 'contrast'
      ? led(Math.min(0.9, L + 0.06), 0.11, hue + 55)
      : led(0.93, Math.min(0.06, C * 0.4), hue);
  // pink cheeks; on a pink or red monster they turn paler so they still show
  const pinkish = Math.min(Math.abs(hue - 10), 360 - Math.abs(hue - 10)) < 35;
  const cheek = pinkish ? led(0.9, 0.08, 350) : led(0.72, 0.17, 8);
  return { lit, dim, accent, accentDim, belly, cheek };
}
