import { ToolError } from '@monsters/shared';
import { parse } from 'node-html-parser';
import { z } from 'zod';
import { fetchFailure, httpError, monstersUserAgent, withTimeout } from '../http.ts';
import type { SearchBackend, SearchOptions, SearchResult } from './types.ts';

/*
 * Keyless last resort (DECISIONS D-016): the search API of Wikipedia
 * (`<lang>.wikipedia.org/w/api.php?action=query&list=search`). Reliable and
 * free, but it only covers Wikipedia: results carry `source: 'wikipedia'` and
 * the backend declares `coverage: 'encyclopedia'`, so `web_search` tells the
 * agent. Wikimedia asks for an identifying User-Agent.
 */

export interface WikipediaOptions {
  /**
   * Language of the first search. A string is fixed (a chain configured by hand); a function,
   * or nothing, is read at every call, like the region (the user may change language): without
   * a configured language it is the language of the call's region (`us-en` → `en`), then `it`.
   */
  lang?: string | (() => string | undefined);
  /** Second language tried when the first gives few results. Default `en`; `null` to turn off. */
  fallbackLang?: string | null;
  /** Below this many results (capped at the requested limit) the fallback language is tried. Default 3. */
  minResults?: number;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Default `Monsters/<version> (https://github.com/Saturday-Company/monsters)`. */
  userAgent?: string;
}

const LANG_RE = /^[a-z]{2,3}(-[a-z]{2,10})?$/;

const WikipediaResponseSchema = z.object({
  query: z
    .object({
      search: z.array(z.object({ title: z.string(), snippet: z.string().optional() })),
    })
    .optional(),
  error: z.object({ code: z.string(), info: z.string().optional() }).optional(),
});

function checkLang(lang: string): string {
  const l = lang.trim().toLowerCase();
  if (!LANG_RE.test(l)) throw new Error(`invalid Wikipedia language: ${lang}`);
  return l;
}

/** Plain text of an API snippet: drops the `searchmatch` spans and decodes entities. */
function cleanSnippet(html: string): string {
  return parse(html).text.replace(/\s+/g, ' ').trim();
}

export function wikipediaArticleUrl(lang: string, title: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** Maps a `list=search` response (JSON) to results. Exported for tests. */
export function parseWikipediaSearch(body: unknown, lang: string): SearchResult[] {
  const parsed = WikipediaResponseSchema.parse(body);
  if (parsed.error) {
    throw new ToolError('UNAVAILABLE', `Wikipedia: ${parsed.error.info ?? parsed.error.code}`);
  }
  return (parsed.query?.search ?? []).map((r) => ({
    title: r.title,
    url: wikipediaArticleUrl(lang, r.title),
    snippet: cleanSnippet(r.snippet ?? ''),
    source: 'wikipedia',
  }));
}

export class WikipediaBackend implements SearchBackend {
  readonly id = 'wikipedia';
  readonly needsConfig = false;
  readonly coverage = 'encyclopedia';
  readonly #lang: string | (() => string | undefined) | undefined;
  readonly #fallbackLang: string | null;
  readonly #minResults: number;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #userAgent: string;

  constructor(options: WikipediaOptions = {}) {
    this.#lang = typeof options.lang === 'string' ? checkLang(options.lang) : options.lang;
    const fallback = options.fallbackLang === undefined ? 'en' : options.fallbackLang;
    this.#fallbackLang = fallback ? checkLang(fallback) : null;
    this.#minResults = options.minResults ?? 3;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#userAgent = options.userAgent ?? monstersUserAgent();
  }

  /** The language of this call: the configured one, else the region's, else `it`. */
  #langFor(options: SearchOptions): string {
    if (typeof this.#lang === 'string') return this.#lang;
    const wanted = this.#lang?.() ?? options.region?.split('-')[1];
    const l = wanted?.trim().toLowerCase();
    return l && LANG_RE.test(l) ? l : 'it';
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const lang = this.#langFor(options);
    const fallbackLang = this.#fallbackLang !== lang ? this.#fallbackLang : null;
    const first = await this.#query(lang, query, options);
    if (!fallbackLang || first.length >= Math.min(this.#minResults, options.limit)) {
      return first;
    }
    let more: SearchResult[];
    try {
      more = await this.#query(fallbackLang, query, options);
    } catch (err) {
      if (options.signal.aborted || first.length === 0) throw err;
      return first;
    }
    const seen = new Set(first.map((r) => r.url));
    return [...first, ...more.filter((r) => !seen.has(r.url))].slice(0, options.limit);
  }

  async #query(lang: string, query: string, options: SearchOptions): Promise<SearchResult[]> {
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    url.search = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: String(Math.min(20, options.limit)),
      srprop: 'snippet',
      format: 'json',
      formatversion: '2',
      utf8: '1',
    }).toString();
    let res: Response;
    let body: unknown;
    try {
      res = await this.#fetch(url, {
        signal: withTimeout(options.signal, this.#timeoutMs),
        headers: { accept: 'application/json', 'user-agent': this.#userAgent },
      });
      if (!res.ok) throw httpError(res.status, 'Wikipedia search');
      body = await res.json();
    } catch (err) {
      throw fetchFailure(err, options.signal, 'Wikipedia search');
    }
    return parseWikipediaSearch(body, lang).slice(0, options.limit);
  }
}
