import {
  OPENROUTER_FREE_ROUTER,
  type AgentModels,
  type ModelRefView,
  type OnboardingAccess,
  type ProviderModelsResponse,
  type ProvidersResponse,
  formatList,
} from '@monsters/shared';
import { onboardingStrings } from './onboarding.strings.ts';

/*
 * Ways to a model of the first step (D-053) and the agents' chains once the
 * team is born.
 *
 * - A key of a paid provider pasted in the onboarding (audit 2.5) is saved
 *   with the providers API, but the core starts new agents on the free chain:
 *   without OpenRouter they would have no model. `settleModels` moves them to
 *   that provider.
 * - The ChatGPT plan, or a paid key, with OpenRouter connected too: OpenRouter's
 *   free router is added as a fallback ("Userò prima ChatGPT, poi OpenRouter se
 *   serve"). A chain that starts with a harness (Claude Code) never falls back
 *   (D-035), so nothing is added there.
 */

/** A key pasted in the onboarding, recognised by its prefix (provider catalog). */
export interface KeyKind {
  provider: string;
  /** Name in the sentences ("an Anthropic key"). */
  label: string;
}

const PREFIXES: readonly (KeyKind & { prefix: string })[] = [
  { prefix: 'sk-or-', provider: 'openrouter', label: 'OpenRouter' },
  { prefix: 'sk-ant-', provider: 'anthropic', label: 'Anthropic' },
  { prefix: 'sk-proj-', provider: 'openai', label: 'OpenAI' },
  { prefix: 'AIza', provider: 'google', label: 'Google' },
  { prefix: 'gsk_', provider: 'groq', label: 'Groq' },
  // Older OpenAI keys: after the more specific `sk-…` prefixes.
  { prefix: 'sk-', provider: 'openai', label: 'OpenAI' },
];

export function keyKind(key: string): KeyKind | null {
  const k = key.trim();
  const hit = PREFIXES.find((p) => k.startsWith(p.prefix));
  return hit ? { provider: hit.provider, label: hit.label } : null;
}

/** A way to a model that is connected: one of the three cards, or a paid key. */
export type Connected = OnboardingAccess | { key: KeyKind };

/** Short name in the guide's sentences. */
export function connectedName(c: Connected): string {
  if (typeof c === 'object') return c.key.label;
  return c === 'claude-agent' ? 'Claude' : c === 'chatgpt' ? 'ChatGPT' : 'OpenRouter';
}

/**
 * The order in which the connected ways are used: the plans first (already
 * paid for), then OpenRouter's free models, then a paid key.
 */
export function rankConnected(list: Connected[]): Connected[] {
  const rank = (c: Connected) =>
    typeof c === 'object' ? 3 : c === 'claude-agent' ? 0 : c === 'chatgpt' ? 1 : 2;
  return [...list].sort((a, b) => rank(a) - rank(b));
}

/** The hint under the guide once something is connected (audit 2.2). */
export function chainHint(list: Connected[]): string {
  const t = onboardingStrings().chain;
  const [first, ...rest] = rankConnected(list);
  if (!first || rest.length === 0) return t.default;
  if (first !== 'claude-agent' && rest.includes('openrouter')) {
    return t.thenOpenRouter(connectedName(first));
  }
  const names = rest.map(connectedName);
  if (names.length === 1) return t.one(connectedName(first), names[0]!);
  return t.many(connectedName(first), formatList(names));
}

/** The part of the API client the chains need (a fake in the tests). */
export interface ModelsApi {
  providers(): Promise<ProvidersResponse>;
  providerModels(id: string): Promise<ProviderModelsResponse>;
  setAgentModels(agentId: string, models: ModelRefView[]): Promise<AgentModels>;
}

/** A sensible first model of a paid provider: the mid-size one when there is one. */
const PREFERRED: Record<string, RegExp> = {
  anthropic: /sonnet/i,
  openai: /mini/i,
  google: /flash/i,
};

async function firstModel(api: ModelsApi, provider: string): Promise<string | null> {
  const { models } = await api.providerModels(provider);
  const usable = models.filter((m) => m.tools);
  const pick = usable.find((m) => PREFERRED[provider]?.test(m.id)) ?? usable[0];
  return pick?.id ?? null;
}

const same = (a: ModelRefView[], b: ModelRefView[]) =>
  a.length === b.length &&
  a.every((m, i) => m.provider === b[i]!.provider && m.model === b[i]!.model);

/**
 * Gives every new agent a chain it can use (see the top of the file). Best
 * effort: whatever fails leaves the chain as the core made it, and the home
 * page says when no model is connected.
 */
export async function settleModels(api: ModelsApi, agentIds: string[]): Promise<void> {
  const { providers, agents } = await api.providers();
  const view = (id: string) => providers.find((p) => p.id === id);
  const on = (id: string) => view(id)?.configured === true;
  const other = providers.find(
    (p) => p.configured && p.kind === 'model' && !p.subscription && p.id !== 'openrouter',
  );
  let otherModel: string | null | undefined;
  for (const agent of agents.filter((a) => agentIds.includes(a.id))) {
    let chain = agent.models.filter((m) => on(m.provider));
    if (chain.length === 0 && other) {
      otherModel ??= await firstModel(api, other.id).catch(() => null);
      if (otherModel) chain = [{ provider: other.id, model: otherModel }];
    }
    const head = chain[0] && view(chain[0].provider);
    if (
      head &&
      head.kind === 'model' &&
      on('openrouter') &&
      !chain.some((m) => m.provider === 'openrouter')
    ) {
      chain = [...chain, { provider: 'openrouter', model: OPENROUTER_FREE_ROUTER }];
    }
    if (chain.length > 0 && !same(chain, agent.models)) {
      await api.setAgentModels(agent.id, chain.slice(0, 6)).catch(() => undefined);
    }
  }
}
