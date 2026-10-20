import {
  DOCUMENT_KINDS,
  FILE_MAX_BYTES,
  ulid,
  type EventInput,
  type FileKind,
  type FileMeta,
  type FileSource,
} from '@monsters/shared';
import type { RawResponse } from '../transport.ts';
import { MOCK_FILES } from './files-data.ts';

/*
 * `/api/files` of the mock core (D-075). Two kinds of files:
 * - the ones of `files-data.ts` (a menu, a screenshot, a PDF, pages…), whose
 *   bytes the dev server serves under `/__mock/api/files/…` with the core's
 *   very headers (vite.config.ts, scripts/mock-files.ts): an HTML page runs in
 *   the same sandbox as with the real core;
 * - what the composer uploads, and the demo photo of the user: blobs in
 *   memory, served through object URLs (never HTML).
 */

interface Stored {
  meta: FileMeta;
  blob?: Blob;
  text?: string;
  /** Not in the list (reachable by id only: the sandbox probe of the e2e tests). */
  hidden?: boolean;
  /** A page whose scripts the user turned on (the dev server learns it from the URL). */
  scripts?: boolean;
}

/** The screenshot of Rhea and the page of `files-data.ts` that the demo's events name. */
export const DEMO_SCREENSHOT = 'f-screenshot-tram';
export const DEMO_PAGE = 'f-pagina-menu';

const ok = (body: unknown, status = 200): RawResponse => ({ status, body });
const fail = (status: number, error: string, message?: string): RawResponse => ({
  status,
  body: { error, ...(message ? { message } : {}) },
});

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

function typeOf(name: string, type: string): { mime: string; kind: FileKind } | null {
  const ext = extOf(name);
  if (/^image\/(png|jpeg|webp|gif)$/.test(type)) return { mime: type, kind: 'image' };
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'gif') {
    return { mime: `image/${ext === 'jpg' ? 'jpeg' : ext}`, kind: 'image' };
  }
  if (ext === 'pdf') return { mime: 'application/pdf', kind: 'pdf' };
  if (ext === 'docx' || ext === 'pptx') {
    return { mime: 'application/octet-stream', kind: 'document' };
  }
  if (ext === 'xlsx' || ext === 'csv') return { mime: 'text/csv', kind: 'sheet' };
  if (ext === 'txt' || ext === 'md' || ext === 'json' || type.startsWith('text/')) {
    return { mime: 'text/plain; charset=utf-8', kind: 'text' };
  }
  return null;
}

const month = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** The demo photo of the user: a little landscape, as SVG. */
function photo(): Blob {
  const body = `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6b26b"/><stop offset="1" stop-color="#e06666"/></linearGradient></defs>
    <rect width="640" height="480" fill="url(#s)"/><circle cx="460" cy="170" r="60" fill="#ffe599"/>
    <path d="M0 360 L120 260 L230 330 L360 220 L500 320 L640 260 L640 480 L0 480Z" fill="#7a3e48"/>
    <path d="M0 420 L160 340 L300 400 L460 330 L640 410 L640 480 L0 480Z" fill="#4c2a3a"/>
    <rect x="300" y="300" width="18" height="60" fill="#f3e5c0"/><rect x="296" y="290" width="26" height="14" fill="#c94f3d"/>`;
  return new Blob(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">${body}</svg>`,
    ],
    { type: 'image/svg+xml' },
  );
}

export class MockFiles {
  readonly #files = new Map<string, Stored>();
  readonly #urls = new Map<string, string>();
  readonly #log: (event: EventInput, ts?: number) => void;
  readonly #speed: number;

  constructor(options: { log: (event: EventInput, ts?: number) => void; speed: number }) {
    this.#log = options.log;
    this.#speed = options.speed;
    for (const f of MOCK_FILES) {
      const text =
        f.body.kind === 'text'
          ? f.body.text
          : f.body.kind === 'pdf'
            ? f.body.pages.map((p) => p.join('\n')).join('\n\n')
            : undefined;
      this.#files.set(f.meta.id, {
        meta: f.meta,
        ...(text !== undefined ? { text } : {}),
        ...(f.hidden ? { hidden: true } : {}),
      });
    }
  }

  #add(
    blob: Blob,
    name: string,
    type: { mime: string; kind: FileKind },
    extra: {
      source: FileSource;
      agent?: string | undefined;
      ts?: number;
      width?: number;
      height?: number;
      text?: string;
    },
  ): FileMeta {
    const ts = extra.ts ?? Date.now();
    const taken = (n: string) =>
      [...this.#files.values()].some((f) => f.meta.name.toLowerCase() === n.toLowerCase());
    let unique = name;
    for (let n = 2; taken(unique); n++) {
      const ext = extOf(name);
      unique = ext ? `${name.slice(0, -(ext.length + 1))} (${n}).${ext}` : `${name} (${n})`;
    }
    const meta: FileMeta = {
      id: ulid(ts),
      name: unique,
      mime: type.mime,
      size: blob.size,
      kind: type.kind,
      source: extra.source,
      ...(extra.agent ? { agent: extra.agent } : {}),
      path: `File/${month(ts)}/${unique}`,
      hasThumb: false,
      hasText: extra.text !== undefined,
      ...(extra.width ? { width: extra.width, height: extra.height } : {}),
      createdAt: ts,
    };
    this.#files.set(meta.id, {
      meta,
      blob,
      ...(extra.text !== undefined ? { text: extra.text } : {}),
    });
    return meta;
  }

  /** The demo photo the user sent to Dione. */
  seedPhoto(ts: number): FileMeta {
    return this.#add(
      photo(),
      'tramonto-alfama.jpg',
      { mime: 'image/jpeg', kind: 'image' },
      { source: 'user', agent: 'dione', ts, width: 640, height: 480 },
    );
  }

  /** The `file` event of a file of `files-data.ts`, made by `agent` in `runId`. */
  #event(
    id: string,
    agent: string,
    runId: string,
    ts: number,
    extra: { tool: string; title?: string },
  ): void {
    const meta = this.#files.get(id)?.meta;
    if (!meta) return;
    this.#log(
      {
        agent,
        runId,
        type: 'file',
        data: {
          action: 'created',
          id: meta.id,
          name: meta.name,
          kind: meta.kind,
          source: meta.source,
          mime: meta.mime,
          size: meta.size,
          ...extra,
        },
      },
      ts,
    );
  }

  /** A screenshot of the browser (the one of `files-data.ts`). */
  seedScreenshot(agent: string, runId: string, ts: number): void {
    this.#event(DEMO_SCREENSHOT, agent, runId, ts, {
      tool: 'mcp__browser__browser_take_screenshot',
    });
  }

  /** A page made with `artifact_create` (the menu of `files-data.ts`). */
  seedPage(agent: string, runId: string, ts: number): void {
    this.#event(DEMO_PAGE, agent, runId, ts, {
      tool: 'artifact_create',
      title: 'Menu della settimana',
    });
  }

  has(id: string): boolean {
    return this.#files.has(id);
  }

  /** `POST /api/files`: the upload, with a progress in a few steps. */
  async upload(
    form: FormData,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<RawResponse> {
    const file = form.get('file');
    if (!(file instanceof Blob)) return fail(400, 'invalid_request', 'Manca il file.');
    const name = file instanceof File && file.name ? file.name : 'file';
    if (file.size > FILE_MAX_BYTES) {
      return fail(413, 'file_too_large', 'Il file è troppo grande: al massimo 25 MB.');
    }
    const type = typeOf(name, file.type);
    if (!type) return fail(415, 'unsupported_type', 'Questo tipo di file non si può allegare.');
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, 90 * this.#speed));
      onProgress?.((file.size * i) / steps, file.size);
    }
    let size: { width: number; height: number } | null = null;
    if (type.kind === 'image' && typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file);
        size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
      } catch {
        size = null;
      }
    }
    const agent = form.get('agent');
    const text =
      type.kind === 'text'
        ? await file.text()
        : type.kind === 'image'
          ? undefined
          : `Testo di ${name}`;
    const meta = this.#add(file, name, type, {
      source: 'user',
      ...(typeof agent === 'string' && agent ? { agent } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(size ?? {}),
    });
    return ok(meta, 201);
  }

  /**
   * Where the browser reads `/api/files/:id/content|thumb`: an object URL for a
   * blob of this page, else the dev server's middleware (`/__mock…`).
   */
  url(path: string): string {
    const m = /^\/api\/files\/([^/?]+)\/(content|thumb)/.exec(path);
    const stored = m ? this.#files.get(decodeURIComponent(m[1]!)) : undefined;
    if (!stored?.blob) return `/__mock${path}${stored?.scripts ? '?scripts=1' : ''}`;
    let url = this.#urls.get(stored.meta.id);
    if (!url) {
      url = URL.createObjectURL(stored.blob);
      this.#urls.set(stored.meta.id, url);
    }
    return url;
  }

  handle(method: string, path: string, query: URLSearchParams): RawResponse | null {
    if (!path.startsWith('/api/files')) return null;
    if (method === 'GET' && path === '/api/files') {
      const kind = query.get('kind');
      const source = query.get('source');
      const agent = query.get('agent');
      const q = query.get('q')?.trim().toLocaleLowerCase('it-IT');
      const before = Number(query.get('before')) || Infinity;
      const limit = Math.min(500, Number(query.get('limit')) || 200);
      // The attachments of a chat by id (D-086): hidden ones too, the deleted ones absent.
      const ids = query.get('ids')?.split(',');
      const files = [...this.#files.values()]
        .filter((f) => (ids ? ids.includes(f.meta.id) : !f.hidden))
        .map((f) => {
          // The name or the text, like the core: a file found by its text carries a snippet.
          if (!q || f.meta.name.toLocaleLowerCase('it-IT').includes(q)) return f.meta;
          const at = f.text?.toLocaleLowerCase('it-IT').indexOf(q) ?? -1;
          if (at < 0) return null;
          const from = Math.max(0, at - 60);
          const piece = f
            .text!.slice(from, from + 200)
            .replace(/\s+/g, ' ')
            .trim();
          const more = from + 200 < f.text!.length;
          return { ...f.meta, snippet: `${from > 0 ? '…' : ''}${piece}${more ? '…' : ''}` };
        })
        .filter((m): m is FileMeta => m !== null)
        .filter((m) =>
          kind === 'documents' ? DOCUMENT_KINDS.includes(m.kind) : !kind || m.kind === kind,
        )
        .filter((m) =>
          source === 'monsters' ? m.source !== 'user' : !source || m.source === source,
        )
        .filter((m) => (!agent || m.agent === agent) && m.createdAt < before)
        .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
        .slice(0, limit);
      return ok({ files });
    }
    const m = /^\/api\/files\/([^/]+)(?:\/(text|scripts))?$/.exec(path);
    if (!m) return null;
    const id = decodeURIComponent(m[1]!);
    const stored = this.#files.get(id);
    if (!stored) return fail(404, 'unknown_file', 'File non trovato.');
    if (method === 'POST' && m[2] === 'scripts') {
      // "Attiva gli script" (D-085): the dev server serves it with scripts from now on (`url`).
      const { inert: _off, ...meta } = stored.meta;
      stored.meta = meta;
      stored.scripts = true;
      return ok(meta);
    }
    if (method === 'GET' && m[2] === 'text') {
      return ok({ text: stored.text ?? '', truncated: false });
    }
    if (method === 'GET') return ok(stored.meta);
    if (method === 'DELETE') {
      this.#files.delete(id);
      const url = this.#urls.get(id);
      if (url) URL.revokeObjectURL(url);
      this.#urls.delete(id);
      this.#log({
        agent: 'user',
        type: 'file',
        data: {
          action: 'deleted',
          id,
          name: stored.meta.name,
          kind: stored.meta.kind,
          source: stored.meta.source,
        },
      });
      return ok({ ok: true });
    }
    return fail(405, 'method_not_allowed');
  }
}
