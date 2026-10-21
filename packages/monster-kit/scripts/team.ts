/**
 * Builds the team sheet: docs/monsters/team.html (animated with monsterCss) and docs/monsters/team.png.
 * The seven chosen monsters, on light and dark, in every expression, plus a 2x close-up of
 * Tethys before and after the mouth redesign (the "before" is a frozen SVG in docs/monsters).
 *
 *   pnpm team-sheet
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXPRESSIONS, ROSTER, ROSTER_ORDER, monsterCss, monsterFor } from '../src/index.ts';
import { LABELS, htmlPage, outDir, place, text, toPng } from './sheet.ts';

const WIDTH = 1600;
const team = ROSTER_ORDER.map((name) => ({ entry: ROSTER[name], genome: monsterFor(name) }));

function teamSheet(): string {
  const parts: string[] = [];
  let y = 0;
  const col = WIDTH / 7;

  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="96" fill="#f4f2ee"/>`);
  parts.push(text(48, 52, 'Monsters · il team', { size: 30, weight: 700, anchor: 'start' }));
  parts.push(
    text(
      48,
      80,
      'I sette mostri scelti, uno per agente: chiaro, scuro, le cinque espressioni e il ritocco della bocca di Tethys.',
      { size: 16, fill: '#6b6475', anchor: 'start' },
    ),
  );
  y = 96;

  // light row
  const rowH = 268;
  parts.push(`<rect x="0" y="${y}" width="${WIDTH}" height="${rowH}" fill="#f4f2ee"/>`);
  team.forEach(({ entry, genome }, i) => {
    const cx = col * i + col / 2;
    parts.push(place(genome, cx - 100, y + 6, 200, 'idle', 'light'));
    parts.push(text(cx, y + 234, entry.name, { size: 18, weight: 700 }));
    parts.push(text(cx, y + 254, entry.role, { size: 13, fill: '#8a8394' }));
  });
  y += rowH;

  // dark row
  const darkH = 250;
  parts.push(`<rect x="0" y="${y}" width="${WIDTH}" height="${darkH}" fill="#1d1b24"/>`);
  team.forEach(({ entry, genome }, i) => {
    const cx = col * i + col / 2;
    parts.push(place(genome, cx - 95, y + 14, 190, 'idle', 'dark'));
    parts.push(text(cx, y + 230, entry.name, { size: 16, weight: 700, fill: '#d9d4e2' }));
  });
  y += darkH;

  // expressions
  const headH = 56;
  const exRow = 186;
  const labelW = 190;
  const exCol = (WIDTH - labelW - 30) / EXPRESSIONS.length;
  const exH = headH + exRow * team.length + 10;
  parts.push(`<rect x="0" y="${y}" width="${WIDTH}" height="${exH}" fill="#ebe7f0"/>`);
  parts.push(text(48, y + 34, 'Espressioni', { size: 17, weight: 700, anchor: 'start' }));
  EXPRESSIONS.forEach((ex, c) => {
    parts.push(
      text(labelW + exCol * c + exCol / 2, y + 34, LABELS[ex], { size: 15, fill: '#6b6475' }),
    );
  });
  team.forEach(({ entry, genome }, r) => {
    const ry = y + headH + r * exRow;
    if (r % 2 === 0)
      parts.push(
        `<rect x="16" y="${ry}" width="${WIDTH - 32}" height="${exRow}" rx="16" fill="#f4f1f7"/>`,
      );
    parts.push(
      text(48, ry + exRow / 2 + 6, entry.name, { size: 17, weight: 700, anchor: 'start' }),
    );
    EXPRESSIONS.forEach((ex, c) => {
      const cx = labelW + exCol * c + exCol / 2;
      parts.push(place(genome, cx - 90, ry - 2, 180, ex, 'expr'));
    });
  });
  y += exH;

  // Tethys before / after, 2x
  const tH = 440;
  const big = 400;
  parts.push(`<rect x="0" y="${y}" width="${WIDTH}" height="${tH}" fill="#ffffff"/>`);
  parts.push(
    text(48, y + 34, 'Tethys · la bocca, prima e dopo (2x)', {
      size: 17,
      weight: 700,
      anchor: 'start',
    }),
  );
  const before = readFileSync(resolve(outDir, 'tethys-a-prima.svg'), 'utf8')
    .trim()
    .replace('width="200" height="200"', `width="${big}" height="${big}"`);
  const tethys = monsterFor('tethys');
  const cols = [WIDTH / 2 - 560, WIDTH / 2 - 200, WIDTH / 2 + 160];
  const [c0 = 0, c1 = 0, c2 = 0] = cols;
  parts.push(before.replace('<svg ', `<svg x="${c0}" y="${y - 30}" `));
  parts.push(place(tethys, c1, y - 30, big, 'idle', 'after'));
  parts.push(place(tethys, c2, y - 30, big, 'happy', 'after'));
  const captions: [number, string, string][] = [
    [c0, 'prima', 'labbro dritto, bocca a cavallo della pancia'],
    [c1, 'dopo', 'labbro a sorriso, zanne dalla curva, pancia sotto'],
    [c2, 'dopo · felice', 'stessa regola in ogni espressione'],
  ];
  for (const [x, title, sub] of captions) {
    parts.push(text(x + big / 2, y + tH - 40, title, { size: 17, weight: 700 }));
    parts.push(text(x + big / 2, y + tH - 18, sub, { size: 13, fill: '#8a8394' }));
  }
  y += tH;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${y}" viewBox="0 0 ${WIDTH} ${y}">${parts.join('')}</svg>`;
}

const svg = teamSheet();
writeFileSync(
  resolve(outDir, 'team.html'),
  htmlPage({ title: 'Monsters · il team', width: WIDTH, svg, script: 'team.ts', css: monsterCss }),
);
writeFileSync(resolve(outDir, 'team.png'), toPng(svg, WIDTH));
process.stdout.write(`wrote ${resolve(outDir, 'team.html')} and team.png\n`);
