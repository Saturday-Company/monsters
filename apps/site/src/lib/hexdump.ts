/*
 * Byte-level views of a text, shared by the build and the browser: an `xxd`-style hex dump
 * (offset, groups of two bytes, printable ASCII) and a CRC-32 stamp. Used for the genome dump
 * next to the dots and for the checksum labels of the windows.
 */

const encoder = new TextEncoder();

export const bytesOf = (text: string): Uint8Array => encoder.encode(text);

const hex = (n: number, width: number): string => n.toString(16).padStart(width, '0');

/** One `xxd` row per 16 bytes: `00000000: 7b0a 2020 2269 6422  {.  "id"`. */
export function xxd(bytes: Uint8Array, opts: { cols?: number; maxRows?: number } = {}): string[] {
  const cols = opts.cols ?? 16;
  const rows: string[] = [];
  const limit = opts.maxRows ?? Infinity;
  for (let off = 0; off < bytes.length && rows.length < limit; off += cols) {
    const chunk = bytes.subarray(off, off + cols);
    let groups = '';
    for (let i = 0; i < cols; i += 2) {
      const a = chunk[i];
      const b = chunk[i + 1];
      const pair = (a === undefined ? '  ' : hex(a, 2)) + (b === undefined ? '  ' : hex(b, 2));
      groups += (i ? ' ' : '') + pair;
    }
    let ascii = '';
    for (const c of chunk) ascii += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.';
    rows.push(`${hex(off, 8)}: ${groups}  ${ascii}`);
  }
  return rows;
}

let table: Uint32Array | null = null;

/** CRC-32 (IEEE 802.3) of the UTF-8 bytes of a text, as 8 hex digits. */
export function crc32(text: string | Uint8Array): string {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  const bytes = typeof text === 'string' ? bytesOf(text) : text;
  let crc = 0xffffffff;
  for (const b of bytes) crc = table[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return hex((crc ^ 0xffffffff) >>> 0, 8);
}
