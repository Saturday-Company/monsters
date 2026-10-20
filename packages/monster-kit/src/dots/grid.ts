/**
 * The dot-matrix screen every monster lives on: a fixed 17 × 15 grid of LEDs, the same for all
 * monsters so they line up across the UI. Column 8 is the centre column, row 14 the ground.
 */

export const DOT_W = 17;
export const DOT_H = 15;
/** Centre column (odd width: the face has a real middle). */
export const DOT_CX = 8;
/** The row the feet stand on. Row 0 stays free for hops, thought dots and z's. */
export const DOT_GROUND = 14;

/**
 * What a dot shows. `eye` and `mouth` are holes in the body (drawn like `off`, but they are part
 * of the face); `glint` is the white reflection in an eye (and the white of a cyclops eyeball);
 * `tooth` is a white tooth in or under a mouth; `belly` is the pale (or contrasting) belly; `cheek`
 * the pink blush of a happy face (and the tongue).
 */
export const DOT_CELLS = [
  'off',
  'dim',
  'lit',
  'belly',
  'cheek',
  'accent',
  'accentDim',
  'eye',
  'mouth',
  'glint',
  'tooth',
] as const;
export type DotCell = (typeof DOT_CELLS)[number];

/** Cells that emit light. */
export const isLight = (c: DotCell): boolean => c !== 'off' && c !== 'eye' && c !== 'mouth';

export interface DotGrid {
  width: number;
  height: number;
  /** Row-major, `cells[y * width + x]`. */
  cells: DotCell[];
  /** Brightness of the whole frame, 0–1 (1 = full; sleep and the error flicker are dimmer). */
  light: number;
}

export const cellAt = (grid: DotGrid, x: number, y: number): DotCell =>
  x < 0 || y < 0 || x >= grid.width || y >= grid.height
    ? 'off'
    : (grid.cells[y * grid.width + x] ?? 'off');

/** One string per row, for tests and debugging: `.` off, `o` hole, `#` lit, `-` belly, `+` dim, `A`/`a` accent, `*` glint, `t` tooth. */
export function gridToAscii(grid: DotGrid): string[] {
  const ch: Record<DotCell, string> = {
    off: '.',
    dim: '+',
    lit: '#',
    belly: '-',
    cheek: 'c',
    accent: 'A',
    accentDim: 'a',
    eye: 'o',
    mouth: 'o',
    glint: '*',
    tooth: 't',
  };
  const rows: string[] = [];
  for (let y = 0; y < grid.height; y++) {
    let s = '';
    for (let x = 0; x < grid.width; x++) s += ch[cellAt(grid, x, y)];
    rows.push(s);
  }
  return rows;
}
