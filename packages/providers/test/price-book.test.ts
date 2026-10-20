import { describe, expect, it } from 'vitest';
import {
  CACHE_READ_SHARE,
  estimateCostUsd,
  fetchOpenRouterPrices,
  OPENROUTER_PUBLIC_MODELS_URL,
  openRouterSlugsFor,
  pricePerMillion,
  twinPrice,
  type ModelPrice,
} from '../src/index.ts';

/*
 * The price of a direct key's model (review of 19/10, question 2): its exact
 * twin on OpenRouter's public list, and the cache counted at its own price.
 */

describe('openRouterSlugsFor: exact twins only', () => {
  it.each([
    ['anthropic', 'claude-sonnet-4-5-20250929', ['anthropic/claude-sonnet-4.5']],
    ['anthropic', 'claude-sonnet-4-5', ['anthropic/claude-sonnet-4.5']],
    ['anthropic', 'claude-3-5-haiku-latest', ['anthropic/claude-3.5-haiku']],
    ['anthropic', 'claude-opus-4-1-20250805', ['anthropic/claude-opus-4.1']],
    ['anthropic', 'claude-3-haiku-20240307', ['anthropic/claude-3-haiku']],
    ['anthropic', 'claude-3-7-sonnet-20250219', ['anthropic/claude-3.7-sonnet']],
    ['openai', 'gpt-4.1-mini', ['openai/gpt-4.1-mini']],
    ['openai', 'o4-mini', ['openai/o4-mini']],
    ['openai', 'gpt-4o-2024-08-06', ['openai/gpt-4o-2024-08-06', 'openai/gpt-4o']],
    ['google', 'models/gemini-2.5-flash', ['google/gemini-2.5-flash']],
    ['google', 'gemini-2.0-flash-001', ['google/gemini-2.0-flash-001', 'google/gemini-2.0-flash']],
    ['google', 'gemini-2.5-pro-latest', ['google/gemini-2.5-pro-latest', 'google/gemini-2.5-pro']],
    ['groq', 'llama-3.3-70b-versatile', []],
    ['mistral', 'mistral-large-latest', []],
    ['openrouter', 'openai/gpt-4o', []],
    ['anthropic', 'anthropic/claude-sonnet-4.5', []],
  ])('%s %s', (provider, model, slugs) => {
    expect(openRouterSlugsFor(provider, model)).toEqual(slugs);
  });

  it('never the most similar: a model the list does not have stays without a price', () => {
    const list = new Map<string, ModelPrice>([['openai/gpt-4o', { input: 2.5, output: 10 }]]);
    expect(twinPrice('openai', 'gpt-4o-mini', list)).toBeUndefined();
    expect(twinPrice('openai', 'gpt-4o-2024-08-06', list)).toEqual({ input: 2.5, output: 10 });
  });
});

describe('the public list of OpenRouter', () => {
  it('is read without a key, and only the producers with direct keys are kept', async () => {
    let seen: { url: string; headers: Headers } | undefined;
    const fetchFn = ((url: string, init?: RequestInit) => {
      seen = { url, headers: new Headers(init?.headers) };
      return Promise.resolve(
        Response.json({
          data: [
            {
              id: 'anthropic/claude-sonnet-4.5',
              pricing: {
                prompt: '0.000003',
                completion: '0.000015',
                input_cache_read: '0.0000003',
                input_cache_write: '0.00000375',
              },
            },
            {
              id: 'openai/gpt-4.1-mini',
              pricing: { prompt: '0.0000004', completion: '0.0000016' },
            },
            {
              id: 'meta-llama/llama-3.3-70b-instruct',
              pricing: { prompt: '1e-7', completion: '1e-7' },
            },
            { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
          ],
        }),
      );
    }) as typeof fetch;
    const prices = await fetchOpenRouterPrices(fetchFn);
    expect(seen!.url).toBe(OPENROUTER_PUBLIC_MODELS_URL);
    expect(seen!.headers.has('authorization')).toBe(false);
    expect([...prices.keys()]).toEqual(['anthropic/claude-sonnet-4.5', 'openai/gpt-4.1-mini']);
    const sonnet = prices.get('anthropic/claude-sonnet-4.5')!;
    expect(sonnet.input).toBeCloseTo(3);
    expect(sonnet.cacheRead).toBeCloseTo(0.3);
    expect(sonnet.cacheWrite).toBeCloseTo(3.75);
  });

  it('pricePerMillion reads the cache prices when the list has them', () => {
    expect(pricePerMillion({ prompt: '0.000001', completion: '0.000002' })).toEqual({
      input: 1,
      output: 2,
    });
  });
});

describe('estimateCostUsd with the prompt cache', () => {
  const sonnet: ModelPrice = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

  it('counts the cache at its own price, not at the full input price', () => {
    const usd = estimateCostUsd(
      {
        inputTokens: 100_000,
        outputTokens: 1000,
        inputTokenDetails: { cacheReadTokens: 90_000, cacheWriteTokens: 5000 },
      },
      sonnet,
    )!;
    // 5 000 plain × 3 + 90 000 read × 0,3 + 5 000 written × 3,75 + 1 000 out × 15, per million.
    expect(usd).toBeCloseTo((5000 * 3 + 90_000 * 0.3 + 5000 * 3.75 + 1000 * 15) / 1e6, 9);
    // Before: everything at the input price, over four times as much.
    expect((100_000 * 3 + 1000 * 15) / 1e6 / usd).toBeGreaterThan(4);
  });

  it('without cache prices a read costs a share of the input, never the full price', () => {
    const usd = estimateCostUsd(
      { inputTokens: 1000, outputTokens: 0, inputTokenDetails: { cacheReadTokens: 1000 } },
      { input: 2, output: 8 },
    )!;
    expect(usd).toBeCloseTo((1000 * 2 * CACHE_READ_SHARE) / 1e6, 9);
    // No details: as before.
    expect(estimateCostUsd({ inputTokens: 1000, outputTokens: 0 }, { input: 2, output: 8 })).toBe(
      0.002,
    );
  });
});

describe('prices above 200k tokens of input (OpenRouter `pricing.overrides`)', () => {
  // Gemini 2.5 Pro as OpenRouter lists it: $1.25/$10 up to 200k of input, $2.50/$15 above.
  const gemini = pricePerMillion({
    prompt: '0.00000125',
    completion: '0.00001',
    input_cache_read: '0.000000125',
    input_cache_write: '0.000000375',
    overrides: [
      {
        min_prompt_tokens: 200000,
        prompt: '0.0000025',
        completion: '0.000015',
        input_cache_read: '0.00000025',
      },
    ],
  })!;

  it('reads the tiers of the list', () => {
    expect(gemini.tiers).toHaveLength(1);
    expect(gemini.tiers![0]!.minInputTokens).toBe(200_000);
    expect(gemini.tiers![0]!.input).toBeCloseTo(2.5);
    expect(gemini.tiers![0]!.output).toBeCloseTo(15);
  });

  it('a long prompt is priced at its tier, a short one at the base price', () => {
    const short = estimateCostUsd({ inputTokens: 100_000, outputTokens: 1000 }, gemini)!;
    expect(short).toBeCloseTo((100_000 * 1.25 + 1000 * 10) / 1e6, 9);
    const long = estimateCostUsd({ inputTokens: 300_000, outputTokens: 1000 }, gemini)!;
    expect(long).toBeCloseTo((300_000 * 2.5 + 1000 * 15) / 1e6, 9);
  });

  it('a price the tier does not give stays the base one (cache write)', () => {
    const usd = estimateCostUsd(
      {
        inputTokens: 250_000,
        outputTokens: 0,
        inputTokenDetails: { cacheReadTokens: 200_000, cacheWriteTokens: 10_000 },
      },
      gemini,
    )!;
    expect(usd).toBeCloseTo((40_000 * 2.5 + 200_000 * 0.25 + 10_000 * 0.375) / 1e6, 9);
  });

  it('an override that does not read is left out', () => {
    const p = pricePerMillion({
      prompt: '0.000001',
      completion: '0.000002',
      overrides: [{ prompt: '0.000003' }, { min_prompt_tokens: 'x', prompt: '1' }, 'junk'],
    });
    expect(p).toEqual({ input: 1, output: 2 });
  });
});
