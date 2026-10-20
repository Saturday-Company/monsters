import dns from 'node:dns';
import type { ToolContext, ToolEmittedEvent } from '@monsters/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { systemResolver } from '../src/address.ts';
import {
  BraveBackend,
  createWebSearchTool,
  DuckDuckGoBackend,
  OpenRouterSearchBackend,
  SEARCH_FALLBACK_CODE,
  type SearchBackend,
  WikipediaBackend,
} from '../src/index.ts';

/* The web search that really falls back (review 18/10, items 3, 30, 31). No network. */

function ctx(emitted: ToolEmittedEvent[] = []): ToolContext {
  return {
    agentId: 'rhea',
    runId: 'run-1',
    signal: new AbortController().signal,
    emit: (e) => emitted.push(e),
  };
}
const signal = () => new AbortController().signal;
const WIKI = {
  query: {
    search: [{ title: 'Rea', snippet: 'luna di <b>Saturno</b>', pageid: 1 }],
  },
};
const wikipedia = () =>
  new WikipediaBackend({
    fetch: () => Promise.resolve(Response.json(WIKI)),
    fallbackLang: null,
  });
const html = (body: string, status = 200) => Promise.resolve(new Response(body, { status }));
const ONE_HIT = '<div class="result"><a class="result__a" href="https://a.example/">A</a></div>';

afterEach(() => vi.restoreAllMocks());

describe('empty answers (item 3)', () => {
  it('tries the next backend when a web backend answers with nothing', async () => {
    const empty: SearchBackend = {
      id: 'empty',
      needsConfig: false,
      search: () => Promise.resolve([]),
    };
    const tool = createWebSearchTool({ backends: [empty, wikipedia()] });
    const out = await tool.execute({ query: 'rea silvia' }, ctx());
    expect(out.backend).toBe('wikipedia');
    expect(out.results.length).toBeGreaterThan(0);
  });

  it('returns the empty answer when every backend is empty', async () => {
    const empty = (id: string): SearchBackend => ({
      id,
      needsConfig: false,
      search: () => Promise.resolve([]),
    });
    const tool = createWebSearchTool({ backends: [empty('a'), empty('b')] });
    expect(await tool.execute({ query: 'qualcosa' }, ctx())).toMatchObject({
      backend: 'b',
      results: [],
    });
  });

  it('DuckDuckGo: the "no results" page is an answer, an unknown page is UNAVAILABLE', async () => {
    const none = new DuckDuckGoBackend({
      fetch: () => html('<div class="no-results">No results.</div>'),
    });
    expect(await none.search('zzzqx', { limit: 5, signal: signal() })).toEqual([]);
    const drifted = new DuckDuckGoBackend({
      fetch: () => html('<html><body><div class="serp">new layout</div></body></html>'),
    });
    await expect(drifted.search('rea', { limit: 5, signal: signal() })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    const tool = createWebSearchTool({ backends: [drifted, wikipedia()] });
    expect((await tool.execute({ query: 'rea' }, ctx())).backend).toBe('wikipedia');
  });

  it('the paid search pauses after N empty answers in a row and says why', async () => {
    let calls = 0;
    const paid = new OpenRouterSearchBackend({
      apiKey: 'k',
      maxEmpties: 3,
      fetch: () => {
        calls++;
        return Promise.resolve(Response.json({ choices: [{ message: { annotations: [] } }] }));
      },
    });
    const tool = createWebSearchTool({ backends: [paid, wikipedia()] });
    const emitted: ToolEmittedEvent[] = [];
    const warnings = () => emitted.filter((e) => e.type === 'error');
    for (const q of ['uno', 'due']) {
      expect((await tool.execute({ query: q }, ctx(emitted))).backend).toBe('wikipedia');
    }
    expect(warnings()).toHaveLength(0);
    const third = await tool.execute({ query: 'tre' }, ctx(emitted));
    expect(third.backend).toBe('wikipedia');
    expect(third.unavailable?.join(' ')).toMatch(/3 searches in a row/);
    expect(warnings()).toHaveLength(1);
    expect(paid.blockedKind).toBe('paused');
    await tool.execute({ query: 'quattro' }, ctx(emitted));
    expect(calls).toBe(3);
  });
});

describe('plugin web of OpenRouter stops citing (item 31, plan B)', () => {
  it('searches that come back empty end on DuckDuckGo, then Wikipedia', async () => {
    const paid = new OpenRouterSearchBackend({
      apiKey: 'k',
      fetch: () => Promise.resolve(Response.json({ choices: [{ message: { content: 'ok' } }] })),
    });
    const ddg = new DuckDuckGoBackend({ fetch: () => html(ONE_HIT) });
    const tool = createWebSearchTool({ backends: [paid, ddg, wikipedia()] });
    const out = await tool.execute({ query: 'rea' }, ctx());
    expect(out.backend).toBe('duckduckgo');
    expect(out.results[0]?.url).toBe('https://a.example/');
    const tool2 = createWebSearchTool({
      backends: [paid, new DuckDuckGoBackend({ fetch: () => html('<html></html>') }), wikipedia()],
    });
    expect((await tool2.execute({ query: 'rea' }, ctx())).backend).toBe('wikipedia');
  });
});

describe('fallback warning (item 30)', () => {
  it('warns once per episode, again after it ended and the interval passed', async () => {
    let t = 0;
    let broken = true;
    const flaky: SearchBackend = {
      id: 'flaky',
      needsConfig: false,
      search: () =>
        broken
          ? Promise.reject(new Error('captcha'))
          : Promise.resolve([{ title: 'x', url: 'https://x.example', snippet: '' }]),
    };
    const tool = createWebSearchTool({
      backends: [flaky, wikipedia()],
      warnIntervalMs: 1000,
      now: () => t,
    });
    const emitted: ToolEmittedEvent[] = [];
    await tool.execute({ query: 'uno' }, ctx(emitted));
    t += 100;
    await tool.execute({ query: 'due' }, ctx(emitted));
    expect(emitted).toHaveLength(1);
    broken = false;
    t += 100;
    await tool.execute({ query: 'tre' }, ctx(emitted));
    broken = true;
    t += 100; // a new episode, but inside the minimum interval
    await tool.execute({ query: 'quattro' }, ctx(emitted));
    expect(emitted).toHaveLength(1);
    broken = false;
    t += 2000;
    await tool.execute({ query: 'cinque' }, ctx(emitted));
    broken = true;
    t += 100;
    await tool.execute({ query: 'sei' }, ctx(emitted));
    expect(emitted).toHaveLength(2);
    expect((emitted[1] as { data: { code: string } }).data.code).toBe(SEARCH_FALLBACK_CODE);
  });

  it('passes the region to DuckDuckGo (kl) and Brave (country), read at every call', async () => {
    let kl = '';
    let braveUrl = '';
    const ddg = new DuckDuckGoBackend({
      fetch: (_u, init) => {
        kl = (init?.body as URLSearchParams).get('kl') ?? '';
        return html(ONE_HIT);
      },
    });
    const brave = new BraveBackend({
      apiKey: 'k',
      fetch: (u) => {
        braveUrl = (u as URL | string).toString();
        return Promise.resolve(Response.json({ web: { results: [] } }));
      },
    });
    let region: string | undefined = 'it-it';
    const tool = createWebSearchTool({ backends: [ddg], region: () => region });
    await tool.execute({ query: 'rea' }, ctx());
    expect(kl).toBe('it-it');
    region = 'us-en';
    await tool.execute({ query: 'rea due' }, ctx());
    expect(kl).toBe('us-en');
    await brave.search('rea', { limit: 3, signal: signal(), region: 'it-it' });
    expect(new URL(braveUrl).searchParams.get('country')).toBe('IT');
  });
});

describe('DNS timeout (item 30)', () => {
  it('stops waiting for a resolver that never answers', async () => {
    vi.spyOn(dns, 'lookup').mockImplementation(() => {});
    const started = Date.now();
    await expect(systemResolver('slow.example', AbortSignal.timeout(50))).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
