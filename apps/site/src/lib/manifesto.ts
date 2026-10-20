/*
 * The base64 block of the open source section: the manifesto, encoded, that decodes itself on
 * hover or focus. UTF-8 safe both ways, in Node (build) and in the browser.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64(text: string): string {
  let bin = '';
  for (const b of encoder.encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return decoder.decode(bytes);
}

/** Splits the encoded text in rows of `width` characters, like a terminal dump. */
export function wrapBase64(b64: string, width = 64): string[] {
  const rows: string[] = [];
  for (let i = 0; i < b64.length; i += width) rows.push(b64.slice(i, i + width));
  return rows;
}

/**
 * One frame of the decoding: the first `step / steps` of the plain text, then the rest of the
 * encoded text, so the block morphs left to right. `step >= steps` is the plain text.
 */
export function revealFrame(plain: string, encoded: string, step: number, steps: number): string {
  if (steps <= 0 || step >= steps) return plain;
  if (step <= 0) return encoded;
  const cut = Math.round((plain.length * step) / steps);
  return plain.slice(0, cut) + encoded.slice(cut, Math.max(cut, encoded.length));
}
