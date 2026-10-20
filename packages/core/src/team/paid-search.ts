import type {
  PaidSearchEngineName,
  WebSearchSettings,
  WebSearchSettingsRequest,
} from '@monsters/shared';
import { OpenRouterSearchBackend, paidSearchCostUsd, type SearchBackend } from '@monsters/tools';
import { patchSettingsFile } from '../onboarding/settings-file.ts';
import type { OpenRouterKeyInfo } from './openrouter-key.ts';
import type { HubSettings } from './settings.ts';

/*
 * Paid web search on OpenRouter (D-071). It goes first in the `web_search`
 * chain when:
 *   - the user turned it on (`on`), or left `auto` and allows paid models
 *     (`openrouter.freeOnly` off): a free-only setup never spends by itself;
 *   - there is an OpenRouter key, and the key is not known to be without
 *     credit (`/key`: spending cap reached or account on the free tier).
 * A 402 at search time skips it for 30 minutes (the backend's own cooldown):
 * the free chain (DuckDuckGo, Wikipedia) takes over without asking.
 */

/** How long the key read from the secret store is kept (the keychain can be slow). */
const KEY_TTL_MS = 30_000;

export interface PaidSearchOptions {
  home: string;
  settings: Pick<HubSettings, 'paidSearch' | 'openrouter'>;
  /** The OpenRouter key in use, or null. */
  readKey: () => string | null;
  /** What `/key` said about it when it was saved, or null. */
  keyInfo: () => OpenRouterKeyInfo | null;
  fetch?: typeof fetch;
  /** The spending cap reached by the team or by this agent (D-070), or null. */
  spendCap?: (agentId?: string) => string | null;
  /** Writes `settings.json` (default: patch the file in `home`). */
  persist?: boolean;
  now?: () => number;
}

const REGION_OF_LANGUAGE: Record<string, string> = {
  it: 'it-it',
  en: 'us-en',
  es: 'es-es',
  fr: 'fr-fr',
  de: 'de-de',
};

/** The search region (`country-language`, DuckDuckGo `kl`) for a profile language id, or undefined. */
export function searchRegion(language: string | undefined): string | undefined {
  return language ? REGION_OF_LANGUAGE[language] : undefined;
}

/** No credit left on a key, from what OpenRouter said when it was saved. */
export function keyWithoutCredit(info: OpenRouterKeyInfo | null): boolean {
  if (!info) return false;
  if (info.isFreeTier === true) return true;
  return typeof info.limit === 'number' && info.limit - (info.usage ?? 0) <= 0;
}

export class PaidSearch {
  readonly #o: PaidSearchOptions;
  readonly #backends = new Map<PaidSearchEngineName, OpenRouterSearchBackend>();
  #key: { value: string | null; at: number } | null = null;

  constructor(options: PaidSearchOptions) {
    this.#o = options;
  }

  #now(): number {
    return (this.#o.now ?? Date.now)();
  }

  /** The key, read again at most every 30 s. */
  key(): string | null {
    const now = this.#now();
    if (!this.#key || now - this.#key.at > KEY_TTL_MS) {
      this.#key = { value: this.#o.readKey(), at: now };
    }
    return this.#key.value;
  }

  /** Forgets the cached key (it was saved or removed). */
  refresh(): void {
    this.#key = null;
  }

  #backend(engine: PaidSearchEngineName): OpenRouterSearchBackend {
    let b = this.#backends.get(engine);
    if (!b) {
      b = new OpenRouterSearchBackend({
        apiKey: () => this.key(),
        engine,
        ...(this.#o.fetch ? { fetch: this.#o.fetch } : {}),
      });
      this.#backends.set(engine, b);
    }
    return b;
  }

  status(): WebSearchSettings {
    const { mode, engine } = this.#o.settings.paidSearch;
    const usdPer1000 = {
      parallel: round(paidSearchCostUsd('parallel') * 1000),
      exa: round(paidSearchCostUsd('exa') * 1000),
    };
    const reason = this.#reason();
    return { mode, engine, active: reason === null, ...(reason ? { reason } : {}), usdPer1000 };
  }

  #reason(agentId?: string): WebSearchSettings['reason'] | null {
    const { mode, engine } = this.#o.settings.paidSearch;
    if (mode === 'off') return 'off';
    if (mode === 'auto' && this.#o.settings.openrouter.freeOnly) return 'free_only';
    if (!this.key()) return 'no_key';
    if (keyWithoutCredit(this.#o.keyInfo())) return 'no_credit';
    const kind = this.#backends.get(engine)?.blockedKind;
    if (kind) return kind;
    if (this.#o.spendCap?.(agentId)) return 'spend_cap';
    return null;
  }

  /**
   * The backend to put first in the chain of `agentId`'s searches, or null when
   * the paid search is not in use (off, no key or credit, a spending cap reached).
   */
  backend(agentId?: string): SearchBackend | null {
    return this.#reason(agentId) === null
      ? this.#backend(this.#o.settings.paidSearch.engine)
      : null;
  }

  /** Saves the user's choice in `settings.json` and applies it at once. */
  set(change: WebSearchSettingsRequest): WebSearchSettings {
    const next = { ...this.#o.settings.paidSearch };
    if (change.mode !== undefined) next.mode = change.mode;
    if (change.engine !== undefined) next.engine = change.engine;
    if (this.#o.persist !== false) patchSettingsFile(this.#o.home, { paidSearch: next });
    this.#o.settings.paidSearch = next;
    return this.status();
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
