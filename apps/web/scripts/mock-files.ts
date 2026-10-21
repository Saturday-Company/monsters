import type { IncomingMessage, ServerResponse } from 'node:http';
import { crc32, deflateSync } from 'node:zlib';
import {
  fileContentBody,
  fileContentHeaders,
} from '../../../packages/core/src/server/file-headers.ts';
import type { Lang } from '@monsters/shared';
import { mockFile, type MockFileBody } from '../src/lib/mock/files-data.ts';

/*
 * The bytes of the mock core's files (D-075), served by the Vite dev server
 * under `/__mock/api/files/:id/content` (and `/thumb`) with the very headers of
 * the core (`fileContentHeaders`: the sandbox CSP of HTML pages, nosniff…), so
 * the e2e tests of the preview pane see what the real core sends. Images and
 * the PDF are drawn here, in a few lines: no binary files in the repository.
 */

type Rgba = [number, number, number, number];

function png(width: number, height: number, pixel: (x: number, y: number) => Rgba): Buffer {
  const row = width * 4 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const at = y * row + 1 + x * 4;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = a;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** A menu card on a plate of colour, with transparent corners (the checkerboard shows). */
function menuPixel(w: number, h: number) {
  const plates: [number, number, number, Rgba][] = [
    [0.27, 0.5, 0.16, [214, 120, 48, 255]],
    [0.52, 0.42, 0.12, [120, 160, 82, 255]],
    [0.73, 0.56, 0.14, [186, 64, 52, 255]],
  ];
  return (x: number, y: number): Rgba => {
    const r = 70;
    const cx = Math.min(Math.max(x, r), w - r);
    const cy = Math.min(Math.max(y, r), h - r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return [0, 0, 0, 0];
    for (const [px, py, pr, color] of plates) {
      const d = Math.hypot(x / w - px, (y / h - py) * (h / w));
      if (d < pr * 0.62) return color;
      if (d < pr) return [246, 240, 228, 255];
    }
    const t = y / h;
    return [mix(251, 232, t), mix(239, 208, t), mix(222, 176, t), 255];
  };
}

/** A web page as a browser would capture it: a bar, a header, a yellow tram. */
function screenshotPixel(w: number, h: number) {
  return (x: number, y: number): Rgba => {
    if (y < 56) return y > 54 ? [200, 200, 200, 255] : [238, 238, 236, 255];
    if (y < 150) return [18, 66, 120, 255];
    const tram = x > w * 0.18 && x < w * 0.62 && y > h * 0.38 && y < h * 0.78;
    if (tram) {
      const win = (Math.floor((x - w * 0.18) / 70) % 2 === 0 && y < h * 0.55) || y > h * 0.74;
      return win ? [60, 62, 70, 255] : [246, 196, 34, 255];
    }
    if (x > w * 0.7 && y > 200 && y < h - 80)
      return (y >> 4) % 2 ? [228, 230, 232, 255] : [242, 243, 244, 255];
    return [250, 250, 248, 255];
  };
}

export function pdf(pages: string[][]): Buffer {
  const esc = (s: string) => s.replace(/([\\()])/g, '\\$1');
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
  };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const lines of pages) {
    const ops = ['BT', '/F1 20 Tf', '56 770 Td', `(${esc(lines[0] ?? '')}) Tj`, '/F1 13 Tf'];
    for (const line of lines.slice(1)) ops.push('0 -24 Td', `(${esc(line)}) Tj`);
    ops.push('ET');
    const stream = ops.join('\n');
    add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    const content = objects.length;
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`,
    );
    kids.push(objects.length);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const cache = new Map<string, Buffer>();

function bytesOf(id: string, body: MockFileBody, lang: Lang): Buffer {
  const key = `${lang}:${id}`;
  const known = cache.get(key);
  if (known) return known;
  let out: Buffer;
  switch (body.kind) {
    case 'text':
      out = Buffer.from(body.text, 'utf8');
      break;
    case 'png':
      out = png(
        body.width,
        body.height,
        body.scene === 'menu'
          ? menuPixel(body.width, body.height)
          : screenshotPixel(body.width, body.height),
      );
      break;
    case 'pdf':
      out = pdf(body.pages);
      break;
    case 'zip':
      // An empty archive: the end of the central directory and nothing else.
      out = Buffer.concat([Buffer.from('PK\x05\x06', 'latin1'), Buffer.alloc(18)]);
      break;
  }
  cache.set(key, out);
  return out;
}

const ROUTE = /^\/__mock\/api\/files\/([A-Za-z0-9_-]+)\/(content|thumb)(?:\?.*)?$/;

/** Connect middleware of the dev server (vite.config.ts). */
export function mockFilesMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  const m = ROUTE.exec(req.url ?? '');
  if (!m || req.method !== 'GET') return next();
  // The page of the mock asks for English with `lang=en`; the Italian URLs are as they were.
  const lang: Lang = /[?&]lang=en\b/.test(req.url ?? '') ? 'en' : 'it';
  const file = mockFile(m[1]!, lang);
  if (!file || (m[2] === 'thumb' && !file.meta.hasThumb)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'unknown_file' }));
    return;
  }
  // As the core serves it: the lockdown first on a scripted page, an inert one without scripts.
  const meta = /[?&]scripts=1\b/.test(req.url ?? '') ? { ...file.meta, inert: false } : file.meta;
  const body = fileContentBody(meta, bytesOf(file.meta.id, file.body, lang));
  const type = file.body.kind === 'text' ? `${file.meta.mime}; charset=utf-8` : file.meta.mime;
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', String(body.length));
  for (const [k, v] of Object.entries(fileContentHeaders(meta))) res.setHeader(k, v);
  res.end(body);
}
