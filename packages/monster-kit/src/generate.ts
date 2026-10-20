import { hueDistance } from './color.ts';
import {
  BODY_SHAPES,
  EAR_KINDS,
  HORN_KINDS,
  IRIS_KINDS,
  MARK_KINDS,
  type MonsterGenome,
  MonsterGenomeSchema,
  TAIL_KINDS,
  TOPPER_KINDS,
} from './genome.ts';
import { createRng, hashString } from './random.ts';

const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;

/** Turns a display name into a valid genome id (slug). */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || `monster-${hashString(name).toString(36)}`;
}

export interface GenerateOptions {
  /** Hues already taken by other monsters; the generator keeps at least `minHueDistance` from them when it can. */
  avoidHues?: readonly number[];
  minHueDistance?: number;
}

/** Seeded random genome. Always valid; mostly "nice" combinations. */
export function randomGenome(
  seed: number,
  id = `monster-${seed.toString(36)}`,
  opts: GenerateOptions = {},
): MonsterGenome {
  const r = createRng(seed);
  const minD = opts.minHueDistance ?? 30;
  let hue = r.range(0, 360);
  for (let i = 0; i < 24 && (opts.avoidHues ?? []).some((h) => hueDistance(h, hue) < minD); i++)
    hue = (hue + 37) % 360;

  const eyes = r.weighted([
    ['round', 5],
    ['cyclops', 2],
    ['trio', 1.2],
    ['stalk', 1.2],
  ] as const);
  const headSlot = r.weighted([
    ['horns', 3],
    ['ears', 3],
    ['none', 2],
  ] as const);
  const topper = eyes === 'stalk' ? r.chance(0.3) : r.chance(0.4);

  const genome = {
    version: 1,
    id,
    seed,
    body: {
      shape: r.pick(BODY_SHAPES),
      w: round(r.range(0.9, 1.15)),
      h: round(r.range(0.9, 1.15)),
      lean: r.chance(0.25) ? round(r.range(-0.6, 0.6)) : 0,
    },
    palette: {
      hue: round(hue, 1),
      chroma: round(r.range(0.1, 0.16), 3),
      lightness: round(r.range(0.62, 0.8), 3),
      belly: r.weighted([
        ['light', 5],
        ['contrast', 2],
        ['none', 2],
      ] as const),
      accent: r.weighted([
        ['cream', 3],
        ['gold', 2],
        ['analogous', 2],
        ['complement', 1],
        ['tone', 1],
      ] as const),
    },
    eyes: {
      kind: eyes,
      size: round(r.range(0.9, 1.2)),
      spacing: round(r.range(0.9, 1.1)),
      iris: r.pick(IRIS_KINDS),
      asym: r.chance(0.2) ? round(r.range(0.3, 1)) : 0,
    },
    mouth: {
      kind: r.weighted([
        ['grin', 4],
        ['smile', 3],
        ['canyon', 1.5],
        ['tiny', 1.5],
      ] as const),
      width: round(r.range(0.85, 1.15)),
      teeth: r.weighted([
        ['fangs', 4],
        ['none', 2],
        ['row', 1.5],
        ['buck', 1],
      ] as const),
    },
    horns:
      headSlot === 'horns'
        ? {
            kind: r.pick(HORN_KINDS),
            count: r.int(3, 5),
            size: round(r.range(0.85, 1.15)),
            stripes: r.chance(0.5),
          }
        : null,
    ears:
      headSlot === 'ears'
        ? {
            kind: r.pick(EAR_KINDS),
            size: round(r.range(0.85, 1.15)),
            spread: round(r.range(0, 0.8)),
          }
        : null,
    tail: r.chance(0.35)
      ? { kind: r.pick(TAIL_KINDS), size: round(r.range(0.85, 1.1)), stripes: r.chance(0.5) }
      : null,
    arms: r.weighted([
      ['stubby', 5],
      ['long', 3],
      ['none', 1],
    ] as const),
    feet: r.weighted([
      ['stubby', 5],
      ['claws', 3],
      ['none', 1],
    ] as const),
    marks: r.chance(0.55) ? { kind: r.pick(MARK_KINDS), density: round(r.range(0.2, 0.8)) } : null,
    topper: topper
      ? {
          kind: eyes === 'stalk' ? r.pick(['tuft', 'geyser'] as const) : r.pick(TOPPER_KINDS),
          size: round(r.range(0.85, 1.15)),
        }
      : null,
    personality: { bounce: round(r.next()), speed: round(r.next()) },
  };
  return MonsterGenomeSchema.parse(genome);
}

/** Deterministic genome from a name: same name (case/space-insensitive), same monster. */
export function genomeFromName(name: string, opts: GenerateOptions = {}): MonsterGenome {
  const key = name.trim().toLowerCase();
  return randomGenome(hashString(key), slugify(name), opts);
}
