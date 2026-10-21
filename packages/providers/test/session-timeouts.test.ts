import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { APICallError, streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  createKeyedProvider,
  createOpenRouterProvider,
  createLocalProvider,
  isStreamStart,
  ProviderRegistry,
  type SessionEvent,
  StreamInterruptedError,
  StreamTimeoutError,
  withPromptCache,
} from '../src/index.ts';
import { fake, FakeProvider, type FakeProviderOptions } from '../src/testing/index.ts';

/* D-064: time limits of the session, interrupted streams, prompt cache breakpoints. */

/** A promise that never settles: the fake stream opens and sends nothing. */
const never = new Promise<never>(() => {});

class SlowProvider extends FakeProvider {
  readonly firstChunkTimeoutMs: number;
  constructor(options: FakeProviderOptions & { firstChunkTimeoutMs: number }) {
    super(options);
    this.firstChunkTimeoutMs = options.firstChunkTimeoutMs;
  }
}

class CachingProvider extends FakeProvider {
  promptCache(model: string): boolean {
    return model.startsWith('anthropic/');
  }
}

async function parts(model: Parameters<typeof streamText>[0]['model']) {
  const result = streamText({
    model,
    prompt: 'ciao',
    maxRetries: 0,
    includeRawChunks: true,
    onError: () => {},
  });
  const out: { type: string; error?: unknown; raw?: unknown; text?: string }[] = [];
  for await (const p of result.stream) {
    out.push({
      type: p.type,
      ...(p.type === 'error' ? { error: p.error } : {}),
      ...(p.type === 'raw' ? { raw: p.rawValue } : {}),
      ...(p.type === 'text-delta' ? { text: p.text } : {}),
    });
  }
  return out;
}

describe('ModelSession time limits (D-064)', () => {
  it('a link that sends no first token in time is left for the next one', async () => {
    const provider = new FakeProvider({
      models: { a: [fake.text('mai', { gate: never })], b: [fake.text('risposta da b')] },
    });
    const events: SessionEvent[] = [];
    const session = new ProviderRegistry().register(provider).session(
      [
        { provider: 'fake', model: 'a' },
        { provider: 'fake', model: 'b' },
      ],
      { onEvent: (e) => events.push(e), firstChunkMs: 40 },
    );
    const started = Date.now();
    const result = streamText({ model: session, prompt: 'ciao', maxRetries: 0 });
    expect(await result.text).toBe('risposta da b');
    expect(Date.now() - started).toBeLessThan(2000);
    const fallback = events.find((e) => e.type === 'fallback');
    expect(fallback).toMatchObject({
      from: { model: 'a' },
      to: { model: 'b' },
      kind: 'unavailable',
    });
    expect(fallback?.type === 'fallback' && fallback.error).toMatch(
      /didn’t start answering within/,
    );
  });

  it('the time covers the request too: a server that never answers the request', async () => {
    const hanging = new FakeProvider({ id: 'hang', models: {} });
    // doStream never resolves on its own: only the abort of the attempt ends it.
    hanging.model = () =>
      new MockLanguageModelV4({
        doStream: (options) =>
          new Promise((_, reject) => {
            options.abortSignal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      });
    const provider = new FakeProvider({ models: { b: [fake.text('ok da b')] } });
    const events: SessionEvent[] = [];
    const session = new ProviderRegistry()
      .register(hanging)
      .register(provider)
      .session(
        [
          { provider: 'hang', model: 'a' },
          { provider: 'fake', model: 'b' },
        ],
        { onEvent: (e) => events.push(e), firstChunkMs: 40 },
      );
    const result = streamText({ model: session, prompt: 'ciao', maxRetries: 0 });
    expect(await result.text).toBe('ok da b');
    expect(events.find((e) => e.type === 'fallback')).toMatchObject({ kind: 'unavailable' });
  });

  it('a model that reasons for longer than the first-token time is not given up (F-A5)', async () => {
    // A fake clock moved only by the stream: the session sees exactly these gaps, however
    // slow the machine (D-149).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    onTestFinished(() => void vi.useRealTimers());
    const slow = new FakeProvider({ id: 'slow', models: {} });
    // Reasoning parts every 25 ms for 200 ms, then the answer: first token time is 60 ms.
    slow.model = () =>
      new MockLanguageModelV4({
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              async start(controller) {
                controller.enqueue({ type: 'stream-start', warnings: [] });
                controller.enqueue({ type: 'reasoning-start', id: 'r' });
                for (let i = 0; i < 8; i++) {
                  await vi.advanceTimersByTimeAsync(25);
                  controller.enqueue({ type: 'reasoning-delta', id: 'r', delta: '…' });
                }
                controller.enqueue({ type: 'reasoning-end', id: 'r' });
                controller.enqueue({ type: 'text-start', id: 't' });
                controller.enqueue({ type: 'text-delta', id: 't', delta: 'pensato' });
                controller.enqueue({ type: 'text-end', id: 't' });
                controller.enqueue({
                  type: 'finish',
                  finishReason: { unified: 'stop', raw: 'stop' },
                  usage: {
                    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                    outputTokens: { total: 1, text: 1, reasoning: undefined },
                  },
                });
                controller.close();
              },
            }),
          }),
      });
    const events: SessionEvent[] = [];
    const session = new ProviderRegistry()
      .register(slow)
      .session([{ provider: 'slow', model: 'a' }], {
        onEvent: (e) => events.push(e),
        firstChunkMs: 60,
        idleChunkMs: 500,
      });
    const result = streamText({ model: session, prompt: 'ciao', maxRetries: 0 });
    expect(await result.text).toBe('pensato');
    expect(events.find((e) => e.type === 'fallback')).toBeUndefined();
  });

  it('a short 429 on the only link: the session waits for the Retry-After and asks again (F-M5)', async () => {
    const flaky = new FakeProvider({ id: 'flaky', models: {} });
    let asked = 0;
    flaky.model = () =>
      new MockLanguageModelV4({
        doStream: () => {
          asked++;
          if (asked === 1) {
            return Promise.reject(
              new APICallError({
                message: 'Rate limit reached',
                url: 'https://x.test',
                requestBodyValues: {},
                statusCode: 429,
                responseHeaders: { 'retry-after': '0.1' },
              }),
            );
          }
          return Promise.resolve({
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: 'stream-start', warnings: [] });
                controller.enqueue({ type: 'text-start', id: 't' });
                controller.enqueue({ type: 'text-delta', id: 't', delta: 'ecco' });
                controller.enqueue({ type: 'text-end', id: 't' });
                controller.enqueue({
                  type: 'finish',
                  finishReason: { unified: 'stop', raw: 'stop' },
                  usage: {
                    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                    outputTokens: { total: 1, text: 1, reasoning: undefined },
                  },
                });
                controller.close();
              },
            }),
          });
        },
      });
    const session = new ProviderRegistry()
      .register(flaky)
      .session([{ provider: 'flaky', model: 'a' }], {});
    const result = streamText({ model: session, prompt: 'ciao', maxRetries: 0 });
    expect(await result.text).toBe('ecco');
    expect(asked).toBe(2);
  });

  it('the time of the first token comes from the provider when it sets one (local servers)', async () => {
    const provider = new SlowProvider({
      firstChunkTimeoutMs: 30,
      models: { a: [fake.text('mai', { gate: never })], b: [fake.text('ok')] },
    });
    const session = new ProviderRegistry().register(provider).session(
      [
        { provider: 'fake', model: 'a' },
        { provider: 'fake', model: 'b' },
      ],
      // The session default would wait a minute.
      { firstChunkMs: 60_000 },
    );
    const result = streamText({ model: session, prompt: 'ciao', maxRetries: 0 });
    expect(await result.text).toBe('ok');
    expect(createLocalProvider({ type: 'ollama' }).firstChunkTimeoutMs).toBe(180_000);
  });

  it('silence after the first token ends the stream with an interruption, not a hang', async () => {
    const provider = new FakeProvider({
      models: { a: [fake.text('Ecco la risposta', { chunkSize: 5, delayMs: 300 })] },
    });
    const session = new ProviderRegistry()
      .register(provider)
      .session([{ provider: 'fake', model: 'a' }], { idleChunkMs: 40 });
    const seen = await parts(session);
    const error = seen.find((p) => p.type === 'error')?.error;
    expect(error).toBeInstanceOf(StreamInterruptedError);
    expect((error as StreamInterruptedError).cause).toBeInstanceOf(StreamTimeoutError);
    expect((error as Error).message).toMatch(/stopped halfway through its answer/);
    expect(seen.filter((p) => p.type === 'text-delta').map((p) => p.text)).toEqual(['Ecco ']);
  });

  it('an error chunk after the first token becomes an interruption the loop may retry', async () => {
    const provider = new FakeProvider({
      models: {
        a: [fake.text('Ecco i ', { breakWith: { message: 'upstream reset', code: 502 } })],
      },
    });
    const session = new ProviderRegistry()
      .register(provider)
      .session([{ provider: 'fake', model: 'a' }]);
    const seen = await parts(session);
    const error = seen.find((p) => p.type === 'error')?.error;
    expect(error).toBeInstanceOf(StreamInterruptedError);
    expect((error as Error).message).toContain('upstream reset');
    // The marker of the stream start comes first, the providers' raw chunks never.
    expect(seen.filter((p) => p.type === 'raw').map((p) => isStreamStart(p.raw))).toEqual([true]);
  });
});

describe('prompt cache breakpoints (D-064, AG-20)', () => {
  const prompt: LanguageModelV4Prompt = [
    { role: 'system', content: 'Sei Titan.' },
    { role: 'user', content: [{ type: 'text', text: 'ciao' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Ciao!' }] },
    { role: 'user', content: [{ type: 'text', text: 'scrivi un post' }] },
  ];

  it('marks the system prompt and the last message, nothing else', () => {
    const marked = withPromptCache(prompt);
    const flags = marked.map((m) => m.providerOptions?.anthropic?.cacheControl);
    expect(flags).toEqual([{ type: 'ephemeral' }, undefined, undefined, { type: 'ephemeral' }]);
    // The input is not changed.
    expect(prompt.every((m) => m.providerOptions === undefined)).toBe(true);
  });

  it('only for the links whose model caches on request', async () => {
    const provider = new CachingProvider({
      models: { 'anthropic/claude': [fake.text('uno')], 'openai/gpt': [fake.text('due')] },
    });
    const registry = new ProviderRegistry().register(provider);
    for (const model of ['anthropic/claude', 'openai/gpt']) {
      const session = registry.session([{ provider: 'fake', model }]);
      await streamText({ model: session, system: 'Sei Titan.', prompt: 'ciao', maxRetries: 0 })
        .text;
    }
    const [cached, plain] = provider.calls.map((c) => c.options.prompt);
    expect(cached![0]!.providerOptions).toMatchObject({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    });
    expect(cached!.at(-1)!.providerOptions).toMatchObject({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    });
    expect(plain!.every((m) => m.providerOptions?.anthropic === undefined)).toBe(true);
  });

  it('Anthropic with a key, and Anthropic models through OpenRouter', () => {
    expect(createKeyedProvider({ type: 'anthropic', apiKey: 'k' }).promptCache()).toBe(true);
    expect(createKeyedProvider({ type: 'openai', apiKey: 'k' }).promptCache()).toBe(false);
    const openrouter = createOpenRouterProvider({ apiKey: 'k' });
    expect(openrouter.promptCache('anthropic/claude-sonnet-4.5')).toBe(true);
    expect(openrouter.promptCache('openai/gpt-oss-120b:free')).toBe(false);
  });
});
