import { StreamMessageSchema, type LogEvent } from '@monsters/shared';
import { parseEvents } from './api.ts';
import type { SocketLike, Transport } from './transport.ts';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface StreamHandlers {
  onHello(halted: boolean): void;
  onEvent(event: LogEvent): void;
  onState(state: ConnectionState): void;
  /** The core closed the stream because the session is no longer valid. */
  onUnauthorized(): void;
  /** Several reconnections failed in a row: the app may check the session. */
  onTrouble?(): void;
}

export interface StreamOptions {
  /** Id of the last event already known; the core replays what came after it. */
  cursor(): string | undefined;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
}

/** Codes the core uses to end a stream for auth reasons (see core/server/stream.ts). */
const AUTH_CLOSE_CODES = new Set([4401, 1008]);

/** Backoff delay for the n-th reconnection attempt (0-based), with ±30% jitter. */
export function backoffDelay(attempt: number, base = 500, max = 10_000, rnd = Math.random) {
  const raw = Math.min(max, base * 2 ** attempt);
  return Math.round(raw * (0.7 + 0.6 * rnd()));
}

/**
 * Live connection to `/api/stream` with automatic reconnection. Each reconnection
 * passes `?after=<last event id>` so nothing is lost and nothing is duplicated.
 */
export class StreamClient {
  private socket: SocketLike | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = true;
  private readonly transport: Transport;
  private readonly handlers: StreamHandlers;
  private readonly opts: StreamOptions;

  constructor(transport: Transport, handlers: StreamHandlers, opts: StreamOptions) {
    this.transport = transport;
    this.handlers = handlers;
    this.opts = opts;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = null;
      s.onmessage = null;
      s.onerror = null;
      s.onopen = null;
      s.close(1000, 'bye');
    }
    this.handlers.onState('closed');
  }

  /**
   * "Riprova adesso": skips the wait of the backoff and tries to connect at once. Nothing happens
   * while a socket is already open or being opened.
   */
  retryNow(): void {
    if (this.stopped || this.socket) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.open();
  }

  private open(): void {
    if (this.stopped) return;
    const after = this.opts.cursor();
    this.handlers.onState(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let socket: SocketLike;
    try {
      socket = this.transport.connect(
        `/api/stream${after ? `?after=${encodeURIComponent(after)}` : ''}`,
      );
    } catch {
      this.schedule();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.handlers.onState('open');
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let json: unknown;
      try {
        json = JSON.parse(ev.data);
      } catch {
        return;
      }
      const msg = StreamMessageSchema.safeParse(json);
      if (!msg.success) {
        // A newer event type the UI does not know yet: try the event alone.
        const raw = (json as { kind?: unknown; event?: unknown } | null) ?? null;
        if (raw?.kind === 'event')
          for (const e of parseEvents([raw.event])) this.handlers.onEvent(e);
        return;
      }
      const m = msg.data;
      if (m.kind === 'hello') this.handlers.onHello(m.halted);
      else if (m.kind === 'event') {
        const [e] = parseEvents([m.event]);
        if (e) this.handlers.onEvent(e);
      }
    };
    socket.onerror = () => {};
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stopped) return;
      if (AUTH_CLOSE_CODES.has(ev.code)) {
        this.stopped = true;
        this.handlers.onState('closed');
        this.handlers.onUnauthorized();
        return;
      }
      this.schedule();
    };
  }

  private schedule(): void {
    if (this.stopped) return;
    this.handlers.onState('reconnecting');
    const delay = backoffDelay(
      this.attempt,
      this.opts.baseDelayMs,
      this.opts.maxDelayMs,
      this.opts.random,
    );
    this.attempt++;
    if (this.attempt === 3) this.handlers.onTrouble?.();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.open();
    }, delay);
  }
}
