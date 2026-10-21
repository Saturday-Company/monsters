/**
 * Builds the dot-monster sheet: docs/monsters/dots.html (animated with dotCss), docs/monsters/dots.png
 * (first frames) and docs/monsters/dots.txt (the terminal version, with ANSI colours).
 * The seven chosen monsters on black screens, on the light and the dark chassis, at real size,
 * every frame of every expression, and 30 random genomes (the rules must work for any genome).
 *
 *   pnpm dots-sheet
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DOT_FRAMES,
  EXPRESSIONS,
  type Expression,
  type MonsterGenome,
  ROSTER,
  ROSTER_ORDER,
  dotCss,
  monsterFor,
  randomGenome,
  renderDots,
  renderDotsText,
} from '../src/index.ts';
import { LABELS, htmlPage, outDir, text, toPng } from './sheet.ts';

const WIDTH = 1600;
const LIGHT = '#e3e1db';
const DARK = '#151514';
const INK = '#2a2926';
const MUTED = '#77736b';
/** Screen ratio of renderDots with `screen: true` (190 × 170 viewBox). */
const RATIO = 170 / 190;

const team = ROSTER_ORDER.map((name) => ({ name, entry: ROSTER[name], genome: monsterFor(name) }));
/** The same random genomes the tests start with. */
const randoms = Array.from({ length: 30 }, (_, i) => randomGenome(i * 7919 + 13));

function screen(
  g: MonsterGenome,
  x: number,
  y: number,
  size: number,
  expression: Expression,
  key: string,
  frame?: number,
): string {
  const svg = renderDots(g, {
    expression,
    size,
    screen: true,
    idPrefix: `${key}-${g.id}-${expression}-${frame ?? 'a'}`,
    ...(frame === undefined ? {} : { frame }),
  });
  return svg.replace('<svg ', `<svg x="${x}" y="${y}" `);
}

function sheet(animatedRows: boolean): string {
  const parts: string[] = [];
  let y = 0;
  const col = WIDTH / 7;

  // header
  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="104" fill="${LIGHT}"/>`);
  parts.push(
    text(48, 54, 'Monsters · creature a punti', {
      size: 30,
      weight: 700,
      anchor: 'start',
      fill: INK,
    }),
  );
  parts.push(
    text(
      48,
      84,
      'Lo stesso genoma, disegnato su una griglia di 17 × 15 LED: chassis chiaro e scuro, grandezza reale, ogni fotogramma di ogni espressione.',
      { size: 16, fill: MUTED, anchor: 'start' },
    ),
  );
  y = 104;

  // light chassis: big screens
  const big = 196;
  const rowH = big * RATIO + 70;
  parts.push(`<rect x="0" y="${y}" width="${WIDTH}" height="${rowH}" fill="${LIGHT}"/>`);
  team.forEach(({ entry, genome }, i) => {
    const cx = col * i + col / 2;
    parts.push(screen(genome, cx - big / 2, y + 6, big, 'idle', 'light'));
    parts.push(text(cx, y + big * RATIO + 34, entry.name, { size: 18, weight: 700, fill: INK }));
    parts.push(text(cx, y + big * RATIO + 54, entry.role, { size: 13, fill: MUTED }));
  });
  y += rowH;

  // dark chassis: big screens, then the real size (60 px) and 2x
  const darkH = big * RATIO + 190;
  parts.push(`<rect x="0" y="${y}" width="${WIDTH}" height="${darkH}" fill="${DARK}"/>`);
  team.forEach(({ entry, genome }, i) => {
    const cx = col * i + col / 2;
    parts.push(screen(genome, cx - big / 2, y + 18, big, 'happy', 'dark'));
    parts.push(
      text(cx, y + big * RATIO + 44, entry.name, { size: 16, weight: 700, fill: '#e8e6e0' }),
    );
    parts.push(screen(genome, cx - 60 - 10, y + big * RATIO + 70, 60, 'idle', 'real'));
    parts.push(screen(genome, cx + 4, y + big * RATIO + 70 - 26, 120, 'idle', 'x2'));
  });
  parts.push(
    text(48, y + darkH - 14, 'a grandezza reale (60 px, striscia del mostro) e al doppio', {
      size: 13,
      fill: '#8f8b83',
      anchor: 'start',
    }),
  );
  y += darkH;

  // every frame of every expression
  const fs = 74;
  const fh = fs * RATIO;
  const gap = 18;
  const labelW = 150;
  const headH = 54;
  const exRow = fh + 22;
  const totalFrames = EXPRESSIONS.reduce((s, e) => s + DOT_FRAMES[e], 0);
  const used = labelW + totalFrames * (fs + 4) + (EXPRESSIONS.length - 1) * gap;
  const x0 = (WIDTH - used) / 2;
  const exH = headH + exRow * team.length + 16;
  parts.push(`<rect x="0" y="${y}" width="${WIDTH}" height="${exH}" fill="${LIGHT}"/>`);
  let ex = x0 + labelW;
  const starts: number[] = [];
  for (const e of EXPRESSIONS) {
    starts.push(ex);
    const w = DOT_FRAMES[e] * (fs + 4) - 4;
    parts.push(
      text(ex + w / 2, y + 34, `${LABELS[e]} · ${DOT_FRAMES[e]}`, { size: 14, fill: MUTED }),
    );
    ex += DOT_FRAMES[e] * (fs + 4) + gap;
  }
  team.forEach(({ entry, genome }, r) => {
    const ry = y + headH + r * exRow;
    parts.push(
      text(x0, ry + fh / 2 + 6, entry.name, { size: 16, weight: 700, anchor: 'start', fill: INK }),
    );
    EXPRESSIONS.forEach((e, c) => {
      for (let f = 0; f < DOT_FRAMES[e]; f++)
        parts.push(screen(genome, (starts[c] ?? 0) + f * (fs + 4), ry, fs, e, 'frames', f));
    });
  });
  y += exH;

  // 30 random genomes: idle at 2x, happy at real size
  {
    const cols = 10;
    const cw = WIDTH / cols;
    const bigR = 120;
    const cellH = bigR * RATIO + 60 * RATIO + 22;
    const rH = 64 + Math.ceil(randoms.length / cols) * cellH;
    parts.push(`<rect x="0" y="${y}" width="${WIDTH}" height="${rH}" fill="${DARK}"/>`);
    parts.push(
      text(48, y + 38, '30 genomi casuali · idle al doppio, felice a grandezza reale', {
        size: 17,
        weight: 700,
        anchor: 'start',
        fill: '#e8e6e0',
      }),
    );
    randoms.forEach((g, i) => {
      const cx = cw * (i % cols) + cw / 2;
      const ry = y + 56 + Math.floor(i / cols) * cellH;
      parts.push(screen(g, cx - bigR / 2, ry, bigR, 'idle', 'rnd'));
      parts.push(screen(g, cx - 30, ry + bigR * RATIO + 8, 60, 'happy', 'rnd'));
    });
    y += rH;
  }

  if (animatedRows) {
    // HTML only: every expression animated
    const as = 150;
    const aH = 60 + team.length * (as * RATIO + 16);
    parts.push(`<rect x="0" y="${y}" width="${WIDTH}" height="${aH}" fill="${DARK}"/>`);
    parts.push(
      text(48, y + 36, 'Animate', { size: 17, weight: 700, anchor: 'start', fill: '#e8e6e0' }),
    );
    const acol = (WIDTH - 200) / EXPRESSIONS.length;
    EXPRESSIONS.forEach((e, c) =>
      parts.push(text(200 + acol * c + acol / 2, y + 36, LABELS[e], { size: 14, fill: '#8f8b83' })),
    );
    team.forEach(({ entry, genome }, r) => {
      const ry = y + 56 + r * (as * RATIO + 16);
      parts.push(
        text(48, ry + (as * RATIO) / 2 + 6, entry.name, {
          size: 16,
          weight: 700,
          anchor: 'start',
          fill: '#e8e6e0',
        }),
      );
      EXPRESSIONS.forEach((e, c) =>
        parts.push(screen(genome, 200 + acol * c + acol / 2 - as / 2, ry, as, e, 'anim')),
      );
    });
    y += aH;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${Math.ceil(y)}" viewBox="0 0 ${WIDTH} ${Math.ceil(y)}">${parts.join('')}</svg>`;
}

writeFileSync(
  resolve(outDir, 'dots.html'),
  htmlPage({
    title: 'Monsters · creature a punti',
    width: WIDTH,
    svg: sheet(true),
    script: 'dots-sheet.ts',
    css: dotCss,
  }),
);
writeFileSync(resolve(outDir, 'dots.png'), toPng(sheet(false), WIDTH));

const txt: string[] = [
  'Monsters · dot creatures (renderDotsText, 24-bit ANSI colours: `cat docs/monsters/dots.txt`)',
  '',
];
for (const { entry, genome } of team) {
  txt.push(`${entry.name} · ${entry.role}`);
  const cols = (['idle', 'happy', 'sleep'] as const).map((e) =>
    renderDotsText(genome, { expression: e }),
  );
  const lines = cols[0]?.length ?? 0;
  for (let i = 0; i < lines; i++) txt.push(cols.map((c) => c[i] ?? '').join('    '));
  txt.push('');
}
writeFileSync(resolve(outDir, 'dots.txt'), txt.join('\n'));
process.stdout.write(`wrote ${resolve(outDir, 'dots.html')}, dots.png and dots.txt\n`);
