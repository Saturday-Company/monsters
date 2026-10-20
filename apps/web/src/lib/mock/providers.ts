import {
  AgentModelsRequestSchema,
  autoChain,
  type AutoBase,
  isOpenRouterFreeModel,
  HarnessActivateRequestSchema,
  type SubscriptionsResponse,
  ProviderKeyRequestSchema,
  ProviderUrlRequestSchema,
  type AgentModels,
  type AgentSummary,
  type ModelInfoView,
  type ModelRefView,
  type ProviderView,
} from '@monsters/shared';
import type { RawResponse } from '../transport.ts';
import { mockPlanLimits } from './plan-limits.ts';

/*
 * Pretend providers for the mock core (shared/src/providers.ts): the catalog,
 * keys "verified" by their prefix (a key containing "wrong" is refused), local
 * servers that answer on the default address only, and the agents' chains.
 */

const ok = (body: unknown, status = 200): RawResponse => ({ status, body });
const fail = (status: number, error: string, message?: string): RawResponse => ({
  status,
  body: message ? { error, message } : { error },
});

type Base = Omit<ProviderView, 'configured'>;

const CATALOG: Base[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'model',
    auth: 'api-key',
    paid: false,
    freeTier: true,
    local: false,
    keyUrl: 'https://openrouter.ai/keys',
    keyPrefix: 'sk-or-',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'model',
    auth: 'api-key',
    paid: true,
    freeTier: false,
    local: false,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPrefix: 'sk-ant-',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'model',
    auth: 'api-key',
    paid: true,
    freeTier: false,
    local: false,
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPrefix: 'sk-',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    kind: 'model',
    auth: 'api-key',
    paid: true,
    freeTier: true,
    local: false,
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPrefix: 'AIza',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'model',
    auth: 'api-key',
    paid: true,
    freeTier: true,
    local: false,
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'model',
    auth: 'api-key',
    paid: true,
    freeTier: true,
    local: false,
    keyUrl: 'https://console.groq.com/keys',
    keyPrefix: 'gsk_',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    kind: 'model',
    auth: 'none',
    paid: false,
    freeTier: false,
    local: true,
    baseURL: 'http://127.0.0.1:11434',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    kind: 'model',
    auth: 'none',
    paid: false,
    freeTier: false,
    local: true,
    baseURL: 'http://127.0.0.1:1234',
  },
  // Subscriptions (M2.7): set up in their own block.
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    kind: 'model',
    auth: 'oauth-siwc',
    paid: false,
    freeTier: false,
    local: false,
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
    subscription: true,
  },
];

const MODELS: Record<string, ModelInfoView[]> = {
  openrouter: [
    { id: 'openrouter/free', name: 'Router gratuito', tools: true, free: true },
    { id: 'openai/gpt-oss-120b:free', tools: true, free: true },
    { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', tools: true, free: false },
  ],
  anthropic: [
    { id: 'claude-sonnet-test', name: 'Claude Sonnet (prova)', tools: true, free: false },
    { id: 'claude-haiku-test', name: 'Claude Haiku (prova)', tools: true, free: false },
  ],
  openai: [{ id: 'gpt-test', tools: true, free: false }],
  google: [{ id: 'gemini-test-flash', name: 'Gemini Flash (prova)', tools: true, free: false }],
  mistral: [{ id: 'mistral-small-latest', tools: true, free: false }],
  groq: [{ id: 'openai/gpt-oss-120b', tools: true, free: false }],
  ollama: [{ id: 'qwen3:8b', tools: true, free: true }],
  lmstudio: [{ id: 'qwen2.5-7b-instruct', tools: true, free: true }],
  chatgpt: [
    { id: 'gpt-test', name: 'GPT (prova)', tools: true, free: false },
    { id: 'gpt-mini-test', name: 'GPT mini (prova)', tools: true, free: false },
  ],
  codex: [{ id: 'gpt-test', name: 'GPT (prova)', tools: true, free: false }],
  // As the core lists them: the default first (D-093).
  'claude-agent': [
    { id: 'sonnet', name: 'Sonnet', description: 'equilibrato', tools: true, free: false },
    { id: 'haiku', name: 'Haiku', description: 'veloce', tools: true, free: false },
    { id: 'opus', name: 'Opus', description: 'il più capace', tools: true, free: false },
  ],
};

/**
 * Pretend subscriptions: "Continue with ChatGPT" completes by itself after a
 * moment (the browser is not opened for real), Claude Code is found on the
 * PATH and logged out until the user checks again (as if they ran `claude`).
 */
interface MockSubscriptions {
  chatgpt: { signedIn: boolean; pending: boolean; welcomeSeen: boolean };
  claude: { enabled: boolean; loggedIn: boolean; checked?: boolean };
  codex: { enabled: boolean; installed: boolean; installing: boolean };
}

export class MockProviders {
  /** Providers with a key or a connected server: id → source. */
  private readonly active = new Map<string, 'file' | 'settings'>([['openrouter', 'file']]);
  private readonly urls = new Map<string, string>();
  private readonly chains = new Map<string, ModelRefView[]>();
  /** "Automatica" (D-093): the base of the monsters that have it. */
  private readonly autos = new Map<string, AutoBase>();
  private readonly agents: () => AgentSummary[];
  /** OpenRouter refuses paid models until the user turns them on (the default). */
  freeOnly = true;
  private readonly subs: MockSubscriptions = {
    chatgpt: { signedIn: false, pending: false, welcomeSeen: false },
    claude: { enabled: false, loggedIn: false },
    codex: { enabled: false, installed: false, installing: false },
  };

  constructor(agents: () => AgentSummary[]) {
    this.agents = agents;
  }

  /** Set up now (key, server or subscription). */
  isActive(id: string): boolean {
    return this.active.has(id);
  }

  /** The OpenRouter key: absent on a fresh install until the onboarding saves it. */
  setOpenRouter(on: boolean): void {
    if (on) this.active.set('openrouter', 'file');
    else this.active.delete('openrouter');
  }

  /** The chain of a new agent (the onboarding starts the team on the chosen access). */
  setChain(agentId: string, models: ModelRefView[]): void {
    this.chains.set(agentId, models);
  }

  /** Provider of the first link of an agent's chain (the composer's plan indicator). */
  providerOf(agentId: string): string | undefined {
    return this.chains.get(agentId)?.[0]?.provider;
  }

  /** The Claude plan is connected (D-069: services through Claude). */
  get claudeReady(): boolean {
    return this.subs.claude.enabled && this.subs.claude.loggedIn;
  }

  private subscriptions(): SubscriptionsResponse {
    const s = this.subs;
    return {
      chatgpt: {
        signedIn: s.chatgpt.signedIn,
        ...(s.chatgpt.signedIn ? { email: 'giulio@example.com' } : {}),
        pending: s.chatgpt.pending,
        ...(s.chatgpt.pending ? { callbackPort: 1455 } : {}),
        welcomeSeen: s.chatgpt.welcomeSeen,
        usageUrl: 'https://chatgpt.com/settings/usage',
      },
      claude: {
        enabled: s.claude.enabled,
        state: s.claude.loggedIn ? 'subscription' : s.claude.enabled ? 'logged_out' : 'unknown',
        ...(s.claude.loggedIn ? { authMethod: 'claude.ai', version: '2.1.286' } : {}),
        binarySource: 'path',
        installing: false,
        package: {
          name: '@anthropic-ai/claude-agent-sdk',
          version: '0.3.286',
          license: 'Proprietaria (Anthropic Commercial Terms)',
        },
      },
      codex: {
        enabled: s.codex.enabled,
        state: !s.chatgpt.signedIn ? 'needs_chatgpt' : s.codex.installed ? 'ready' : 'not_found',
        ...(s.codex.installed ? { binarySource: 'installed' as const } : {}),
        installing: s.codex.installing,
        package: { name: '@openai/codex', version: '0.159.2', license: 'Apache-2.0' },
      },
      // Readings exist once a monster worked on the plan: the mock has them from the login.
      limits: {
        claude: s.claude.loggedIn ? mockPlanLimits('claude') : null,
        chatgpt: s.chatgpt.signedIn ? mockPlanLimits('chatgpt') : null,
      },
    };
  }

  private syncActive(): void {
    const s = this.subs;
    const set = (id: string, on: boolean) => {
      if (on) this.active.set(id, 'file');
      else this.active.delete(id);
    };
    set('chatgpt', s.chatgpt.signedIn);
    set('claude-agent', s.claude.enabled);
    set('codex', s.codex.enabled && s.codex.installed && s.chatgpt.signedIn);
  }

  private handleSubscriptions(
    method: string,
    path: string,
    body: unknown,
    query: URLSearchParams,
  ): RawResponse | undefined {
    if (!path.startsWith('/api/subscriptions')) return undefined;
    const s = this.subs;
    if (method === 'GET' && path === '/api/subscriptions') {
      if (query.get('check') === '1' && s.claude.enabled && s.claude.checked)
        s.claude.loggedIn = true;
      if (s.claude.enabled) s.claude.checked = true;
      return ok(this.subscriptions());
    }
    if (method === 'POST' && path === '/api/subscriptions/chatgpt/login') {
      s.chatgpt.pending = true;
      // The pretend browser comes back by itself.
      setTimeout(() => {
        s.chatgpt.pending = false;
        s.chatgpt.signedIn = true;
        s.chatgpt.welcomeSeen = false;
        this.syncActive();
      }, 700);
      return ok({
        authorizeUrl: 'about:blank#continue-with-chatgpt',
        redirectUri: 'http://127.0.0.1:1455/auth/callback',
      });
    }
    if (method === 'DELETE' && path === '/api/subscriptions/chatgpt') {
      s.chatgpt.signedIn = false;
      this.syncActive();
      return ok(this.subscriptions());
    }
    if (method === 'POST' && path === '/api/subscriptions/chatgpt/welcome') {
      s.chatgpt.welcomeSeen = true;
      return ok(this.subscriptions());
    }
    const m = /^\/api\/subscriptions\/(claude-agent|codex)(\/activate)?$/.exec(path);
    if (!m) return fail(404, 'unknown_provider', 'abbonamento sconosciuto');
    const id = m[1]!;
    if (method === 'POST' && m[2]) {
      const p = HarnessActivateRequestSchema.safeParse(body ?? {});
      if (!p.success) return fail(400, 'invalid_request');
      if (id === 'codex') {
        if (!s.chatgpt.signedIn) {
          return fail(
            400,
            'invalid_request',
            'Codex usa il tuo accesso a ChatGPT: collega prima ChatGPT.',
          );
        }
        s.codex.enabled = true;
        if (!s.codex.installed && p.data.install) {
          s.codex.installing = true;
          setTimeout(() => {
            s.codex.installing = false;
            s.codex.installed = true;
            this.syncActive();
          }, 900);
        }
      } else {
        s.claude.enabled = true;
        s.claude.checked = false;
      }
      this.syncActive();
      return ok(this.subscriptions());
    }
    if (method === 'DELETE' && !m[2]) {
      if (id === 'codex') s.codex.enabled = false;
      else {
        s.claude.enabled = false;
        s.claude.loggedIn = false;
      }
      this.syncActive();
      return ok(this.subscriptions());
    }
    return fail(404, 'not_found');
  }

  private view(id: string): ProviderView {
    const base = CATALOG.find((p) => p.id === id)!;
    const source = this.active.get(id);
    const url = this.urls.get(id);
    return {
      ...base,
      configured: source !== undefined,
      ...(source ? { source } : {}),
      ...(url ? { baseURL: url } : {}),
      ...(source ? { budget: { queued: 0 } } : {}),
      ...(id === 'openrouter' ? { freeOnly: this.freeOnly } : {}),
    };
  }

  private agentModels(): AgentModels[] {
    return this.agents().map((a) => ({
      id: a.id,
      name: a.name,
      color: a.color,
      isOrchestrator: a.isOrchestrator,
      models: this.chains.get(a.id) ?? [{ provider: 'openrouter', model: 'openrouter/free' }],
      ...(this.autos.has(a.id) ? { auto: { base: this.autos.get(a.id)! } } : {}),
      // Medium for everyone, the capo squadra too (D-110), as the core suggests.
      suggestedBase: 'medium' as const,
    }));
  }

  /** The response for a providers route, or undefined when the route is not one. */
  handle(
    method: string,
    path: string,
    body: unknown,
    query: URLSearchParams = new URLSearchParams(),
  ): RawResponse | undefined {
    const subscription = this.handleSubscriptions(method, path, body, query);
    if (subscription) return subscription;
    if (method === 'GET' && path === '/api/providers') {
      return ok({ providers: CATALOG.map((p) => this.view(p.id)), agents: this.agentModels() });
    }
    const agent = /^\/api\/agents\/([^/]+)\/models$/.exec(path);
    if (agent && method === 'PUT') {
      const p = AgentModelsRequestSchema.safeParse(body);
      if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
      const id = decodeURIComponent(agent[1]!);
      if (!this.agents().some((a) => a.id === id)) return fail(404, 'unknown_agent');
      const auto = p.data.auto;
      const models = auto ? autoChain(auto.base) : p.data.models;
      const missing = models.find((m) => !this.active.has(m.provider));
      if (missing) {
        return fail(
          400,
          'not_configured',
          `${missing.provider} non è configurato: aggiungi prima la chiave.`,
        );
      }
      const paid = this.freeOnly
        ? models.find((x) => x.provider === 'openrouter' && !isOpenRouterFreeModel(x.model))
        : undefined;
      if (paid) {
        return fail(
          400,
          'paid_model_blocked',
          `${paid.model} è a pagamento: attiva “Usa anche modelli a pagamento” in Impostazioni → Modelli, oppure scegli un modello gratuito.`,
        );
      }
      this.chains.set(id, models);
      if (auto) this.autos.set(id, auto.base);
      else this.autos.delete(id);
      return ok(this.agentModels().find((a) => a.id === id));
    }
    const m = /^\/api\/providers\/([^/]+)\/(key|url|models)$/.exec(path);
    if (!m) return undefined;
    const id = decodeURIComponent(m[1]!);
    const spec = CATALOG.find((p) => p.id === id);
    if (!spec) return fail(404, 'unknown_provider', `provider ${id} sconosciuto`);
    const what = m[2]!;
    if (what === 'models' && method === 'GET') {
      if (!this.active.has(id))
        return fail(404, 'unknown_provider', `${spec.label} non è configurato`);
      return ok({ models: MODELS[id] ?? [] });
    }
    if (what === 'key' && method === 'PUT') {
      const p = ProviderKeyRequestSchema.safeParse(body);
      if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
      if (p.data.key.includes('wrong')) {
        return fail(400, 'invalid_key', `${spec.label} non riconosce questa chiave.`);
      }
      this.active.set(id, 'file');
      return ok(this.view(id));
    }
    if (what === 'key' && method === 'DELETE') {
      this.active.delete(id);
      return ok(this.view(id));
    }
    if (what === 'url' && method === 'PUT') {
      const p = ProviderUrlRequestSchema.safeParse(body);
      if (!p.success)
        return fail(400, 'invalid_request', 'Indirizzo non valido: usa http://host:porta');
      const url = p.data.baseURL.replace(/\/+$/, '').replace(/\/v1$/, '');
      if (url !== spec.baseURL) {
        return fail(
          502,
          'verification_failed',
          `Non trovo ${spec.label} a quell'indirizzo: è acceso?`,
        );
      }
      this.active.set(id, 'settings');
      this.urls.set(id, url);
      return ok(this.view(id));
    }
    if (what === 'url' && method === 'DELETE') {
      this.active.delete(id);
      this.urls.delete(id);
      return ok(this.view(id));
    }
    return fail(404, 'not_found');
  }
}
