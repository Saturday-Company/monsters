import { z } from 'zod';
import { PlanLimitsResponseSchema } from './plan-limits.ts';
import { providerStrings } from './providers.strings.ts';

/*
 * Providers API (M2.2): keys of the paid providers, local servers, model
 * lists and the fallback chain of every agent. Same rules as the rest of the
 * API (JSON body, anti-CSRF header, session or bearer). Keys never come back.
 *
 *   GET    /api/providers                      → ProvidersResponse (catalog + state, agents' chains)
 *   PUT    /api/providers/:id/key              ProviderKeyRequest → ProviderView
 *                                              (verified by listing the models; then saved, mode 600)
 *   DELETE /api/providers/:id/key              → ProviderView (only a key saved from the UI)
 *   PUT    /api/providers/:id/url              ProviderUrlRequest → ProviderView (Ollama, LM Studio)
 *   DELETE /api/providers/:id/url              → ProviderView (disconnects the local server)
 *   GET    /api/providers/:id/models?tools=1&refresh=1 → ProviderModelsResponse
 *   PUT    /api/agents/:id/models              AgentModelsRequest → AgentModels
 *                                              (`tier` of every link kept; `auto` writes the
 *                                              automatic chain of its base, D-093)
 *
 * Errors: 404 `unknown_provider`, 404 `unknown_agent`, 400 `invalid_key` (refused by the provider),
 * 502 `verification_failed` (unreachable or unexpected answer), 409 `key_from_env` (the key comes
 * from an environment variable: remove it there), 400 `not_configured` (a chain link on a provider
 * that is not set up), 400 `paid_model_blocked` (a paid OpenRouter model while OpenRouter is limited
 * to free models: turn paid models on first), 400 `invalid_request`.
 */

export const ProviderIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);

/** OpenRouter's free router. */
export const OPENROUTER_FREE_ROUTER = 'openrouter/free';

/**
 * An OpenRouter model that never costs anything: the free router or a `:free`
 * variant. With `freeOnly` (the default) OpenRouter accepts only these.
 */
export function isOpenRouterFreeModel(id: string): boolean {
  return id === OPENROUTER_FREE_ROUTER || id.endsWith(':free');
}

/** Tier of a link (D-067): the instinct gives simple requests to `light`, hard ones to `strong`. */
export const ModelTierSchema = z.enum(['light', 'strong']);
export type ModelTier = z.infer<typeof ModelTierSchema>;

export const ModelRefViewSchema = z.object({
  provider: ProviderIdSchema,
  model: z.string().min(1).max(200),
  tier: ModelTierSchema.optional(),
});
export type ModelRefView = z.infer<typeof ModelRefViewSchema>;

/*
 * "Automatica" (D-093): the chain of a monster written from a base level, with
 * the tiers the radiografia of Jev uses at every request (Semplice → the light
 * link first, Difficile → the strong one, otherwise the base). First release
 * on the Claude plan only: the names of the other services change and would
 * have to be kept by hand.
 */

/** Base level of an automatic chain: Leggera, Media (default), Forte. */
export const AutoBaseSchema = z.enum(['light', 'medium', 'strong']);
export type AutoBase = z.infer<typeof AutoBaseSchema>;

export const AutoModelsSchema = z.object({ base: AutoBaseSchema });
export type AutoModels = z.infer<typeof AutoModelsSchema>;

/** The service of the automatic chains (first release). */
export const AUTO_MODELS_PROVIDER = 'claude-agent';

/**
 * The models of the Claude plan as Claude Code names them (aliases of the
 * current models: on 17/10/2026 Haiku 5.5, Sonnet 5.5 and Opus 5.5, all with a
 * 1M window), with one line on what each is. Order: lightest first.
 */
export const CLAUDE_PLAN_MODELS = [
  {
    id: 'haiku',
    name: 'Haiku',
    get description() {
      return providerStrings().claudeModels.haiku;
    },
    context: 1_000_000,
  },
  {
    id: 'sonnet',
    name: 'Sonnet',
    get description() {
      return providerStrings().claudeModels.sonnet;
    },
    context: 1_000_000,
  },
  {
    id: 'opus',
    name: 'Opus',
    get description() {
      return providerStrings().claudeModels.opus;
    },
    context: 1_000_000,
  },
] as const;

/** The automatic chain of a base level, on the Claude plan. */
export function autoChain(base: AutoBase): ModelRefView[] {
  const p = AUTO_MODELS_PROVIDER;
  switch (base) {
    case 'strong':
      return [
        { provider: p, model: 'opus', tier: 'strong' },
        { provider: p, model: 'sonnet', tier: 'light' },
      ];
    case 'light':
      return [
        { provider: p, model: 'haiku', tier: 'light' },
        { provider: p, model: 'sonnet', tier: 'strong' },
      ];
    default:
      // The rule of D-110: Semplice and Media on Sonnet, Difficile on Opus; no Haiku.
      return [
        { provider: p, model: 'sonnet' },
        { provider: p, model: 'opus', tier: 'strong' },
      ];
  }
}

/** How hard a model thinks (Claude Code `--effort`, Anthropic `effort`, OpenRouter `reasoning.effort`). */
export const EffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof EffortSchema>;

/** The words of an effort level, as the receipt says it ("effort High", "impegno Alto"): they follow the language when read. */
export const EFFORT_WORD: Record<Effort, string> = {
  get low() {
    return providerStrings().effort.low;
  },
  get medium() {
    return providerStrings().effort.medium;
  },
  get high() {
    return providerStrings().effort.high;
  },
  get xhigh() {
    return providerStrings().effort.xhigh;
  },
  get max() {
    return providerStrings().effort.max;
  },
};

/**
 * The effort of a model in "Automatica" (D-110): Sonnet works at Medio, Opus (the link a
 * Difficile request or subtask lands on) at Alto. Haiku and any other model: none, the
 * default of the model. Monsters outside "Automatica" never get one.
 */
export function autoEffort(model: string): Effort | undefined {
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'high';
  if (m.includes('sonnet')) return 'medium';
  return undefined;
}

/**
 * A chain made only of Claude plan models. A new monster on it starts in "Automatica", base
 * Media (D-110); a chain of any other service, or a mix, is left as it is.
 */
export function isClaudePlanChain(models: readonly { provider: string }[]): boolean {
  return models.length > 0 && models.every((m) => m.provider === AUTO_MODELS_PROVIDER);
}

/** The chain is exactly the automatic one of `base` (same links, same tiers, same order). */
export function isAutoChain(models: readonly ModelRefView[], base: AutoBase): boolean {
  const want = autoChain(base);
  return (
    models.length === want.length &&
    models.every(
      (m, i) =>
        m.provider === want[i]!.provider && m.model === want[i]!.model && m.tier === want[i]!.tier,
    )
  );
}

export const ProviderViewSchema = z.object({
  id: ProviderIdSchema,
  label: z.string(),
  kind: z.enum(['model', 'harness']),
  auth: z.enum(['none', 'api-key', 'oauth-siwc', 'external-login']),
  /** Requests are billed to the user's account with the provider. */
  paid: z.boolean(),
  /** The provider also has a free tier (with limits). */
  freeTier: z.boolean(),
  local: z.boolean(),
  /** Uses a plan the user already has (ChatGPT, Claude Agent, Codex): set up under "Abbonamenti". */
  subscription: z.boolean().optional(),
  /** Usable now (key verified or local server connected). */
  configured: z.boolean(),
  /** Where the key or the address comes from. */
  source: z.enum(['file', 'env', 'settings']).optional(),
  /** Environment variable that holds the key (when `source` is `env`). */
  envVar: z.string().optional(),
  /** Address of a local server. */
  baseURL: z.string().optional(),
  keyUrl: z.string().optional(),
  keyPrefix: z.string().optional(),
  /** OpenRouter only: paid models are refused until the user turns them on. */
  freeOnly: z.boolean().optional(),
  /** Rate budget right now: requests waiting, models held back until (epoch ms). */
  budget: z
    .object({
      queued: z.number().int().nonnegative(),
      blockedUntil: z.number().optional(),
      remaining: z.number().optional(),
      limit: z.number().optional(),
    })
    .optional(),
});
export type ProviderView = z.infer<typeof ProviderViewSchema>;

export const AgentModelsSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  isOrchestrator: z.boolean(),
  /** Fallback chain, first link preferred. */
  models: z.array(ModelRefViewSchema),
  /** "Automatica" (D-093): the chain is written from this base. */
  auto: AutoModelsSchema.optional(),
  /** The base "Automatica" starts from for this monster (its archetype: capo squadra, developer → Forte). */
  suggestedBase: AutoBaseSchema.optional(),
});
export type AgentModels = z.infer<typeof AgentModelsSchema>;

export const ProvidersResponseSchema = z.object({
  providers: z.array(ProviderViewSchema),
  agents: z.array(AgentModelsSchema),
});
export type ProvidersResponse = z.infer<typeof ProvidersResponseSchema>;

export const ProviderKeyRequestSchema = z.object({
  key: z.string().trim().min(10).max(500).regex(/^\S+$/, 'the key cannot contain spaces'),
});
export type ProviderKeyRequest = z.infer<typeof ProviderKeyRequestSchema>;

export const ProviderUrlRequestSchema = z.object({
  baseURL: z
    .string()
    .trim()
    .max(300)
    .regex(/^https?:\/\/[^\s/?#@]+(?:\/[^\s?#]*)?$/, 'use http://host:port'),
});
export type ProviderUrlRequest = z.infer<typeof ProviderUrlRequestSchema>;

export const ModelInfoViewSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  tools: z.boolean(),
  free: z.boolean(),
  context: z.number().optional(),
  /** One line on what the model is ("veloce", "il più capace"), when the service has it. */
  description: z.string().optional(),
});
export type ModelInfoView = z.infer<typeof ModelInfoViewSchema>;

export const ProviderModelsResponseSchema = z.object({ models: z.array(ModelInfoViewSchema) });
export type ProviderModelsResponse = z.infer<typeof ProviderModelsResponseSchema>;

export const AgentModelsRequestSchema = z.object({
  models: z.array(ModelRefViewSchema).min(1).max(6),
  /** "Automatica": the core writes the chain of this base (and `models` is ignored). */
  auto: AutoModelsSchema.optional(),
});
export type AgentModelsRequest = z.infer<typeof AgentModelsRequestSchema>;

/*
 * Subscriptions API (M2.7, D-035): the plans the user already pays for, only in
 * the ways the providers allow (D-005). ChatGPT through Sign in with ChatGPT;
 * Claude Agent through the official Claude Code binary with the login the user
 * made in a terminal (never a login here); Codex with the ChatGPT sign-in.
 *
 *   GET    /api/subscriptions?check=1                → SubscriptionsResponse (check=1 asks Claude Code again)
 *   POST   /api/subscriptions/chatgpt/login          → ChatGPTLoginResponse (open authorizeUrl in the browser)
 *   DELETE /api/subscriptions/chatgpt                → SubscriptionsResponse (revokes the refresh token)
 *   POST   /api/subscriptions/chatgpt/welcome        → SubscriptionsResponse (first-use modal shown)
 *   POST   /api/subscriptions/:id/activate           HarnessActivateRequest → SubscriptionsResponse
 *   DELETE /api/subscriptions/:id                    → SubscriptionsResponse (claude-agent, codex: off)
 */

export const OfficialPackageSchema = z.object({
  name: z.string(),
  version: z.string(),
  /** An SPDX id ("Apache-2.0") or `proprietary` (Anthropic's Commercial Terms): the UI words it. */
  license: z.string(),
});

export const ChatGPTStatusSchema = z.object({
  signedIn: z.boolean(),
  email: z.string().optional(),
  /** A sign-in waits for the browser to come back. */
  pending: z.boolean(),
  /** Port of the loopback callback while a sign-in waits (SSH tunnel hint). */
  callbackPort: z.number().int().optional(),
  /** The first-use modal ("You're using your ChatGPT plan") was dismissed. */
  welcomeSeen: z.boolean(),
  /** Last problem (sign-in refused, sign-out not confirmed), as it arrived. */
  message: z.string().optional(),
  /** Where the user manages the plan usage of the apps. */
  usageUrl: z.string(),
});
export type ChatGPTStatus = z.infer<typeof ChatGPTStatusSchema>;

export const HarnessBinarySourceSchema = z.enum(['configured', 'path', 'installed']);

export const ClaudeAgentStatusSchema = z.object({
  /** The user turned Claude Agent on. */
  enabled: z.boolean(),
  /** What the binary says about the login (`claude auth status`). */
  state: z.enum([
    'unknown',
    'not_found',
    'logged_out',
    'subscription',
    'api_key',
    'other',
    'error',
  ]),
  authMethod: z.string().optional(),
  version: z.string().optional(),
  binarySource: HarnessBinarySourceSchema.optional(),
  /** The official package is being installed (asked by the user). */
  installing: z.boolean(),
  message: z.string().optional(),
  /** The package Monsters installs when there is no `claude` (proprietary license). */
  package: OfficialPackageSchema,
});
export type ClaudeAgentStatus = z.infer<typeof ClaudeAgentStatusSchema>;

export const CodexStatusSchema = z.object({
  enabled: z.boolean(),
  state: z.enum(['not_found', 'needs_chatgpt', 'ready']),
  binarySource: HarnessBinarySourceSchema.optional(),
  installing: z.boolean(),
  message: z.string().optional(),
  package: OfficialPackageSchema,
});
export type CodexStatus = z.infer<typeof CodexStatusSchema>;

export const SubscriptionsResponseSchema = z.object({
  chatgpt: ChatGPTStatusSchema,
  claude: ClaudeAgentStatusSchema,
  codex: CodexStatusSchema,
  /** The limits of each plan as the last run on it reported them (D-111). */
  limits: PlanLimitsResponseSchema,
});
export type SubscriptionsResponse = z.infer<typeof SubscriptionsResponseSchema>;

export const ChatGPTLoginResponseSchema = z.object({
  /** Open in the user's system browser. */
  authorizeUrl: z.string(),
  /** `http://127.0.0.1:<port>/auth/callback` on the machine of the core. */
  redirectUri: z.string(),
});
export type ChatGPTLoginResponse = z.infer<typeof ChatGPTLoginResponseSchema>;

export const HarnessActivateRequestSchema = z.object({
  /** The user agrees to install the official package when no binary is found. */
  install: z.boolean().default(false),
});
export type HarnessActivateRequest = z.infer<typeof HarnessActivateRequestSchema>;
