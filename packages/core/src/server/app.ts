import {
  appLang,
  chatHistoryPage,
  vaultLayout,
  ChatHistoryQuerySchema,
  ConfirmRequestSchema,
  EventTypeSchema,
  EventsQuerySchema,
  FILE_TICKET_PARAM,
  FileTicketRequestSchema,
  KillRequestSchema,
  LOGIN_EXCHANGE_PATH,
  LOGIN_TOKEN_PATH,
  LoginRequestSchema,
  PasswordChangeRequestSchema,
  ResumeRequestSchema,
  SESSION_SECRET_HEADER,
  SetupRequestSchema,
  type Channel,
  type ChatHistoryResponse,
  type EventType,
  type StatusResponse,
  type StoppedRequest,
} from '@monsters/shared';
import { isTunnelProofNonce, tunnelProof } from '@monsters/shared/node';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import {
  AuthError,
  type AuthContext,
  type AuthService,
  type SessionCheck,
  type SessionProof,
  THUMBS_TICKET_RESOURCE,
} from '../auth/auth-service.ts';
import { isLoopbackHost, type CoreConfig } from '../config.ts';
import { saveAppLanguage } from '../i18n.ts';
import type { RunController } from '../kill/run-controller.ts';
import type { EventLog } from '../log/event-log.ts';
import type { ContinuedRun } from '../team/resume-work.ts';
import {
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  DEVICE_COOKIE,
  SESSION_COOKIE,
  isAllowedHost,
  isAllowedOrigin,
  isJsonContentType,
  readBearer,
  readCookie,
} from './guards.ts';
import { registerWebUi, type WebUiOptions } from './web-ui.ts';

import { CORE_VERSION } from '../version.ts';
import { serverStrings } from './server.strings.ts';

/** The product version (see version.ts), re-exported here for the existing imports. */
export { CORE_VERSION };

/** `POST /api/setup` body: the shared schema plus the one-time code printed by `monsters start`. */
const SetupWithCodeSchema = SetupRequestSchema.extend({
  setupCode: z.string().min(1).max(64),
});

/** `POST /api/login/exchange` body. */
const LoginExchangeSchema = z.object({ token: z.string().min(1).max(200) });

/**
 * Address of the peer when the app runs on a Node HTTP server (`@hono/node-server` passes
 * the request as `env.incoming`); undefined in-process (`app.request`).
 */
function remoteAddress(c: Context): string | undefined {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress;
}

/** Only a peer known to be on this machine (the core may be bound elsewhere on purpose). */
function fromLoopback(c: Context): boolean {
  const address = remoteAddress(c);
  return address !== undefined && isLoopbackHost(address);
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** `POST /api/files` with a multipart body: the upload of a file (contract in shared/src/files.ts). */
function isUpload(c: {
  req: { method: string; path: string; header(name: string): string | undefined };
}): boolean {
  return (
    c.req.method === 'POST' &&
    c.req.path === '/api/files' &&
    /^multipart\/form-data;/i.test(c.req.header('content-type') ?? '')
  );
}
const DEVICE_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

/**
 * State changes only the user in person may make (review of 18/10, M1): a session of the UI
 * opened with the password (or by the desktop app), never the CLI token nor a session it
 * opened. The token is a file every process of the user can read, a monster with the terminal
 * too: with it a monster could approve its own brake card, grant itself permissions, raise the
 * cap, change what the brake asks, pair its own Telegram account or approve its own drafts.
 * The kill switch, the status, resume, the chat and the automations stay open to the token
 * (the CLI uses them). The brake's cards are checked by their kind (routes/team.ts). Every
 * route that changes state is either here or, with the reason, in the list of what the token
 * may do in test/review-ondate34-token.test.ts: a new route in neither fails that test.
 * The notes the token may not write are in protected-notes.ts.
 */
const OWNER_ONLY: readonly { methods: ReadonlySet<string>; path: RegExp }[] = [
  // Permissions, the "Chiedi sempre" rules (profile), the cap, the instinct and its engine.
  { methods: new Set(['PUT']), path: /^\/api\/permissions\/?$/ },
  { methods: new Set(['PUT']), path: /^\/api\/profile\/?$/ },
  {
    methods: new Set(['PUT']),
    path: /^\/api\/settings\/(?:spend|instinct|decisions|language)\/?$/,
  },
  // The limits of each job are a brake like the cap: a monster could raise its own.
  { methods: new Set(['PUT', 'DELETE']), path: /^\/api\/settings\/limits\/?$/ },
  // Telegram: the main bot, the pairing, the paired accounts, the dedicated bots.
  { methods: UNSAFE_METHODS, path: /^\/api\/telegram(?:\/|$)/ },
  // What a monster proposes and only the user confirms (D-098, D-103, D-113).
  { methods: new Set(['POST']), path: /^\/api\/drafts\/[^/]+\/[^/]+\/confirm\/?$/ },
  {
    methods: new Set(['POST']),
    path: /^\/api\/projects\/[^/]+\/(?:confirm|folder-docs\/approve|members)\/?$/,
  },
  // A project's folder is granted to its monsters (read and write, D-097).
  { methods: new Set(['POST']), path: /^\/api\/projects\/?$/ },
  { methods: new Set(['PATCH']), path: /^\/api\/projects\/[^/]+\/?$/ },
  // Tools given to the monsters: other programs, Claude's connectors, the web of a monster.
  { methods: new Set(['PUT']), path: /^\/api\/mcp-servers\/[^/]+\/?$/ },
  { methods: new Set(['POST']), path: /^\/api\/mcp-servers\/[^/]+\/accept\/?$/ },
  { methods: new Set(['PUT']), path: /^\/api\/claude-connections\/[^/]+\/?$/ },
  { methods: new Set(['POST']), path: /^\/api\/team\/agents\/?$/ },
  { methods: new Set(['PATCH']), path: /^\/api\/team\/agents\/[^/]+\/?$/ },
  // An automation's objective rewritten by the user becomes the user's words (D-103).
  { methods: new Set(['POST']), path: /^\/api\/automations\/?$/ },
  { methods: new Set(['PATCH']), path: /^\/api\/automations\/[^/]+\/?$/ },
  // Where the models answer from, with whose key, and which models a monster uses (review of
  // ondate 3-4, n. 7): a key or an address of the monster's choosing sees every prompt.
  { methods: UNSAFE_METHODS, path: /^\/api\/providers\/[^/]+\/(?:key|url)\/?$/ },
  { methods: new Set(['PUT']), path: /^\/api\/agents\/[^/]+\/models\/?$/ },
  {
    methods: UNSAFE_METHODS,
    path: /^\/api\/settings\/(?:openrouter|openrouter-key|brave-key|web-search|typesafe-key)\/?$/,
  },
  // The subscriptions the harnesses log in with (an account is an identity).
  { methods: UNSAFE_METHODS, path: /^\/api\/subscriptions(?:\/|$)/ },
  // The scripts of an HTML page of a monster (maintainer decision of 16/10).
  { methods: new Set(['POST']), path: /^\/api\/files\/[^/]+\/scripts\/?$/ },
  // A monster or a project back with its old permissions and folder; the first team.
  { methods: new Set(['POST']), path: /^\/api\/team\/archived\/[^/]+\/restore\/?$/ },
  { methods: new Set(['POST']), path: /^\/api\/projects\/[^/]+\/restore\/?$/ },
  { methods: UNSAFE_METHODS, path: /^\/api\/onboarding(?:\/|$)/ },
  // Monsters, projects, members and connections taken away; accounts of other programs.
  { methods: new Set(['DELETE']), path: /^\/api\/team\/agents\/[^/]+\/?$/ },
  { methods: new Set(['DELETE']), path: /^\/api\/projects\/[^/]+(?:\/members\/[^/]+)?\/?$/ },
  { methods: new Set(['DELETE']), path: /^\/api\/mcp-servers\/[^/]+(?:\/oauth)?\/?$/ },
  { methods: new Set(['POST']), path: /^\/api\/mcp-servers\/[^/]+\/oauth\/?$/ },
  { methods: new Set(['POST']), path: /^\/api\/mcp-oauth\/finish\/?$/ },
  { methods: new Set(['DELETE']), path: /^\/api\/claude-connections\/[^/]+\/?$/ },
  // "È mia": the mark of third-party text taken away from a line of a monster's memory (A2).
  { methods: new Set(['POST']), path: /^\/api\/team\/agents\/[^/]+\/memory\/own\/?$/ },
  // An undo puts back what a monster or the user wrote, the memory and the profile included.
  { methods: new Set(['POST']), path: /^\/api\/(?:vault\/undo|runs\/[^/]+\/undo)\/?$/ },
];

/**
 * Among `OWNER_ONLY`, what needs the password typed in the last minutes (`AuthContext.recent`,
 * residual risk of M1): a session confirmed once stays the user's for days (the cookie of a
 * browser or of the app attached to a core of the terminal), and these changes give a monster
 * or another person the most. The password change asks the current one (that is the
 * confirmation); turning on the Terminal of a monster (routes/permissions.ts) and "Strumenti per
 * gli altri" of a dedicated bot (routes/telegram.ts) depend on the body and are checked there.
 * The desktop app on its own core is always recent (its session comes from its own channel).
 */
const RECENT_ONLY: readonly { methods: ReadonlySet<string>; path: RegExp }[] = [
  // Pairing a Telegram account with the main bot, and the main bot itself.
  { methods: new Set(['POST']), path: /^\/api\/telegram\/pairing\/?$/ },
  { methods: new Set(['PUT']), path: /^\/api\/telegram\/token\/?$/ },
];

/** True when this request needs a recent confirmation (see `RECENT_ONLY`). */
export function recentOnly(method: string, path: string): boolean {
  return RECENT_ONLY.some((r) => r.methods.has(method) && r.path.test(path));
}

/** The answer to a request `RECENT_ONLY` refuses: the UI asks the password and tries again. */
export const confirmRequired = () =>
  ({ error: 'confirm_required', message: serverStrings().confirmRequired }) as const;

/** The bytes of a file the browser loads without headers (`<img>`, `<iframe>`, a download). */
const FILE_BYTES_PATH = /^\/api\/files\/([A-Za-z0-9_-]{1,100})\/(content|thumb)\/?$/;
/** An id the core could have made for a file (no slashes, no dots). */
const FILE_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** What a ticket for the bytes of a file is bound to, besides the session (S-B13). */
export function fileTicketResource(id: string, part: 'content' | 'thumb'): string {
  return `file:${id}:${part}`;
}

/** True when only the user in person may make this request (see `OWNER_ONLY`). */
export function ownerOnly(method: string, path: string): boolean {
  return OWNER_ONLY.some((r) => r.methods.has(method) && r.path.test(path));
}

/** The answer to a request `OWNER_ONLY` refuses: the UI asks the password and tries again. */
export const ownerRequired = () =>
  ({ error: 'owner_required', message: serverStrings().ownerRequired }) as const;
/** `GET /api/files/:id/content`: the only answer the core's own pages may frame. */
export const FILE_CONTENT_PATH = /^\/api\/files\/[^/]+\/content\/?$/;

export interface AppDeps {
  config: CoreConfig;
  auth: AuthService;
  log: EventLog;
  runs: RunController;
  startedAt: number;
  /**
   * Key of `server.json` (`proofKey`): `/api/health?proof=<nonce>` answers with its HMAC,
   * so a client of the SSH tunnel knows it reached this core (D-044, M3.6).
   */
  tunnelProofKey?: string;
  /** Called after a logout so open streams of that session are closed. */
  onSessionEnded?: (sessionId: string) => void;
  /** Called once the local user has been created (e.g. to delete the setup code file). */
  onSetupCompleted?: () => void;
  /**
   * The language of the first screen is saved (D-153), before the account: the core makes its
   * untouched vault again in that language's layout (D-154, `Hub.adoptVaultLayout`).
   */
  onLanguageChosen?: () => Promise<unknown>;
  /**
   * "Riprendi e continua" (D-072): the requests the latest global stop left
   * halfway, read before resuming, and how to start them again after.
   */
  continueWork?: {
    pending(): StoppedRequest[];
    start(requests: readonly StoppedRequest[], by: Channel): ContinuedRun[];
  };
  /** Registers more routes (e.g. team and conversation, see routes/team.ts). */
  extend?: (app: Hono<AppEnv>, helpers: RouteHelpers) => void;
  /** Serves the web UI on the same origin (see web-ui.ts). Off when omitted. */
  webUi?: WebUiOptions | undefined;
}

type Env = { Variables: { auth: AuthContext } };
export type AppEnv = Env;

/** What route modules registered with `extend` reuse from the app. */
export interface RouteHelpers {
  requireAuth: MiddlewareHandler<Env>;
  /** The caller is the user in person (`AuthContext.owner`), see `OWNER_ONLY`. */
  isOwner: (ctx: AuthContext | undefined) => boolean;
  /**
   * For a change `RECENT_ONLY` cannot tell from the path: the answer that asks the password
   * again (403 `owner_required` or `confirm_required`), or null when the caller confirmed it
   * recently.
   */
  requireRecent: (c: Context<Env>) => Response | null;
  parseBody: typeof parseBody;
  channelOf: typeof channelOf;
}

/**
 * Resolves the caller from the bearer token, or from the session cookie with the proof a
 * browser's session needs besides it (S-B13: its secret, or a ticket of a file).
 */
export function authenticate(
  auth: AuthService,
  headers: { cookie?: string | undefined; authorization?: string | undefined },
  proof: SessionProof = {},
): AuthContext | null {
  const ctx = checkAuth(auth, headers, proof);
  return ctx === 'secret_required' ? null : ctx;
}

/** Like `authenticate`, telling a cookie presented without its secret apart. */
export function checkAuth(
  auth: AuthService,
  headers: { cookie?: string | undefined; authorization?: string | undefined },
  proof: SessionProof = {},
): SessionCheck {
  const bearer = readBearer(headers.authorization);
  if (bearer) return auth.authenticateToken(bearer);
  return auth.checkSession(readCookie(headers.cookie, SESSION_COOKIE), proof);
}

/** What the guards read of a request (any route's context). */
interface RequestOf {
  req: {
    method: string;
    path: string;
    header(name: string): string | undefined;
    query(name: string): string | undefined;
  };
}

/**
 * The proof of a request besides its cookie (S-B13): the session's secret in its header, or,
 * for the bytes of a file (GET), a ticket in the URL bound to that file.
 */
function proofOf(c: RequestOf): SessionProof {
  const secret = c.req.header(SESSION_SECRET_HEADER);
  const ticket = c.req.method === 'GET' ? c.req.query(FILE_TICKET_PARAM) : undefined;
  const bytes = ticket ? FILE_BYTES_PATH.exec(c.req.path) : null;
  return {
    ...(secret ? { secret } : {}),
    ...(ticket && bytes
      ? {
          ticket: {
            value: ticket,
            resource: fileTicketResource(bytes[1]!, bytes[2] as 'content' | 'thumb'),
          },
        }
      : {}),
  };
}

/** 401 for a cookie presented without its secret: the UI looks for it, or asks the password. */
const secretRequired = () =>
  ({ error: 'session_secret_required', message: serverStrings().secretRequired }) as const;

function channelOf(ctx: AuthContext | undefined): Channel {
  return ctx?.via === 'token' ? 'cli' : 'ui';
}

async function parseBody<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; res: Response }> {
  const raw = await c.req.text();
  let json: unknown = {};
  if (raw.trim() !== '') {
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false, res: c.json({ error: 'invalid_json' }, 400) };
    }
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, res: c.json({ error: 'invalid_request', message }, 400) };
  }
  return { ok: true, data: parsed.data };
}

/** What `POST /api/setup` and `POST /api/login` answer: the secret for a browser (S-B13). */
function sessionAnswer(session: { user: { email: string }; secret?: string }) {
  return {
    email: session.user.email,
    ...(session.secret !== undefined ? { sessionSecret: session.secret } : {}),
  };
}

function splitList(value: string | undefined): string[] | undefined {
  const list = value
    ?.split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return list && list.length > 0 ? list : undefined;
}

/** HTTP API of the core. The WebSocket stream is attached separately (see stream.ts). */
export function createApp(deps: AppDeps): Hono<Env> {
  const { config, auth, log, runs } = deps;
  const app = new Hono<Env>();

  const setSessionCookie = (c: Context, token: string, expiresAt: number) => {
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
    });
  };

  const setDeviceCookie = (c: Context, token: string) => {
    setCookie(c, DEVICE_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/api/login',
      maxAge: DEVICE_COOKIE_MAX_AGE_S,
    });
  };

  // Host (DNS rebinding) and Origin (cross-site) checks, security headers.
  app.use('*', async (c, next) => {
    if (!isAllowedHost(c.req.header('host'), config)) {
      return c.json({ error: 'invalid_host' }, 403);
    }
    if (!isAllowedOrigin(c.req.header('origin'), config)) {
      return c.json({ error: 'origin_not_allowed' }, 403);
    }
    if (UNSAFE_METHODS.has(c.req.method)) {
      // Only JSON bodies: HTML forms and `text/plain` fetches cannot reach state changes.
      // The one exception is the upload of a file (multipart, still with the header below).
      if (!isJsonContentType(c.req.header('content-type')) && !isUpload(c)) {
        return c.json({ error: 'unsupported_media_type' }, 415);
      }
      // Anti-CSRF: a custom header cannot be sent cross-origin without a CORS
      // preflight, which the core never grants. Bearer clients (CLI) are exempt.
      if (
        !readBearer(c.req.header('authorization')) &&
        c.req.header(CSRF_HEADER) !== CSRF_HEADER_VALUE
      ) {
        return c.json({ error: 'csrf_header_required' }, 403);
      }
    }
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    // The bytes of a file are framed by the UI's preview pane (sandboxed iframe, file-headers.ts).
    c.header('X-Frame-Options', FILE_CONTENT_PATH.test(c.req.path) ? 'SAMEORIGIN' : 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    // API answers are never cached; the UI files set their own policy (web-ui.ts).
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  });

  const limit: MiddlewareHandler<Env> = bodyLimit({
    maxSize: config.maxBodyBytes,
    onError: (c) => c.json({ error: 'payload_too_large' }, 413),
  });
  // The upload reads its body with a ceiling of its own (routes/files.ts).
  app.use('*', (c, next) => {
    if (isUpload(c)) return next();
    const raw = c.req.raw;
    // A body without `content-length` makes `bodyLimit` copy the request with `new Request(raw)`.
    // The core keeps Node's own globals (`overrideGlobalObjects: false`, core.ts), and the native
    // constructor cannot copy node-server's lightweight request: hand it a native one.
    if (raw.body && (!raw.headers.has('content-length') || raw.headers.has('transfer-encoding'))) {
      // `duplex` is Node's (a streamed body): not in the DOM's RequestInit.
      const init: RequestInit & { duplex: 'half' } = {
        method: raw.method,
        headers: raw.headers,
        body: raw.body,
        duplex: 'half',
        signal: raw.signal,
      };
      c.req.raw = new Request(raw.url, init);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- Hono's '*' context
    return limit(c, next);
  });

  const credentialsOf = (c: RequestOf) => ({
    cookie: c.req.header('cookie'),
    authorization: c.req.header('authorization'),
  });

  const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
    const ctx = checkAuth(auth, credentialsOf(c), proofOf(c));
    if (ctx === 'secret_required') return c.json(secretRequired(), 401);
    if (!ctx) return c.json({ error: 'unauthorized' }, 401);
    c.set('auth', ctx);
    await next();
  };

  // Approvals, grants and pairing: the user in person only (review of 18/10, M1); the most
  // sensitive of them with the password typed in the last minutes. Before the routes; an
  // unauthenticated request goes on to their `requireAuth` (401).
  app.use('/api/*', async (c, next) => {
    if (!ownerOnly(c.req.method, c.req.path)) return next();
    const ctx = authenticate(auth, credentialsOf(c), proofOf(c));
    if (ctx && !ctx.owner) return c.json(ownerRequired(), 403);
    if (ctx && !ctx.recent && recentOnly(c.req.method, c.req.path)) {
      return c.json(confirmRequired(), 403);
    }
    return next();
  });

  const requireRecent = (c: Context<Env>): Response | null => {
    const ctx = c.get('auth');
    if (!ctx.owner) return c.json(ownerRequired(), 403);
    return ctx.recent ? null : c.json(confirmRequired(), 403);
  };

  app.get('/api/health', (c) => {
    const nonce = c.req.query('proof');
    if (deps.tunnelProofKey !== undefined && isTunnelProofNonce(nonce)) {
      return c.json({
        ok: true,
        version: CORE_VERSION,
        proof: tunnelProof(deps.tunnelProofKey, nonce),
      });
    }
    return c.json({ ok: true, version: CORE_VERSION });
  });

  app.get('/api/setup-status', (c) =>
    c.json({ needsSetup: auth.needsSetup(), language: appLang(), vaultLayout: vaultLayout().id }),
  );

  app.post('/api/setup', async (c) => {
    if (!auth.needsSetup()) return c.json({ error: 'already_configured' }, 409);
    const body = await parseBody(c, SetupWithCodeSchema);
    if (!body.ok) return body.res;
    // Before the account exists, anyone on this machine can reach the port: the
    // one-time code printed by `monsters start` proves access to the terminal.
    if (!auth.checkSetupCode(body.data.setupCode)) {
      return c.json({ error: 'invalid_setup_code' }, 403);
    }
    // The language picked on the first screen (D-153).
    if (body.data.language && body.data.language !== appLang()) {
      saveAppLanguage(deps.config.home, body.data.language, process.env);
    }
    await deps.onLanguageChosen?.();
    try {
      const session = await auth.setup(body.data.email, body.data.password, 'ui', {
        partitioned: body.data.partitioned,
      });
      setSessionCookie(c, session.token, session.expiresAt);
      setDeviceCookie(c, session.deviceToken);
      deps.onSetupCompleted?.();
      return c.json(sessionAnswer(session), 201);
    } catch (err) {
      if (err instanceof AuthError && err.code === 'already_configured') {
        return c.json({ error: 'already_configured' }, 409);
      }
      throw err;
    }
  });

  app.post('/api/login', async (c) => {
    const body = await parseBody(c, LoginRequestSchema);
    if (!body.ok) return body.res;
    try {
      const session = await auth.login(body.data.email, body.data.password, {
        channel: 'ui',
        deviceToken: readCookie(c.req.header('cookie'), DEVICE_COOKIE),
        partitioned: body.data.partitioned,
      });
      if (!session) return c.json({ error: 'invalid_credentials' }, 401);
      setSessionCookie(c, session.token, session.expiresAt);
      setDeviceCookie(c, session.deviceToken);
      return c.json(sessionAnswer(session));
    } catch (err) {
      if (err instanceof AuthError && err.code === 'too_many_attempts') {
        const retryAfterS = Math.max(1, Math.ceil(err.retryAfterMs / 1000));
        c.header('Retry-After', String(retryAfterS));
        return c.json({ error: 'too_many_attempts', retryAfterMs: err.retryAfterMs }, 429);
      }
      throw err;
    }
  });

  // Single-use login tokens of the desktop app (M3.1, D-045). Issued only to the CLI
  // token (a file readable only by the user; the app reads it when it attaches to a core
  // started from the terminal) or over the app's own message port (desktop-bridge.ts);
  // exchanged once, within a minute, for the normal session cookie. Loopback only.
  app.post(LOGIN_TOKEN_PATH, requireAuth, (c) => {
    if (c.get('auth').via !== 'token' || !fromLoopback(c)) {
      return c.json({ error: 'forbidden' }, 403);
    }
    return c.json(auth.issueLoginToken('cli'), 201);
  });

  app.post(LOGIN_EXCHANGE_PATH, async (c) => {
    if (!fromLoopback(c)) return c.json({ error: 'forbidden' }, 403);
    const body = await parseBody(c, LoginExchangeSchema);
    if (!body.ok) return body.res;
    try {
      const session = auth.consumeLoginToken(body.data.token);
      if (session === 'needs_setup') return c.json({ error: 'needs_setup' }, 409);
      if (!session) return c.json({ error: 'invalid_token' }, 401);
      setSessionCookie(c, session.token, session.expiresAt);
      return c.json({ email: session.user.email });
    } catch (err) {
      if (err instanceof AuthError && err.code === 'too_many_attempts') {
        c.header('Retry-After', String(Math.max(1, Math.ceil(err.retryAfterMs / 1000))));
        return c.json({ error: 'too_many_attempts', retryAfterMs: err.retryAfterMs }, 429);
      }
      throw err;
    }
  });

  app.post('/api/logout', (c) => {
    const token = readCookie(c.req.header('cookie'), SESSION_COOKIE);
    // The session ends only with its proof (S-B13): another local service that received the
    // cookie cannot log the user out. Without it, only this client's cookie goes.
    const ctx = token ? auth.authenticateSession(token, proofOf(c)) : null;
    if (token && ctx) {
      auth.logout(token, 'ui');
      if (ctx.sessionId) deps.onSessionEnded?.(ctx.sessionId);
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'Strict' });
    return c.json({ ok: true });
  });

  app.get('/api/me', requireAuth, (c) => {
    const ctx = c.get('auth');
    return c.json({
      email: ctx.user?.email ?? null,
      via: ctx.via,
      owner: ctx.owner,
      recent: ctx.recent,
    });
  });

  const tooMany = (c: Context, err: AuthError) => {
    c.header('Retry-After', String(Math.max(1, Math.ceil(err.retryAfterMs / 1000))));
    return c.json({ error: 'too_many_attempts', retryAfterMs: err.retryAfterMs }, 429);
  };

  // "Conferma che sei tu" (review of 18/10, M1): the password again in this session makes it the
  // user's in person (a session the CLI token opened) and recent (`RECENT_ONLY`). The same
  // session goes on: its streams and its secret stay.
  app.post('/api/auth/confirm', requireAuth, async (c) => {
    const ctx = c.get('auth');
    if (ctx.via !== 'session' || !ctx.sessionId) {
      return c.json({ error: 'session_required', message: serverStrings().confirmFromApp }, 403);
    }
    const body = await parseBody(c, ConfirmRequestSchema);
    if (!body.ok) return body.res;
    try {
      if (!(await auth.confirm(ctx.sessionId, body.data.password, 'ui'))) {
        return c.json({ error: 'wrong_password', message: serverStrings().wrongPassword }, 400);
      }
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof AuthError && err.code === 'too_many_attempts') return tooMany(c, err);
      throw err;
    }
  });

  // A ticket for the bytes of a file in an `<img>`, an `<iframe>` or a download link (S-B13):
  // the browser adds no header there. Bound to this session and to this file and part.
  app.post('/api/files/:id/ticket', requireAuth, async (c) => {
    const ctx = c.get('auth');
    const id = c.req.param('id');
    if (!FILE_ID.test(id)) return c.json({ error: 'invalid_request' }, 400);
    const body = await parseBody(c, FileTicketRequestSchema);
    if (!body.ok) return body.res;
    // The CLI token needs no ticket (it sends its header); a session's ticket is of its own.
    if (ctx.via !== 'session' || !ctx.sessionId) return c.json({ error: 'session_required' }, 403);
    // A thumbnail's ticket is good for every thumbnail of the session (a long list, n. 14).
    const resource =
      body.data.part === 'thumb' ? THUMBS_TICKET_RESOURCE : fileTicketResource(id, body.data.part);
    return c.json(auth.issueFileTicket(ctx.sessionId, resource), 201);
  });

  // Password from the settings: the current one first, from a browser session; the other
  // sessions are logged out (and their streams closed), this one stays.
  app.post('/api/auth/password', requireAuth, async (c) => {
    const ctx = c.get('auth');
    if (ctx.via !== 'session') {
      return c.json(
        {
          error: 'session_required',
          message: serverStrings().passwordFromSettings,
        },
        403,
      );
    }
    const body = await parseBody(c, PasswordChangeRequestSchema);
    if (!body.ok) return body.res;
    if (body.data.currentPassword === body.data.newPassword) {
      return c.json({ error: 'same_password', message: serverStrings().samePassword }, 400);
    }
    try {
      const closed = await auth.changePassword(body.data.currentPassword, body.data.newPassword, {
        keepSession: ctx.sessionId,
        channel: 'ui',
      });
      if (!closed) {
        return c.json(
          { error: 'wrong_password', message: serverStrings().wrongCurrentPassword },
          400,
        );
      }
      for (const id of closed) deps.onSessionEnded?.(id);
      return c.json({ ok: true, sessionsClosed: closed.length });
    } catch (err) {
      if (err instanceof AuthError && err.code === 'too_many_attempts') return tooMany(c, err);
      throw err;
    }
  });

  // `monsters password` of earlier versions asked the running core with the CLI token. Not any
  // more (review of 18/10, M1): a monster that read the token could lock the user out of the
  // UI and the tunnel. The password without the old one is set only with the core stopped
  // (`resetPasswordOffline`, under the lock of the data folder); with it running, from the
  // settings with the current one.
  app.post('/api/auth/password/reset', requireAuth, (c) =>
    c.json(
      {
        error: 'core_running',
        message: serverStrings().coreRunning,
      },
      409,
    ),
  );

  const status = (): StatusResponse => {
    const halt = runs.haltState;
    return {
      version: CORE_VERSION,
      halted: halt !== null,
      haltedAt: halt?.at ?? null,
      haltedReason: halt?.reason ?? null,
      runs: runs.activeRuns(),
      uptimeMs: Date.now() - deps.startedAt,
    };
  };

  app.get('/api/status', requireAuth, (c) => c.json(status()));

  app.post('/api/kill', requireAuth, async (c) => {
    const body = await parseBody(c, KillRequestSchema);
    if (!body.ok) return body.res;
    const report = await runs.kill({ by: channelOf(c.get('auth')), reason: body.data.reason });
    return c.json({ ...status(), report });
  });

  app.post('/api/resume', requireAuth, async (c) => {
    const body = await parseBody(c, ResumeRequestSchema);
    if (!body.ok) return body.res;
    const by = channelOf(c.get('auth'));
    // Read before resuming: only what this stop left halfway, and only if it was stopped.
    const pending = body.data.continue && runs.halted ? (deps.continueWork?.pending() ?? []) : [];
    const resumed = runs.resume({ by });
    const continued =
      resumed && pending.length > 0 ? (deps.continueWork?.start(pending, by) ?? []) : [];
    return c.json({ ...status(), resumed, ...(body.data.continue ? { continued } : {}) });
  });

  app.get('/api/events', requireAuth, (c) => {
    const parsed = EventsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const q = parsed.data;
    const types = splitList(q.type);
    if (types && !types.every((t) => EventTypeSchema.safeParse(t).success)) {
      return c.json({ error: 'invalid_request', message: 'unknown event type' }, 400);
    }
    const events = log.query({
      agent: splitList(q.agent),
      type: types as EventType[] | undefined,
      runId: q.runId,
      since: q.since,
      until: q.until,
      after: q.after,
      before: q.before,
      limit: q.limit,
      order: q.order,
    });
    return c.json({ events });
  });

  // One page of a chat's history in one request (D-173 made three; the chat's types are chosen
  // here, not by the client). An unknown monster is an empty chat, not a 404: a 404 means a core
  // without this route, and the client falls back to `/api/events`.
  app.get('/api/chats/:agent/history', requireAuth, (c) => {
    const agent = c.req.param('agent');
    const parsed = ChatHistoryQuerySchema.safeParse(c.req.query());
    if (!parsed.success || agent.length > 64) return c.json({ error: 'invalid_request' }, 400);
    const page = chatHistoryPage(agent, parsed.data.before, (q) =>
      log.query({ ...q, type: q.type as EventType[] | undefined }),
    );
    return c.json(page satisfies ChatHistoryResponse);
  });

  deps.extend?.(app, {
    requireAuth,
    isOwner: (ctx) => ctx?.owner === true,
    requireRecent,
    parseBody,
    channelOf,
  });
  if (deps.webUi) registerWebUi(app, deps.webUi);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    log.append({
      agent: 'system',
      type: 'error',
      data: { message: err.message, code: 'http_500' },
    });
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
