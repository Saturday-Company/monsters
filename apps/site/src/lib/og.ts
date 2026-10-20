/*
 * The Open Graph card (1200 × 630), drawn as SVG at build time and rasterised with resvg. Text is
 * set in a tiny 5 × 7 dot font defined here (resvg reads only TrueType/OpenType, the site ships
 * woff2), which also happens to be the right look: everything on the card is LEDs.
 */
import { renderDots, type MonsterGenome } from '@monsters/monster-kit';

const G: Record<string, string> = {
  A: '.###.#...##...#######...##...##...#',
  B: '####.#...##...#####.#...##...#####.',
  C: '.###.#...##....#....#....#...#.###.',
  D: '####.#...##...##...##...##...#####.',
  E: '######....#....####.#....#....#####',
  F: '######....#....####.#....#....#....',
  G: '.###.#...##....#.####...##...#.####',
  H: '#...##...##...#######...##...##...#',
  I: '.###...#....#....#....#....#...###.',
  J: '..###...#....#....#....#.#..#..##..',
  K: '#...##..#.#.#..##...#.#..#..#.#...#',
  L: '#....#....#....#....#....#....#####',
  M: '#...###.###.#.##.#.##...##...##...#',
  N: '#...##...###..##.#.##..###...##...#',
  O: '.###.#...##...##...##...##...#.###.',
  P: '####.#...##...#####.#....#....#....',
  Q: '.###.#...##...##...##.#.##..#..##.#',
  R: '####.#...##...#####.#.#..#..#.#...#',
  S: '.#####....#.....###.....#....#####.',
  T: '#####..#....#....#....#....#....#..',
  U: '#...##...##...##...##...##...#.###.',
  V: '#...##...##...##...##...#.#.#...#..',
  W: '#...##...##...##.#.##.#.##.#.#.#.#.',
  X: '#...##...#.#.#...#...#.#.#...##...#',
  Y: '#...##...#.#.#...#....#....#....#..',
  Z: '#####....#...#...#...#...#....#####',
  '0': '.###.#...##..###.#.###..##...#.###.',
  '1': '..#...##....#....#....#....#...###.',
  '2': '.###.#...#....#...#...#...#...#####',
  '3': '####.....#....#.###.....#....#####.',
  '4': '...#...##..#.#.#..#.#####...#....#.',
  '5': '######....####.....#....##...#.###.',
  '6': '.###.#....#....####.#...##...#.###.',
  '7': '#####....#...#...#...#....#....#...',
  '8': '.###.#...##...#.###.#...##...#.###.',
  '9': '.###.#...##...#.####....#....#.###.',
  '.': '................................#..',
  '-': '................###................',
  ' ': '',
  // lowercase, only the letters of the wordmark (x-height of 5 rows)
  m: '..........##.#.#.#.##.#.##.#.##.#.#',
  o: '...........###.#...##...##...#.###.',
  n: '..........#.##.##..##...##...##...#',
  s: '...........#####.....###.....#####.',
  t: '.#....#...####..#....#....#..#..##.',
  e: '...........###.#...#######.....###.',
  r: '..........#.##.##..##....#....#....',
};

/** Cells (x, y) of a string in the dot font: 5 × 7 glyphs, one empty column between them. */
export function dotTextCells(text: string): { cells: [number, number][]; width: number } {
  const cells: [number, number][] = [];
  let x = 0;
  for (const ch of text) {
    const glyph = G[ch] ?? G[ch.toUpperCase()] ?? '';
    for (let i = 0; i < glyph.length && i < 35; i++)
      if (glyph.charAt(i) === '#') cells.push([x + (i % 5), Math.floor(i / 5)]);
    x += 6;
  }
  return { cells, width: Math.max(0, x - 1) };
}

/** A string as LED dots: one path of zero-length round-capped segments (like the kit). */
function dotText(text: string, x: number, y: number, pitch: number, color: string): string {
  const { cells } = dotTextCells(text);
  let d = '';
  for (const [cx, cy] of cells) d += `M${x + cx * pitch} ${y + cy * pitch}h0`;
  return `<path d="${d}" stroke="${color}" stroke-width="${pitch * 0.86}" stroke-linecap="round"/>`;
}

const textWidth = (text: string, pitch: number) => dotTextCells(text).width * pitch;

export function ogSvg(titan: MonsterGenome, stamp: string): string {
  const W = 1200;
  const H = 630;
  const ink = '#1e1e1e';
  const paper = '#dedede';
  const signal = '#ff4f00';
  const monster = renderDots(titan, { expression: 'happy', frame: 0, size: 430, screen: true });
  const inner = monster.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const vb = /viewBox="([^"]+)"/.exec(monster)?.[1] ?? '-10 -10 190 170';
  const tape = 'MONSTERS.';
  const tapeX = 80 + textWidth('YOUR ', 7);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><pattern id="g" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="1" fill="rgba(30,30,30,0.13)"/></pattern></defs>
<rect width="${W}" height="${H}" fill="${paper}"/>
<rect width="${W}" height="${H}" fill="url(#g)"/>
<rect x="28" y="28" width="${W - 56}" height="${H - 56}" fill="none" stroke="${ink}" stroke-width="2"/>
<line x1="28" y1="92" x2="${W - 28}" y2="92" stroke="${ink}" stroke-width="2"/>
<rect x="56" y="48" width="${textWidth(stamp, 3.4) + 26}" height="30" fill="none" stroke="${ink}" stroke-width="2"/>
${dotText(stamp, 69, 52.5, 3.4, ink)}
${dotText('OPEN SOURCE  APACHE-2.0', W - 56 - textWidth('OPEN SOURCE  APACHE-2.0', 3.4), 52.5, 3.4, ink)}
${dotText('monsters', 80, 150, 12, ink)}
${dotText('YOUR AI.', 80, 330, 7, ink)}
${dotText('YOUR MACHINE.', 80, 400, 7, ink)}
${dotText('YOUR', 80, 470, 7, ink)}
<rect x="${tapeX - 14}" y="456" width="${textWidth(tape, 7) + 28}" height="76" fill="${signal}" stroke="${ink}" stroke-width="2" transform="rotate(-1.6 ${tapeX} 494)"/>
${dotText(tape, tapeX, 470, 7, '#170800')}
<g transform="translate(700 150)"><svg width="430" height="${(430 * 170) / 190}" viewBox="${vb}">${inner}</svg></g>
${dotText('LINUX  MACOS  WINDOWS', 700, 560, 3.4, ink)}
</svg>`;
}
