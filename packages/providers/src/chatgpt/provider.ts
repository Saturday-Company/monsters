import type { LanguageModelV4 } from '@ai-sdk/provider';
import type { PlanLimitsReading } from '@monsters/shared';
import { z } from 'zod';
import { ModelCache, getJson } from '../http.ts';
import { keyFingerprint } from '../key-id.ts';
import { RateBudget } from '../rate-budget.ts';
import type { ListModelsOptions, ModelInfo, ModelProvider } from '../types.ts';
import { ChatGPTResponsesModel } from './responses.ts';
import type { SiwcClient } from './siwc.ts';

/*
 * Provider `chatgpt` (model, D-005): the user's ChatGPT plan through Sign in
 * with ChatGPT. Our loop talks to the Responses API with the SIWC token; the
 * model list comes from `GET /v1/models` (entries with `visibility: "list"`,
 * server order). No limits are made up: plan errors stop the chain (D-035).
 */

const ModelsAnswer = z.object({
  models: z
    .array(
      z.object({
        slug: z.string().optional(),
        id: z.string().optional(),
        display_name: z.string().nullish(),
        visibility: z.string().nullish(),
        context_window: z.number().nullish(),
      }),
    )
    .optional(),
  data: z.array(z.object({ id: z.string() })).optional(),
});

export interface ChatGPTProviderOptions {
  client: SiwcClient;
  id?: string;
  fetch?: typeof fetch;
  now?: () => number;
  modelsTtlMs?: number;
  /** Where the plan's windows go when a response carries them (D-111, D-156). */
  onPlanLimits?: (reading: PlanLimitsReading) => void;
}

export class ChatGPTProvider implements ModelProvider {
  readonly kind = 'model';
  readonly auth = 'oauth-siwc';
  /** Never a silent fallback from the ChatGPT plan (D-035). */
  readonly stopsChain = true;
  readonly id: string;
  readonly budget: RateBudget;
  readonly keyId: string | undefined;
  readonly #client: SiwcClient;
  readonly #fetch: typeof fetch;
  readonly #models: ModelCache;
  readonly #onPlanLimits: ((reading: PlanLimitsReading) => void) | undefined;

  constructor(options: ChatGPTProviderOptions) {
    this.id = options.id ?? 'chatgpt';
    this.#client = options.client;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#onPlanLimits = options.onPlanLimits;
    const now = options.now ?? Date.now;
    this.#models = new ModelCache(options.modelsTtlMs ?? 3_600_000, now);
    // One account, one quota (shared with ChatGPT and Codex): never invented here.
    this.budget = new RateBudget({ id: this.id, windows: [], limitScope: 'account', now });
    const subject = options.client.account()?.subject;
    this.keyId = subject ? keyFingerprint(`chatgpt:${subject}`) : undefined;
  }

  get #base(): string {
    return this.#client.endpoints.resource.replace(/\/+$/, '');
  }

  model(modelId: string): LanguageModelV4 {
    return new ChatGPTResponsesModel({
      modelId,
      baseURL: this.#base,
      token: () => this.#client.accessToken(),
      fetch: this.#fetch,
      provider: this.id,
      ...(this.#onPlanLimits ? { onPlanLimits: this.#onPlanLimits } : {}),
    });
  }

  listModels(options: ListModelsOptions = {}): Promise<ModelInfo[]> {
    return this.#models.get(options, async (signal) => {
      const token = await this.#client.accessToken();
      const body = ModelsAnswer.parse(
        await getJson('ChatGPT', this.#fetch, `${this.#base}/models`, {
          headers: { authorization: `Bearer ${token}` },
          ...(signal ? { signal } : {}),
        }),
      );
      if (body.models) {
        return body.models
          .filter((m) => (m.visibility ?? 'list') === 'list' && (m.slug ?? m.id))
          .map((m) => {
            const info: ModelInfo = { id: (m.slug ?? m.id)!, tools: true, free: false };
            if (m.display_name) info.name = m.display_name;
            if (m.context_window) info.context = m.context_window;
            return info;
          });
      }
      return (body.data ?? []).map((m) => ({ id: m.id, tools: true, free: false }));
    });
  }
}
