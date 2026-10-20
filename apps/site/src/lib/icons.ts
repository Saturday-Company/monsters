/*
 * The favicon: Titan's face, cropped from his dot grid (the kit's frame 0), on a black LED
 * screen. A whole 17 × 15 monster is too small at 16px; the face rows read.
 */
import { DOT_GLINT, cellAt, dotGrid, dotPalette, type MonsterGenome } from '@monsters/monster-kit';

export function faviconSvg(genome: MonsterGenome): string {
  const grid = dotGrid(genome, 'idle', 0);
  const p = dotPalette(genome);
  const color: Record<string, string> = {
    lit: p.lit,
    dim: p.dim,
    accent: p.accent,
    accentDim: p.accentDim,
    glint: DOT_GLINT,
    tooth: DOT_GLINT,
    belly: p.belly,
    cheek: p.cheek,
  };
  // the whole creature, centred on a square screen
  const pitch = 10;
  const size = 17 * pitch + 2 * pitch;
  const offY = (size - 15 * pitch) / 2;
  let paths = '';
  const by = new Map<string, string>();
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const c = color[cellAt(grid, x, y)];
      if (!c) continue;
      by.set(c, (by.get(c) ?? '') + `M${pitch + x * pitch + 5} ${offY + y * pitch + 5}h0`);
    }
  for (const [c, d] of by)
    paths += `<path d="${d}" stroke="${c}" stroke-width="9.4" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="28" fill="#0d0d0c"/>${paths}</svg>`;
}
