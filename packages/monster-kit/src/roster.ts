import { type MonsterGenome, type MonsterGenomeInput, MonsterGenomeSchema } from './genome.ts';
import { hashString } from './random.ts';

/**
 * The seven original monsters, named after moons of Saturn. Each has two concept
 * variants (A and B); the maintainer picked one per monster.
 */

export type RosterName = 'titan' | 'rhea' | 'dione' | 'tethys' | 'enceladus' | 'hyperion' | 'mimas';

export interface RosterEntry {
  name: string;
  role: string;
  /** What the monster borrows from its moon. */
  trait: string;
  variants: { A: MonsterGenome; B: MonsterGenome };
}

const g = (
  id: string,
  variant: 'a' | 'b',
  rest: Omit<MonsterGenomeInput, 'id' | 'seed'>,
): MonsterGenome =>
  MonsterGenomeSchema.parse({ id, seed: hashString(`${id}-${variant}`), ...rest });

export const ROSTER: Record<RosterName, RosterEntry> = {
  titan: {
    name: 'Titan',
    role: 'orchestratore',
    trait: 'la luna più grande, atmosfera arancione: il più grosso, ambra, corona di cornini',
    variants: {
      A: g('titan', 'a', {
        body: { shape: 'blob', w: 1.3, h: 1.26 },
        palette: { hue: 62, chroma: 0.16, lightness: 0.76, belly: 'light', accent: 'cream' },
        eyes: { kind: 'round', size: 1.05, iris: 'complement' },
        mouth: { kind: 'grin', width: 1.05, teeth: 'fangs' },
        horns: { kind: 'nubs', count: 5, size: 1.05 },
        arms: 'stubby',
        feet: 'stubby',
        personality: { bounce: 0.35, speed: 0.4 },
      }),
      B: g('titan', 'b', {
        body: { shape: 'dome', w: 1.3, h: 1.22 },
        palette: { hue: 55, chroma: 0.15, lightness: 0.72, belly: 'light', accent: 'cream' },
        eyes: { kind: 'round', size: 0.95, spacing: 1.05, iris: 'brown' },
        mouth: { kind: 'smile', width: 1.15, teeth: 'fangs' },
        horns: { kind: 'nubs', count: 4, size: 1.2 },
        arms: 'long',
        feet: 'claws',
        marks: { kind: 'spots', density: 0.3 },
        personality: { bounce: 0.3, speed: 0.35 },
      }),
    },
  },
  rhea: {
    name: 'Rhea',
    role: 'agente',
    trait: 'ghiacciata e piena di crateri: lilla, orecchie lunghe, macchie-cratere',
    variants: {
      A: g('rhea', 'a', {
        body: { shape: 'egg', w: 0.98, h: 1.0 },
        palette: { hue: 280, chroma: 0.1, lightness: 0.74, belly: 'light', accent: 'tone' },
        eyes: { kind: 'round', size: 1.1, iris: 'violet' },
        mouth: { kind: 'grin', width: 0.85, teeth: 'buck' },
        ears: { kind: 'long', size: 1.1, spread: 0.15 },
        arms: 'stubby',
        feet: 'stubby',
        marks: { kind: 'craters', density: 0.6 },
        personality: { bounce: 0.6, speed: 0.5 },
      }),
      B: g('rhea', 'b', {
        body: { shape: 'bean', w: 0.95, h: 0.98 },
        palette: { hue: 272, chroma: 0.11, lightness: 0.7, belly: 'none', accent: 'tone' },
        eyes: { kind: 'round', size: 1.0, spacing: 1.05, iris: 'teal' },
        mouth: { kind: 'tiny', width: 1.0, teeth: 'fangs' },
        ears: { kind: 'long', size: 1.05, spread: 0.45 },
        arms: 'long',
        feet: 'stubby',
        marks: { kind: 'craters', density: 0.9 },
        personality: { bounce: 0.5, speed: 0.45 },
      }),
    },
  },
  dione: {
    name: 'Dione',
    role: 'agente',
    trait: 'scogliere di ghiaccio "a fili": verde menta, coda a pennacchio con strisce',
    variants: {
      A: g('dione', 'a', {
        body: { shape: 'pear', w: 0.95, h: 0.96 },
        palette: { hue: 165, chroma: 0.11, lightness: 0.8, belly: 'light', accent: 'cream' },
        eyes: { kind: 'round', size: 1.05, iris: 'brown' },
        mouth: { kind: 'grin', width: 0.9, teeth: 'buck' },
        tail: { kind: 'plume', size: 1.05, stripes: true },
        topper: { kind: 'tuft', size: 1.25 },
        arms: 'stubby',
        feet: 'stubby',
        personality: { bounce: 0.7, speed: 0.65 },
      }),
      B: g('dione', 'b', {
        body: { shape: 'blob', w: 0.98, h: 1.06 },
        palette: {
          hue: 160,
          chroma: 0.12,
          lightness: 0.76,
          belly: 'contrast',
          accent: 'analogous',
        },
        eyes: { kind: 'cyclops', size: 1.0, iris: 'amber' },
        mouth: { kind: 'grin', width: 1.0, teeth: 'fangs' },
        tail: { kind: 'plume', size: 1.15, stripes: true },
        ears: { kind: 'pointy', size: 0.9, spread: 0.5 },
        arms: 'stubby',
        feet: 'claws',
        personality: { bounce: 0.75, speed: 0.7 },
      }),
    },
  },
  tethys: {
    name: 'Tethys',
    role: 'agente',
    trait: 'un canyon enorme (Ithaca Chasma): rosa corallo, bocca larghissima, due zanne',
    variants: {
      A: g('tethys', 'a', {
        body: { shape: 'dome', w: 1.05, h: 0.98 },
        palette: { hue: 22, chroma: 0.14, lightness: 0.74, belly: 'light', accent: 'cream' },
        eyes: { kind: 'round', size: 0.95, spacing: 1.1, iris: 'teal' },
        mouth: { kind: 'canyon', width: 1.1, teeth: 'fangs' },
        ears: { kind: 'round', size: 0.95, spread: 0.3 },
        arms: 'stubby',
        feet: 'stubby',
        personality: { bounce: 0.55, speed: 0.5 },
      }),
      B: g('tethys', 'b', {
        body: { shape: 'bean', w: 1.0, h: 1.02 },
        palette: { hue: 18, chroma: 0.15, lightness: 0.72, belly: 'contrast', accent: 'gold' },
        eyes: { kind: 'trio', size: 1.0, iris: 'green' },
        mouth: { kind: 'canyon', width: 1.15, teeth: 'fangs' },
        horns: { kind: 'spike', size: 0.9, stripes: false },
        arms: 'long',
        feet: 'claws',
        personality: { bounce: 0.5, speed: 0.55 },
      }),
    },
  },
  enceladus: {
    name: 'Enceladus',
    role: 'agente',
    trait:
      'bianca brillante, geyser dal polo sud: azzurro ghiaccio, ciuffo-geyser, occhi su antenne',
    variants: {
      A: g('enceladus', 'a', {
        body: { shape: 'egg', w: 0.96, h: 0.95 },
        palette: { hue: 222, chroma: 0.08, lightness: 0.82, belly: 'light', accent: 'tone' },
        eyes: { kind: 'stalk', size: 1.0, iris: 'complement' },
        mouth: { kind: 'grin', width: 1.0, teeth: 'fangs' },
        topper: { kind: 'geyser', size: 1.0 },
        arms: 'stubby',
        feet: 'stubby',
        personality: { bounce: 0.8, speed: 0.75 },
      }),
      B: g('enceladus', 'b', {
        body: { shape: 'blob', w: 1.0, h: 0.95 },
        palette: { hue: 215, chroma: 0.09, lightness: 0.8, belly: 'light', accent: 'tone' },
        eyes: { kind: 'stalk', size: 1.1, spacing: 1.1, iris: 'amber' },
        mouth: { kind: 'smile', width: 1.0, teeth: 'fangs' },
        topper: { kind: 'geyser', size: 0.85 },
        arms: 'long',
        feet: 'stubby',
        marks: { kind: 'spots', density: 0.3 },
        personality: { bounce: 0.8, speed: 0.8 },
      }),
    },
  },
  hyperion: {
    name: 'Hyperion',
    role: 'agente',
    trait: 'spugnosa e irregolare: giallo senape, macchie a spugna, sagoma asimmetrica',
    variants: {
      A: g('hyperion', 'a', {
        body: { shape: 'lumpy', w: 1.02, h: 0.98, lean: 0.55 },
        palette: { hue: 100, chroma: 0.14, lightness: 0.8, belly: 'none', accent: 'analogous' },
        eyes: { kind: 'round', size: 1.05, iris: 'brown', asym: 0.8 },
        mouth: { kind: 'grin', width: 1.0, teeth: 'row' },
        topper: { kind: 'antenna', size: 0.9 },
        arms: 'stubby',
        feet: 'claws',
        marks: { kind: 'sponge', density: 0.7 },
        personality: { bounce: 0.6, speed: 0.4 },
      }),
      B: g('hyperion', 'b', {
        body: { shape: 'lumpy', w: 1.05, h: 1.0, lean: -0.7 },
        palette: { hue: 95, chroma: 0.13, lightness: 0.78, belly: 'light', accent: 'cream' },
        eyes: { kind: 'trio', size: 1.0, iris: 'violet', asym: 0 },
        mouth: { kind: 'smile', width: 1.0, teeth: 'fangs' },
        horns: { kind: 'curved', size: 0.85, stripes: true },
        arms: 'long',
        feet: 'stubby',
        marks: { kind: 'sponge', density: 0.5 },
        personality: { bounce: 0.55, speed: 0.4 },
      }),
    },
  },
  mimas: {
    name: 'Mimas',
    role: 'agente',
    trait: 'il cratere Herschel sembra un occhio gigante: il più piccolo, ciclope, viola scuro',
    variants: {
      A: g('mimas', 'a', {
        body: { shape: 'blob', w: 0.82, h: 0.88 },
        palette: { hue: 315, chroma: 0.14, lightness: 0.5, belly: 'light', accent: 'gold' },
        eyes: { kind: 'cyclops', size: 1.3, iris: 'amber' },
        mouth: { kind: 'tiny', width: 1.0, teeth: 'fangs' },
        horns: { kind: 'spike', size: 1.1 },
        arms: 'stubby',
        feet: 'stubby',
        personality: { bounce: 0.9, speed: 0.9 },
      }),
      B: g('mimas', 'b', {
        body: { shape: 'dome', w: 0.78, h: 0.8 },
        palette: { hue: 312, chroma: 0.13, lightness: 0.48, belly: 'none', accent: 'complement' },
        eyes: { kind: 'cyclops', size: 1.3, iris: 'green' },
        mouth: { kind: 'smile', width: 0.9, teeth: 'fangs' },
        topper: { kind: 'antenna', size: 1.0 },
        tail: { kind: 'spiky', size: 0.9 },
        arms: 'stubby',
        feet: 'claws',
        marks: { kind: 'spots', density: 0.4 },
        personality: { bounce: 0.95, speed: 0.95 },
      }),
    },
  },
};

export const ROSTER_ORDER: readonly RosterName[] = [
  'titan',
  'rhea',
  'dione',
  'tethys',
  'enceladus',
  'hyperion',
  'mimas',
];

export type RosterVariant = 'A' | 'B';

/** The final picks (M1.4): the official look of each roster agent. */
export const CHOSEN: Readonly<Record<RosterName, RosterVariant>> = {
  titan: 'A',
  rhea: 'A',
  dione: 'B',
  tethys: 'A',
  enceladus: 'A',
  hyperion: 'A',
  mimas: 'A',
};

export const isRosterName = (name: string): name is RosterName =>
  Object.prototype.hasOwnProperty.call(ROSTER, name);

/** The official genome of a roster agent (its chosen variant). */
export function monsterFor(name: RosterName): MonsterGenome {
  return ROSTER[name].variants[CHOSEN[name]];
}
