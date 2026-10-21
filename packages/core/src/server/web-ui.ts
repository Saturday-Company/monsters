import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context, Hono } from 'hono';
import type { AppEnv } from './app.ts';
import { serverStrings } from './server.strings.ts';
import { appLang } from '@monsters/shared';

/*
 * The web UI (apps/web) served by the core on its own origin: the API, the
 * WebSocket and the pages share host and port, so the session cookie, the Origin
 * checks and the CSP all stay strict. Hashed assets are cached forever, the pages
 * are revalidated every time; any path without an extension is a route of the
 * single-page app and gets `index.html`.
 */

/** `true` in the bundled core (defined by scripts/build-core.ts); not defined in the sources. */
declare const MONSTERS_BUNDLED: boolean | undefined;

/**
 * Default location of the build: `apps/web/dist` next to this package in the repo; in the
 * bundle, `web/` next to the entry (this module is part of it).
 */
export const DEFAULT_WEB_DIST = fileURLToPath(
  typeof MONSTERS_BUNDLED !== 'undefined' && MONSTERS_BUNDLED
    ? new URL('./web', import.meta.url)
    : new URL('../../../../apps/web/dist', import.meta.url),
);

/**
 * Content Security Policy of the pages. Scripts only from the core (no inline,
 * no eval). Styles allow `unsafe-inline` because the monsters' SVG and Motion set
 * `style` attributes; images allow `data:` for the displacement map of the glass
 * (an SVG filter fed by a canvas PNG) and `https:` for the remote images of a
 * chat message, which the UI loads only after the user clicks "Mostra immagine"
 * (with `referrerpolicy="no-referrer"`), never by itself. `connect-src 'self'`
 * covers the WebSocket on the same host and port. Frames only from the core
 * (the preview pane's sandboxed iframe of `/api/files/:id/content`), workers only
 * from the core (the pdf.js worker, a file of the build).
 */
export const WEB_UI_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

export interface WebUiOptions {
  /** Folder with the built UI (`index.html` + `assets/`). */
  dir: string;
}

/** True when the folder holds a build of the UI. */
export function webUiAvailable(dir: string): boolean {
  return existsSync(join(dir, 'index.html'));
}

function missingBuildPage(dir: string): string {
  const escaped = dir.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const s = serverStrings();
  return `<!doctype html>
<html lang="${appLang()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${s.noUiTitle}</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem}
code{font-family:ui-monospace,monospace;background:rgba(127,127,127,.15);padding:.1em .35em;border-radius:.3em}
</style>
</head>
<body>
<h1>${s.noUiHeading}</h1>
<p>${s.noUiBody(escaped)}</p>
<p>${s.noUiHow}</p>
<p><code>pnpm --filter @monsters/web build</code></p>
</body>
</html>
`;
}

/** Resolves a request path inside `root`; null when it would leave it. */
function safeJoin(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const full = resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  return full === root || full.startsWith(root + sep) ? full : null;
}

function fileStat(path: string) {
  try {
    const st = statSync(path);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

/** Registers the UI routes: call after every `/api` route, before `notFound`. */
export function registerWebUi(app: Hono<AppEnv>, options: WebUiOptions): void {
  const root = resolve(options.dir);

  const send = (c: Context, path: string, cache: string, status: 200 | 404 = 200) => {
    const st = fileStat(path);
    if (!st) return null;
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
    c.header('Content-Type', type);
    c.header('Cache-Control', cache);
    c.header('ETag', etag);
    if (type.startsWith('text/html')) c.header('Content-Security-Policy', WEB_UI_CSP);
    if (status === 200 && c.req.header('if-none-match') === etag) return c.body(null, 304);
    if (c.req.method === 'HEAD') {
      c.header('Content-Length', String(st.size));
      return c.body(null, status);
    }
    return c.body(readFileSync(path), status);
  };

  app.on(['GET', 'HEAD'], '*', (c) => {
    const urlPath = c.req.path;
    if (urlPath === '/api' || urlPath.startsWith('/api/')) {
      return c.json({ error: 'not_found' }, 404);
    }
    const index = join(root, 'index.html');
    if (!fileStat(index)) {
      c.header('Content-Security-Policy', WEB_UI_CSP);
      return c.html(missingBuildPage(root), 503);
    }
    const file = safeJoin(root, urlPath);
    if (file === null) return c.json({ error: 'not_found' }, 404);
    if (file !== root) {
      // Files under assets/ carry a content hash in their name: cache them forever.
      const hashed = file.startsWith(join(root, 'assets') + sep);
      const served = send(c, file, hashed ? IMMUTABLE : REVALIDATE);
      if (served) return served;
      // A missing file (has an extension) is a 404, not the app.
      if (extname(urlPath) !== '') return c.json({ error: 'not_found' }, 404);
    }
    // Routes of the single-page app (`/`, `/impostazioni`, …) all get the shell.
    return send(c, index, REVALIDATE) ?? c.json({ error: 'not_found' }, 404);
  });
}
