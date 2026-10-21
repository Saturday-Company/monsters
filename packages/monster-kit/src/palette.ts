import { hex } from './color.ts';
import type { MonsterGenome } from './genome.ts';

/** All colours of one monster, derived from a single OKLCH hue (see docs/monsters/STYLE.md). */
export interface MonsterPalette {
  base: string;
  light: string;
  shade: string;
  outline: string;
  belly: string;
  bellyShade: string;
  mark: string;
  markRim: string;
  accent: string;
  accentLight: string;
  accentShade: string;
  spray: string;
  iris: string;
  irisDark: string;
  sclera: string;
  scleraShade: string;
  mouth: string;
  tongue: string;
  tooth: string;
  cheek: string;
  shadow: string;
  highlight: string;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const IRIS: Record<MonsterGenome['eyes']['iris'], (h: number) => [number, number, number]> = {
  complement: (h) => [0.6, 0.13, h + 180],
  amber: () => [0.68, 0.15, 62],
  brown: () => [0.5, 0.09, 48],
  teal: () => [0.62, 0.11, 200],
  violet: () => [0.55, 0.15, 300],
  green: () => [0.63, 0.15, 145],
};

export function derivePalette(
  g: MonsterGenome,
  opts: { desaturate?: boolean } = {},
): MonsterPalette {
  const h = g.palette.hue;
  const c = g.palette.chroma * (opts.desaturate ? 0.55 : 1);
  const l = g.palette.lightness;

  // Belly: same hue and much lighter, or a soft contrasting hue.
  const bellyHue = g.palette.belly === 'contrast' ? h + 55 : h;
  const bellyL = clamp(l + (g.palette.belly === 'contrast' ? 0.14 : 0.16), 0.8, 0.95);
  const bellyC = g.palette.belly === 'contrast' ? Math.min(0.11, c * 0.9) : c * 0.42;

  const accent: [number, number, number] = (() => {
    switch (g.palette.accent) {
      case 'cream':
        return [0.93, 0.05, 88];
      case 'gold':
        return [0.84, 0.14, 82];
      case 'analogous':
        return [clamp(l + 0.06, 0.6, 0.88), Math.max(c, 0.12), h + 38];
      case 'complement':
        return [clamp(l + 0.04, 0.6, 0.86), Math.max(c, 0.12), h + 180];
      case 'tone':
        return [clamp(l + 0.12, 0.7, 0.92), c * 0.7, h];
    }
  })();
  const [al, ac, ah] = accent;
  const [il, ic, ih] = IRIS[g.eyes.iris](h);

  return {
    base: hex(l, c, h),
    light: hex(clamp(l + 0.09, 0, 0.96), c * 0.92, h - 6),
    shade: hex(l - 0.16, c * 1.08, h + 6),
    outline: hex(clamp(l - 0.47, 0.22, 0.3), Math.min(c * 0.75, 0.085), h + 4),
    belly: hex(bellyL, bellyC, bellyHue),
    bellyShade: hex(bellyL - 0.13, bellyC * 1.7, bellyHue),
    mark: hex(l - 0.17, c * 1.05, h + 8),
    markRim: hex(clamp(l + 0.06, 0, 0.95), c * 0.8, h),
    accent: hex(al, ac, ah),
    accentLight: hex(clamp(al + 0.07, 0, 0.98), ac * 0.75, ah),
    accentShade: hex(al - 0.13, ac * 1.05, ah + 6),
    spray: hex(0.96, 0.035, h),
    iris: hex(il, ic, ih),
    irisDark: hex(il - 0.2, ic * 0.9, ih),
    sclera: '#ffffff',
    scleraShade: hex(0.9, 0.012, h),
    mouth: hex(0.33, 0.11, 18),
    tongue: hex(0.72, 0.13, 8),
    tooth: '#ffffff',
    cheek: hex(0.72, 0.14, 15),
    shadow: hex(0.32, 0.04, 290),
    highlight: '#ffffff',
  };
}
