import { ToolError } from '@monsters/shared';
import { parse } from 'node-html-parser';
import { BROWSER_USER_AGENT, fetchFailure, httpError, withTimeout } from '../http.ts';
import type { SearchBackend, SearchOptions, SearchResult } from './types.ts';

/*
 * Keyless default: the HTML endpoint of DuckDuckGo (html.duckduckgo.com/html).
 *
 * Fragile by nature (DECISIONS D-016): it is a page for browsers without
 * JavaScript, not an API. It can change markup, and it answers with an
 * "anomaly" CAPTCHA (HTTP 202) to traffic it considers automated — observed
 * from datacenter IPs and with some HTTP clients. When that happens the tool
 * returns UNAVAILABLE with a hint to configure Brave or SearXNG, and the
 * backend is skipped for a while (D-071): asking again at once only keeps the
 * block on, and each try costs the agent a slow round trip.
 */

export interface DuckDuckGoOptions {
  fetch?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
  userAgent?: string;
  /** After a CAPTCHA, how long the backend is skipped without asking. Default 15 min. */
  cooldownMs?: number;
  now?: () => number;
}

function decodeResultUrl(href: string): string | undefined {
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    // Older markup wraps links in a redirect: //duckduckgo.com/l/?uddg=<encoded>
    if (url.hostname.endsWith('duckduckgo.com') && url.pathname.startsWith('/l/')) {
      const target = url.searchParams.get('uddg');
      return target ?? undefined;
    }
    if (url.hostname.endsWith('duckduckgo.com')) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Parses the result page. Exported for tests (markup drift is the main risk). */
export function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const root = parse(html);
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const el of root.querySelectorAll('.result')) {
    if (el.classList.contains('result--ad')) continue;
    const link = el.querySelector('a.result__a');
    if (!link) continue;
    const url = decodeResultUrl(link.getAttribute('href') ?? '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({
      title: clean(link.textContent),
      url,
      snippet: clean(el.querySelector('.result__snippet')?.textContent ?? ''),
    });
  }
  return results;
}

/**
 * True when the page is DuckDuckGo's own "no results" page. An empty parse of
 * any other page means the markup changed: that is a failure, not "nothing found".
 */
export function isDuckDuckGoNoResults(html: string): boolean {
  return /class="[^"]*\bno-results\b|<div[^>]*class="[^"]*\bno_results\b|No results\.|Nessun risultato/i.test(
    html,
  );
}

export function isDuckDuckGoChallenge(status: number, html: string): boolean {
  return status === 202 || /anomaly-modal|anomaly\.js/.test(html);
}

export class DuckDuckGoBackend implements SearchBackend {
  readonly id = 'duckduckgo';
  readonly needsConfig = false;
  readonly #fetch: typeof fetch;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #userAgent: string;
  readonly #cooldownMs: number;
  readonly #now: () => number;
  #blockedUntil = 0;

  constructor(options: DuckDuckGoOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#endpoint = options.endpoint ?? 'https://html.duckduckgo.com/html/';
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#userAgent = options.userAgent ?? BROWSER_USER_AGENT;
    this.#cooldownMs = options.cooldownMs ?? 15 * 60_000;
    this.#now = options.now ?? Date.now;
  }

  /** Still blocked by the last CAPTCHA: skipped without a request. */
  get blocked(): boolean {
    return this.#blockedUntil > this.#now();
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    if (this.blocked) {
      throw new ToolError('UNAVAILABLE', 'DuckDuckGo asked for a CAPTCHA a few minutes ago', {
        hint: 'Retry later, or ask the user to turn on the paid search or configure a Brave Search key.',
      });
    }
    const body = new URLSearchParams({ q: query, b: '' });
    if (options.region) body.set('kl', options.region);
    let res: Response;
    let html: string;
    try {
      res = await this.#fetch(this.#endpoint, {
        method: 'POST',
        body,
        signal: withTimeout(options.signal, this.#timeoutMs),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': this.#userAgent,
          accept: 'text/html',
          'accept-language': 'it,en;q=0.8',
        },
      });
      html = await res.text();
    } catch (err) {
      throw fetchFailure(err, options.signal, 'DuckDuckGo search');
    }
    if (isDuckDuckGoChallenge(res.status, html)) {
      this.#blockedUntil = this.#now() + this.#cooldownMs;
      throw new ToolError(
        'UNAVAILABLE',
        'DuckDuckGo asked for a CAPTCHA (automated traffic detected)',
        {
          hint: 'Retry later, or ask the user to configure a Brave Search key or a SearXNG instance.',
        },
      );
    }
    if (!res.ok) throw httpError(res.status, 'DuckDuckGo search');
    const results = parseDuckDuckGoHtml(html).slice(0, options.limit);
    if (results.length === 0 && !isDuckDuckGoNoResults(html)) {
      throw new ToolError('UNAVAILABLE', 'DuckDuckGo answered a page Monsters does not recognise', {
        hint: 'The markup of DuckDuckGo may have changed. Ask the user to configure a Brave Search key or a SearXNG instance.',
      });
    }
    return results;
  }
}
