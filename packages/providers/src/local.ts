import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { z } from 'zod';
import { providerSpec, type LocalProviderType } from './catalog.ts';
import { ModelCache, ProviderHttpError, getJson } from './http.ts';
import { RateBudget } from './rate-budget.ts';
import type { ListModelsOptions, ModelInfo, ModelProvider } from './types.ts';

/*
 * Local models (research 02 §5): Ollama and LM Studio, both served through
 * their OpenAI-compatible endpoint (`<root>/v1`). No key, free, no rate
 * limits. The models are discovered from each server's own API, which also
 * tells which models take tools:
 *   Ollama     GET /api/tags, then POST /api/show per model (`capabilities`)
 *   LM Studio  GET /api/v0/models (`type`, `capabilities`), else GET /v1/models
 * Small local models are often weak at multi-step tool calling: fine for light
 * work, not for the orchestrator.
 */

export interface LocalProviderOptions {
  type: LocalProviderType;
  /** Server root, e.g. `http://127.0.0.1:11434` (a trailing `/v1` is dropped). */
  baseURL?: string;
  id?: string;
  /** Cache of the model list. Default 1 minute (models come and go locally). */
  modelsTtlMs?: number;
  /** Timeout of the discovery requests. Default 5 s. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

/** `http(s)://host:port[/path]` without a trailing slash nor `/v1`. */
export function normalizeLocalBaseURL(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('the address must start with http:// or https://');
  }
  if (url.username || url.password) throw new Error('the address cannot contain credentials');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '').replace(/\/v1$/, '');
}

const OllamaTags = z.object({
  models: z.array(z.object({ name: z.string(), model: z.string().nullish() })).default([]),
});
const OllamaShow = z.object({
  capabilities: z.array(z.string()).nullish(),
  model_info: z.record(z.string(), z.unknown()).nullish(),
  /** The Modelfile's PARAMETER lines as text (`num_ctx 8192`). */
  parameters: z.string().nullish(),
});
/** Models loaded right now, with the context each was loaded with (Ollama 0.6 and later). */
const OllamaPs = z.object({
  models: z
    .array(
      z.object({
        name: z.string().nullish(),
        model: z.string().nullish(),
        context_length: z.number().nullish(),
      }),
    )
    .default([]),
});
const LmStudioModels = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      type: z.string().nullish(),
      max_context_length: z.number().nullish(),
      loaded_context_length: z.number().nullish(),
      capabilities: z.array(z.string()).nullish(),
    }),
  ),
});
const OpenAIModels = z.object({ data: z.array(z.object({ id: z.string() })) });

/** What the model was trained for: not what Ollama allocates (see `effectiveOllamaContext`). */
function contextFromOllama(info: Record<string, unknown> | null | undefined): number | undefined {
  for (const [k, v] of Object.entries(info ?? {})) {
    if (k.endsWith('.context_length') && typeof v === 'number') return v;
  }
  return undefined;
}

/**
 * Ollama's context window when nothing sets one (`OLLAMA_CONTEXT_LENGTH`, or
 * `num_ctx` in the Modelfile): the server allocates this, not the model's
 * training maximum. Newer versions pick a larger one by VRAM; a loaded model
 * reports its real one, which then wins.
 */
export const OLLAMA_DEFAULT_CONTEXT = 4096;

/** `num_ctx` of a Modelfile's `parameters` text, if it sets one. */
function numCtxFromParameters(parameters: string | null | undefined): number | undefined {
  const m = /^\s*num_ctx\s+(\d+)\s*$/m.exec(parameters ?? '');
  const n = m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/**
 * The context Ollama really gives a model through its OpenAI-compatible endpoint,
 * which cannot pass `num_ctx` per request: the context of the loaded model, else
 * the Modelfile's `num_ctx`, else the server default; never above the training
 * maximum. Reading the training maximum instead made the core believe in 40k
 * where the server cut at 4k, so nothing was compacted and Ollama silently
 * dropped the start of the prompt (instructions and tools).
 */
function effectiveOllamaContext(
  trained: number | undefined,
  loaded: number | undefined,
  configured: number | undefined,
): number {
  const effective = loaded ?? configured ?? OLLAMA_DEFAULT_CONTEXT;
  return trained !== undefined ? Math.min(effective, trained) : effective;
}
export class LocalProvider implements ModelProvider {
  readonly kind = 'model';
  readonly auth = 'none';
  readonly id: string;
  readonly type: LocalProviderType;
  readonly baseURL: string;
  readonly budget: RateBudget;
  /** A local server may load the model before the first token: 3 minutes (D-064). */
  readonly firstChunkTimeoutMs = 180_000;
  readonly #sdk: ReturnType<typeof createOpenAICompatible>;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #models: ModelCache;

  constructor(options: LocalProviderOptions) {
    const spec = providerSpec(options.type)!;
    this.type = options.type;
    this.id = options.id ?? options.type;
    this.baseURL = normalizeLocalBaseURL(options.baseURL ?? spec.defaultBaseURL);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 5000;
    const now = options.now ?? Date.now;
    this.#models = new ModelCache(options.modelsTtlMs ?? 60_000, now);
    this.budget = new RateBudget({ id: this.id, now });
    this.#sdk = createOpenAICompatible({
      name: this.id,
      baseURL: `${this.baseURL}/v1`,
      fetch: this.#fetch,
      includeUsage: true,
    });
  }

  model(modelId: string): LanguageModelV4 {
    return this.#sdk.chatModel(modelId);
  }

  listModels(options: ListModelsOptions = {}): Promise<ModelInfo[]> {
    return this.#models.get(options, async (signal) => {
      const timeout = AbortSignal.timeout(this.#timeoutMs);
      const s = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const models = this.type === 'ollama' ? await this.#ollama(s) : await this.#lmStudio(s);
      return models.sort((a, b) => a.id.localeCompare(b.id));
    });
  }

  async #ollama(signal: AbortSignal): Promise<ModelInfo[]> {
    const tags = OllamaTags.parse(
      await getJson(this.id, this.#fetch, `${this.baseURL}/api/tags`, { signal }),
    );
    const loaded = await this.#ollamaLoaded(signal);
    return Promise.all(
      tags.models.slice(0, 100).map(async (m): Promise<ModelInfo> => {
        const id = m.model ?? m.name;
        try {
          const show = OllamaShow.parse(
            await getJson(this.id, this.#fetch, `${this.baseURL}/api/show`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ model: id }),
              signal,
            }),
          );
          const tools = show.capabilities ? show.capabilities.includes('tools') : true;
          // An embedding model has no chat context to guard.
          const chat = show.capabilities ? show.capabilities.includes('completion') : true;
          const trained = contextFromOllama(show.model_info);
          const context = chat
            ? effectiveOllamaContext(trained, loaded.get(id), numCtxFromParameters(show.parameters))
            : undefined;
          return {
            id,
            // Older servers do not report capabilities: let the user try.
            tools,
            free: true,
            ...(context ? { context } : {}),
          };
        } catch {
          return { id, tools: true, free: true, context: loaded.get(id) ?? OLLAMA_DEFAULT_CONTEXT };
        }
      }),
    );
  }

  /** The context of each model loaded now (`/api/ps`); nothing on an older server or any failure. */
  async #ollamaLoaded(signal: AbortSignal): Promise<Map<string, number>> {
    const loaded = new Map<string, number>();
    try {
      const ps = OllamaPs.parse(
        await getJson(this.id, this.#fetch, `${this.baseURL}/api/ps`, { signal }),
      );
      for (const m of ps.models) {
        const name = m.model ?? m.name;
        if (name && m.context_length && m.context_length > 0) loaded.set(name, m.context_length);
      }
    } catch {
      // Not loaded, not reported, or an old version: the configured or default value.
    }
    return loaded;
  }

  async #lmStudio(signal: AbortSignal): Promise<ModelInfo[]> {
    try {
      const body = LmStudioModels.parse(
        await getJson(this.id, this.#fetch, `${this.baseURL}/api/v0/models`, { signal }),
      );
      return body.data
        .filter((m) => m.type !== 'embeddings')
        .map((m) => ({
          id: m.id,
          tools: m.capabilities ? m.capabilities.includes('tool_use') : true,
          free: true,
          // The context the model is loaded with, not the maximum it supports.
          ...(m.loaded_context_length || m.max_context_length
            ? { context: m.loaded_context_length || m.max_context_length }
            : {}),
        }));
    } catch (err) {
      // Older LM Studio, or another OpenAI-compatible server: the plain list.
      if (!(err instanceof ProviderHttpError) || err.status !== 404) throw err;
      const body = OpenAIModels.parse(
        await getJson(this.id, this.#fetch, `${this.baseURL}/v1/models`, { signal }),
      );
      return body.data
        .filter((m) => !/embed/i.test(m.id))
        .map((m) => ({ id: m.id, tools: true, free: true }));
    }
  }
}

export function createLocalProvider(options: LocalProviderOptions): LocalProvider {
  return new LocalProvider(options);
}
