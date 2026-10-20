import type { ListModelsOptions, ModelInfo } from './types.ts';

/*
 * Small HTTP helpers shared by the providers that list their models
 * themselves (keyed and local providers).
 */

/** A provider endpoint answered with an HTTP error (or could not be reached: status 0). */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly provider: string;
  constructor(provider: string, status: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProviderHttpError';
    this.provider = provider;
    this.status = status;
  }
}

/**
 * GET returning JSON. Errors never carry the request headers (the key) nor
 * the URL query: only the provider, the status and the start of the body.
 */
export async function getJson(
  provider: string,
  doFetch: typeof fetch,
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal; method?: string; body?: string },
): Promise<unknown> {
  let res: Response;
  try {
    res = await doFetch(url, {
      method: init.method ?? 'GET',
      headers: { accept: 'application/json', ...init.headers },
      ...(init.body !== undefined ? { body: init.body } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'))
      throw err;
    throw new ProviderHttpError(provider, 0, `${provider} unreachable`, { cause: err });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderHttpError(
      provider,
      res.status,
      `${provider} answered ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
    );
  }
  try {
    return await res.json();
  } catch (err) {
    throw new ProviderHttpError(provider, res.status, `${provider}: invalid answer`, {
      cause: err,
    });
  }
}

interface SharedLoad {
  promise: Promise<ModelInfo[]>;
  controller: AbortController;
  /** Callers still waiting: when the last one stops, the request is aborted. */
  waiting: number;
}

/** Model list cached for `ttlMs`, filtered per request. */
export class ModelCache {
  readonly #ttl: number;
  readonly #now: () => number;
  #cache: { at: number; models: ModelInfo[] } | null = null;
  #inflight: SharedLoad | null = null;

  constructor(ttlMs: number, now: () => number) {
    this.#ttl = ttlMs;
    this.#now = now;
  }

  async get(
    options: ListModelsOptions,
    load: (signal?: AbortSignal) => Promise<ModelInfo[]>,
  ): Promise<ModelInfo[]> {
    const now = this.#now();
    if (options.refresh || !this.#cache || now - this.#cache.at > this.#ttl) {
      const models = await this.#join(load, options.signal);
      this.#cache = { at: now, models };
    }
    return filterModels(this.#cache.models, options);
  }

  /**
   * One request at a time: concurrent callers share it. The request has its
   * own signal, aborted only when every caller has stopped waiting; each
   * caller stops waiting with its own signal without failing the others.
   */
  #join(load: (signal?: AbortSignal) => Promise<ModelInfo[]>, signal?: AbortSignal) {
    signal?.throwIfAborted();
    let shared = this.#inflight;
    if (!shared) {
      const controller = new AbortController();
      const created: SharedLoad = {
        controller,
        waiting: 0,
        promise: load(controller.signal).finally(() => {
          if (this.#inflight === created) this.#inflight = null;
        }),
      };
      // Nobody may be listening when the last caller left: avoid an unhandled rejection.
      created.promise.catch(() => {});
      this.#inflight = shared = created;
    }
    const current = shared;
    current.waiting++;
    if (!signal) return current.promise;
    return new Promise<ModelInfo[]>((resolve, reject) => {
      const onAbort = () => {
        current.waiting--;
        if (current.waiting === 0) {
          if (this.#inflight === current) this.#inflight = null;
          current.controller.abort(signal.reason);
        }
        reject(signal.reason as Error);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      current.promise
        .finally(() => signal.removeEventListener('abort', onAbort))
        .then(resolve, reject);
    });
  }

  clear(): void {
    this.#cache = null;
  }
}

export function filterModels(models: ModelInfo[], options: ListModelsOptions): ModelInfo[] {
  return models.filter(
    (m) =>
      (options.tools === undefined || m.tools === options.tools) &&
      (options.free === undefined || m.free === options.free),
  );
}
