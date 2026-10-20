import {
  ACCENT_KINDS,
  ARM_KINDS,
  BELLY_KINDS,
  BODY_SHAPES,
  EAR_KINDS,
  EYE_KINDS,
  FEET_KINDS,
  HORN_KINDS,
  IRIS_KINDS,
  MARK_KINDS,
  MOUTH_KINDS,
  type MonsterGenomeInput,
  TAIL_KINDS,
  TEETH_KINDS,
  TOPPER_KINDS,
} from '../src/index.ts';
import type { Rng } from '../src/random.ts';

/** Samples the WHOLE schema space (any enum, any in-range number), not only "nice" combos. */
export function arbitraryGenome(r: Rng, i: number): MonsterGenomeInput {
  const num = (min: number, max: number) =>
    r.chance(0.15) ? r.pick([min, max]) : r.range(min, max);
  const maybe = <T>(v: () => T): T | null => (r.chance(0.5) ? v() : null);
  return {
    id: `arb-${i}`,
    seed: r.int(0, 4294967295),
    body: { shape: r.pick(BODY_SHAPES), w: num(0.7, 1.3), h: num(0.7, 1.3), lean: num(-1, 1) },
    palette: {
      hue: num(0, 360),
      chroma: num(0.04, 0.2),
      lightness: num(0.45, 0.85),
      belly: r.pick(BELLY_KINDS),
      accent: r.pick(ACCENT_KINDS),
    },
    eyes: {
      kind: r.pick(EYE_KINDS),
      size: num(0.8, 1.3),
      spacing: num(0.8, 1.2),
      iris: r.pick(IRIS_KINDS),
      asym: num(0, 1),
    },
    mouth: { kind: r.pick(MOUTH_KINDS), width: num(0.7, 1.3), teeth: r.pick(TEETH_KINDS) },
    horns: maybe(() => ({
      kind: r.pick(HORN_KINDS),
      count: r.int(2, 5),
      size: num(0.6, 1.4),
      stripes: r.chance(0.5),
    })),
    ears: maybe(() => ({ kind: r.pick(EAR_KINDS), size: num(0.6, 1.4), spread: num(0, 1) })),
    tail: maybe(() => ({ kind: r.pick(TAIL_KINDS), size: num(0.6, 1.4), stripes: r.chance(0.5) })),
    arms: r.pick(ARM_KINDS),
    feet: r.pick(FEET_KINDS),
    marks: maybe(() => ({ kind: r.pick(MARK_KINDS), density: num(0, 1) })),
    topper: maybe(() => ({ kind: r.pick(TOPPER_KINDS), size: num(0.6, 1.4) })),
    personality: { bounce: num(0, 1), speed: num(0, 1) },
  };
}
