import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  MINUTE_MS,
  parseRateLimitHeaders,
  parseResetValue,
  RateBudget,
  RateLimitedError,
} from '../src/index.ts';

describe('rate limit headers', () => {
  const now = 1_800_000_000_000;

  it('reads OpenRouter headers (reset in epoch ms)', () => {
    const info = parseRateLimitHeaders(
      {
        'X-RateLimit-Limit': '20',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(now + 5000),
      },
      now,
    );
    expect(info).toEqual({ limit: 20, remaining: 0, resetAt: now + 5000 });
  });

  it('understands Retry-After in seconds and as a date, and reset durations', () => {
    expect(parseRateLimitHeaders({ 'retry-after': '3' }, now).retryAt).toBe(now + 3000);
    const date = new Date(now + 60_000).toUTCString();
    expect(parseRateLimitHeaders(new Headers({ 'retry-after': date }), now).retryAt).toBe(
      now + 60_000,
    );
    expect(parseResetValue('1m30s', now)).toBe(now + 90_000);
    expect(parseResetValue('250ms', now)).toBe(now + 250);
    expect(parseResetValue(String((now + 2000) / 1000), now)).toBe(now + 2000);
    expect(parseResetValue('7', now)).toBe(now + 7000);
    expect(parseResetValue('soon', now)).toBeUndefined();
  });
});

describe('RateBudget', () => {
  it('windows that count only some models: the others neither wait nor use them up', async () => {
    const budget = new RateBudget({
      id: 'openrouter',
      windows: [{ limit: 1, windowMs: DAY_MS }],
      counts: (m) => m.endsWith(':free'),
    });
    expect(await budget.acquire(undefined, 'qwen/x:free')).toBeLessThan(20);
    // The free quota is gone, a paid model goes at once and many times.
    for (let i = 0; i < 5; i++) expect(await budget.acquire(undefined, 'qwen/paid')).toBe(0);
    expect(budget.snapshot().windows[0]!.used).toBe(1);
    expect(budget.counts('qwen/paid')).toBe(false);
    await expect(budget.acquire(undefined, 'qwen/y:free')).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('queues the second request until the window frees a slot', async () => {
    const budget = new RateBudget({ id: 'p', windows: [{ limit: 1, windowMs: 150 }] });
    const t0 = Date.now();
    expect(await budget.acquire()).toBeLessThan(20);
    const second = budget.acquire();
    expect(budget.snapshot().queued).toBe(1);
    const waited = await second;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
    expect(waited).toBeGreaterThanOrEqual(140);
  });

  it('holds requests until the reset announced by the headers', async () => {
    const budget = new RateBudget({ id: 'p' });
    await budget.acquire();
    budget.update({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Date.now() + 120) });
    expect(budget.snapshot().blockedUntil).toBeDefined();
    const t0 = Date.now();
    await budget.acquire();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });

  it('honours Retry-After on a 429', async () => {
    const budget = new RateBudget({ id: 'p' });
    budget.update({ 'retry-after': '0.1' }, 429);
    const t0 = Date.now();
    await budget.acquire();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
  });

  it('fails fast when the wait exceeds maxWaitMs (e.g. daily quota gone)', async () => {
    const budget = new RateBudget({
      id: 'openrouter',
      windows: [{ limit: 1, windowMs: 86_400_000 }],
      maxWaitMs: 1000,
    });
    await budget.acquire();
    const err = await budget.acquire().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAt).toBeGreaterThan(Date.now());
  });

  it('removes an aborted request from the queue and keeps serving the others', async () => {
    const budget = new RateBudget({ id: 'p', windows: [{ limit: 1, windowMs: 100 }] });
    await budget.acquire();
    const ac = new AbortController();
    const aborted = budget.acquire(ac.signal);
    const next = budget.acquire();
    ac.abort(new Error('killed'));
    await expect(aborted).rejects.toThrow('killed');
    await expect(next).resolves.toBeGreaterThanOrEqual(0);
    expect(budget.snapshot().queued).toBe(0);
  });

  it('rejects immediately with an already aborted signal', async () => {
    const budget = new RateBudget({ id: 'p' });
    await expect(budget.acquire(AbortSignal.abort(new Error('stop')))).rejects.toThrow('stop');
  });

  it('clear() rejects every queued request (kill switch)', async () => {
    const budget = new RateBudget({ id: 'p', windows: [{ limit: 1, windowMs: 10_000 }] });
    await budget.acquire();
    const a = budget.acquire();
    const b = budget.acquire();
    budget.clear(new Error('kill'));
    await expect(a).rejects.toThrow('kill');
    await expect(b).rejects.toThrow('kill');
  });

  it('reports usage per window', async () => {
    const budget = new RateBudget({ id: 'p', windows: [{ limit: 20, windowMs: 60_000 }] });
    await budget.acquire();
    await budget.acquire();
    expect(budget.snapshot().windows).toEqual([{ limit: 20, windowMs: 60_000, used: 2 }]);
  });
});

describe('RateBudget after a restart (restore)', () => {
  const T0 = 1_800_000_000_000;
  const windows = [
    { limit: 3, windowMs: MINUTE_MS },
    { limit: 5, windowMs: DAY_MS },
  ];
  const clock = (start: number) => {
    const c = { t: start, now: () => c.t };
    return c;
  };
  const used = (b: RateBudget) => b.snapshot().windows.map((w) => w.used);

  it('a new budget seeded with the past requests keeps the minute and the day windows', async () => {
    const c = clock(T0);
    const before = new RateBudget({ id: 'p', windows, maxWaitMs: 1000, now: c.now });
    for (let i = 0; i < 3; i++) await before.acquire();
    const spent = [T0, T0, T0];

    // Restart 10 s later: the new budget knows nothing until it is restored.
    c.t = T0 + 10_000;
    const after = new RateBudget({ id: 'p', windows, maxWaitMs: 1000, now: c.now });
    expect(used(after)).toEqual([0, 0]);
    expect(after.restore({ granted: spent })).toBe(3);
    expect(used(after)).toEqual([3, 3]);
    // The minute is full: the next slot is 50 s away, beyond maxWaitMs.
    expect(after.waitTime()).toBe(50_000);
    await expect(after.acquire()).rejects.toBeInstanceOf(RateLimitedError);

    // A minute later the minute window is free, the day has 2 requests left.
    c.t = T0 + 61_000;
    await after.acquire();
    await after.acquire();
    expect(used(after)).toEqual([2, 5]);
    const err = await after.acquire().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAt).toBe(T0 + DAY_MS);
  });

  it('ignores requests outside every window, and future ones', () => {
    const c = clock(T0);
    const budget = new RateBudget({ id: 'p', windows, now: c.now });
    const kept = budget.restore({
      granted: [T0 - 2 * DAY_MS, T0 - DAY_MS, T0 - DAY_MS + 1, T0 - 30_000, T0 + 5000, NaN],
    });
    expect(kept).toBe(2);
    expect(used(budget)).toEqual([1, 2]);
    // A day later the restored requests have left the day window too.
    c.t = T0 + DAY_MS;
    expect(used(budget)).toEqual([0, 0]);
    expect(budget.waitTime()).toBe(0);
  });

  it('never counts a request twice', async () => {
    const c = clock(T0);
    const budget = new RateBudget({ id: 'p', windows, now: c.now });
    c.t = T0 + 1000;
    await budget.acquire();
    // The log also has this budget's own request (at or after its creation): not counted again.
    const past = [T0 - 5000, T0, T0 + 1000];
    expect(budget.restore({ granted: past })).toBe(1);
    expect(used(budget)).toEqual([2, 2]);
    // Restoring again replaces the previous restore instead of adding to it.
    expect(budget.restore({ granted: past })).toBe(1);
    expect(used(budget)).toEqual([2, 2]);
  });

  it('a day already spent before the restart refuses at once', async () => {
    const c = clock(T0);
    const budget = new RateBudget({
      id: 'p',
      windows: [{ limit: 1, windowMs: DAY_MS }],
      maxWaitMs: 1000,
      now: c.now,
    });
    c.t = T0 + 1;
    budget.restore({ granted: [T0 - 1000] });
    await expect(budget.acquire()).rejects.toBeInstanceOf(RateLimitedError);
  });
});

describe('RateBudget daily window on the UTC day and the provider counter', () => {
  const MIDNIGHT = Math.floor(1_800_000_000_000 / DAY_MS) * DAY_MS + DAY_MS;
  const day = (limit: number) => [{ limit, windowMs: DAY_MS, reset: 'utc-day' as const }];
  const used = (b: RateBudget) => b.snapshot().windows.map((w) => [w.used, w.limit]);

  it('frees the day at midnight UTC, not 24 hours after the requests', async () => {
    const c = { t: MIDNIGHT - 3_600_000 };
    const budget = new RateBudget({ id: 'p', windows: day(2), maxWaitMs: 1000, now: () => c.t });
    await budget.acquire();
    await budget.acquire();
    const err = await budget.acquire().catch((e: unknown) => e);
    expect((err as RateLimitedError).retryAt).toBe(MIDNIGHT);
    c.t = MIDNIGHT;
    expect(used(budget)).toEqual([[0, 2]]);
    await budget.acquire();
    expect(used(budget)).toEqual([[1, 2]]);
  });

  it('the provider counter replaces the log, plus the requests granted since it was read', async () => {
    const c = { t: MIDNIGHT + 3_600_000 };
    const budget = new RateBudget({ id: 'p', windows: day(10), maxWaitMs: 1000, now: () => c.t });
    c.t += 1000;
    // Yesterday's request does not count; two today.
    budget.restore({ granted: [MIDNIGHT - 1000, MIDNIGHT + 10, MIDNIGHT + 20] });
    expect(used(budget)).toEqual([[2, 10]]);
    budget.syncDailyQuota({ used: 6 });
    expect(used(budget)).toEqual([[6, 10]]);
    await budget.acquire();
    expect(used(budget)).toEqual([[7, 10]]);
    // A counter lower than the log wins too (e.g. the log holds another key's requests).
    c.t += 1000;
    budget.syncDailyQuota({ used: 0 });
    expect(used(budget)).toEqual([[0, 10]]);
    // A read started before a request counts it on top of the counter.
    const startedAt = c.t;
    c.t += 100;
    await budget.acquire();
    c.t += 100;
    budget.syncDailyQuota({ used: 0, at: startedAt });
    expect(used(budget)).toEqual([[1, 10]]);
  });

  it('drops a report read across midnight UTC', () => {
    const c = { t: MIDNIGHT - 100 };
    const budget = new RateBudget({ id: 'p', windows: day(50), maxWaitMs: 1000, now: () => c.t });
    const startedAt = c.t;
    c.t = MIDNIGHT + 300;
    budget.syncDailyQuota({ used: 5 });
    expect(used(budget)).toEqual([[5, 50]]);
    // Started yesterday, answered today: there is no telling which day it counted.
    budget.syncDailyQuota({ used: 50, limit: 50, at: startedAt });
    expect(used(budget)).toEqual([[5, 50]]);
    expect(budget.waitTime()).toBe(0);
  });

  it('respects a lower provider limit, and keeps it after midnight UTC when the count resets', async () => {
    const c = { t: MIDNIGHT - 60_000 };
    const budget = new RateBudget({ id: 'p', windows: day(50), maxWaitMs: 1000, now: () => c.t });
    budget.syncDailyQuota({ used: 20, limit: 20 });
    expect(used(budget)).toEqual([[20, 20]]);
    expect(budget.waitTime()).toBe(60_000);
    await expect(budget.acquire()).rejects.toBeInstanceOf(RateLimitedError);
    c.t = MIDNIGHT;
    // The count is gone, the account's limit is not.
    expect(used(budget)).toEqual([[0, 20]]);
    expect(budget.waitTime()).toBe(0);
  });

  it('does not forget a limit above the default at midnight UTC, and asks for the new count', async () => {
    const c = { t: MIDNIGHT - 60_000 };
    const asked: number[] = [];
    const budget = new RateBudget({
      id: 'p',
      windows: day(50),
      maxWaitMs: 1000,
      onDailyQuotaExpired: () => asked.push(c.t),
      now: () => c.t,
    });
    budget.syncDailyQuota({ used: 700, limit: 1000, limitMode: 'replace' });
    await budget.acquire();
    expect(used(budget)).toEqual([[701, 1000]]);
    expect(asked).toEqual([]);
    c.t = MIDNIGHT + 5000;
    // Before the new count arrives: the log of the new day, under the real limit.
    for (let i = 0; i < 60; i++) await budget.acquire();
    expect(used(budget)).toEqual([[60, 1000]]);
    expect(asked).toEqual([MIDNIGHT + 5000]);
    // A failed read is asked again later, not on every request.
    c.t += 60_000;
    await budget.acquire();
    expect(asked).toHaveLength(1);
    c.t += 10 * 60_000;
    await budget.acquire();
    expect(asked).toHaveLength(2);
    c.t += 1;
    budget.syncDailyQuota({ used: 100, limit: 1000, limitMode: 'replace' });
    await budget.acquire();
    expect(asked).toHaveLength(2);
    expect(used(budget)).toEqual([[101, 1000]]);
  });
});

describe('rate limit headers of every provider', () => {
  const now = 1_800_000_000_000;

  it('OpenAI and Groq: requests and tokens, durations as reset', () => {
    const ok = parseRateLimitHeaders(
      {
        'x-ratelimit-limit-requests': '1000',
        'x-ratelimit-remaining-requests': '998',
        'x-ratelimit-reset-requests': '1m26s',
        'x-ratelimit-limit-tokens': '8000',
        'x-ratelimit-remaining-tokens': '7000',
        'x-ratelimit-reset-tokens': '7.5s',
      },
      now,
    );
    expect(ok).toEqual({ limit: 1000, remaining: 998, resetAt: now + 86_000 });
    // Tokens exhausted: that dimension wins.
    const tokens = parseRateLimitHeaders(
      {
        'x-ratelimit-remaining-requests': '998',
        'x-ratelimit-limit-tokens': '8000',
        'x-ratelimit-remaining-tokens': '0',
        'x-ratelimit-reset-tokens': '7.5s',
      },
      now,
    );
    expect(tokens).toEqual({ limit: 8000, remaining: 0, resetAt: now + 7500 });
  });

  it('Anthropic: RFC 3339 resets, the latest exhausted one wins', () => {
    const info = parseRateLimitHeaders(
      {
        'anthropic-ratelimit-requests-limit': '50',
        'anthropic-ratelimit-requests-remaining': '0',
        'anthropic-ratelimit-requests-reset': new Date(now + 10_000).toISOString(),
        'anthropic-ratelimit-input-tokens-remaining': '0',
        'anthropic-ratelimit-input-tokens-reset': new Date(now + 40_000).toISOString(),
        'anthropic-ratelimit-output-tokens-remaining': '900',
        'retry-after': '12',
      },
      now,
    );
    expect(info).toEqual({ limit: 50, remaining: 0, resetAt: now + 40_000, retryAt: now + 12_000 });
  });

  it('Mistral: token budget by size', () => {
    const info = parseRateLimitHeaders(
      { 'x-ratelimitbysize-limit-minute': '500000', 'x-ratelimitbysize-remaining-minute': '0' },
      now,
    );
    expect(info).toEqual({ limit: 500000, remaining: 0 });
  });

  it('Google: the retry delay comes from the error body', () => {
    const budget = new RateBudget({ id: 'google', limitScope: 'model', now: () => now });
    budget.update(
      {},
      429,
      'gemini-x',
      '{"error":{"code":429,"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"34s"}]}}',
    );
    expect(budget.modelWaitTime('gemini-x')).toBe(34_000);
    expect(budget.waitTime()).toBe(0);
  });

  it('per-model limits hold back only the model, also on success headers', () => {
    const budget = new RateBudget({ id: 'openai', limitScope: 'model', now: () => now });
    budget.update(
      { 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '20s' },
      200,
      'gpt-a',
    );
    expect(budget.modelWaitTime('gpt-a')).toBe(20_000);
    expect(budget.modelWaitTime('gpt-b')).toBe(0);
    expect(budget.waitTime()).toBe(0);
    expect(budget.snapshot().blockedModels).toEqual({ 'gpt-a': now + 20_000 });
  });
});
