/*
 * Update server of the desktop app: a Cloudflare Worker that serves electron-updater's "generic"
 * feed (latest*.yml, installers, blockmaps) from the private R2 bucket `monsters-updates`, bound
 * as `BUCKET`, over https on workers.dev.
 *
 * Read-only and static: GET and HEAD of one object, conditional GET (If-None-Match) and byte
 * ranges, including the multipart/byteranges answers that electron-updater's differential
 * download needs. No listing, no writes: releases are uploaded to the bucket out of band.
 *
 * Workers on the free plan get ~10 ms of CPU per request, so object bodies are never read in
 * JS: they are piped from R2 to the response. Only web-standard globals are used (plus
 * FixedLengthStream when the runtime has it), so the tests run the same code in Node.
 *
 * Deployed by scripts/deploy.ts (`pnpm --filter @monsters/update-server deploy:worker`).
 */

/** The subset of an R2 object's metadata that the Worker uses. */
export interface BucketObject {
  size: number;
  /** Quoted entity tag, ready for the ETag header. */
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
}

/** An R2 object with its body (the whole object or the requested range). */
export interface BucketObjectBody extends BucketObject {
  body: ReadableStream<Uint8Array>;
}

/** The subset of the R2 binding that the Worker uses. */
export interface Bucket {
  head(key: string): Promise<BucketObject | null>;
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<BucketObjectBody | null>;
}

export interface Env {
  BUCKET: Bucket;
}

/** The subset of the Workers execution context that the Worker uses. */
export interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** An inclusive byte range, already clamped to the object's size. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Most ranges served in one multipart answer; each one is a `BUCKET.get` (plus the initial
 * `head`), billed by R2. Above this cap the Range header is ignored and the whole object is sent
 * with a 200, and electron-updater then falls back to a full download of the file.
 */
export const MAX_RANGES = 500;

const ALLOWED_KEY = /^[A-Za-z0-9._+\- /]+$/;

/** The only folder of the bucket that is public: the feed (`desktop/`, and `desktop/e2e-*`). */
const SERVED_PREFIX = 'desktop/';

/**
 * File types of a release: channel files and their signatures (`alpha-linux.yml.sig`, S-A4),
 * installers, blockmaps. Anything else stays private.
 */
const SERVED_EXTENSIONS = new Set([
  'yml',
  'yaml',
  'sig',
  'json',
  'blockmap',
  'appimage',
  'exe',
  'dmg',
  'zip',
  'deb',
]);

/**
 * The bucket key of a URL pathname: without the leading `/`, percent-decoded. Null for keys that
 * are not served: empty (the root, no listing), undecodable, with `..`, `.` or empty segments,
 * backslashes, control characters or anything outside letters, digits, `._+-`, space and `/`.
 * Also null for keys outside `desktop/` or with an extension that is not a release file: other
 * objects of the bucket (leftovers, uploads by mistake) are not public.
 */
export function objectKey(pathname: string): string | null {
  if (!pathname.startsWith('/')) return null;
  let key: string;
  try {
    key = decodeURIComponent(pathname.slice(1));
  } catch {
    return null;
  }
  if (key === '' || !ALLOWED_KEY.test(key) || key.includes('..')) return null;
  if (key.split('/').some((segment) => segment === '' || segment === '.')) return null;
  if (!key.startsWith(SERVED_PREFIX) || !SERVED_EXTENSIONS.has(extension(key))) return null;
  return key;
}

function extension(key: string): string {
  const name = key.slice(key.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Content type by extension: feed metadata as text, everything else as opaque bytes. */
export function contentType(key: string): string {
  switch (extension(key)) {
    case 'yml':
    case 'yaml':
      return 'text/yaml; charset=utf-8';
    case 'json':
      return 'application/json';
    case 'sig':
      return 'text/plain; charset=utf-8';
    default:
      // .blockmap, .AppImage, .exe, .dmg, .zip, .deb, …
      return 'application/octet-stream';
  }
}

/**
 * The feed metadata must never be stale, and a signature never older than its channel file;
 * installers and blockmaps are immutable per version.
 */
export function cacheControl(key: string): string {
  const ext = extension(key);
  return ['yml', 'yaml', 'json', 'sig'].includes(ext) ? 'no-cache' : 'public, max-age=3600';
}

function opaqueTag(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}

/** If-None-Match against the object's ETag, with the weak comparison of RFC 9110 §13.1.2. */
export function etagMatches(ifNoneMatch: string, etag: string): boolean {
  const own = opaqueTag(etag);
  return ifNoneMatch
    .split(',')
    .map((tag) => tag.trim())
    .some((tag) => tag === '*' || (tag !== '' && opaqueTag(tag) === own));
}

/**
 * The ranges of a Range header (RFC 9110 §14.2) for an object of `size` bytes, in the requested
 * order, clamped to the size; unsatisfiable ones are dropped. `null` when the header is to be
 * ignored (malformed, not in bytes, more than MAX_RANGES ranges, overlapping ranges, which
 * could ask for many times the size of the object): the whole object is served. `'unsatisfiable'` when no range is left (416).
 */
export function parseRange(header: string, size: number): ByteRange[] | 'unsatisfiable' | null {
  const eq = header.indexOf('=');
  if (eq < 0 || header.slice(0, eq).trim().toLowerCase() !== 'bytes') return null;
  // A list may contain empty elements (RFC 9110 §5.6.1), but not only those.
  const specs = header
    .slice(eq + 1)
    .split(',')
    .map((spec) => spec.trim())
    .filter((spec) => spec !== '');
  if (specs.length === 0 || specs.length > MAX_RANGES) return null;

  const ranges: ByteRange[] = [];
  for (const spec of specs) {
    const match = /^(\d*)-(\d*)$/.exec(spec);
    if (!match) return null;
    const [, first = '', last = ''] = match;
    if (first === '') {
      // Suffix range: the last n bytes.
      if (last === '') return null;
      const length = Number(last);
      if (length > 0 && size > 0) ranges.push({ start: Math.max(0, size - length), end: size - 1 });
      continue;
    }
    const start = Number(first);
    const end = last === '' ? Infinity : Number(last);
    if (end < start) return null;
    if (start < size) ranges.push({ start, end: Math.min(end, size - 1) });
  }
  if (ranges.length === 0) return 'unsatisfiable';
  // The total can then never exceed the object: ranges are disjoint (adjacent is fine).
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start <= sorted[i - 1]!.end) return null;
  }
  return ranges;
}

/** Headers of every response that carries the object (or a part of it). */
export function objectHeaders(key: string, object: BucketObject): Headers {
  return new Headers({
    ETag: object.httpEtag,
    'Last-Modified': object.uploaded.toUTCString(),
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType(key),
    'Cache-Control': cacheControl(key),
    'X-Content-Type-Options': 'nosniff',
  });
}

function textResponse(status: number, text: string, headers?: Record<string, string>): Response {
  return new Response(`${text}\n`, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

const notFound = (): Response => textResponse(404, 'Not Found');

function contentRange(range: ByteRange, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`;
}

function rangeLength(range: ByteRange): number {
  return range.end - range.start + 1;
}

/** Workers' TransformStream that enforces (and announces) an exact byte length. */
type FixedLengthStreamConstructor = new (length: number) => TransformStream<Uint8Array, Uint8Array>;

function byteStream(length: number): TransformStream<Uint8Array, Uint8Array> {
  const Fixed = (globalThis as { FixedLengthStream?: FixedLengthStreamConstructor })
    .FixedLengthStream;
  return Fixed ? new Fixed(length) : new TransformStream<Uint8Array, Uint8Array>();
}

async function write(writable: WritableStream<Uint8Array>, bytes: Uint8Array): Promise<void> {
  const writer = writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

/**
 * A 206 multipart/byteranges answer: each range in the requested order, with one `BUCKET.get`
 * per range made sequentially while the client reads. Part headers are the only bytes written
 * from JS; the bodies are piped. If anything fails midway the stream is aborted, so the client
 * sees a truncated response and never a short one that looks complete.
 */
function multipartResponse(
  env: Env,
  key: string,
  object: BucketObject,
  ranges: ByteRange[],
  headers: Headers,
  ctx?: WorkerContext,
): Response {
  const boundary = crypto.randomUUID().replaceAll('-', '');
  const type = contentType(key);
  const encoder = new TextEncoder();
  const partHeads = ranges.map((range) =>
    encoder.encode(
      `\r\n--${boundary}\r\nContent-Type: ${type}\r\nContent-Range: ${contentRange(range, object.size)}\r\n\r\n`,
    ),
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const length =
    ranges.reduce((sum, range, i) => sum + partHeads[i]!.byteLength + rangeLength(range), 0) +
    tail.byteLength;

  const { readable, writable } = byteStream(length);
  const pump = (async () => {
    try {
      for (const [i, range] of ranges.entries()) {
        await write(writable, partHeads[i]!);
        const part = await env.BUCKET.get(key, {
          range: { offset: range.start, length: rangeLength(range) },
        });
        if (!part) throw new Error(`${key} disappeared while it was being served`);
        await part.body.pipeTo(writable, { preventClose: true });
      }
      await write(writable, tail);
      await writable.close();
    } catch (err) {
      await writable.abort(err).catch(() => undefined);
    }
  })();
  ctx?.waitUntil(pump);

  headers.set('Content-Type', `multipart/byteranges; boundary=${boundary}`);
  headers.set('Content-Length', String(length));
  return new Response(readable, { status: 206, headers });
}

export async function handle(request: Request, env: Env, ctx?: WorkerContext): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return textResponse(405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
  }
  // The query string is ignored: electron-updater may add `?noCache=…`.
  const key = objectKey(new URL(request.url).pathname);
  if (key === null) return notFound();
  const object = await env.BUCKET.head(key);
  if (!object) return notFound();

  const headers = objectHeaders(key, object);
  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifNoneMatch !== null && etagMatches(ifNoneMatch, object.httpEtag)) {
    headers.delete('Content-Type');
    return new Response(null, { status: 304, headers });
  }

  const rangeHeader = request.method === 'GET' ? request.headers.get('Range') : null;
  const ranges = rangeHeader === null ? null : parseRange(rangeHeader, object.size);
  if (ranges === 'unsatisfiable') {
    return textResponse(416, 'Range Not Satisfiable', {
      'Content-Range': `bytes */${object.size}`,
      'Accept-Ranges': 'bytes',
    });
  }

  if (ranges === null) {
    headers.set('Content-Length', String(object.size));
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    const full = await env.BUCKET.get(key);
    if (!full) return notFound();
    return new Response(full.body, { status: 200, headers });
  }

  if (ranges.length > 1) return multipartResponse(env, key, object, ranges, headers, ctx);

  const range = ranges[0]!;
  const part = await env.BUCKET.get(key, {
    range: { offset: range.start, length: rangeLength(range) },
  });
  if (!part) return notFound();
  headers.set('Content-Range', contentRange(range, object.size));
  headers.set('Content-Length', String(rangeLength(range)));
  return new Response(part.body, { status: 206, headers });
}

export default {
  fetch: handle,
};
