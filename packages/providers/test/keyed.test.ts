import { jsonSchema, streamText, tool } from 'ai';
import { describe, expect, it } from 'vitest';
import {
  KeyedProvider,
  ProviderHttpError,
  ProviderRegistry,
  classifyProviderError,
  costFromMetadata,
  type KeyedProviderType,
  type SessionEvent,
} from '../src/index.ts';
import {
  errorReply,
  fakeHttp,
  json,
  streamReply,
  type FakeReply,
  type RecordedRequest,
  type WireFormat,
} from '../src/testing/fake-http.ts';

// Unknown fake model ids make the SDK warn on the console.
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

/*
 * The keyed providers run the official AI SDK packages against fake servers
 * speaking each provider's format: key check (model list), tool filter, tool
 * calls, errors and rate-limit headers.
 */

interface Case {
  type: KeyedProviderType;
  key: string;
  format: WireFormat;
  /** URL part of the model list and of a chat request. */
  listPath: string;
  chatPath: string;
  /** How the key travels. */
  keyHeader: (req: RecordedRequest) => string | undefined;
  models: unknown;
  /** Tool-capable and non-tool model ids in `models`. */
  toolModel: string;
  otherModel: string;
}

const bearer = (r: RecordedRequest) => r.headers['authorization']?.replace(/^Bearer /, '');

const CASES: Case[] = [
  {
    type: 'anthropic',
    key: 'sk-ant-api03-testkey000000000000',
    format: 'anthropic',
    listPath: '/v1/models',
    chatPath: '/v1/messages',
    keyHeader: (r) => r.headers['x-api-key'],
    models: {
      data: [{ id: 'claude-test-1', display_name: 'Claude Test', type: 'model' }],
      has_more: false,
    },
    toolModel: 'claude-test-1',
    otherModel: '',
  },
  {
    type: 'openai',
    key: 'sk-proj-testkey0000000000000000',
    format: 'openai',
    listPath: '/v1/models',
    chatPath: '/v1/chat/completions',
    keyHeader: bearer,
    models: {
      data: [
        { id: 'gpt-test', object: 'model' },
        { id: 'text-embedding-3-small', object: 'model' },
        { id: 'whisper-1', object: 'model' },
      ],
    },
    toolModel: 'gpt-test',
    otherModel: 'text-embedding-3-small',
  },
  {
    type: 'google',
    key: 'AIzaTestKey00000000000000000000000000000',
    format: 'google',
    listPath: '/v1beta/models',
    chatPath: ':streamGenerateContent',
    keyHeader: (r) => r.headers['x-goog-api-key'],
    models: {
      models: [
        {
          name: 'models/gemini-test',
          displayName: 'Gemini Test',
          inputTokenLimit: 1000000,
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
        {
          name: 'models/text-embedding-004',
          supportedGenerationMethods: ['embedContent'],
        },
      ],
    },
    toolModel: 'gemini-test',
    otherModel: 'text-embedding-004',
  },
  {
    type: 'mistral',
    key: 'mistraltestkey0000000000000000',
    format: 'openai',
    listPath: '/v1/models',
    chatPath: '/v1/chat/completions',
    keyHeader: bearer,
    models: {
      object: 'list',
      data: [
        {
          id: 'mistral-test',
          name: 'Mistral Test',
          max_context_length: 128000,
          capabilities: { completion_chat: true, function_calling: true },
        },
        {
          id: 'mistral-embed',
          capabilities: { completion_chat: false, function_calling: false },
        },
      ],
    },
    toolModel: 'mistral-test',
    otherModel: 'mistral-embed',
  },
  {
    type: 'groq',
    key: 'gsk_testkey00000000000000000000',
    format: 'openai',
    listPath: '/openai/v1/models',
    chatPath: '/openai/v1/chat/completions',
    keyHeader: bearer,
    models: {
      data: [
        { id: 'groq-test', active: true, context_window: 131072 },
        { id: 'whisper-large-v3', active: true },
        { id: 'retired-model', active: false },
      ],
    },
    toolModel: 'groq-test',
    otherModel: 'whisper-large-v3',
  },
];

const weather = tool({
  description: 'Weather in a city',
  inputSchema: jsonSchema<{ city: string }>({
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  }),
});

/** A fake server: model list, then the scripted chat replies in order. */
function server(c: Case, replies: (FakeReply | Response)[] = []) {
  let i = 0;
  return fakeHttp((req) => {
    if (req.url.includes(c.chatPath)) {
      const next = replies[i++];
      if (!next) return errorReply(c.format, 500, 'no more replies');
      return next instanceof Response ? next : streamReply(c.format, next);
    }
    if (req.method === 'GET' && req.url.includes(c.listPath)) {
      return c.keyHeader(req) === c.key
        ? json(c.models)
        : errorReply(c.format, 401, `invalid x-api-key ${c.keyHeader(req) ?? ''}`);
    }
    return undefined;
  });
}

async function runTool(registry: ProviderRegistry, chain: { provider: string; model: string }[]) {
  const events: SessionEvent[] = [];
  const session = registry.session(chain, { onEvent: (e) => events.push(e) });
  const result = streamText({
    model: session,
    prompt: 'Che tempo fa a Roma?',
    tools: { weather },
    maxRetries: 0,
  });
  const calls = await result.toolCalls;
  return { calls, events, session, usage: await result.usage };
}

describe.each(CASES)('$type', (c) => {
  it('checks the key by listing the models, with the key in a header', async () => {
    const http = server(c);
    const p = new KeyedProvider({ type: c.type, apiKey: c.key, fetch: http.fetch });
    const all = await p.listModels({ refresh: true });
    expect(all.map((m) => m.id)).toContain(c.toolModel);
    const tools = await p.listModels({ tools: true });
    expect(tools.map((m) => m.id)).toEqual([c.toolModel]);
    expect(all.every((m) => m.free === false)).toBe(true);
    // Cached: the second listing made no request.
    expect(http.to(c.listPath)).toHaveLength(1);
    for (const r of http.requests) expect(r.url).not.toContain(c.key);
    if (c.otherModel) expect(all.find((m) => m.id === c.otherModel)?.tools).toBe(false);
  });

  it('a wrong key is an auth error that does not carry the key', async () => {
    const http = server(c);
    const p = new KeyedProvider({
      type: c.type,
      apiKey: 'wrong-key-0000000000',
      fetch: http.fetch,
    });
    const err = await p.listModels().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect((err as ProviderHttpError).status).toBe(401);
    expect(classifyProviderError(err)).toBe('auth');
    expect((err as Error).message).not.toContain(c.key);
  });

  it('streams a tool call through a model session', async () => {
    const http = server(c, [
      { tool: { name: 'weather', input: { city: 'Roma' } }, model: c.toolModel },
    ]);
    const registry = new ProviderRegistry().register(
      new KeyedProvider({ type: c.type, apiKey: c.key, fetch: http.fetch }),
    );
    const { calls, usage } = await runTool(registry, [{ provider: c.type, model: c.toolModel }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.toolName).toBe('weather');
    expect(calls[0]!.input).toEqual({ city: 'Roma' });
    expect(usage.inputTokens).toBe(11);
    const chat = http.to(c.chatPath)[0]!;
    expect(c.keyHeader(chat)).toBe(c.key);
    expect(chat.body).toContain('weather');
  });

  it('a 429 falls back to another provider and holds the model back', async () => {
    const headers: Record<string, string> =
      c.type === 'anthropic'
        ? {
            'retry-after': '30',
            'anthropic-ratelimit-requests-limit': '50',
            'anthropic-ratelimit-requests-remaining': '0',
            'anthropic-ratelimit-requests-reset': new Date(Date.now() + 30_000).toISOString(),
          }
        : c.type === 'google'
          ? {}
          : {
              'retry-after': '30',
              'x-ratelimit-limit-requests': '1000',
              'x-ratelimit-remaining-requests': '0',
              'x-ratelimit-reset-requests': '30s',
            };
    const limited =
      c.type === 'google'
        ? errorReply(c.format, 429, 'Resource has been exhausted', headers, {
            details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '30s' }],
          })
        : errorReply(c.format, 429, 'Rate limit reached', headers);
    const http = server(c, [limited]);
    const backup = CASES.find((x) => x.type !== c.type)!;
    const backupHttp = server(backup, [
      { tool: { name: 'weather', input: { city: 'Roma' } }, model: backup.toolModel },
    ]);
    const main = new KeyedProvider({ type: c.type, apiKey: c.key, fetch: http.fetch });
    const registry = new ProviderRegistry()
      .register(main)
      .register(
        new KeyedProvider({ type: backup.type, apiKey: backup.key, fetch: backupHttp.fetch }),
      );
    const { calls, events, session } = await runTool(registry, [
      { provider: c.type, model: c.toolModel },
      { provider: backup.type, model: backup.toolModel },
    ]);
    expect(calls[0]!.toolName).toBe('weather');
    const fallback = events.find((e) => e.type === 'fallback');
    expect(fallback).toMatchObject({
      kind: 'rate_limit',
      status: 429,
      to: { provider: backup.type },
    });
    expect(session.lastServed?.ref.provider).toBe(backup.type);
    const snap = main.budget.snapshot();
    if (c.type === 'mistral') {
      // Mistral's limits are about the workspace: the whole provider waits.
      expect(snap.blockedUntil).toBeGreaterThan(Date.now());
    } else {
      expect(snap.blockedModels?.[c.toolModel]).toBeGreaterThan(Date.now() + 20_000);
      expect(snap.blockedUntil).toBeUndefined();
    }
  });
});

describe('cross-provider errors', () => {
  const anthropic = CASES[0]!;
  const openai = CASES[1]!;

  function pair(first: Response) {
    const a = server(anthropic, [first, first]);
    const o = server(openai, [{ tool: { name: 'weather', input: { city: 'Roma' } } }]);
    const registry = new ProviderRegistry()
      .register(new KeyedProvider({ type: 'anthropic', apiKey: anthropic.key, fetch: a.fetch }))
      .register(new KeyedProvider({ type: 'openai', apiKey: openai.key, fetch: o.fetch }));
    const chain = [
      { provider: 'anthropic', model: 'claude-a' },
      { provider: 'anthropic', model: 'claude-b' },
      { provider: 'openai', model: 'gpt-test' },
    ];
    return { a, o, registry, chain };
  }

  it('a refused key skips the other models of that provider', async () => {
    const t = pair(errorReply('anthropic', 401, 'invalid x-api-key'));
    const { calls, events } = await runTool(t.registry, t.chain);
    expect(calls[0]!.toolName).toBe('weather');
    // claude-b was never asked: same key, same refusal.
    expect(t.a.to('/v1/messages')).toHaveLength(1);
    expect(events.find((e) => e.type === 'fallback')).toMatchObject({
      kind: 'auth',
      to: { provider: 'openai', model: 'gpt-test' },
    });
  });

  it('no credit left is a quota error, handled the same way', async () => {
    const t = pair(
      errorReply('anthropic', 400, 'Your credit balance is too low to access the Anthropic API.'),
    );
    const { events } = await runTool(t.registry, t.chain);
    expect(events.find((e) => e.type === 'fallback')).toMatchObject({ kind: 'quota' });
    expect(t.a.to('/v1/messages')).toHaveLength(1);
  });

  it('OpenAI insufficient_quota (429) is a quota error, not a rate limit', () => {
    const err = Object.assign(new Error('You exceeded your current quota'), { statusCode: 429 });
    expect(classifyProviderError(err)).toBe('quota');
  });

  it('a model that disappeared tries the next model of the same provider', async () => {
    const t = pair(errorReply('anthropic', 404, 'model: claude-a not found'));
    const { events } = await runTool(t.registry, t.chain);
    const fallbacks = events.filter((e) => e.type === 'fallback');
    expect(fallbacks[0]).toMatchObject({ kind: 'model_gone', to: { model: 'claude-b' } });
  });

  it('a refused key with no other provider left fails with the original error', async () => {
    const a = server(anthropic, [errorReply('anthropic', 401, 'invalid x-api-key')]);
    const registry = new ProviderRegistry().register(
      new KeyedProvider({ type: 'anthropic', apiKey: anthropic.key, fetch: a.fetch }),
    );
    const session = registry.session([
      { provider: 'anthropic', model: 'claude-a' },
      { provider: 'anthropic', model: 'claude-b' },
    ]);
    let err: unknown;
    const result = streamText({
      model: session,
      prompt: 'ciao',
      maxRetries: 0,
      onError: ({ error }) => {
        err = error;
      },
    });
    await result.consumeStream();
    expect(classifyProviderError(err)).toBe('auth');
    expect(a.to('/v1/messages')).toHaveLength(1);
  });

  it('Google: an invalid key answered with 400 API_KEY_INVALID is an auth error', async () => {
    const google = CASES.find((c) => c.type === 'google')!;
    const http = fakeHttp(() =>
      errorReply(
        'google',
        400,
        'API key not valid. Please pass a valid API key.',
        {},
        {
          status: 'INVALID_ARGUMENT',
          details: [{ reason: 'API_KEY_INVALID', domain: 'googleapis.com' }],
        },
      ),
    );
    const p = new KeyedProvider({ type: 'google', apiKey: google.key, fetch: http.fetch });
    const err = await p.listModels({ refresh: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(classifyProviderError(err)).toBe('auth');
  });

  it('a context too long moves on to the next link', async () => {
    const t = pair(
      errorReply('anthropic', 400, 'prompt is too long: 250000 tokens > 200000 maximum'),
    );
    const { events } = await runTool(t.registry, t.chain);
    expect(events.find((e) => e.type === 'fallback')).toMatchObject({
      kind: 'context',
      to: { model: 'claude-b' },
    });
  });
});

describe('cost', () => {
  it('reads the cost the provider reports, nothing otherwise', () => {
    expect(costFromMetadata({ openrouter: { usage: { cost: 0.0012 } } })).toBe(0.0012);
    expect(costFromMetadata({ anthropic: { cacheCreationInputTokens: 0 } })).toBeUndefined();
    expect(costFromMetadata(undefined)).toBeUndefined();
  });
});
