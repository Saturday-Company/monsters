import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import {
  CHOSEN,
  DOT_CELLS,
  DOT_FRAMES,
  DOT_H,
  DOT_MIN_CONTRAST,
  DOT_SCREEN,
  DOT_W,
  type DotCell,
  type DotGrid,
  EXPRESSIONS,
  type MonsterGenome,
  MonsterGenomeSchema,
  ROSTER,
  ROSTER_ORDER,
  cellAt,
  contrastRatio,
  createRng,
  dotCss,
  dotGrid,
  dotPalette,
  monsterFor,
  randomGenome,
  renderDots,
  renderDotsText,
} from '../src/index.ts';
import { arbitraryGenome } from './arb.ts';

const LIGHT = new Set<DotCell>(['lit', 'dim', 'belly', 'cheek', 'accent', 'accentDim', 'tooth']);
const HOLE = new Set<DotCell>(['eye', 'mouth', 'glint']);
const isEye = (c: DotCell) => c === 'eye' || c === 'glint';

const roster: MonsterGenome[] = ROSTER_ORDER.flatMap((n) => [
  ROSTER[n].variants.A,
  ROSTER[n].variants.B,
]);
const chosen = ROSTER_ORDER.map((n) => monsterFor(n));
const seeded = Array.from({ length: 200 }, (_, i) => randomGenome(i * 7919 + 13));
const rng = createRng(77);
const arbitrary = Array.from({ length: 200 }, (_, i) =>
  MonsterGenomeSchema.parse(arbitraryGenome(rng, i)),
);
const everyone = [...roster, ...seeded, ...arbitrary];

const frames = (g: MonsterGenome) =>
  EXPRESSIONS.flatMap((e) =>
    Array.from({ length: DOT_FRAMES[e] }, (_, f) => ({ e, f, grid: dotGrid(g, e, f) })),
  );

const neighbours4 = (grid: DotGrid, x: number, y: number) =>
  [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ].map(([nx = 0, ny = 0]) => cellAt(grid, nx, ny));

/** Silhouette as a set of cell indexes: everything that belongs to the monster, holes included. */
const silhouette = (grid: DotGrid): Set<number> => {
  const s = new Set<number>();
  grid.cells.forEach((c, i) => {
    if (c !== 'off') s.add(i);
  });
  return s;
};

describe('dotGrid', () => {
  it('is deterministic and fixed in size', () => {
    for (const g of [...chosen, ...seeded.slice(0, 20)]) {
      for (const e of EXPRESSIONS) {
        const a = dotGrid(g, e, 1);
        expect(a.width).toBe(DOT_W);
        expect(a.height).toBe(DOT_H);
        expect(a.cells).toHaveLength(DOT_W * DOT_H);
        expect(dotGrid(structuredClone(g), e, 1)).toEqual(a);
      }
      expect(renderDots(g)).toBe(renderDots(structuredClone(g)));
    }
    expect(dotGrid(chosen[0] as MonsterGenome)).not.toEqual(dotGrid(chosen[1] as MonsterGenome));
  });

  it('keeps every monster inside the grid, standing on the ground, with headroom', () => {
    const bad: string[] = [];
    const known = new Set<string>(DOT_CELLS);
    const body = new Set<DotCell>([...LIGHT, ...HOLE]);
    for (const g of everyone) {
      for (const { e, f, grid } of frames(g)) {
        const tag = `${g.id} ${e}#${f}`;
        if (!grid.cells.every((c) => known.has(c))) bad.push(`${tag} unknown cell`);
        const hop = e === 'happy' && f === 1;
        const rowHas = (y: number, set: Set<DotCell>) =>
          Array.from({ length: DOT_W }, (_, x) => cellAt(grid, x, y)).some((c) => set.has(c));
        // the body never reaches row 0 at rest: room for hops, thought dots and z's
        if ((e === 'idle' || e === 'talk' || e === 'error') && rowHas(0, body))
          bad.push(`${tag} headroom`);
        // standing on row 14 (or 13 while hopping)
        if (!rowHas(hop ? DOT_H - 2 : DOT_H - 1, LIGHT)) bad.push(`${tag} ground`);
        if (hop && rowHas(DOT_H - 1, body)) bad.push(`${tag} hop`);
        if (!(grid.light > 0 && grid.light <= 1)) bad.push(`${tag} light`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('always shows the eyes, wrapped in light, and never lets them touch the mouth', () => {
    const bad: string[] = [];
    for (const g of everyone) {
      for (const { e, f, grid } of frames(g)) {
        const tag = `${g.id} ${e}#${f}`;
        let eyes = 0;
        let mouth = 0;
        for (let y = 0; y < DOT_H; y++)
          for (let x = 0; x < DOT_W; x++) {
            const c = cellAt(grid, x, y);
            const around = neighbours4(grid, x, y);
            if (isEye(c)) {
              eyes++;
              if (around.includes('off')) bad.push(`${tag} eye at ${x},${y} opens on the screen`);
              if (around.includes('mouth') || around.includes('tooth'))
                bad.push(`${tag} eye at ${x},${y} touches the mouth`);
            }
            if (c === 'mouth') {
              mouth++;
              if (around.includes('off')) bad.push(`${tag} mouth at ${x},${y} opens on the screen`);
            }
          }
        if (eyes === 0) bad.push(`${tag} no eyes`);
        if (mouth === 0) bad.push(`${tag} no mouth`);
        // open eyes always carry their white reflection
        if (((e === 'idle' && f === 0) || e === 'talk') && !grid.cells.includes('glint'))
          bad.push(`${tag} no reflection`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('makes every expression look different from idle', () => {
    for (const g of everyone) {
      const idle = dotGrid(g, 'idle', 0).cells.join();
      for (const e of EXPRESSIONS.filter((x) => x !== 'idle')) {
        // the first frame is the still image (reduced motion): it alone must tell the state
        expect(dotGrid(g, e, 0).cells.join() !== idle, `${g.id} ${e}`).toBe(true);
      }
      // the blink frame is a real blink
      expect(dotGrid(g, 'idle', 1).cells.join()).not.toBe(idle);
      // sleep is dimmer, the error flicker too
      expect(dotGrid(g, 'sleep', 0).light).toBeLessThan(1);
      expect(dotGrid(g, 'error', 1).light).toBeLessThan(1);
    }
  });

  it('is bilaterally symmetric when the genome is', () => {
    let checked = 0;
    const bad: string[] = [];
    for (const base of [...arbitrary, ...seeded]) {
      if (base.body.shape === 'lumpy') continue;
      const g: MonsterGenome = {
        ...base,
        body: { ...base.body, lean: 0 },
        eyes: { ...base.eyes, asym: 0 },
        tail: null,
        marks: null,
      };
      for (const e of ['idle', 'happy', 'talk', 'error'] as const) {
        const grid = dotGrid(g, e, 0);
        // shading and reflections come from the top-left light: compare shapes, not colours
        const kind = (c: DotCell) => (LIGHT.has(c) ? 'L' : HOLE.has(c) ? 'H' : '.');
        for (let y = 0; y < DOT_H; y++)
          for (let x = 0; x < DOT_W; x++)
            if (kind(cellAt(grid, x, y)) !== kind(cellAt(grid, DOT_W - 1 - x, y)))
              bad.push(`${g.id} ${e} ${x},${y}`);
      }
      checked++;
    }
    expect(bad.slice(0, 10)).toEqual([]);
    expect(checked).toBeGreaterThan(200);
  });

  it('gives the seven chosen monsters distinct silhouettes, Titan biggest and Mimas smallest', () => {
    const sil = chosen.map((g) => silhouette(dotGrid(g)));
    // Two monsters must differ in at least 20 dots: about one dot in six of a typical
    // 110-130 dot monster, more than a mark or a moved eye can account for.
    for (let i = 0; i < sil.length; i++)
      for (let j = i + 1; j < sil.length; j++) {
        const a = sil[i] ?? new Set<number>();
        const b = sil[j] ?? new Set<number>();
        const diff =
          [...a].filter((k) => !b.has(k)).length + [...b].filter((k) => !a.has(k)).length;
        expect(diff, `${ROSTER_ORDER[i]} vs ${ROSTER_ORDER[j]}`).toBeGreaterThanOrEqual(20);
      }
    const bodyDots = (g: MonsterGenome) =>
      dotGrid(g).cells.filter((c) => c !== 'off' && c !== 'accent' && c !== 'accentDim').length;
    const sizes = chosen.map(bodyDots);
    const titan = bodyDots(monsterFor('titan'));
    const mimas = bodyDots(monsterFor('mimas'));
    expect(Math.max(...sizes)).toBe(titan);
    expect(Math.min(...sizes)).toBe(mimas);
  });
});

describe('dotPalette', () => {
  it('keeps every light colour at 3:1 or more on the screen', () => {
    for (const g of everyone) {
      const p = dotPalette(g);
      for (const [name, hex] of Object.entries(p) as [string, string][]) {
        expect(hex, name).toMatch(/^#[0-9a-f]{6}$/);
        expect(contrastRatio(hex, DOT_SCREEN), `${g.id} ${name}`).toBeGreaterThanOrEqual(
          DOT_MIN_CONTRAST,
        );
      }
      // lit and dim are clearly two levels
      expect(contrastRatio(p.lit, p.dim)).toBeGreaterThan(1.6);
    }
  });

  it('follows the genome hue', () => {
    const a = dotPalette(monsterFor('titan')).lit;
    const b = dotPalette({
      ...monsterFor('titan'),
      palette: { ...monsterFor('titan').palette, hue: 240 },
    }).lit;
    expect(a).not.toBe(b);
  });
});

describe('renderDots', () => {
  it('draws every frame of an expression in one light SVG', () => {
    for (const g of [...chosen, ...seeded.slice(0, 30)]) {
      for (const e of EXPRESSIONS) {
        const svg = renderDots(g, { expression: e, size: 60, title: 'Titan' });
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg).not.toMatch(/NaN|undefined|Infinity/);
        expect(svg).toContain(`data-expression="${e}"`);
        expect(svg.match(/data-frame="/g)).toHaveLength(DOT_FRAMES[e]);
        // all frames but the first are hidden until dotCss runs them
        expect(svg.match(/visibility="hidden"/g)?.length ?? 0).toBe(DOT_FRAMES[e] - 1);
        expect(svg).toMatch(/--dk-t:[\d.]+;--dk-phase:[\d.]+/);
        expect(svg).toContain('aria-label="Titan"');
        // no filters, no masks, few nodes
        expect(svg).not.toMatch(/<filter|<mask|filter=|mask=/);
        expect((svg.match(/<[a-z]/g) ?? []).length).toBeLessThan(600);
      }
    }
  });

  it('sizes, screens and stills', () => {
    const g = monsterFor('mimas');
    const plain = renderDots(g, { size: 170 });
    expect(plain).toMatch(/width="170" height="150"/);
    const screen = renderDots(g, { size: 190, screen: true });
    expect(screen).toMatch(/width="190" height="170"/);
    expect(screen).toContain('fill="#0d0d0c"');
    const still = renderDots(g, { expression: 'talk', frame: 2 });
    expect(still).not.toContain('data-frame');
    expect(still).toContain('data-animated="off"');
    expect(renderDots(g, { animated: false })).toContain('data-animated="off"');
    expect(renderDots(g)).toContain('data-animated="on"');
    expect(renderDots(g)).toContain('aria-hidden="true"');
    // two monsters do not share a rhythm
    const t = (s: string) =>
      s
        .match(/--dk-t:([\d.]+);--dk-phase:([\d.]+)/)
        ?.slice(1)
        .join();
    expect(t(renderDots(monsterFor('titan')))).not.toBe(t(renderDots(monsterFor('rhea'))));
  });

  it('rasterises with a real renderer', () => {
    for (const g of chosen) {
      const png = new Resvg(renderDots(g, { size: 120, screen: true })).render();
      expect(png.width).toBe(120);
    }
  }, 30_000);

  it('ships CSS that only switches frames and honours reduced motion', () => {
    expect(dotCss).toContain('prefers-reduced-motion: reduce');
    expect(dotCss).toContain('[data-motion="reduced"] svg[data-dots]');
    expect(dotCss).toContain('[data-animated="on"]');
    expect(dotCss).toContain('step-end');
    expect(dotCss).toContain('var(--dk-t');
    expect(dotCss).toContain('var(--dk-phase');
    for (const e of EXPRESSIONS) expect(dotCss).toContain(`[data-expression="${e}"]`);
    const keyframes = dotCss.split('@keyframes').slice(1);
    expect(keyframes.length).toBeGreaterThanOrEqual(
      EXPRESSIONS.reduce((s, e) => s + DOT_FRAMES[e], 0),
    );
    for (const k of keyframes) {
      const body = k.slice(0, k.indexOf('}}') + 2);
      const props = [...body.matchAll(/\{([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(p).toBe('visibility');
    }
  });
});

describe('renderDotsText', () => {
  const ESC = String.fromCharCode(27);
  const strip = (s: string) =>
    s
      .split(ESC)
      .map((p, i) => (i === 0 ? p : p.replace(/^\[[0-9;]*m/, '')))
      .join('');

  it('prints 8 lines of 17 cells with half blocks', () => {
    for (const g of [...chosen, ...seeded.slice(0, 20)]) {
      for (const e of EXPRESSIONS) {
        const ansi = renderDotsText(g, { expression: e });
        expect(ansi).toHaveLength(Math.ceil(DOT_H / 2));
        for (const line of ansi) expect([...strip(line)]).toHaveLength(DOT_W);
        expect(ansi.join('')).toContain('\x1b[38;2;');
        const plain = renderDotsText(g, { expression: e, color: 'none' });
        for (const line of plain) {
          expect([...line]).toHaveLength(DOT_W);
          expect(line).toMatch(/^[ ▀▄█]*$/);
        }
      }
    }
  });

  it('is the same drawing as the grid', () => {
    const g = monsterFor('titan');
    const grid = dotGrid(g);
    const plain = renderDotsText(g, { color: 'none' });
    for (let y = 0; y < DOT_H; y++)
      for (let x = 0; x < DOT_W; x++) {
        const ch = [...(plain[Math.floor(y / 2)] ?? '')][x];
        const on = LIGHT.has(cellAt(grid, x, y));
        const half = y % 2 === 0 ? ['▀', '█'] : ['▄', '█'];
        expect(half.includes(ch ?? ''), `${x},${y}`).toBe(on);
      }
  });
});

describe('roster', () => {
  it('keeps CHOSEN valid for the dot monsters', () => {
    for (const n of ROSTER_ORDER) expect(ROSTER[n].variants[CHOSEN[n]]).toBe(monsterFor(n));
  });
});
