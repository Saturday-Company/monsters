import {
  STREAM_HEARTBEAT_MS,
  StreamMessageSchema,
  ULID_REGEX,
  type LogEvent,
} from '@monsters/shared';
import { parseEvents } from './api.ts';
import type { SocketLike, Transport } from './transport.ts';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface StreamHandlers {
  onHello(halted: boolean): void;
  onEvent(event: LogEvent): void;
  /**
   * The events the core replayed after the cursor, in one batch once the replay is done (or the
   * socket closed during it): thousands after a long time away would be as many renders one by
   * one. Without it they go to `onEvent`, one by one.
   */
  onReplay?(events: LogEvent[]): void;
  onState(state: ConnectionState): void;
  /** The core closed the stream because the session is no longer valid. */
  onUnauthorized(): void;
  /**
   * Reconnections keep failing: the app may check the session. Asked again while the outage lasts
   * (at most once per `TROUBLE_EVERY_MS`): an expired session shows at the upgrade as a plain
   * failure, and one check at the start of the outage is not enough if the core was still down.
   */
  onTrouble?(): void;
}

export interface StreamOptions {
  /** Id of the last event already known; the core replays what came after it. */
  cursor(): string | undefined;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
}

/** A cursor before every event id (ULIDs sort by time): the core replays its whole log. */
export const LOG_START = '0'.repeat(26);

/** Codes the core uses to end a stream for auth reasons (see core/server/stream.ts). */
const AUTH_CLOSE_CODES = new Set([4401, 1008]);

/** Silence of this many heartbeats of the core and the socket is called dead (sleep, Wi-Fi change). */
const SILENT_HEARTBEATS = 2.5;
/** While reconnecting keeps failing, the session is checked again at most this often. */
export const TROUBLE_EVERY_MS = 30_000;

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
  /** The open socket answered (`onopen`); one still being opened is left alone. */
  private opened = false;
  /** When the core was last heard on this socket, and the watchdog that ends a silent one. */
  private heardAt = 0;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  /** The core sends the application heartbeat: an older one does not, and its silence is normal. */
  private heartbeats = false;
  private troubleAt: number | null = null;
  /** The replay of this socket (it was opened with a cursor) until `replay_done`: its events. */
  private replay: LogEvent[] | null = null;
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
    this.troubleAt = null;
    this.listen(true);
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listen(false);
    this.discard(1000, 'bye');
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

  /** Hands over the events of the replay gathered so far. */
  private endReplay(): void {
    const events = this.replay;
    this.replay = null;
    if (!events?.length) return;
    if (this.handlers.onReplay) this.handlers.onReplay(events);
    else for (const e of events) this.handlers.onEvent(e);
  }

  /** An event of the core: gathered while the replay lasts, else handed over at once. */
  private deliver(e: LogEvent): void {
    if (this.replay) this.replay.push(e);
    else this.handlers.onEvent(e);
  }

  /** Lets go of the current socket without its handlers firing, and of its watchdog. */
  private discard(code: number, reason: string): void {
    // What the replay brought before the socket went is real: it is not lost with the socket.
    if (this.stopped) this.replay = null;
    else this.endReplay();
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.opened = false;
    this.heartbeats = false;
    const s = this.socket;
    this.socket = null;
    if (!s) return;
    s.onclose = null;
    s.onmessage = null;
    s.onerror = null;
    s.onopen = null;
    try {
      s.close(code, reason);
    } catch {
      // already closed
    }
  }

  /**
   * A socket that stopped answering without a close (laptop asleep, Wi-Fi changed: the TCP is half
   * open and the browser says nothing): given up, and the connection starts again.
   */
  private declareDead(now: boolean): void {
    if (this.stopped || !this.socket) return;
    this.discard(4000, 'silent');
    this.schedule();
    if (now) this.retryNow();
  }

  /** (Re)arms the watchdog once the core has shown that it sends heartbeats. */
  private armWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    if (!this.heartbeats) return;
    this.watchdog = setTimeout(
      () => this.declareDead(false),
      STREAM_HEARTBEAT_MS * SILENT_HEARTBEATS,
    );
  }

  private readonly onNetworkBack = () => this.wake(true);
  private readonly onVisibility = () => {
    if (globalThis.document?.visibilityState === 'visible') this.wake(false);
  };

  private listen(on: boolean): void {
    const target = globalThis as Partial<EventTarget>;
    const doc = globalThis.document as Partial<EventTarget> | undefined;
    if (on) {
      target.addEventListener?.('online', this.onNetworkBack);
      doc?.addEventListener?.('visibilitychange', this.onVisibility);
    } else {
      target.removeEventListener?.('online', this.onNetworkBack);
      doc?.removeEventListener?.('visibilitychange', this.onVisibility);
    }
  }

  /**
   * The network came back or the page was brought back: the wait of the backoff is skipped, and a
   * socket that looks open is not trusted if the network changed or it has been silent for longer
   * than a heartbeat (it may have died while the page was asleep and its timers did not run).
   */
  private wake(networkChanged: boolean): void {
    if (this.stopped) return;
    if (!this.socket) {
      this.retryNow();
      return;
    }
    if (!this.opened) return;
    const silentFor = Date.now() - this.heardAt;
    if (networkChanged || (this.heartbeats && silentFor > STREAM_HEARTBEAT_MS * 1.5)) {
      this.declareDead(true);
    }
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
    // The core replays (and ends with `replay_done`) only after a cursor it takes for an id.
    this.replay = after && ULID_REGEX.test(after) ? [] : null;
    socket.onopen = () => {
      this.attempt = 0;
      this.troubleAt = null;
      this.opened = true;
      this.heardAt = Date.now();
      this.handlers.onState('open');
    };
    socket.onmessage = (ev) => {
      // Anything from the core shows the socket alive, not only the heartbeat.
      this.heardAt = Date.now();
      this.armWatchdog();
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
        if (raw?.kind === 'event') for (const e of parseEvents([raw.event])) this.deliver(e);
        return;
      }
      const m = msg.data;
      if (m.kind === 'ping') {
        this.heartbeats = true;
        this.armWatchdog();
      } else if (m.kind === 'hello') this.handlers.onHello(m.halted);
      else if (m.kind === 'replay_done') this.endReplay();
      else if (m.kind === 'event') {
        const [e] = parseEvents([m.event]);
        if (e) this.deliver(e);
      }
    };
    socket.onerror = () => {};
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.discard(1000, 'closed');
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
    const now = Date.now();
    if (
      this.attempt >= 3 &&
      (this.troubleAt === null || now - this.troubleAt >= TROUBLE_EVERY_MS)
    ) {
      this.troubleAt = now;
      this.handlers.onTrouble?.();
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.open();
    }, delay);
  }
}
