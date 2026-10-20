import type { ModelRefView, ProviderView, ProvidersResponse } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { chainHint, keyKind, settleModels, type ModelsApi } from '../src/onboarding/models.ts';

const view = (id: string, kind: 'model' | 'harness', configured: boolean, subscription = false) =>
  ({
    id,
    label: id,
    kind,
    auth: 'api-key',
    paid: false,
    freeTier: false,
    local: false,
    subscription,
    configured,
  }) as ProviderView;

function fakeApi(providers: ProviderView[], chains: Record<string, ModelRefView[]>) {
  const saved: Record<string, ModelRefView[]> = {};
  const api: ModelsApi = {
    providers: (): Promise<ProvidersResponse> =>
      Promise.resolve({
        providers,
        agents: Object.entries(chains).map(([id, models]) => ({
          id,
          name: id,
          color: '#000',
          isOrchestrator: false,
          models,
        })),
      }),
    providerModels: (id) =>
      Promise.resolve({
        models:
          id === 'anthropic'
            ? [
                { id: 'claude-opus', tools: true, free: false },
                { id: 'claude-sonnet', tools: true, free: false },
              ]
            : [],
      }),
    setAgentModels: (id, models) => {
      saved[id] = models;
      return Promise.resolve({ id, name: id, color: '#000', isOrchestrator: false, models });
    },
  };
  return { api, saved };
}

const FREE = [{ provider: 'openrouter', model: 'openrouter/free' }];

describe('onboarding models', () => {
  it('recognises keys by their prefix', () => {
    expect(keyKind('sk-or-v1-abc')?.provider).toBe('openrouter');
    expect(keyKind('sk-ant-api03-abc')?.provider).toBe('anthropic');
    expect(keyKind('sk-proj-abc')?.provider).toBe('openai');
    expect(keyKind('sk-abc')?.provider).toBe('openai');
    expect(keyKind(' AIzaSyabc')?.provider).toBe('google');
    expect(keyKind('gsk_abc')?.provider).toBe('groq');
    expect(keyKind('qualcosa')).toBeNull();
  });

  it('says the order only when there is a fallback', () => {
    expect(chainHint(['openrouter'])).toContain('nelle impostazioni');
    expect(chainHint(['openrouter', 'chatgpt'])).toBe(
      'Userò prima ChatGPT, poi OpenRouter se serve.',
    );
    // Claude Code never falls back (D-035): no "poi".
    expect(chainHint(['openrouter', 'claude-agent'])).toBe(
      'Userò Claude. Anche OpenRouter resta collegato: nelle impostazioni lo puoi dare a un mostro.',
    );
  });

  it('moves the team to a paid key when OpenRouter is not there', async () => {
    const { api, saved } = fakeApi(
      [view('openrouter', 'model', false), view('anthropic', 'model', true)],
      { titan: FREE, rhea: FREE },
    );
    await settleModels(api, ['titan', 'rhea']);
    expect(saved['titan']).toEqual([{ provider: 'anthropic', model: 'claude-sonnet' }]);
    expect(saved['rhea']).toEqual(saved['titan']);
  });

  it('adds the free router after ChatGPT, never after Claude Code', async () => {
    const { api, saved } = fakeApi(
      [
        view('openrouter', 'model', true),
        view('chatgpt', 'model', true, true),
        view('claude-agent', 'harness', true, true),
      ],
      {
        titan: [{ provider: 'chatgpt', model: 'gpt' }],
        rhea: [{ provider: 'claude-agent', model: 'sonnet' }],
        dione: FREE,
      },
    );
    await settleModels(api, ['titan', 'rhea', 'dione']);
    expect(saved['titan']).toEqual([{ provider: 'chatgpt', model: 'gpt' }, ...FREE]);
    expect(saved['rhea']).toBeUndefined();
    expect(saved['dione']).toBeUndefined();
  });
});
