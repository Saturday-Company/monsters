import { ToolError } from '@monsters/shared';
import { z } from 'zod';
import { fetchFailure, httpError, withTimeout } from '../http.ts';
import type { SearchBackend, SearchOptions, SearchResult } from './types.ts';

/*
 * Paid web search through the user's OpenRouter key (DECISIONS D-071).
 *
 * OpenRouter has no search-only endpoint: its `web` plugin runs one search
 * with the chosen engine before the model answers, and returns every result
 * as a `url_citation` annotation (title, URL, extract). We ask a tiny model
 * for a single output token, so the answer costs almost nothing: what is paid
 * is the search itself (Parallel "fast": 0.001 $, Exa: 0.007 $) plus about
 * 3,000 prompt tokens of the tiny model (~0.0001 $). The cost OpenRouter
 * reports (`usage.cost`, search fee included) goes to `onUsage`, which the
 * tool logs as a `provider_usage` event (the same ledger as the models).
 *
 * The plugin, not the `openrouter:web_search` server tool: with the server
 * tool the model decides whether to search, and small models often do not
 * (checked on 16/10/2026). The plugin is marked deprecated in the docs; if it
 * stops returning annotations the search comes back empty, not wrong.
 */

export type PaidSearchEngine = 'parallel' | 'exa';

export interface PaidSearchEngineInfo {
  /** Mode sent to OpenRouter (the cheapest one that covers Italian). */
  mode: string;
  /** Price of one search of up to 10 results (OpenRouter docs, 16/10/2026). */
  usdPerSearch: number;
  label: string;
}

export const PAID_SEARCH_ENGINES: Record<PaidSearchEngine, PaidSearchEngineInfo> = {
  // "turbo" costs the same but covers only English and Japanese.
  parallel: { mode: 'fast', usdPerSearch: 0.001, label: 'Parallel' },
  exa: { mode: 'fast', usdPerSearch: 0.007, label: 'Exa' },
};

/**
 * Tiny model that "answers" the search request with one token. Not a model
 * with native search (OpenAI, Anthropic, Google, xAI, Perplexity): there the
 * plugin could switch to the provider's own, pricier search.
 */
export const OPENROUTER_SEARCH_MODEL = 'mistralai/mistral-nemo';

/** Prompt tokens of the tiny model for one search (5 extracts), measured: ~2,700. */
const PROMPT_TOKENS_PER_SEARCH = 3000;
const MODEL_USD_PER_PROMPT_TOKEN = 0.03 / 1_000_000;

/** Expected dollars per search, model tokens included (what the settings show). */
export function paidSearchCostUsd(engine: PaidSearchEngine): number {
  return (
    PAID_SEARCH_ENGINES[engine].usdPerSearch + PROMPT_TOKENS_PER_SEARCH * MODEL_USD_PER_PROMPT_TOKEN
  );
}

/** What one paid search cost, reported to the caller (`SearchOptions.onUsage`). */
export interface SearchUsage {
  /** Engine as logged, e.g. `openrouter/parallel-fast`. */
  model: string;
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  /**
   * The cost is the expected one, not OpenRouter's: the search left and no
   * answer came back (a timeout, a stop, a connection cut), or the answer
   * could not be read. It may have run and been billed (C-30).
   */
  estimated?: true;
}

export interface OpenRouterSearchOptions {
  /** Read at every search: the key can change from the settings. Null: not configured. */
  apiKey: string | (() => string | null);
  engine?: PaidSearchEngine;
  model?: string;
  fetch?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
  /** Characters kept of each extract (the engines return ~1,500). Default 700. */
  maxSnippetChars?: number;
  /** After "no credit" or "bad key", how long the backend is skipped. Default 30 min. */
  cooldownMs?: number;
  /** Empty answers in a row after which the backend is paused. Default 3. */
  maxEmpties?: number;
  now?: () => number;
}

const AnnotationSchema = z.object({
  type: z.string(),
  url_citation: z
    .object({
      url: z.string(),
      title: z.string().optional(),
      content: z.string().optional(),
    })
    .optional(),
});

const ResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({ annotations: z.array(AnnotationSchema).nullable().optional() })
          .optional(),
      }),
    )
    .optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      cost: z.number().optional(),
    })
    .optional(),
  error: z.object({ message: z.string().optional(), code: z.unknown().optional() }).optional(),
});

/** One line of readable text from an extract: no Markdown headings, list marks or runs of spaces. */
export function cleanExtract(text: string, max: number): string {
  const flat = text
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[*-]\s+/gm, '')
    .replace(/\[\.\.\.\]/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.7 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Maps a chat completion with `url_citation` annotations to results. Exported for tests. */
export function parseOpenRouterSearch(body: unknown, maxSnippetChars = 700): SearchResult[] {
  const parsed = ResponseSchema.parse(body);
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const a of parsed.choices?.[0]?.message?.annotations ?? []) {
    const c = a.url_citation;
    if (a.type !== 'url_citation' || !c || !/^https?:\/\//i.test(c.url) || seen.has(c.url)) {
      continue;
    }
    seen.add(c.url);
    results.push({
      title: (c.title ?? '').replace(/\s+/g, ' ').trim() || c.url,
      url: c.url,
      snippet: cleanExtract(c.content ?? '', maxSnippetChars),
    });
  }
  return results;
}

/** Why the paid search is paused: no credit (402), key refused (401/403), anything else. */
export type PaidSearchBlock = 'no_credit' | 'key_rejected' | 'paused';
/** An error about the model or the account's policies: every search would get it. */
const MODEL_OR_POLICY = /\b(model|endpoints?|data polic|privacy|provider)/i;
/** 400 or 422 in a row (about the queries) after which the paid search pauses anyway. */
const REFUSED_BEFORE_PAUSE = 3;

const refusedWhy = (status: number) =>
  `OpenRouter does not accept the search request (HTTP ${status})`;

/** The `error.message` of an OpenRouter error body, or "". */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } };
    return typeof body.error?.message === 'string' ? body.error.message : '';
  } catch {
    return '';
  }
}

/** Errors of a connection that was never made: the request did not leave the computer. */
const NOT_SENT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH']);

function neverSent(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && typeof e === 'object' && i < 5; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && NOT_SENT.has(code)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export class OpenRouterSearchBackend implements SearchBackend {
  readonly id: string;
  readonly needsConfig = true;
  readonly engine: PaidSearchEngine;
  readonly #apiKey: () => string | null;
  readonly #model: string;
  readonly #fetch: typeof fetch;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #maxSnippetChars: number;
  readonly #cooldownMs: number;
  readonly #now: () => number;
  #blocked: { until: number; why: string; kind: PaidSearchBlock } | null = null;
  #empties = 0;
  readonly #maxEmpties: number;
  /** Requests refused in a row with a 400 or 422 that names neither the model nor a policy. */
  #refusedInARow = 0;

  constructor(options: OpenRouterSearchOptions) {
    const key = options.apiKey;
    this.#apiKey = typeof key === 'function' ? key : () => key;
    this.engine = options.engine ?? 'parallel';
    this.id = `openrouter-${this.engine}`;
    this.#model = options.model ?? OPENROUTER_SEARCH_MODEL;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#endpoint = options.endpoint ?? 'https://openrouter.ai/api/v1/chat/completions';
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#maxSnippetChars = options.maxSnippetChars ?? 700;
    this.#cooldownMs = options.cooldownMs ?? 30 * 60_000;
    this.#now = options.now ?? Date.now;
    this.#maxEmpties = options.maxEmpties ?? 3;
  }

  /** Why the backend is skipped right now (no credit, key refused), or null. */
  get blocked(): string | null {
    if (this.#blocked && this.#blocked.until > this.#now()) return this.#blocked.why;
    return null;
  }

  /** Why it is paused, as a kind: the settings say a rejected key apart from no credit. */
  get blockedKind(): PaidSearchBlock | null {
    return this.blocked ? (this.#blocked?.kind ?? null) : null;
  }

  #block(why: string, kind: PaidSearchBlock): ToolError {
    this.#blocked = { until: this.#now() + this.#cooldownMs, why, kind };
    return new ToolError('UNAVAILABLE', `OpenRouter search: ${why}`);
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const skip = this.blocked;
    if (skip) throw new ToolError('UNAVAILABLE', `OpenRouter search: ${skip}`);
    const key = this.#apiKey();
    if (!key) throw new ToolError('UNAVAILABLE', 'OpenRouter search: no key configured');
    const info = PAID_SEARCH_ENGINES[this.engine];
    const model = `openrouter/${this.engine}-${info.mode}`;
    const started = this.#now();
    // Stopped before it left: nothing reached OpenRouter, nothing to count.
    const stoppedBefore = options.signal?.aborted === true;
    let res: Response | undefined;
    let body: unknown;
    try {
      res = await this.#fetch(this.#endpoint, {
        method: 'POST',
        signal: withTimeout(options.signal, this.#timeoutMs),
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          'x-title': 'Monsters',
        },
        body: JSON.stringify({
          model: this.#model,
          max_tokens: 1,
          temperature: 0,
          messages: [{ role: 'user', content: query }],
          plugins: [
            {
              id: 'web',
              engine: this.engine,
              mode: info.mode,
              max_results: Math.min(10, Math.max(1, options.limit)),
            },
          ],
          usage: { include: true },
        }),
      });
      if (res.status === 402)
        throw this.#block('no credit left on the OpenRouter key', 'no_credit');
      if (res.status === 401 || res.status === 403) {
        throw this.#block('the OpenRouter key was refused', 'key_rejected');
      }
      // A retired model or a data policy that excludes it will not fix itself on the next
      // search: pause like for the 402. A 400 or 422 about this one query (too long, a
      // character, moderation) fails only this search, until it happens again and again
      // (review of 18/10, item 11).
      if (res.status === 404) throw this.#block(refusedWhy(res.status), 'paused');
      if (res.status === 400 || res.status === 422) {
        const message = await errorMessage(res);
        if (MODEL_OR_POLICY.test(message) || ++this.#refusedInARow >= REFUSED_BEFORE_PAUSE) {
          this.#refusedInARow = 0;
          throw this.#block(refusedWhy(res.status), 'paused');
        }
        throw new ToolError('UNAVAILABLE', `OpenRouter search: ${refusedWhy(res.status)}`);
      }
      if (!res.ok) throw httpError(res.status, 'OpenRouter search');
      body = await res.json();
      this.#refusedInARow = 0;
    } catch (err) {
      // No status back (a timeout, a stop, a connection cut) or a 200 whose body broke: the
      // search may have run and been billed, so the cap counts what it costs (C-30). A refusal
      // with its status (402, 401, 4xx, 5xx) is not billed, nor a request that never left (no
      // name, no connection, stopped before: review of 19/10, item 14).
      if ((res === undefined && !stoppedBefore && !neverSent(err)) || res?.ok) {
        options.onUsage?.({
          model,
          costUsd: paidSearchCostUsd(this.engine),
          durationMs: Math.max(0, this.#now() - started),
          estimated: true,
        });
      }
      throw fetchFailure(err, options.signal, 'OpenRouter search');
    }
    const parsed = ResponseSchema.safeParse(body);
    if (!parsed.success) throw new ToolError('UNAVAILABLE', 'OpenRouter search: unexpected answer');
    if (parsed.data.error) {
      throw new ToolError(
        'UNAVAILABLE',
        `OpenRouter search: ${parsed.data.error.message ?? 'error'}`,
      );
    }
    const usage = parsed.data.usage;
    options.onUsage?.({
      model,
      costUsd: usage?.cost ?? paidSearchCostUsd(this.engine),
      ...(usage?.prompt_tokens !== undefined ? { inputTokens: usage.prompt_tokens } : {}),
      ...(usage?.completion_tokens !== undefined ? { outputTokens: usage.completion_tokens } : {}),
      durationMs: Math.max(0, this.#now() - started),
    });
    const results = parseOpenRouterSearch(body, this.#maxSnippetChars).slice(0, options.limit);
    // The `web` plugin is deprecated (D-071): if it stops citing sources the
    // search is paid for and comes back empty. After a few empty answers in a
    // row, pause (the next backend takes over) and say why.
    if (results.length > 0) {
      this.#empties = 0;
    } else if (++this.#empties >= this.#maxEmpties) {
      this.#empties = 0;
      throw this.#block(
        `${this.#maxEmpties} searches in a row came back with no results`,
        'paused',
      );
    }
    return results;
  }
}
