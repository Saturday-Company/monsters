/*
 * Cost of a request. OpenRouter reports it (`providerMetadata.openrouter.usage.cost`,
 * in dollars); the other providers only report tokens. When the cost is missing,
 * it is estimated from the tokens and the price of the provider's model list
 * (USD per million tokens, `ModelInfo.price`, F-A4, D-114); without a price
 * nothing is made up.
 */

function numberAt(obj: unknown, ...path: string[]): number | undefined {
  let v: unknown = obj;
  for (const key of path) {
    if (!v || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[key];
  }
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** Dollars spent by one request, from the step's provider metadata (undefined when unknown). */
export function costFromMetadata(providerMetadata: unknown): number | undefined {
  if (!providerMetadata || typeof providerMetadata !== 'object') return undefined;
  for (const meta of Object.values(providerMetadata as Record<string, unknown>)) {
    const cost = numberAt(meta, 'usage', 'cost') ?? numberAt(meta, 'cost');
    if (cost !== undefined) return cost;
  }
  return undefined;
}

/** A model's price, in dollars per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Input read from the prompt cache, when the price list says it. */
  cacheRead?: number;
  /** Input written to the prompt cache, when the price list says it. */
  cacheWrite?: number;
  /**
   * Prices of the long prompts, when the list has them (Gemini Pro and Claude Sonnet 4.5 cost
   * more above 200k tokens of input): a tier applies to the whole request once its input
   * reaches `minInputTokens`, and a price the tier does not give stays the base one.
   */
  tiers?: PriceTier[];
}

/** A price above a threshold of input tokens (OpenRouter's `pricing.overrides`). */
export interface PriceTier {
  minInputTokens: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** The price that applies to a request with this many input tokens (cache included). */
export function priceForInput(price: ModelPrice, inputTokens: number): ModelPrice {
  let best: PriceTier | undefined;
  for (const tier of price.tiers ?? []) {
    if (inputTokens >= tier.minInputTokens && (!best || tier.minInputTokens > best.minInputTokens))
      best = tier;
  }
  if (!best) return price;
  const cacheRead = best.cacheRead ?? price.cacheRead;
  const cacheWrite = best.cacheWrite ?? price.cacheWrite;
  return {
    input: best.input ?? price.input,
    output: best.output ?? price.output,
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
  };
}

/**
 * Of the input price, what a token read from the cache costs when the list does not say it:
 * every provider charges less for it (Anthropic 0,1×, Google 0,25×, OpenAI 0,25-0,5×). Half
 * stays on the safe side for a spending cap without counting it at the full price, which made
 * an agent with a long cached prompt stop five or ten times too early.
 */
export const CACHE_READ_SHARE = 0.5;

/** The tokens of a request as the AI SDK reports them (`inputTokens` includes the cache). */
export interface RequestTokens {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?:
    { cacheReadTokens?: number | undefined; cacheWriteTokens?: number | undefined } | undefined;
}

/**
 * Dollars of a request from its tokens and the model's price, or undefined
 * without a price or without any token. A long prompt is priced at its tier
 * (`ModelPrice.tiers`) when the list has one. Input read from or written to the
 * prompt cache is counted at the list's cache prices; without them a read
 * costs `CACHE_READ_SHARE` of the input price and a write the input price.
 */
export function estimateCostUsd(
  tokens: RequestTokens,
  price: ModelPrice | undefined,
): number | undefined {
  if (!price) return undefined;
  if (tokens.inputTokens === undefined && tokens.outputTokens === undefined) return undefined;
  const input = Math.max(0, tokens.inputTokens ?? 0);
  const p = priceForInput(price, input);
  const output = Math.max(0, tokens.outputTokens ?? 0);
  const read = Math.min(input, Math.max(0, tokens.inputTokenDetails?.cacheReadTokens ?? 0));
  const write = Math.min(
    input - read,
    Math.max(0, tokens.inputTokenDetails?.cacheWriteTokens ?? 0),
  );
  const plain = input - read - write;
  const usd =
    (plain * p.input +
      read * (p.cacheRead ?? p.input * CACHE_READ_SHARE) +
      write * (p.cacheWrite ?? p.input) +
      output * p.output) /
    1_000_000;
  return Number.isFinite(usd) ? usd : undefined;
}

/** Tokens of a text the provider never counted (an answer cut halfway): about 4 characters each. */
export function estimateTokens(chars: number): number {
  return chars > 0 ? Math.ceil(chars / 4) : 0;
}
