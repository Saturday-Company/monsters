import { z } from 'zod';
import type { ModelPrice } from './cost.ts';
import { pricePerMillion } from './openrouter.ts';

/*
 * Prices for the direct keys (D-114, review of 19/10, question 2). Anthropic,
 * OpenAI and Google report only tokens and their model lists have no price;
 * OpenRouter resells their models at the producer's price (its fee is on the
 * credits, not per token), and its public list of models gives those prices
 * without a key. So a direct key's model is priced at its OpenRouter twin, found
 * by an exact mapping of the id: never "the most similar" (gpt-4o-mini priced as
 * gpt-4o would be 16 times off and stop a cap for nothing). Groq and Mistral
 * have no twin: Groq hosts open models at prices of its own, and Mistral's
 * aliases do not match OpenRouter's slugs; they stay without a price.
 */

/** OpenRouter's public list of models: no key, the same for everyone. */
export const OPENROUTER_PUBLIC_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** `claude-sonnet-4-5` → `claude-sonnet-4.5`: OpenRouter writes the versions with a dot. */
const dotted = (id: string) => id.replace(/(?<=-)(\d)-(\d)(?=-|$)/g, '$1.$2');

/**
 * The OpenRouter ids that are exactly this model of a direct provider, the most
 * precise first: the price of the first one the list has is the model's. Empty
 * for a provider without twins (Groq, Mistral, the rest).
 */
export function openRouterSlugsFor(provider: string, model: string): string[] {
  const id = model
    .trim()
    .toLowerCase()
    .replace(/^models\//, '');
  if (!id || id.includes('/')) return [];
  switch (provider) {
    case 'anthropic': {
      // `claude-sonnet-4-5-20250929`, `claude-3-5-haiku-latest` → `claude-sonnet-4.5`, `claude-3.5-haiku`.
      const base = id.replace(/-(\d{8}|latest)$/, '');
      return [`anthropic/${dotted(base)}`];
    }
    case 'openai': {
      // `gpt-4.1-mini`, `o4-mini` as they are; `gpt-4o-2024-08-06` → `gpt-4o`.
      const base = id.replace(/-\d{4}-\d{2}-\d{2}$/, '');
      return [...new Set([`openai/${id}`, `openai/${base}`])];
    }
    case 'google': {
      // `models/gemini-2.5-flash`, `gemini-2.0-flash-001`, `gemini-2.5-pro-latest`.
      const base = id.replace(/-(latest|\d{3})$/, '');
      return [...new Set([`google/${id}`, `google/${base}`])];
    }
    default:
      return [];
  }
}

/** The price of a direct provider's model in OpenRouter's list, by exact id; undefined without a twin. */
export function twinPrice(
  provider: string,
  model: string,
  list: ReadonlyMap<string, ModelPrice>,
): ModelPrice | undefined {
  for (const slug of openRouterSlugsFor(provider, model)) {
    const price = list.get(slug);
    if (price) return price;
  }
  return undefined;
}

const PublicModelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      pricing: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
  ),
});

/**
 * Reads OpenRouter's public list of models (no key, no data of the user) as id → price,
 * only for the producers that have direct keys in Monsters.
 */
export async function fetchOpenRouterPrices(
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Map<string, ModelPrice>> {
  const res = await fetchFn(OPENROUTER_PUBLIC_MODELS_URL, {
    headers: { accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`OpenRouter public model list failed: HTTP ${res.status}`);
  const body = PublicModelsSchema.parse(await res.json());
  const out = new Map<string, ModelPrice>();
  for (const m of body.data) {
    if (!/^(anthropic|openai|google)\//.test(m.id)) continue;
    const price = pricePerMillion(m.pricing);
    // A negative or missing price ("-1" for routers) is no price.
    if (price && price.input > 0) out.set(m.id, price);
  }
  return out;
}
