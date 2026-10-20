import { ProviderRemovedError, UnknownProviderError } from './errors.ts';
import { ModelSession, type SessionEvent } from './session.ts';
import type { ModelProvider, ModelRef, Provider } from './types.ts';

export interface SessionOptions {
  pin?: boolean;
  onEvent?: (event: SessionEvent) => void;
  /** See `ModelSessionOptions.firstChunkMs`. */
  firstChunkMs?: number;
  /** See `ModelSessionOptions.idleChunkMs`. */
  idleChunkMs?: number;
}

/**
 * The configured providers. One instance per core: budgets live on the
 * providers, so every agent shares them.
 */
export class ProviderRegistry {
  readonly #providers = new Map<string, Provider>();

  register(provider: Provider): this {
    if (this.#providers.has(provider.id)) {
      throw new Error(`provider "${provider.id}" is already registered`);
    }
    this.#providers.set(provider.id, provider);
    return this;
  }

  /**
   * Removes a provider (key deleted, or about to be replaced by a new one).
   * Requests queued on its budget fail with `ProviderRemovedError`, so their
   * session falls back to the next provider of the chain.
   */
  unregister(id: string): boolean {
    const p = this.#providers.get(id);
    const removed = this.#providers.delete(id);
    p?.budget.clear(new ProviderRemovedError(id));
    return removed;
  }

  has(id: string): boolean {
    return this.#providers.has(id);
  }

  get(id: string): Provider {
    const p = this.#providers.get(id);
    if (!p) throw new UnknownProviderError(id);
    return p;
  }

  modelProvider(id: string): ModelProvider {
    const p = this.get(id);
    if (p.kind !== 'model') throw new Error(`provider "${id}" is a harness, not a model provider`);
    return p;
  }

  list(): Provider[] {
    return [...this.#providers.values()];
  }

  /**
   * A model session over a fallback chain. Links whose provider is not
   * configured are dropped; at least one must remain.
   */
  session(chain: ModelRef[], options: SessionOptions = {}): ModelSession {
    const usable = chain.filter((r) => {
      const p = this.#providers.get(r.provider);
      return p !== undefined && p.kind === 'model';
    });
    if (usable.length === 0) {
      const wanted = [...new Set(chain.map((r) => r.provider))].join(', ') || 'none';
      throw new UnknownProviderError(wanted);
    }
    return new ModelSession({
      chain: usable,
      resolve: (id) => this.modelProvider(id),
      ...(options.pin !== undefined ? { pin: options.pin } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      ...(options.firstChunkMs !== undefined ? { firstChunkMs: options.firstChunkMs } : {}),
      ...(options.idleChunkMs !== undefined ? { idleChunkMs: options.idleChunkMs } : {}),
    });
  }

  /** Rejects every queued request on every provider (wire to the kill switch). */
  clearQueues(reason?: unknown): void {
    for (const p of this.#providers.values()) p.budget.clear(reason);
  }
}
