import type { Expression, MonsterGenome } from '../genome.ts';
import { createRng } from '../random.ts';
import { DOT_CX, DOT_GROUND, DOT_H, DOT_W, type DotCell, type DotGrid, isLight } from './grid.ts';

/**
 * The dot-matrix creature. `buildModel` turns a genome into a pixel layout (silhouette, face,
 * parts) once; `paintFrame` draws one frame of one expression on a fresh 17 × 15 grid.
 * Everything is integer and deterministic: same genome, same dots, on every platform.
 *
 * Art rules (see docs/monsters/STYLE.md, "Dot creatures"): a rounded silhouette with negative
 * space around it (arms and feet stand apart from the body), the face first (big eyes with a
 * white glint, a small mouth, white teeth), few half-lit dots.
 */

/** Frames per expression (frame 0 is the still image used when motion is off). */
export const DOT_FRAMES: Readonly<Record<Expression, number>> = {
  idle: 2,
  talk: 3,
  think: 3,
  happy: 2,
  error: 2,
  sleep: 3,
  confused: 3,
};

type Pt = readonly [number, number];
interface Span {
  x0: number;
  x1: number;
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Stalk {
  /** Top-left corner of the 4 × 4 eyeball, and the column of its stalk. */
  bx: number;
  by: number;
  sx: number;
}
type Shape = MonsterGenome['body']['shape'];
type MouthShape = 'smile' | 'grin' | 'canyon' | 'tiny';

interface Model {
  g: MonsterGenome;
  top: number;
  bottom: number;
  hb: number;
  spans: (Span | null)[];
  /** Face centre column. */
  fx: number;
  eyes: Box[];
  /** The cyclops eyeball: a white eye with a dark pupil. */
  eyeball: boolean;
  stalks: Stalk[];
  mouthY: number;
  /** Largest half-width the mouth may take on the mouth rows. */
  mouthMax: number;
  /** Rest half-width of the mouth. */
  mouthK: number;
  mouth: MouthShape;
  belly: Set<number>;
  /** Half-lit dots: a little shading on the lower right, and the marks. */
  shade: Map<number, DotCell>;
  /** Side of the thought dots / z's (away from the tail). */
  fxSide: -1 | 1;
  armY: number;
  /** Parts that sit on the head, already resolved (no collisions), in body coordinates. */
  head: [number, number, DotCell][];
  /** Tail cells. */
  tail: [number, number, DotCell][];
  feet: [number, number, DotCell][];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const key = (x: number, y: number): number => y * DOT_W + x;
const inGrid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < DOT_W && y < DOT_H;

/* ------------------------------------------------------------------ silhouette */

interface Profile {
  /** Where the body is widest (0 top, 1 bottom). */
  tm: number;
  /** Superellipse exponents above and below the widest row (2 = round, higher = boxier). */
  nT: number;
  nB: number;
}

const PROFILES: Record<Shape, Profile> = {
  blob: { tm: 0.5, nT: 2.2, nB: 2.6 },
  egg: { tm: 0.62, nT: 1.8, nB: 2.4 },
  pear: { tm: 0.72, nT: 2, nB: 3 },
  bean: { tm: 0.5, nT: 3.2, nB: 3.2 },
  dome: { tm: 0.7, nT: 2.3, nB: 7 },
  lumpy: { tm: 0.5, nT: 2.4, nB: 2.8 },
};

function profile(shape: Shape, t: number): number {
  const { tm, nT, nB } = PROFILES[shape];
  const u = t < tm ? (tm - t) / tm : (t - tm) / (1 - tm);
  const n = t < tm ? nT : nB;
  return Math.max(0, 1 - Math.min(1, u) ** n) ** (1 / n);
}

/** Half-widths from the genome: Titan (w 1.3) 6, most monsters 5, Mimas 4. */
const bodyHalf = (w: number): number => clamp(Math.round(3.4 + ((w - 0.7) / 0.6) * 3.1), 4, 6);
/** Body height in rows: 8 (small) to 11. */
const bodyRows = (h: number): number => clamp(Math.round(6.7 + ((h - 0.7) / 0.6) * 4.4), 8, 11);

/** Rows a head part needs above the body. */
function headNeed(g: MonsterGenome): number {
  let need = 0;
  if (g.eyes.kind === 'stalk') need = Math.max(need, 5);
  if (g.horns)
    need = Math.max(
      need,
      g.horns.kind === 'nubs' ? (g.horns.size >= 0.95 ? 2 : 1) : g.horns.kind === 'curved' ? 2 : 3,
    );
  if (g.ears && g.ears.kind !== 'fin')
    need = Math.max(
      need,
      g.ears.kind === 'long' ? clamp(Math.round(2 + 1.6 * g.ears.size), 3, 4) : 2,
    );
  if (g.topper)
    need = Math.max(need, g.topper.kind === 'antenna' || g.topper.kind === 'geyser' ? 3 : 2);
  return need;
}

function tailWidth(g: MonsterGenome): number {
  if (!g.tail) return 0;
  return g.tail.kind === 'plume' && g.tail.size >= 0.95 ? 4 : 3;
}

function buildSpans(
  g: MonsterGenome,
  cx: number,
  hw: number,
  top: number,
  hb: number,
): (Span | null)[] {
  const spans: (Span | null)[] = Array.from({ length: DOT_H }, () => null);
  const halves: number[] = [];
  for (let i = 0; i < hb; i++) {
    const t = (i + 0.5) / hb;
    halves.push(Math.max(1, Math.round(hw * profile(g.body.shape, t) - 0.1)));
  }
  // a round crown: the top row is 40–60% of the width, never a spike nor a flat lid
  halves[0] = clamp(halves[0] ?? 1, Math.round(hw * 0.4), Math.round(hw * 0.6));
  // monotonic up to the widest row, then down
  const widest = halves.indexOf(Math.max(...halves));
  for (let i = 1; i <= widest; i++) halves[i] = Math.max(halves[i] ?? 0, halves[i - 1] ?? 0);
  for (let i = hb - 2; i > widest; i--)
    halves[i] = Math.max(halves[i] ?? 0, Math.min(halves[i + 1] ?? 0, halves[i] ?? 0));
  // at most a two-dot step between neighbouring rows below the crown: no jagged shoulders
  for (let i = hb - 2; i >= 1; i--) {
    const below = halves[i + 1] ?? 0;
    if ((halves[i] ?? 0) < below - 2) halves[i] = below - 2;
  }
  // the bottom row tucks in, so the feet stand out from the body
  const last = hb - 1;
  halves[last] = Math.min(halves[last] ?? 1, Math.max(2, (halves[last - 1] ?? 2) - 1));
  for (let i = 0; i < hb; i++) {
    const t = (i + 0.5) / hb;
    const lean = Math.round(g.body.lean * 1.9 * (1 - t) ** 1.6);
    const h = halves[i] ?? 1;
    spans[top + i] = { x0: cx + lean - h, x1: cx + lean + h };
  }
  if (g.body.shape === 'lumpy') {
    // Hyperion: a potato. One shoulder bulges, the opposite hip too, the crown is lopsided;
    // the face stays on the smooth middle
    const r = createRng(g.seed ^ 0x51ed);
    const side = r.chance(0.5) ? -1 : 1;
    const grow = (y: number, sd: number, by: number) => {
      const s = spans[y];
      if (!s) return;
      if (sd < 0) s.x0 -= by;
      else s.x1 += by;
    };
    // an oblique oval: the upper half slides one way, the lower half the other
    for (let i = 0; i < hb; i++) {
      const t = (i + 0.5) / hb;
      const d = t < 0.3 ? 1 : t > 0.7 ? -1 : 0;
      const sp = spans[top + i];
      if (sp && d) {
        sp.x0 += d * side;
        sp.x1 += d * side;
      }
    }
    // and a round bump on the high shoulder
    grow(top + 1, side, 1);
    grow(top + 2, side, 1);
  }
  return spans;
}

const inBody = (m: { spans: (Span | null)[] }, x: number, y: number): boolean => {
  const s = m.spans[y];
  return !!s && x >= s.x0 && x <= s.x1;
};

/* ------------------------------------------------------------------ model */

export function buildModel(g: MonsterGenome): Model {
  const feet = g.feet !== 'none';
  const bottom = feet ? DOT_GROUND - 1 : DOT_GROUND;
  const need = headNeed(g);
  // a big cyclops eye needs a taller face
  const minRows = g.eyes.kind === 'cyclops' && g.eyes.size >= 1.15 ? 9 : 8;
  const rows =
    bodyRows(g.body.h) + (g.body.shape === 'dome' ? -1 : g.body.shape === 'bean' ? 1 : 0);
  const hb = Math.max(8, Math.min(Math.max(rows, minRows), bottom - need));
  const top = bottom - hb + 1;

  // a dome is squat and wide, a bean tall and narrow
  let hw = bodyHalf(g.body.w) + (g.body.shape === 'dome' ? 1 : g.body.shape === 'bean' ? -1 : 0);
  hw = clamp(hw, 4, 6);
  let cx = DOT_CX;
  const tw = tailWidth(g);
  if (tw > 0) {
    const room = DOT_W - 1 - (cx + hw);
    if (room < tw) cx -= tw - room;
    // arms need two free columns
    const minLeft = g.arms === 'none' ? 0 : 2;
    while (cx - hw < minLeft) hw -= 1;
  }
  const spans = buildSpans(g, cx, hw, top, hb);
  const spanAt = (y: number): Span => spans[y] ?? { x0: cx, x1: cx };

  /* ---- face ---- */
  const kind = g.eyes.kind;
  const eyesOnBody = kind !== 'stalk';
  const body = { spans };
  /** An eye must be wrapped in body light on all four sides. */
  const ringOk = (b: Box): boolean => {
    for (let i = b.x; i < b.x + b.w; i++)
      if (!inBody(body, i, b.y - 1) || !inBody(body, i, b.y + b.h)) return false;
    for (let j = b.y; j < b.y + b.h; j++)
      if (!inBody(body, b.x - 1, j) || !inBody(body, b.x + b.w, j)) return false;
    return true;
  };
  const centreOf = (y: number): number => {
    const s = spanAt(y);
    return Math.round((s.x0 + s.x1) / 2);
  };
  const halfAt = (y: number): number => {
    const s = spanAt(y);
    return Math.min(s.x1 - centreOf(y), centreOf(y) - s.x0);
  };

  // eye sizes, biggest first: tall ovals by default, 3 wide on the big bodies
  const size = g.eyes.size;
  const sizes: [number, number][] = [];
  if (kind === 'cyclops') {
    if (size >= 1.15) sizes.push([5, 4]);
    sizes.push([3, 3], [3, 2], [2, 2], [1, 2]);
  } else {
    if (hw >= 6 && size >= 0.9) sizes.push([3, 3]);
    if (size >= 0.9) sizes.push([2, 3]);
    sizes.push([2, 2], [1, 2]);
  }
  // the bigger eye of an asymmetric pair rises one row
  const raisedPref = kind === 'round' || kind === 'trio' ? (g.eyes.asym >= 0.4 ? 1 : 0) : 0;

  let eyes: Box[] = [];
  const stalks: Stalk[] = [];
  let eyeTop = top + 2;
  let eyeH = 2;
  let fx = centreOf(eyeTop);
  if (eyesOnBody) {
    // first choice from the genome, then gentler layouts until every eye sits inside the body
    const tries: { y: number; h: number; layout: () => Box[] }[] = [];
    const firstRow = top + (kind === 'trio' ? 4 : hb >= 9 ? 2 : 1);
    // two passes: eyes clearly apart (three dots or more) at any size, then squeezed together
    for (const pass of [0, 1])
      for (const [ew, h] of sizes)
        for (const y of [
          ...new Set([firstRow, firstRow - 1, firstRow + 1, top + 2, top + 1]),
        ].filter((v) => v >= top + 1 && v + h + 4 <= top + hb)) {
          const cxe = centreOf(y + h - 1);
          if (kind === 'cyclops') {
            if (pass === 1) continue;
            tries.push({ y, h, layout: () => [{ x: cxe - Math.floor(ew / 2), y, w: ew, h }] });
          } else {
            const half = halfAt(y + h - 1);
            // eyes stay clearly apart: three dots between them, more if the genome spaces them out
            const wide = 3 + 2 * Math.max(0, Math.round((half - 5) * 0.5 * g.eyes.spacing));
            for (const raised of raisedPref ? [1, 0] : [0])
              for (const gap of [...new Set([wide, 3, 1])].filter(
                (v) => v <= wide && (pass === 0 ? v >= 3 : v < 3),
              ))
                tries.push({
                  y,
                  h,
                  layout: () => {
                    const off = (gap + 1) / 2;
                    // the bigger eye (asym) is the right one, as in the glossy kit; bottoms aligned
                    const out: Box[] = [
                      { x: cxe - off - ew + 1, y, w: ew, h },
                      { x: cxe + off, y: y - raised, w: ew, h: h + raised },
                    ];
                    if (kind === 'trio') {
                      // the third eye on the forehead, between and above the others: a little
                      // upright eye with its glint if there is room, else a single dot
                      if (y - 3 >= top + 1) out.push({ x: cxe, y: y - 3, w: 1, h: 2 });
                      else if (y - 2 >= top + 1) out.push({ x: cxe, y: y - 2, w: 1, h: 1 });
                    }
                    return out;
                  },
                });
          }
        }
    const found = tries.find((t) => t.layout().every(ringOk));
    const pick = found ?? tries[tries.length - 1];
    if (pick) {
      eyes = pick.layout();
      eyeTop = pick.y;
      eyeH = pick.h;
      fx = centreOf(eyeTop + eyeH - 1);
    }
  } else {
    // two 4 × 4 eyeballs on stalks, a gap of three dots between them (room for a geyser)
    fx = centreOf(top);
    const by = top - 5;
    for (const side of [-1, 1] as const) {
      const bx = side < 0 ? fx - 5 : fx + 2;
      const sx = side < 0 ? fx - 3 : fx + 3;
      stalks.push({ bx, by, sx });
      eyes.push({ x: bx + 1, y: by + 1, w: 2, h: 2 });
    }
  }
  const eyeball = kind === 'cyclops' && (eyes[0]?.w ?? 0) >= 3 && (eyes[0]?.h ?? 0) >= 3;

  // the mouth sits under the eyes, one row of body between
  const mouthY = eyesOnBody ? eyeTop + eyeH + 1 : top + Math.max(3, Math.round(hb * 0.42));
  let mouthMax = Infinity;
  for (const y of [mouthY, mouthY + 1]) {
    const s = spanAt(y);
    mouthMax = Math.min(mouthMax, fx - s.x0 - 1, s.x1 - fx - 1);
  }
  // and the rows above and below must cover it (a mouth never opens on the screen)
  for (const y of [mouthY - 1, mouthY + 2]) {
    const s = spanAt(y);
    mouthMax = Math.min(mouthMax, fx - s.x0, s.x1 - fx);
  }
  mouthMax = Math.max(1, mouthMax);
  const mw = g.mouth.width;
  let mouthK: number;
  switch (g.mouth.kind) {
    case 'smile':
      mouthK = mw > 1.1 ? 2 : 1;
      break;
    case 'grin':
      mouthK = mw > 1.12 ? 2 : 1;
      break;
    case 'canyon':
      // a wide crescent from cheek to cheek
      mouthK = clamp(Math.round(2.6 * mw), 2, mouthMax);
      break;
    case 'tiny':
      mouthK = 0;
      break;
  }
  mouthK = Math.max(0, Math.min(mouthK, mouthMax));

  /* ---- belly ---- */
  const belly = new Set<number>();
  if (g.palette.belly !== 'none') {
    // a rounded patch low on the body, a lit row away from the mouth; none if it would be a stripe
    const from = Math.max(mouthY + 3, top + Math.round(hb * 0.58));
    const last = bottom - 1;
    if (last - from >= 1)
      for (let y = from; y <= last; y++) {
        const s = spanAt(y);
        const inset = y === from || y === last ? 3 : 2;
        for (let x = s.x0 + inset; x <= s.x1 - inset; x++) belly.add(key(x, y));
      }
  }

  /* ---- face keep-out (marks never touch it) ---- */
  const face = new Set<number>();
  const keepOut = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) face.add(key(x, y));
  };
  // every eye shape of every expression (looking up, arcs, crosses) plus one dot around
  for (const e of eyes) keepOut(e.x - 2, e.y - 2, e.x + e.w + 1, e.y + e.h);
  // and the bridge between the eyes: a dot there would read as a nose
  const onBody = eyes.filter((e) => e.y > top);
  if (onBody.length > 1)
    keepOut(
      Math.min(...onBody.map((e) => e.x)),
      Math.min(...onBody.map((e) => e.y)) - 2,
      Math.max(...onBody.map((e) => e.x + e.w - 1)),
      Math.max(...onBody.map((e) => e.y + e.h)),
    );
  // every mouth of every expression, plus one dot around
  const mouthReach = Math.max(mouthK + 1, Math.min(2, mouthMax));
  keepOut(fx - mouthReach - 1, mouthY - 1, fx + mouthReach + 1, mouthY + 3);

  /* ---- half-lit dots: only the marks (the body itself is one clean colour) ---- */
  const shade = new Map<number, DotCell>();

  /* ---- marks: few, clear, away from the face and the outline ---- */
  if (g.marks) {
    const cand: Pt[] = [];
    const ok = new Set<number>();
    for (let y = top + 1; y <= bottom - 1; y++) {
      const s = spanAt(y);
      for (let x = s.x0 + 1; x <= s.x1 - 1; x++) {
        const k = key(x, y);
        if (!face.has(k) && !belly.has(k) && !shade.has(k)) {
          cand.push([x, y]);
          ok.add(k);
        }
      }
    }
    const mr = createRng(g.seed ^ 0x7a11);
    const d = g.marks.density;
    const free = (x: number, y: number, gap: number) => {
      for (let yy = y - gap; yy <= y + gap; yy++)
        for (let xx = x - gap; xx <= x + gap; xx++) if (shade.has(key(xx, yy))) return false;
      return true;
    };
    const shuffled = cand
      .map((p) => ({ p, r: mr.next() }))
      .sort((a, b) => a.r - b.r)
      .map((o) => o.p);
    switch (g.marks.kind) {
      case 'spots': {
        // freckles: single half-lit dots, well apart
        let n = Math.round(2 + d * 2);
        for (const [x, y] of shuffled) {
          if (n <= 0) break;
          if (free(x, y, 2)) {
            shade.set(key(x, y), 'dim');
            n--;
          }
        }
        break;
      }
      case 'craters': {
        // round pits: an L of three half-lit dots, one or two of them
        let n = Math.round(1 + d * 1.5);
        for (const [x, y] of shuffled) {
          if (n <= 0) break;
          const cells: Pt[] = [
            [x, y],
            [x + 1, y],
            [x, y + 1],
          ];
          if (
            [...cells, [x + 1, y + 1] as Pt].every(([a, b]) => ok.has(key(a, b))) &&
            free(x, y, 2) &&
            free(x + 1, y + 1, 2)
          ) {
            for (const [a, b] of cells) shade.set(key(a, b), 'dim');
            n--;
          }
        }
        break;
      }
      case 'sponge': {
        // pores in a loose cluster on one flank (never holes: a hole would read as another eye)
        let n = Math.round(3 + d * 3);
        const [sx = 0, sy = 0] = shuffled[0] ?? [];
        const near = [...shuffled].sort(
          (a, b) => Math.hypot(a[0] - sx, a[1] - sy) - Math.hypot(b[0] - sx, b[1] - sy),
        );
        for (const [x, y] of near) {
          if (n <= 0) break;
          if (free(x, y, 1) && mr.chance(0.7)) {
            shade.set(key(x, y), 'dim');
            n--;
          }
        }
        break;
      }
      case 'stripes': {
        // tiger stripes from both flanks, every other row below the eyes
        for (let y = eyeTop + 1; y <= bottom - 1; y += 2) {
          const s = spanAt(y);
          const len = y < mouthY ? 1 : 2;
          for (let i = 0; i < len; i++) {
            for (const x of [s.x0 + i, s.x1 - i]) {
              const k = key(x, y);
              if (!face.has(k) && !belly.has(k)) shade.set(k, 'dim');
            }
          }
        }
        break;
      }
    }
  }

  const fxSide: -1 | 1 = g.tail ? -1 : 1;
  // arms hang from the lowest of the widest rows, so the hand clears the narrowing body below
  // (never so low that the hand meets the feet)
  const wOf = (y: number) => spanAt(y).x1 - spanAt(y).x0;
  let armY = top + 3;
  for (let y = top + 3; y <= bottom - 3; y++) if (wOf(y) >= wOf(armY)) armY = y;

  const model: Model = {
    g,
    top,
    bottom,
    hb,
    spans,
    fx,
    eyes,
    eyeball,
    stalks,
    mouthY,
    mouthMax,
    mouthK,
    mouth: g.mouth.kind,
    belly,
    shade,
    fxSide,
    armY,
    head: [],
    tail: [],
    feet: [],
  };
  resolveParts(model);
  return model;
}

/* ------------------------------------------------------------------ parts */

type Cells = [number, number, DotCell][];

/** Mirrors a left-hand part around the axis `ax2 / 2`. */
const mirror = (cells: Cells, ax2: number): Cells => cells.map(([x, y, c]) => [ax2 - x, y, c]);

function resolveParts(m: Model): void {
  const { g, top } = m;
  const occupied = new Set<number>();
  for (let y = 0; y < DOT_H; y++)
    for (let x = 0; x < DOT_W; x++) if (inBody(m, x, y)) occupied.add(key(x, y));
  const fits = (cells: Cells): boolean =>
    cells.every(([x, y]) => inGrid(x, y) && y >= 1 && !occupied.has(key(x, y)));
  const take = (cells: Cells, into: Cells): boolean => {
    if (!fits(cells)) return false;
    for (const [x, y, c] of cells) {
      occupied.add(key(x, y));
      into.push([x, y, c]);
    }
    return true;
  };
  const t = m.spans[top] ?? { x0: m.fx, x1: m.fx };
  // ears and horns grow from the shoulders (the row under the crown), so they stand apart
  const sh = m.spans[top + 1] ?? t;
  const ax2 = t.x0 + t.x1;
  const avail = top - 1;
  const topY = (x: number): number => {
    for (let y = 0; y < DOT_H; y++) if (inBody(m, x, y)) return y;
    return top;
  };

  /* stalk eyes come first: they are the eyes */
  for (const s of m.stalks) {
    const cells: Cells = [];
    // stalk from the head up to the eyeball (it bends inwards if the head is narrow there)
    let sx = s.sx;
    while (topY(sx) > top + 1 && sx !== m.fx) sx += sx < m.fx ? 1 : -1;
    for (let y = s.by + 4; y < topY(sx); y++) cells.push([y === s.by + 4 ? s.sx : sx, y, 'lit']);
    for (let dy = 0; dy < 4; dy++)
      for (let dx = 0; dx < 4; dx++) {
        if ((dy === 0 || dy === 3) && (dx === 0 || dx === 3)) continue;
        // the eyeball is the second colour, so it never reads as an ear
        cells.push([s.bx + dx, s.by + dy, 'accent']);
      }
    take(cells, m.head);
  }

  /* horns (accent) */
  if (g.horns) {
    const { kind, size, stripes, count } = g.horns;
    const shade = (i: number): DotCell => (stripes && i % 2 === 1 ? 'accentDim' : 'accent');
    if (kind === 'nubs') {
      // a crown of little horns that follows the round top of the head
      const n = count;
      const step = n >= 4 ? 2 : n === 3 ? 3 : 4;
      const xs = Array.from({ length: n }, (_, i) => Math.round(m.fx + (i - (n - 1) / 2) * step));
      const tall = size >= 0.95 && avail >= 2;
      const placed: Cells = [];
      xs.forEach((x, i) => {
        const y = topY(x) - 1;
        const centre = Math.abs(i - (n - 1) / 2) < 0.6;
        const cells: Cells = [[x, y, shade(0)]];
        if (tall && (centre || n <= 3)) cells.push([x, y - 1, shade(1)]);
        if (!take(cells, placed)) take([[x, y, shade(0)]], placed);
      });
      m.head.push(...placed);
    } else if (kind === 'spike') {
      const len = clamp(Math.round(1 + size * 1.4), 2, Math.min(3, avail));
      const x = t.x0;
      const left: Cells = [];
      for (let i = 0; i < len; i++) {
        // leaning outwards: a little devil
        const lean = i === len - 1 && len >= 3 ? -1 : 0;
        left.push([x + lean, top - 1 - i, shade(i)]);
      }
      if (fits(left) && fits(mirror(left, ax2))) {
        take(left, m.head);
        take(mirror(left, ax2), m.head);
      }
    } else {
      // curved: out of the head, sideways, then up (a little bull)
      const x = t.x0;
      const left: Cells = [
        [x, top - 1, shade(0)],
        [x - 1, top - 1, shade(1)],
        [x - 2, top - 2, shade(0)],
      ];
      if (size >= 1.1 && avail >= 3) left.push([x - 2, top - 3, shade(1)]);
      if (fits(left) && fits(mirror(left, ax2))) {
        take(left, m.head);
        take(mirror(left, ax2), m.head);
      }
    }
  }

  /* ears */
  if (g.ears) {
    const { kind, size, spread } = g.ears;
    const sax2 = sh.x0 + sh.x1;
    let left: Cells = [];
    if (kind === 'long') {
      // bunny ears from the shoulders: two dots wide, the inside half-lit, a gap between them
      const h = clamp(Math.round(2 + 1.6 * size), 3, Math.min(4, avail + 1));
      const x = sh.x0;
      const tilt = spread >= 0.35 ? -1 : 0;
      for (let i = 0; i < h; i++) {
        const y = top - i;
        const dx = i >= h - 1 ? tilt : 0;
        const tip = i === h - 1;
        left.push([x + dx, y, 'lit']);
        left.push([x + dx + 1, y, tip || i === 0 ? 'lit' : 'dim']);
      }
      left = left.filter(([xx, yy]) => !inBody(m, xx, yy));
    } else if (kind === 'round') {
      const x = t.x0 - 1;
      left = [
        [x, top - 1, 'lit'],
        [x + 1, top - 1, 'dim'],
        [x, top - 2, 'lit'],
        [x + 1, top - 2, 'lit'],
      ];
      if (size >= 1.15) left.push([x - 1, top - 1, 'lit']);
    } else if (kind === 'pointy') {
      // cat ears: they fill the shoulder corner beside the crown and end in a tip
      const x = sh.x0;
      const out = spread >= 0.4 ? -1 : 0;
      for (let xx = x; xx < t.x0; xx++) left.push([xx, top, 'lit']);
      left.push([x, top - 1, 'lit'], [x + 1, top - 1, 'lit'], [x + out, top - 2, 'lit']);
      if (size >= 1.15 && avail >= 3) left.push([x + out, top - 3, 'lit']);
      left = left.filter(([xx, yy]) => !inBody(m, xx, yy));
    } else {
      // fins on the flanks, at eye height
      const y = m.eyes[0]?.y ?? top + 2;
      const s = m.spans[y] ?? t;
      const s2 = m.spans[y + 1] ?? s;
      const x = Math.min(s.x0, s2.x0);
      left = [
        [x - 1, y, 'lit'],
        [x - 2, y - 1, 'lit'],
        [x - 1, y + 1, 'dim'],
      ];
      if (size >= 1.1) left.push([x - 2, y, 'dim']);
      const s3 = m.spans[y] ?? t;
      const right = mirror(left, s3.x0 + s3.x1);
      if (fits(left) && fits(right)) {
        take(left, m.head);
        take(right, m.head);
      }
      left = [];
    }
    if (left.length) {
      const axis = kind === 'round' ? ax2 : sax2;
      const right = mirror(left, axis);
      if (fits(left) && fits(right)) {
        take(left, m.head);
        take(right, m.head);
      } else {
        // ears that do not fit (horns already there) shrink to their lowest row
        const low = left.filter(([, y]) => y >= top - 1);
        if (fits(low) && fits(mirror(low, axis))) {
          take(low, m.head);
          take(mirror(low, axis), m.head);
        }
      }
    }
  }

  /* topper, on the top centre */
  if (g.topper) {
    const { kind, size } = g.topper;
    const x = m.fx;
    const y = topY(x) - 1;
    let cells: Cells;
    switch (kind) {
      case 'tuft':
        cells = [
          [x, y, 'lit'],
          [x - 1, y - 1, 'lit'],
          [x + 1, y - 1, 'lit'],
        ];
        if (size >= 1.15) cells.push([x, y - 2, 'accent']);
        break;
      case 'antenna': {
        const h = size >= 1.1 && avail >= 3 ? 2 : 1;
        cells = [];
        for (let i = 0; i < h; i++) cells.push([x, y - i, 'lit']);
        cells.push([x, y - h, 'accent']);
        break;
      }
      case 'crest':
        cells = [
          [x - 1, y, 'accent'],
          [x, y, 'accent'],
          [x + 1, y, 'accent'],
          [x, y - 1, 'accent'],
        ];
        if (size >= 1.1) cells.push([x - 2, y, 'accentDim'], [x + 2, y, 'accentDim']);
        break;
      case 'geyser':
        // a jet from the top of the head that opens into a spray
        cells = [
          [x, y, 'accentDim'],
          [x, y - 1, 'accent'],
          [x, y - 2, 'accentDim'],
        ];
        if (size >= 0.95) cells.push([x, y - 3, 'accent']);
        // the spray opens only where there is room (not between two eyeballs)
        if (!m.stalks.length) cells.push([x - 1, y - 3, 'accentDim'], [x + 1, y - 3, 'accentDim']);
        break;
    }
    if (!take(cells, m.head)) {
      const small = cells.filter(([, yy]) => yy >= y - 1);
      if (!take(small, m.head)) take([[x, y, cells[0]?.[2] ?? 'lit']], m.head);
    }
  }

  /* tail, on the right flank near the ground */
  if (g.tail) {
    const { kind, size, stripes } = g.tail;
    const base = m.bottom - 1;
    const s = m.spans[base] ?? t;
    const x = s.x1 + 1;
    const band = (i: number): DotCell => (stripes && i % 2 === 1 ? 'accent' : 'lit');
    let cells: Cells;
    if (kind === 'plume') {
      // a squirrel plume: out of the flank, up and fluffy, the tip curling back to the head
      const art =
        size >= 0.95
          ? ['.##.', '.###', '..##', '..##', '.###', '###.', '##..']
          : ['.#.', '..#', '.##', '.##', '##.', '#..'];
      cells = fromArt(art, x, base, (i) => band(art.length - 1 - i));
    } else if (kind === 'spiky') {
      cells = [
        [x, base, 'lit'],
        [x + 1, base - 1, 'lit'],
        [x + 2, base - 2, 'lit'],
        [x + 1, base - 2, 'accent'],
        [x + 2, base - 1, 'accent'],
      ];
      if (size >= 1.1) cells.push([x + 2, base - 3, 'accent']);
    } else {
      cells = [
        [x, base, band(0)],
        [x + 1, base, band(0)],
        [x + 2, base - 1, band(1)],
        [x + 1, base - 2, band(0)],
      ];
      if (size >= 1.0) cells.push([x + 2, base - 2, band(1)]);
    }
    // the tail slides out from the flank until it clears the body
    let placed = false;
    for (let dx = 0; dx <= 2 && !placed; dx++)
      placed = take(
        cells.map(([cx2, cy2, cc]): [number, number, DotCell] => [cx2 + dx, cy2, cc]),
        m.tail,
      );
    if (!placed) take(cells.slice(0, 2), m.tail);
  }

  /* feet on the ground row: they stick out past the tucked-in bottom, a gap between them */
  if (g.feet !== 'none') {
    const s = m.spans[m.bottom] ?? t;
    const c2 = s.x0 + s.x1;
    const half = Math.floor((s.x1 - s.x0) / 2);
    const footW = half >= 4 ? 3 : 2;
    const left: Cells = [];
    const lx = s.x0 - 1;
    for (let i = 0; i < footW; i++) left.push([lx + i, m.bottom + 1, 'lit']);
    if (g.feet === 'claws') left.unshift([lx - 1, m.bottom + 1, 'accent']);
    const right = mirror(left, c2);
    take(
      left.filter(([x]) => x >= 0),
      m.feet,
    );
    take(
      right.filter(([x]) => x < DOT_W),
      m.feet,
    );
  }
}

/** Cells from a little drawing: rows top to bottom, the last row sits on `baseY`, column 0 at `x`. */
function fromArt(art: string[], x: number, baseY: number, shade: (row: number) => DotCell): Cells {
  const out: Cells = [];
  art.forEach((line, i) => {
    const y = baseY - (art.length - 1 - i);
    [...line].forEach((ch, j) => {
      if (ch === '#') out.push([x + j, y, shade(i)]);
      else if (ch === 'A') out.push([x + j, y, 'accent']);
      else if (ch === '+') out.push([x + j, y, 'dim']);
    });
  });
  return out;
}

/* ------------------------------------------------------------------ painting */

class Canvas {
  readonly cells: DotCell[] = Array.from({ length: DOT_W * DOT_H }, (): DotCell => 'off');
  readonly dy: number;
  constructor(dy: number) {
    this.dy = dy;
  }
  get(x: number, y: number): DotCell {
    const yy = y + this.dy;
    return inGrid(x, yy) ? (this.cells[key(x, yy)] ?? 'off') : 'off';
  }
  set(x: number, y: number, c: DotCell): void {
    const yy = y + this.dy;
    if (inGrid(x, yy)) this.cells[key(x, yy)] = c;
  }
  isFree(x: number, y: number): boolean {
    const yy = y + this.dy;
    return inGrid(x, yy) && this.cells[key(x, yy)] === 'off';
  }
}

/** `aside` / `across`: open eyes glancing towards the free side or away from it (confused). */
type EyeState = 'open' | 'blink' | 'up' | 'arc' | 'cross' | 'shut' | 'aside' | 'across';

/** Cells of an eye box, with the corners cut on the big round ones. */
function eyeCells(e: Box): Pt[] {
  const out: Pt[] = [];
  const round = e.w >= 4;
  for (let j = 0; j < e.h; j++)
    for (let i = 0; i < e.w; i++) {
      if (round && (j === 0 || j === e.h - 1) && (i === 0 || i === e.w - 1)) continue;
      out.push([e.x + i, e.y + j]);
    }
  return out;
}

/** Carves one eye into whatever is lit there (the body, or the ring of an eyeball on a stalk). */
function carveEye(c: Canvas, m: Model, e: Box, state: EyeState, arcEnds = true): void {
  const solid = (x: number, y: number): boolean => isLight(c.get(x, y));
  const hole = (x: number, y: number) => {
    if (solid(x, y)) c.set(x, y, 'eye');
  };
  const { x, y, w, h } = e;
  const big = w >= 4;
  const leftEye = x + (w - 1) / 2 < m.fx;
  const toThought = m.fxSide;
  switch (state) {
    case 'aside':
    case 'across':
    case 'open':
    case 'up': {
      // looking up moves the whole eye one row up, if the body (not a horn) is still above it
      const lift =
        state === 'up' &&
        inBody(m, x, y - 2) &&
        inBody(m, x + w - 1, y - 2) &&
        inBody(m, x - 1, y - 1) &&
        inBody(m, x + w, y - 1)
          ? 1
          : 0;
      if (m.eyeball) {
        // the cyclops eye: a white eyeball with a dark pupil that looks around
        for (const [px, py] of eyeCells(e)) if (solid(px, py)) c.set(px, py, 'glint');
        // a 2 × 2 pupil on the big eye, looking a little towards the free side
        const pw = w >= 5 ? 2 : 1;
        const ph = h >= 4 ? 2 : 1;
        const glance =
          state === 'aside' ? toThought : state === 'across' ? -toThought : toThought > 0 ? 1 : 0;
        const px =
          x +
          Math.floor((w - pw) / 2) +
          (state === 'aside' || state === 'across'
            ? Math.max(
                -Math.floor((w - pw) / 2),
                Math.min(w - pw - Math.floor((w - pw) / 2), glance),
              )
            : pw === 2 && glance > 0
              ? 1
              : 0);
        const py = state === 'up' ? y : y + Math.floor((h - ph) / 2);
        for (let j = 0; j < ph; j++)
          for (let i = 0; i < pw; i++)
            if (c.get(px + i, py + j) === 'glint') c.set(px + i, py + j, 'eye');
        break;
      }
      const yy = y - lift;
      if (lift) for (let i = 0; i < w; i++) c.set(x + i, y + h - 1, 'lit');
      for (const [px, py] of eyeCells({ x, y: yy, w, h })) hole(px, py);
      if (state === 'up' && !lift && h >= 2) {
        // no room to look up: the lower lid rises instead
        for (let i = 0; i < w; i++)
          if (c.get(x + i, y + h - 1) === 'eye') c.set(x + i, y + h - 1, 'lit');
      }
      // the reflection: top-left, or towards the thought dots when looking up
      // a glance moves it to the side the monster looks at
      const right =
        (state === 'up' && toThought > 0) ||
        (state === 'aside' && toThought > 0) ||
        (state === 'across' && toThought < 0);
      const gx = right ? x + w - 1 - (big ? 1 : 0) : x + (big ? 1 : 0);
      c.set(gx, yy, 'glint');
      if (big) c.set(gx, yy + 1, 'glint');
      // big eyes get a second, smaller spark low on the other side
      break;
    }
    case 'blink': {
      // a closed lid half-way down the eye
      const row = y + Math.min(h - 1, Math.floor(h / 2) + (h >= 3 ? 0 : 1) - (h >= 3 ? 0 : 1));
      for (let i = 0; i < w; i++) {
        if (big && (i === 0 || i === w - 1)) continue;
        hole(x + i, h >= 3 ? y + 1 : row);
      }
      break;
    }
    case 'shut': {
      // asleep: a lid that curves down (the corners one row up on wide eyes)
      const row = y + h - 1;
      if (w >= 3) {
        hole(x, row - 1);
        hole(x + w - 1, row - 1);
        for (let i = 1; i < w - 1; i++) hole(x + i, row);
      } else for (let i = 0; i < w; i++) hole(x + i, row);
      break;
    }
    case 'arc': {
      // ^ ^ : a little arch, one row above the bottom of the eye
      if (w === 1) {
        hole(x, y + h - 1);
        break;
      }
      const yy = y + h - 2;
      const lo = big ? 1 : 0;
      const cells: Pt[] = [];
      for (let i = lo; i < w - lo; i++) cells.push([x + i, yy]);
      const ends: Pt[] = [
        [x + lo - 1, yy + 1],
        [x + w - lo, yy + 1],
      ];
      for (const [cx2, cy2] of arcEnds ? [...cells, ...ends] : cells) hole(cx2, cy2);
      break;
    }
    case 'cross': {
      const X = (cxe: number, cye: number) => {
        for (const [dx, dy] of [
          [-1, -1],
          [1, -1],
          [0, 0],
          [-1, 1],
          [1, 1],
        ] as const)
          hole(cxe + dx, cye + dy);
      };
      if (w >= 3 && h >= 3) {
        X(x + Math.floor(w / 2), y + Math.floor((h - 1) / 2));
      } else if (w === 2 && h >= 3) {
        // an X three dots wide: it grows towards the outside of the face if the body is there
        const out = leftEye ? x : x + 1;
        const inn = leftEye ? x + 1 : x;
        const room = (cx2: number) =>
          [
            [-1, 0],
            [1, 0],
            [0, 1],
            [-1, 2],
            [1, 2],
          ].every(([dx = 0, dy = 0]) =>
            [
              [0, 0],
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ].every(([ex = 0, ey = 0]) => inBody(m, cx2 + dx + ex, y + dy + ey)),
          );
        if (room(out)) X(out, y + 1);
        else if (room(inn) && m.eyes.length <= 2) X(inn, y + 1);
        else {
          // > <  squeezed shut, pointing at the nose
          const o = leftEye ? x : x + 1;
          const i = leftEye ? x + 1 : x;
          hole(o, y);
          hole(i, y + 1);
          hole(o, y + 2);
        }
      } else if (w === 2) {
        const r0 = y - 1;
        const room =
          inBody(m, x, y - 2) &&
          inBody(m, x + 1, y - 2) &&
          inBody(m, x - 1, y - 1) &&
          inBody(m, x + 2, y - 1);
        if (room) {
          const outer = leftEye ? x : x + 1;
          const inner = leftEye ? x + 1 : x;
          hole(outer, r0);
          hole(inner, r0 + 1);
          hole(outer, r0 + 2);
        } else {
          hole(x, y + h - 1);
          hole(x + 1, y + h - 1);
        }
      } else {
        hole(x, y + h - 1);
      }
      break;
    }
  }
}

type MouthState =
  'rest' | 'talk0' | 'talk1' | 'talk2' | 'think' | 'happy' | 'error' | 'sleep' | 'confused';

function carveMouth(c: Canvas, m: Model, state: MouthState): void {
  const { fx, mouthY: y, mouthMax: max, g } = m;
  const hole = (x: number, yy: number) => {
    if (inBody(m, x, yy)) c.set(x, yy, 'mouth');
  };
  const tooth = (x: number, yy: number) => {
    if (c.get(x, yy) === 'mouth') c.set(x, yy, 'tooth');
  };
  const row = (yy: number, k: number) => {
    for (let x = fx - k; x <= fx + k; x++) hole(x, yy);
  };
  const teeth = g.mouth.teeth;
  /**
   * White teeth of an open mouth of half-width k: fangs are tusks at the lower corners,
   * buck one tooth in the middle of the top row, a row fills the top row between the corners.
   */
  const openTeeth = (k: number) => {
    if (k < 1) return;
    if (teeth === 'fangs') {
      // a small mouth shows one snaggletooth (two would read as a second pair of eyes)
      for (const x of k >= 2 ? [fx - k, fx + k] : [fx - k])
        if (inBody(m, x, y + 1)) c.set(x, y + 1, 'tooth');
    } else if (teeth === 'row') {
      for (let x = fx - k + 1; x <= fx + k - 1; x++) tooth(x, y);
    } else if (teeth === 'buck') {
      tooth(fx, y);
    }
  };
  /** An open mouth: a D, k wide on the top row, k - 1 below. */
  const open = (k: number) => {
    row(y, k);
    row(y + 1, Math.max(0, k - 1));
  };

  switch (state) {
    case 'rest': {
      const k = m.mouthK;
      switch (m.mouth) {
        case 'smile':
          // a closed U: corners up, the line underneath
          hole(fx - k, y);
          hole(fx + k, y);
          row(y + 1, k - 1);
          if (teeth === 'fangs' && k >= 2) {
            // two little fangs over the lower lip
            c.set(fx - k + 1, y, 'tooth');
            c.set(fx + k - 1, y, 'tooth');
          } else if (teeth === 'buck') c.set(fx, y, 'tooth');
          break;
        case 'grin':
          open(k);
          openTeeth(k);
          break;
        case 'canyon':
          // a wide, thin grin from cheek to cheek, two little fangs over the lower lip
          hole(fx - k, y);
          hole(fx + k, y);
          row(y + 1, k - 1);
          if (teeth === 'fangs' && k >= 3) {
            for (const x of [fx - k + 2, fx + k - 2])
              if (inBody(m, x, y + 2)) c.set(x, y + 2, 'tooth');
          } else if (teeth === 'buck') c.set(fx, y + 2, 'tooth');
          break;
        case 'tiny':
          // a single dot: too small for teeth
          hole(fx, y);
          break;
      }
      break;
    }
    case 'talk0': {
      // closed: a short line
      row(y, Math.min(1, max));
      break;
    }
    case 'talk1': {
      // open: an o
      const k = Math.min(1, max);
      row(y, k);
      row(y + 1, k);
      break;
    }
    case 'talk2': {
      // wide open
      const k = Math.min(2, max);
      row(y, k);
      row(y + 1, k);
      if (k >= 2 && !inBody(m, fx, y + 3)) {
        hole(fx - k, y + 1);
        c.set(fx - k, y + 1, 'lit');
        c.set(fx + k, y + 1, 'lit');
      } else if (k >= 2) {
        row(y + 2, k - 1);
        if (!(inBody(m, fx - k + 1, y + 3) && inBody(m, fx + k - 1, y + 3))) {
          for (let x = fx - k + 1; x <= fx + k - 1; x++) c.set(x, y + 2, 'lit');
        }
      }
      if (k >= 2) {
        c.set(fx - k, y + 1, 'lit');
        c.set(fx + k, y + 1, 'lit');
      }
      openTeeth(k);
      break;
    }
    case 'think': {
      // a little "hmm", pushed to one side
      const s = m.fxSide;
      hole(fx, y + 1);
      if (max >= 2) hole(fx + s, y + 1);
      break;
    }
    case 'happy': {
      const k = clamp(Math.max(m.mouthK, 2), 1, max);
      open(k);
      openTeeth(k);
      // a pink tongue
      if (k >= 2) c.set(fx, y + 1, 'cheek');
      break;
    }
    case 'error': {
      if (max >= 2) {
        hole(fx - 2, y + 1);
        hole(fx - 1, y);
        hole(fx, y + 1);
        hole(fx + 1, y);
        hole(fx + 2, y + 1);
      } else {
        hole(fx - 1, y + 1);
        hole(fx, y);
        hole(fx + 1, y + 1);
      }
      break;
    }
    case 'sleep':
      hole(fx, y + 1);
      break;
    case 'confused': {
      // a wobbly "~", lopsided towards the free side
      const s = m.fxSide;
      hole(fx - s, y + 1);
      hole(fx, y);
      hole(fx + s, y + 1);
      if (max >= 2) hole(fx + 2 * s, y);
      break;
    }
  }
}

/** Where the arcs of happy eyes put their ends (one row below, one dot outside each eye). */
function arcFeet(m: Model): Pt[] {
  const out: Pt[] = [];
  for (const e of m.eyes) {
    if (e.w === 1) continue;
    const lo = e.w >= 4 ? 1 : 0;
    const yy = e.y + e.h - 1;
    out.push([e.x + lo - 1, yy], [e.x + e.w - lo, yy]);
  }
  return out;
}

/** Pink cheeks under the outer corners of the eyes, only on plain body light away from the mouth. */
function paintCheeks(c: Canvas, m: Model): void {
  const onBody = m.eyes.filter((e) => e.y > m.top);
  if (onBody.length === 0) return;
  const y = Math.max(...onBody.map((e) => e.y + e.h));
  const left = Math.min(...onBody.map((e) => e.x)) - 1;
  const right = Math.max(...onBody.map((e) => e.x + e.w));
  const spots = [left, right].map((x): Pt => [x, y]);
  const plain = ([x, yy]: Pt): boolean => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = c.get(x + dx, yy + dy);
        if (n === 'mouth' || n === 'tooth' || (dx === 0 && dy === 0 && n !== 'lit')) return false;
      }
    return true;
  };
  if (spots.every(plain)) for (const [x, yy] of spots) c.set(x, yy, 'cheek');
}

/** The z of sleep and the thought dots, in the top corner on the free side, clear of the monster. */
function paintFx(c: Canvas, m: Model, expr: Expression, frame: number): void {
  const side = m.fxSide;
  const place = (cells: Cells): boolean => {
    // where it was drawn, else a step towards the edge, else towards the middle of the screen
    for (const shift of [0, 1, -1, 2, -2, -3, -4, -5, -6, -7]) {
      const moved = cells.map(([x, y, cc]): [number, number, DotCell] => [x + side * shift, y, cc]);
      const ok = moved.every(([x, y]) => {
        if (!c.isFree(x, y)) return false;
        // keep a dark ring around the effect so it never touches the monster
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const n = c.get(x + dx, y + dy);
            if (n !== 'off' && !moved.some(([mx, my]) => mx === x + dx && my === y + dy))
              return false;
          }
        return true;
      });
      if (ok) {
        for (const [x, y, cc] of moved) c.set(x, y, cc);
        return true;
      }
    }
    return false;
  };
  /** Cells of a little picture with its top-left corner at (x, y), never mirrored. */
  const art = (rows: string[], x: number, y: number, cell: DotCell): Cells => {
    const out: Cells = [];
    rows.forEach((line, j) =>
      [...line].forEach((ch, i) => {
        if (ch === '#') out.push([x + i, y + j, cell]);
      }),
    );
    return out;
  };
  /** Left column of a picture `w` wide that sits `inset` columns in from the free edge. */
  const fromEdge = (w: number, inset: number): number => (side > 0 ? DOT_W - w - inset : inset);

  if (expr === 'think') {
    // thought bubbles rising from the head to the top corner, one more per frame:
    // a dot, a pair, a 2 × 2 cloud
    const bubbles: Cells[][] = [
      [5, 6, 4, 7].map((y) => art(['#'], fromEdge(1, 4), y, 'accent')),
      [3, 4, 2].map((y) => art(['##'], fromEdge(2, 2), y, 'accent')),
      [0, 1].map((y) => art(['##', '##'], fromEdge(2, 0), y, 'accent')),
    ];
    for (let i = 0; i <= frame; i++)
      for (const option of bubbles[i] ?? []) if (place(option)) break;
  } else if (expr === 'sleep') {
    // a z that floats up and grows into a Z
    const z = ['###', '..#', '.#.', '###'];
    const Z = ['####', '..#.', '.#..', '####'];
    const low = clamp(m.top - 2, 2, 6);
    const steps: Cells[][] = [
      [low + 1, low, low + 2, low + 3, 0].map((y) => art(z, fromEdge(3, 2), y, 'lit')),
      [low - 1, low - 2, low, 0].map((y) => art(z, fromEdge(3, 1), Math.max(0, y), 'lit')),
      [
        ...[0, 1].map((y) => art(Z, fromEdge(4, 0), y, 'lit')),
        ...[0, 1].map((y) => art(z, fromEdge(3, 0), y, 'lit')),
      ],
    ];
    for (const option of steps[frame] ?? []) if (place(option)) break;
  } else if (expr === 'confused') {
    // a question mark in the top corner, bobbing one row on the second frame
    const q = ['##.', '..#', '.#.', '...', '.#.'];
    const y0 = frame === 1 ? 0 : 1;
    // the free corner first; a monster with ears or a crest there gets it in the other one
    const other = side > 0 ? 1 : DOT_W - 4;
    const spots = [
      ...[y0, y0 + 1, 0, 2].map((y) => art(q, fromEdge(3, 1), y, 'accent')),
      ...[y0, 0, 2].map((y) => art(q, other, y, 'accent')),
    ];
    for (const option of spots) if (place(option)) break;
  }
}

export function paintFrame(m: Model, expr: Expression, frame: number): DotGrid {
  const f = ((frame % DOT_FRAMES[expr]) + DOT_FRAMES[expr]) % DOT_FRAMES[expr];
  const hop = expr === 'happy' && f === 1 ? -1 : 0;
  const c = new Canvas(hop);

  // body
  for (let y = 0; y < DOT_H; y++) {
    const s = m.spans[y];
    if (!s) continue;
    for (let x = s.x0; x <= s.x1; x++) {
      const k = key(x, y);
      let cell: DotCell = m.belly.has(k) ? 'belly' : 'lit';
      const sh = m.shade.get(k);
      if (sh) cell = sh;
      c.set(x, y, cell);
    }
  }

  // parts
  for (const [x, y, cell] of m.head) c.set(x, y, cell);
  for (const [x, y, cell] of m.tail) c.set(x, y, cell);
  for (const [x, y, cell] of m.feet) c.set(x, y, cell);

  // arms: a shoulder dot against the body and a hand one dot away from it
  if (m.g.arms !== 'none') {
    const long = m.g.arms === 'long';
    for (const side of [-1, 1] as const) {
      const y = m.armY;
      const s = m.spans[y];
      if (!s) continue;
      const ex = side < 0 ? s.x0 - 1 : s.x1 + 1;
      let pose: 'rest' | 'up' | 'out' | 'wave' = 'rest';
      if (expr === 'happy') pose = 'up';
      else if (expr === 'error') pose = 'out';
      else if (expr === 'talk' && side > 0 && f === 2) pose = 'wave';
      const hx = ex + side;
      const cells: Pt[] = [[ex, y]];
      switch (pose) {
        case 'rest':
          // hanging down beside the body
          cells.push([ex, y + 1]);
          if (long) cells.push([ex, y + 2]);
          break;
        case 'up':
          cells.push([hx, y - 1]);
          if (long) cells.push([hx, y - 2]);
          break;
        case 'out':
          cells.push([hx, y]);
          if (long) cells.push([hx + side, y - 1]);
          break;
        case 'wave':
          cells.push([hx, y - 1]);
          cells.push([hx, y - 2]);
          break;
      }
      // never through the body, a part or the screen edge; the arm shrinks to a stub if it must
      const free = cells.filter(([x, yy]) => c.isFree(x, yy) && !inBody(m, x, yy));
      if (free.length === cells.length) for (const [x, yy] of cells) c.set(x, yy, 'lit');
      else if (c.isFree(ex, y) && !inBody(m, ex, y)) c.set(ex, y, 'lit');
    }
  }

  // face
  let eye: EyeState = 'open';
  let mouth: MouthState = 'rest';
  switch (expr) {
    case 'idle':
      eye = f === 1 ? 'blink' : 'open';
      break;
    case 'talk':
      // frame 0 (the still) has the mouth open; 1 is closed, 2 wide open
      mouth = f === 0 ? 'talk1' : f === 1 ? 'talk0' : 'talk2';
      break;
    case 'think':
      eye = 'up';
      mouth = 'think';
      break;
    case 'happy':
      eye = 'arc';
      mouth = 'happy';
      break;
    case 'error':
      eye = 'cross';
      mouth = 'error';
      break;
    case 'sleep':
      eye = 'shut';
      mouth = 'sleep';
      break;
    case 'confused':
      // looks to one side, then the other; the third frame is a blink
      eye = f === 0 ? 'aside' : f === 1 ? 'across' : 'blink';
      mouth = 'confused';
      break;
  }
  // the arcs of happy eyes get their little feet only if every eye can have them (symmetry)
  const ends = eye === 'arc' ? arcFeet(m) : [];
  const feetOk =
    ends.every(([x, y]) => {
      const solid = (xx: number, yy: number) => isLight(c.get(xx, yy));
      return (
        solid(x, y) && solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1)
      );
    }) && new Set(ends.map(([x, y]) => key(x, y))).size === ends.length;
  const spaced = ends.every(([x, y], i) =>
    ends.every(([x2, y2], j) => i === j || y !== y2 || Math.abs(x - x2) > 1),
  );
  for (const e of m.eyes) carveEye(c, m, e, eye, feetOk && spaced);
  carveMouth(c, m, mouth);
  if (expr === 'happy') paintCheeks(c, m);

  paintFx(c, m, expr, f);

  const light = expr === 'sleep' ? 0.55 : expr === 'error' && f === 1 ? 0.45 : 1;
  return { width: DOT_W, height: DOT_H, cells: c.cells, light };
}
