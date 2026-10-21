import {
  appLang,
  McpAcceptRequestSchema,
  McpOAuthFinishRequestSchema,
  McpServerRequestSchema,
} from '@monsters/shared';
import type { Context, Hono } from 'hono';
import { HaltedError } from '../../kill/run-controller.ts';
import { McpError, type McpManager } from '../../mcp/manager.ts';
import { OAUTH_CALLBACK_PATH, oauthCallbackOrigin } from '../../mcp/oauth.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';
import { serverStrings } from '../server.strings.ts';

/*
 * External MCP servers (contract in shared/src/mcp.ts). Values of variables
 * and headers go in and never come back. Changing the list is allowed while
 * halted (it starts nothing); the test starts the server, so it is not.
 */

const STATUS: Record<McpError['code'], 400 | 404 | 502> = {
  unknown_server: 404,
  invalid_server: 400,
  unknown_agent: 404,
  oauth_failed: 502,
};

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

/** The page the browser shows after a sign-in: static, no script, nothing from the service. */
export function oauthResultPage(ok: boolean, message: string): string {
  const s = serverStrings();
  const title = ok ? s.oauthTitleOk : s.oauthTitleFailed;
  const led = ok ? ['#1f8f4e', '#4fd98a'] : ['#d8231a', '#ff3b2f'];
  return `<!doctype html>
<html lang="${appLang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Monsters</title>
<style>
:root{color-scheme:light dark;--chassis:#e3e1db;--raised:#fbfaf7;--ink:#1a1a18;--muted:#5c5a54;--led:${led[0]}}
@media (prefers-color-scheme:dark){:root{--chassis:#151514;--raised:#252523;--ink:#ecebe5;--muted:#a3a19a;--led:${led[1]}}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--chassis);color:var(--ink);font:15px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}
main{background:var(--raised);border-radius:14px;padding:28px;max-width:420px;box-shadow:0 1px 0 rgba(0,0,0,.13)}
p.k{font:600 11px/1 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);display:flex;gap:8px;align-items:center;margin:0 0 14px}
p.k::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--led)}
h1{font-size:22px;margin:0 0 8px}p{margin:0;color:var(--muted)}
</style></head>
<body><main><p class="k">Monsters</p><h1>${title}</h1><p>${escapeHtml(message)}</p>
<p style="margin-top:12px">${ok ? s.oauthCloseOk : s.oauthCloseFailed}</p></main></body></html>`;
}

export function registerMcpRoutes(app: Hono<AppEnv>, h: RouteHelpers, mcp: McpManager): void {
  const { requireAuth, parseBody, channelOf } = h;

  const guard = async (c: Context<AppEnv>, work: () => unknown) => {
    try {
      return c.json(await work());
    } catch (err) {
      if (err instanceof McpError) {
        return c.json({ error: err.code, message: err.message }, STATUS[err.code]);
      }
      if (err instanceof HaltedError) {
        return c.json({ error: 'halted', message: err.message }, 409);
      }
      throw err;
    }
  };

  app.get('/api/mcp-servers', requireAuth, (c) => c.json(mcp.view()));

  app.put('/api/mcp-servers/:name', requireAuth, async (c) => {
    const body = await parseBody(c, McpServerRequestSchema);
    if (!body.ok) return body.res;
    return guard(c, () => mcp.upsert(c.req.param('name'), body.data, channelOf(c.get('auth'))));
  });

  app.delete('/api/mcp-servers/:name', requireAuth, (c) =>
    guard(c, () => mcp.remove(c.req.param('name'), channelOf(c.get('auth')))),
  );

  app.post('/api/mcp-servers/:name/test', requireAuth, (c) =>
    guard(c, () => mcp.test(c.req.param('name'))),
  );

  // Tools new or changed since accepted (D-070): back to the agents.
  app.post('/api/mcp-servers/:name/accept', requireAuth, async (c) => {
    const body = await parseBody(c, McpAcceptRequestSchema);
    if (!body.ok) return body.res;
    return guard(c, () =>
      mcp.acceptTools(
        c.req.param('name'),
        body.data.tools,
        channelOf(c.get('auth')),
        body.data.seen,
      ),
    );
  });

  // OAuth (D-063): start and sign-out are API calls of the signed-in user...
  // The browser comes back where it reached the core: its Host (D-072).
  app.post('/api/mcp-servers/:name/oauth', requireAuth, (c) => {
    const core = mcp.oauthRedirect().slice(0, -OAUTH_CALLBACK_PATH.length);
    const back = oauthCallbackOrigin(c.req.header('host'), core);
    return guard(c, async () => ({
      ...(await mcp.oauthStart(c.req.param('name'), back.origin)),
      ...(back.paste ? { paste: true } : {}),
    }));
  });

  // The callback page did not open (core reached on the network, tunnel down):
  // the user pastes its address. Same one-use `state` check as the callback.
  app.post('/api/mcp-oauth/finish', requireAuth, async (c) => {
    const body = await parseBody(c, McpOAuthFinishRequestSchema);
    if (!body.ok) return body.res;
    let url: URL;
    try {
      url = new URL(body.data.url);
    } catch {
      return c.json({
        ok: false,
        message: serverStrings().oauthPasteFull,
      });
    }
    if (url.pathname !== OAUTH_CALLBACK_PATH || !url.searchParams.has('state')) {
      return c.json({
        ok: false,
        message: serverStrings().oauthNotReturnPage,
      });
    }
    return c.json(await mcp.oauthCallback(url.searchParams));
  });

  app.delete('/api/mcp-servers/:name/oauth', requireAuth, (c) =>
    guard(c, () => mcp.oauthSignOut(c.req.param('name'), channelOf(c.get('auth')))),
  );

  // ...the callback is a plain navigation of the browser coming back from the
  // service (no cookie, no header): one-use `state` of a sign-in started above.
  app.get(OAUTH_CALLBACK_PATH, async (c) => {
    const result = await mcp.oauthCallback(new URL(c.req.url).searchParams);
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    return c.html(oauthResultPage(result.ok, result.message), result.ok ? 200 : 400);
  });
}
