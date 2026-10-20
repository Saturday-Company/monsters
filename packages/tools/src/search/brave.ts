import { ToolError } from '@monsters/shared';
import { z } from 'zod';
import { fetchFailure, httpError, withTimeout } from '../http.ts';
import type { SearchBackend, SearchOptions, SearchResult } from './types.ts';

/** Brave Search API (needs a key; has a free plan with a monthly quota). */

export interface BraveOptions {
  apiKey: string;
  fetch?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
}

const BraveResponseSchema = z.object({
  web: z
    .object({
      results: z.array(
        z.object({ title: z.string(), url: z.string(), description: z.string().optional() }),
      ),
    })
    .optional(),
});

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export class BraveBackend implements SearchBackend {
  readonly id = 'brave';
  readonly needsConfig = true;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #endpoint: string;
  readonly #timeoutMs: number;

  constructor(options: BraveOptions) {
    if (!options.apiKey) throw new Error('Brave Search needs an API key');
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#endpoint = options.endpoint ?? 'https://api.search.brave.com/res/v1/web/search';
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const url = new URL(this.#endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(20, options.limit)));
    if (options.region) {
      // Region is DuckDuckGo-style `country-language` (`it-it`, `us-en`): Brave wants the country in capitals.
      const [country, lang] = options.region.split('-');
      if (country) url.searchParams.set('country', country.toUpperCase());
      if (lang) url.searchParams.set('search_lang', lang.toLowerCase());
    }
    let res: Response;
    try {
      res = await this.#fetch(url, {
        signal: withTimeout(options.signal, this.#timeoutMs),
        headers: { accept: 'application/json', 'x-subscription-token': this.#apiKey },
      });
    } catch (err) {
      throw fetchFailure(err, options.signal, 'Brave search');
    }
    if (res.status === 401 || res.status === 403) {
      throw new ToolError('NOT_LINKED', 'Brave Search rejected the API key', {
        hint: 'Ask the user to check the Brave Search key in Impostazioni → Collegamenti → Ricerca sul web.',
      });
    }
    if (!res.ok) throw httpError(res.status, 'Brave search');
    const body = BraveResponseSchema.parse(await res.json());
    return (body.web?.results ?? []).slice(0, options.limit).map((r) => ({
      title: stripTags(r.title),
      url: r.url,
      snippet: stripTags(r.description ?? ''),
    }));
  }
}
