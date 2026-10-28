import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  errorReply,
  fakeHttp,
  json,
  streamReply,
  type FakeReply,
} from '@monsters/providers/testing';
import type { OpenRouterProvider } from '@monsters/providers';
import type { LogEvent, ProviderView, ProvidersResponse, SettingsResponse } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { restoreRateBudgets } from '../src/index.ts';
import { startTestHub } from './hub-helpers.ts';

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

/*
 * Providers from the core (M2.2): keys verified and saved from the API, local
 * servers, the chain of an agent, runs on the new providers and fallbacks
 * between them, budgets restored from the log. Every provider is a fake server.
 */

const ANTHROPIC_KEY = 'sk-ant-api03-core0test0key0000000000';
const OPENAI_KEY = 'sk-proj-core0test0key000000000000000';
const posix = process.platform !== 'win32';

/** Fake Anthropic, OpenAI and Ollama servers; chat replies are scripted per provider. */
function servers(script: { anthropic?: (FakeReply | Response)[]; openai?: FakeReply[] } = {}) {
  const queues = { anthropic: [...(script.anthropic ?? [])], openai: [...(script.openai ?? [])] };
  return fakeHttp((req) => {
    const url = new URL(req.url);
    if (url.host === 'api.anthropic.com') {
      if (url.pathname === '/v1/models') {
        return req.headers['x-api-key'] === ANTHROPIC_KEY
          ? json({ data: [{ id: 'claude-test', display_name: 'Claude Test', type: 'model' }] })
          : errorReply('anthropic', 401, 'invalid x-api-key');
      }
      if (url.pathname === '/v1/messages') {
        const next = queues.anthropic.shift() ?? { text: 'ciao da Anthropic' };
        return next instanceof Response ? next : streamReply('anthropic', next);
      }
    }
    if (url.host === 'api.openai.com') {
      if (req.headers['authorization'] !== `Bearer ${OPENAI_KEY}`) {
        return errorReply('openai', 401, 'Incorrect API key provided');
      }
      if (url.pathname === '/v1/models') return json({ data: [{ id: 'gpt-test' }] });
      if (url.pathname === '/v1/chat/completions') {
        return streamReply('openai', queues.openai.shift() ?? { text: 'ciao da OpenAI' });
      }
    }
    if (url.host === '127.0.0.1:11434') {
      if (url.pathname === '/api/tags') return json({ models: [{ name: 'qwen3:8b' }] });
      if (url.pathname === '/api/show') return json({ capabilities: ['completion', 'tools'] });
    }
    return undefined;
  });
}

const provider = (list: ProvidersResponse, id: string): ProviderView =>
  list.providers.find((p) => p.id === id)!;

describe('providers API', () => {
  it('verifies, saves (600), lists and removes a key that never comes back', async () => {
    const http = servers();
    const t = await startTestHub({}, { hub: { providers: undefined, fetch: http.fetch } });
    const before = await t.json<ProvidersResponse>('GET', '/api/providers');
    expect(before.providers.map((p) => p.id)).toEqual([
      'openrouter',
      'anthropic',
      'openai',
      'google',
      'mistral',
      'groq',
      'ollama',
      'lmstudio',
      'chatgpt',
      'codex',
      'claude-agent',
    ]);
    // Subscriptions are set up in their own block, never with a key (M2.7).
    expect(provider(before, 'chatgpt')).toMatchObject({ configured: false, subscription: true });
    expect(provider(before, 'anthropic')).toMatchObject({ configured: false, paid: true });
    expect(provider(before, 'ollama')).toMatchObject({
      configured: false,
      local: true,
      baseURL: 'http://127.0.0.1:11434',
    });

    const bad = await t.api('PUT', '/api/providers/anthropic/key', {
      key: 'sk-ant-wrong0000000000000',
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid_key' });

    const res = await t.api('PUT', '/api/providers/anthropic/key', { key: ANTHROPIC_KEY });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(ANTHROPIC_KEY);
    expect(JSON.parse(text)).toMatchObject({ id: 'anthropic', configured: true, source: 'file' });
    const file = join(t.home, 'secrets', 'anthropic.key');
    expect(readFileSync(file, 'utf8').trim()).toBe(ANTHROPIC_KEY);
    if (posix) expect(statSync(file).mode & 0o777).toBe(0o600);

    const list = await t.api('GET', '/api/providers');
    expect(await list.text()).not.toContain(ANTHROPIC_KEY);
    const models = await t.json<{ models: { id: string }[] }>(
      'GET',
      '/api/providers/anthropic/models?tools=1',
    );
    expect(models.models.map((m) => m.id)).toEqual(['claude-test']);

    const removed = await t.json<ProviderView>('DELETE', '/api/providers/anthropic/key');
    expect(removed.configured).toBe(false);
    expect(existsSync(file)).toBe(false);
    expect(t.core.hub.providers.has('anthropic')).toBe(false);
    expect((await t.api('GET', '/api/providers/nope/models')).status).toBe(404);
  });

  it('a key from the environment is used but cannot be removed from the UI', async () => {
    const http = servers();
    const t = await startTestHub(
      {},
      { hub: { providers: undefined, fetch: http.fetch, env: { OPENAI_API_KEY: OPENAI_KEY } } },
    );
    const list = await t.json<ProvidersResponse>('GET', '/api/providers');
    expect(provider(list, 'openai')).toMatchObject({
      configured: true,
      source: 'env',
      envVar: 'OPENAI_API_KEY',
    });
    const del = await t.api('DELETE', '/api/providers/openai/key');
    expect(del.status).toBe(409);
    expect(await del.json()).toMatchObject({ error: 'key_from_env' });
    // Never written in the log even when something tries.
    const e = t.core.log.append({ agent: 'system', type: 'error', data: { message: OPENAI_KEY } });
    expect(e.data.message).not.toContain(OPENAI_KEY);
  });

  it('paid OpenRouter models: refused in words until the switch is on, applied without a restart', async () => {
    const http = fakeHttp((req) =>
      new URL(req.url).pathname === '/api/v1/key'
        ? json({ data: { label: 'prova', free_model_daily_requests: { used: 0, limit: 50 } } })
        : undefined,
    );
    const t = await startTestHub(
      {},
      {
        hub: {
          providers: undefined,
          fetch: http.fetch,
          env: { OPENROUTER_API_KEY: 'sk-or-v1-core0test0key000000000000' },
        },
      },
    );
    const before = t.core.hub.providers.get('openrouter') as OpenRouterProvider;
    expect(before.freeOnly).toBe(true);
    let list = await t.json<ProvidersResponse>('GET', '/api/providers');
    expect(provider(list, 'openrouter')).toMatchObject({ configured: true, freeOnly: true });

    // The selector cannot save a paid model while the switch is off.
    const paidChain = {
      models: [{ provider: 'openrouter', model: 'google/gemini-2.5-flash-lite' }],
    };
    const refused = await t.api('PUT', '/api/agents/rhea/models', paidChain);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: 'paid_model_blocked',
      message: expect.stringContaining('Also use paid models') as unknown,
    });

    // Switch on: saved in settings.json, the same provider accepts paid models at once.
    const view = await t.json<SettingsResponse>('PUT', '/api/settings/openrouter', {
      freeOnly: false,
    });
    expect(view.openrouterKey).toMatchObject({ set: true, freeOnly: false });
    const file = JSON.parse(readFileSync(join(t.home, 'settings.json'), 'utf8')) as {
      openrouter?: { freeOnly?: boolean };
    };
    expect(file.openrouter?.freeOnly).toBe(false);
    expect(t.core.hub.providers.get('openrouter')).toBe(before);
    expect(before.freeOnly).toBe(false);
    expect(() => before.model('google/gemini-2.5-flash-lite')).not.toThrow();
    list = await t.json<ProvidersResponse>('GET', '/api/providers');
    expect(provider(list, 'openrouter').freeOnly).toBe(false);
    expect((await t.api('PUT', '/api/agents/rhea/models', paidChain)).status).toBe(200);
    expect((await t.api('PUT', '/api/settings/openrouter', { freeOnly: 'no' })).status).toBe(400);

    // Switch off again: a run on the paid model fails with words the user can act on.
    await t.json('PUT', '/api/settings/openrouter', { freeOnly: true });
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: '@rhea ciao' });
    const end = await t.runEnded(sent.runId);
    expect(end.data.status).toBe('failed');
    expect(end.data.error).toMatch(
      /^no model available: openrouter:google\/gemini-2\.5-flash-lite \(google\/gemini-2\.5-flash-lite is a paid model/,
    );
    const fallback = t
      .events(sent.runId)
      .find(
        (e): e is LogEvent<'error'> => e.type === 'error' && e.data.code === 'provider_fallback',
      );
    expect(fallback?.data.message).toContain('(paid model not turned on)');
    expect(JSON.stringify(t.events(sent.runId))).not.toContain('limited to free models');
  });

  it('connects Ollama by address, saved in settings.json', async () => {
    const http = servers();
    const t = await startTestHub({}, { hub: { providers: undefined, fetch: http.fetch } });
    const off = await t.api('PUT', '/api/providers/ollama/url', { baseURL: 'http://127.0.0.1:9' });
    expect(off.status).toBe(502);
    expect(await off.json()).toMatchObject({ error: 'verification_failed' });
    const view = await t.json<ProviderView>('PUT', '/api/providers/ollama/url', {
      baseURL: 'http://127.0.0.1:11434/v1',
    });
    expect(view).toMatchObject({
      configured: true,
      source: 'settings',
      baseURL: 'http://127.0.0.1:11434',
    });
    const settings = JSON.parse(readFileSync(join(t.home, 'settings.json'), 'utf8')) as {
      providers: Record<string, { baseURL?: string }>;
    };
    expect(settings.providers['ollama']?.baseURL).toBe('http://127.0.0.1:11434');
    const models = await t.json<{ models: { id: string; tools: boolean }[] }>(
      'GET',
      '/api/providers/ollama/models',
    );
    // No details from the server: Ollama's default context, the least it gives.
    expect(models.models).toEqual([{ id: 'qwen3:8b', tools: true, free: true, context: 4096 }]);
    const removed = await t.json<ProviderView>('DELETE', '/api/providers/ollama/url');
    expect(removed.configured).toBe(false);
  });

  it('sets the chain of an agent in agent.yaml, only on configured providers', async () => {
    const http = servers();
    const t = await startTestHub({}, { hub: { providers: undefined, fetch: http.fetch } });
    await t.json('PUT', '/api/providers/anthropic/key', { key: ANTHROPIC_KEY });
    const refused = await t.api('PUT', '/api/agents/rhea/models', {
      models: [
        { provider: 'anthropic', model: 'claude-test' },
        { provider: 'openai', model: 'gpt-test' },
      ],
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: 'not_configured' });
    expect(
      (
        await t.api('PUT', '/api/agents/nobody/models', {
          models: [{ provider: 'anthropic', model: 'claude-test' }],
        })
      ).status,
    ).toBe(404);

    const saved = await t.json('PUT', '/api/agents/rhea/models', {
      models: [{ provider: 'anthropic', model: 'claude-test' }],
    });
    expect(saved).toMatchObject({
      id: 'rhea',
      models: [{ provider: 'anthropic', model: 'claude-test' }],
    });
    const yaml = readFileSync(join(t.home, 'agents', 'rhea', 'agent.yaml'), 'utf8');
    expect(yaml).toContain('provider: anthropic');
    expect(yaml).toContain('model: claude-test');
    expect(yaml).toContain('name: Rhea');

    // The next run of Rhea uses Anthropic: tokens in provider_usage.
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: '@rhea ciao' });
    const end = await t.runEnded(sent.runId);
    expect(end.data.status).toBe('completed');
    const usage = t
      .events(sent.runId)
      .find((e): e is LogEvent<'provider_usage'> => e.type === 'provider_usage');
    expect(usage?.data).toMatchObject({
      provider: 'anthropic',
      model: 'claude-test',
      inputTokens: 11,
      outputTokens: 6,
    });
  });

  it('falls back from one provider to another, the refused key redacted in the log', async () => {
    // Anthropic refuses the key and echoes it in the error, as some providers do.
    const http = servers({
      anthropic: [errorReply('anthropic', 401, `invalid x-api-key ${ANTHROPIC_KEY}`)],
      openai: [{ text: 'ciao da OpenAI' }],
    });
    const t = await startTestHub(
      {},
      {
        hub: {
          providers: undefined,
          fetch: http.fetch,
          env: { ANTHROPIC_API_KEY: ANTHROPIC_KEY, OPENAI_API_KEY: OPENAI_KEY },
        },
      },
    );
    await t.json('PUT', '/api/agents/rhea/models', {
      models: [
        { provider: 'anthropic', model: 'claude-test' },
        { provider: 'anthropic', model: 'claude-other' },
        { provider: 'openai', model: 'gpt-test' },
      ],
    });
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: '@rhea ciao' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const events = t.events(sent.runId);
    const fallback = events.find(
      (e): e is LogEvent<'error'> => e.type === 'error' && e.data.code === 'provider_fallback',
    );
    expect(fallback?.data.message).toContain('anthropic:claude-test → openai:gpt-test');
    expect(fallback?.data.message).toContain('invalid key');
    expect(JSON.stringify(t.core.log.query({ limit: 1000 }))).not.toContain(ANTHROPIC_KEY);
    expect(http.to('/v1/messages')).toHaveLength(1);
    const usage = events.find((e): e is LogEvent<'provider_usage'> => e.type === 'provider_usage');
    expect(usage?.data.provider).toBe('openai');
  });

  it('budgets of keyed providers restart from the log, with limits set by the user', async () => {
    const http = servers();
    const t = await startTestHub(
      {},
      {
        hub: {
          providers: undefined,
          fetch: http.fetch,
          env: { OPENAI_API_KEY: OPENAI_KEY },
          settings: { providers: { openai: { rpd: 5 } } },
        },
      },
    );
    for (let i = 0; i < 3; i++) {
      t.core.log.append({
        agent: 'titan',
        type: 'provider_usage',
        data: { provider: 'openai', model: 'gpt-test' },
      });
    }
    // Requests logged by others: this budget did not grant them.
    const p = t.core.hub.providers.get('openai');
    expect(p.budget.snapshot().windows).toEqual([{ limit: 5, windowMs: 86_400_000, used: 0 }]);
    // Re-saving the same key re-creates the provider and takes the log back.
    await t.json('PUT', '/api/providers/openai/key', { key: OPENAI_KEY });
    const again = t.core.hub.providers.get('openai');
    expect(again).not.toBe(p);
    expect(again.budget.snapshot().windows[0]?.used).toBe(3);
    // Idempotent.
    restoreRateBudgets(t.core.hub.providers, t.core.log, { ids: ['openai'] });
    expect(again.budget.snapshot().windows[0]?.used).toBe(3);
  });
});
