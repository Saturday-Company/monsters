/**
 * Builds the concept sheet: docs/monsters/concept.html and docs/monsters/concept.png.
 *
 *   pnpm concept                       # default sheet
 *   pnpm concept -- --expressions out.png   # QA sheet: all 14 variants in every expression
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHOSEN, EXPRESSIONS, ROSTER, ROSTER_ORDER } from '../src/index.ts';
import { LABELS, htmlPage, outDir, place, text, toPng } from './sheet.ts';

const WIDTH = 1600;

const variants = ROSTER_ORDER.flatMap((name) => {
  const e = ROSTER[name];
  return [
    { name: e.name, tag: 'A', genome: e.variants.A },
    { name: e.name, tag: 'B', genome: e.variants.B },
  ];
});

function conceptSheet(): { svg: string; height: number } {
  const parts: string[] = [];
  let y = 0;
  const col = WIDTH / 7;

  // header
  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="96" fill="#f4f2ee"/>`);
  parts.push(text(48, 52, 'Monsters · concept v1', { size: 30, weight: 700, anchor: 'start' }));
  parts.push(
    text(
      48,
      80,
      'I sette mostri delle lune di Saturno, due varianti ciascuno (A/B); nel riquadro la scelta finale. Kit SVG parametrico.',
      {
        size: 16,
        fill: '#6b6475',
        anchor: 'start',
      },
    ),
  );
  y = 96;

  // light panel: rows A and B
  const rowH = 262;
  parts.push(`<rect x="0" y="${y}" width="${WIDTH}" height="${rowH * 2}" fill="#f4f2ee"/>`);
  for (const [r, tag] of (['A', 'B'] as const).entries()) {
    ROSTER_ORDER.forEach((name, i) => {
      const e = ROSTER[name];
      const cx = col * i + col / 2;
      const size = 200;
      const chosen = CHOSEN[name] === tag;
      if (chosen)
        parts.push(
          `<rect x="${cx - col / 2 + 8}" y="${y + r * rowH + 4}" width="${col - 16}" height="${rowH - 8}" rx="18" fill="#ffffff" stroke="#d8cfe6" stroke-width="2"/>`,
        );
      parts.push(place(e.variants[tag], cx - size / 2, y + r * rowH + 6, size, 'idle', 'light'));
      parts.push(text(cx, y + r * rowH + 232, `${e.name} · ${tag}`, { size: 17, weight: 700 }));
      parts.push(
        text(cx, y + r * rowH + 252, chosen ? `scelto · ${e.role}` : '', {
          size: 13,
          fill: chosen ? '#7a5bb5' : '#8a8394',
        }),
      );
    });
  }
  y += rowH * 2;

  // dark panel: all 14 small
  const darkH = 168;
  parts.push(`<rect x="0" y="${y}" width="${WIDTH}" height="${darkH}" fill="#1d1b24"/>`);
  parts.push(
    text(48, y + 30, 'Su sfondo scuro', {
      size: 15,
      weight: 700,
      fill: '#d9d4e2',
      anchor: 'start',
    }),
  );
  const step = (WIDTH - 60) / 14;
  variants.forEach((v, i) => {
    const cx = 30 + step * i + step / 2;
    parts.push(place(v.genome, cx - 52, y + 36, 104, 'idle', 'dark'));
    parts.push(text(cx, y + 156, `${v.name} ${v.tag}`, { size: 12, fill: '#a9a2b6' }));
  });
  y += darkH;

  // expressions of Titan A
  const exH = 262;
  parts.push(`<rect x="0" y="${y}" width="${WIDTH}" height="${exH}" fill="#ebe7f0"/>`);
  parts.push(text(48, y + 32, 'Espressioni · Titan A', { size: 15, weight: 700, anchor: 'start' }));
  const exCol = (WIDTH - 200) / EXPRESSIONS.length;
  EXPRESSIONS.forEach((ex, i) => {
    const cx = 100 + exCol * i + exCol / 2;
    parts.push(place(ROSTER.titan.variants.A, cx - 100, y + 30, 200, ex, 'expr'));
    parts.push(text(cx, y + 250, LABELS[ex], { size: 15 }));
  });
  y += exH;

  // legibility at small sizes
  const smH = 150;
  parts.push(`<rect x="0" y="${y}" width="${WIDTH}" height="${smH}" fill="#ffffff"/>`);
  parts.push(text(48, y + 28, 'A 64 px e 32 px', { size: 15, weight: 700, anchor: 'start' }));
  variants.forEach((v, i) => {
    const cx = 30 + step * i + step / 2;
    parts.push(place(v.genome, cx - 32, y + 38, 64, 'idle', 's64'));
    parts.push(place(v.genome, cx - 16, y + 108, 32, 'idle', 's32'));
  });
  y += smH;

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${y}" viewBox="0 0 ${WIDTH} ${y}">${parts.join('')}</svg>`,
    height: y,
  };
}

/** QA sheet: every variant in every expression, big. */
function expressionSheet(): string {
  const size = 180;
  const cols = EXPRESSIONS.length;
  const w = size * cols + 140;
  const h = size * variants.length;
  const parts = [`<rect width="${w}" height="${h}" fill="#f4f2ee"/>`];
  variants.forEach((v, r) => {
    parts.push(text(70, r * size + size / 2, `${v.name} ${v.tag}`, { size: 18, weight: 700 }));
    EXPRESSIONS.forEach((ex, c) =>
      parts.push(place(v.genome, 140 + c * size, r * size, size, ex, 'qa')),
    );
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`;
}

const args = process.argv.slice(2);
const qaIdx = args.indexOf('--expressions');
if (qaIdx >= 0) {
  const out = resolve(args[qaIdx + 1] ?? 'expressions.png');
  writeFileSync(out, toPng(expressionSheet(), 1040));
  process.stdout.write(`wrote ${out}` + '\n');
} else {
  mkdirSync(outDir, { recursive: true });
  const { svg } = conceptSheet();
  const html = htmlPage({
    title: 'Monsters · concept v1',
    width: WIDTH,
    svg,
    script: 'concept.ts',
  });
  writeFileSync(resolve(outDir, 'concept.html'), html);
  writeFileSync(resolve(outDir, 'concept.png'), toPng(svg, WIDTH));
  process.stdout.write(`wrote ${resolve(outDir, 'concept.html')} and concept.png` + '\n');
}
