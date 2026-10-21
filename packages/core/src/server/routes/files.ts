import {
  FILE_MAX_BYTES,
  FILE_THUMB_MAX_BYTES,
  FileListQuerySchema,
  type FileMeta,
} from '@monsters/shared';
import type { Context, Hono } from 'hono';
import { FileError, type FileStore } from '../../files/store.ts';
import type { EventLog } from '../../log/event-log.ts';
import type { TeamService } from '../../team/team-service.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';
import { fileContentBody, fileContentHeaders, INERT_FILE_CSP } from '../file-headers.ts';
import { serverStrings } from '../server.strings.ts';

/*
 * Files of the user and of the monsters (contract in shared/src/files.ts,
 * D-075). The upload is the only request of the API that is not JSON: the app
 * lets `multipart/form-data` through on `POST /api/files` alone, still with the
 * anti-CSRF header, and without its body limit: the body is read here with a
 * ceiling of its own and the reading stops as soon as it is passed.
 */

export const FILES_UPLOAD_PATH = '/api/files';
/** Room for the multipart envelope and the thumbnail around the file itself. */
const ENVELOPE_BYTES = 64 * 1024;
export const UPLOAD_MAX_BYTES = FILE_MAX_BYTES + FILE_THUMB_MAX_BYTES + ENVELOPE_BYTES;
/**
 * Uploads read at the same time (review of 16/10): each holds its body and a
 * copy of the file in memory; the others wait their turn, unread.
 */
export const UPLOADS_AT_ONCE = 3;

/** A counter of turns: `run` waits until fewer than `max` are running. */
export class Turns {
  readonly #max: number;
  #running = 0;
  readonly #waiting: (() => void)[] = [];
  constructor(max: number) {
    this.#max = max;
  }
  get running(): number {
    return this.#running;
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#running >= this.#max) await new Promise<void>((r) => this.#waiting.push(r));
    this.#running++;
    try {
      return await work();
    } finally {
      this.#running--;
      this.#waiting.shift()?.();
    }
  }
}

const tooLarge = (c: Context) =>
  c.json({ error: 'file_too_large', message: serverStrings().fileTooLarge }, 413);

/** The request body, or null as soon as it passes `max` bytes (the rest is never read). */
export async function readBodyCapped(
  req: Request,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(req.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > max) return null;
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export function registerFileRoutes(
  app: Hono<AppEnv>,
  h: RouteHelpers,
  deps: { files: () => FileStore; log: EventLog; team: TeamService },
): void {
  const { requireAuth } = h;
  const unknown = (c: Context) =>
    c.json({ error: 'unknown_file', message: serverStrings().fileNotFound }, 404);
  const find = (c: Context): FileMeta | undefined => deps.files().get(c.req.param('id') ?? '');
  const uploads = new Turns(UPLOADS_AT_ONCE);

  app.post(FILES_UPLOAD_PATH, requireAuth, (c) => uploads.run(() => upload(c)));

  const upload = async (c: Context) => {
    const type = c.req.header('content-type') ?? '';
    if (!/^multipart\/form-data;/i.test(type)) {
      return c.json({ error: 'unsupported_media_type' }, 415);
    }
    const body = await readBodyCapped(c.req.raw, UPLOAD_MAX_BYTES);
    if (!body) return tooLarge(c);
    let form: FormData;
    try {
      // The body as it is, not through a Blob: one copy less of up to 25 MB.
      form = await new Response(body, { headers: { 'content-type': type } }).formData();
    } catch {
      return c.json({ error: 'invalid_request', message: serverStrings().uploadUnreadable }, 400);
    }
    const file = form.get('file');
    if (!(file instanceof Blob)) {
      return c.json({ error: 'invalid_request', message: serverStrings().fileMissing }, 400);
    }
    if (file.size > FILE_MAX_BYTES) return tooLarge(c);
    const agentField = form.get('agent');
    const agent =
      typeof agentField === 'string' && agentField ? deps.team.get(agentField) : undefined;
    if (typeof agentField === 'string' && agentField && !agent) {
      return c.json({ error: 'unknown_agent' }, 404);
    }
    const thumbField = form.get('thumb');
    const thumb =
      thumbField instanceof Blob && thumbField.size > 0 && thumbField.size <= FILE_THUMB_MAX_BYTES
        ? new Uint8Array(await thumbField.arrayBuffer())
        : undefined;
    try {
      const meta = await deps.files().save({
        bytes: new Uint8Array(await file.arrayBuffer()),
        name: file.name || 'file',
        source: 'user',
        agent: agent?.config.id,
        thumb,
        maxBytes: FILE_MAX_BYTES,
      });
      return c.json(meta, 201);
    } catch (err) {
      if (err instanceof FileError) {
        if (err.code === 'file_too_large') return tooLarge(c);
        return c.json(
          { error: err.code, message: err.message },
          err.code === 'unsupported_type' ? 415 : 400,
        );
      }
      throw err;
    }
  };

  app.get('/api/files', requireAuth, (c) => {
    const parsed = FileListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    return c.json({ files: deps.files().list(parsed.data) });
  });

  app.get('/api/files/:id', requireAuth, (c) => {
    const meta = find(c);
    return meta ? c.json(meta) : unknown(c);
  });

  app.get('/api/files/:id/content', requireAuth, (c) => {
    const meta = find(c);
    if (!meta) return unknown(c);
    const bytes = deps.files().read(meta);
    if (!bytes) return unknown(c);
    const download = c.req.query('download') === '1';
    // The page as the preview pane runs it (lockdown first, D-085); "Scarica" gives the file as it is.
    const body = download ? new Uint8Array(bytes) : fileContentBody(meta, bytes);
    // The headers of the preview pane (file-headers.ts): sandbox, nosniff, framed by the core only.
    const headers: Record<string, string> = {
      'Content-Type': meta.mime,
      'Content-Length': String(body.byteLength),
      ...fileContentHeaders(meta),
    };
    // "Scarica" in the File view.
    const inline = headers['Content-Disposition'] ?? '';
    if (download) {
      headers['Content-Disposition'] = inline.replace(/^inline/, 'attachment');
    }
    return c.body(new Uint8Array(body), 200, headers);
  });

  // "Attiva gli script" (D-085): only the user, by a click in the preview pane, turns them on.
  app.post('/api/files/:id/scripts', requireAuth, (c) => {
    const meta = find(c);
    if (!meta) return unknown(c);
    if (meta.kind !== 'html') return c.json({ error: 'invalid_request' }, 400);
    const now = deps.files().allowScripts(meta.id);
    if (!now) return unknown(c);
    deps.log.append({
      agent: 'user',
      type: 'file',
      data: {
        action: 'updated',
        id: now.id,
        name: now.name,
        kind: now.kind,
        source: now.source,
      },
    });
    return c.json(now);
  });

  app.get('/api/files/:id/thumb', requireAuth, (c) => {
    const meta = find(c);
    if (!meta) return unknown(c);
    const thumb = deps.files().thumb(meta.id);
    if (!thumb) return c.json({ error: 'no_thumb' }, 404);
    return c.body(new Uint8Array(thumb), 200, {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=86400',
      'Content-Security-Policy': INERT_FILE_CSP,
      'X-Content-Type-Options': 'nosniff',
    });
  });

  app.get('/api/files/:id/text', requireAuth, (c) => {
    const meta = find(c);
    if (!meta) return unknown(c);
    return c.json(deps.files().text(meta.id) ?? { text: '', truncated: false });
  });

  app.delete('/api/files/:id', requireAuth, (c) => {
    const meta = find(c);
    if (!meta || !deps.files().delete(meta.id)) return unknown(c);
    deps.log.append({
      agent: 'user',
      type: 'file',
      data: {
        action: 'deleted',
        id: meta.id,
        name: meta.name,
        kind: meta.kind,
        source: meta.source,
      },
    });
    return c.json({ ok: true });
  });
}
