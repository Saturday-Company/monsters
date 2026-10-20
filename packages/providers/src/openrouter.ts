import type { LanguageModelV4 } from '@ai-sdk/provider';
import { isOpenRouterFreeModel, OPENROUTER_FREE_ROUTER } from '@monsters/shared';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import {
  DAY_MS,
  MINUTE_MS,
  RateBudget,
  type DailyQuotaReport,
  type RateLimitWindow,
} from './rate-budget.ts';
import { PaidModelBlockedError } from './errors.ts';
import { keyFingerprint } from './key-id.ts';
import type { ListModelsOptions, ModelInfo, ModelProvider } from './types.ts';
import type { ModelPrice, PriceTier } from './cost.ts';

/*
 * OpenRouter (DECISIONS D-004): free models (`:free`, `openrouter/free`) and paid
 * ones. The model list is read at runtime from `/api/v1/models` (the free catalog
 * changes month by month) and cached.
 */

export { isOpenRouterFreeModel, OPENROUTER_FREE_ROUTER };
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Free tier limits (research 02 §1): 20/min, 50/day without credits, 1000/day with ≥ 10 $. */
export const OPENROUTER_FREE_LIMITS = { rpm: 20, rpd: 50 } as const;

export interface OpenRouterProviderOptions {
  apiKey: string;
  /** Provider id in the registry. Default `openrouter`. */
  id?: string;
  baseURL?: string;
  /** Refuse non-free models (spending cap 0 $). Default false. Can change later: `setFreeOnly`. */
  freeOnly?: boolean;
  /** Requests per minute shared by all agents. Default 20. */
  rpm?: number;
  /** Requests per day shared by all agents. Default 50 (1000 after a 10 $ top-up). */
  rpd?: number;
  /**
   * `rpd` is only a default: the daily limit OpenRouter reports for the account
   * (`free_model_daily_requests.limit`) replaces it, even when higher. When
   * false (an `rpd` chosen by the user) the lower of the two wins. Default false.
   */
  followAccountRpd?: boolean;
  /** See `RateBudgetOptions.maxWaitMs`. */
  maxWaitMs?: number;
  /** Cache of the model list. Default 1 hour. */
  modelsTtlMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  /** Shown in OpenRouter's app rankings. */
  appName?: string;
  appUrl?: string;
}

const ModelsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      context_length: z.number().nullable().optional(),
      supported_parameters: z.array(z.string()).nullable().optional(),
      pricing: z.record(z.string(), z.unknown()).nullable().optional(),
      architecture: z
        .object({ input_modalities: z.array(z.string()).nullable().optional() })
        .nullable()
        .optional(),
    }),
  ),
});

const KeyQuotaSchema = z.object({
  data: z.object({
    free_model_daily_requests: z
      .object({
        used: z.number().int().nonnegative(),
        limit: z.number().int().nonnegative().optional(),
        remaining: z.number().optional(),
      })
      .nullable()
      .optional(),
  }),
});

function isZeroPricing(pricing: Record<string, unknown> | null | undefined): boolean {
  if (!pricing) return false;
  const values = ['prompt', 'completion'].map((k) => pricing[k]);
  return values.every((v) => v !== undefined && Number(v) === 0);
}

/** OpenRouter's prices (USD per token, as strings) in USD per million tokens, cache included. */
export function pricePerMillion(
  pricing: Record<string, unknown> | null | undefined,
): ModelPrice | undefined {
  if (!pricing) return undefined;
  const input = Number(pricing['prompt']);
  const output = Number(pricing['completion']);
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0)
    return undefined;
  const optional = (key: string) => {
    const raw = pricing[key];
    if (raw === undefined || raw === null || raw === '') return undefined;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v * 1e6 : undefined;
  };
  const cacheRead = optional('input_cache_read');
  const cacheWrite = optional('input_cache_write');
  const tiers = priceTiers(pricing['overrides']);
  return {
    input: input * 1e6,
    output: output * 1e6,
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
    ...(tiers.length ? { tiers } : {}),
  };
}

/**
 * OpenRouter's `pricing.overrides` (`[{ min_prompt_tokens: 200000, prompt, completion, … }]`,
 * Gemini Pro and Claude Sonnet 4.5 above 200k tokens of input) as price tiers per million
 * tokens. An override without a threshold or with a price that does not read is left out.
 */
function priceTiers(raw: unknown): PriceTier[] {
  if (!Array.isArray(raw)) return [];
  const out: PriceTier[] = [];
  for (const o of raw as unknown[]) {
    if (!o || typeof o !== 'object') continue;
    const rec = o as Record<string, unknown>;
    const min = Number(rec['min_prompt_tokens']);
    if (!Number.isFinite(min) || min <= 0) continue;
    const tier: PriceTier = { minInputTokens: min };
    let ok = true;
    for (const [key, field] of [
      ['prompt', 'input'],
      ['completion', 'output'],
      ['input_cache_read', 'cacheRead'],
      ['input_cache_write', 'cacheWrite'],
    ] as const) {
      const v = rec[key];
      if (v === undefined || v === null || v === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) ok = false;
      else tier[field] = n * 1e6;
    }
    if (ok && (tier.input !== undefined || tier.output !== undefined)) out.push(tier);
  }
  return out.sort((a, b) => a.minInputTokens - b.minInputTokens);
}

export class OpenRouterProvider implements ModelProvider {
  readonly kind = 'model';
  readonly auth = 'api-key';
  readonly id: string;
  readonly budget: RateBudget;
  /** Fingerprint of the key: the daily quota belongs to the key's account. */
  readonly keyId: string;
  readonly #sdk: ReturnType<typeof createOpenRouter>;
  readonly #baseURL: string;
  readonly #apiKey: string;
  #freeOnly: boolean;
  readonly #followAccountRpd: boolean;
  readonly #ttl: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  #cache: { at: number; models: ModelInfo[] } | null = null;

  constructor(options: OpenRouterProviderOptions) {
    if (!options.apiKey) throw new Error('OpenRouter needs an API key');
    this.id = options.id ?? 'openrouter';
    this.#baseURL = (options.baseURL ?? OPENROUTER_BASE_URL).replace(/\/+$/, '');
    this.#apiKey = options.apiKey;
    this.keyId = keyFingerprint(options.apiKey);
    this.#freeOnly = options.freeOnly ?? false;
    this.#followAccountRpd = options.followAccountRpd ?? false;
    this.#ttl = options.modelsTtlMs ?? 3_600_000;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    const windows: RateLimitWindow[] = [
      { limit: options.rpm ?? OPENROUTER_FREE_LIMITS.rpm, windowMs: MINUTE_MS },
      // OpenRouter counts free requests per UTC day (reset at midnight UTC).
      { limit: options.rpd ?? OPENROUTER_FREE_LIMITS.rpd, windowMs: DAY_MS, reset: 'utc-day' },
    ];
    this.budget = new RateBudget({
      id: this.id,
      windows,
      // The windows are OpenRouter's limits of the free models: paid requests are not in them.
      counts: (model) => isOpenRouterFreeModel(model),
      ...(options.maxWaitMs !== undefined ? { maxWaitMs: options.maxWaitMs } : {}),
      now: this.#now,
    });
    this.#sdk = createOpenRouter({
      apiKey: options.apiKey,
      baseURL: this.#baseURL,
      compatibility: 'strict',
      fetch: this.#fetch,
      appName: options.appName ?? 'Monsters',
      ...(options.appUrl !== undefined ? { appUrl: options.appUrl } : {}),
    });
  }

  /** Paid models are refused (spending cap 0 $). */
  get freeOnly(): boolean {
    return this.#freeOnly;
  }

  /**
   * Turns paid models on or off at once, without a new provider: the budget,
   * the queue and the sessions of running agents stay as they are.
   */
  setFreeOnly(freeOnly: boolean): void {
    this.#freeOnly = freeOnly;
  }

  model(modelId: string): LanguageModelV4 {
    if (this.#freeOnly && !isOpenRouterFreeModel(modelId)) {
      throw new PaidModelBlockedError(modelId);
    }
    return this.#sdk.chat(modelId, { extraBody: { plugins: OPENROUTER_PLUGINS } });
  }

  /** OpenRouter forwards `cache_control` to Anthropic's models, which cache only what is marked. */
  promptCache(modelId: string): boolean {
    return modelId.startsWith('anthropic/');
  }

  /**
   * The free router answers with the concrete model it picked. Pin that one,
   * forcing the `:free` variant so a pinned model can never become a paid one.
   */
  servedModelId(requested: string, served: string | undefined): string | undefined {
    if (!served || served === requested) return undefined;
    if (isOpenRouterFreeModel(requested) && !served.endsWith(':free')) return `${served}:free`;
    return served;
  }

  /**
   * Reads OpenRouter's own count of today's free requests (`GET /key`: not a
   * model request, it spends no quota) and hands it to the budget. Only for a
   * free-only provider, whose requests are all counted there. Never throws:
   * without an answer the budget keeps what it restored from the log.
   */
  async syncDailyQuota(
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<DailyQuotaReport | null> {
    if (!this.#freeOnly) return null;
    const timeoutMs = options.timeoutMs ?? 5000;
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Raced as well as aborted: a fetch or a body that ignores the signal cannot hold it.
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        stop.abort(new DOMException('timeout', 'TimeoutError'));
        resolve(null);
      }, timeoutMs);
    });
    const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal;
    try {
      return await Promise.race([this.#readDailyQuota(signal), timeout]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async #readDailyQuota(signal: AbortSignal): Promise<DailyQuotaReport | null> {
    // Before the call: requests granted while it is in flight count on top of `used`.
    const at = this.#now();
    const res = await this.#fetch(`${this.#baseURL}/key`, {
      headers: { authorization: `Bearer ${this.#apiKey}`, accept: 'application/json' },
      signal,
    });
    if (!res.ok) return null;
    const parsed = KeyQuotaSchema.safeParse(await res.json());
    const daily = parsed.success ? parsed.data.data.free_model_daily_requests : undefined;
    if (!daily || signal.aborted) return null;
    const report: DailyQuotaReport = {
      used: daily.used,
      at,
      ...(daily.limit !== undefined ? { limit: daily.limit } : {}),
      limitMode: this.#followAccountRpd ? 'replace' : 'cap',
    };
    // Dropped when the read started yesterday (UTC) and ended today.
    return this.budget.syncDailyQuota(report) ? report : null;
  }

  async listModels(options: ListModelsOptions = {}): Promise<ModelInfo[]> {
    const now = this.#now();
    if (options.refresh || !this.#cache || now - this.#cache.at > this.#ttl) {
      this.#cache = { at: now, models: await this.#fetchModels(options.signal) };
    }
    return this.#cache.models.filter(
      (m) =>
        (options.tools === undefined || m.tools === options.tools) &&
        (options.free === undefined || m.free === options.free),
    );
  }

  async #fetchModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await this.#fetch(`${this.#baseURL}/models`, {
      headers: { authorization: `Bearer ${this.#apiKey}`, accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new Error(`OpenRouter model list failed: HTTP ${res.status}`);
    const body = ModelsResponseSchema.parse(await res.json());
    return body.data.map((m) => {
      const info: ModelInfo = {
        id: m.id,
        tools: (m.supported_parameters ?? []).includes('tools'),
        free: isOpenRouterFreeModel(m.id) || isZeroPricing(m.pricing),
      };
      if (m.name) info.name = m.name;
      if (m.context_length) info.context = m.context_length;
      const input = m.architecture?.input_modalities;
      if (input?.length) info.input = input;
      const price = pricePerMillion(m.pricing);
      if (price) info.price = price;
      return info;
    });
  }
}

/**
 * Plugins of every chat request (C.2, D-075): context compression ("middle-out")
 * off, also on the small models where OpenRouter turns it on by itself. It cuts
 * the middle of the conversation without a word; the core manages the context.
 */
export const OPENROUTER_PLUGINS = [{ id: 'context-compression', enabled: false }] as const;

export function createOpenRouterProvider(options: OpenRouterProviderOptions): OpenRouterProvider {
  return new OpenRouterProvider(options);
}
