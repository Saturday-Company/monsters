import { z } from 'zod';

/**
 * MonsterGenome v1. Every field is an enum or a bounded number so that an LLM
 * with structured output (or a seeded RNG) can only produce renderable monsters.
 */

export const BODY_SHAPES = ['blob', 'egg', 'pear', 'bean', 'dome', 'lumpy'] as const;
export const BELLY_KINDS = ['none', 'light', 'contrast'] as const;
export const ACCENT_KINDS = ['cream', 'gold', 'analogous', 'complement', 'tone'] as const;
export const EYE_KINDS = ['round', 'cyclops', 'stalk', 'trio'] as const;
export const IRIS_KINDS = ['complement', 'amber', 'brown', 'teal', 'violet', 'green'] as const;
export const MOUTH_KINDS = ['smile', 'grin', 'canyon', 'tiny'] as const;
export const TEETH_KINDS = ['none', 'fangs', 'row', 'buck'] as const;
export const HORN_KINDS = ['nubs', 'curved', 'spike'] as const;
export const EAR_KINDS = ['long', 'round', 'pointy', 'fin'] as const;
export const TAIL_KINDS = ['plume', 'spiky', 'curl'] as const;
export const ARM_KINDS = ['none', 'stubby', 'long'] as const;
export const FEET_KINDS = ['none', 'stubby', 'claws'] as const;
export const MARK_KINDS = ['spots', 'craters', 'sponge', 'stripes'] as const;
export const TOPPER_KINDS = ['tuft', 'antenna', 'crest', 'geyser'] as const;
/** `confused`: a monster going round in circles (the instinct's "gira a vuoto?", D-067). */
export const EXPRESSIONS = [
  'idle',
  'talk',
  'think',
  'happy',
  'error',
  'sleep',
  'confused',
] as const;

export type Expression = (typeof EXPRESSIONS)[number];

const unit = z.number().min(0).max(1);
const scale = (min: number, max: number) => z.number().min(min).max(max);

export const BodySchema = z.object({
  shape: z.enum(BODY_SHAPES),
  /** Width multiplier of the body silhouette. */
  w: scale(0.7, 1.3).default(1),
  /** Height multiplier of the body silhouette. */
  h: scale(0.7, 1.3).default(1),
  /** Leans the top of the body sideways (-1 left, 1 right). */
  lean: scale(-1, 1).default(0),
});

export const PaletteSchema = z.object({
  /** OKLCH hue of the body, 0–360. Everything else is derived from it. */
  hue: scale(0, 360),
  /** OKLCH chroma of the body colour. */
  chroma: scale(0.04, 0.2).default(0.13),
  /** OKLCH lightness of the body colour. */
  lightness: scale(0.45, 0.85).default(0.72),
  belly: z.enum(BELLY_KINDS).default('light'),
  /** Colour family of horns, crests and claws. */
  accent: z.enum(ACCENT_KINDS).default('cream'),
});

export const EyesSchema = z.object({
  kind: z.enum(EYE_KINDS),
  size: scale(0.8, 1.3).default(1),
  /** Horizontal spacing multiplier for two-eyed kinds. */
  spacing: scale(0.8, 1.2).default(1),
  iris: z.enum(IRIS_KINDS).default('complement'),
  /** 0 = symmetric eyes, 1 = one eye noticeably bigger. */
  asym: unit.default(0),
});

export const MouthSchema = z.object({
  kind: z.enum(MOUTH_KINDS),
  width: scale(0.7, 1.3).default(1),
  teeth: z.enum(TEETH_KINDS).default('none'),
});

export const HornsSchema = z.object({
  kind: z.enum(HORN_KINDS),
  /** Number of horns; only `nubs` uses more than two. */
  count: z.int().min(2).max(5).default(2),
  size: scale(0.6, 1.4).default(1),
  stripes: z.boolean().default(false),
});

export const EarsSchema = z.object({
  kind: z.enum(EAR_KINDS),
  size: scale(0.6, 1.4).default(1),
  /** 0 = upright, 1 = sticking out sideways. */
  spread: unit.default(0.3),
});

export const TailSchema = z.object({
  kind: z.enum(TAIL_KINDS),
  size: scale(0.6, 1.4).default(1),
  stripes: z.boolean().default(false),
});

export const MarksSchema = z.object({
  kind: z.enum(MARK_KINDS),
  density: unit.default(0.5),
});

export const TopperSchema = z.object({
  kind: z.enum(TOPPER_KINDS),
  size: scale(0.6, 1.4).default(1),
});

export const PersonalitySchema = z.object({
  bounce: unit.default(0.5),
  speed: unit.default(0.5),
});

export const MonsterGenomeSchema = z.object({
  version: z.literal(1).default(1),
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  seed: z.int().min(0).max(4294967295),
  body: BodySchema,
  palette: PaletteSchema,
  eyes: EyesSchema,
  mouth: MouthSchema,
  horns: HornsSchema.nullable().default(null),
  ears: EarsSchema.nullable().default(null),
  tail: TailSchema.nullable().default(null),
  arms: z.enum(ARM_KINDS).default('stubby'),
  feet: z.enum(FEET_KINDS).default('stubby'),
  marks: MarksSchema.nullable().default(null),
  topper: TopperSchema.nullable().default(null),
  personality: PersonalitySchema.default({ bounce: 0.5, speed: 0.5 }),
});

/** Fully resolved genome (defaults applied). */
export type MonsterGenome = z.output<typeof MonsterGenomeSchema>;
/** Genome as accepted from outside (defaults optional). */
export type MonsterGenomeInput = z.input<typeof MonsterGenomeSchema>;

export function parseGenome(input: unknown): MonsterGenome {
  return MonsterGenomeSchema.parse(input);
}
