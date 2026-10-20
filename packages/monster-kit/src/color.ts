/**
 * OKLCH helpers. Every monster colour is derived from one hue in OKLCH and
 * converted to sRGB hex (gamut-mapped by reducing chroma) for the SVG.
 */

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function oklchToLinearSrgb({ l, c, h }: Oklch): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

const inGamut = (rgb: [number, number, number]): boolean =>
  rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

function encode(v: number): number {
  const x = clamp(v, 0, 1);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}

/** Converts OKLCH to an sRGB hex string, reducing chroma until the colour fits the gamut. */
export function oklchToHex(color: Oklch): string {
  const l = clamp(color.l, 0, 1);
  const h = ((color.h % 360) + 360) % 360;
  let c = Math.max(0, color.c);
  let rgb = oklchToLinearSrgb({ l, c, h });
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinearSrgb({ l, c: mid, h }))) lo = mid;
      else hi = mid;
    }
    c = lo;
    rgb = oklchToLinearSrgb({ l, c, h });
  }
  return (
    '#' +
    rgb
      .map((v) =>
        Math.round(encode(v) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

export const hex = (l: number, c: number, h: number): string => oklchToHex({ l, c, h });

/** Largest chroma that stays inside sRGB at this lightness and hue. */
export function maxChroma(l: number, h: number): number {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinearSrgb({ l, c: mid, h: ((h % 360) + 360) % 360 }))) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Smallest angular distance between two hues, in degrees (0–180). */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}
