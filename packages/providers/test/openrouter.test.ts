import { streamText } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { setAppLang } from '@monsters/shared';
import {
  classifyProviderError,
  DAY_MS,
  KEY_ID_PATTERN,
  OpenRouterProvider,
  PaidModelBlockedError,
  ProviderRegistry,
  keyFingerprint,
  pricePerMillion,
  type SessionEvent,
} from '../src/index.ts';

const MODELS = {
  data: [
    {
      id: 'openrouter/free',
      context_length: 200000,
      supported_parameters: ['tools'],
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'nvidia/nemotron-3-super-120b-a12b:free',
      context_length: 262144,
      supported_parameters: ['tools', 'structured_outputs'],
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'liquid/lfm-2.5-2.6b:free',
      context_length: 65536,
      supported_parameters: ['temperature'],
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'anthropic/claude-sonnet-5.5',
      context_length: 1000000,
      supported_parameters: ['tools'],
      pricing: { prompt: '0.000003', completion: '0.000015' },
    },
  ],
};

function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function completion(model: string, text: string) {
  return [
    {
      id: 'gen-1',
      model,
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    },
    {
      id: 'gen-1',
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    },
  ];
}

describe('OpenRouterProvider', () => {
  it('lists models at runtime, filters tools and free, caches the result', async () => {
    let calls = 0;
    const provider = new OpenRouterProvider({
      apiKey: 'sk-or-test',
      fetch: (input) => {
        calls++;
        expect(String(input as string)).toBe('https://openrouter.ai/api/v1/models');
        return Promise.resolve(Response.json(MODELS));
      },
    });
    const freeWithTools = await provider.listModels({ tools: true, free: true });
    expect(freeWithTools.map((m) => m.id)).toEqual([
      'openrouter/free',
      'nvidia/nemotron-3-super-120b-a12b:free',
    ]);
    const paid = await provider.listModels({ free: false });
    expect(paid).toHaveLength(1);
    // Prices per million tokens (D-082: the cheapest model writes the summaries).
    expect(paid[0]!.price).toEqual({ input: 3, output: 15 });
    expect(pricePerMillion({ prompt: '-1', completion: '-1' })).toBeUndefined();
    expect(calls).toBe(1);
    await provider.listModels({ refresh: true });
    expect(calls).toBe(2);
  });

  it('pins the concrete free model the router answered with, never a paid one', () => {
    const provider = new OpenRouterProvider({ apiKey: 'k' });
    expect(provider.servedModelId('openrouter/free', 'upstage/solar-pro-3:free')).toBe(
      'upstage/solar-pro-3:free',
    );
    expect(provider.servedModelId('openrouter/free', 'upstage/solar-pro-3')).toBe(
      'upstage/solar-pro-3:free',
    );
    expect(provider.servedModelId('a/b:free', 'a/b:free')).toBeUndefined();
  });

  it('refuses paid models when limited to free ones, saying where, until paid models are turned on', () => {
    const provider = new OpenRouterProvider({ apiKey: 'k', freeOnly: true });
    expect(() => provider.model('anthropic/claude-sonnet-5.5')).toThrow(PaidModelBlockedError);
    expect(() => provider.model('anthropic/claude-sonnet-5.5')).toThrow(
      /paid model .*Also use paid models.* in Settings → Models \(OpenRouter\)/,
    );
    setAppLang('it');
    try {
      expect(() => provider.model('anthropic/claude-sonnet-5.5')).toThrow(
        /a pagamento .*Usa anche modelli a pagamento.* in Impostazioni → Modelli \(OpenRouter\)/,
      );
    } finally {
      setAppLang('en');
    }
    expect(classifyProviderError(new PaidModelBlockedError('x/y'))).toBe('paid_blocked');
    expect(() => provider.model('openrouter/free')).not.toThrow();
    expect(() => provider.model('a/b:free')).not.toThrow();
    // No restart, no new provider: the same one accepts paid models from now on.
    provider.setFreeOnly(false);
    expect(provider.freeOnly).toBe(false);
    expect(() => provider.model('anthropic/claude-sonnet-5.5')).not.toThrow();
    provider.setFreeOnly(true);
    expect(() => provider.model('anthropic/claude-sonnet-5.5')).toThrow(PaidModelBlockedError);
  });

  it('streams through the real provider, reads rate-limit headers and pins the served model', async () => {
    const bodies: { model: string }[] = [];
    const provider = new OpenRouterProvider({
      apiKey: 'sk-or-test',
      fetch: (_input, init) => {
        const body = JSON.parse(init?.body as string) as { model: string };
        bodies.push(body);
        if (body.model === 'nvidia/nemotron-3-super-120b-a12b:free') {
          const res = new Response(
            JSON.stringify({
              error: { message: 'Rate limit exceeded: free-models-per-min', code: 429 },
            }),
            {
              status: 429,
              headers: {
                'content-type': 'application/json',
                'x-ratelimit-limit': '20',
                'x-ratelimit-remaining': '5',
                'x-ratelimit-reset': String(Date.now() + 30_000),
              },
            },
          );
          return Promise.resolve(res);
        }
        return Promise.resolve(sse(completion('poolside/laguna-s-2.1:free', 'Ciao!')));
      },
    });
    const events: SessionEvent[] = [];
    const session = new ProviderRegistry().register(provider).session(
      [
        { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
        { provider: 'openrouter', model: 'openrouter/free' },
      ],
      { onEvent: (e) => events.push(e) },
    );
    const result = streamText({ model: session, prompt: 'ciao', maxRetries: 0 });
    expect(await result.text).toBe('Ciao!');
    expect(bodies.map((b) => b.model)).toEqual([
      'nvidia/nemotron-3-super-120b-a12b:free',
      'openrouter/free',
    ]);
    expect(session.pinned).toEqual({ provider: 'openrouter', model: 'poolside/laguna-s-2.1:free' });
    // Context compression off on every request: the core manages the context (C.2).
    for (const b of bodies) {
      expect((b as { plugins?: unknown }).plugins).toEqual([
        { id: 'context-compression', enabled: false },
      ]);
    }
    expect(provider.budget.snapshot()).toMatchObject({ limit: 20, remaining: 5 });
    expect(events.map((e) => e.type)).toEqual(['fallback', 'served', 'pinned']);
  });

  it('sends at most four cache breakpoints to Anthropic after four tool calls in parallel', async () => {
    // Collaudo of 17/10: a monster on Haiku read four notes at once and the next
    // step was refused ("A maximum of 4 blocks with cache_control… Found 5").
    const bodies: string[] = [];
    const provider = new OpenRouterProvider({
      apiKey: 'sk-or-test',
      freeOnly: false,
      fetch: (_input, init) => {
        bodies.push(init?.body as string);
        return Promise.resolve(sse(completion('anthropic/claude-haiku-5.5', 'Fatto.')));
      },
    });
    const session = new ProviderRegistry()
      .register(provider)
      .session([{ provider: 'openrouter', model: 'anthropic/claude-haiku-5.5' }]);
    const ids = ['a', 'b', 'c', 'd'];
    const result = streamText({
      model: session,
      system: 'Sei Vera.',
      maxRetries: 0,
      messages: [
        { role: 'user', content: 'Scrivi tre bozze.' },
        {
          role: 'assistant',
          content: ids.map((id) => ({
            type: 'tool-call' as const,
            toolCallId: id,
            toolName: 'vault_read',
            input: { path: `nota-${id}` },
          })),
        },
        {
          role: 'tool',
          content: ids.map((id) => ({
            type: 'tool-result' as const,
            toolCallId: id,
            toolName: 'vault_read',
            output: { type: 'text' as const, value: `testo ${id}` },
          })),
        },
      ],
    });
    expect(await result.text).toBe('Fatto.');
    const body = JSON.parse(bodies[0]!) as {
      messages: { role: string; tool_call_id?: string; cache_control?: unknown }[];
    };
    const marks = (bodies[0]!.match(/"cache_control"/g) ?? []).length;
    expect(marks).toBeLessThanOrEqual(4);
    // The system prompt, the user message (the end of the previous step) and the last result.
    expect(marks).toBe(3);
    // The breakpoint is on the last result: the whole step is read from the cache next time.
    const tools = body.messages.filter((m) => m.role === 'tool');
    expect(tools.map((m) => m.cache_control !== undefined)).toEqual([false, false, false, true]);
  });
});

describe('OpenRouter daily counter', () => {
  const KEY = 'sk-or-test-key';
  function provider(
    answer: () => Promise<Response>,
    freeOnly = true,
    limits: { rpd?: number; followAccountRpd?: boolean; now?: () => number } = {},
  ) {
    const seen: { url: string; auth: string | null }[] = [];
    const p = new OpenRouterProvider({
      apiKey: KEY,
      ...(limits.now ? { now: limits.now } : {}),
      freeOnly,
      rpd: limits.rpd ?? 50,
      ...(limits.followAccountRpd !== undefined
        ? { followAccountRpd: limits.followAccountRpd }
        : {}),
      fetch: (input, init) => {
        seen.push({
          url: input instanceof Request ? input.url : input.toString(),
          auth: new Headers(init?.headers).get('authorization'),
        });
        return answer();
      },
    });
    const day = () => p.budget.snapshot().windows.find((w) => w.windowMs === DAY_MS)!;
    return { p, seen, day };
  }

  it('reads free_model_daily_requests from /key and gives it to the budget', async () => {
    const { p, seen, day } = provider(() =>
      Promise.resolve(
        Response.json({
          data: {
            is_free_tier: true,
            free_model_daily_requests: { used: 42, limit: 50, remaining: 8 },
          },
        }),
      ),
    );
    expect(await p.syncDailyQuota()).toMatchObject({ used: 42, limit: 50 });
    expect(seen).toEqual([{ url: 'https://openrouter.ai/api/v1/key', auth: `Bearer ${KEY}` }]);
    expect(day()).toMatchObject({ used: 42, limit: 50 });
  });

  it('keeps the budget as it is when the call fails, times out or has no counter', async () => {
    const answers: (() => Promise<Response>)[] = [
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve(new Response('nope', { status: 500 })),
      () => Promise.resolve(Response.json({ data: { is_free_tier: true } })),
      () => Promise.resolve(new Response('not json', { status: 200 })),
    ];
    for (const answer of answers) {
      const { p, day } = provider(answer);
      expect(await p.syncDailyQuota()).toBeNull();
      expect(day().used).toBe(0);
    }
    const slow = provider(() => new Promise<Response>(() => {}));
    const started = Date.now();
    expect(await slow.p.syncDailyQuota({ timeoutMs: 50 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('takes the time before the call and drops a count read across midnight UTC', async () => {
    const MIDNIGHT = Math.floor(1_800_000_000_000 / DAY_MS) * DAY_MS + DAY_MS;
    const c = { t: MIDNIGHT - 100 }; // 23:59:59.900
    const counter = (used: number) =>
      Response.json({ data: { free_model_daily_requests: { used, limit: 50 } } });
    const late = provider(
      () => {
        c.t = MIDNIGHT + 300; // 00:00:00.300
        return Promise.resolve(counter(49));
      },
      true,
      { now: () => c.t },
    );
    expect(await late.p.syncDailyQuota()).toBeNull();
    expect(late.day()).toMatchObject({ used: 0, limit: 50 });

    // Within the day: a request granted while the call was in flight counts on top.
    c.t = MIDNIGHT + 1000;
    const inFlight = provider(
      async () => {
        c.t += 100;
        await inFlight.p.budget.acquire();
        c.t += 100;
        return counter(42);
      },
      true,
      { now: () => c.t },
    );
    expect(await inFlight.p.syncDailyQuota()).toMatchObject({ used: 42, at: MIDNIGHT + 1000 });
    expect(inFlight.day()).toMatchObject({ used: 43 });
  });

  it('keeps the account limit after midnight UTC and reads the new count by itself', async () => {
    const MIDNIGHT = Math.floor(1_800_000_000_000 / DAY_MS) * DAY_MS + DAY_MS;
    const c = { t: MIDNIGHT - 1000 };
    let used = 900;
    const { p, seen, day } = provider(
      () =>
        Promise.resolve(
          Response.json({
            data: { free_model_daily_requests: { used, limit: 1000, remaining: 1000 - used } },
          }),
        ),
      true,
      { now: () => c.t, followAccountRpd: true },
    );
    await p.syncDailyQuota();
    expect(day()).toMatchObject({ used: 900, limit: 1000 });
    // Midnight: OpenRouter's count restarts, and the limit is still the account's, not 50.
    c.t = MIDNIGHT + 1000;
    used = 0;
    expect(day()).toMatchObject({ used: 0, limit: 1000 });
    await p.budget.acquire(undefined, 'meta-llama/llama-3.3-70b-instruct:free');
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(day()).toMatchObject({ used: 1, limit: 1000 });
  });

  it('has a short fingerprint of the key that does not reveal it', () => {
    const { p } = provider(() => Promise.resolve(Response.json({ data: {} })));
    expect(p.keyId).toMatch(KEY_ID_PATTERN);
    expect(p.keyId).toBe(keyFingerprint(KEY));
    expect(keyFingerprint(` ${KEY}\n`)).toBe(p.keyId);
    expect(keyFingerprint(`${KEY}x`)).not.toBe(p.keyId);
    expect(KEY).not.toContain(p.keyId);
  });

  it('is not read for a provider that may use paid models', async () => {
    const { p, seen } = provider(() => Promise.resolve(Response.json({ data: {} })), false);
    expect(await p.syncDailyQuota()).toBeNull();
    expect(seen).toEqual([]);
  });

  it('the account limit replaces the default rpd, and only lowers one chosen by the user', async () => {
    const counter = (limit: number) => () =>
      Promise.resolve(
        Response.json({ data: { free_model_daily_requests: { used: 3, limit, remaining: 0 } } }),
      );
    // Default rpd (50) on an account with credits: 1000 per day.
    const byDefault = provider(counter(1000), true, { rpd: 50, followAccountRpd: true });
    await byDefault.p.syncDailyQuota();
    expect(byDefault.day()).toMatchObject({ used: 3, limit: 1000 });
    // rpd chosen by the user: the lower of the two wins, both ways.
    const chosenLow = provider(counter(1000), true, { rpd: 30 });
    await chosenLow.p.syncDailyQuota();
    expect(chosenLow.day()).toMatchObject({ limit: 30 });
    const chosenHigh = provider(counter(50), true, { rpd: 1000 });
    await chosenHigh.p.syncDailyQuota();
    expect(chosenHigh.day()).toMatchObject({ limit: 50 });
  });
});
