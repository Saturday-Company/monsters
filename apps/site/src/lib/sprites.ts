/*
 * Dot monsters for the canvas parts of the page (the hero's Titan, the invaders). The grids are
 * painted by @monsters/monster-kit at build time and shipped as short strings, so those parts
 * do not need the kit (and zod) in the browser. Decoding is pure and lives here too.
 */

export const SPRITE_W = 17;
export const SPRITE_H = 15;

/** Order of the colour slots; the cell character is the slot index, `.` is a dark dot. */
export const SLOTS = ['lit', 'dim', 'accent', 'accentDim', 'glint', 'belly', 'cheek'] as const;
export type Slot = (typeof SLOTS)[number];

export interface Sprite {
  name: string;
  /** Hex colour of each slot, in `SLOTS` order. */
  colors: string[];
  /** Per expression: frames as strings of SPRITE_W × SPRITE_H characters, and their light. */
  frames: Record<string, { cells: string[]; light: number[] }>;
}

export interface DecodedDot {
  x: number;
  y: number;
  color: string;
}

/** The lit dots of one frame, with their colour. */
export function decodeFrame(sprite: Sprite, cells: string): DecodedDot[] {
  const out: DecodedDot[] = [];
  for (let i = 0; i < cells.length; i++) {
    const ch = cells.charAt(i);
    if (ch === '.') continue;
    const color = sprite.colors[Number(ch)];
    if (color) out.push({ x: i % SPRITE_W, y: Math.floor(i / SPRITE_W), color });
  }
  return out;
}

/** Cell kind (from the kit's `DotCell`) → slot character. */
export function cellChar(cell: string): string {
  if (cell === 'tooth') return String(SLOTS.indexOf('glint'));
  const i = SLOTS.indexOf(cell as Slot);
  return i >= 0 ? String(i) : '.';
}
