import { readFileSync } from 'node:fs';
import { ToolError, type ToolContext, type ToolEmittedEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  BraveBackend,
  createSearchBackend,
  createWebSearchTool,
  defaultSearchBackends,
  DuckDuckGoBackend,
  parseDuckDuckGoHtml,
  parseWikipediaSearch,
  SEARCH_FALLBACK_CODE,
  SearxngBackend,
  WikipediaBackend,
  type SearchBackend,
} from '../src/index.ts';

function ctx(emitted: ToolEmittedEvent[] = []): ToolContext {
  return {
    agentId: 'rhea',
    runId: 'run-1',
    signal: new AbortController().signal,
    emit: (e) => emitted.push(e),
  };
}

// Real answer of it.wikipedia.org (October 2026), trimmed, plus some HTML entities.
const WIKI_IT: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/wikipedia-search-it.json', import.meta.url), 'utf8'),
);
const wikiEn = (titles: string[]) => ({
  query: { search: titles.map((title) => ({ title, snippet: `about <b>${title}</b>` })) },
});
const captcha = () =>
  Promise.resolve(new Response('<div class="anomaly-modal__mask"></div>', { status: 202 }));
const urlOf = (input: Parameters<typeof fetch>[0]) =>
  new URL(input instanceof Request ? input.url : input.toString());

// Trimmed copy of the html.duckduckgo.com markup (October 2026), plus an ad and an old-style redirect link.
const DDG_HTML = `<html><body><div id="links" class="results">
<div class="result results_links results_links_deep result--ad"><h2 class="result__title">
<a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=x">Annuncio</a></h2></div>
<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="https://vercel.com/ai-sdk">AI SDK - Vercel</a></h2>
<a class="result__snippet" href="https://vercel.com/ai-sdk">Build <b>AI</b> applications and agents with the <b>AI</b> <b>SDK</b>.</a>
</div></div>
<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fvercel%2Fai&amp;rut=abc">GitHub - vercel/ai</a></h2>
<a class="result__snippet">The AI Toolkit for TypeScript.</a></div></div>
<div class="result results_links web-result "><h2 class="result__title"><a class="result__a" href="https://vercel.com/ai-sdk">Duplicato</a></h2></div>
</div></body></html>`;

describe('DuckDuckGo backend', () => {
  it('parses organic results, skipping ads and duplicates, decoding redirects', () => {
    expect(parseDuckDuckGoHtml(DDG_HTML)).toEqual([
      {
        title: 'AI SDK - Vercel',
        url: 'https://vercel.com/ai-sdk',
        snippet: 'Build AI applications and agents with the AI SDK.',
      },
      {
        title: 'GitHub - vercel/ai',
        url: 'https://github.com/vercel/ai',
        snippet: 'The AI Toolkit for TypeScript.',
      },
    ]);
  });

  it('posts the query and reports the CAPTCHA page as UNAVAILABLE with a hint', async () => {
    let body = '';
    const ok = new DuckDuckGoBackend({
      fetch: (_url, init) => {
        body = (init?.body as URLSearchParams).toString();
        return Promise.resolve(new Response(DDG_HTML, { status: 200 }));
      },
    });
    const results = await ok.search('vercel ai', {
      limit: 1,
      signal: new AbortController().signal,
    });
    expect(body).toContain('q=vercel+ai');
    expect(results).toHaveLength(1);

    const blocked = new DuckDuckGoBackend({
      fetch: () =>
        Promise.resolve(new Response('<div class="anomaly-modal__mask"></div>', { status: 202 })),
    });
    const err = await blocked
      .search('x', { limit: 5, signal: new AbortController().signal })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err).toMatchObject({ code: 'UNAVAILABLE' });
    expect((err as ToolError).hint).toMatch(/Brave|SearXNG/);
  });
});

describe('configurable backends', () => {
  it('Brave: sends the key and maps results', async () => {
    let headers: Headers | undefined;
    const brave = new BraveBackend({
      apiKey: 'brave-key',
      fetch: (_url, init) => {
        headers = new Headers(init?.headers);
        return Promise.resolve(
          Response.json({
            web: {
              results: [
                { title: '<strong>Rea</strong>', url: 'https://a.example', description: 'luna' },
              ],
            },
          }),
        );
      },
    });
    const res = await brave.search('rea', { limit: 3, signal: new AbortController().signal });
    expect(headers?.get('x-subscription-token')).toBe('brave-key');
    expect(res).toEqual([{ title: 'Rea', url: 'https://a.example', snippet: 'luna' }]);
  });

  it('SearXNG: asks for JSON and maps results', async () => {
    let requested = '';
    const searx = new SearxngBackend({
      baseUrl: 'http://127.0.0.1:8888/',
      fetch: (url) => {
        requested = (url as URL).toString();
        return Promise.resolve(
          Response.json({
            results: [{ title: 'Dione', url: 'https://b.example', content: ' luna  di Saturno ' }],
          }),
        );
      },
    });
    const res = await searx.search('dione', { limit: 3, signal: new AbortController().signal });
    expect(requested).toBe('http://127.0.0.1:8888/search?q=dione&format=json');
    expect(res[0]).toEqual({
      title: 'Dione',
      url: 'https://b.example',
      snippet: 'luna di Saturno',
    });
  });

  it('builds backends from validated config', () => {
    expect(createSearchBackend({ backend: 'wikipedia', lang: 'en' }).id).toBe('wikipedia');
    expect(createSearchBackend({ backend: 'duckduckgo' }).id).toBe('duckduckgo');
    expect(createSearchBackend({ backend: 'brave', apiKey: 'k' }).id).toBe('brave');
    expect(createSearchBackend({ backend: 'searxng', baseUrl: 'http://127.0.0.1:8888' }).id).toBe(
      'searxng',
    );
  });
});

describe('web_search', () => {
  const failing = (code: 'UNAVAILABLE' | 'NOT_LINKED'): SearchBackend => ({
    id: 'broken',
    needsConfig: false,
    search: () => Promise.reject(new ToolError(code, 'nope')),
  });
  const working: SearchBackend = {
    id: 'ok',
    needsConfig: false,
    search: (q, o) =>
      Promise.resolve([{ title: q, url: 'https://x.example', snippet: String(o.limit) }]),
  };

  it('uses the next backend when one is unavailable', async () => {
    const tool = createWebSearchTool({ backends: [failing('UNAVAILABLE'), working] });
    const out = await tool.execute({ query: 'lune' }, ctx());
    expect(out).toEqual({
      query: 'lune',
      backend: 'ok',
      results: [{ title: 'lune', url: 'https://x.example', snippet: '5' }],
    });
  });

  it('falls through a 401/403 refusal to the next backend', async () => {
    const tool = createWebSearchTool({ backends: [failing('NOT_LINKED'), working] });
    const out = await tool.execute({ query: 'lune' }, ctx());
    expect(out).toMatchObject({ backend: 'ok' });
  });

  it('still fails with the refusal when every backend refuses', async () => {
    const tool = createWebSearchTool({ backends: [failing('NOT_LINKED')] });
    await expect(tool.execute({ query: 'lune' }, ctx())).rejects.toMatchObject({
      code: 'NOT_LINKED',
    });
  });
});

describe('Wikipedia backend', () => {
  it('parses the search API: article URL, snippet without HTML, source marked', () => {
    const results = parseWikipediaSearch(WIKI_IT, 'it');
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      title: 'Satelliti naturali di Saturno',
      url: 'https://it.wikipedia.org/wiki/Satelliti_naturali_di_Saturno',
      snippet: 'principale: Saturno (astronomia). Saturno Sistema di Saturno Parametri orbitali',
      source: 'wikipedia',
    });
    expect(results[1]!.url).toBe('https://it.wikipedia.org/wiki/Saturno_(astronomia)');
    expect(results[2]!.snippet).toBe(
      'verso Saturno, Bowman rende nuovamente operativa l\'astronave "Discovery" & HAL',
    );
    expect(() => parseWikipediaSearch({ error: { code: 'maxlag' } }, 'it')).toThrow(ToolError);
  });

  it('searches in Italian with an identifying User-Agent, then in English if results are few', async () => {
    const requests: { url: URL; ua: string | null }[] = [];
    const wiki = new WikipediaBackend({
      fetch: (input, init) => {
        const url = urlOf(input);
        requests.push({ url, ua: new Headers(init?.headers).get('user-agent') });
        return Promise.resolve(
          Response.json(
            url.hostname.startsWith('it.')
              ? { query: { search: [{ title: 'Encelado', snippet: 'luna' }] } }
              : wikiEn(['Enceladus', 'Encelado']),
          ),
        );
      },
    });
    const results = await wiki.search('encelado', {
      limit: 5,
      signal: new AbortController().signal,
    });
    expect(requests.map((r) => r.url.hostname)).toEqual(['it.wikipedia.org', 'en.wikipedia.org']);
    expect(requests[0]!.url.searchParams.get('srsearch')).toBe('encelado');
    expect(requests[0]!.url.searchParams.get('list')).toBe('search');
    expect(requests[0]!.ua).toMatch(
      /^Monsters\/\S+ \(https:\/\/github\.com\/Saturday-Company\/monsters\)$/,
    );
    expect(results.map((r) => r.url)).toEqual([
      'https://it.wikipedia.org/wiki/Encelado',
      'https://en.wikipedia.org/wiki/Enceladus',
      'https://en.wikipedia.org/wiki/Encelado',
    ]);

    // Enough results in Italian: English is not asked.
    let calls = 0;
    const enough = new WikipediaBackend({
      fetch: () => {
        calls++;
        return Promise.resolve(Response.json(WIKI_IT));
      },
    });
    const res = await enough.search('saturno', { limit: 3, signal: new AbortController().signal });
    expect(res).toHaveLength(3);
    expect(calls).toBe(1);
  });

  it('maps HTTP errors and keeps the Italian results if English fails', async () => {
    const limited = new WikipediaBackend({
      fetch: () => Promise.resolve(new Response('', { status: 429 })),
    });
    await expect(
      limited.search('x', { limit: 5, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    const half = new WikipediaBackend({
      fetch: (input) =>
        Promise.resolve(
          urlOf(input).hostname.startsWith('it.')
            ? Response.json({ query: { search: [{ title: 'Rea', snippet: '' }] } })
            : new Response('', { status: 503 }),
        ),
    });
    const res = await half.search('rea', { limit: 5, signal: new AbortController().signal });
    expect(res.map((r) => r.title)).toEqual(['Rea']);
  });
});

describe('default chain', () => {
  it('is DuckDuckGo → Wikipedia without a key, Brave first with one', () => {
    expect(defaultSearchBackends().map((b) => b.id)).toEqual(['duckduckgo', 'wikipedia']);
    expect(defaultSearchBackends({ braveKey: 'k' }).map((b) => b.id)).toEqual([
      'brave',
      'duckduckgo',
      'wikipedia',
    ]);
  });

  it("searches Wikipedia in the user's language, read at every call like the region", async () => {
    const hosts: string[] = [];
    const fakeFetch: typeof fetch = (input) => {
      const url = urlOf(input);
      hosts.push(url.hostname);
      if (url.hostname.endsWith('wikipedia.org')) return Promise.resolve(Response.json(WIKI_IT));
      return captcha();
    };
    let region: string | undefined = 'us-en';
    const tool = createWebSearchTool({
      backends: defaultSearchBackends({ fetch: fakeFetch }),
      region: () => region,
    });
    await tool.execute({ query: 'saturn moons', limit: 3 }, ctx());
    expect(hosts.filter((h) => h.endsWith('wikipedia.org'))).toEqual(['en.wikipedia.org']);

    // The user switches to Spanish: the next call asks es.wikipedia, then English if few.
    region = 'es-es';
    hosts.length = 0;
    await tool.execute({ query: 'lunas de saturno', limit: 3 }, ctx());
    expect(hosts.filter((h) => h.endsWith('wikipedia.org'))).toEqual(['es.wikipedia.org']);

    // No region yet (before the onboarding): Italian, as before.
    region = undefined;
    hosts.length = 0;
    await tool.execute({ query: 'lune di saturno', limit: 3 }, ctx());
    expect(hosts.filter((h) => h.endsWith('wikipedia.org'))).toEqual(['it.wikipedia.org']);

    // A language configured by hand stays fixed.
    hosts.length = 0;
    const fixed = new WikipediaBackend({ lang: 'de', fetch: fakeFetch });
    await fixed.search('saturn', {
      limit: 3,
      signal: new AbortController().signal,
      region: 'us-en',
    });
    expect(hosts).toEqual(['de.wikipedia.org']);
  });

  it('falls back from a DuckDuckGo CAPTCHA to Wikipedia, tells the agent, warns once', async () => {
    const wikiFetch: typeof fetch = () => Promise.resolve(Response.json(WIKI_IT));
    const tool = createWebSearchTool({
      backends: [
        new DuckDuckGoBackend({ fetch: captcha }),
        new WikipediaBackend({ fetch: wikiFetch }),
      ],
    });
    const emitted: ToolEmittedEvent[] = [];
    const first = await tool.execute({ query: 'lune di Saturno', limit: 3 }, ctx(emitted));
    expect(first.backend).toBe('wikipedia');
    expect(first.results).toHaveLength(3);
    expect(first.results.every((r) => r.source === 'wikipedia')).toBe(true);
    expect(first.notice).toMatch(/General web search is unavailable/);
    expect(first.unavailable?.join(' ')).toMatch(/CAPTCHA/);
    expect(first.notice).not.toMatch(/CAPTCHA/);
    expect(first.notice).toMatch(/only from Wikipedia/);
    expect(first.notice).toMatch(/web_fetch/);

    const second = await tool.execute({ query: 'Titano', limit: 3 }, ctx(emitted));
    expect(second.notice).toMatch(/only from Wikipedia/);
    expect(emitted).toHaveLength(1);
    const warning = emitted[0] as { type: string; data: { code: string; message: string } };
    expect(warning.type).toBe('error');
    expect(warning.data.code).toBe(SEARCH_FALLBACK_CODE);
    expect(warning.data.message).toContain('duckduckgo');
  });

  it('reads the chain at every call: with a Brave key it uses Brave, no notice', async () => {
    const asked: string[] = [];
    const fakeFetch: typeof fetch = (input) => {
      const url = urlOf(input);
      asked.push(url.hostname);
      if (url.hostname === 'api.search.brave.com') {
        return Promise.resolve(
          Response.json({ web: { results: [{ title: 'Rea', url: 'https://rea.example' }] } }),
        );
      }
      if (url.hostname.endsWith('wikipedia.org')) return Promise.resolve(Response.json(WIKI_IT));
      return captcha();
    };
    let chain = defaultSearchBackends({ fetch: fakeFetch });
    const tool = createWebSearchTool({ backends: () => chain });
    const emitted: ToolEmittedEvent[] = [];
    expect((await tool.execute({ query: 'rea' }, ctx(emitted))).backend).toBe('wikipedia');

    chain = defaultSearchBackends({ fetch: fakeFetch, braveKey: 'brave-key' });
    asked.length = 0;
    const out = await tool.execute({ query: 'rea silvia' }, ctx(emitted));
    expect(out).toEqual({
      query: 'rea silvia',
      backend: 'brave',
      results: [{ title: 'Rea', url: 'https://rea.example', snippet: '' }],
    });
    expect(asked).toEqual(['api.search.brave.com']);
    expect(emitted).toHaveLength(1);
  });
});
