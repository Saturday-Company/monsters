import { readFileSync } from 'node:fs';
import {
  ToolError,
  WEB_SEARCH_USAGE_PROVIDER,
  type ToolContext,
  type ToolEmittedEvent,
} from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  cleanExtract,
  createWebSearchTool,
  defaultSearchBackends,
  DuckDuckGoBackend,
  OpenRouterSearchBackend,
  paidSearchCostUsd,
  parseOpenRouterSearch,
  SEARCH_FALLBACK_CODE,
  WikipediaBackend,
  type SearchBackend,
} from '../src/index.ts';

/* Paid search on OpenRouter and the chain around it (D-071). No network: recorded answers. */

// Real answer of OpenRouter (16/10/2026): mistral-nemo, `web` plugin, Parallel "fast",
// 5 results, extracts trimmed to 900 characters.
const RECORDED: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/openrouter-search-parallel.json', import.meta.url), 'utf8'),
);
const WIKI_IT: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/wikipedia-search-it.json', import.meta.url), 'utf8'),
);

const signal = () => new AbortController().signal;
function ctx(emitted: ToolEmittedEvent[] = []): ToolContext {
  return { agentId: 'rhea', runId: 'run-1', signal: signal(), emit: (e) => emitted.push(e) };
}
const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
const captcha = () =>
  Promise.resolve(new Response('<div class="anomaly-modal__mask"></div>', { status: 202 }));
const urlOf = (input: Parameters<typeof fetch>[0]) =>
  input instanceof Request ? input.url : input.toString();

describe('OpenRouter paid search', () => {
  it('turns the url_citation annotations into results with short, clean extracts', () => {
    const results = parseOpenRouterSearch(RECORDED, 300);
    expect(results).toHaveLength(5);
    expect(results[1]).toMatchObject({
      title: 'Ristorante Pesce e Vista Mare a Genova | Santamonica',
      url: 'https://santamonicagenova.it/',
    });
    for (const r of results) {
      expect(r.snippet.length).toBeLessThanOrEqual(301);
      expect(r.snippet).not.toMatch(/\n|^\* /);
    }
  });

  it('cleans an extract: no headings, list marks or [...]', () => {
    expect(cleanExtract('## Il Marin\n\n* Calata Cattaneo\n[...]\nPesce', 100)).toBe(
      'Il Marin Calata Cattaneo … Pesce',
    );
    expect(cleanExtract('una frase abbastanza lunga da tagliare', 20)).toBe(
      'una frase abbastanza…',
    );
  });

  it('asks a tiny model for one token with the web plugin, and reports the cost', async () => {
    let sent: Record<string, unknown> = {};
    let auth = '';
    const backend = new OpenRouterSearchBackend({
      apiKey: () => 'sk-or-test',
      fetch: (url, init) => {
        expect(urlOf(url)).toBe('https://openrouter.ai/api/v1/chat/completions');
        auth = new Headers(init?.headers).get('authorization') ?? '';
        sent = JSON.parse(init?.body as string) as Record<string, unknown>;
        return json(RECORDED);
      },
    });
    const usage: unknown[] = [];
    const results = await backend.search('ristoranti di pesce Genova', {
      limit: 3,
      signal: signal(),
      onUsage: (u) => usage.push(u),
    });
    expect(auth).toBe('Bearer sk-or-test');
    expect(sent).toMatchObject({
      model: 'mistralai/mistral-nemo',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ristoranti di pesce Genova' }],
      plugins: [{ id: 'web', engine: 'parallel', mode: 'fast', max_results: 3 }],
    });
    expect(results).toHaveLength(3);
    // The cost OpenRouter reported: 0.001 $ of search + the tiny model.
    expect(usage).toEqual([
      expect.objectContaining({
        model: 'openrouter/parallel-fast',
        costUsd: 0.00107833,
        inputTokens: 2700,
        outputTokens: 1,
      }),
    ]);
  });

  it('estimates the cost when OpenRouter does not report it', async () => {
    const backend = new OpenRouterSearchBackend({
      apiKey: 'k',
      engine: 'exa',
      fetch: () => json({ choices: [{ message: { annotations: [] } }] }),
    });
    const usage: { costUsd: number }[] = [];
    expect(
      await backend.search('x y', { limit: 5, signal: signal(), onUsage: (u) => usage.push(u) }),
    ).toEqual([]);
    expect(usage[0]!.costUsd).toBeCloseTo(paidSearchCostUsd('exa'), 6);
    expect(paidSearchCostUsd('parallel')).toBeCloseTo(0.00109, 5);
  });

  it('a search in timeout is counted at its expected cost; a refused one is not (C-30)', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason as Error));
      });
    const slow = new OpenRouterSearchBackend({ apiKey: 'k', fetch: hang, timeoutMs: 20 });
    const usage: { costUsd: number; estimated?: true }[] = [];
    await expect(
      slow.search('x y', { limit: 5, signal: signal(), onUsage: (u) => usage.push(u) }),
    ).rejects.toThrow(/timed out/);
    expect(usage).toEqual([
      expect.objectContaining({ costUsd: paidSearchCostUsd('parallel'), estimated: true }),
    ]);
    // An answer with its status (here 500) says the search did not run: nothing to count.
    const refused = new OpenRouterSearchBackend({ apiKey: 'k', fetch: () => json({}, 500) });
    await expect(
      refused.search('x y', { limit: 5, signal: signal(), onUsage: (u) => usage.push(u) }),
    ).rejects.toBeInstanceOf(ToolError);
    expect(usage).toHaveLength(1);
  });

  it('a search that never left (offline, stopped before) costs nothing (review of 19/10, 14)', async () => {
    const usage: unknown[] = [];
    for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']) {
      const offline = new OpenRouterSearchBackend({
        apiKey: 'k',
        fetch: () =>
          Promise.reject(
            new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) }),
          ),
      });
      await expect(
        offline.search('x y', { limit: 5, signal: signal(), onUsage: (u) => usage.push(u) }),
      ).rejects.toBeInstanceOf(ToolError);
    }
    const stopped = new AbortController();
    stopped.abort(new Error('stop'));
    const hang: typeof fetch = (_url, init) => Promise.reject(init!.signal!.reason as Error);
    const late = new OpenRouterSearchBackend({ apiKey: 'k', fetch: hang });
    await expect(
      late.search('x y', { limit: 5, signal: stopped.signal, onUsage: (u) => usage.push(u) }),
    ).rejects.toThrow();
    expect(usage).toEqual([]);
  });

  it('without credit (402) is skipped for a while, without asking again', async () => {
    let now = 1_000_000;
    let calls = 0;
    const backend = new OpenRouterSearchBackend({
      apiKey: 'k',
      now: () => now,
      fetch: () => {
        calls++;
        return json({ error: { message: 'Insufficient credits' } }, 402);
      },
    });
    const first = await backend
      .search('a b', { limit: 5, signal: signal() })
      .catch((e: unknown) => e);
    expect(first).toMatchObject({ code: 'UNAVAILABLE' });
    expect((first as ToolError).message).toMatch(/no credit/);
    await expect(backend.search('a b', { limit: 5, signal: signal() })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(calls).toBe(1);
    expect(backend.blocked).toMatch(/credit/);
    now += 31 * 60_000;
    expect(backend.blocked).toBeNull();
    await backend.search('a b', { limit: 5, signal: signal() }).catch(() => undefined);
    expect(calls).toBe(2);
  });

  it.each([400, 404, 422])('a %i from OpenRouter pauses the search like a 402', async (status) => {
    let calls = 0;
    const backend = new OpenRouterSearchBackend({
      apiKey: 'k',
      fetch: () => {
        calls++;
        return json({ error: { message: 'No endpoints found' } }, status);
      },
    });
    await expect(backend.search('a b', { limit: 5, signal: signal() })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    await expect(backend.search('a b', { limit: 5, signal: signal() })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(calls).toBe(1);
    expect(backend.blocked).toMatch(new RegExp(String(status)));
  });

  it('a 400 about the query fails that search only; three in a row pause it', async () => {
    let calls = 0;
    const backend = new OpenRouterSearchBackend({
      apiKey: 'k',
      fetch: () => {
        calls++;
        return json({ error: { message: 'Prompt is too long' } }, calls === 2 ? 422 : 400);
      },
    });
    for (let i = 0; i < 2; i++) {
      await expect(backend.search('a b', { limit: 5, signal: signal() })).rejects.toMatchObject({
        code: 'UNAVAILABLE',
      });
      expect(backend.blocked).toBeNull();
    }
    await expect(backend.search('a b', { limit: 5, signal: signal() })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(backend.blocked).toMatch(/400/);
    expect(calls).toBe(3);
  });

  it('a refused key is UNAVAILABLE too (the free chain takes over), no key never calls', async () => {
    let calls = 0;
    const refused = new OpenRouterSearchBackend({
      apiKey: 'k',
      fetch: () => {
        calls++;
        return json({ error: { message: 'No auth' } }, 401);
      },
    });
    await expect(refused.search('a b', { limit: 5, signal: signal() })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    const none = new OpenRouterSearchBackend({
      apiKey: () => null,
      fetch: () => {
        calls++;
        return json({});
      },
    });
    await expect(none.search('a b', { limit: 5, signal: signal() })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(calls).toBe(1);
  });

  it('429 is RATE_LIMITED, an error in the body is UNAVAILABLE', async () => {
    const limited = new OpenRouterSearchBackend({ apiKey: 'k', fetch: () => json({}, 429) });
    await expect(limited.search('a b', { limit: 5, signal: signal() })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    const broken = new OpenRouterSearchBackend({
      apiKey: 'k',
      fetch: () => json({ error: { message: 'plugin failed' } }),
    });
    await expect(broken.search('a b', { limit: 5, signal: signal() })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });
});

describe('DuckDuckGo after a CAPTCHA', () => {
  it('is skipped for 15 minutes, then asked again', async () => {
    let now = 5_000_000;
    let calls = 0;
    const ddg = new DuckDuckGoBackend({
      now: () => now,
      fetch: () => {
        calls++;
        return captcha();
      },
    });
    await expect(ddg.search('x', { limit: 5, signal: signal() })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    await expect(ddg.search('x', { limit: 5, signal: signal() })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(calls).toBe(1);
    expect(ddg.blocked).toBe(true);
    now += 16 * 60_000;
    await ddg.search('x', { limit: 5, signal: signal() }).catch(() => undefined);
    expect(calls).toBe(2);
  });
});

describe('web_search with the paid search', () => {
  /** OpenRouter answers with `openrouter`, DuckDuckGo with a CAPTCHA, Wikipedia with the fixture. */
  function routed(openrouter: () => Promise<Response>, counts: Record<string, number>) {
    return (input: Parameters<typeof fetch>[0]) => {
      const url = urlOf(input);
      const host = new URL(url).hostname;
      counts[host] = (counts[host] ?? 0) + 1;
      if (host === 'openrouter.ai') return openrouter();
      if (host.endsWith('duckduckgo.com')) return captcha();
      return json(WIKI_IT);
    };
  }

  it('goes first when on: logs a provider_usage with its cost, no fallback warning', async () => {
    const counts: Record<string, number> = {};
    const fetch = routed(() => json(RECORDED), counts);
    const tool = createWebSearchTool({
      backends: defaultSearchBackends({
        fetch,
        openrouterKey: () => 'k',
        paidEngine: 'parallel',
      }),
    });
    const emitted: ToolEmittedEvent[] = [];
    const out = await tool.execute({ query: 'ristoranti di pesce Genova' }, ctx(emitted));
    expect(out.backend).toBe('openrouter-parallel');
    expect(out.results).toHaveLength(5);
    expect(out.notice).toBeUndefined();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: 'provider_usage',
      data: {
        provider: WEB_SEARCH_USAGE_PROVIDER,
        model: 'openrouter/parallel-fast',
        costUsd: 0.00107833,
      },
    });
    expect(counts).toEqual({ 'openrouter.ai': 1 });
  });

  it('without credit falls to DuckDuckGo, then Wikipedia, and warns once', async () => {
    const counts: Record<string, number> = {};
    const fetch = routed(() => json({ error: { message: 'Insufficient credits' } }, 402), counts);
    const tool = createWebSearchTool({
      backends: defaultSearchBackends({
        fetch,
        openrouterKey: () => 'k',
        paidEngine: 'parallel',
      }),
    });
    const emitted: ToolEmittedEvent[] = [];
    const first = await tool.execute({ query: 'Firenze' }, ctx(emitted));
    expect(first.backend).toBe('wikipedia');
    expect(first.notice).toMatch(/see `unavailable`/);
    expect(first.unavailable?.join(' ')).toMatch(/no credit.*CAPTCHA|CAPTCHA.*no credit/s);
    const second = await tool.execute({ query: 'Siena' }, ctx(emitted));
    expect(second.backend).toBe('wikipedia');
    // OpenRouter and DuckDuckGo were asked once each: then skipped while blocked.
    expect(counts['openrouter.ai']).toBe(1);
    expect(counts['html.duckduckgo.com']).toBe(1);
    const warnings = emitted.filter((e) => e.type === 'error');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.data).toMatchObject({ code: SEARCH_FALLBACK_CODE });
    expect(emitted.some((e) => e.type === 'provider_usage')).toBe(false);
  });

  it('is left out of the default chain when off', () => {
    const ids = defaultSearchBackends({ openrouterKey: () => 'k', paidEngine: null }).map(
      (b) => b.id,
    );
    expect(ids).toEqual(['duckduckgo', 'wikipedia']);
    expect(
      defaultSearchBackends({ openrouterKey: () => 'k', paidEngine: 'exa' }).map((b) => b.id),
    ).toEqual(['openrouter-exa', 'duckduckgo', 'wikipedia']);
  });

  it('runs several searches at once with `queries`: one cost each, merged and shorter', async () => {
    let n = 0;
    const backend: SearchBackend = {
      id: 'paid',
      needsConfig: true,
      search: (q, o) => {
        n++;
        o.onUsage?.({ model: 'm', costUsd: 0.001, durationMs: 1 });
        return Promise.resolve([
          { title: q, url: `https://x.example/${q.length}`, snippet: 'a'.repeat(900) },
          { title: 'shared', url: 'https://shared.example', snippet: 'b' },
        ]);
      },
    };
    const emitted: ToolEmittedEvent[] = [];
    const tool = createWebSearchTool({ backends: [backend] });
    const out = await tool.execute(
      { query: 'ribollita origini', queries: ['peposo storia', 'ribollita origini'] },
      ctx(emitted),
    );
    expect(n).toBe(2);
    expect(out.queries).toEqual(['ribollita origini', 'peposo storia']);
    expect(out.results.map((r) => r.query)).toEqual([
      'ribollita origini',
      'ribollita origini',
      'peposo storia',
    ]);
    expect(out.results[0]!.snippet.length).toBeLessThanOrEqual(401);
    expect(emitted.filter((e) => e.type === 'provider_usage')).toHaveLength(2);
  });

  it('with several searches, one failing is a notice, not an error', async () => {
    const backend: SearchBackend = {
      id: 'flaky',
      needsConfig: false,
      search: (q) =>
        q.startsWith('ko')
          ? Promise.reject(new ToolError('UNAVAILABLE', 'down'))
          : Promise.resolve([{ title: q, url: 'https://ok.example', snippet: '' }]),
    };
    const tool = createWebSearchTool({ backends: [backend] });
    const out = await tool.execute({ query: 'ok uno', queries: ['ko due'] }, ctx());
    expect(out.results).toHaveLength(1);
    expect(out.notice).toMatch(/see `failed_searches`/);
    expect(out.failed_searches?.join(' ')).toMatch(/"ko due": down/);
    await expect(tool.execute({ query: 'ko tre' }, ctx())).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });

  it('shows the model only `queries`, and still takes `query` or one string', async () => {
    const seen: string[] = [];
    const backend: SearchBackend = {
      id: 'b',
      needsConfig: false,
      search: (q) => {
        seen.push(q);
        return Promise.resolve([]);
      },
    };
    const tool = createWebSearchTool({ backends: [backend] });
    expect(tool.inputJsonSchema).toMatchObject({
      required: ['queries'],
      properties: { queries: { type: 'array', maxItems: 4 } },
    });
    expect(Object.keys(tool.inputJsonSchema!['properties'] as object)).toEqual([
      'queries',
      'limit',
    ]);
    expect(tool.inputSchema.safeParse({}).success).toBe(false);
    await tool.execute(tool.inputSchema.parse({ query: 'uno due' }), ctx());
    await tool.execute(tool.inputSchema.parse({ queries: 'tre quattro' }), ctx());
    expect(seen).toEqual(['uno due', 'tre quattro']);
    const many = await tool.execute({ queries: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'] }, ctx());
    expect(many.queries).toEqual(['a1', 'b2', 'c3', 'd4']);
    expect(many.notice).toMatch(/Only the first 4 searches ran: the others are in `not_run`/);
    // The queries are data, not words of the notice (D-074).
    expect(many.not_run).toEqual(['e5', 'f6']);
    expect(many.notice).not.toMatch(/e5/);
  });

  it('after 10 searches in a task tells the agent to write with what it has', async () => {
    const backend: SearchBackend = {
      id: 'b',
      needsConfig: false,
      search: () => Promise.resolve([]),
    };
    const tool = createWebSearchTool({ backends: [backend] });
    const run = (runId: string): ToolContext => ({ ...ctx(), runId });
    const early = await tool.execute({ queries: ['a1', 'b2', 'c3', 'd4'] }, run('r1'));
    expect(early.notice).toBeUndefined();
    await tool.execute({ queries: ['e5', 'f6', 'g7', 'h8'] }, run('r1'));
    const late = await tool.execute({ queries: ['i9', 'j10'] }, run('r1'));
    expect(late.notice).toMatch(/You have run 10 searches in this task/);
    // Another task starts from zero.
    expect((await tool.execute({ queries: ['k11'] }, run('r2'))).notice).toBeUndefined();
    // A search already run in the task is said (any case or spacing).
    const again = await tool.execute({ queries: ['K11 ', 'l12'] }, run('r2'));
    expect(again.notice).toMatch(/`already_searched` were already run/);
    expect(again.already_searched).toEqual(['K11']);
    expect(again.notice).not.toMatch(/K11/);
  });

  it('stops at 20 searches in a task, running only what is left', async () => {
    let n = 0;
    const backend: SearchBackend = {
      id: 'b',
      needsConfig: false,
      search: () => {
        n++;
        return Promise.resolve([]);
      },
    };
    const tool = createWebSearchTool({ backends: [backend] });
    for (let i = 0; i < 4; i++) {
      await tool.execute({ queries: [`a${i}`, `b${i}`, `c${i}`, `d${i}`] }, ctx());
    }
    const last = await tool.execute({ queries: ['x1', 'x2', 'x3', 'x4', 'x5'] }, ctx());
    expect(last.queries).toEqual(['x1', 'x2', 'x3', 'x4']);
    expect(n).toBe(20);
    await expect(tool.execute({ queries: ['y1'] }, ctx())).rejects.toMatchObject({
      code: 'LIMIT_REACHED',
    });
    expect(n).toBe(20);
  });

  it('Wikipedia alone still says so', async () => {
    const tool = createWebSearchTool({
      backends: [new WikipediaBackend({ fetch: () => json(WIKI_IT), fallbackLang: null })],
    });
    const out = await tool.execute({ query: 'Firenze' }, ctx());
    expect(out.notice).toMatch(/only from Wikipedia/);
  });
});
