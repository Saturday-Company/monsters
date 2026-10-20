import { contrast, parseColor, rgbToOklch, toHex, withLightness, type Rgb } from './color.ts';

/*
 * The colour of a brand as "light" on a screen of the instrument (D-063,
 * docs/design.md): the mark is graphics, so ≥ 3:1 on the black of the screens
 * (`--screen`, the same object in both themes). Bright brands keep their
 * colour; dark saturated ones are lifted in OKLCH lightness, keeping the hue;
 * black or grey marks (GitHub, Notion, Vercel) take the screen's own light.
 */

/** `--screen` in the light and in the dark theme. */
export const SCREEN_COLORS = ['#0d0d0c', '#050505'] as const;
/** `--screen-ink`. */
export const SCREEN_INK = '#efe9dc';
/** Well over 3:1: small marks on a black screen need more light than the minimum. */
export const BRAND_MIN_CONTRAST = 3.8;

const rgb = (hex: string): Rgb => {
  const c = parseColor(hex.startsWith('#') ? hex : `#${hex}`);
  if (!c) throw new Error(`bad colour ${hex}`);
  return c;
};

export function screenContrast(hex: string): number {
  return Math.min(...SCREEN_COLORS.map((s) => contrast(rgb(hex), rgb(s))));
}

export function brandLight(hex: string): string {
  const c = rgb(hex);
  if (screenContrast(toHex(c)) >= BRAND_MIN_CONTRAST) return toHex(c);
  const o = rgbToOklch(c);
  if (o.c < 0.04) return SCREEN_INK;
  for (let l = o.l; l <= 0.98; l += 0.01) {
    const lifted = toHex(withLightness(c, l));
    if (screenContrast(lifted) >= BRAND_MIN_CONTRAST) return lifted;
  }
  return SCREEN_INK;
}
