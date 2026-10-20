import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { z } from 'zod';
import { providerSpec, type KeyedProviderType } from './catalog.ts';
import { ModelCache, getJson } from './http.ts';
import { RateBudget, type RateLimitWindow } from './rate-budget.ts';
import type { ListModelsOptions, ModelInfo, ModelProvider } from './types.ts';
import { knownContextWindow } from './windows.ts';

/*
 * Providers used with the user's own API key, through the official AI SDK
 * packages: Anthropic, OpenAI, Google (Gemini API), Mistral, Groq. All of them
 * are paid per use (Google, Mistral and Groq also have a free tier). Rate
 * limits come only from the providers' headers (or from limits the user sets):
 * no made-up default. The model list is read from the provider's API and
 * cached; it doubles as the key check (no tokens spent).
 */

export interface KeyedProviderOptions {
  type: KeyedProviderType;
  apiKey: string;
  /** Provider id in the registry. Default: the type. */
  id?: string;
  baseURL?: string;
  /** Limits set by the user (none by default: the headers decide). */
  windows?: RateLimitWindow[];
  /** See `RateBudgetOptions.maxWaitMs`. */
  maxWaitMs?: number;
  /** Cache of the model list. Default 1 hour. */
  modelsTtlMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Driver {
  model(o: {
    apiKey: string;
    baseURL: string;
    fetch: typeof fetch;
  }): (id: string) => LanguageModelV4;
  /** Request listing the models (the key goes in a header, never in the URL). */
  list(baseURL: string, apiKey: string): { url: string; headers: Record<string, string> };
  parse(body: unknown): ModelInfo[];
}

const bearer = (apiKey: string) => ({ authorization: `Bearer ${apiKey}` });

function info(
  id: string,
  tools: boolean,
  name?: string | null,
  context?: number | null,
): ModelInfo {
  const m: ModelInfo = { id, tools, free: false };
  if (name) m.name = name;
  if (context) m.context = context;
  return m;
}

const AnthropicModels = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      display_name: z.string().nullish(),
      max_input_tokens: z.number().nullish(),
    }),
  ),
});

const OpenAIModels = z.object({ data: z.array(z.object({ id: z.string() })) });

/*
 * OpenAI and Groq do not say which models take tools: chat models do, audio,
 * image, embedding and moderation models do not.
 */
const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/;
const OPENAI_NOT_CHAT =
  /instruct|audio|realtime|transcribe|tts|image|search|embedding|moderation|dall-e|whisper|davinci|babbage|sora/;

const GroqModels = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      context_window: z.number().nullish(),
      active: z.boolean().nullish(),
    }),
  ),
});
const GROQ_NOT_CHAT = /whisper|tts|guard|playai|orpheus|distil/;

const GoogleModels = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        displayName: z.string().nullish(),
        inputTokenLimit: z.number().nullish(),
        supportedGenerationMethods: z.array(z.string()).nullish(),
      }),
    )
    .default([]),
});
const GOOGLE_NOT_TOOLS = /embedding|image|tts|live|native-audio|aqa|imagen|veo/;

const MistralModels = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullish(),
      max_context_length: z.number().nullish(),
      capabilities: z
        .object({
          completion_chat: z.boolean().nullish(),
          function_calling: z.boolean().nullish(),
        })
        .nullish(),
    }),
  ),
});

const DRIVERS: Record<KeyedProviderType, Driver> = {
  anthropic: {
    model: (o) => {
      const sdk = createAnthropic(o);
      return (id) => sdk(id);
    },
    list: (baseURL, apiKey) => ({
      url: `${baseURL}/models?limit=1000`,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    }),
    parse: (body) =>
      AnthropicModels.parse(body).data.map((m) =>
        info(m.id, true, m.display_name, m.max_input_tokens),
      ),
  },
  openai: {
    // Chat Completions: stateless (nothing stored on OpenAI's side) and served by every chat model.
    model: (o) => {
      const sdk = createOpenAI(o);
      return (id) => sdk.chat(id);
    },
    list: (baseURL, apiKey) => ({ url: `${baseURL}/models`, headers: bearer(apiKey) }),
    parse: (body) =>
      OpenAIModels.parse(body).data.map((m) =>
        // OpenAI's list has no window: the documented one (C.1, D-075).
        info(
          m.id,
          OPENAI_CHAT.test(m.id) && !OPENAI_NOT_CHAT.test(m.id),
          undefined,
          knownContextWindow('openai', m.id),
        ),
      ),
  },
  google: {
    model: (o) => {
      const sdk = createGoogleGenerativeAI(o);
      return (id) => sdk(id);
    },
    // The key goes in `x-goog-api-key`, not in `?key=`: URLs end up in error messages.
    list: (baseURL, apiKey) => ({
      url: `${baseURL}/models?pageSize=1000`,
      headers: { 'x-goog-api-key': apiKey },
    }),
    parse: (body) =>
      GoogleModels.parse(body).models.map((m) => {
        const id = m.name.replace(/^models\//, '');
        const chat = (m.supportedGenerationMethods ?? []).includes('generateContent');
        return info(
          id,
          chat && id.startsWith('gemini') && !GOOGLE_NOT_TOOLS.test(id),
          m.displayName,
          m.inputTokenLimit,
        );
      }),
  },
  mistral: {
    model: (o) => {
      const sdk = createMistral(o);
      return (id) => sdk(id);
    },
    list: (baseURL, apiKey) => ({ url: `${baseURL}/models`, headers: bearer(apiKey) }),
    parse: (body) =>
      MistralModels.parse(body).data.map((m) =>
        info(
          m.id,
          m.capabilities?.function_calling === true && m.capabilities.completion_chat !== false,
          m.name,
          m.max_context_length,
        ),
      ),
  },
  groq: {
    model: (o) => {
      const sdk = createGroq(o);
      return (id) => sdk(id);
    },
    list: (baseURL, apiKey) => ({ url: `${baseURL}/models`, headers: bearer(apiKey) }),
    parse: (body) =>
      GroqModels.parse(body)
        .data.filter((m) => m.active !== false)
        .map((m) => info(m.id, !GROQ_NOT_CHAT.test(m.id), undefined, m.context_window)),
  },
};

export class KeyedProvider implements ModelProvider {
  readonly kind = 'model';
  readonly auth = 'api-key';
  readonly id: string;
  readonly type: KeyedProviderType;
  readonly budget: RateBudget;
  readonly #driver: Driver;
  readonly #model: (id: string) => LanguageModelV4;
  readonly #baseURL: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #models: ModelCache;

  constructor(options: KeyedProviderOptions) {
    if (!options.apiKey) throw new Error(`${options.type} needs an API key`);
    const spec = providerSpec(options.type)!;
    this.type = options.type;
    this.id = options.id ?? options.type;
    this.#driver = DRIVERS[options.type];
    this.#baseURL = (options.baseURL ?? spec.defaultBaseURL).replace(/\/+$/, '');
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? globalThis.fetch;
    const now = options.now ?? Date.now;
    this.#models = new ModelCache(options.modelsTtlMs ?? 3_600_000, now);
    this.budget = new RateBudget({
      id: this.id,
      windows: options.windows ?? [],
      limitScope: spec.limitScope,
      ...(options.maxWaitMs !== undefined ? { maxWaitMs: options.maxWaitMs } : {}),
      now,
    });
    this.#model = this.#driver.model({
      apiKey: options.apiKey,
      baseURL: this.#baseURL,
      fetch: this.#fetch,
    });
  }

  model(modelId: string): LanguageModelV4 {
    return this.#model(modelId);
  }

  /** Anthropic caches only what the request marks (`cache_control`). */
  promptCache(): boolean {
    return this.type === 'anthropic';
  }

  listModels(options: ListModelsOptions = {}): Promise<ModelInfo[]> {
    return this.#models.get(options, async (signal) => {
      const req = this.#driver.list(this.#baseURL, this.#apiKey);
      const body = await getJson(this.id, this.#fetch, req.url, {
        headers: req.headers,
        ...(signal ? { signal } : {}),
      });
      return this.#driver.parse(body).sort((a, b) => a.id.localeCompare(b.id));
    });
  }
}

export function createKeyedProvider(options: KeyedProviderOptions): KeyedProvider {
  return new KeyedProvider(options);
}
