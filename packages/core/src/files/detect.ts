import type { FileKind } from '@monsters/shared';
import { zipEntryNames } from './zip.ts';

/*
 * What a file really is, from its first bytes (D-075): the name and the type
 * the browser claims are not trusted. Only the types Monsters can show or give
 * to a model are accepted; everything else is `unsupported`.
 */

export interface DetectedType {
  mime: string;
  kind: FileKind;
  /** Extension the stored name gets (the user's one when it agrees). */
  ext: string;
}

export type Detection = DetectedType | { unsupported: string };

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0): boolean =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

const ascii = (b: Uint8Array, from: number, to: number): string =>
  Buffer.from(b.subarray(from, Math.min(to, b.length))).toString('latin1');

const OOXML: Record<string, DetectedType> = {
  'word/': {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'document',
    ext: 'docx',
  },
  'xl/': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'sheet',
    ext: 'xlsx',
  },
  'ppt/': {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'document',
    ext: 'pptx',
  },
};

/** Text types told apart by the name (their bytes are only text). */
const TEXT_TYPES: Record<string, DetectedType> = {
  txt: { mime: 'text/plain; charset=utf-8', kind: 'text', ext: 'txt' },
  md: { mime: 'text/markdown; charset=utf-8', kind: 'text', ext: 'md' },
  markdown: { mime: 'text/markdown; charset=utf-8', kind: 'text', ext: 'md' },
  csv: { mime: 'text/csv; charset=utf-8', kind: 'sheet', ext: 'csv' },
  json: { mime: 'application/json; charset=utf-8', kind: 'text', ext: 'json' },
};

export const HTML_TYPE: DetectedType = {
  mime: 'text/html; charset=utf-8',
  kind: 'html',
  ext: 'html',
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Valid UTF-8 without NUL bytes or other control characters (tab, newlines, form feed apart). */
export function isPlainText(bytes: Uint8Array): boolean {
  for (const b of bytes) {
    if (b === 0) return false;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c) return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * The type of a file from its bytes. `name` only decides between text types
 * (a `.csv` and a `.txt` look the same) and is never enough by itself.
 * `allowHtml`: HTML is accepted only from Monsters itself (`artifact_create`).
 */
export function detectType(
  bytes: Uint8Array,
  name: string,
  options: { allowHtml?: boolean } = {},
): Detection {
  const ext = extensionOf(name);
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', kind: 'image', ext: 'png' };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { mime: 'image/jpeg', kind: 'image', ext: ext === 'jpeg' ? 'jpeg' : 'jpg' };
  }
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') {
    return { mime: 'image/gif', kind: 'image', ext: 'gif' };
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return { mime: 'image/webp', kind: 'image', ext: 'webp' };
  }
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(brand)) {
      return { unsupported: brand === 'avif' ? 'avif' : 'heic' };
    }
    return { unsupported: 'video' };
  }
  if (ascii(bytes, 0, 5) === '%PDF-') return { mime: 'application/pdf', kind: 'pdf', ext: 'pdf' };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const names = zipEntryNames(bytes);
    if (names && names.includes('[Content_Types].xml')) {
      for (const [prefix, type] of Object.entries(OOXML)) {
        if (names.some((n) => n.startsWith(prefix))) return type;
      }
    }
    return { unsupported: 'zip' };
  }
  if (isPlainText(bytes)) {
    const head = Buffer.from(bytes.subarray(0, 1024)).toString('utf8').trimStart().toLowerCase();
    const looksHtml =
      head.startsWith('<!doctype html') ||
      head.startsWith('<html') ||
      ext === 'html' ||
      ext === 'htm';
    if (looksHtml) return options.allowHtml ? HTML_TYPE : { unsupported: 'html' };
    if (ext === 'svg' || head.startsWith('<svg') || head.startsWith('<?xml')) {
      // SVG can carry scripts: not shown, not given to a model.
      return { unsupported: 'svg' };
    }
    const type = TEXT_TYPES[ext];
    if (type) {
      if (type.ext !== 'json') return type;
      try {
        JSON.parse(Buffer.from(bytes).toString('utf8'));
        return type;
      } catch {
        return TEXT_TYPES['txt']!;
      }
    }
    return TEXT_TYPES['txt']!;
  }
  return { unsupported: ext || 'binary' };
}

/** Width and height of a PNG, JPEG, GIF or WebP, read from its header. */
export function imageSize(
  bytes: Uint8Array,
  mime: string,
): { width: number; height: number } | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ok = (w: number, h: number) => (w > 0 && h > 0 ? { width: w, height: h } : null);
  try {
    if (mime === 'image/png' && b.length >= 24) return ok(b.readUInt32BE(16), b.readUInt32BE(20));
    if (mime === 'image/gif' && b.length >= 10) return ok(b.readUInt16LE(6), b.readUInt16LE(8));
    if (mime === 'image/webp' && b.length >= 30) {
      const chunk = b.toString('latin1', 12, 16);
      if (chunk === 'VP8X') return ok(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3));
      if (chunk === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return ok(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff));
      }
      if (chunk === 'VP8 ') return ok(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
      return null;
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1]!;
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        const len = b.readUInt16BE(i + 2);
        // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          return ok(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5));
        }
        i += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** A real WebP image (the thumbnail the browser sends). */
export function isWebp(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
}

/** Why a type is refused, in the words of the composer. */
export function unsupportedMessage(what: string): string {
  if (what === 'heic') return 'Le foto HEIC non si leggono ancora: esportala in JPEG e riprova.';
  if (what === 'avif') return 'Le immagini AVIF non si leggono ancora: usa PNG, JPEG o WebP.';
  if (what === 'html') return 'Le pagine HTML non si allegano: le creano solo i mostri.';
  if (what === 'svg') return 'Le immagini SVG non si allegano: usa PNG, JPEG o WebP.';
  return 'Questo tipo di file non si può allegare: immagini, PDF, testo e documenti Office sì.';
}
