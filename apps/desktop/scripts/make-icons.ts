/*
 * Icons of the app, drawn from the monster-kit (Titan, the default guide, as a dot creature:
 * docs/design.md, D-062) and rendered to PNG with Playwright's Chromium (the one of the web e2e
 * tests). Run once and commit the files in assets/.
 *
 *   pnpm --filter @monsters/desktop icons
 *
 *   icon.png                512 px, window and Linux app icon: an aluminium device with a
 *                           black screen, Titan in luminous dots and the orange signal light
 *   tray.png, tray@2x.png   tray of Linux and Windows: Titan as pixel art, one pixel (two at
 *                           @2x) per dot, in colour
 *   trayTemplate.png, @2x   menu bar of macOS: the same pixel art in black (the system tints it)
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { dotGrid, dotPalette, monsterFor, renderDots } from '@monsters/monster-kit';

const ASSETS = resolve(fileURLToPath(new URL('../assets', import.meta.url)));
const titan = monsterFor('titan');

/** The app icon: macOS icon grid (body 824/1024 of the canvas), chassis, screen, dots, light. */
function appIconSvg(size: number): string {
  const s = size / 1024;
  const body = { x: 100 * s, y: 100 * s, w: 824 * s, r: 185 * s };
  const screen = { x: 176 * s, y: 196 * s, w: 672 * s, h: 600 * s, r: 92 * s };
  const dotsW = 600 * s;
  const dotsH = (dotsW * 15) / 17;
  const dots = renderDots(titan, { expression: 'idle', frame: 0, size: dotsW }).replace(
    '<svg ',
    `<svg x="${screen.x + (screen.w - dotsW) / 2}" y="${screen.y + (screen.h - dotsH) / 2}" `,
  );
  const light = { cx: 790 * s, cy: 862 * s, r: 22 * s };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="alu" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#efede8"/><stop offset="1" stop-color="#d9d6cf"/>
    </linearGradient>
    <radialGradient id="led" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ff7a33"/><stop offset=".6" stop-color="#ff4f00"/><stop offset="1" stop-color="#ff4f00" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="${body.x}" y="${body.y + 10 * s}" width="${body.w}" height="${body.w}" rx="${body.r}" fill="#000" opacity=".18"/>
  <rect x="${body.x}" y="${body.y}" width="${body.w}" height="${body.w}" rx="${body.r}" fill="url(#alu)"/>
  <rect x="${body.x + 2 * s}" y="${body.y + 2 * s}" width="${body.w - 4 * s}" height="${body.w - 4 * s}" rx="${body.r - 2 * s}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="${3 * s}"/>
  <rect x="${screen.x - 6 * s}" y="${screen.y - 4 * s}" width="${screen.w + 12 * s}" height="${screen.h + 12 * s}" rx="${screen.r + 6 * s}" fill="#b5b2a9"/>
  <rect x="${screen.x}" y="${screen.y}" width="${screen.w}" height="${screen.h}" rx="${screen.r}" fill="#0d0d0c"/>
  ${dots}
  <circle cx="${light.cx}" cy="${light.cy}" r="${light.r * 2.2}" fill="url(#led)" opacity=".45"/>
  <circle cx="${light.cx}" cy="${light.cy}" r="${light.r}" fill="#ff4f00"/>
  <rect x="${234 * s}" y="${848 * s}" width="${180 * s}" height="${28 * s}" rx="${14 * s}" fill="#b5b2a9"/>
</svg>`;
}

/** Titan as pixel art: one square of `scale` px per lit dot, eyes and mouth left transparent. */
function trayCells(): { w: number; h: number; cells: (string | null)[] } {
  const grid = dotGrid(titan, 'idle', 0);
  const p = dotPalette(titan);
  const colour: Record<string, string> = {
    lit: p.lit,
    dim: p.dim,
    accent: p.accent,
    accentDim: p.accentDim,
    belly: p.belly,
    cheek: p.cheek,
    tooth: p.lit,
  };
  return {
    w: grid.width,
    h: grid.height,
    cells: grid.cells.map((c) => colour[c] ?? null),
  };
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const fromSvg = async (svg: string, size: number): Promise<Buffer> => {
    const dataUrl = await page.evaluate(
      async ({ svg, size }) => {
        const img = new Image();
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d')!.drawImage(img, 0, 0, size, size);
        return canvas.toDataURL('image/png');
      },
      { svg, size },
    );
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  };
  const pixelArt = async (size: number, scale: number, silhouette: boolean): Promise<Buffer> => {
    const art = trayCells();
    const dataUrl = await page.evaluate(
      ({ art, size, scale, silhouette }) => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        const ox = Math.floor((size - art.w * scale) / 2);
        const oy = Math.floor((size - art.h * scale) / 2);
        art.cells.forEach((c, i) => {
          if (!c) return;
          ctx.fillStyle = silhouette ? '#000' : c;
          ctx.fillRect(ox + (i % art.w) * scale, oy + Math.floor(i / art.w) * scale, scale, scale);
        });
        return canvas.toDataURL('image/png');
      },
      { art, size, scale, silhouette },
    );
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  };

  const out: [string, Buffer][] = [
    ['icon.png', await fromSvg(appIconSvg(512), 512)],
    ['tray.png', await pixelArt(24, 1, false)],
    ['tray@2x.png', await pixelArt(48, 2, false)],
    ['trayTemplate.png', await pixelArt(22, 1, true)],
    ['trayTemplate@2x.png', await pixelArt(44, 2, true)],
  ];
  for (const [name, png] of out) {
    writeFileSync(join(ASSETS, name), png);
    process.stderr.write(`assets/${name}\n`);
  }
} finally {
  await browser.close();
}
