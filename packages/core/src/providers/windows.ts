import {
  knownContextWindow,
  openRouterSlugsFor,
  twinPrice,
  type ModelPrice,
  type ProviderRegistry,
} from '@monsters/providers';
import type { StateStore } from '../db/state-store.ts';

/*
 * Context windows of the models in use (C.1, D-075), for the `context` of
 * every step and the Consumi panel. The agent loop needs the answer at once,
 * so `get` is synchronous: it reads what the providers' model lists said
 * (fetched in the background the first time a provider is asked, then kept
 * for an hour) and, before that or when a list is silent, the documented
 * values of `knownContextWindow`. `resolve` waits for the list (the endpoint).
 *
 * Prices: the provider's own list (OpenRouter) or, for a direct key of
 * Anthropic, OpenAI or Google whose list has none, the price of the same model
 * on OpenRouter's public list (exact twin, `openRouterSlugsFor`, D-114). That
 * list is read without a key, kept for an hour like the others, and saved in
 * the state for a start offline.
 */

const TTL_MS = 3_600_000;
const LIST_TIMEOUT_MS = 8000;
const RETRY_MS = 60_000;

interface Entry {
  at: number;
  windows: Map<string, number>;
  /** What each model reads besides text, as the list says (files feature, D-075). */
  inputs: Map<string, string[]>;
  /** USD per million tokens, when the list says it (C.3: the cheapest model for a summary). */
  prices: Map<string, ModelPrice>;
}

/** The state key of the last public list of OpenRouter's prices. */
export const PUBLIC_PRICES_KEY = 'openrouter_public_prices';

interface SavedPrices {
  at: number;
  prices: Record<string, ModelPrice>;
}

export interface ModelWindowsOptions {
  now?: () => number;
  /** OpenRouter's public prices (`fetchOpenRouterPrices`); null: the direct keys stay unpriced. */
  publicPrices?: ((signal: AbortSignal) => Promise<Map<string, ModelPrice>>) | null;
  /** Where the public prices are kept between two starts. */
  state?: StateStore;
}

export class ModelWindows {
  readonly #registry: ProviderRegistry;
  readonly #now: () => number;
  readonly #lists = new Map<string, Entry>();
  readonly #loading = new Map<string, Promise<void>>();
  readonly #publicPrices: ModelWindowsOptions['publicPrices'];
  readonly #state: StateStore | undefined;
  /** OpenRouter's public prices: when they were read, and the list (kept while a new one is read). */
  #public: { at: number; prices: Map<string, ModelPrice> } = { at: 0, prices: new Map() };
  #publicLoading: Promise<void> | null = null;

  constructor(registry: ProviderRegistry, options: (() => number) | ModelWindowsOptions = {}) {
    const o = typeof options === 'function' ? { now: options } : options;
    this.#registry = registry;
    this.#now = o.now ?? Date.now;
    this.#publicPrices = o.publicPrices ?? null;
    this.#state = o.state;
    const saved = o.state?.get<SavedPrices>(PUBLIC_PRICES_KEY);
    if (saved && typeof saved.at === 'number' && saved.prices && typeof saved.prices === 'object') {
      this.#public = { at: saved.at, prices: new Map(Object.entries(saved.prices)) };
    }
  }

  /** The window of `model` on `provider`, when known now. */
  get(provider: string, model: string): number | undefined {
    const entry = this.#lists.get(provider);
    if (!entry || this.#now() - entry.at > TTL_MS) void this.#load(provider);
    return entry?.windows.get(model) ?? knownContextWindow(provider, model);
  }

  /** What `model` reads besides text according to the provider's list; undefined when unknown. */
  inputs(provider: string, model: string): string[] | undefined {
    const entry = this.#lists.get(provider);
    if (!entry || this.#now() - entry.at > TTL_MS) void this.#load(provider);
    return entry?.inputs.get(model);
  }

  /**
   * The price of `model` (USD per million tokens): its provider's list, or the
   * price of its exact twin on OpenRouter's public list (a direct key, D-114).
   */
  price(provider: string, model: string): ModelPrice | undefined {
    const entry = this.#lists.get(provider);
    if (!entry || this.#now() - entry.at > TTL_MS) void this.#load(provider);
    const own = entry?.prices.get(model);
    if (own || !this.#publicPrices || openRouterSlugsFor(provider, model).length === 0) return own;
    if (this.#now() - this.#public.at > TTL_MS) void this.#loadPublic();
    return twinPrice(provider, model, this.#public.prices);
  }

  /** Like `price`, after OpenRouter's public list answered (or failed). */
  async resolvePrice(provider: string, model: string): Promise<ModelPrice | undefined> {
    const entry = this.#lists.get(provider);
    if (!entry || this.#now() - entry.at > TTL_MS) await this.#load(provider);
    if (this.#publicPrices && this.#now() - this.#public.at > TTL_MS) await this.#loadPublic();
    return this.price(provider, model);
  }

  #loadPublic(): Promise<void> {
    if (this.#publicLoading) return this.#publicLoading;
    const read = this.#publicPrices;
    if (!read) return Promise.resolve();
    const p = (async () => {
      const at = this.#now();
      try {
        const prices = await read(AbortSignal.timeout(LIST_TIMEOUT_MS));
        this.#public = { at, prices };
        this.#state?.set(PUBLIC_PRICES_KEY, {
          at,
          prices: Object.fromEntries(prices),
        } satisfies SavedPrices);
      } catch {
        // Offline: the copy of the last start (or none), a new try in a minute.
        this.#public = { ...this.#public, at: at - TTL_MS + RETRY_MS };
      }
    })().finally(() => {
      this.#publicLoading = null;
    });
    this.#publicLoading = p;
    return p;
  }

  /** Like `get`, after the provider's list answered (or failed). */
  async resolve(provider: string, model: string): Promise<number | undefined> {
    const entry = this.#lists.get(provider);
    if (!entry || this.#now() - entry.at > TTL_MS) await this.#load(provider);
    return this.get(provider, model);
  }

  #load(provider: string): Promise<void> {
    const running = this.#loading.get(provider);
    if (running) return running;
    if (!this.#registry.has(provider)) return Promise.resolve();
    const p = (async () => {
      const windows = new Map<string, number>();
      const inputs = new Map<string, string[]>();
      const prices = new Map<string, ModelPrice>();
      let at = this.#now();
      try {
        const models = await this.#registry
          .get(provider)
          .listModels({ signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
        for (const m of models) {
          if (m.context) windows.set(m.id, m.context);
          if (m.input) inputs.set(m.id, m.input);
          if (m.price) prices.set(m.id, m.price);
        }
      } catch {
        // No list now (offline, key removed): the documented values, a new try in a minute.
        at = at - TTL_MS + RETRY_MS;
      }
      this.#lists.set(provider, { at, windows, inputs, prices });
    })().finally(() => this.#loading.delete(provider));
    this.#loading.set(provider, p);
    return p;
  }
}
