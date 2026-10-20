import type { ProviderAuth } from './types.ts';

/*
 * The providers Monsters knows how to configure (ARCHITECTURE §5.6). The
 * catalog only describes them: how the user authenticates, whether they cost
 * money, where the key comes from. Creating the provider is the job of
 * `createConfiguredProvider` (factory.ts).
 *
 * `kind: 'harness'` are the subscriptions of M2.7 (Claude Agent, Codex): an
 * external official agent runs the loop. They and ChatGPT are set up in their
 * own block (`subscription: true`), never with a key.
 */

export type ProviderType =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'mistral'
  | 'groq'
  | 'ollama'
  | 'lmstudio'
  | 'chatgpt'
  | 'codex'
  | 'claude-agent';

export interface ProviderSpec {
  /** Also the default id in the registry and in `agent.yaml`. */
  id: ProviderType;
  /** Name shown in the UI. */
  label: string;
  kind: 'model' | 'harness';
  auth: ProviderAuth;
  /** Requests are billed to the user's account with the provider. */
  paid: boolean;
  /** The provider also has a free tier (with limits, and sometimes training on prompts). */
  freeTier: boolean;
  /** Runs on the user's computer (or network): no key, a URL. */
  local: boolean;
  /** Environment variables read for the key, first wins. */
  envVars: readonly string[];
  /** Where the user creates a key. */
  keyUrl?: string;
  /** Start of the key, shown as a placeholder. */
  keyPrefix?: string;
  /** API base URL (local providers: the server root, without `/v1`). */
  defaultBaseURL: string;
  /**
   * What the provider's rate limits apply to: the account (one budget for
   * every model) or each model (an exhausted model does not stop the others).
   */
  limitScope: 'account' | 'model';
  /**
   * Uses a plan the user already pays for (ChatGPT, Claude): set up in the
   * "Abbonamenti" block, never with a key (M2.7, D-035).
   */
  subscription?: boolean;
}

export const PROVIDER_CATALOG: readonly ProviderSpec[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'model',
    auth: 'api-key',
    paid: false,
    freeTier: true,
    local: false,
    envVars: ['OPENROUTER_API_KEY'],
    keyUrl: 'https://openrouter.ai/keys',
    keyPrefix: 'sk-or-',
    defaultBaseURL: 'https://openrouter.ai/api/v1',
    limitScope: 'account',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'model',
    auth: 'api-key',
    paid: true,
    freeTier: false,
    local: false,
    envVars: ['ANTHROPIC_API_KEY'],
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPrefix: 'sk-ant-',
    defaultBaseURL: 'https://api.anthropic.com/v1',
    limitScope: 'model',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'model',
    auth: 'api-key',
    paid: true,
    freeTier: false,
    local: false,
    envVars: ['OPENAI_API_KEY'],
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPrefix: 'sk-',
    defaultBaseURL: 'https://api.openai.com/v1',
    limitScope: 'model',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    kind: 'model',
    auth: 'api-key',
    paid: true,
    freeTier: true,
    local: false,
    envVars: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'],
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPrefix: 'AIza',
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
    limitScope: 'model',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'model',
    auth: 'api-key',
    paid: true,
    freeTier: true,
    local: false,
    envVars: ['MISTRAL_API_KEY'],
    keyUrl: 'https://console.mistral.ai/api-keys',
    defaultBaseURL: 'https://api.mistral.ai/v1',
    limitScope: 'account',
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'model',
    auth: 'api-key',
    paid: true,
    freeTier: true,
    local: false,
    envVars: ['GROQ_API_KEY'],
    keyUrl: 'https://console.groq.com/keys',
    keyPrefix: 'gsk_',
    defaultBaseURL: 'https://api.groq.com/openai/v1',
    limitScope: 'model',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    kind: 'model',
    auth: 'none',
    paid: false,
    freeTier: false,
    local: true,
    envVars: [],
    defaultBaseURL: 'http://127.0.0.1:11434',
    limitScope: 'account',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    kind: 'model',
    auth: 'none',
    paid: false,
    freeTier: false,
    local: true,
    envVars: [],
    defaultBaseURL: 'http://127.0.0.1:1234',
    limitScope: 'account',
  },
  // Subscriptions (M2.7): only in the ways the providers allow (D-005, D-035).
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    kind: 'model',
    auth: 'oauth-siwc',
    paid: false,
    freeTier: false,
    local: false,
    envVars: [],
    defaultBaseURL: 'https://api.openai.com/v1',
    limitScope: 'account',
    subscription: true,
  },
  {
    id: 'codex',
    label: 'Codex',
    kind: 'harness',
    auth: 'oauth-siwc',
    paid: false,
    freeTier: false,
    local: true,
    envVars: [],
    defaultBaseURL: 'https://api.openai.com/v1',
    limitScope: 'account',
    subscription: true,
  },
  {
    id: 'claude-agent',
    label: 'Claude Agent',
    kind: 'harness',
    auth: 'external-login',
    paid: false,
    freeTier: false,
    local: true,
    envVars: [],
    defaultBaseURL: '',
    limitScope: 'account',
    subscription: true,
  },
];

export function providerSpec(id: string): ProviderSpec | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}

/** Providers configured with an API key, apart from OpenRouter (which has its own setup). */
export type KeyedProviderType = 'anthropic' | 'openai' | 'google' | 'mistral' | 'groq';
export type LocalProviderType = 'ollama' | 'lmstudio';

export function isKeyedProviderType(id: string): id is KeyedProviderType {
  return ['anthropic', 'openai', 'google', 'mistral', 'groq'].includes(id);
}

export function isLocalProviderType(id: string): id is LocalProviderType {
  return id === 'ollama' || id === 'lmstudio';
}
