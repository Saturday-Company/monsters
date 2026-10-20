import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import {
  CHOSEN,
  EXPRESSIONS,
  MonsterGenomeSchema,
  type MonsterGenomeInput,
  ROSTER,
  ROSTER_ORDER,
  createRng,
  genomeFromName,
  isRosterName,
  monsterCss,
  monsterFor,
  hueDistance,
  layoutMonster,
  oklchToHex,
  randomGenome,
  renderMonster,
} from '../src/index.ts';
import { arbitraryGenome } from './arb.ts';

const minimal: MonsterGenomeInput = {
  id: 'minimal',
  seed: 1,
  body: { shape: 'egg' },
  palette: { hue: 120 },
  eyes: { kind: 'round' },
  mouth: { kind: 'smile' },
};

describe('MonsterGenome schema', () => {
  it('accepts a minimal genome and fills the defaults', () => {
    const g = MonsterGenomeSchema.parse(minimal);
    expect(g.version).toBe(1);
    expect(g.body.w).toBe(1);
    expect(g.palette.belly).toBe('light');
    expect(g.arms).toBe('stubby');
    expect(g.horns).toBeNull();
    expect(g.personality).toEqual({ bounce: 0.5, speed: 0.5 });
  });

  it('rejects unknown parts and out-of-range numbers', () => {
    const bad = (patch: Record<string, unknown>) =>
      MonsterGenomeSchema.safeParse({ ...minimal, ...patch }).success;
    expect(bad({ eyes: { kind: 'laser' } })).toBe(false);
    expect(bad({ body: { shape: 'egg', w: 3 } })).toBe(false);
    expect(bad({ palette: { hue: 400 } })).toBe(false);
    expect(bad({ palette: { hue: 10, chroma: 0.5 } })).toBe(false);
    expect(bad({ horns: { kind: 'nubs', count: 9 } })).toBe(false);
    expect(bad({ id: 'Not A Slug' })).toBe(false);
    expect(bad({ seed: -1 })).toBe(false);
  });

  it('accepts every roster genome', () => {
    for (const name of ROSTER_ORDER) {
      for (const v of ['A', 'B'] as const)
        expect(MonsterGenomeSchema.safeParse(ROSTER[name].variants[v]).success).toBe(true);
    }
  });
});

describe('renderMonster', () => {
  const rng = createRng(2026);
  const arbitrary = Array.from({ length: 200 }, (_, i) => arbitraryGenome(rng, i));
  const seeded = Array.from({ length: 200 }, (_, i) => randomGenome(i * 7919 + 13));

  it('renders 200 arbitrary schema-valid genomes in every expression', () => {
    for (const input of arbitrary) {
      const g = MonsterGenomeSchema.parse(input);
      for (const expression of EXPRESSIONS) {
        const svg = renderMonster(g, { expression, size: 64 });
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
        expect(svg).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });

  it('renders 200 seeded random genomes, all valid', () => {
    for (const g of seeded) {
      expect(MonsterGenomeSchema.safeParse(g).success).toBe(true);
      for (const expression of EXPRESSIONS)
        expect(renderMonster(g, { expression })).not.toMatch(/NaN|undefined/);
    }
  });

  it('produces SVG that a real renderer can rasterise', () => {
    for (const g of [...arbitrary.slice(0, 15), ...seeded.slice(0, 15)]) {
      const png = new Resvg(renderMonster(g, { size: 64 })).render();
      expect(png.width).toBe(64);
    }
    // The first load of resvg's native binary is slow on Windows runners.
  }, 30_000);

  it('keeps eyes off the mouth, eyes apart and two-eyed faces inside the body', () => {
    for (const input of [...arbitrary, ...seeded]) {
      const L = layoutMonster(MonsterGenomeSchema.parse(input));
      const m = L.boxes.mouth;
      for (const [i, e] of L.eyes.entries()) {
        if (!e.stalkBase) {
          // eye disc must stay above the mouth
          expect(e.c.y + e.r).toBeLessThanOrEqual(m.y0 + 4);
          const span = L.body.span(e.c.y);
          expect(e.c.x - e.r).toBeGreaterThanOrEqual(span.x0);
          expect(e.c.x + e.r).toBeLessThanOrEqual(span.x1);
        }
        for (const o of L.eyes.slice(i + 1)) {
          expect(Math.hypot(o.c.x - e.c.x, o.c.y - e.c.y)).toBeGreaterThanOrEqual(
            (o.r + e.r) * 0.95,
          );
        }
      }
    }
  });
});

describe('genomeFromName', () => {
  it('is deterministic: same name, same SVG', () => {
    for (const name of ['Titan', 'Agente Viaggi', 'Ricercatore', 'ü-ber Bot', '42']) {
      expect(renderMonster(genomeFromName(name))).toBe(renderMonster(genomeFromName(name)));
      expect(genomeFromName(name)).toEqual(
        genomeFromName(`  ${name.toUpperCase()} `.toLowerCase()),
      );
    }
  });

  it('gives different names different monsters, always valid', () => {
    const names = Array.from({ length: 100 }, (_, i) => `agente-${i}`);
    const svgs = new Set(names.map((n) => renderMonster(genomeFromName(n))));
    expect(svgs.size).toBe(names.length);
    for (const n of names)
      expect(MonsterGenomeSchema.safeParse(genomeFromName(n)).success).toBe(true);
  });

  it('keeps away from hues already taken when asked', () => {
    const taken = [0, 60, 120, 180, 240, 300];
    const g = genomeFromName('Nuovo agente', { avoidHues: taken, minHueDistance: 25 });
    expect(Math.min(...taken.map((h) => hueDistance(h, g.palette.hue)))).toBeGreaterThanOrEqual(25);
  });
});

describe('roster and colour', () => {
  it('has the seven moons with two variants each', () => {
    expect(ROSTER_ORDER).toHaveLength(7);
    for (const n of ROSTER_ORDER) {
      expect(ROSTER[n].variants.A.id).toBe(n);
      expect(ROSTER[n].variants.B.id).toBe(n);
    }
  });

  it('keeps every pair of monsters at least 30° apart in hue, whichever variants are picked', () => {
    for (const [i, a] of ROSTER_ORDER.entries()) {
      for (const b of ROSTER_ORDER.slice(i + 1)) {
        for (const va of ['A', 'B'] as const) {
          for (const vb of ['A', 'B'] as const) {
            const d = hueDistance(
              ROSTER[a].variants[va].palette.hue,
              ROSTER[b].variants[vb].palette.hue,
            );
            expect(d, `${a}${va} vs ${b}${vb}`).toBeGreaterThanOrEqual(30);
          }
        }
      }
    }
  });

  it('Titan is the biggest and Mimas the smallest', () => {
    const area = (n: keyof typeof ROSTER) => {
      const b = layoutMonster(ROSTER[n].variants.A).body;
      return (b.right - b.left) * (b.bottom - b.top);
    };
    for (const n of ROSTER_ORDER) {
      if (n !== 'titan') expect(area('titan')).toBeGreaterThan(area(n));
      if (n !== 'mimas') expect(area('mimas')).toBeLessThan(area(n));
    }
  });

  it('converts OKLCH to sRGB hex', () => {
    expect(oklchToHex({ l: 1, c: 0, h: 0 })).toBe('#ffffff');
    expect(oklchToHex({ l: 0, c: 0, h: 0 })).toBe('#000000');
    expect(oklchToHex({ l: 0.628, c: 0.2577, h: 29.23 })).toBe('#ff0000');
    // out-of-gamut colours are mapped, never NaN
    expect(oklchToHex({ l: 0.7, c: 0.4, h: 150 })).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('chosen team', () => {
  it('monsterFor returns the variants Giulio picked', () => {
    const picks = {
      titan: 'A',
      rhea: 'A',
      dione: 'B',
      tethys: 'A',
      enceladus: 'A',
      hyperion: 'A',
      mimas: 'A',
    };
    expect(CHOSEN).toEqual(picks);
    for (const n of ROSTER_ORDER) {
      expect(monsterFor(n)).toBe(ROSTER[n].variants[picks[n] as 'A' | 'B']);
      expect(MonsterGenomeSchema.safeParse(monsterFor(n)).success).toBe(true);
    }
    expect(isRosterName('tethys')).toBe(true);
    expect(isRosterName('toString')).toBe(false);
  });
});

describe('mouth and belly', () => {
  const rng = createRng(77);
  const genomes = [
    ...ROSTER_ORDER.flatMap((n) => [ROSTER[n].variants.A, ROSTER[n].variants.B]),
    ...Array.from({ length: 200 }, (_, i) => MonsterGenomeSchema.parse(arbitraryGenome(rng, i))),
  ];

  it('never lets the belly edge cross the mouth: it is wholly inside or wholly below', () => {
    for (const g of genomes) {
      const L = layoutMonster(g);
      const b = L.belly;
      if (!b) continue;
      const m = L.mouth;
      const inside = (x: number, y: number, pad: number) =>
        ((x - b.c.x) / (b.rx - pad)) ** 2 + ((y - b.c.y) / (b.ry - pad)) ** 2 <= 1;
      const corners = [
        { x: m.c.x - m.w / 2, y: m.c.y },
        { x: m.c.x + m.w / 2, y: m.c.y },
      ];
      const contained = corners.every((p) => inside(p.x, p.y, 2));
      const below = b.c.y - b.ry >= m.c.y + 4;
      expect(contained || below, g.id).toBe(true);
    }
  });

  it('draws the open mouth of Tethys with a curved upper lip', () => {
    const svg = renderMonster(monsterFor('tethys'));
    const d = /<clipPath id="[^"]*mclip-idle"><path d="M([\d.]+) ([\d.]+)C[\d.]+ ([\d.]+)/.exec(
      svg,
    );
    expect(d).not.toBeNull();
    // the first control point of the lip sits well below the corner: a smile, not a ruler
    expect(Number(d?.[3]) - Number(d?.[2])).toBeGreaterThan(4);
  });
});

describe('animation hooks', () => {
  const has = (svg: string, cls: string) => svg.includes(`class="${cls}"`);

  it('tags every animatable part with a stable class and a pivot', () => {
    const rng = createRng(4242);
    const genomes = [
      ...ROSTER_ORDER.map((n) => monsterFor(n)),
      ...Array.from({ length: 200 }, (_, i) => MonsterGenomeSchema.parse(arbitraryGenome(rng, i))),
    ];
    for (const g of genomes) {
      for (const expression of EXPRESSIONS) {
        const svg = renderMonster(g, { expression });
        for (const cls of [
          'm-root',
          'm-shadow',
          'm-body',
          'm-torso',
          'm-face',
          'm-eyes',
          'm-mouth',
        ])
          expect(has(svg, cls), `${g.id} ${expression} ${cls}`).toBe(true);
        expect(svg).toMatch(/class="m-body" style="transform-origin:[\d.]+px 186px"/);
        expect(svg).toMatch(/class="m-mouth" data-pivot/);
        if (expression !== 'happy' && expression !== 'sleep') {
          expect(has(svg, 'm-pupil')).toBe(true);
          // one lid per open eye, collapsed by default
          expect(svg.match(/class="m-lid" transform="scale\(1 0\)"/g)?.length).toBe(
            layoutMonster(g).eyes.length,
          );
        }
        if (g.arms !== 'none') {
          expect(svg).toMatch(/class="m-arm-l" data-pivot/);
          expect(svg).toMatch(/class="m-arm-r" data-pivot/);
        }
        if (g.feet !== 'none') expect(svg).toMatch(/class="m-feet" data-pivot/);
        if (g.tail) expect(svg).toMatch(/class="m-tail" data-pivot/);
        if (g.topper) expect(svg).toMatch(/class="m-topper" data-pivot/);
        expect(svg).toContain(`--m-bounce:${g.personality.bounce.toFixed(2)}`);
      }
    }
  });

  it('ships CSS that animates only transform and opacity and honours reduced motion', () => {
    expect(monsterCss).toContain('prefers-reduced-motion: reduce');
    // and the host's own switch, on an ancestor
    expect(monsterCss).toContain('[data-motion="reduced"] svg[data-monster] *');
    for (const cls of [
      '.m-body',
      '.m-lid',
      '.m-pupil',
      '.m-mouth',
      '.m-arm-r',
      '.m-tail',
      '.m-topper',
    ])
      expect(monsterCss).toContain(cls);
    expect(monsterCss).toContain('var(--m-bounce');
    expect(monsterCss).toContain('var(--m-speed');
    const keyframes = monsterCss.split('@keyframes').slice(1);
    expect(keyframes.length).toBeGreaterThan(8);
    for (const k of keyframes) {
      const body = k.slice(0, k.indexOf('\n}') + 2);
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(['transform', 'opacity']).toContain(p);
    }
  });
});
