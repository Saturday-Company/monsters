/*
 * Shared request budget for one provider (DECISIONS D-004). Every agent using
 * the provider goes through the same budget: when a limit is reached requests
 * wait in a FIFO queue instead of failing. Limits come from configuration
 * (sliding windows, or the UTC day), from the provider's rate-limit headers and
 * from the provider's own daily counter when it has one.
 */

export interface RateLimitWindow {
  /** Max requests inside the window. */
  limit: number;
  windowMs: number;
  /**
   * `sliding` (default): the last `windowMs`. `utc-day`: the calendar day, reset
   * at midnight UTC (OpenRouter's daily quota); `windowMs` should be `DAY_MS`.
   */
  reset?: 'sliding' | 'utc-day';
}

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;
/** How long to wait before asking again for the provider's daily count after an expiry. */
const QUOTA_REASK_MS = 10 * MINUTE_MS;

export interface RateBudgetOptions {
  /** Provider id, for messages. */
  id: string;
  windows?: RateLimitWindow[];
  /**
   * A request that would wait longer than this fails with `RateLimitedError`
   * (e.g. the daily quota is gone): queueing for hours helps nobody. Default 2 min.
   */
  maxWaitMs?: number;
  /** Block applied after a 429 without any reset hint. Default 0 (none). */
  defaultBackoffMs?: number;
  /**
   * What the provider's rate-limit headers are about. `account` (default): the
   * whole provider waits (OpenRouter, Mistral). `model`: the limits are per
   * model (OpenAI, Anthropic, Groq, Google), so an exhausted limit or a 429
   * holds back only the model that reported it and the others keep going.
   */
  limitScope?: 'account' | 'model';
  /**
   * Which models the windows count (default all). OpenRouter's windows are
   * the limits of its free models: a paid request neither waits for them nor
   * uses them up (D-082).
   */
  counts?: (model: string) => boolean;
  /**
   * Called (without waiting) the first time a request arrives after the
   * provider's daily count (`syncDailyQuota`) has expired at midnight UTC, so the
   * owner can read the new day's count. The limit it reported stays in force
   * meanwhile. Must not throw.
   */
  onDailyQuotaExpired?: () => void;
  now?: () => number;
}

export interface RateBudgetSnapshot {
  id: string;
  /** Requests waiting in the queue. */
  queued: number;
  /** Last values reported by the provider headers. */
  limit?: number;
  remaining?: number;
  resetAt?: number;
  /** Until when requests are held because of headers or a 429. */
  blockedUntil?: number;
  /** Models held back by their own limit, until when (epoch ms). */
  blockedModels?: Record<string, number>;
  windows: { limit: number; windowMs: number; used: number }[];
}

/** The provider's own count of the requests of the current UTC day. */
export interface DailyQuotaReport {
  /** Requests already counted by the provider today. */
  used: number;
  /** The provider's daily limit, when it reports one. */
  limit?: number;
  /**
   * `cap` (default): the reported limit can only lower the configured one.
   * `replace`: it is the limit (the configured one was only a default).
   */
  limitMode?: 'cap' | 'replace';
  /**
   * When the read started (epoch ms), taken before the call: requests granted
   * since then count on top of `used`. Default: now. A report whose read started
   * on an earlier UTC day than now is dropped (no telling which day it counted).
   */
  at?: number;
}

/** Requests made before this budget existed, e.g. by a previous process (read from the event log). */
export interface RateBudgetHistory {
  /** Times (epoch ms) of past requests, any order. */
  granted: readonly number[];
}

/** The budget cannot serve the request in an acceptable time. */
export class RateLimitedError extends Error {
  readonly provider: string;
  readonly retryAt: number | undefined;
  constructor(provider: string, message: string, retryAt?: number) {
    super(message);
    this.name = 'RateLimitedError';
    this.provider = provider;
    this.retryAt = retryAt;
  }
}

export type HeaderBag = Record<string, string | undefined> | Headers | undefined;

function header(headers: HeaderBag, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === lower) return v;
  return undefined;
}

function toNumber(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Normalizes a reset value to an epoch in ms. Providers use epoch ms
 * (OpenRouter), epoch seconds, seconds from now, durations (`1m30s`, OpenAI and
 * Groq) or RFC 3339 dates (Anthropic).
 */
export function parseResetValue(raw: string | undefined, now: number): number | undefined {
  const n = toNumber(raw);
  if (n === undefined) {
    if (raw === undefined || raw.trim() === '') return undefined;
    const text = raw.trim();
    // Durations like "1m30s" / "2.5s" (Groq, OpenAI style).
    const m = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:(\d+)ms)?$/.exec(text);
    if (m) {
      const ms =
        Number(m[1] ?? 0) * 3_600_000 +
        Number(m[2] ?? 0) * 60_000 +
        Number(m[3] ?? 0) * 1000 +
        Number(m[4] ?? 0);
      return now + ms;
    }
    // RFC 3339 dates (Anthropic).
    if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
      const date = Date.parse(text);
      return Number.isNaN(date) ? undefined : date;
    }
    return undefined;
  }
  if (n > 1e12) return n; // epoch ms
  if (n > 1e9) return n * 1000; // epoch seconds
  return now + n * 1000; // seconds from now
}

/** `Retry-After`: seconds or an HTTP date. */
export function parseRetryAfter(raw: string | undefined, now: number): number | undefined {
  if (raw === undefined) return undefined;
  const n = toNumber(raw);
  if (n !== undefined) return now + Math.max(0, n) * 1000;
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : date;
}

/**
 * Retry hint in an error body, for providers that send no header: Google's
 * `RetryInfo` (`"retryDelay": "34s"`). Only the first 20 kB are scanned.
 */
export function parseRetryDelayBody(body: string | undefined, now: number): number | undefined {
  if (!body) return undefined;
  const m = /"retryDelay"\s*:\s*"(\d{1,7}(?:\.\d{1,9})?)s"/.exec(body.slice(0, 20_000));
  return m ? now + Number(m[1]) * 1000 : undefined;
}

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  resetAt?: number;
  retryAt?: number;
}

interface LimitDimension {
  /** A request count (what the snapshot shows) rather than a token count. */
  requests: boolean;
  limit?: number;
  remaining?: number;
  resetAt?: number;
}

/*
 * The rate-limit header families we know. Each provider reports one or more
 * dimensions (requests, tokens, input/output tokens): the budget only needs to
 * know whether one of them is exhausted, and until when.
 *   OpenRouter     x-ratelimit-{limit,remaining,reset}
 *   OpenAI, Groq   x-ratelimit-{limit,remaining,reset}-{requests,tokens}
 *   Anthropic      anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-{limit,remaining,reset}
 *   Mistral        ratelimitbysize-{limit,remaining,reset}, x-ratelimitbysize-{limit,remaining}-minute
 *                  (names from third parties, not from Mistral's docs: unknown names are ignored)
 * Google sends none (see `parseRetryDelayBody`); local servers send none.
 */
const DIMENSIONS: { requests: boolean; limit: string; remaining: string; reset?: string }[] = [
  {
    requests: true,
    limit: 'x-ratelimit-limit',
    remaining: 'x-ratelimit-remaining',
    reset: 'x-ratelimit-reset',
  },
  {
    requests: true,
    limit: 'x-ratelimit-limit-requests',
    remaining: 'x-ratelimit-remaining-requests',
    reset: 'x-ratelimit-reset-requests',
  },
  {
    requests: false,
    limit: 'x-ratelimit-limit-tokens',
    remaining: 'x-ratelimit-remaining-tokens',
    reset: 'x-ratelimit-reset-tokens',
  },
  ...['requests', 'tokens', 'input-tokens', 'output-tokens'].map((d) => ({
    requests: d === 'requests',
    limit: `anthropic-ratelimit-${d}-limit`,
    remaining: `anthropic-ratelimit-${d}-remaining`,
    reset: `anthropic-ratelimit-${d}-reset`,
  })),
  {
    requests: false,
    limit: 'ratelimitbysize-limit',
    remaining: 'ratelimitbysize-remaining',
    reset: 'ratelimitbysize-reset',
  },
  {
    requests: false,
    limit: 'x-ratelimitbysize-limit-minute',
    remaining: 'x-ratelimitbysize-remaining-minute',
  },
];

/**
 * Reads the rate-limit headers of any supported provider. When a dimension is
 * exhausted the result describes it (remaining 0, the latest reset among the
 * exhausted ones); otherwise it describes the request dimension.
 */
export function parseRateLimitHeaders(headers: HeaderBag, now: number): RateLimitInfo {
  const info: RateLimitInfo = {};
  const dims: LimitDimension[] = [];
  for (const d of headers ? DIMENSIONS : []) {
    const limit = toNumber(header(headers, d.limit));
    const remaining = toNumber(header(headers, d.remaining));
    const resetAt = d.reset ? parseResetValue(header(headers, d.reset), now) : undefined;
    if (limit === undefined && remaining === undefined && resetAt === undefined) continue;
    const dim: LimitDimension = { requests: d.requests };
    if (limit !== undefined) dim.limit = limit;
    if (remaining !== undefined) dim.remaining = remaining;
    if (resetAt !== undefined) dim.resetAt = resetAt;
    dims.push(dim);
  }
  const exhausted = dims.filter((d) => d.remaining !== undefined && d.remaining <= 0);
  const requests = dims.filter((d) => d.requests);
  const pick = exhausted.length > 0 ? exhausted : requests.length > 0 ? requests : dims;
  const first = pick[0];
  if (first) {
    if (first.limit !== undefined) info.limit = first.limit;
    if (first.remaining !== undefined) info.remaining = exhausted.length > 0 ? 0 : first.remaining;
    const resets = (exhausted.length > 0 ? exhausted : [first])
      .map((d) => d.resetAt)
      .filter((r): r is number => r !== undefined);
    if (resets.length > 0) info.resetAt = Math.max(...resets);
  }
  const retryAt = parseRetryAfter(header(headers, 'retry-after'), now);
  if (retryAt !== undefined) info.retryAt = retryAt;
  return info;
}

interface Waiter {
  resolve: (waitedMs: number) => void;
  reject: (err: unknown) => void;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
  enqueuedAt: number;
  /** Had to wait for a slot (otherwise the reported wait is 0). */
  waited: boolean;
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  const err = new Error(typeof reason === 'string' ? reason : 'aborted');
  err.name = 'AbortError';
  return err;
}

export class RateBudget {
  readonly id: string;
  readonly #windows: RateLimitWindow[];
  readonly #maxWaitMs: number;
  readonly #defaultBackoffMs: number;
  readonly #now: () => number;
  /** When this budget started counting: earlier requests can only come from `restore`. */
  readonly #createdAt: number;
  /** Start times of granted requests, oldest first (kept for the largest window). */
  #granted: number[] = [];
  /** Requests made before `#createdAt`, oldest first (see `restore`). */
  #history: number[] = [];
  /** Last daily count reported by the provider, valid until the next UTC midnight. */
  #quota: { used: number; at: number; until: number; askedAt: number } | null = null;
  /**
   * The daily limit the provider reported. Unlike the count it belongs to the
   * account, not to the day, so it outlives the midnight reset until a newer
   * report replaces it (forgetting it sent the budget back to the configured
   * default, 50 on an account that is allowed 1000).
   */
  #accountLimit: { limit: number; replace: boolean } | null = null;
  readonly #onDailyQuotaExpired: (() => void) | null;
  #queue: Waiter[] = [];
  #pumping = false;
  #wake: AbortController = new AbortController();
  #blockedUntil = 0;
  /** Models held back by a 429 that concerned only them (Retry-After). */
  readonly #modelBlockedUntil = new Map<string, number>();
  #last: RateLimitInfo = {};
  readonly #perModel: boolean;
  readonly #counts: ((model: string) => boolean) | null;

  constructor(options: RateBudgetOptions) {
    this.id = options.id;
    this.#windows = (options.windows ?? []).filter((w) => w.limit > 0 && w.windowMs > 0);
    this.#maxWaitMs = options.maxWaitMs ?? 120_000;
    this.#defaultBackoffMs = options.defaultBackoffMs ?? 0;
    this.#perModel = options.limitScope === 'model';
    this.#counts = options.counts ?? null;
    this.#onDailyQuotaExpired = options.onDailyQuotaExpired ?? null;
    this.#now = options.now ?? Date.now;
    this.#createdAt = this.#now();
  }

  /**
   * Seeds the windows with requests made before this budget existed, so a
   * restart does not forget the quota already spent. Replaces any previous
   * restore (calling it twice never counts twice); times outside every window,
   * and times not earlier than the budget's creation (those requests went
   * through this budget already), are ignored. Returns how many were kept.
   */
  restore(history: RateBudgetHistory): number {
    const now = this.#now();
    const cutoff = now - this.#longestWindow();
    this.#history = history.granted
      .filter((t) => Number.isFinite(t) && t > cutoff && t < this.#createdAt && t <= now)
      .sort((a, b) => a - b);
    this.#kick();
    return this.#history.length;
  }

  /**
   * Waits for a slot and records the request. Resolves with the time spent in
   * the queue; rejects with the signal reason on abort, or `RateLimitedError`
   * when the wait would exceed `maxWaitMs`.
   */
  acquire(signal?: AbortSignal, model?: string): Promise<number> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    this.#noticeQuotaExpiry();
    const modelWait = model !== undefined ? this.modelWaitTime(model) : 0;
    if (model !== undefined && !this.counts(model)) {
      // Outside the windows: only its own 429 holds it back.
      return modelWait > 0 ? this.#waitOnly(modelWait, signal) : Promise.resolve(0);
    }
    if (modelWait > 0) return this.#acquireAfter(modelWait, signal);
    return this.#enqueue(signal);
  }

  /** The windows count requests to this model (see `RateBudgetOptions.counts`). */
  counts(model: string): boolean {
    return this.#counts === null || this.#counts(model);
  }

  async #waitOnly(wait: number, signal: AbortSignal | undefined): Promise<number> {
    if (wait > this.#maxWaitMs) {
      throw new RateLimitedError(
        this.id,
        `rate limit of ${this.id} reached for this model: retry in ${Math.ceil(wait / 1000)} s`,
        this.#now() + wait,
      );
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortReason(signal!));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, wait);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    return wait;
  }

  /** Milliseconds until a model held back by its own 429 may be asked again (0 = now). */
  modelWaitTime(model: string): number {
    const until = this.#modelBlockedUntil.get(model);
    if (until === undefined) return 0;
    const wait = until - this.#now();
    if (wait <= 0) this.#modelBlockedUntil.delete(model);
    return Math.max(0, wait);
  }

  async #acquireAfter(wait: number, signal: AbortSignal | undefined): Promise<number> {
    if (wait > this.#maxWaitMs) {
      throw new RateLimitedError(
        this.id,
        `rate limit of ${this.id} reached for this model: retry in ${Math.ceil(wait / 1000)} s`,
        this.#now() + wait,
      );
    }
    const start = this.#now();
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortReason(signal!));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, wait);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    const queued = await this.#enqueue(signal);
    return queued + (this.#now() - start);
  }

  #enqueue(signal: AbortSignal | undefined): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        signal,
        onAbort: undefined,
        enqueuedAt: this.#now(),
        waited: false,
      };
      if (signal) {
        waiter.onAbort = () => {
          this.#remove(waiter);
          reject(abortReason(signal));
          this.#kick();
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.#queue.push(waiter);
      void this.#pump();
    });
  }

  /**
   * The provider's own count for the current UTC day (e.g. OpenRouter's
   * `free_model_daily_requests`). The `utc-day` windows count `used` plus the
   * requests granted since the read started, instead of the log: the provider
   * knows exactly what its key spent, the log may hold requests of another key.
   * The provider's `limit` caps or replaces the configured one (`limitMode`).
   * The count expires at the next midnight UTC (`onDailyQuotaExpired` asks for
   * a new one); the limit stays until a newer report replaces it. One read across
   * midnight is dropped. Returns false when the report is not used.
   */
  syncDailyQuota(report: DailyQuotaReport): boolean {
    if (!Number.isFinite(report.used) || report.used < 0) return false;
    const now = this.#now();
    const at = report.at ?? now;
    if (utcDayStart(at) !== utcDayStart(now)) return false;
    this.#quota = { used: report.used, at, until: utcDayStart(at) + DAY_MS, askedAt: 0 };
    if (report.limit !== undefined && report.limit > 0)
      this.#accountLimit = { limit: report.limit, replace: report.limitMode === 'replace' };
    this.#kick();
    return true;
  }

  /**
   * Tells the owner that the count it gave has expired at midnight UTC; asked
   * again after `QUOTA_REASK_MS` when no newer report came (its read failed).
   */
  #noticeQuotaExpiry(): void {
    const q = this.#quota;
    const now = this.#now();
    if (!q || now < q.until || now - q.askedAt < QUOTA_REASK_MS) return;
    q.askedAt = now;
    this.#onDailyQuotaExpired?.();
  }

  /**
   * Updates the budget from response headers (success or error). With `model`,
   * a 429 whose Retry-After is not about the account (quota left or unknown)
   * holds back only that model: the other models of the provider keep going.
   * With `limitScope: 'model'` every block (exhausted limit or 429) is about
   * the model. `body` is the error body, read for retry hints without headers.
   */
  update(headers: HeaderBag, status?: number, model?: string, body?: string): void {
    const now = this.#now();
    const info = parseRateLimitHeaders(headers, now);
    if (info.retryAt === undefined && status === 429) {
      const fromBody = parseRetryDelayBody(body, now);
      if (fromBody !== undefined) info.retryAt = fromBody;
    }
    if (Object.keys(info).length > 0) this.#last = { ...this.#last, ...info };
    if (this.#perModel && model !== undefined) {
      let until = info.retryAt ?? 0;
      if (info.remaining !== undefined && info.remaining <= 0 && info.resetAt !== undefined)
        until = Math.max(until, info.resetAt);
      else if (status === 429 && until === 0 && info.resetAt !== undefined) until = info.resetAt;
      else if (status === 429 && until === 0 && this.#defaultBackoffMs > 0)
        until = now + this.#defaultBackoffMs;
      const prev = this.#modelBlockedUntil.get(model) ?? 0;
      if (until > prev) this.#modelBlockedUntil.set(model, until);
      return;
    }
    const accountExhausted = info.remaining !== undefined && info.remaining <= 0;
    if (status === 429 && model !== undefined && info.retryAt !== undefined && !accountExhausted) {
      const prev = this.#modelBlockedUntil.get(model) ?? 0;
      if (info.retryAt > prev) this.#modelBlockedUntil.set(model, info.retryAt);
      return;
    }
    // A 429 while the account still has quota left is about one model (e.g. an
    // upstream provider of a free model): the fallback handles it, the budget stays open.
    const accountLimited = info.remaining === undefined || info.remaining <= 0;
    let until = 0;
    if (info.retryAt !== undefined) until = info.retryAt;
    else if (info.remaining !== undefined && info.remaining <= 0 && info.resetAt !== undefined)
      until = info.resetAt;
    else if (status === 429 && accountLimited && info.resetAt !== undefined) until = info.resetAt;
    else if (status === 429 && accountLimited && this.#defaultBackoffMs > 0)
      until = now + this.#defaultBackoffMs;
    if (until > this.#blockedUntil) {
      this.#blockedUntil = until;
      this.#kick();
    }
  }

  /** Rejects every queued request (kill switch, shutdown). */
  clear(reason: unknown = new DOMException('rate budget cleared', 'AbortError')): void {
    const waiters = this.#queue.splice(0);
    for (const w of waiters) {
      this.#detach(w);
      w.reject(reason);
    }
    this.#kick();
  }

  snapshot(): RateBudgetSnapshot {
    const now = this.#now();
    const snap: RateBudgetSnapshot = {
      id: this.id,
      queued: this.#queue.length,
      windows: this.#windows.map((w) => {
        const { used, limit } = this.#count(w, now);
        return { limit, windowMs: w.windowMs, used };
      }),
    };
    if (this.#last.limit !== undefined) snap.limit = this.#last.limit;
    if (this.#last.remaining !== undefined) snap.remaining = this.#last.remaining;
    if (this.#last.resetAt !== undefined) snap.resetAt = this.#last.resetAt;
    if (this.#blockedUntil > now) snap.blockedUntil = this.#blockedUntil;
    const models = [...this.#modelBlockedUntil].filter(([, until]) => until > now);
    if (models.length > 0) snap.blockedModels = Object.fromEntries(models);
    return snap;
  }

  /** Milliseconds until the next request may start (0 = now). */
  waitTime(): number {
    const now = this.#now();
    let until = this.#blockedUntil;
    for (const w of this.#windows) {
      const { freeAt } = this.#count(w, now);
      if (freeAt > until) until = freeAt;
    }
    return Math.max(0, until - now);
  }

  /** Requests counted by a window, its effective limit, and when it frees a slot (0 = now). */
  #count(w: RateLimitWindow, now: number): { used: number; limit: number; freeAt: number } {
    const times = this.#times();
    if (w.reset !== 'utc-day') {
      const inWindow = times.filter((t) => t > now - w.windowMs);
      const freeAt =
        inWindow.length >= w.limit ? inWindow[inWindow.length - w.limit]! + w.windowMs : 0;
      return { used: inWindow.length, limit: w.limit, freeAt };
    }
    const start = utcDayStart(now);
    let used = times.filter((t) => t >= start).length;
    let limit = w.limit;
    const q = this.#quota;
    // The provider's count wins over the log; the log is the fallback without it
    // (and after midnight, until the new day's count is read).
    if (q && now < q.until) used = q.used + this.#granted.filter((t) => t >= q.at).length;
    const a = this.#accountLimit;
    if (a) limit = a.replace ? a.limit : Math.min(limit, a.limit);
    return { used, limit, freeAt: used >= limit ? start + DAY_MS : 0 };
  }

  async #pump(): Promise<void> {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      while (this.#queue.length > 0) {
        const wait = this.waitTime();
        if (wait === 0) {
          const w = this.#queue.shift()!;
          this.#detach(w);
          const now = this.#now();
          this.#record(now);
          w.resolve(w.waited ? now - w.enqueuedAt : 0);
          continue;
        }
        if (wait > this.#maxWaitMs) {
          const retryAt = this.#now() + wait;
          const err = new RateLimitedError(
            this.id,
            `rate limit of ${this.id} reached: next slot in ${Math.ceil(wait / 1000)} s`,
            retryAt,
          );
          for (const w of this.#queue.splice(0)) {
            this.#detach(w);
            w.reject(err);
          }
          break;
        }
        for (const w of this.#queue) w.waited = true;
        await this.#sleep(wait);
      }
    } finally {
      this.#pumping = false;
    }
  }

  #record(now: number): void {
    this.#granted.push(now);
    const cutoff = now - this.#longestWindow();
    this.#granted = dropUntil(this.#granted, cutoff);
    this.#history = dropUntil(this.#history, cutoff);
  }

  #longestWindow(): number {
    return Math.max(0, ...this.#windows.map((w) => w.windowMs));
  }

  /** Every request the windows count, oldest first (restored ones precede local ones). */
  #times(): number[] {
    return this.#history.length > 0 ? [...this.#history, ...this.#granted] : this.#granted;
  }

  #sleep(ms: number): Promise<void> {
    const wake = this.#wake.signal;
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wake.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      wake.addEventListener('abort', done, { once: true });
    });
  }

  /** Interrupts the current sleep so the queue is re-evaluated. */
  #kick(): void {
    this.#wake.abort();
    this.#wake = new AbortController();
  }

  #remove(w: Waiter): void {
    const i = this.#queue.indexOf(w);
    if (i >= 0) this.#queue.splice(i, 1);
  }

  #detach(w: Waiter): void {
    if (w.signal && w.onAbort) w.signal.removeEventListener('abort', w.onAbort);
  }
}

/** The sorted `times` without the leading ones at or before `cutoff`. */
function dropUntil(times: number[], cutoff: number): number[] {
  let drop = 0;
  while (drop < times.length && times[drop]! <= cutoff) drop++;
  return drop > 0 ? times.slice(drop) : times;
}

/** Midnight UTC of the day of `t`. */
export function utcDayStart(t: number): number {
  return Math.floor(t / DAY_MS) * DAY_MS;
}
