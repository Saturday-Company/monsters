import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  StreamAuthMessageSchema,
  ULID_REGEX,
  type LogEvent,
  type StreamMessage,
} from '@monsters/shared';
import { WebSocket, WebSocketServer } from 'ws';
import type { AuthContext, AuthService, SessionProof } from '../auth/auth-service.ts';
import type { CoreConfig } from '../config.ts';
import type { RunController } from '../kill/run-controller.ts';
import type { EventLog } from '../log/event-log.ts';
import { authenticate, checkAuth } from './app.ts';
import { isAllowedHost, isAllowedOrigin } from './guards.ts';

export const STREAM_PATH = '/api/stream';
/** Events read from the log per replay page (the log caps a query at 1000). */
const REPLAY_PAGE = 500;
/** A replay waits for the socket to drain below this before sending the next page. */
const REPLAY_LOW_WATER_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 30_000;
/** Slow clients are dropped instead of buffering the whole log in memory. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
/** How long a browser's socket may wait before its first message, the session's secret. */
const AUTH_TIMEOUT_MS = 10_000;
/** Close code of a socket whose credentials do not hold (the UI goes back to the login). */
const UNAUTHORIZED_CLOSE = 4401;

export interface StreamDeps {
  config: CoreConfig;
  auth: AuthService;
  log: EventLog;
  runs: RunController;
}

export interface StreamHandle {
  /** Closes the streams opened with a given session (after logout). */
  closeSession(sessionId: string): void;
  close(): void;
  readonly clientCount: number;
}

function reject(socket: Duplex, status: number, message: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${message.length}\r\n\r\n${message}`,
  );
  socket.destroy();
}

/**
 * WebSocket `/api/stream`: forwards every event of the log to authenticated
 * clients. Host, Origin and auth are checked before the handshake completes.
 * Query `?after=<event id>` replays the events after that cursor first.
 * A browser's session (S-B13) needs its secret too: not in the URL (it ends up
 * in logs and histories) but in the first message, `{ kind: 'auth', secret }`;
 * nothing is sent before it, and a wrong or missing one closes with 4401.
 */
export function attachStream(server: Server, deps: StreamDeps): StreamHandle {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const sessions = new Map<WebSocket, string | undefined>();
  const alive = new WeakMap<WebSocket, boolean>();
  /** Re-checks the credentials used to open each socket (expiry, rotation). */
  const stillAuthorized = new WeakMap<WebSocket, () => boolean>();
  /** Sockets of a browser's session waiting for the secret (closed with the stream). */
  const waiting = new Set<WebSocket>();

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== STREAM_PATH) return reject(socket, 404, 'Not Found');
    if (!isAllowedHost(req.headers.host, deps.config)) return reject(socket, 403, 'Forbidden');
    if (!isAllowedOrigin(req.headers.origin, deps.config)) return reject(socket, 403, 'Forbidden');
    const credentials = { cookie: req.headers.cookie, authorization: req.headers.authorization };
    const first = checkAuth(deps.auth, credentials);
    if (!first) return reject(socket, 401, 'Unauthorized');

    const after = url.searchParams.get('after');
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (first !== 'secret_required') {
        serve(ws, first, credentials, {}, after);
        return;
      }
      waiting.add(ws);
      const timer = setTimeout(
        () => ws.close(UNAUTHORIZED_CLOSE, 'secret required'),
        AUTH_TIMEOUT_MS,
      );
      const stopWaiting = () => {
        clearTimeout(timer);
        waiting.delete(ws);
      };
      ws.once('close', stopWaiting);
      ws.on('error', stopWaiting);
      ws.once('message', (data: Buffer, isBinary: boolean) => {
        stopWaiting();
        let secret: string | undefined;
        if (!isBinary) {
          try {
            const msg = StreamAuthMessageSchema.safeParse(JSON.parse(data.toString('utf8')));
            if (msg.success) secret = msg.data.secret;
          } catch {
            // not JSON: no secret
          }
        }
        const proof: SessionProof = { secret };
        const ctx = secret ? authenticate(deps.auth, credentials, proof) : null;
        if (!ctx) {
          ws.close(UNAUTHORIZED_CLOSE, 'unauthorized');
          return;
        }
        serve(ws, ctx, credentials, proof, after);
      });
    });
  };

  /** Streams the log to an authenticated socket (`proof`: what its session needed besides the cookie). */
  const serve = (
    ws: WebSocket,
    ctx: AuthContext,
    credentials: { cookie: string | undefined; authorization: string | undefined },
    proof: SessionProof,
    after: string | null,
  ) => {
    sessions.set(ws, ctx.sessionId);
    alive.set(ws, true);
    stillAuthorized.set(ws, () => authenticate(deps.auth, credentials, proof) !== null);
    ws.on('pong', () => alive.set(ws, true));

    const send = (msg: StreamMessage) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
        ws.close(1013, 'client too slow');
        return;
      }
      ws.send(JSON.stringify(msg));
    };

    // Subscribe before replaying so no event falls in between; dedupe by id.
    let lastSent = after && ULID_REGEX.test(after) ? after : '';
    const queue: LogEvent[] = [];
    let replaying = true;
    let closed = false;
    const forward = (event: LogEvent) => {
      if (event.id <= lastSent) return;
      lastSent = event.id;
      send({ kind: 'event', event });
    };
    const unsubscribe = deps.log.subscribe((event) => {
      if (replaying) queue.push(event);
      else forward(event);
    });

    // Replays everything after the cursor, page by page, until it reaches the
    // live tail: the events written meanwhile wait in `queue`.
    const replay = async () => {
      send({ kind: 'hello', halted: deps.runs.halted });
      if (lastSent) {
        let count = 0;
        for (;;) {
          const page = deps.log.query({ after: lastSent, limit: REPLAY_PAGE });
          for (const e of page) forward(e);
          count += page.length;
          if (page.length < REPLAY_PAGE) break;
          while (!closed && ws.bufferedAmount > REPLAY_LOW_WATER_BYTES) {
            await new Promise((r) => setTimeout(r, 20));
          }
          if (closed || ws.readyState !== WebSocket.OPEN) return;
        }
        send({ kind: 'replay_done', count });
      }
      replaying = false;
      for (const e of queue) forward(e);
      queue.length = 0;
    };
    replay().catch(() => {
      // The log failed while replaying (closing core): this client is let go.
      closed = true;
      ws.close(1011, 'replay failed');
    });

    // Clients only listen; incoming messages are ignored.
    ws.on('close', () => {
      closed = true;
      unsubscribe();
      sessions.delete(ws);
    });
    ws.on('error', () => {
      closed = true;
      unsubscribe();
      sessions.delete(ws);
    });
  };

  server.on('upgrade', onUpgrade);

  const heartbeat = setInterval(() => {
    for (const ws of sessions.keys()) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      if (stillAuthorized.get(ws)?.() === false) {
        ws.close(UNAUTHORIZED_CLOSE, 'session expired');
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    closeSession(sessionId: string) {
      for (const [ws, sid] of sessions) {
        if (sid === sessionId) ws.close(UNAUTHORIZED_CLOSE, 'logged out');
      }
    },
    close() {
      clearInterval(heartbeat);
      server.off('upgrade', onUpgrade);
      for (const ws of sessions.keys()) ws.terminate();
      for (const ws of waiting) ws.terminate();
      sessions.clear();
      waiting.clear();
      wss.close();
    },
    get clientCount() {
      return sessions.size;
    },
  };
}
