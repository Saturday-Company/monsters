import { AgentModelsRequestSchema, type ModelInfoView, type ReceiptData } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  modelName,
  optionText,
  orderedModels,
  searchModels,
  typedModel,
} from '../src/components/settings/ModelPicker.tsx';
import { autoLine, baseOf } from '../src/components/settings/ProvidersSection.tsx';
import { MockProviders } from '../src/lib/mock/providers.ts';
import {
  delegationModelLine,
  instinctSentence,
  modelShort,
  receiptModelLine,
  receiptModels,
} from '../src/store/instinct.ts';

/*
 * The choice of the model (D-093): the picker's list, "Automatica" in words,
 * tiers kept by a save, and the model with its reason in the receipt.
 */

const claude: ModelInfoView[] = [
  { id: 'sonnet', name: 'Sonnet', description: 'equilibrato', tools: true, free: false },
  { id: 'haiku', name: 'Haiku', description: 'veloce', tools: true, free: false },
  { id: 'opus', name: 'Opus', description: 'il più capace', tools: true, free: false },
];

describe('model picker', () => {
  it('shows the Claude plan from the lightest, with one line on each model', () => {
    expect(
      orderedModels('claude-agent', claude).map((m) => optionText('claude-agent', m, true)),
    ).toEqual(['Haiku · veloce', 'Sonnet · equilibrato', 'Opus · il più capace']);
    // Other services keep the order of their list.
    expect(orderedModels('chatgpt', claude).map((m) => m.id)).toEqual(['sonnet', 'haiku', 'opus']);
  });

  it('marks paid OpenRouter models, not usable while only free ones are on', () => {
    const paid: ModelInfoView = { id: 'google/gemini', name: 'Gemini', tools: true, free: false };
    expect(optionText('openrouter', paid, true)).toBe('Gemini · a pagamento, non attivo');
    expect(optionText('openrouter', paid, false)).toBe('Gemini · a pagamento');
  });

  it('what is typed and left becomes an id, never the readable name (review 19/10, n. 10)', () => {
    const list: ModelInfoView[] = [
      { id: 'openrouter/free', tools: true, free: true },
      { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', tools: true, free: false },
    ];
    // The readable name with a letter less (a Backspace in the field): nothing changes.
    expect(typedModel('Claude Sonnet 4.', list)).toBeNull();
    expect(typedModel('Gratuito, scelto da OpenRouter!', list)).toBeNull();
    // The name as it is, in any case: that model's id.
    expect(typedModel('claude sonnet 4.5', list)).toBe('anthropic/claude-sonnet-4.5');
    expect(typedModel('Gratuito, scelto da OpenRouter', list)).toBe('openrouter/free');
    // An id, of the list or written by hand.
    expect(typedModel(' anthropic/claude-sonnet-4.5 ', list)).toBe('anthropic/claude-sonnet-4.5');
    expect(typedModel('qwen/qwen3-coder:free', list)).toBe('qwen/qwen3-coder:free');
    expect(typedModel('   ', list)).toBeNull();
  });

  it('searches a long list by id and name, every word', () => {
    const list: ModelInfoView[] = [
      { id: 'openrouter/free', name: 'Router gratuito', tools: true, free: true },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', tools: true, free: true },
      {
        id: 'google/gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash Lite',
        tools: true,
        free: false,
      },
    ];
    expect(searchModels(list, 'gemini flash').map((m) => m.id)).toEqual([
      'google/gemini-2.5-flash-lite',
    ]);
    expect(searchModels(list, 'LLAMA').map((m) => m.id)).toEqual([
      'meta-llama/llama-3.3-70b-instruct:free',
    ]);
    expect(searchModels(list, '  ')).toHaveLength(3);
    expect(modelName('openrouter/free', list)).toBe('Gratuito, scelto da OpenRouter');
  });
});

describe('"Automatica"', () => {
  it('says each base in one line', () => {
    expect(autoLine('medium')).toBe(
      'Di solito Sonnet (impegno Medio) · difficili → Opus (impegno Alto)',
    );
    expect(autoLine('strong')).toBe(
      'Di solito Opus (impegno Alto) · semplici → Sonnet (impegno Medio)',
    );
    expect(autoLine('light')).toBe('Di solito Haiku · difficili → Sonnet (impegno Medio)');
  });

  it('starts from the base of the archetype unless the monster has one', () => {
    const a = { id: 'x', name: 'X', color: '#000000', isOrchestrator: true, models: [] };
    expect(baseOf({ ...a, suggestedBase: 'strong' })).toBe('strong');
    expect(baseOf({ ...a, suggestedBase: 'strong', auto: { base: 'light' } })).toBe('light');
    expect(baseOf(a)).toBe('medium');
  });

  it('the mock core keeps tiers and writes the chain of the base', () => {
    const mock = new MockProviders(() => [
      { id: 'titan', name: 'Titan', color: '#f8962d', isOrchestrator: true } as never,
      { id: 'rhea', name: 'Rhea', color: '#4f8df7', isOrchestrator: false } as never,
    ]);
    // The Claude plan on: as the subscriptions block does.
    mock.handle('POST', '/api/subscriptions/claude-agent/activate', {});
    const tiered = {
      models: [
        { provider: 'claude-agent', model: 'haiku', tier: 'light' },
        { provider: 'claude-agent', model: 'opus', tier: 'strong' },
      ],
    };
    expect(AgentModelsRequestSchema.parse(tiered)).toEqual(tiered);
    const saved = mock.handle('PUT', '/api/agents/rhea/models', tiered)!.body as {
      models: unknown[];
      auto?: unknown;
    };
    expect(saved.models).toEqual(tiered.models);
    const auto = mock.handle('PUT', '/api/agents/titan/models', {
      models: tiered.models,
      auto: { base: 'strong' },
    })!.body as {
      models: { model: string; tier?: string }[];
      auto?: unknown;
      suggestedBase?: string;
    };
    expect(auto.models.map((m) => `${m.model}:${m.tier}`)).toEqual(['opus:strong', 'sonnet:light']);
    expect(auto.auto).toEqual({ base: 'strong' });
    // The suggestion stays Media for the capo squadra too (D-110): the user chose Forte here.
    expect(auto.suggestedBase).toBe('medium');
  });
});

describe('the model in the receipt and the instrumentation', () => {
  it('says the model and why', () => {
    expect(modelShort('claude-agent:claude-opus-5-5')).toBe('Opus');
    expect(modelShort('claude-agent:haiku')).toBe('Haiku');
    expect(modelShort('openrouter:meta-llama/llama-3.3-70b-instruct:free')).toBe('llama 3.3 70b');
    expect(receiptModelLine({ agent: 'rhea', model: 'claude-agent:opus', level: 'hard' })).toBe(
      'Difficile → Opus',
    );
    expect(
      receiptModelLine({
        agent: 'rhea',
        model: 'claude-agent:sonnet',
        level: 'hard',
        limited: 'claude-agent:opus',
      }),
    ).toBe('Difficile → Opus al limite del piano → Sonnet');
    expect(receiptModelLine({ agent: 'rhea', model: 'claude-agent:sonnet' })).toBe('Sonnet');
    // "Automatica" (D-110): the effort the model worked at.
    expect(
      receiptModelLine({
        agent: 'rhea',
        model: 'claude-agent:opus',
        level: 'hard',
        effort: 'high',
      }),
    ).toBe('Difficile → Opus · impegno Alto');
    expect(
      receiptModelLine({
        agent: 'rhea',
        model: 'claude-agent:sonnet',
        level: 'medium',
        effort: 'medium',
      }),
    ).toBe('Media → Sonnet · impegno Medio');
  });

  it('names the models only with a reason, or with the details on', () => {
    const r = {
      models: [
        { agent: 'titan', model: 'claude-agent:sonnet' },
        { agent: 'rhea', model: 'claude-agent:opus', level: 'hard' as const },
      ],
    } as ReceiptData;
    expect(receiptModels(r, false).map((m) => m.agent)).toEqual(['rhea']);
    expect(receiptModels(r, true)).toHaveLength(2);
  });

  it('the tier line of the terminal: "Rhea: richiesta difficile → Opus"', () => {
    const nameOf = (id: string) => (id === 'rhea' ? 'Rhea' : id);
    expect(
      instinctSentence(
        {
          use: 'tier',
          action: 'tier',
          message: 'x',
          subject: 'rhea',
          details: { level: 'hard', model: 'claude-agent:opus' },
        },
        nameOf,
      ),
    ).toBe('Rhea: richiesta difficile → Opus');
    expect(
      instinctSentence(
        {
          use: 'tier',
          action: 'tier',
          message: 'x',
          subject: 'rhea',
          details: { level: 'simple' },
        },
        nameOf,
      ),
    ).toBe('Richiesta semplice: Rhea usa il modello leggero');
    // A delegation with the level of its own subtask (D-109).
    expect(
      instinctSentence(
        {
          use: 'tier',
          action: 'tier',
          message: 'x',
          subject: 'rhea',
          details: { level: 'simple', model: 'claude-agent:haiku', from: 'subtask' },
        },
        nameOf,
      ),
    ).toBe('Rhea: incarico semplice → Haiku');
  });

  it('each delegation of the receipt says its level and model (D-109)', () => {
    const d = (extra: Partial<ReceiptData['delegations'][number]>) => ({
      agent: 'rhea',
      agentName: 'Rhea',
      goal: 'Una ricerca',
      status: 'completed' as const,
      verdict: 'verified' as const,
      criteria: [],
      ...extra,
    });
    expect(delegationModelLine(d({ level: 'hard', model: 'claude-agent:claude-opus-5-5' }))).toBe(
      'Difficile → Opus',
    );
    expect(delegationModelLine(d({ model: 'claude-agent:sonnet' }))).toBeNull();
    expect(
      delegationModelLine(d({ level: 'simple', model: 'claude-agent:sonnet', effort: 'medium' })),
    ).toBe('Semplice → Sonnet · impegno Medio');
  });
});
