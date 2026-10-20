/*
 * Headers of `GET /api/files/:id/content` (plan of 16/10 feature 4, D-075).
 *
 * The bytes of a file are served from the core's origin, where the session
 * cookie lives, so nothing in them may ever run there:
 * - HTML (an artifact made by a monster) gets a sandbox with scripts but an
 *   opaque origin (no cookies, no storage, no access to the parent) and no
 *   network at all: everything it needs must be inline or `data:`/`blob:`;
 * - everything else (images, SVG included, PDF, text…) gets a sandbox without
 *   scripts, so an SVG or an HTML-ish file opened directly is inert.
 * Framed only by the core's own pages (the preview pane's iframe).
 *
 * Security review of 16/10 (D-085): Chromium lets WebRTC send UDP out of such a
 * page whatever the CSP says. A scripted page is served with the lockdown of
 * `html-lockdown.ts` first (no network API, no frames, Trusted Types), and the
 * page of a run that read third-party text (`inert`) is served with no
 * scripts at all until the user turns them on.
 */

import { LOCKDOWN_CSP, lockDownHtml } from './html-lockdown.ts';

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

export const HTML_FILE_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  ...LOCKDOWN_CSP,
].join('; ');

/** A page of a run that read third-party text: shown, but nothing in it runs (D-085). */
export const INERT_HTML_CSP = [
  'sandbox',
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

export const INERT_FILE_CSP = [
  'sandbox',
  "default-src 'none'",
  "img-src 'self' data:",
  "style-src 'unsafe-inline'",
  "frame-ancestors 'self'",
].join('; ');

/** `text/html; charset=utf-8` → `text/html`. */
const baseType = (mime: string) => mime.split(';')[0]!.trim().toLowerCase();

export const isHtmlMime = (mime: string) => HTML_TYPES.has(baseType(mime));

/** ASCII fallback of a file name for `filename="…"` (no quotes, backslashes or controls). */
function asciiName(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .trim();
  return ascii || 'file';
}

/** RFC 5987 encoding for `filename*=UTF-8''…`. */
function encodeName(name: string): string {
  return encodeURIComponent(name).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Headers for the bytes of a stored file (besides its `Content-Type`). */
export function fileContentHeaders(meta: {
  mime: string;
  name: string;
  /** An HTML page served without scripts (`FileMeta.inert`). */
  inert?: boolean | undefined;
}): Record<string, string> {
  const html = isHtmlMime(meta.mime);
  // eslint-disable-next-line no-control-regex
  const name = meta.name.replace(/[\u0000-\u001f\u007f]/g, '');
  return {
    'Content-Security-Policy': html
      ? meta.inert
        ? INERT_HTML_CSP
        : HTML_FILE_CSP
      : INERT_FILE_CSP,
    'X-Content-Type-Options': 'nosniff',
    // No DNS lookups for the links of a page (a hostname can carry data).
    'X-DNS-Prefetch-Control': 'off',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Disposition': `inline; filename="${asciiName(name)}"; filename*=UTF-8''${encodeName(name)}`,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'private, no-store',
  };
}

/**
 * The bytes of a file as the preview pane gets them: a scripted HTML page with
 * the lockdown first (D-085); everything else, inert pages included, as it is.
 */
export function fileContentBody(
  meta: { mime: string; inert?: boolean | undefined },
  bytes: Uint8Array,
): Uint8Array {
  if (!isHtmlMime(meta.mime) || meta.inert) return bytes;
  return Buffer.from(lockDownHtml(Buffer.from(bytes).toString('utf8')), 'utf8');
}
