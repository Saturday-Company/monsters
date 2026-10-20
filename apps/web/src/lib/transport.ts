import { SESSION_SECRET_HEADER } from '@monsters/shared';
import { sessionSecret } from './session-secret.ts';

/*
 * Transport between the UI and the core. The real one uses fetch and WebSocket on
 * the same origin; the mock one (lib/mock) answers from an in-memory core. Both
 * expose the same tiny surface so the API client and the stream are shared.
 */

export interface RawResponse {
  status: number;
  body: unknown;
}

/** The subset of WebSocket used by the stream client. */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
  close(code?: number, reason?: string): void;
}

export interface Transport {
  readonly kind: 'http' | 'mock';
  request(method: string, path: string, body?: unknown): Promise<RawResponse>;
  /** Opens a socket on a path of the core (e.g. `/api/stream?after=…`). */
  connect(path: string): SocketLike;
  /**
   * Sends a multipart form (the upload of a file, `POST /api/files`) and says
   * how much of it went (`loaded` of `total` bytes) while it goes.
   */
  upload?(
    path: string,
    form: FormData,
    onProgress?: (loaded: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<RawResponse>;
  /** A URL the browser can load in an `<img>` or an `<iframe>` (the bytes of a file). */
  fileUrl?(path: string): string;
}

export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('network_error', { cause });
    this.name = 'NetworkError';
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Fetch + WebSocket against the core that served the page (or the Vite proxy). */
export function httpTransport(origin: string = window.location.origin): Transport {
  return {
    kind: 'http',
    async request(method, path, body) {
      const headers: Record<string, string> = { Accept: 'application/json' };
      // The secret of a browser's session (S-B13): the cookie alone is not enough.
      const secret = sessionSecret();
      if (secret) headers[SESSION_SECRET_HEADER] = secret;
      const init: RequestInit = { method, headers, credentials: 'same-origin', cache: 'no-store' };
      if (MUTATING.has(method)) {
        // Required by the core for cookie-authenticated state changes (anti-CSRF).
        headers['Content-Type'] = 'application/json';
        headers['X-Monsters-Request'] = '1';
        init.body = JSON.stringify(body ?? {});
      }
      let res: Response;
      try {
        res = await fetch(new URL(path, origin), init);
      } catch (err) {
        throw new NetworkError(err);
      }
      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { error: 'invalid_json' };
        }
      }
      return { status: res.status, body: parsed };
    },
    connect(path) {
      const url = new URL(path, origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(url);
      const socket: SocketLike = {
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        close: (code, reason) => ws.close(code, reason),
      };
      ws.onopen = () => {
        // A browser's session sends its secret first, never in the URL (S-B13).
        const secret = sessionSecret();
        if (secret) ws.send(JSON.stringify({ kind: 'auth', secret }));
        socket.onopen?.();
      };
      ws.onmessage = (ev: MessageEvent) => socket.onmessage?.({ data: ev.data });
      ws.onclose = (ev: CloseEvent) => socket.onclose?.({ code: ev.code, reason: ev.reason });
      ws.onerror = () => socket.onerror?.();
      return socket;
    },
    upload(path, form, onProgress, signal) {
      // XMLHttpRequest: fetch says nothing about the progress of a request body.
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', new URL(path, origin).href);
        xhr.withCredentials = true;
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.setRequestHeader('X-Monsters-Request', '1');
        const secret = sessionSecret();
        if (secret) xhr.setRequestHeader(SESSION_SECRET_HEADER, secret);
        xhr.responseType = 'text';
        xhr.upload.onprogress = (e) => onProgress?.(e.loaded, e.total);
        xhr.onerror = () => reject(new NetworkError(new Error('upload failed')));
        xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
        xhr.onload = () => {
          let parsed: unknown;
          try {
            parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
          } catch {
            parsed = { error: 'invalid_json' };
          }
          resolve({ status: xhr.status, body: parsed });
        };
        signal?.addEventListener('abort', () => xhr.abort(), { once: true });
        xhr.send(form);
      });
    },
    fileUrl: (path) => (origin === window.location.origin ? path : new URL(path, origin).href),
  };
}
