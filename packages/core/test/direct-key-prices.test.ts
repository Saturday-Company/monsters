import { FakeProvider, type FakeStep } from '@monsters/providers/testing';
import { ProviderRegistry, type ModelPrice } from '@monsters/providers';
import type { LogEvent, SpendView } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { createCoreServices } from '../src/index.ts';
import { ModelWindows, PUBLIC_PRICES_KEY } from '../src/providers/windows.ts';
import { tempHome } from './helpers.ts';
import { startTestHub } from './hub-helpers.ts';

/*
 * The price of a direct key's model (review of 19/10, question 2): the same
 * model on OpenRouter's public list, read without a key, kept like the other
 * lists and on disk for a start offline. After it the cap stops direct keys
 * too (D-114), and its card says the cost is estimated.
 */

const SONNET: ModelPrice = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const LIST = new Map([['anthropic/claude-sonnet-4.5', SONNET]]);

describe('ModelWindows: the twin on OpenRouter’s public list', () => {
  it('prices a direct key’s model, keeps the list in the state, and uses it offline', async () => {
    const s = createCoreServices({ home: tempHome() });
    try {
      const registry = new ProviderRegistry().register(
        new FakeProvider({ id: 'anthropic', models: {} }),
      );
      let reads = 0;
      const windows = new ModelWindows(registry, {
        state: s.state,
        publicPrices: () => {
          reads++;
          return Promise.resolve(LIST);
        },
      });
      expect(await windows.resolvePrice('anthropic', 'claude-sonnet-4-5-20250929')).toEqual(SONNET);
      // Never the most similar, never Groq.
      expect(await windows.resolvePrice('anthropic', 'claude-opus-4-1')).toBeUndefined();
      expect(await windows.resolvePrice('groq', 'claude-sonnet-4-5')).toBeUndefined();
      expect(reads).toBe(1);
      expect(s.state.get(PUBLIC_PRICES_KEY)).toMatchObject({
        prices: { 'anthropic/claude-sonnet-4.5': SONNET },
      });

      // The next start, offline: the copy on disk.
      const offline = new ModelWindows(registry, {
        state: s.state,
        publicPrices: () => Promise.reject(new Error('offline')),
      });
      expect(await offline.resolvePrice('anthropic', 'claude-sonnet-4-5')).toEqual(SONNET);
      // No list at all: no price (as before).
      const none = new ModelWindows(registry, { publicPrices: null });
      expect(await none.resolvePrice('anthropic', 'claude-sonnet-4-5')).toBeUndefined();
    } finally {
      s.db.close();
    }
  });
});

describe('a direct key in the hub', () => {
  it('is counted at the estimated cost, the cache at its price, and the card says it', async () => {
    const step: FakeStep = {
      kind: 'text',
      text: 'Fatto.',
      usage: {
        inputTokens: { total: 100_000, noCache: 5000, cacheRead: 90_000, cacheWrite: 5000 },
        outputTokens: { total: 1000, text: 1000, reasoning: undefined },
      },
    };
    const anthropic = new FakeProvider({
      id: 'anthropic',
      models: { 'claude-sonnet-4-5': [step] },
    });
    const t = await startTestHub(
      {},
      {
        hub: {
          providers: new ProviderRegistry().register(anthropic),
          publicPrices: () => Promise.resolve(LIST),
        },
      },
    );
    await t.core.hub.team.setModels('titan', [
      { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    ]);
    // The list is read in the background at the first price asked: the card asks it.
    let view = await t.json<SpendView>('GET', '/api/settings/spend');
    for (let i = 0; i < 100 && !view.estimated; i++) {
      await new Promise((r) => setTimeout(r, 10));
      view = await t.json<SpendView>('GET', '/api/settings/spend');
    }
    expect(view.unpriced).toEqual([]);
    expect(view.estimated).toEqual([{ provider: 'anthropic', label: 'Anthropic' }]);

    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'ciao' });
    await t.runEnded(sent.runId);
    const usage = t
      .events(sent.runId)
      .find((e): e is LogEvent<'provider_usage'> => e.type === 'provider_usage')!;
    expect(usage.data).toMatchObject({ provider: 'anthropic', estimated: true });
    expect(usage.data.costUsd).toBeCloseTo(
      (5000 * 3 + 90_000 * 0.3 + 5000 * 3.75 + 1000 * 15) / 1e6,
      9,
    );
  });
});
