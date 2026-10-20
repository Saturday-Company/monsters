import { describe, expect, it } from 'vitest';
import worker, {
  MAX_RANGES,
  objectKey,
  parseRange,
  type Bucket,
  type BucketObject,
  type BucketObjectBody,
  type Env,
} from '../src/worker.ts';

interface Stored {
  data: Uint8Array;
  etag: string;
  uploaded: Date;
}

/** In-memory R2 bucket; `failOnGet` makes the n-th get (1-based) return a body that errors. */
class FakeBucket implements Bucket {
  readonly objects = new Map<string, Stored>();
  readonly calls: string[] = [];
  failOnGet = 0;

  put(key: string, data: Uint8Array | string): void {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    this.objects.set(key, {
      data: bytes,
      etag: `etag-${this.objects.size + 1}`,
      uploaded: new Date('2026-10-01T12:00:00Z'),
    });
  }

  head(key: string): Promise<BucketObject | null> {
    this.calls.push(`head ${key}`);
    const o = this.objects.get(key);
    return Promise.resolve(o ? this.meta(o) : null);
  }

  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<BucketObjectBody | null> {
    const range = options?.range;
    this.calls.push(range ? `get ${key} ${range.offset}+${range.length}` : `get ${key}`);
    const o = this.objects.get(key);
    if (!o) return Promise.resolve(null);
    const bytes = range ? o.data.slice(range.offset, range.offset + range.length) : o.data;
    const fail = this.calls.filter((c) => c.startsWith('get ')).length === this.failOnGet;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (fail) {
          controller.enqueue(bytes.slice(0, 1));
          controller.error(new Error('R2 read failed'));
          return;
        }
        // Two chunks, to exercise piping.
        const half = Math.floor(bytes.byteLength / 2);
        if (half > 0) controller.enqueue(bytes.slice(0, half));
        controller.enqueue(bytes.slice(half));
        controller.close();
      },
    });
    return Promise.resolve({ ...this.meta(o), body });
  }

  private meta(o: Stored): BucketObject {
    return { size: o.data.byteLength, httpEtag: `"${o.etag}"`, uploaded: o.uploaded };
  }
}

const BINARY = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7 + 3) % 256);
const FEED = 'version: 0.1.0\npath: Monsters-0.1.0.AppImage\n';
const SIG = `monsters-update-signature-v1\nkey 0123456789abcdef ${'A'.repeat(86)}==\n`;

function setup(): { bucket: FakeBucket; env: Env } {
  const bucket = new FakeBucket();
  bucket.put('desktop/latest-linux.yml', FEED);
  bucket.put('desktop/Monsters-0.1.0.AppImage', BINARY);
  bucket.put('desktop/Monsters Setup 0.1.0.exe', BINARY.slice(0, 10));
  bucket.put('desktop/mac/latest-mac.json', '{}');
  bucket.put('e2e/abc/latest-linux.yml', FEED);
  bucket.put('desktop/notes.txt', 'x');
  bucket.put('desktop/Monsters.AppImage.sh', 'x');
  bucket.put('desktop/latest-linux.yml.sig', SIG);
  return { bucket, env: { BUCKET: bucket } };
}

/** A request under `/desktop`, the only prefix the Worker serves. */
function request(env: Env, path: string, init?: RequestInit): Promise<Response> {
  return requestRaw(env, `/desktop${path}`, init);
}

function requestRaw(env: Env, path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://updates.example.workers.dev${path}`, init), env);
}

async function bytes(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

describe('full responses', () => {
  it('serves an object with its headers', async () => {
    const { env } = setup();
    const res = await request(env, '/Monsters-0.1.0.AppImage');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe('"etag-2"');
    expect(res.headers.get('last-modified')).toBe('Thu, 01 Oct 2026 12:00:00 GMT');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-length')).toBe('1000');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await bytes(res)).toEqual(BINARY);
  });

  it('serves the feed metadata as uncached text', async () => {
    const { env } = setup();
    const res = await request(env, '/latest-linux.yml');
    expect(res.headers.get('content-type')).toBe('text/yaml; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe(FEED);
    const json = await request(env, '/mac/latest-mac.json');
    expect(json.headers.get('content-type')).toBe('application/json');
    expect(json.headers.get('cache-control')).toBe('no-cache');
  });

  it('serves the signature of a channel file, uncached like the file (S-A4)', async () => {
    const { env } = setup();
    const res = await request(env, '/latest-linux.yml.sig');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe(SIG);
    // Through HEAD too (publish-update.ts reads everything back), and only under desktop/.
    expect((await request(env, '/latest-linux.yml.sig', { method: 'HEAD' })).status).toBe(200);
    expect(objectKey('/e2e/abc/latest-linux.yml.sig')).toBeNull();
    expect((await request(env, '/missing.yml.sig')).status).toBe(404);
  });

  it('decodes the path and ignores the query string', async () => {
    const { env } = setup();
    const res = await request(env, '/Monsters%20Setup%200.1.0.exe?noCache=1abc');
    expect(res.status).toBe(200);
    expect(await bytes(res)).toEqual(BINARY.slice(0, 10));
    const feed = await request(env, '/latest-linux.yml?noCache=xyz');
    expect(await feed.text()).toBe(FEED);
  });

  it('answers HEAD with the same headers and no get', async () => {
    const { bucket, env } = setup();
    const get = await request(env, '/Monsters-0.1.0.AppImage');
    bucket.calls.length = 0;
    const head = await request(env, '/Monsters-0.1.0.AppImage', {
      method: 'HEAD',
      headers: { Range: 'bytes=0-9' },
    });
    expect(head.status).toBe(200);
    expect([...head.headers]).toEqual([...get.headers]);
    expect(head.body).toBeNull();
    expect(bucket.calls).toEqual(['head desktop/Monsters-0.1.0.AppImage']);
  });
});

describe('rejections', () => {
  it.each([
    '/',
    '//latest-linux.yml',
    '/mac//latest-mac.json',
    '/mac/',
    '/%2e%2e%2flatest-linux.yml',
    '/mac%2F..%2Flatest-linux.yml',
    '/a..b',
    '/mac%5Clatest-mac.json',
    '/latest-linux.yml%00',
    '/latest%0a.yml',
    '/%E0%A4%A',
    '/caf%C3%A9.yml',
    '/latest-linux.yml;x',
    '/missing.yml',
  ])('404 for %s', async (path) => {
    const { env } = setup();
    const res = await request(env, path);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('Not Found\n');
  });

  it('rejects traversal and odd keys in the pure helper', () => {
    expect(objectKey('/a/../b')).toBeNull();
    expect(objectKey('/./b')).toBeNull();
    expect(objectKey('/%2E%2E/b')).toBeNull();
    expect(objectKey('/a\\b')).toBeNull();
    expect(objectKey('')).toBeNull();
    expect(objectKey('/desktop/mac/Monsters-0.1.0-arm64.zip')).toBe(
      'desktop/mac/Monsters-0.1.0-arm64.zip',
    );
    expect(objectKey('/desktop/Monsters%20Setup%200.1.0.exe')).toBe(
      'desktop/Monsters Setup 0.1.0.exe',
    );
  });

  it('serves only the desktop/ prefix and the feed file types', async () => {
    const { bucket, env } = setup();
    expect(objectKey('/e2e/abc/latest-linux.yml')).toBeNull();
    expect(objectKey('/latest-linux.yml')).toBeNull();
    expect(objectKey('/desktopx/latest-linux.yml')).toBeNull();
    expect(objectKey('/desktop/notes.txt')).toBeNull();
    expect(objectKey('/desktop/Monsters.AppImage.sh')).toBeNull();
    expect(objectKey('/desktop/Monsters-0.1.0.deb')).not.toBeNull();
    expect(objectKey('/desktop/alpha.yml')).not.toBeNull();
    expect(objectKey('/desktop/Monsters.exe.blockmap')).not.toBeNull();
    for (const path of ['/e2e/abc/latest-linux.yml', '/desktop/notes.txt']) {
      expect((await requestRaw(env, path)).status).toBe(404);
    }
    expect(bucket.calls).toEqual([]);
  });

  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS'])('405 for %s', async (method) => {
    const { bucket, env } = setup();
    const res = await request(env, '/latest-linux.yml', { method });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
    expect(bucket.calls).toEqual([]);
  });
});

describe('conditional requests', () => {
  it.each(['"etag-1"', 'W/"etag-1"', '"other", "etag-1"', '*'])(
    '304 for If-None-Match %s',
    async (tag) => {
      const { bucket, env } = setup();
      const res = await request(env, '/latest-linux.yml', { headers: { 'If-None-Match': tag } });
      expect(res.status).toBe(304);
      expect(res.headers.get('etag')).toBe('"etag-1"');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(await res.text()).toBe('');
      expect(bucket.calls).toEqual(['head desktop/latest-linux.yml']);
    },
  );

  it('200 when the ETag differs', async () => {
    const { env } = setup();
    const res = await request(env, '/latest-linux.yml', {
      headers: { 'If-None-Match': '"etag-2"' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(FEED);
  });
});

describe('single ranges', () => {
  it.each([
    ['bytes=10-19', 10, 19],
    ['bytes=990-', 990, 999],
    ['bytes=-5', 995, 999],
    ['bytes=-5000', 0, 999],
    ['bytes=500-5000', 500, 999],
    ['Bytes = 0-0', 0, 0],
    ['bytes=2000-3000, 3-4', 3, 4],
  ])('%s', async (range, start, end) => {
    const { bucket, env } = setup();
    const res = await request(env, '/Monsters-0.1.0.AppImage', { headers: { Range: range } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes ${start}-${end}/1000`);
    expect(res.headers.get('content-length')).toBe(String(end - start + 1));
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('etag')).toBe('"etag-2"');
    expect(await bytes(res)).toEqual(BINARY.slice(start, end + 1));
    expect(bucket.calls).toEqual([
      'head desktop/Monsters-0.1.0.AppImage',
      `get desktop/Monsters-0.1.0.AppImage ${start}+${end - start + 1}`,
    ]);
  });

  it.each(['bytes=1000-', 'bytes=5000-6000', 'bytes=-0', 'bytes=1000-1001, 2000-'])(
    '416 for %s',
    async (range) => {
      const { env } = setup();
      const res = await request(env, '/Monsters-0.1.0.AppImage', { headers: { Range: range } });
      expect(res.status).toBe(416);
      expect(res.headers.get('content-range')).toBe('bytes */1000');
    },
  );

  it.each(['bytes=5-1', 'bytes=abc', 'bytes=-', 'items=0-10', 'bytes=0-10;x', 'bytes=,', '0-10'])(
    'ignores the malformed %s',
    async (range) => {
      const { env } = setup();
      const res = await request(env, '/Monsters-0.1.0.AppImage', { headers: { Range: range } });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-length')).toBe('1000');
      expect(await bytes(res)).toEqual(BINARY);
    },
  );
});

interface Part {
  headers: Record<string, string>;
  body: Uint8Array;
}

/** Splits a multipart/byteranges body byte-exactly, checking its framing. */
function parseMultipart(body: Uint8Array, boundary: string): Part[] {
  const buf = Buffer.from(body);
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const parts: Part[] = [];
  let at = buf.indexOf(delimiter);
  expect(at).toBe(0);
  for (;;) {
    at += delimiter.byteLength;
    if (buf.subarray(at, at + 4).toString() === '--\r\n') {
      expect(at + 4).toBe(buf.byteLength);
      return parts;
    }
    expect(buf.subarray(at, at + 2).toString()).toBe('\r\n');
    const headEnd = buf.indexOf('\r\n\r\n', at + 2);
    const headers = Object.fromEntries(
      buf
        .subarray(at + 2, headEnd)
        .toString()
        .split('\r\n')
        .map((line) => {
          const colon = line.indexOf(':');
          return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
        }),
    );
    // The part's length comes from its Content-Range, so binary data may contain anything.
    const [, start, end] = /^bytes (\d+)-(\d+)\/\d+$/.exec(headers['content-range']!)!;
    const bodyStart = headEnd + 4;
    const bodyEnd = bodyStart + Number(end) - Number(start) + 1;
    parts.push({ headers, body: new Uint8Array(buf.subarray(bodyStart, bodyEnd)) });
    expect(buf.subarray(bodyEnd, bodyEnd + delimiter.byteLength).equals(delimiter)).toBe(true);
    at = bodyEnd;
  }
}

describe('multipart ranges', () => {
  it('serves several ranges in the requested order, byte-exactly', async () => {
    const { bucket, env } = setup();
    const res = await request(env, '/Monsters-0.1.0.AppImage', {
      headers: { Range: 'bytes=900-999,0-9 , 100-149, 5000-6000' },
    });
    expect(res.status).toBe(206);
    const type = res.headers.get('content-type')!;
    const [, boundary] = /^multipart\/byteranges; boundary=([A-Za-z0-9]+)$/.exec(type)!;
    expect(res.headers.get('content-range')).toBeNull();
    expect(res.headers.get('etag')).toBe('"etag-2"');
    const body = await bytes(res);
    expect(res.headers.get('content-length')).toBe(String(body.byteLength));

    const parts = parseMultipart(body, boundary!);
    expect(parts.map((p) => p.headers)).toEqual([
      { 'content-type': 'application/octet-stream', 'content-range': 'bytes 900-999/1000' },
      { 'content-type': 'application/octet-stream', 'content-range': 'bytes 0-9/1000' },
      { 'content-type': 'application/octet-stream', 'content-range': 'bytes 100-149/1000' },
    ]);
    expect(parts.map((p) => p.body)).toEqual([
      BINARY.slice(900, 1000),
      BINARY.slice(0, 10),
      BINARY.slice(100, 150),
    ]);
    expect(bucket.calls).toEqual([
      'head desktop/Monsters-0.1.0.AppImage',
      'get desktop/Monsters-0.1.0.AppImage 900+100',
      'get desktop/Monsters-0.1.0.AppImage 0+10',
      'get desktop/Monsters-0.1.0.AppImage 100+50',
    ]);
  });

  it('ignores a Range header with overlapping ranges (whole object, no multiplied reads)', async () => {
    const { bucket, env } = setup();
    for (const range of ['bytes=0-9,5-14', 'bytes=0-9,0-9', 'bytes=10-,5-20', 'bytes=0-,-100']) {
      bucket.calls.length = 0;
      const res = await request(env, '/Monsters-0.1.0.AppImage', { headers: { Range: range } });
      expect(res.status).toBe(200);
      expect(await bytes(res)).toEqual(BINARY);
      expect(bucket.calls).toEqual([
        'head desktop/Monsters-0.1.0.AppImage',
        'get desktop/Monsters-0.1.0.AppImage',
      ]);
    }
    // Adjacent ranges do not overlap.
    expect(parseRange('bytes=0-9,10-19', 1000)).toHaveLength(2);
  });

  it(`serves up to ${MAX_RANGES} ranges and ignores the header above`, async () => {
    const { bucket, env } = setup();
    const specs = (n: number): string =>
      'bytes=' + Array.from({ length: n }, (_, i) => `${i}-${i}`).join(',');

    const capped = await request(env, '/Monsters-0.1.0.AppImage', {
      headers: { Range: specs(MAX_RANGES) },
    });
    expect(capped.status).toBe(206);
    const [, boundary] = /boundary=(\w+)/.exec(capped.headers.get('content-type')!)!;
    const parts = parseMultipart(await bytes(capped), boundary!);
    expect(parts).toHaveLength(MAX_RANGES);
    expect(parts[MAX_RANGES - 1]!.body).toEqual(BINARY.slice(MAX_RANGES - 1, MAX_RANGES));
    expect(bucket.calls).toHaveLength(MAX_RANGES + 1);

    const over = await request(env, '/Monsters-0.1.0.AppImage', {
      headers: { Range: specs(MAX_RANGES + 1) },
    });
    expect(over.status).toBe(200);
    expect(await bytes(over)).toEqual(BINARY);
    expect(parseRange(specs(1000), 1000)).toBeNull();
  });

  it('aborts the response when a part fails midway', async () => {
    const { bucket, env } = setup();
    bucket.failOnGet = 2;
    const res = await request(env, '/Monsters-0.1.0.AppImage', {
      headers: { Range: 'bytes=0-9,20-29,40-49' },
    });
    expect(res.status).toBe(206);
    await expect(res.arrayBuffer()).rejects.toThrow();
    // The third part is never fetched.
    expect(bucket.calls.filter((c) => c.startsWith('get '))).toHaveLength(2);
  });

  it('aborts the response when the object disappears midway', async () => {
    const { bucket, env } = setup();
    const real = bucket.get.bind(bucket);
    let gets = 0;
    bucket.get = (key, options) => (++gets === 2 ? Promise.resolve(null) : real(key, options));
    const res = await request(env, '/Monsters-0.1.0.AppImage', {
      headers: { Range: 'bytes=0-9,20-29' },
    });
    await expect(res.arrayBuffer()).rejects.toThrow();
  });
});
