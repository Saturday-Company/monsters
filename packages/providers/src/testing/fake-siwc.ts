import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fakeHttp, json, type FakeHttp, type RecordedRequest } from './fake-http.ts';

/*
 * A fake OpenAI for Sign in with ChatGPT (no real call ever leaves the test):
 * OpenID discovery, JWKS with a test RSA key, the token endpoint (code
 * exchange with PKCE check, rotating refresh, scripted errors), revocation,
 * `GET /v1/models` and `POST /v1/responses` with scripted SSE answers.
 * `approve(url)` plays the user's browser: it reads the authorize URL and
 * returns the callback URL the loopback listener expects.
 */

export const FAKE_ISSUER = 'https://auth.fake-openai.test';
export const FAKE_RESOURCE = 'https://api.fake-openai.test/v1';

export const FAKE_CLAUDE_SCRIPT = fileURLToPath(
  new URL('./fake-harness/claude.js', import.meta.url),
);
export const FAKE_CODEX_SCRIPT = fileURLToPath(new URL('./fake-harness/codex.js', import.meta.url));
export const FAKE_NPM_SCRIPT = fileURLToPath(new URL('./fake-harness/npm.js', import.meta.url));

export interface FakeSiwcOptions {
  /** Issued client id on registration. Default `oaiapp_fake123`. */
  clientId?: string;
  subject?: string;
  email?: string;
  /** Access token lifetime in seconds. Default 3600. */
  expiresIn?: number;
  /** Scopes granted (default: all of SIWC). */
  scope?: string;
}

export interface FakeSiwc extends FakeHttp {
  endpoints: {
    issuer: string;
    authorizeUrl: string;
    tokenUrl: string;
    resource: string;
  };
  /** Plays the browser: the callback URL for an authorize URL. */
  approve(
    authorizeUrl: string,
    options?: { omitClientId?: boolean; clientId?: string; error?: string; state?: string },
  ): string;
  /** Parameters of the last authorize URL seen by `approve`. */
  lastAuthorize: URLSearchParams | null;
  /** Answers of `POST /responses`, used in order (the last one repeats). */
  replies: (() => Response)[];
  /** Next refresh answers an OAuth error with this code. */
  failRefresh: string | null;
  /** Refresh requests served. */
  refreshCount: number;
  /** Signs an ID token with the fake key. */
  idToken(claims: Record<string, unknown>, key?: KeyObject): string;
  currentAccessToken: string;
  /** The access token the API accepts (others get 401). */
  validTokens: Set<string>;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function fakeSiwc(options: FakeSiwcOptions = {}): FakeSiwc {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'fake-key-1',
    alg: 'RS256',
    use: 'sig',
  };
  const clientId = options.clientId ?? 'oaiapp_fake123';
  const subject = options.subject ?? 'user-fake-sub';
  const email = options.email ?? 'giulia@example.com';
  const expiresIn = options.expiresIn ?? 3600;
  const scope =
    options.scope ??
    'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke';
  const codes = new Map<
    string,
    { challenge: string; nonce: string; clientId: string; redirect: string }
  >();
  let refreshToken = `rt-${randomBytes(6).toString('hex')}`;

  const sign = (claims: Record<string, unknown>, key: KeyObject = privateKey) => {
    const head = b64url(JSON.stringify({ alg: 'RS256', kid: 'fake-key-1', typ: 'JWT' }));
    const body = b64url(JSON.stringify(claims));
    const s = createSign('RSA-SHA256');
    s.update(`${head}.${body}`);
    return `${head}.${body}.${s.sign(key).toString('base64url')}`;
  };

  const newAccess = () => {
    const t = `at-${randomBytes(8).toString('hex')}`;
    fake.validTokens.add(t);
    fake.currentAccessToken = t;
    return t;
  };

  const form = (req: RecordedRequest) => new URLSearchParams(req.body);

  const route = (req: RecordedRequest): Response | undefined => {
    const url = new URL(req.url);
    if (url.href === `${FAKE_ISSUER}/.well-known/openid-configuration`) {
      return json({
        issuer: FAKE_ISSUER,
        jwks_uri: `${FAKE_ISSUER}/jwks`,
        revocation_endpoint: `${FAKE_ISSUER}/oauth/revoke`,
        token_endpoint: `${FAKE_ISSUER}/api/accounts/oauth/token`,
      });
    }
    if (url.href === `${FAKE_ISSUER}/jwks`) return json({ keys: [jwk] });
    if (url.href === `${FAKE_ISSUER}/oauth/revoke`) return new Response(null, { status: 200 });
    if (url.href === `${FAKE_ISSUER}/api/accounts/oauth/token`) {
      const f = form(req);
      if (f.get('resource') !== FAKE_RESOURCE) return json({ error: 'invalid_target' }, 400);
      if (f.get('grant_type') === 'authorization_code') {
        const c = codes.get(f.get('code') ?? '');
        if (!c) return json({ error: 'invalid_grant' }, 400);
        codes.delete(f.get('code')!);
        const challenge = createHash('sha256')
          .update(f.get('code_verifier') ?? '')
          .digest('base64url');
        if (challenge !== c.challenge)
          return json({ error: 'invalid_grant', error_description: 'pkce' }, 400);
        if (f.get('redirect_uri') !== c.redirect) return json({ error: 'invalid_grant' }, 400);
        if (f.get('client_id') !== c.clientId) return json({ error: 'invalid_client' }, 401);
        const now = Math.floor(Date.now() / 1000);
        return json({
          access_token: newAccess(),
          refresh_token: refreshToken,
          id_token: sign({
            iss: FAKE_ISSUER,
            aud: c.clientId,
            sub: subject,
            email,
            nonce: c.nonce,
            iat: now,
            exp: now + 3600,
          }),
          token_type: 'Bearer',
          expires_in: expiresIn,
          scope,
        });
      }
      if (f.get('grant_type') === 'refresh_token') {
        fake.refreshCount++;
        if (fake.failRefresh) {
          const code = fake.failRefresh;
          fake.failRefresh = null;
          return json({ error: code }, code === 'server_error' ? 503 : 400);
        }
        if (f.get('refresh_token') !== refreshToken)
          return json({ error: 'refresh_token_reused' }, 400);
        if (f.get('client_id') !== clientId) return json({ error: 'invalid_client' }, 401);
        refreshToken = `rt-${randomBytes(6).toString('hex')}`;
        return json({
          access_token: newAccess(),
          refresh_token: refreshToken,
          token_type: 'Bearer',
          expires_in: expiresIn,
          scope,
        });
      }
      return json({ error: 'unsupported_grant_type' }, 400);
    }
    if (url.href.startsWith(FAKE_RESOURCE)) {
      const token = (req.headers['authorization'] ?? '').replace(/^Bearer /, '');
      if (!fake.validTokens.has(token)) {
        return json(
          { error: { code: 'subscription_sharing_invalid_user', message: 'invalid token' } },
          401,
        );
      }
      if (url.pathname.endsWith('/models')) {
        return json({
          models: [
            { slug: 'gpt-test', display_name: 'GPT Test', visibility: 'list' },
            { slug: 'gpt-hidden', display_name: 'Hidden', visibility: 'hide' },
            { slug: 'gpt-mini-test', display_name: 'GPT Mini Test', visibility: 'list' },
          ],
        });
      }
      if (url.pathname.endsWith('/responses')) {
        const next = fake.replies.length > 1 ? fake.replies.shift()! : fake.replies[0];
        return next ? next() : responsesText('ok');
      }
    }
    return undefined;
  };

  const http = fakeHttp(route);
  const fake: FakeSiwc = {
    ...http,
    endpoints: {
      issuer: FAKE_ISSUER,
      authorizeUrl: `${FAKE_ISSUER}/api/accounts/authorize`,
      tokenUrl: `${FAKE_ISSUER}/api/accounts/oauth/token`,
      resource: FAKE_RESOURCE,
    },
    lastAuthorize: null,
    replies: [],
    failRefresh: null,
    refreshCount: 0,
    currentAccessToken: '',
    validTokens: new Set(),
    idToken: (claims, key) => sign(claims, key),
    approve(authorizeUrl, o = {}) {
      const u = new URL(authorizeUrl);
      const p = u.searchParams;
      fake.lastAuthorize = p;
      const redirect = p.get('redirect_uri')!;
      const back = new URL(redirect);
      back.searchParams.set('state', o.state ?? p.get('state')!);
      if (o.error) {
        back.searchParams.set('error', o.error);
        return back.toString();
      }
      const registering = p.get('client_id') === 'dynamic_agent_client';
      const issued = o.clientId ?? (registering ? clientId : p.get('client_id')!);
      const code = `code-${randomBytes(6).toString('hex')}`;
      codes.set(code, {
        challenge: p.get('code_challenge')!,
        nonce: p.get('nonce')!,
        clientId: issued,
        redirect,
      });
      back.searchParams.set('code', code);
      back.searchParams.set('scope', scope.replace(/ /g, '+'));
      if (!o.omitClientId && (registering || o.clientId))
        back.searchParams.set('client_id', issued);
      return back.toString();
    },
  };
  return fake;
}

// --- Responses SSE answers -------------------------------------------------------

function sse(events: unknown[], headers: Record<string, string> = {}, status = 200): Response {
  const body = events
    .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('');
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
}

const created = (model: string) => ({
  type: 'response.created',
  response: { id: 'resp_1', model, created_at: 1760000000, status: 'in_progress' },
});
const usage = {
  input_tokens: 12,
  input_tokens_details: { cached_tokens: 2 },
  output_tokens: 7,
  output_tokens_details: { reasoning_tokens: 3 },
};

/** `headers`: what ChatGPT's route adds to a response, e.g. the `x-codex-primary-*` plan windows. */
export function responsesText(
  text: string,
  model = 'gpt-test',
  headers: Record<string, string> = {},
): Response {
  return sse(
    [
      created(model),
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'msg_1', role: 'assistant', content: [] },
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        content_index: 0,
        delta: text.slice(0, 3),
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        content_index: 0,
        delta: text.slice(3),
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        },
      },
      { type: 'response.completed', response: { id: 'resp_1', status: 'completed', usage } },
    ],
    headers,
  );
}

export function responsesTool(
  name: string,
  args: Record<string, unknown>,
  model = 'gpt-test',
): Response {
  const a = JSON.stringify(args);
  return sse([
    created(model),
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name,
        namespace: 'monsters',
        arguments: '',
      },
    },
    {
      type: 'response.function_call_arguments.delta',
      item_id: 'fc_1',
      output_index: 0,
      delta: a.slice(0, 5),
    },
    {
      type: 'response.function_call_arguments.delta',
      item_id: 'fc_1',
      output_index: 0,
      delta: a.slice(5),
    },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name,
        namespace: 'monsters',
        arguments: a,
      },
    },
    { type: 'response.completed', response: { id: 'resp_1', status: 'completed', usage } },
  ]);
}

/** A plan error after the stream opened (usage limit while answering). */
export function responsesFailed(code: string, message: string): Response {
  return sse([
    created('gpt-test'),
    {
      type: 'response.failed',
      response: { id: 'resp_1', status: 'failed', error: { code, message } },
    },
  ]);
}

/** A structured plan error before the stream (HTTP status + `error.code`). */
export function planError(status: number, code: string, message: string, param?: string): Response {
  return json(
    { error: { code, message, type: 'invalid_request_error', ...(param ? { param } : {}) } },
    status,
    {
      'x-request-id': 'req_fake_1',
    },
  );
}
