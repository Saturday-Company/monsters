/*
 * Small colour toolkit for the UI: parsing CSS colours, WCAG contrast, OKLCH
 * adjustments and alpha compositing. Used by the bubbles (agent colours) and by
 * the automatic contrast test.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  a: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()` and `oklch()`; returns null when unknown. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = [...hex].map((c) => parseInt(c + c, 16));
      return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: a === undefined ? 1 : a / 255 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
      return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
    }
    return null;
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(s)?.[1];
  if (rgb) {
    const parts = rgb.split(/[\s,/]+/).filter(Boolean);
    const num = (p: string | undefined, max: number) =>
      p === undefined ? 1 : p.endsWith('%') ? (parseFloat(p) / 100) * max : parseFloat(p);
    return {
      r: num(parts[0], 255),
      g: num(parts[1], 255),
      b: num(parts[2], 255),
      a: parts[3] === undefined ? 1 : num(parts[3], 1),
    };
  }
  const ok = /^oklch\(([^)]+)\)$/.exec(s)?.[1];
  if (ok) {
    const parts = ok.split(/[\s,/]+/).filter(Boolean);
    const l = parts[0]?.endsWith('%') ? parseFloat(parts[0]) / 100 : parseFloat(parts[0] ?? '0');
    const c = parseFloat(parts[1] ?? '0');
    const h = parseFloat(parts[2] ?? '0');
    const a =
      parts[3] === undefined ? 1 : parseFloat(parts[3]) / (parts[3].endsWith('%') ? 100 : 1);
    return { ...oklchToRgb({ l, c, h }), a };
  }
  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  const h = (v: number) =>
    Math.round(clamp(v, 0, 255))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

const toLinear = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number): number => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return clamp(c * 255, 0, 255);
};

/** WCAG 2 relative luminance. */
export function luminance(c: Rgb): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** WCAG 2 contrast ratio between two opaque colours (1–21). */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Paints `top` (with its alpha) over an opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgb): Rgb {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
  };
}

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

export function rgbToOklch(c: Rgb): Oklch {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

/** OKLCH → sRGB, reducing chroma until the colour fits the gamut. */
export function oklchToRgb(color: Oklch): Rgb {
  let c = color.c;
  for (let i = 0; i < 24; i++) {
    const lin = oklchToLinear({ ...color, c });
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) {
      return { r: fromLinear(lin[0]), g: fromLinear(lin[1]), b: fromLinear(lin[2]) };
    }
    c *= 0.88;
  }
  const lin = oklchToLinear({ ...color, c: 0 });
  return { r: fromLinear(lin[0]), g: fromLinear(lin[1]), b: fromLinear(lin[2]) };
}

/** Same hue and chroma at a different OKLCH lightness. */
export function withLightness(c: Rgb, l: number): Rgb {
  const o = rgbToOklch(c);
  return oklchToRgb({ ...o, l: clamp(l, 0, 1) });
}
