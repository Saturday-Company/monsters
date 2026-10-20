import { join } from 'node:path';
import {
  DAY_MS,
  KeyedProvider,
  LocalProvider,
  MINUTE_MS,
  PROVIDER_CATALOG,
  classifyProviderError,
  isKeyedProviderType,
  isLocalProviderType,
  normalizeLocalBaseURL,
  providerSpec,
  type ModelInfo,
  type ModelProvider,
  type ProviderRegistry,
  type ProviderSpec,
  type RateLimitWindow,
} from '@monsters/providers';
import type { ProviderView } from '@monsters/shared';
import { writeSensitiveFile } from '../config.ts';
import type { EventLog } from '../log/event-log.ts';
import { readSettingsFile } from '../onboarding/settings-file.ts';
import { SETTINGS_FILE, type HubSettings } from '../team/settings.ts';
import { readProviderKey, removeProviderKey, saveProviderKey, type StoredKey } from './keys.ts';

/*
 * The providers besides OpenRouter (M2.2): keys of Anthropic, OpenAI, Google,
 * Mistral and Groq, addresses of Ollama and LM Studio. A key is verified by
 * listing the provider's models (no tokens spent) before it is saved in
 * `secrets/<id>.key` (600); an address is verified the same way and saved in
 * `settings.json`. Keys go to the log's redactor the moment they are read and
 * never leave the core. OpenRouter keeps its own setup (`openrouter-key.ts`):
 * the manager only shows it and forwards to it.
 */

export type ProviderSettings = HubSettings['providers'];

export class ProviderSetupError extends Error {
  readonly code:
    'unknown_provider' | 'invalid_key' | 'verification_failed' | 'key_from_env' | 'invalid_request';
  constructor(code: ProviderSetupError['code'], message: string) {
    super(message);
    this.name = 'ProviderSetupError';
    this.code = code;
  }
}

/** What the manager needs from the OpenRouter setup of the hub. */
export interface OpenRouterHooks {
  stored(): StoredKey | null;
  /** Paid models are refused until the user turns them on. */
  freeOnly?(): boolean;
  /** Verifies and saves; throws `ProviderSetupError` when refused. */
  setKey(key: string): Promise<void>;
  removeKey(): void;
}

export interface ProviderManagerOptions {
  registry: ProviderRegistry;
  home: string;
  secretsDir: string;
  settings: ProviderSettings;
  log: EventLog;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /** Seeds the budget of a re-created provider from the log (same key = same quota). */
  restore?: (id: string) => void;
  openRouter?: OpenRouterHooks;
  /** The registry is given by the caller (tests): nothing is configured from disk. */
  injected?: boolean;
  /** Timeout of a verification. Default 15 s. */
  verifyTimeoutMs?: number;
}

const LABELS: Record<string, string> = Object.fromEntries(
  PROVIDER_CATALOG.map((p) => [p.id, p.label]),
);

function windowsOf(s: ProviderSettings[string] | undefined): RateLimitWindow[] {
  const w: RateLimitWindow[] = [];
  if (s?.rpm) w.push({ limit: s.rpm, windowMs: MINUTE_MS });
  if (s?.rpd) w.push({ limit: s.rpd, windowMs: DAY_MS });
  return w;
}

export class ProviderManager {
  readonly #o: ProviderManagerOptions;
  readonly #settings: ProviderSettings;
  /** Key in use per keyed provider (to know whether a new one is the same account). */
  readonly #keys = new Map<string, StoredKey>();

  constructor(options: ProviderManagerOptions) {
    this.#o = options;
    this.#settings = structuredClone(options.settings);
  }

  get #env(): NodeJS.ProcessEnv {
    return this.#o.env ?? process.env;
  }

  /** Registers every keyed provider with a key and every local server in the settings. No network. */
  configureAll(): void {
    if (this.#o.injected) return;
    for (const spec of PROVIDER_CATALOG) {
      if (isKeyedProviderType(spec.id)) {
        const found = readProviderKey(this.#o.secretsDir, spec.id, spec.envVars, this.#env);
        if (found) this.#register(this.#keyed(spec, found.key), found);
      } else if (isLocalProviderType(spec.id)) {
        const baseURL = this.#settings[spec.id]?.baseURL;
        if (!baseURL) continue;
        try {
          this.#register(this.#local(spec, baseURL));
        } catch (err) {
          this.#o.log.append({
            agent: 'system',
            type: 'error',
            data: {
              code: 'provider_config',
              message: `${spec.label}: indirizzo non valido (${(err as Error).message})`,
            },
          });
        }
      }
    }
  }

  /** Catalog and state of every provider, plus any other registered one (tests). */
  view(): ProviderView[] {
    const views = PROVIDER_CATALOG.map((spec) => this.#view(spec));
    for (const p of this.#o.registry.list()) {
      if (providerSpec(p.id)) continue;
      views.push({
        id: p.id,
        label: p.id,
        kind: p.kind,
        auth: p.auth,
        paid: false,
        freeTier: false,
        local: false,
        configured: true,
        budget: { queued: p.budget.snapshot().queued },
      });
    }
    return views;
  }

  viewOf(id: string): ProviderView {
    const v = this.view().find((p) => p.id === id);
    if (!v) throw new ProviderSetupError('unknown_provider', `provider ${id} sconosciuto`);
    return v;
  }

  /** Verifies a key by listing the models, then saves and activates it. */
  async setKey(id: string, key: string): Promise<ProviderView> {
    const spec = this.#spec(id);
    const trimmed = key.trim();
    if (spec.id === 'openrouter') {
      if (!this.#o.openRouter)
        throw new ProviderSetupError('unknown_provider', 'OpenRouter non disponibile');
      await this.#o.openRouter.setKey(trimmed);
      return this.viewOf(id);
    }
    if (!isKeyedProviderType(spec.id)) {
      throw new ProviderSetupError('invalid_request', `${spec.label} non usa una chiave`);
    }
    const candidate = this.#keyed(spec, trimmed);
    await this.#verify(spec, candidate);
    this.#o.log.redactor.addSecret(trimmed);
    saveProviderKey(this.#o.secretsDir, spec.id, trimmed);
    if (this.#o.injected) return this.viewOf(id);
    const same = this.#keys.get(spec.id)?.key === trimmed;
    this.#register(candidate, { key: trimmed, source: 'file' });
    // Same key saved again: same quota. A new key may be another account: fresh budget.
    if (same) this.#o.restore?.(spec.id);
    return this.viewOf(id);
  }

  /** Removes a key saved from the UI. A key from the environment stays (409 `key_from_env`). */
  removeKey(id: string): ProviderView {
    const spec = this.#spec(id);
    const stored =
      spec.id === 'openrouter'
        ? (this.#o.openRouter?.stored() ?? null)
        : readProviderKey(this.#o.secretsDir, spec.id, spec.envVars, this.#env);
    if (stored?.source === 'env') {
      throw new ProviderSetupError(
        'key_from_env',
        `La chiave arriva dalla variabile d'ambiente ${stored.envVar ?? spec.envVars[0] ?? ''}: toglila da lì.`,
      );
    }
    if (spec.id === 'openrouter') {
      this.#o.openRouter?.removeKey();
      return this.viewOf(id);
    }
    if (!isKeyedProviderType(spec.id)) {
      throw new ProviderSetupError('invalid_request', `${spec.label} non usa una chiave`);
    }
    removeProviderKey(this.#o.secretsDir, spec.id);
    this.#keys.delete(spec.id);
    if (!this.#o.injected && this.#o.registry.has(spec.id)) this.#o.registry.unregister(spec.id);
    // A key in the environment takes over again.
    const env = readProviderKey(this.#o.secretsDir, spec.id, spec.envVars, this.#env);
    if (env && !this.#o.injected) this.#register(this.#keyed(spec, env.key), env);
    return this.viewOf(id);
  }

  /** Connects a local server (Ollama, LM Studio) after checking that it answers. */
  async setLocal(id: string, rawURL: string): Promise<ProviderView> {
    const spec = this.#spec(id);
    if (!isLocalProviderType(spec.id)) {
      throw new ProviderSetupError('invalid_request', `${spec.label} non è un server locale`);
    }
    let baseURL: string;
    try {
      baseURL = normalizeLocalBaseURL(rawURL);
    } catch {
      throw new ProviderSetupError(
        'invalid_request',
        'Indirizzo non valido: usa http://host:porta',
      );
    }
    const candidate = this.#local(spec, baseURL);
    await this.#verify(spec, candidate);
    this.#settings[spec.id] = { ...this.#settings[spec.id], baseURL };
    this.#saveSettings();
    if (!this.#o.injected) this.#register(candidate);
    return this.viewOf(id);
  }

  removeLocal(id: string): ProviderView {
    const spec = this.#spec(id);
    if (!isLocalProviderType(spec.id)) {
      throw new ProviderSetupError('invalid_request', `${spec.label} non è un server locale`);
    }
    const current = { ...this.#settings[spec.id] };
    delete current.baseURL;
    this.#settings[spec.id] = current;
    this.#saveSettings();
    if (!this.#o.injected && this.#o.registry.has(spec.id)) this.#o.registry.unregister(spec.id);
    return this.viewOf(id);
  }

  /** Models of a configured provider (cached by the provider). */
  async models(
    id: string,
    options: { tools?: boolean; refresh?: boolean } = {},
  ): Promise<ModelInfo[]> {
    if (!this.#o.registry.has(id)) {
      throw new ProviderSetupError('unknown_provider', `${LABELS[id] ?? id} non è configurato`);
    }
    try {
      return await this.#o.registry.get(id).listModels({
        ...(options.tools !== undefined ? { tools: options.tools } : {}),
        ...(options.refresh ? { refresh: true } : {}),
        signal: AbortSignal.timeout(this.#o.verifyTimeoutMs ?? 15_000),
      });
    } catch (err) {
      throw this.#failure(providerSpec(id), err);
    }
  }

  // --- internals --------------------------------------------------------------

  #spec(id: string): ProviderSpec {
    const spec = providerSpec(id);
    if (!spec) throw new ProviderSetupError('unknown_provider', `provider ${id} sconosciuto`);
    return spec;
  }

  #keyed(spec: ProviderSpec, key: string): KeyedProvider {
    if (!isKeyedProviderType(spec.id)) throw new Error(`${spec.id} is not a keyed provider`);
    return new KeyedProvider({
      type: spec.id,
      apiKey: key,
      windows: windowsOf(this.#settings[spec.id]),
      ...(this.#o.fetch ? { fetch: this.#o.fetch } : {}),
    });
  }

  #local(spec: ProviderSpec, baseURL: string): LocalProvider {
    if (!isLocalProviderType(spec.id)) throw new Error(`${spec.id} is not a local provider`);
    return new LocalProvider({
      type: spec.id,
      baseURL,
      ...(this.#o.fetch ? { fetch: this.#o.fetch } : {}),
    });
  }

  #register(provider: ModelProvider, key?: StoredKey): void {
    if (key) {
      this.#o.log.redactor.addSecret(key.key);
      this.#keys.set(provider.id, key);
    }
    if (this.#o.registry.has(provider.id)) this.#o.registry.unregister(provider.id);
    this.#o.registry.register(provider);
  }

  async #verify(spec: ProviderSpec, provider: ModelProvider): Promise<void> {
    try {
      await provider.listModels({
        refresh: true,
        signal: AbortSignal.timeout(this.#o.verifyTimeoutMs ?? 15_000),
      });
    } catch (err) {
      throw this.#failure(spec, err);
    }
  }

  /** A fixed message per kind: the provider's own text may echo the key. */
  #failure(spec: ProviderSpec | undefined, err: unknown): ProviderSetupError {
    const label = spec?.label ?? 'Il provider';
    const kind = classifyProviderError(err);
    if (kind === 'auth')
      return new ProviderSetupError('invalid_key', `${label} non riconosce questa chiave.`);
    if (kind === 'quota') {
      return new ProviderSetupError(
        'verification_failed',
        `${label}: credito esaurito sull'account.`,
      );
    }
    if (spec?.local) {
      return new ProviderSetupError(
        'verification_failed',
        `Non trovo ${label} a quell'indirizzo: è acceso?`,
      );
    }
    return new ProviderSetupError(
      'verification_failed',
      `Non riesco a verificare con ${label}. Controlla la connessione e riprova.`,
    );
  }

  #view(spec: ProviderSpec): ProviderView {
    const registered = this.#o.registry.has(spec.id) ? this.#o.registry.get(spec.id) : undefined;
    const stored =
      spec.id === 'openrouter'
        ? (this.#o.openRouter?.stored() ?? null)
        : isKeyedProviderType(spec.id)
          ? readProviderKey(this.#o.secretsDir, spec.id, spec.envVars, this.#env)
          : null;
    const baseURL = spec.local ? this.#settings[spec.id]?.baseURL : undefined;
    const view: ProviderView = {
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      auth: spec.auth,
      paid: spec.paid,
      freeTier: spec.freeTier,
      local: spec.local,
      configured: registered !== undefined,
      ...(stored ? { source: stored.source } : baseURL ? { source: 'settings' as const } : {}),
      ...(stored?.envVar ? { envVar: stored.envVar } : {}),
      ...(spec.local ? { baseURL: baseURL ?? spec.defaultBaseURL } : {}),
      ...(spec.keyUrl ? { keyUrl: spec.keyUrl } : {}),
      ...(spec.keyPrefix ? { keyPrefix: spec.keyPrefix } : {}),
      ...(spec.subscription ? { subscription: true } : {}),
      ...(spec.id === 'openrouter' && this.#o.openRouter?.freeOnly
        ? { freeOnly: this.#o.openRouter.freeOnly() }
        : {}),
    };
    if (registered) {
      const snap = registered.budget.snapshot();
      view.budget = {
        queued: snap.queued,
        ...(snap.blockedUntil !== undefined ? { blockedUntil: snap.blockedUntil } : {}),
        ...(snap.remaining !== undefined ? { remaining: snap.remaining } : {}),
        ...(snap.limit !== undefined ? { limit: snap.limit } : {}),
      };
    }
    return view;
  }

  /** Writes only `providers` in settings.json, keeping everything else as it is. */
  #saveSettings(): void {
    const current = readSettingsFile(this.#o.home);
    const next = { ...current, providers: this.#settings };
    writeSensitiveFile(join(this.#o.home, SETTINGS_FILE), `${JSON.stringify(next, null, 2)}\n`);
  }
}
