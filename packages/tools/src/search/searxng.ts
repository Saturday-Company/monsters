import { ToolError } from '@monsters/shared';
import { z } from 'zod';
import { fetchFailure, httpError, withTimeout } from '../http.ts';
import type { SearchBackend, SearchOptions, SearchResult } from './types.ts';

/**
 * SearXNG instance (self-hosted metasearch). The instance must enable the JSON
 * format (`search.formats: [html, json]` in settings.yml).
 */

export interface SearxngOptions {
  /** Base URL of the instance, e.g. `http://127.0.0.1:8888`. */
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const SearxngResponseSchema = z.object({
  results: z.array(
    z.object({ title: z.string().optional(), url: z.string(), content: z.string().optional() }),
  ),
});

export class SearxngBackend implements SearchBackend {
  readonly id = 'searxng';
  readonly needsConfig = true;
  readonly #base: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: SearxngOptions) {
    if (!options.baseUrl) throw new Error('SearXNG needs the instance URL');
    this.#base = options.baseUrl.replace(/\/+$/, '');
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const url = new URL(`${this.#base}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    if (options.region) url.searchParams.set('language', options.region);
    let res: Response;
    try {
      res = await this.#fetch(url, {
        signal: withTimeout(options.signal, this.#timeoutMs),
        headers: { accept: 'application/json' },
      });
    } catch (err) {
      throw fetchFailure(err, options.signal, 'SearXNG search');
    }
    if (res.status === 403) {
      throw new ToolError('SITE_REFUSED', 'SearXNG refused the JSON format', {
        hint: 'Enable the json format in the SearXNG settings.yml (search.formats).',
      });
    }
    if (!res.ok) throw httpError(res.status, 'SearXNG search');
    const body = SearxngResponseSchema.parse(await res.json());
    return body.results.slice(0, options.limit).map((r) => ({
      title: (r.title ?? r.url).trim(),
      url: r.url,
      snippet: (r.content ?? '').replace(/\s+/g, ' ').trim(),
    }));
  }
}
