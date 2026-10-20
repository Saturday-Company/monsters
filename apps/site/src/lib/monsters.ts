/*
 * Build-time access to the real monsters of @monsters/monster-kit: the roster, prerendered dot
 * SVGs, the compact sprites for the canvases and the half-block terminal art as HTML. Never
 * imported by browser code (the generator imports the kit on its own, lazily).
 */
import {
  DOT_FRAMES,
  DOT_GLINT,
  ROSTER,
  ROSTER_ORDER,
  cellAt,
  dotGrid,
  dotPalette,
  genomeFromName,
  monsterFor,
  renderDots,
  type DotCell,
  type Expression,
  type MonsterGenome,
  type RosterName,
} from '@monsters/monster-kit';
import { SLOTS, SPRITE_H, SPRITE_W, cellChar, type Sprite } from './sprites.ts';

export interface SquadMember {
  key: RosterName;
  name: string;
  genome: MonsterGenome;
}

export const SQUAD: SquadMember[] = ROSTER_ORDER.map((key) => ({
  key,
  name: ROSTER[key].name,
  genome: monsterFor(key),
}));

export const titan = (): MonsterGenome => monsterFor('titan');

/** One prerendered SVG of a monster in one expression. */
export function dotsSvg(
  genome: MonsterGenome,
  expression: Expression,
  opts: { size?: number; title?: string; screen?: boolean; animated?: boolean } = {},
): string {
  return renderDots(genome, {
    expression,
    size: opts.size ?? 170,
    ...(opts.title ? { title: opts.title } : {}),
    screen: opts.screen ?? false,
    animated: opts.animated ?? true,
    idPrefix: `${genome.id}-${expression}`,
  });
}

/** A genome for a name (contributors, the generator's default). */
export const genomeFor = (name: string): MonsterGenome => genomeFromName(name);

/** The compact sprite of a monster for the canvases. */
export function spriteOf(genome: MonsterGenome, name: string, expressions: Expression[]): Sprite {
  const p = dotPalette(genome);
  const colors = SLOTS.map((s) => (s === 'glint' ? DOT_GLINT : p[s]));
  const frames: Sprite['frames'] = {};
  for (const expr of expressions) {
    const cells: string[] = [];
    const light: number[] = [];
    for (let f = 0; f < DOT_FRAMES[expr]; f++) {
      const grid = dotGrid(genome, expr, f);
      let s = '';
      for (let y = 0; y < SPRITE_H; y++)
        for (let x = 0; x < SPRITE_W; x++) s += cellChar(cellAt(grid, x, y));
      cells.push(s);
      light.push(grid.light);
    }
    frames[expr] = { cells, light };
  }
  return { name, colors, frames };
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The monster as `renderDotsText` prints it in the terminal (`monsters chat`): two grid rows
 * per line with half blocks, coloured with spans instead of ANSI codes. Same algorithm.
 */
export function halfBlockLines(genome: MonsterGenome, expression: Expression = 'idle'): string[] {
  const grid = dotGrid(genome, expression, 0);
  const p = dotPalette(genome);
  const colorOf = (c: DotCell): string | null => {
    switch (c) {
      case 'lit':
        return p.lit;
      case 'dim':
        return p.dim;
      case 'accent':
        return p.accent;
      case 'accentDim':
        return p.accentDim;
      case 'glint':
      case 'tooth':
        return DOT_GLINT;
      case 'belly':
        return p.belly;
      case 'cheek':
        return p.cheek;
      default:
        return null;
    }
  };
  const lines: string[] = [];
  for (let y = 0; y < grid.height; y += 2) {
    let line = '';
    for (let x = 0; x < grid.width; x++) {
      const top = colorOf(cellAt(grid, x, y));
      const bottom = y + 1 < grid.height ? colorOf(cellAt(grid, x, y + 1)) : null;
      if (!top && !bottom) line += ' ';
      else if (top && bottom)
        line +=
          top === bottom
            ? `<span style="color:${top}">█</span>`
            : `<span style="color:${top};background:${bottom}">▀</span>`;
      else if (top) line += `<span style="color:${top}">▀</span>`;
      else if (bottom) line += `<span style="color:${bottom}">▄</span>`;
    }
    lines.push(line);
  }
  return lines;
}

/** A name centred under a 17-column creature, like the CLI banner. */
export function caption(name: string, width = SPRITE_W): string {
  const cut = name.length > width ? `${name.slice(0, width - 1)}…` : name;
  const left = Math.floor((width - cut.length) / 2);
  return escapeHtml((' '.repeat(left) + cut).padEnd(width, ' '));
}

/** Hue, shape and seed: the spec lines of a cartridge. */
export function specOf(genome: MonsterGenome): { hue: string; shape: string; seed: string } {
  return {
    hue: `${Math.round(genome.palette.hue)}°`,
    shape: genome.body.shape.toUpperCase(),
    seed: `0x${genome.seed.toString(16).padStart(8, '0').toUpperCase()}`,
  };
}
