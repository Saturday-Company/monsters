import { jsonSchema, streamText, tool } from 'ai';
import { describe, expect, it } from 'vitest';
import {
  LocalProvider,
  OLLAMA_DEFAULT_CONTEXT,
  ProviderRegistry,
  classifyProviderError,
  normalizeLocalBaseURL,
  type SessionEvent,
} from '../src/index.ts';
import { errorReply, fakeHttp, json, streamReply } from '../src/testing/fake-http.ts';

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const weather = tool({
  description: 'Weather in a city',
  inputSchema: jsonSchema<{ city: string }>({
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  }),
});

function ollama() {
  return fakeHttp((req) => {
    if (req.url === 'http://127.0.0.1:11434/api/tags') {
      return json({ models: [{ name: 'qwen3:8b', model: 'qwen3:8b' }, { name: 'nomic:latest' }] });
    }
    if (req.url === 'http://127.0.0.1:11434/api/show') {
      const model = (JSON.parse(req.body) as { model: string }).model;
      return model === 'qwen3:8b'
        ? json({
            capabilities: ['completion', 'tools'],
            model_info: { 'qwen3.context_length': 40960 },
          })
        : json({ capabilities: ['embedding'] });
    }
    if (req.url === 'http://127.0.0.1:11434/v1/chat/completions') {
      return streamReply('openai', { tool: { name: 'weather', input: { city: 'Roma' } } });
    }
    return undefined;
  });
}

describe('local providers', () => {
  it('normalizes the address', () => {
    expect(normalizeLocalBaseURL('http://localhost:11434/v1/')).toBe('http://localhost:11434');
    expect(normalizeLocalBaseURL(' http://10.0.0.5:1234 ')).toBe('http://10.0.0.5:1234');
    expect(() => normalizeLocalBaseURL('file:///etc/passwd')).toThrow();
    expect(() => normalizeLocalBaseURL('http://user:pw@localhost:1')).toThrow();
  });

  it('Ollama: discovers the models and which take tools, no key', async () => {
    const http = ollama();
    const p = new LocalProvider({ type: 'ollama', fetch: http.fetch });
    const models = await p.listModels();
    expect(models).toEqual([
      { id: 'nomic:latest', tools: false, free: true },
      // The effective context (Ollama's default), not the 40960 the model was trained for.
      { id: 'qwen3:8b', tools: true, free: true, context: 4096 },
    ]);
    expect((await p.listModels({ tools: true })).map((m) => m.id)).toEqual(['qwen3:8b']);
    for (const r of http.requests) expect(r.headers['authorization']).toBeUndefined();
  });

  it('Ollama: the context is the one Ollama allocates, not the training maximum', async () => {
    const serve = (opts: { parameters?: string; loaded?: number }) =>
      fakeHttp((req) => {
        if (req.url.endsWith('/api/tags')) return json({ models: [{ name: 'a:1' }] });
        if (req.url.endsWith('/api/ps')) {
          return json({
            models: opts.loaded ? [{ name: 'a:1', model: 'a:1', context_length: opts.loaded }] : [],
          });
        }
        if (req.url.endsWith('/api/show')) {
          return json({
            capabilities: ['completion', 'tools'],
            model_info: { 'a.context_length': 131072 },
            ...(opts.parameters ? { parameters: opts.parameters } : {}),
          });
        }
        return undefined;
      });
    const contextOf = async (opts: { parameters?: string; loaded?: number }) =>
      (await new LocalProvider({ type: 'ollama', fetch: serve(opts).fetch }).listModels())[0]!
        .context;
    // Nothing set: Ollama's default, however long the model could read.
    expect(await contextOf({})).toBe(OLLAMA_DEFAULT_CONTEXT);
    // The Modelfile sets num_ctx.
    expect(
      await contextOf({ parameters: 'stop "<|im_end|>"\nnum_ctx                        16384' }),
    ).toBe(16384);
    // A loaded model reports the context it was loaded with, which wins.
    expect(await contextOf({ parameters: 'num_ctx 16384', loaded: 32768 })).toBe(32768);
    // Never above what the model supports.
    expect(await contextOf({ parameters: 'num_ctx 999999' })).toBe(131072);
  });

  it('LM Studio: the loaded context wins over the maximum', async () => {
    const http = fakeHttp((req) =>
      req.url.endsWith('/api/v0/models')
        ? json({
            data: [
              { id: 'a', type: 'llm', max_context_length: 131072, loaded_context_length: 8192 },
              { id: 'b', type: 'llm', max_context_length: 32768 },
            ],
          })
        : undefined,
    );
    const models = await new LocalProvider({ type: 'lmstudio', fetch: http.fetch }).listModels();
    expect(models.map((m) => m.context)).toEqual([8192, 32768]);
  });

  it('Ollama: a tool call through the OpenAI-compatible endpoint', async () => {
    const http = ollama();
    const registry = new ProviderRegistry().register(
      new LocalProvider({ type: 'ollama', fetch: http.fetch }),
    );
    const session = registry.session([{ provider: 'ollama', model: 'qwen3:8b' }]);
    const result = streamText({
      model: session,
      prompt: 'meteo',
      tools: { weather },
      maxRetries: 0,
    });
    const calls = await result.toolCalls;
    expect(calls[0]).toMatchObject({ toolName: 'weather', input: { city: 'Roma' } });
    expect(JSON.parse(http.to('/v1/chat/completions')[0]!.body)).toMatchObject({
      model: 'qwen3:8b',
    });
  });

  it('LM Studio: reads the native list, skipping embeddings', async () => {
    const http = fakeHttp((req) =>
      req.url === 'http://127.0.0.1:1234/api/v0/models'
        ? json({
            data: [
              {
                id: 'qwen2.5-7b',
                type: 'llm',
                max_context_length: 32768,
                capabilities: ['tool_use'],
              },
              { id: 'gemma-3', type: 'vlm', capabilities: [] },
              { id: 'text-embedding-nomic', type: 'embeddings' },
            ],
          })
        : undefined,
    );
    const p = new LocalProvider({ type: 'lmstudio', fetch: http.fetch });
    expect(await p.listModels()).toEqual([
      { id: 'gemma-3', tools: false, free: true },
      { id: 'qwen2.5-7b', tools: true, free: true, context: 32768 },
    ]);
  });

  it('LM Studio: falls back to /v1/models on older servers', async () => {
    const http = fakeHttp((req) => {
      if (req.url.endsWith('/api/v0/models')) return errorReply('openai', 404, 'not found');
      if (req.url.endsWith('/v1/models')) return json({ data: [{ id: 'local-model' }] });
      return undefined;
    });
    const p = new LocalProvider({
      type: 'lmstudio',
      baseURL: 'http://127.0.0.1:1234',
      fetch: http.fetch,
    });
    expect(await p.listModels()).toEqual([{ id: 'local-model', tools: true, free: true }]);
  });

  it('a server that is off is "unavailable"', async () => {
    const off = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    const p = new LocalProvider({ type: 'ollama', fetch: off });
    const err = await p.listModels().catch((e: unknown) => e);
    expect(classifyProviderError(err)).toBe('unavailable');
  });

  it('Ollama: a model without tool support (400) moves on to the next model of the same server', async () => {
    const http = fakeHttp((req) => {
      if (req.url !== 'http://127.0.0.1:11434/v1/chat/completions') return undefined;
      const model = (JSON.parse(req.body) as { model: string }).model;
      if (model === 'gemma3:1b') {
        return errorReply(
          'openai',
          400,
          'registry.ollama.ai/library/gemma3:1b does not support tools',
          {},
          { type: 'api_error' },
        );
      }
      return streamReply('openai', { tool: { name: 'weather', input: { city: 'Roma' } } });
    });
    const registry = new ProviderRegistry().register(
      new LocalProvider({ type: 'ollama', fetch: http.fetch }),
    );
    const events: SessionEvent[] = [];
    const session = registry.session(
      [
        { provider: 'ollama', model: 'gemma3:1b' },
        { provider: 'ollama', model: 'qwen3:8b' },
      ],
      { onEvent: (e) => events.push(e) },
    );
    const result = streamText({
      model: session,
      prompt: 'meteo',
      tools: { weather },
      maxRetries: 0,
    });
    expect((await result.toolCalls)[0]).toMatchObject({ toolName: 'weather' });
    expect(events.find((e) => e.type === 'fallback')).toMatchObject({
      kind: 'model_gone',
      to: { provider: 'ollama', model: 'qwen3:8b' },
    });
  });
});
