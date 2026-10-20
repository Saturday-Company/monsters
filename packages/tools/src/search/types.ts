import type { SearchUsage } from './openrouter.ts';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Set when the results come from a single site rather than the whole web (e.g. `wikipedia`). */
  source?: string;
}

export interface SearchOptions {
  limit: number;
  signal: AbortSignal;
  /** Region hint as `country-language`, e.g. `it-it` or `us-en` (DuckDuckGo `kl`; Brave `country` and `search_lang`). */
  region?: string;
  /** Called once per paid search with what it cost (D-071); free backends never call it. */
  onUsage?: (usage: SearchUsage) => void;
}

/**
 * A web search engine behind `web_search` (DECISIONS D-016). Implementations
 * throw `ToolError` for failures the model should see (blocked, rate limited).
 */
export interface SearchBackend {
  /** Stable id (`openrouter-parallel`, `duckduckgo`, `brave`, `searxng`, `wikipedia`). */
  readonly id: string;
  /** Whether it needs a key or an instance configured by the user. */
  readonly needsConfig: boolean;
  /**
   * What it searches: the whole web (default) or only an encyclopedia
   * (Wikipedia). `web_search` tells the agent when results are not from the web.
   */
  readonly coverage?: 'web' | 'encyclopedia';
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
}
