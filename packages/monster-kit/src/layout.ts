import { type BodyGeometry, GROUND_Y, buildBody } from './body.ts';
import type { MonsterGenome } from './genome.ts';
import { type Box, type Pt, add, circleBox, dirFromUp, mul } from './geometry.ts';
import { mouthEnvelope } from './parts/mouth.ts';

/**
 * Resolves a genome into absolute positions: body, face, anchors of every slot.
 * All collision avoidance lives here, so parts can draw blindly.
 */

export interface EyeSpot {
  c: Pt;
  r: number;
  /** For stalk eyes: where the stalk leaves the body. */
  stalkBase?: Pt;
}

export interface Layout {
  body: BodyGeometry;
  /** Total body height. */
  H: number;
  /** Horizontal centre of the face. */
  faceX: number;
  eyes: EyeSpot[];
  /** Mouth: centre of its top edge, width and the maximum height it may open to. */
  mouth: { c: Pt; w: number; maxW: number; maxH: number };
  hornAngles: number[];
  earAngles: number[];
  stalkAngles: number[];
  shoulders: [Pt, Pt];
  feet: { l: Pt; r: Pt; rx: number; ry: number } | null;
  belly: { c: Pt; rx: number; ry: number } | null;
  /** Face boxes used by tests and by mark placement. */
  boxes: { eyes: Box[]; mouth: Box; face: Box };
  /** Pivots for future animation, keyed by slot. */
  pivots: Record<string, Pt>;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** Minimum gap between a mouth and the belly edge. */
const BELLY_MARGIN = 3.5;

export function layoutMonster(g: MonsterGenome): Layout {
  const footRy = g.feet === 'none' ? 0 : 9.5 * g.body.w;
  const lift = g.feet === 'none' ? 0 : footRy * 0.95;
  const body = buildBody(g, lift);
  const { a, top, bottom } = body;
  const H = bottom - top;
  const yAt = (v: number): number => top + v * H;
  const half = (y: number): { cx: number; hw: number } => {
    const s = body.span(y);
    return { cx: (s.x0 + s.x1) / 2, hw: (s.x1 - s.x0) / 2 };
  };

  // ---- eyes -------------------------------------------------------------
  const eyes: EyeSpot[] = [];
  const size = g.eyes.size;
  let faceX = half(yAt(0.4)).cx;
  let eyeBottom = yAt(0.28);
  const stalkAngles: number[] = [];

  const fitPair = (
    v: number,
    r0: number,
    dx0: number,
  ): { y: number; r: number; dx: number; cx: number } => {
    let r = r0;
    let dx = dx0;
    let y = yAt(v);
    for (let i = 0; i < 12; i++) {
      const hTop = half(y - r * 0.75);
      const hMid = half(y);
      const room = Math.min(hTop.hw - 5, hMid.hw - 7);
      if (dx + r <= room && y - r >= top + 7) break;
      const k = clamp(room / (dx + r), 0.7, 0.97);
      r *= k;
      dx *= k;
      y += 1.2;
    }
    return { y, r, dx, cx: half(y).cx };
  };

  switch (g.eyes.kind) {
    case 'round': {
      const p = fitPair(0.34, 0.205 * a * size, 0.37 * a * g.eyes.spacing + 0.08 * a * (size - 1));
      const big = 1 + 0.22 * g.eyes.asym;
      const small = 1 - 0.1 * g.eyes.asym;
      eyes.push({ c: { x: p.cx - p.dx, y: p.y }, r: p.r * small });
      eyes.push({ c: { x: p.cx + p.dx, y: p.y - (big - 1) * p.r * 0.4 }, r: p.r * big });
      faceX = p.cx;
      eyeBottom = Math.max(...eyes.map((e) => e.c.y + e.r));
      break;
    }
    case 'cyclops': {
      let r = 0.36 * a * size;
      let y = yAt(0.38);
      for (let i = 0; i < 16; i++) {
        const room = Math.min(half(y - r * 0.6).hw - 4, half(y).hw - 6);
        if (r <= room && y - r >= top + 6) break;
        if (y - r < top + 6 || half(y - r * 0.6).hw - 4 < r) y += 1.5;
        else r *= 0.95;
        if (i > 8) r *= 0.96;
      }
      faceX = half(y).cx;
      eyes.push({ c: { x: faceX, y }, r });
      eyeBottom = y + r;
      break;
    }
    case 'trio': {
      const p = fitPair(0.42, 0.165 * a * size, 0.4 * a * g.eyes.spacing);
      let rt = 0.185 * a * size;
      let yt = p.y - p.r - rt * 0.55;
      for (let i = 0; i < 12; i++) {
        const room = half(yt - rt * 0.6).hw - 6;
        if (rt <= room && yt - rt >= top + 6) break;
        rt *= 0.93;
        yt += 0.8;
      }
      faceX = p.cx;
      eyes.push({ c: { x: p.cx - p.dx, y: p.y }, r: p.r });
      eyes.push({ c: { x: p.cx + p.dx, y: p.y }, r: p.r });
      eyes.push({ c: { x: faceX, y: Math.min(yt, p.y - p.r - rt * 0.35) }, r: rt });
      eyeBottom = p.y + p.r;
      break;
    }
    case 'stalk': {
      const r = 0.25 * a * size;
      const spread = (g.topper ? 22 : 17) * g.eyes.spacing;
      for (const side of [-1, 1]) {
        const deg = side * spread;
        const base = body.anchor(deg).p;
        const dir = dirFromUp(side * (spread + 9));
        const len = 0.42 * a * (0.85 + 0.25 * size);
        const big = side === 1 ? 1 + 0.2 * g.eyes.asym : 1 - 0.08 * g.eyes.asym;
        eyes.push({
          c: add(base, mul(dir, len + r * 0.6)),
          r: r * big,
          stalkBase: add(base, mul(dir, -6)),
        });
        stalkAngles.push(deg);
      }
      faceX = half(yAt(0.3)).cx;
      eyeBottom = yAt(0.16);
      break;
    }
  }

  // ---- mouth ------------------------------------------------------------
  const kindW = { smile: 0.5, grin: 0.62, canyon: 0.98, tiny: 0.3 }[g.mouth.kind];
  let my = Math.max(yAt(g.eyes.kind === 'stalk' ? 0.4 : 0.57), eyeBottom + 7);
  if (g.eyes.kind === 'cyclops') my = Math.max(my, eyeBottom + 6);
  const mHalf = half(my + 4);
  const maxW = Math.max(14, 2 * (mHalf.hw - 11));
  // with the eyes up on stalks the mouth carries the whole face: make it a bit bigger
  const faceBoost = g.eyes.kind === 'stalk' ? 1.18 : 1;
  const mw = Math.min(kindW * a * g.mouth.width * faceBoost, maxW);
  let maxH = clamp(bottom - 14 - my, 6, mw * 0.62);
  const mouthC = { x: mHalf.cx, y: my };

  // ---- head accessories ---------------------------------------------------
  const hornAngles: number[] = [];
  if (g.horns) {
    if (g.horns.kind === 'nubs') {
      const n = g.horns.count;
      const span = g.topper || stalkAngles.length ? 58 : 34 + 4 * n;
      const gap = g.topper || stalkAngles.length ? 14 : 0;
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        let deg = -span + 2 * span * t;
        if (gap && Math.abs(deg) < gap) deg = Math.sign(deg || 1) * gap;
        hornAngles.push(deg);
      }
    } else {
      const base = g.horns.kind === 'curved' ? 36 : 30;
      const deg = stalkAngles.length ? Math.max(base, 44) : base;
      hornAngles.push(-deg, deg);
    }
  }
  const earAngles: number[] = [];
  if (g.ears) {
    let deg = {
      long: 20 + g.ears.spread * 36,
      round: 46 + g.ears.spread * 16,
      pointy: 36 + g.ears.spread * 22,
      fin: 70 + g.ears.spread * 12,
    }[g.ears.kind];
    if ((g.horns || stalkAngles.length) && g.ears.kind !== 'fin')
      deg = Math.max(deg, g.ears.kind === 'long' ? (stalkAngles.length ? 62 : 56) : 60);
    earAngles.push(-deg, deg);
  }

  // ---- limbs ------------------------------------------------------------
  const shoulderY = yAt(0.6);
  const sh = body.span(shoulderY);
  const inset = 0.1 * a;
  const shoulders: [Pt, Pt] = [
    { x: sh.x0 + inset, y: shoulderY },
    { x: sh.x1 - inset, y: shoulderY },
  ];

  const footRx = 0.29 * a;
  const footY = GROUND_Y - footRy * 0.92;
  const footDx = Math.min(0.44 * a, half(bottom - 6).hw - footRx * 0.4);
  const feet =
    g.feet === 'none'
      ? null
      : {
          l: { x: half(bottom - 4).cx - footDx, y: footY },
          r: { x: half(bottom - 4).cx + footDx, y: footY },
          rx: footRx,
          ry: footRy,
        };

  // ---- belly ------------------------------------------------------------
  // The mouth must sit cleanly on the belly: either wholly inside it (with a margin) or wholly
  // above it. A belly edge running through the mouth corners looks glued on.
  let belly: Layout['belly'] = null;
  if (g.palette.belly !== 'none') {
    const env = mouthEnvelope(g.mouth.kind, { c: mouthC, w: mw, maxW, maxH }, a);
    const bottomB = yAt(1.03);
    const by = yAt(0.73);
    const bh = half(by);
    const base = { c: { x: bh.cx, y: by }, rx: bh.hw * 0.66, ry: H * 0.3 };
    const fits = (b: { c: Pt; rx: number; ry: number }): boolean =>
      env.every(
        (p) =>
          ((p.x - b.c.x) / (b.rx - BELLY_MARGIN)) ** 2 +
            ((p.y - b.c.y) / (b.ry - BELLY_MARGIN)) ** 2 <=
          1,
      );
    const topLimit = g.eyes.kind === 'stalk' ? yAt(0.14) : eyeBottom - 1;
    let best: Layout['belly'] = fits(base) ? base : null;
    // grow the belly upwards and sideways, least change first
    for (let cost = 1; !best && cost <= 40; cost++) {
      for (let i = 0; i <= cost && !best; i++) {
        const j = cost - i;
        const ry = H * (0.3 + 0.015 * i);
        const cy = bottomB - ry;
        if (cy - ry < topLimit) continue;
        const hw = half(cy).hw;
        const rx = bh.hw * 0.66 * (1 + 0.025 * j);
        if (rx > hw * 0.9) continue;
        const cand = { c: { x: half(cy).cx, y: cy }, rx, ry };
        if (fits(cand)) best = cand;
      }
    }
    if (!best) {
      // Too wide to contain without swallowing the eyes: keep the belly wholly below the mouth,
      // capping how deep the mouth may open so that a real belly patch is left underneath.
      maxH = Math.min(maxH, Math.max(0.22 * mw, yAt(0.8) - my - 0.12 * mw));
      const low = mouthEnvelope(g.mouth.kind, { c: mouthC, w: mw, maxW, maxH }, a);
      const top = Math.max(...low.map((p) => p.y)) + BELLY_MARGIN;
      const ry = (bottomB - top) / 2;
      const cy = bottomB - ry;
      best = ry > H * 0.08 ? { c: { x: half(cy).cx, y: cy }, rx: half(cy).hw * 0.7, ry } : null;
    }
    belly = best;
  }

  const eyeBoxes = eyes.map((e) => circleBox(e.c, e.r));
  const mouthBox: Box = { x0: mouthC.x - mw / 2, y0: my - 4, x1: mouthC.x + mw / 2, y1: my + maxH };
  const face: Box = {
    x0: Math.min(mouthBox.x0, ...eyeBoxes.map((b) => b.x0)),
    y0: Math.min(mouthBox.y0, ...eyeBoxes.map((b) => b.y0)),
    x1: Math.max(mouthBox.x1, ...eyeBoxes.map((b) => b.x1)),
    y1: mouthBox.y1,
  };

  return {
    body,
    H,
    faceX,
    eyes,
    mouth: { c: mouthC, w: mw, maxW, maxH },
    hornAngles,
    earAngles,
    stalkAngles,
    shoulders,
    feet,
    belly,
    boxes: { eyes: eyeBoxes, mouth: mouthBox, face },
    pivots: {
      root: { x: 100, y: GROUND_Y },
      body: { x: (body.left + body.right) / 2, y: bottom },
      armL: shoulders[0],
      armR: shoulders[1],
      tail: body.anchor(112).p,
      head: { x: faceX, y: top },
    },
  };
}
