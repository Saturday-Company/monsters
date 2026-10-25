import {
  ApiErrorSchema,
  FileListSchema,
  formatNumber,
  type FileKind,
  type FileMeta,
  type PreviewItem,
} from '@monsters/shared';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { ApiError, describeError } from '../../lib/api.ts';
import { kindLabel } from '../../lib/files.ts';
import { filesLibStrings } from '../../lib/files.strings.ts';
import { sessionSecret } from '../../lib/session-secret.ts';
import { getApi } from '../../store/app.ts';
import { previewStrings } from './preview.strings.ts';

/*
 * The files of the preview pane (contract: packages/shared/src/files.ts): their
 * metadata, read once and kept for the session, and the addresses of their
 * bytes. With the real core the bytes come from `/api/files/:id/content` on the
 * same origin (the session cookie goes with it, and in a browser a short ticket
 * of the session in the URL, S-B13); with the mock of the dev server they come
 * from its middleware under `/__mock` (vite.config.ts), with the same headers
 * the core sends.
 */

const ID = /^[A-Za-z0-9_-]{1,100}$/;

/** True for a file id the core could have made (no slashes, no dots). */
export const isFileId = (id: string): boolean => ID.test(id);

/** What of a file an address loads: its bytes, its thumbnail, its bytes as a download. */
export type FilePartUrl = 'content' | 'thumb' | 'download';

/** The address of a part of a file, from the transport (the mock serves blobs and `/__mock`). */
function partUrl(id: string, part: FilePartUrl): string {
  try {
    return getApi().fileUrl(id, part);
  } catch {
    const base = `/api/files/${encodeURIComponent(id)}`;
    return part === 'download' ? `${base}/content?download=1` : `${base}/${part}`;
  }
}

/**
 * True when the bytes of a file need a ticket (S-B13): the real core in a browser, whose
 * session is bound to a secret the `<img>` and the `<iframe>` cannot send. Not in the desktop
 * app (its cookie lives in a session of its own) nor with the mock.
 */
export function ticketsNeeded(): boolean {
  try {
    return getApi().transport.kind === 'http' && sessionSecret() !== null;
  } catch {
    return false;
  }
}

/** A ticket is shared by the views mounted within a minute (the core keeps it for two). */
const TICKET_REUSE_MS = 60_000;
const tickets = new Map<string, { at: number; ticket: Promise<string> }>();

/** The address of a part of a file, with a ticket of this session when it needs one. */
export async function fileUrlFor(id: string, part: FilePartUrl, fresh = false): Promise<string> {
  if (!ticketsNeeded()) return partUrl(id, part);
  const api = getApi();
  const of = part === 'thumb' ? 'thumb' : 'content';
  // The core's ticket of a thumbnail is good for every thumbnail of the session: one for a list.
  const key = of === 'thumb' ? '*:thumb' : `${id}:${of}`;
  const now = Date.now();
  let entry = tickets.get(key);
  if (fresh || !entry || now - entry.at > TICKET_REUSE_MS) {
    const made = { at: now, ticket: api.fileTicket(id, of).then((r) => r.ticket) };
    made.ticket.catch(() => {
      if (tickets.get(key) === made) tickets.delete(key);
    });
    tickets.set(key, made);
    entry = made;
  }
  return api.fileUrl(id, part, await entry.ticket);
}

export interface FileUrl {
  /** The address for `src`; undefined while its ticket is on the way. */
  src: string | undefined;
  /**
   * For `onError`: once, a new ticket (an image loaded lazily after its ticket expired);
   * otherwise, or if that fails too, `giveUp`.
   */
  retry(giveUp: () => void): void;
}

/** The address of a part of a file for an `<img>` or an `<iframe>` (see `fileUrlFor`). */
export function useFileUrl(id: string | null, part: FilePartUrl = 'content'): FileUrl {
  const needs = ticketsNeeded();
  const key = id ? `${id}:${part}` : '';
  const [got, setGot] = useState<{ key: string; url: string; retried: boolean } | null>(null);
  useEffect(() => {
    if (!id || !needs) return;
    let alive = true;
    fileUrlFor(id, part).then(
      (url) => alive && setGot({ key, url, retried: false }),
      // No ticket (core unreachable, session over): the plain address fails and says so.
      () => alive && setGot({ key, url: partUrl(id, part), retried: true }),
    );
    return () => {
      alive = false;
    };
  }, [id, part, key, needs]);
  const mine = got?.key === key ? got : null;
  const src = !id ? undefined : !needs ? partUrl(id, part) : mine?.url;
  const retry = useCallback(
    (giveUp: () => void) => {
      if (!id || !needs || !mine || mine.retried) return giveUp();
      setGot({ ...mine, retried: true });
      fileUrlFor(id, part, true).then((url) => setGot({ key, url, retried: true }), giveUp);
    },
    [id, part, key, needs, mine],
  );
  return { src, retry };
}

/**
 * The `href` of a "Scarica" key: the plain address where it works as it is (the desktop app,
 * the mock), none in a browser's session, whose address needs a ticket of two minutes. There
 * the key is a button (`downloadOnClick`): a link would open with the middle button, "Apri in
 * una nuova scheda" or a copied address without its ticket, and answer 401 (review of 19/10,
 * n. 13).
 */
export function downloadHref(
  id: string,
  part: 'content' | 'download' = 'download',
  needs: boolean = ticketsNeeded(),
): string | undefined {
  return needs ? undefined : getApi().fileUrl(id, part);
}

/**
 * "Scarica": in a browser's session the press asks a fresh ticket first (the one of the page
 * may have expired), then downloads. Elsewhere the link goes as it is.
 */
export function downloadOnClick(id: string, name: string) {
  return (e: MouseEvent<HTMLElement>) => {
    if (!ticketsNeeded()) return;
    e.preventDefault();
    void fileUrlFor(id, 'download', true).then(
      (url) => {
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.rel = 'noopener';
        document.body.append(a);
        a.click();
        a.remove();
      },
      () => {},
    );
  };
}

/**
 * The file a link or an image of a message points to: `/api/files/<id>` or
 * `/api/files/<id>/content` (relative or on this origin), or null.
 */
export function fileIdOf(href: string): string | null {
  let path = href.trim();
  try {
    if (/^https?:\/\//i.test(path)) {
      const url = new URL(path);
      const here = typeof window === 'undefined' ? null : window.location.origin;
      if (url.origin !== here) return null;
      path = url.pathname;
    }
  } catch {
    return null;
  }
  const m = /^\/?api\/files\/([^/?#]+)(?:\/content)?\/?(?:[?#].*)?$/.exec(path);
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
  return isFileId(id) ? id : null;
}

/**
 * Files named in a tool's result (a browser screenshot saved as a file): a
 * `fileId` / `file_id` field, a `file: { id }`, or an `/api/files/<id>` address.
 * Oldest mention first, no duplicates, at most `max`.
 */
export function filesIn(value: unknown, max = 4): string[] {
  const out: string[] = [];
  const add = (id: unknown) => {
    if (typeof id === 'string' && isFileId(id) && !out.includes(id) && out.length < max)
      out.push(id);
  };
  const walk = (v: unknown, depth: number) => {
    if (out.length >= max || depth > 5) return;
    if (typeof v === 'string') {
      for (const m of v.matchAll(/\/api\/files\/([A-Za-z0-9_-]{1,100})/g)) add(m[1]);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if ((k === 'fileId' || k === 'file_id') && typeof x === 'string') add(x);
        else if (k === 'file' && x && typeof x === 'object' && 'id' in x)
          add((x as { id: unknown }).id);
        else walk(x, depth + 1);
      }
    }
  };
  walk(value, 0);
  return out;
}

/* ------------------------------------------------------------ metadata */

const metas = new Map<string, FileMeta>();
const pending = new Map<string, Promise<FileMeta>>();
const listeners = new Set<() => void>();

/** Ids asked in this task, fetched together at its end. */
let queued = new Map<string, { resolve: (m: FileMeta) => void; reject: (e: unknown) => void }>();
/** Ids per request (the core takes at most 100). */
const IDS_PER_REQUEST = 100;

/**
 * The metadata of the ids queued: `GET /api/files?ids=…`, a hundred at a time
 * (D-086). A deleted file is simply absent from the answer: a chat full of
 * old attachments makes one request, not one 404 each in the console.
 */
async function fetchQueued(batch: typeof queued): Promise<void> {
  const ids = [...batch.keys()];
  for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
    const chunk = ids.slice(i, i + IDS_PER_REQUEST);
    try {
      const res = await getApi().transport.request(
        'GET',
        `/api/files?ids=${chunk.map(encodeURIComponent).join(',')}`,
      );
      if (res.status < 200 || res.status >= 300) {
        const err = ApiErrorSchema.safeParse(res.body);
        throw new ApiError(res.status, err.success ? err.data.error : `http_${res.status}`);
      }
      const parsed = FileListSchema.safeParse(res.body);
      if (!parsed.success) throw new ApiError(res.status, 'invalid_response');
      const found = new Map(parsed.data.files.map((f) => [f.id, f]));
      for (const id of chunk) {
        const meta = found.get(id);
        if (meta) {
          metas.set(id, meta);
          batch.get(id)!.resolve(meta);
        } else batch.get(id)!.reject(new ApiError(404, 'unknown_file'));
      }
      if (found.size > 0) for (const l of listeners) l();
    } catch (err) {
      for (const id of chunk) batch.get(id)!.reject(err);
    }
  }
}

/** The metadata of a file, once per session (a file never changes; a deleted one is `unknown_file`). */
export function loadFileMeta(id: string): Promise<FileMeta> {
  const known = metas.get(id);
  if (known) return Promise.resolve(known);
  let p = pending.get(id);
  if (!p) {
    p = new Promise<FileMeta>((resolve, reject) => {
      if (queued.size === 0) {
        queueMicrotask(() => {
          const batch = queued;
          queued = new Map();
          void fetchQueued(batch);
        });
      }
      queued.set(id, { resolve, reject });
    }).finally(() => pending.delete(id));
    pending.set(id, p);
  }
  return p;
}

/** Metadata already known (another view of the files may have it). */
export function rememberFileMeta(meta: FileMeta): void {
  metas.set(meta.id, meta);
}

/** Metadata that changed (scripts turned on, D-085): the views show the new one. */
export function replaceFileMeta(meta: FileMeta): void {
  metas.set(meta.id, meta);
  for (const l of listeners) l();
}

/** A file deleted (the File view): its views ask again and find it missing. */
export function forgetFileMeta(id: string): void {
  if (!metas.delete(id)) return;
  for (const l of listeners) l();
}

export type MetaState =
  | { state: 'loading' }
  | { state: 'ready'; meta: FileMeta }
  | { state: 'missing' }
  /** The read failed (not a 404): `retry` asks again (W-36). */
  | { state: 'error'; text: string; retry: () => void };

/**
 * A read that failed is tried again on its own a few times, with growing pauses (W-36): a
 * connection that comes back fixes the chips of a chat without anyone pressing anything. Only
 * when these are over does the chip say "couldn't read", with the key to ask by hand.
 */
export const META_RETRY_MS = [1500, 4000, 10_000] as const;

export function useFileMeta(id: string | null): MetaState {
  const [, bump] = useState(0);
  const [failure, setFailure] = useState<{ id: string; state: MetaState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // How many of the automatic tries were used for this id; a press of the key starts a plain read.
  const auto = useRef<{ id: string | null; used: number }>({ id: null, used: 0 });
  const retry = useCallback(() => {
    setFailure(null);
    auto.current.used = META_RETRY_MS.length;
    setAttempt((n) => n + 1);
  }, []);
  const known = id ? metas.get(id) : undefined;
  useEffect(() => {
    if (!id || metas.has(id)) return;
    if (auto.current.id !== id) auto.current = { id, used: 0 };
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const l = () => alive && bump((n) => n + 1);
    listeners.add(l);
    loadFileMeta(id).catch((err: unknown) => {
      if (!alive) return;
      const missing =
        err instanceof ApiError && (err.status === 404 || err.code === 'unknown_file');
      const wait = META_RETRY_MS[auto.current.used];
      if (!missing && wait !== undefined) {
        auto.current.used += 1;
        timer = setTimeout(() => setAttempt((n) => n + 1), wait);
        return;
      }
      setFailure({
        id,
        state: missing ? { state: 'missing' } : { state: 'error', text: describeError(err), retry },
      });
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      listeners.delete(l);
    };
  }, [id, attempt, retry]);
  if (!id) return { state: 'missing' };
  if (known) return { state: 'ready', meta: known };
  if (failure?.id === id) return failure.state;
  return { state: 'loading' };
}

/* --------------------------------------------------------------- words */

export const kindWord = (kind: FileKind): string => kindLabel(kind);

/** "1.2 MB", "820 KB", "512 bytes" ("1,2 MB" and "512 byte" in Italian). */
export function formatBytes(n: number): string {
  if (n < 1024) return previewStrings().bytes(n);
  const one = (v: number) =>
    formatNumber(
      v,
      v < 10
        ? { minimumFractionDigits: 1, maximumFractionDigits: 1 }
        : {
            maximumFractionDigits: 0,
          },
    );
  const kb = n / 1024;
  if (kb < 1024) return `${one(kb)} KB`;
  return `${one(kb / 1024)} MB`;
}

/** The name of a note from its path: the last part, without `.md`. */
export function noteTitle(path: string): string {
  const last = path.split('/').pop() ?? path;
  return last.replace(/\.md$/i, '') || path;
}

/** What the strip says for an item, as far as it is known. */
export function itemName(item: PreviewItem): string {
  if (item.kind === 'note') return noteTitle(item.path);
  return metas.get(item.fileId)?.name ?? filesLibStrings().kinds.other;
}

/** How a text file is shown: as code (with light colours), a table, JSON or plain text. */
export type TextFlavor = 'code' | 'csv' | 'json' | 'markdown' | 'plain';

const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|sql|css|scss|html?|xml|ya?ml|toml|ini|lua|r|dart|vue|svelte)$/i;

export function textFlavor(meta: Pick<FileMeta, 'name' | 'mime'>): TextFlavor {
  const name = meta.name.toLowerCase();
  const mime = meta.mime.toLowerCase();
  if (mime.includes('json') || name.endsWith('.json')) return 'json';
  if (mime.includes('csv') || name.endsWith('.csv') || name.endsWith('.tsv')) return 'csv';
  if (name.endsWith('.md') || mime.includes('markdown')) return 'markdown';
  if (CODE_EXT.test(name) || /javascript|typescript|x-python|x-sh|xml|yaml/.test(mime))
    return 'code';
  return 'plain';
}

/** How the pane shows a file. */
export type Renderer = 'image' | 'pdf' | 'text' | 'html' | 'other';

export function rendererOf(meta: Pick<FileMeta, 'kind' | 'mime' | 'name'>): Renderer {
  const mime = meta.mime.toLowerCase();
  if (meta.kind === 'image' && mime.startsWith('image/')) return 'image';
  if (meta.kind === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (meta.kind === 'html' || mime === 'text/html') return 'html';
  // Office formats are zip files whose type names "xml": they are not text.
  if (
    meta.kind === 'text' ||
    mime.startsWith('text/') ||
    /^application\/([\w.-]+\+)?(json|xml|x-yaml|yaml|csv)$/.test(mime)
  )
    return 'text';
  return 'other';
}
