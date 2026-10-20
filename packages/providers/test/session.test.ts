import { streamText } from 'ai';
import { describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import {
  AllModelsFailedError,
  EmptyResponseError,
  type ModelProvider,
  ProviderRegistry,
  ProviderRemovedError,
  RateBudget,
  type SessionEvent,
} from '../src/index.ts';
import { effortOptions } from '../src/session.ts';
import { fake, FakeProvider } from '../src/testing/index.ts';

async function ask(model: Parameters<typeof streamText>[0]['model'], prompt = 'ciao') {
  const result = streamText({ model, prompt, maxRetries: 0 });
  return result.text;
}

describe('ModelSession', () => {
  it('a context error: one shorter prompt to the same link, then the chain (D-082)', async () => {
    const tooLong = {
      kind: 'http-error' as const,
      status: 400,
      message: "This model's maximum context length is 8192 tokens",
    };
    const provider = new FakeProvider({
      models: { a: [tooLong, fake.text('ok da a'), tooLong, tooLong], b: [fake.text('ok da b')] },
    });
    const events: SessionEvent[] = [];
    const session = new ProviderRegistry().register(provider).session(
      [
        { provider: 'fake', model: 'a' },
        { provider: 'fake', model: 'b' },
      ],
      { onEvent: (e) => events.push(e) },
    );
    const seen: number[] = [];
    session.setContextRescue((ref, prompt) => {
      seen.push(prompt.length);
      expect(ref.model).toBe('a');
      return [...prompt.slice(0, 1), { role: 'user', content: [{ type: 'text', text: 'corto' }] }];
    });
    expect(await ask(session, 'una richiesta molto lunga')).toBe('ok da a');
    expect(provider.calls.map((c) => c.model)).toEqual(['a', 'a']);
    expect(JSON.stringify(provider.calls[1]!.options.prompt)).toContain('corto');
    expect(events.some((e) => e.type === 'context_rescue')).toBe(true);
    // Once per request: the shorter prompt refused too moves on to the next link.
    expect(await ask(session, 'di nuovo lunga')).toBe('ok da b');
    expect(provider.calls.map((c) => c.model)).toEqual(['a', 'a', 'a', 'a', 'b']);
    expect(seen).toHaveLength(2);
    // No rescue: the next link at once, as before.
    session.setContextRescue(null);
  });

  it('falls back to the next model on 429 and records the event', async () => {
    const provider = new FakeProvider({
      models: { a: [fake.rateLimited()], b: [fake.text('risposta da b')] },
    });
    const events: SessionEvent[] = [];
    const session = new ProviderRegistry().register(provider).session(
      [
        { provider: 'fake', model: 'a' },
        { provider: 'fake', model: 'b' },
      ],
      { onEvent: (e) => events.push(e) },
    );
    expect(await ask(session)).toBe('risposta da b');
    expect(provider.calls.map((c) => c.model)).toEqual(['a', 'b']);
    const fallback = events.find((e) => e.type === 'fallback');
    expect(fallback).toMatchObject({ from: { model: 'a' }, to: { model: 'b' }, status: 429 });
    expect(session.lastServed).toMatchObject({ ref: { model: 'b' }, attempts: 2 });
  });

  it('pins the model picked by a router and keeps the router as last fallback', async () => {
    const provider = new FakeProvider({
      pinServedModel: true,
      models: {
        'router/free': [
          fake.text('uno', { servedModel: 'vendor/x:free' }),
          fake.text('tre', { servedModel: 'vendor/y:free' }),
        ],
        'vendor/x:free': [fake.text('due'), fake.rateLimited()],
      },
    });
    const events: SessionEvent[] = [];
    const session = new ProviderRegistry()
      .register(provider)
      .session([{ provider: 'fake', model: 'router/free' }], { onEvent: (e) => events.push(e) });

    expect(await ask(session)).toBe('uno');
    expect(session.pinned).toEqual({ provider: 'fake', model: 'vendor/x:free' });
    expect(session.effectiveChain().map((r) => r.model)).toEqual(['vendor/x:free', 'router/free']);

    expect(await ask(session)).toBe('due');
    expect(provider.calls.at(-1)?.model).toBe('vendor/x:free');

    // The pinned model is rate limited: the router answers and a new model is pinned.
    expect(await ask(session)).toBe('tre');
    expect(provider.calls.map((c) => c.model)).toEqual([
      'router/free',
      'vendor/x:free',
      'vendor/x:free',
      'router/free',
    ]);
    expect(session.pinned?.model).toBe('vendor/y:free');
    expect(events.filter((e) => e.type === 'pinned')).toHaveLength(2);
  });

  it('falls back when the stream fails before any content', async () => {
    const provider = new FakeProvider({
      models: {
        a: [fake.streamError({ message: 'upstream overloaded', code: 429 })],
        b: [fake.text('ok')],
      },
    });
    const session = new ProviderRegistry().register(provider).session([
      { provider: 'fake', model: 'a' },
      { provider: 'fake', model: 'b' },
    ]);
    expect(await ask(session)).toBe('ok');
  });

  it('an empty answer is tried again once on the same model, then on the next one', async () => {
    const provider = new FakeProvider({
      models: {
        a: [fake.empty(), fake.empty()],
        b: [fake.text('   ', {}), fake.text('ok da b')],
      },
    });
    const events: SessionEvent[] = [];
    const session = new ProviderRegistry().register(provider).session(
      [
        { provider: 'fake', model: 'a' },
        { provider: 'fake', model: 'b' },
      ],
      { onEvent: (e) => events.push(e) },
    );
    expect(await ask(session)).toBe('ok da b');
    // a twice (one retry), b twice (whitespace only is empty too).
    expect(provider.calls.map((c) => c.model)).toEqual(['a', 'a', 'b', 'b']);
    const fallbacks = events.filter((e) => e.type === 'fallback');
    expect(fallbacks.map((e) => [e.from.model, e.to?.model, e.kind])).toEqual([
      ['a', 'a', 'empty'],
      ['a', 'b', 'empty'],
      ['b', 'b', 'empty'],
    ]);
    expect(session.lastServed?.ref.model).toBe('b');
  });

  it('a chain that only answers empty fails with every attempt, in Italian', async () => {
    const provider = new FakeProvider({ models: { a: [fake.empty(), fake.empty()] } });
    const session = new ProviderRegistry()
      .register(provider)
      .session([{ provider: 'fake', model: 'a' }]);
    const result = streamText({ model: session, prompt: 'ciao', maxRetries: 0, onError: () => {} });
    let failure: unknown;
    for await (const part of result.stream) if (part.type === 'error') failure = part.error;
    expect(failure).toBeInstanceOf(AllModelsFailedError);
    expect((failure as Error).message).toMatch(/^nessun modello disponibile: .*risposta vuota/);
    expect((failure as Error).cause).toBeInstanceOf(EmptyResponseError);
    expect(provider.calls).toHaveLength(2);
  });

  it('demote moves the model that answered badly to the end of the chain', async () => {
    const provider = new FakeProvider({
      models: { a: [fake.text('uno'), fake.text('tre')], b: [fake.text('due')] },
    });
    const session = new ProviderRegistry().register(provider).session([
      { provider: 'fake', model: 'a' },
      { provider: 'fake', model: 'b' },
    ]);
    expect(await ask(session)).toBe('uno');
    expect(session.demote()).toBe(true);
    expect(session.effectiveChain().map((r) => r.model)).toEqual(['b', 'a']);
    expect(await ask(session)).toBe('due');
    // A single-model chain has nothing else to try.
    const lone = new ProviderRegistry()
      .register(new FakeProvider({ models: { a: [fake.text('x')] } }))
      .session([{ provider: 'fake', model: 'a' }]);
    await ask(lone);
    expect(lone.demote()).toBe(false);
  });

  it('does not fall back on authentication errors', async () => {
    const provider = new FakeProvider({
      models: { a: [fake.httpError(401, 'bad key')], b: [fake.text('never')] },
    });
    const session = new ProviderRegistry().register(provider).session([
      { provider: 'fake', model: 'a' },
      { provider: 'fake', model: 'b' },
    ]);
    const errors: unknown[] = [];
    const result = streamText({
      model: session,
      prompt: 'x',
      maxRetries: 0,
      onError: ({ error }) => {
        errors.push(error);
      },
    });
    await expect(result.text).rejects.toThrow();
    expect(String(errors[0])).toContain('bad key');
    expect(provider.callsTo('b')).toHaveLength(0);
  });

  it('falls back when the context is too long for a model, not on other 400s', async () => {
    const provider = new FakeProvider({
      models: {
        small: [
          fake.httpError(400, "This model's maximum context length is 8192 tokens."),
          fake.httpError(400, 'invalid tool schema'),
        ],
        large: [fake.text('risposta dal modello grande'), fake.text('never')],
      },
    });
    const chain = [
      { provider: 'fake', model: 'small' },
      { provider: 'fake', model: 'large' },
    ];
    const registry = new ProviderRegistry().register(provider);
    expect(await ask(registry.session(chain, { pin: false }))).toBe('risposta dal modello grande');
    await expect(ask(registry.session(chain, { pin: false }))).rejects.toThrow();
    expect(provider.callsTo('large')).toHaveLength(1);
  });

  it('reports every failure when the whole chain is exhausted', async () => {
    const provider = new FakeProvider({
      models: { a: [fake.rateLimited()], b: [fake.httpError(503)] },
    });
    const session = new ProviderRegistry().register(provider).session([
      { provider: 'fake', model: 'a' },
      { provider: 'fake', model: 'b' },
    ]);
    const err = await session
      .doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AllModelsFailedError);
    expect((err as AllModelsFailedError).attempts.map((a) => a.ref.model)).toEqual(['a', 'b']);
  });

  it('shares the provider budget: a 429 with Retry-After makes the next request wait', async () => {
    const provider = new FakeProvider({
      // Two 429: the only link asks again once after waiting (F-M5), then the run fails.
      models: {
        a: [
          fake.rateLimited({ 'retry-after': '0.15' }),
          fake.rateLimited({ 'retry-after': '0.15' }),
          fake.text('dopo'),
        ],
      },
    });
    const events: SessionEvent[] = [];
    const registry = new ProviderRegistry().register(provider);
    const first = registry.session([{ provider: 'fake', model: 'a' }]);
    await expect(ask(first)).rejects.toThrow();
    // Another agent, same provider: it queues until the Retry-After expires.
    const second = registry.session([{ provider: 'fake', model: 'a' }], {
      onEvent: (e) => events.push(e),
    });
    const t0 = Date.now();
    expect(await ask(second)).toBe('dopo');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
    expect(events.find((e) => e.type === 'queued')).toBeDefined();
  });

  it('a Retry-After on the 429 of one model holds back that model only', async () => {
    const provider = new FakeProvider({
      models: {
        a: [fake.rateLimited({ 'retry-after': '30' })],
        b: [fake.text('b subito'), fake.text('b di nuovo')],
      },
    });
    const registry = new ProviderRegistry().register(provider);
    const chain = [
      { provider: 'fake', model: 'a' },
      { provider: 'fake', model: 'b' },
    ];
    const t0 = Date.now();
    expect(await ask(registry.session(chain, { pin: false }))).toBe('b subito');
    expect(provider.budget.waitTime()).toBe(0);
    expect(provider.budget.modelWaitTime('a')).toBeGreaterThan(20_000);
    // Another agent: `a` is skipped without a request, `b` answers at once.
    expect(await ask(registry.session(chain, { pin: false }))).toBe('b di nuovo');
    expect(provider.callsTo('a')).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('drops chain links whose provider is not configured', () => {
    const registry = new ProviderRegistry().register(new FakeProvider({ models: { a: [] } }));
    const session = registry.session([
      { provider: 'missing', model: 'z' },
      { provider: 'fake', model: 'a' },
    ]);
    expect(session.effectiveChain()).toEqual([{ provider: 'fake', model: 'a' }]);
    expect(() => registry.session([{ provider: 'missing', model: 'z' }])).toThrow(/not configured/);
  });

  it('falls back to the next provider when a queued provider is removed (key deleted or saved again)', async () => {
    const groq = new FakeProvider({
      id: 'groq',
      windows: [{ limit: 1, windowMs: 5_000 }],
      models: { a: [fake.text('primo'), fake.text('never')] },
    });
    const openai = new FakeProvider({ id: 'openai', models: { b: [fake.text('da openai')] } });
    const registry = new ProviderRegistry().register(groq).register(openai);
    const events: SessionEvent[] = [];
    const session = registry.session(
      [
        { provider: 'groq', model: 'a' },
        { provider: 'openai', model: 'b' },
      ],
      { pin: false, onEvent: (e) => events.push(e) },
    );
    expect(await ask(session)).toBe('primo');
    // The second request waits for a groq slot; meanwhile the key goes away.
    const second = ask(session);
    setTimeout(() => registry.unregister('groq'), 30);
    expect(await second).toBe('da openai');
    expect(events.find((e) => e.type === 'fallback')).toMatchObject({
      from: { provider: 'groq' },
      to: { provider: 'openai', model: 'b' },
    });
  });

  it('falls back when the pinned provider was removed between two requests', async () => {
    const groq = new FakeProvider({ id: 'groq', models: { a: [fake.text('primo')] } });
    const openai = new FakeProvider({ id: 'openai', models: { b: [fake.text('da openai')] } });
    const registry = new ProviderRegistry().register(groq).register(openai);
    const session = registry.session([
      { provider: 'groq', model: 'a' },
      { provider: 'groq', model: 'a2' },
      { provider: 'openai', model: 'b' },
    ]);
    expect(await ask(session)).toBe('primo');
    expect(session.pinned).toEqual({ provider: 'groq', model: 'a' });
    registry.unregister('groq');
    expect(await ask(session)).toBe('da openai');
    expect(session.pinned).toEqual({ provider: 'openai', model: 'b' });
  });

  it('a request does not run on a provider replaced while it waited for its slot', async () => {
    const old = new FakeProvider({
      id: 'groq',
      models: { a: [fake.text('primo'), fake.text('vecchia chiave')] },
    });
    const registry = new ProviderRegistry().register(old);
    const session = registry.session([{ provider: 'groq', model: 'a' }], { pin: false });
    expect(await ask(session)).toBe('primo');
    // `a` is held back by its own 429 for a moment: the request waits outside the queue.
    old.budget.update({ 'retry-after': '0.1' }, 429, 'a');
    const second = session
      .doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] })
      .catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 20));
    registry.unregister('groq');
    registry.register(new FakeProvider({ id: 'groq', models: { a: [] } }));
    expect(await second).toBeInstanceOf(ProviderRemovedError);
    expect(old.callsTo('a')).toHaveLength(1);
  });

  it('a successful answer that exhausts a per-model limit holds back that model only', async () => {
    const provider = new FakeProvider({
      limitScope: 'model',
      models: {
        a: [
          fake.text('a', {
            headers: {
              'x-ratelimit-limit-tokens': '30000',
              'x-ratelimit-remaining-tokens': '0',
              'x-ratelimit-reset-tokens': '20s',
            },
          }),
        ],
        b: [fake.text('b subito')],
      },
    });
    const registry = new ProviderRegistry().register(provider);
    const chain = [
      { provider: 'fake', model: 'a' },
      { provider: 'fake', model: 'b' },
    ];
    expect(await ask(registry.session(chain, { pin: false }))).toBe('a');
    expect(provider.budget.waitTime()).toBe(0);
    expect(provider.budget.modelWaitTime('a')).toBeGreaterThan(10_000);
    const t0 = Date.now();
    expect(await ask(registry.session(chain, { pin: false }))).toBe('b subito');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('the same per-model limit on doGenerate holds back that model only', async () => {
    const budget = new RateBudget({ id: 'openai', limitScope: 'model' });
    const provider: ModelProvider = {
      id: 'openai',
      kind: 'model',
      auth: 'api-key',
      budget,
      listModels: () => Promise.resolve([]),
      model: (modelId) =>
        new MockLanguageModelV4({
          provider: 'openai',
          modelId,
          doGenerate: {
            content: [{ type: 'text', text: 'ok' }],
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
            warnings: [],
            response: {
              headers: {
                'x-ratelimit-remaining-requests': '0',
                'x-ratelimit-reset-requests': '20s',
              },
            },
          },
        }),
    };
    const session = new ProviderRegistry()
      .register(provider)
      .session([{ provider: 'openai', model: 'a' }]);
    await session.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
    });
    expect(budget.waitTime()).toBe(0);
    expect(budget.modelWaitTime('a')).toBeGreaterThan(10_000);
  });
});

describe('the effort of a link (D-110)', () => {
  it('goes to Anthropic as effort and to OpenRouter as reasoning.effort; other providers ignore it', () => {
    expect(effortOptions({ provider: 'anthropic', model: 'claude-opus', effort: 'high' })).toEqual({
      anthropic: { effort: 'high' },
    });
    expect(effortOptions({ provider: 'openrouter', model: 'x/y', effort: 'medium' })).toEqual({
      openrouter: { reasoning: { effort: 'medium' } },
    });
    // OpenRouter's scale stops at xhigh.
    expect(effortOptions({ provider: 'openrouter', model: 'x/y', effort: 'max' })).toEqual({
      openrouter: { reasoning: { effort: 'xhigh' } },
    });
    expect(effortOptions({ provider: 'openai', model: 'gpt', effort: 'high' })).toBeUndefined();
    expect(effortOptions({ provider: 'anthropic', model: 'claude-opus' })).toBeUndefined();
  });
});
