import {
  type Expression,
  type MonsterGenome,
  type MonsterGenomeInput,
  parseGenome,
} from '../genome.ts';
import { cellAt, type DotCell } from './grid.ts';
import { DOT_GLINT, dotPalette } from './palette.ts';
import { dotGrid } from './render.ts';

export interface DotTextOptions {
  expression?: Expression;
  /** `ansi`: 24-bit colours (default); `none`: plain half blocks, light vs off only. */
  color?: 'ansi' | 'none';
  frame?: number;
}

const rgb = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * The same monster for terminals (CLI, SSH): two grid rows per line with half blocks
 * (`▀ ▄ █`), 17 columns, 8 lines. Holes (eyes, mouth) and off dots are spaces.
 */
export function renderDotsText(
  input: MonsterGenome | MonsterGenomeInput,
  opts: DotTextOptions = {},
): string[] {
  const g = parseGenome(input);
  const grid = dotGrid(g, opts.expression ?? 'idle', opts.frame ?? 0);
  const p = dotPalette(g);
  const ansi = (opts.color ?? 'ansi') === 'ansi';
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
      // in plain text a reflection is just part of the dark eye
      case 'glint':
        return ansi ? DOT_GLINT : null;
      case 'belly':
        return p.belly;
      case 'cheek':
        return p.cheek;
      // teeth are white, like the reflections
      case 'tooth':
        return DOT_GLINT;
      default:
        return null;
    }
  };
  // a dimmer frame (sleep) dims the colours too
  const shade = (hex: string): [number, number, number] =>
    rgb(hex).map((v) => Math.round(v * grid.light)) as [number, number, number];
  const fg = (hex: string) => `\x1b[38;2;${shade(hex).join(';')}m`;
  const bg = (hex: string) => `\x1b[48;2;${shade(hex).join(';')}m`;
  const reset = '\x1b[0m';

  const lines: string[] = [];
  for (let y = 0; y < grid.height; y += 2) {
    let line = '';
    for (let x = 0; x < grid.width; x++) {
      const top = colorOf(cellAt(grid, x, y));
      const bottom = y + 1 < grid.height ? colorOf(cellAt(grid, x, y + 1)) : null;
      if (!top && !bottom) line += ' ';
      else if (!ansi) line += top && bottom ? '█' : top ? '▀' : '▄';
      else if (top && bottom)
        line += top === bottom ? `${fg(top)}█${reset}` : `${fg(top)}${bg(bottom)}▀${reset}`;
      else if (top) line += `${fg(top)}▀${reset}`;
      else if (bottom) line += `${fg(bottom)}▄${reset}`;
    }
    lines.push(line);
  }
  return lines;
}
