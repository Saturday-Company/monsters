import {
  DAY_MS,
  MINUTE_MS,
  ProviderRegistry,
  RateBudget,
  type ModelProvider,
} from '@monsters/providers';
import { fake, FakeProvider, type FakeScript } from '@monsters/providers/testing';
import type { LogEvent } from '@monsters/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EventLog,
  LlmDecisionPort,
  createCoreServices,
  restoreRateBudgets,
  startCore,
  type CoreServer,
  type CoreServices,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { deferred, fakeWebSearch, startTestHub } from './hub-helpers.ts';

const WINDOWS = [
  { limit: 20, windowMs: MINUTE_MS },
  { limit: 50, windowMs: DAY_MS },
];

const used = (p: FakeProvider) => p.budget.snapshot().windows.map((w) => w.used);

const opened: CoreServices[] = [];
const restarted: CoreServer[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) s.db.close();
  for (const c of restarted.splice(0)) await c.close();
});

function registry(models: Record<string, FakeScript> = {}): {
  provider: FakeProvider;
  providers: ProviderRegistry;
} {
  const provider = new FakeProvider({ models, windows: WINDOWS, keyId: 'abcdef012345' });
  return { provider, providers: new ProviderRegistry().register(provider) };
}

describe('rate budgets across a restart', () => {
  it('only the requests the windows count come back (OpenRouter: the free models, D-082)', async () => {
    const services = createCoreServices({ home: tempHome() });
    opened.push(services);
    const usage = (model: string, requestedModel?: string) =>
      services.log.append({
        agent: 'titan',
        type: 'provider_usage',
        data: { provider: 'or', model, ...(requestedModel ? { requestedModel } : {}) },
      });
    usage('qwen/a:free');
    usage('vendor/x:free', 'openrouter/free');
    usage('qwen/paid');
    usage('qwen/paid');
    await new Promise((r) => setTimeout(r, 5));
    const budget = new RateBudget({
      id: 'or',
      windows: WINDOWS,
      counts: (m) => m.endsWith(':free') || m === 'openrouter/free',
    });
    const provider = {
      id: 'or',
      kind: 'model',
      auth: 'api-key',
      budget,
      listModels: () => Promise.resolve([]),
      model: () => {
        throw new Error('unused');
      },
    } as unknown as ModelProvider;
    const restored = restoreRateBudgets(new ProviderRegistry().register(provider), services.log);
    expect(restored.get('or')).toBe(2);
    expect(budget.snapshot().windows.map((w) => w.used)).toEqual([2, 2]);
  });

  it('a restarted core starts from the requests of the log: agents, subagents and gate once each', async () => {
    const { provider, providers } = registry({
      titan: [
        fake.toolCalls([{ name: 'delegate', input: { agent: 'Rhea', goal: 'Trova 3 fatti' } }]),
        fake.text('Fatto.'),
      ],
      rhea: [fake.text('Ecco 3 fatti.')],
      gate: [
        fake.text(
          JSON.stringify({
            answers: [
              { id: 'needs_user', value: 0.1, confidence: 0.95 },
              { id: 'option', value: 'Per tema', confidence: 0.9 },
            ],
          }),
        ),
      ],
    });
    const t = await startTestHub(
      {},
      {
        hub: {
          providers,
          decisionPort: new LlmDecisionPort({
            providers,
            models: [{ provider: 'fake', model: 'gate' }],
          }),
          // The small LLM is a choice of the user since D-065 (the default is the rules).
          settings: { decisions: { engine: 'llm' } },
        },
      },
    );
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'Ricerca' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    await t.core.hub.gate.decide({
      agent: 'titan',
      runId: sent.runId,
      question: 'Ordine delle sezioni?',
      options: ['Cronologico', 'Per tema'],
    });

    // Orchestrator (2 steps), subagent (1) and gate (1): one provider_usage per request.
    const usage = t.events().filter((e): e is LogEvent<'provider_usage'> => {
      return e.type === 'provider_usage';
    });
    expect(provider.calls).toHaveLength(4);
    expect(usage.map((u) => `${u.agent}:${u.data.model}`).sort()).toEqual([
      'rhea:rhea',
      'titan:gate',
      'titan:titan',
      'titan:titan',
    ]);
    // Each with the fingerprint of the key that served it.
    expect(usage.map((u) => u.data.keyId)).toEqual(Array(4).fill('abcdef012345'));
    expect(used(provider)).toEqual([4, 4]);
    // The running budget already counted them: restoring it again adds nothing.
    restoreRateBudgets(providers, t.core.log);
    expect(used(provider)).toEqual([4, 4]);

    // Restart on the same home with a brand-new provider: same count, not zero.
    await t.core.close();
    const again = registry();
    const core = await startCore({
      home: t.home,
      port: 0,
      env: {},
      hub: {
        providers: again.providers,
        webTools: [fakeWebSearch],
        decisionPort: null,
        settings: { watchVault: false, userName: 'Giulio' },
      },
    });
    restarted.push(core);
    expect(used(again.provider)).toEqual([4, 4]);
  });

  it('restores each provider from its own requests, only inside its windows', () => {
    const s = createCoreServices({ home: tempHome() });
    opened.push(s);
    const T = Date.now();
    let now = T;
    const log = new EventLog(s.db, { now: () => now });
    const usage = (provider: string, at: number) => {
      now = at;
      log.append({ agent: 'titan', type: 'provider_usage', data: { provider, model: 'm' } });
    };
    usage('fake', T - 2 * DAY_MS); // outside every window
    usage('fake', T - 3 * 3_600_000); // day window only
    usage('other', T - 3 * 3_600_000); // outside the only window of `other`
    usage('fake', T - 20_000); // minute and day
    usage('fake', T - 10_000);

    const clock = () => T;
    const provider = new FakeProvider({ models: {}, windows: WINDOWS, now: clock });
    const other = new FakeProvider({
      id: 'other',
      models: {},
      windows: [{ limit: 5, windowMs: MINUTE_MS }],
      now: clock,
    });
    const providers = new ProviderRegistry().register(provider).register(other);
    const restored = restoreRateBudgets(providers, log, { now: T });
    expect(Object.fromEntries(restored)).toEqual({ fake: 3, other: 0 });
    expect(used(provider)).toEqual([2, 3]);
    expect(used(other)).toEqual([0]);
  });

  it('gives a keyed provider back only the requests of its key', () => {
    const s = createCoreServices({ home: tempHome() });
    opened.push(s);
    const T = Date.now();
    let now = T;
    const log = new EventLog(s.db, { now: () => now });
    const usage = (at: number, keyId?: string) => {
      now = at;
      log.append({
        agent: 'titan',
        type: 'provider_usage',
        data: { provider: 'fake', model: 'm', ...(keyId ? { keyId } : {}) },
      });
    };
    const A = 'aaaaaaaaaaaa';
    const B = 'bbbbbbbbbbbb';
    usage(T - 5 * 3_600_000); // before fingerprints, before the change of key
    usage(T - 4 * 3_600_000, A);
    usage(T - 3 * 3_600_000, A);
    usage(T - 2 * 3_600_000); // before fingerprints, after the change of key
    usage(T - 3_600_000, B);
    const keyed = (keyId?: string) => {
      const p = new FakeProvider({
        models: {},
        windows: WINDOWS,
        now: () => T,
        ...(keyId ? { keyId } : {}),
      });
      return { p, providers: new ProviderRegistry().register(p) };
    };
    const legacySince = { fake: T - 2.5 * 3_600_000 };

    const b = keyed(B);
    expect(restoreRateBudgets(b.providers, log, { now: T, legacySince }).get('fake')).toBe(2);
    const a = keyed(A);
    expect(restoreRateBudgets(a.providers, log, { now: T, legacySince }).get('fake')).toBe(3);
    // No record of a change of key: the unmarked requests all count.
    const a2 = keyed(A);
    expect(restoreRateBudgets(a2.providers, log, { now: T }).get('fake')).toBe(4);
    // A provider without a key fingerprint gets everything back, as before.
    const plain = keyed();
    expect(restoreRateBudgets(plain.providers, log, { now: T, legacySince }).get('fake')).toBe(5);
  });

  it('a new OpenRouter key does not inherit the requests of the old one, not even after a restart', async () => {
    const keyA = `sk-or-v1-${'a'.repeat(32)}`;
    const keyB = `sk-or-v1-${'b'.repeat(32)}`;
    // OpenRouter answers /key without the daily counter: the budget relies on the log.
    const fakeFetch: typeof fetch = () =>
      Promise.resolve(Response.json({ data: { label: 'prova', is_free_tier: true } }));
    const hub = {
      providers: undefined,
      fetch: fakeFetch,
      env: { OPENROUTER_API_KEY: keyA },
      webTools: [fakeWebSearch],
      decisionPort: null,
      settings: { watchVault: false, userName: 'Giulio' },
    };
    const t = await startTestHub({}, { hub });
    const today = (c: CoreServer) =>
      c.hub.providers
        .get('openrouter')
        .budget.snapshot()
        .windows.find((w) => w.windowMs === DAY_MS)!.used;
    const a = t.core.hub.providers.get('openrouter');
    // Written before fingerprints existed (same key A).
    for (let i = 0; i < 5; i++) {
      t.core.log.append({
        agent: 'titan',
        type: 'provider_usage',
        data: { provider: 'openrouter', model: 'm:free' },
      });
    }
    // 45 requests served with key A.
    for (let i = 0; i < 45; i++) {
      t.core.log.append({
        agent: 'titan',
        type: 'provider_usage',
        data: { provider: 'openrouter', model: 'm:free', ...(a.keyId ? { keyId: a.keyId } : {}) },
      });
    }

    expect(await t.core.hub.setOpenRouterKey(keyB)).toMatchObject({ ok: true });
    expect(today(t.core)).toBe(0);
    // Restart the same UTC day: key B (saved in the secrets) still starts from zero.
    await t.core.close();
    const core = await startCore({ home: t.home, port: 0, env: {}, hub });
    restarted.push(core);
    expect(today(core)).toBe(0);

    // Back to key A: its own requests count again (the old ones, unmarked, no longer).
    expect(await core.hub.setOpenRouterKey(keyA)).toMatchObject({ ok: true });
    expect(today(core)).toBe(45);
    const logged = JSON.stringify(core.log.query({ limit: 1000 }));
    expect(logged).not.toContain(keyA);
    expect(logged).not.toContain(keyB);
  });

  it('reads the OpenRouter daily counter at startup without waiting for it, and never logs the key', async () => {
    const key = 'sk-or-v1-0123456789abcdef0123456789abcdef';
    const answer = deferred<Response>();
    const calls: string[] = [];
    const fakeFetch: typeof fetch = (input, init) => {
      calls.push(input instanceof Request ? input.url : input.toString());
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${key}`);
      return answer.promise;
    };
    // The core is up while OpenRouter has not answered yet.
    const t = await startTestHub(
      {},
      { hub: { providers: undefined, fetch: fakeFetch, env: { OPENROUTER_API_KEY: key } } },
    );
    const day = () =>
      t.core.hub.providers
        .get('openrouter')
        .budget.snapshot()
        .windows.find((w) => w.windowMs === DAY_MS)!;
    expect(calls).toEqual(['https://openrouter.ai/api/v1/key']);
    expect(day().used).toBe(0);

    answer.resolve(
      Response.json({
        data: { free_model_daily_requests: { used: 37, limit: 1000, remaining: 963 } },
      }),
    );
    await vi.waitFor(() => expect(day().used).toBe(37));
    // No `rpd` in the settings: the account's limit (credits bought) replaces the default 50.
    expect(day().limit).toBe(1000);
    expect(JSON.stringify(t.events())).not.toContain(key);
  });
});
