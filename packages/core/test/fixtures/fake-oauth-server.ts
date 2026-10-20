/*
 * A remote MCP server protected by OAuth 2.1, like Notion's or Linear's, in
 * one process: protected resource metadata (RFC 9728), authorization server
 * metadata (RFC 8414), dynamic client registration (RFC 7591), an
 * authorization endpoint that "signs the user in" at once and redirects with
 * the code, a token endpoint that checks PKCE (S256) and rotates refresh
 * tokens, a revocation endpoint (RFC 7009), and `/mcp` (the SDK server) behind
 * the bearer check.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { sdkHttpHandler } from './sdk-mcp-server.ts';

export interface FakeOAuthServer {
  base: string;
  mcpUrl: string;
  /** Every access and refresh token issued so far. */
  issued: { access: string[]; refresh: string[] };
  registrations: { client_id: string; redirect_uris: string[] }[];
  grants: string[];
  revoked: string[];
  /** Makes every access token invalid (as if expired): the next call must refresh. */
  expireAccessTokens(): void;
  /** Revokes the whole grant (password changed, app removed): only a new sign-in helps. */
  revokeAll(): void;
  /** Forgets every registered client: the token endpoint answers `invalid_client`. */
  forgetClients(): void;
  /** Status the token endpoint answers a refresh with (a 503: the service is down), or 0. */
  refreshStatus: number;
  /** Milliseconds the token endpoint waits before answering a refresh. */
  refreshDelayMs: number;
  /** Answer of the authorization endpoint: the user approves, or denies. */
  deny: boolean;
  /**
   * Scopes a tool call needs (space separated), or null: a token without all of them gets
   * `403 insufficient_scope` with this scope in the challenge (step-up, RFC 6750 §3.1).
   */
  requiredScope: string | null;
  /** The `scope` of every authorization request, in order. */
  scopesAsked: (string | null)[];
  close(): Promise<void>;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

export async function startFakeOAuthServer(): Promise<FakeOAuthServer> {
  const handler = sdkHttpHandler();
  const codes = new Map<
    string,
    {
      clientId: string;
      challenge: string;
      redirectUri: string;
      resource: string | null;
      scope: string | null;
    }
  >();
  const clients = new Map<string, string[]>();
  const valid = new Set<string>();
  const refreshValid = new Map<string, string>();
  /** The scope granted to each access and refresh token. */
  const scopeOf = new Map<string, string>();
  let base = '';
  const state: Omit<
    FakeOAuthServer,
    'base' | 'mcpUrl' | 'close' | 'expireAccessTokens' | 'revokeAll' | 'forgetClients'
  > = {
    issued: { access: [], refresh: [] },
    registrations: [],
    grants: [],
    revoked: [],
    deny: false,
    refreshStatus: 0,
    refreshDelayMs: 0,
    requiredScope: null,
    scopesAsked: [],
  };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const issue = (clientId: string, scope = 'read write') => {
    const access = `at-${b64url(randomBytes(18))}`;
    const refresh = `rt-${b64url(randomBytes(18))}`;
    valid.add(access);
    refreshValid.set(refresh, clientId);
    scopeOf.set(access, scope);
    scopeOf.set(refresh, scope);
    state.issued.access.push(access);
    state.issued.refresh.push(refresh);
    return json({
      access_token: access,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refresh,
      scope,
    });
  };

  const fetchHandler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    if (
      path === '/.well-known/oauth-protected-resource/mcp' ||
      path === '/.well-known/oauth-protected-resource'
    ) {
      return json({ resource: `${base}/mcp`, authorization_servers: [base] });
    }
    if (path === '/.well-known/oauth-authorization-server') {
      return json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        revocation_endpoint: `${base}/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (path === '/register' && req.method === 'POST') {
      const meta = (await req.json()) as { redirect_uris: string[] };
      const clientId = `client-${b64url(randomBytes(6))}`;
      clients.set(clientId, meta.redirect_uris);
      state.registrations.push({ client_id: clientId, redirect_uris: meta.redirect_uris });
      return json({ ...meta, client_id: clientId, client_id_issued_at: 1 }, 201);
    }
    if (path === '/authorize') {
      const p = url.searchParams;
      const clientId = p.get('client_id') ?? '';
      const redirectUri = p.get('redirect_uri') ?? '';
      if (!clients.get(clientId)?.includes(redirectUri))
        return json({ error: 'bad redirect' }, 400);
      if (p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge')) {
        return json({ error: 'pkce required' }, 400);
      }
      state.scopesAsked.push(p.get('scope'));
      const back = new URL(redirectUri);
      back.searchParams.set('state', p.get('state') ?? '');
      back.searchParams.set('iss', base);
      if (state.deny) {
        back.searchParams.set('error', 'access_denied');
      } else {
        const code = `code-${b64url(randomBytes(12))}`;
        codes.set(code, {
          clientId,
          challenge: p.get('code_challenge') ?? '',
          redirectUri,
          resource: p.get('resource'),
          scope: p.get('scope'),
        });
        back.searchParams.set('code', code);
      }
      return new Response(null, { status: 302, headers: { location: back.href } });
    }
    if (path === '/token' && req.method === 'POST') {
      const p = new URLSearchParams(await req.text());
      const grant = p.get('grant_type') ?? '';
      state.grants.push(grant);
      if (grant === 'authorization_code') {
        const entry = codes.get(p.get('code') ?? '');
        codes.delete(p.get('code') ?? '');
        const verifier = p.get('code_verifier') ?? '';
        const challenge = b64url(createHash('sha256').update(verifier).digest());
        if (
          !entry ||
          entry.clientId !== p.get('client_id') ||
          entry.redirectUri !== p.get('redirect_uri') ||
          entry.challenge !== challenge
        ) {
          return json({ error: 'invalid_grant' }, 400);
        }
        return issue(entry.clientId, entry.scope ?? undefined);
      }
      if (grant === 'refresh_token') {
        if (state.refreshDelayMs > 0) {
          await new Promise((r) => setTimeout(r, state.refreshDelayMs));
        }
        if (state.refreshStatus) {
          return new Response('service unavailable', { status: state.refreshStatus });
        }
        if (!clients.has(p.get('client_id') ?? '')) {
          return json({ error: 'invalid_client', error_description: 'unknown client' }, 401);
        }
        const rt = p.get('refresh_token') ?? '';
        const clientId = refreshValid.get(rt);
        // A refresh token is good only for the client it was issued to.
        if (!clientId || clientId !== p.get('client_id')) {
          return json({ error: 'invalid_grant' }, 400);
        }
        // Rotation: the old refresh token is spent.
        refreshValid.delete(rt);
        // A refresh never widens the grant (RFC 6749 §6).
        return issue(clientId, scopeOf.get(rt));
      }
      return json({ error: 'unsupported_grant_type' }, 400);
    }
    if (path === '/revoke' && req.method === 'POST') {
      const p = new URLSearchParams(await req.text());
      const token = p.get('token') ?? '';
      state.revoked.push(token);
      valid.delete(token);
      refreshValid.delete(token);
      return new Response(null, { status: 200 });
    }
    if (path === '/mcp') {
      const auth = req.headers.get('authorization') ?? '';
      const token = /^Bearer (.+)$/.exec(auth)?.[1];
      if (!token || !valid.has(token)) {
        return new Response(JSON.stringify({ error: 'invalid_token' }), {
          status: 401,
          headers: {
            'content-type': 'application/json',
            'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
          },
        });
      }
      if (state.requiredScope && req.method === 'POST') {
        const has = new Set((scopeOf.get(token) ?? '').split(' '));
        const lacks = state.requiredScope.split(' ').some((s) => !has.has(s));
        const body = (await req
          .clone()
          .json()
          .catch(() => null)) as { method?: string } | null;
        if (lacks && body?.method === 'tools/call') {
          return new Response(JSON.stringify({ error: 'insufficient_scope' }), {
            status: 403,
            headers: {
              'content-type': 'application/json',
              'www-authenticate': `Bearer error="insufficient_scope", scope="${state.requiredScope}", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
            },
          });
        }
      }
      return handler.fetch(req);
    }
    return json({ error: 'not found' }, 404);
  };

  const server = serve({
    fetch: fetchHandler,
    port: 0,
    hostname: '127.0.0.1',
    overrideGlobalObjects: false,
  });
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return Object.assign(state, {
    base,
    mcpUrl: `${base}/mcp`,
    expireAccessTokens: () => valid.clear(),
    revokeAll: () => {
      valid.clear();
      refreshValid.clear();
    },
    forgetClients: () => {
      clients.clear();
      valid.clear();
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  });
}
