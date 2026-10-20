import { describe, expect, it } from 'vitest';
import {
  AgentModelsRequestSchema,
  AgentModelsSchema,
  autoChain,
  autoEffort,
  isAutoChain,
  ModelRefViewSchema,
  ReceiptDataSchema,
} from '../src/index.ts';

/*
 * Chains with tiers through the API (D-093): zod used to strip `tier` at every
 * save from the UI; "Automatica" writes a chain from a base.
 */

describe('model chains with tiers', () => {
  it('keeps the tier of every link in a save request', () => {
    const body = {
      models: [
        { provider: 'claude-agent', model: 'sonnet' },
        { provider: 'claude-agent', model: 'haiku', tier: 'light' },
        { provider: 'claude-agent', model: 'opus', tier: 'strong' },
      ],
    };
    expect(AgentModelsRequestSchema.parse(body)).toEqual(body);
  });

  it('keeps tiers and the automatic mode in the view of an agent', () => {
    const view = {
      id: 'rhea',
      name: 'Rhea',
      color: '#336699',
      isOrchestrator: false,
      models: autoChain('medium'),
      auto: { base: 'medium' },
      suggestedBase: 'medium',
    };
    expect(AgentModelsSchema.parse(view)).toEqual(view);
  });

  it('refuses a tier that is not light or strong', () => {
    expect(
      ModelRefViewSchema.safeParse({ provider: 'claude-agent', model: 'opus', tier: 'max' })
        .success,
    ).toBe(false);
  });

  it('writes the automatic chain of each base on the Claude plan', () => {
    const show = (b: 'light' | 'medium' | 'strong') =>
      autoChain(b).map((m) => `${m.model}${m.tier ? `(${m.tier})` : ''}`);
    expect(show('medium')).toEqual(['sonnet', 'opus(strong)']);
    expect(show('strong')).toEqual(['opus(strong)', 'sonnet(light)']);
    expect(show('light')).toEqual(['haiku(light)', 'sonnet(strong)']);
    expect(autoChain('medium').every((m) => m.provider === 'claude-agent')).toBe(true);
  });

  it('gives Sonnet the effort Medio and Opus Alto, and Haiku none (D-110)', () => {
    expect(['sonnet', 'claude-sonnet-5-5'].map(autoEffort)).toEqual(['medium', 'medium']);
    expect(['opus', 'claude-opus-5-5'].map(autoEffort)).toEqual(['high', 'high']);
    expect(autoEffort('haiku')).toBeUndefined();
    expect(autoEffort('meta-llama/llama-3.3-70b')).toBeUndefined();
    // No Haiku in the default chain.
    expect(autoChain('medium').some((m) => m.model === 'haiku')).toBe(false);
  });

  it('recognises an automatic chain only when links, tiers and order match', () => {
    expect(isAutoChain(autoChain('strong'), 'strong')).toBe(true);
    expect(isAutoChain(autoChain('strong'), 'medium')).toBe(false);
    const untiered = autoChain('medium').map(({ provider, model }) => ({ provider, model }));
    expect(isAutoChain(untiered, 'medium')).toBe(false);
  });

  it('carries the model and the reason in a receipt', () => {
    const r = ReceiptDataSchema.parse({
      request: 'x',
      agent: 'capo',
      status: 'completed',
      delegations: [],
      notes: [],
      externalTools: [],
      outbound: [],
      alerts: { stuck: 0, injections: 0 },
      models: [
        { agent: 'capo', model: 'claude-agent:claude-opus-5-5', level: 'hard' },
        { agent: 'rhea', model: 'claude-agent:sonnet', limited: 'claude-agent:opus' },
      ],
      usage: {
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        modelCalls: 1,
        instinctCostUsd: 0,
        instinctCalls: 1,
      },
      startedAt: 0,
      durationMs: 0,
      undoable: false,
    });
    expect(r.models?.[0]?.level).toBe('hard');
    expect(r.models?.[1]?.limited).toBe('claude-agent:opus');
  });
});
