import { inflateRawSync } from 'node:zlib';

/*
 * A minimal ZIP reader for Office files (docx, xlsx, pptx): the central
 * directory and the entries stored or deflated, with `node:zlib`. No ZIP64,
 * no encryption: such files are simply not read. Every entry is inflated with
 * a ceiling, so a zip bomb costs at most that much memory.
 */

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** Most bytes of one entry once inflated. */
export const ZIP_ENTRY_MAX_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 5000;
/** Most entries inflated by one read (the slides of a deck, the sheets of a workbook). */
export const ZIP_MAX_READ_ENTRIES = 1000;

function centralDirectory(bytes: Uint8Array): Entry[] | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < 22) return null;
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (b.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = b.readUInt16LE(eocd + 10);
  let at = b.readUInt32LE(eocd + 16);
  if (count === 0xffff || at === 0xffffffff || count > MAX_ENTRIES) return null;
  const entries: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > b.length || b.readUInt32LE(at) !== CENTRAL) return null;
    const method = b.readUInt16LE(at + 10);
    const compressedSize = b.readUInt32LE(at + 20);
    const size = b.readUInt32LE(at + 24);
    const nameLen = b.readUInt16LE(at + 28);
    const extraLen = b.readUInt16LE(at + 30);
    const commentLen = b.readUInt16LE(at + 32);
    const localOffset = b.readUInt32LE(at + 42);
    const name = b.toString('utf8', at + 46, at + 46 + nameLen);
    entries.push({ name, method, compressedSize, size, localOffset });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Names of the entries, or null when the bytes are not a readable zip. */
export function zipEntryNames(bytes: Uint8Array): string[] | null {
  return centralDirectory(bytes)?.map((e) => e.name) ?? null;
}

/**
 * The entries whose name passes `wanted`, inflated (at most `maxTotal` bytes
 * in all, at most `ZIP_MAX_READ_ENTRIES` entries). Entries that cannot be read
 * are left out, and the reading stops at the first one that would pass the
 * ceiling or is damaged: an entry that fails costs as much as one that works
 * (review of 16/10: 5000 entries of the directory pointing at the same 32 MB
 * bomb were inflated 5000 times, since the failed ones never counted).
 */
export function readZipEntries(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
  maxTotal = ZIP_ENTRY_MAX_BYTES,
): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const entries = centralDirectory(bytes);
  if (!entries) return out;
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let total = 0;
  let read = 0;
  for (const e of entries) {
    if (!wanted(e.name)) continue;
    if (++read > ZIP_MAX_READ_ENTRIES) break;
    const at = e.localOffset;
    if (at + 30 > b.length || b.readUInt32LE(at) !== LOCAL) continue;
    const start = at + 30 + b.readUInt16LE(at + 26) + b.readUInt16LE(at + 28);
    const data = b.subarray(start, start + e.compressedSize);
    const left = maxTotal - total;
    if (left <= 0) break;
    try {
      let content: Buffer;
      if (e.method === 0) content = Buffer.from(data.subarray(0, left));
      else if (e.method === 8) content = inflateRawSync(data, { maxOutputLength: left });
      else continue;
      total += content.length;
      out.set(e.name, content);
    } catch {
      // Too big once inflated, or damaged: left out, and nothing more is read.
      break;
    }
  }
  return out;
}
