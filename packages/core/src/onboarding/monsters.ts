import {
  BODY_SHAPES,
  EYE_KINDS,
  MOUTH_KINDS,
  MonsterGenomeSchema,
  TOPPER_KINDS,
  derivePalette,
  hashString,
  hueDistance,
  isRosterName,
  monsterFor,
  randomGenome,
  slugify,
  type MonsterGenome,
} from '@monsters/monster-kit';
import { z } from 'zod';

/*
 * Monsters of the generated team. Roster names keep their official monster;
 * any other name gets a designed one (`designMonster`): a genome that always
 * satisfies the kit schema, with a hue at least 30° away from the monsters
 * already on the team.
 */

export const MIN_HUE_DISTANCE = 30;

/** Optional look hints a model may give; every field is an enum of the kit. */
export const LookSchema = z
  .object({
    shape: z.enum(BODY_SHAPES).optional(),
    eyes: z.enum(EYE_KINDS).optional(),
    mouth: z.enum(MOUTH_KINDS).optional(),
    topper: z.enum(TOPPER_KINDS).optional(),
  })
  .partial();
export type Look = z.infer<typeof LookSchema>;

/** Smallest distance between `hue` and the hues in `used` (360 when none). */
export function minHueDistance(hue: number, used: readonly number[]): number {
  return used.reduce((m, u) => Math.min(m, hueDistance(hue, u)), 360);
}

/**
 * A hue at least `min` degrees from every used hue: the preferred one when it
 * fits, otherwise the free hue closest to it, otherwise the farthest possible.
 */
export function pickHue(preferred: number, used: readonly number[], min = MIN_HUE_DISTANCE) {
  const norm = ((preferred % 360) + 360) % 360;
  if (minHueDistance(norm, used) >= min) return norm;
  let best = norm;
  let bestScore = -1;
  for (let step = 1; step < 360; step++) {
    for (const h of [(norm + step) % 360, (norm - step + 360) % 360]) {
      const d = minHueDistance(h, used);
      if (d >= min) return h;
      if (d > bestScore) {
        bestScore = d;
        best = h;
      }
    }
  }
  return best;
}

/**
 * Designs the monster of an agent that is not in the roster: a seeded genome
 * from the name (or from `seed` when regenerating), the look hints applied,
 * the hue moved away from `avoidHues`. Always valid for the kit.
 */
export function designMonster(
  name: string,
  options: { avoidHues?: readonly number[]; seed?: number; look?: Look | undefined } = {},
): MonsterGenome {
  const seed = options.seed ?? hashString(name.trim().toLowerCase());
  const base = randomGenome(seed >>> 0, slugify(name), {
    avoidHues: options.avoidHues ?? [],
    minHueDistance: MIN_HUE_DISTANCE,
  });
  const look = LookSchema.safeParse(options.look ?? {});
  const hints = look.success ? look.data : {};
  const genome = {
    ...base,
    body: { ...base.body, ...(hints.shape ? { shape: hints.shape } : {}) },
    eyes: { ...base.eyes, ...(hints.eyes ? { kind: hints.eyes } : {}) },
    mouth: { ...base.mouth, ...(hints.mouth ? { kind: hints.mouth } : {}) },
    topper: hints.topper ? { kind: hints.topper, size: base.topper?.size ?? 1 } : base.topper,
    palette: {
      ...base.palette,
      hue: Math.round(pickHue(base.palette.hue, options.avoidHues ?? []) * 10) / 10,
    },
  };
  // Stalk eyes and a crest or antenna overlap: keep the kit's own rule.
  if (
    genome.eyes.kind === 'stalk' &&
    genome.topper &&
    !['tuft', 'geyser'].includes(genome.topper.kind)
  ) {
    genome.topper = { ...genome.topper, kind: 'tuft' };
  }
  return MonsterGenomeSchema.parse(genome);
}

/**
 * Monster of a team member: the roster one when the name is in the roster and
 * its hue is free, otherwise a designed one.
 */
export function monsterForMember(
  name: string,
  avoidHues: readonly number[],
  look?: Look,
): MonsterGenome {
  const key = name.trim().toLowerCase();
  if (isRosterName(key)) {
    const roster = monsterFor(key);
    if (minHueDistance(roster.palette.hue, avoidHues) >= MIN_HUE_DISTANCE) return roster;
  }
  return designMonster(name, { avoidHues, look });
}

/** Monster of the orchestrator: the roster one for a roster name, Titan's otherwise. */
export function orchestratorMonster(name: string): MonsterGenome {
  const key = name.trim().toLowerCase();
  return isRosterName(key) ? monsterFor(key) : monsterFor('titan');
}

/** Colour of an agent: the body colour of its monster. */
export function colorOfGenome(genome: MonsterGenome): string {
  return derivePalette(genome).base;
}
