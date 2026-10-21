import type { ModelRef, ProviderRegistry } from '@monsters/providers';
import {
  instinctDescription,
  INSTINCT_ENGINE_TEXTS,
  instinctTitle,
  INSTINCT_USES,
  type DecisionEngine,
  type DecisionsView,
  type InstinctMode,
  type InstinctUpdate,
  type InstinctUse,
  type InstinctView,
} from '@monsters/shared';
import type { EventLog } from '../log/event-log.ts';
import { patchSettingsFile, readSettingsFile } from '../onboarding/settings-file.ts';
import {
  readProviderKey,
  removeProviderKey,
  saveProviderKey,
  type StoredKey,
} from '../providers/keys.ts';
import {
  DecisionPortError,
  LlmDecisionPort,
  type DecisionGate,
  type DecisionPort,
  type SystemOneRequest,
  type SystemOneResponse,
} from './decision.ts';
import { decisionStrings } from './decision.strings.ts';
import { CRITICAL_TIMEOUT_MS, INSTINCT_SPECS } from './instinct/questions.ts';
import type { EnginePort } from './instinct/system1.ts';
import {
  FallbackDecisionPort,
  JevDecisionPort,
  TYPESAFE_KEY_ENV,
  TYPESAFE_PROVIDER_ID,
  verifyTypeSafeKey,
} from './jev.ts';
import type { HubSettings } from './settings.ts';

/*
 * Engine of the instinct (D-067, before it the engine of the DecisionGate,
 * D-037): only the rules, the small LLM, or Jev. Without a choice of the user,
 * Jev when there is a TypeSafe key, otherwise the rules alone (D-065). The
 * gate falls back from Jev to the small LLM; the other uses never wait for
 * the LLM on the critical path (`INSTINCT_SPECS[use].llm`).
 * The TypeSafe key lives in `secrets/typesafe.key` (600) or
 * `TYPESAFE_API_KEY`; it is registered with the log's redactor and never
 * returned by the API. The engine fields of `decisions` written before D-067
 * move to `instinct` at startup, the user's choice kept.
 */

export class DecisionEngineError extends Error {
  readonly code:
    'no_key' | 'invalid_key' | 'verification_failed' | 'key_from_env' | 'mode_not_available';
  constructor(code: DecisionEngineError['code'], message: string) {
    super(message);
    this.name = 'DecisionEngineError';
    this.code = code;
  }
}

export interface DecisionEngineServiceOptions {
  home: string;
  secretsDir: string;
  settings: HubSettings;
  gate: DecisionGate;
  log: EventLog;
  providers: ProviderRegistry;
  /** Fallback chain of the small LLM (the orchestrator's by default). */
  llmModels: () => ModelRef[];
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /**
   * A fixed port (tests): the engine setting is saved, but the gate and every
   * use of the instinct get this one (none with `null` or with the rules).
   */
  override?: DecisionPort | null;
}

/**
 * A port with a deadline: past it the call fails with `timeout` (so the gate's
 * fallback moves to the next port) unless the caller itself aborted.
 */
export class TimeoutPort implements DecisionPort {
  readonly id: string;
  readonly #inner: DecisionPort;
  readonly #ms: number;
  constructor(inner: DecisionPort, ms: number) {
    this.#inner = inner;
    this.#ms = ms;
    this.id = inner.id;
  }

  async decide(request: SystemOneRequest, signal?: AbortSignal): Promise<SystemOneResponse> {
    const timeout = AbortSignal.timeout(this.#ms);
    try {
      return await this.#inner.decide(
        request,
        signal ? AbortSignal.any([signal, timeout]) : timeout,
      );
    } catch (err) {
      if (signal?.aborted || !timeout.aborted) throw err;
      const usage = err instanceof DecisionPortError ? err.usage : [];
      throw new DecisionPortError(decisionStrings().noAnswerWithinMs(this.#ms), usage, 'timeout');
    }
  }
}

/** Engine chosen before D-067 (`decisions.model: false` = the rules), if any. */
function legacyEngine(decisions: HubSettings['decisions']): DecisionEngine | undefined {
  if (decisions.model === false) return 'rules';
  return decisions.engine;
}

export class DecisionEngineService {
  readonly #o: DecisionEngineServiceOptions;
  #key: StoredKey | null;
  /** One Jev port for every use: a refused key closes it for all of them. */
  #jev: JevDecisionPort | undefined;
  #llm: LlmDecisionPort | undefined;

  constructor(options: DecisionEngineServiceOptions) {
    this.#o = options;
    this.#key = this.#readKey();
    this.#migrate();
    this.apply();
  }

  #readKey(): StoredKey | null {
    const found = readProviderKey(
      this.#o.secretsDir,
      TYPESAFE_PROVIDER_ID,
      [TYPESAFE_KEY_ENV],
      this.#o.env ?? process.env,
    );
    if (found) this.#o.log.redactor.addSecret(found.key);
    return found;
  }

  /**
   * `decisions.engine`/`model`/`jev` of a settings.json written before D-067
   * go to `instinct`, with the user's choice: once, then they are dropped.
   */
  #migrate(): void {
    let raw: Record<string, unknown>;
    try {
      raw = readSettingsFile(this.#o.home);
    } catch {
      return;
    }
    const decisions = (raw['decisions'] ?? {}) as Record<string, unknown>;
    if (!('engine' in decisions) && !('model' in decisions) && !('jev' in decisions)) return;
    const instinct = (raw['instinct'] ?? {}) as Record<string, unknown>;
    const engine =
      decisions['model'] === false
        ? 'rules'
        : decisions['engine'] === 'llm' || decisions['engine'] === 'jev'
          ? decisions['engine']
          : undefined;
    const legacyJev = decisions['jev'] as Record<string, unknown> | undefined;
    patchSettingsFile(this.#o.home, {
      dropLegacyEngine: true,
      instinct: {
        ...(engine && instinct['engine'] === undefined ? { engine } : {}),
        ...(legacyJev && instinct['jev'] === undefined ? { jev: legacyJev } : {}),
      },
    });
    const s = this.#o.settings;
    if (engine && s.instinct.engine === undefined) s.instinct.engine = engine;
    if (legacyJev && instinct['jev'] === undefined) {
      s.instinct.jev = {
        ...s.instinct.jev,
        ...(legacyJev as Partial<HubSettings['instinct']['jev']>),
      };
    }
    delete s.decisions.engine;
    delete s.decisions.model;
    delete s.decisions.jev;
  }

  /** The user's choice wins; otherwise Jev with a key, the rules alone without (D-065). */
  get engine(): DecisionEngine {
    return this.#userEngine() ?? (this.#key ? 'jev' : 'rules');
  }

  #userEngine(): DecisionEngine | undefined {
    return this.#o.settings.instinct.engine ?? legacyEngine(this.#o.settings.decisions);
  }

  get keySet(): boolean {
    return this.#key !== null;
  }

  /** The mode of a use: the user's, or the default of the use. */
  mode(use: InstinctUse): InstinctMode {
    const spec = INSTINCT_SPECS[use];
    const chosen = this.#o.settings.instinct.uses[use];
    return chosen && spec.modes.includes(chosen) ? chosen : spec.defaultMode;
  }

  /** Builds the ports of the current engine and gives the gate its own. */
  apply(): void {
    this.#jev = undefined;
    this.#llm = undefined;
    const { override } = this.#o;
    if (override !== undefined) {
      this.#o.gate.setPort(override === null || this.engine === 'rules' ? undefined : override);
      return;
    }
    this.#o.gate.setPort(this.buildPort());
  }

  #llmPort(): LlmDecisionPort {
    this.#llm ??= new LlmDecisionPort({
      providers: this.#o.providers,
      models: () => this.#o.settings.decisions.models ?? this.#o.llmModels(),
    });
    return this.#llm;
  }

  #jevPort(): JevDecisionPort {
    const jev = this.#o.settings.instinct.jev;
    this.#jev ??= new JevDecisionPort({
      key: () => this.#key?.key ?? null,
      model: jev.model,
      timeoutMs: jev.timeoutMs,
      ...(jev.baseURL ? { baseURL: jev.baseURL } : {}),
      ...(this.#o.fetch ? { fetch: this.#o.fetch } : {}),
    });
    return this.#jev;
  }

  /**
   * The port of the gate (undefined: rules only). Jev has 1.5 s (the agent
   * waits on it), then the small LLM answers.
   */
  buildPort(): DecisionPort | undefined {
    const engine = this.engine;
    if (engine === 'rules' || this.mode('gate') === 'off') return undefined;
    if (engine === 'llm') return this.#llmPort();
    return new FallbackDecisionPort([
      new TimeoutPort(this.#jevPort(), CRITICAL_TIMEOUT_MS),
      this.#llmPort(),
    ]);
  }

  /** The engine a use of the instinct asks (undefined: the use does what it does without). */
  portFor(use: InstinctUse): EnginePort | undefined {
    const engine = this.engine;
    if (engine === 'rules') return undefined;
    const spec = INSTINCT_SPECS[use];
    const { override } = this.#o;
    if (override !== undefined) {
      // A test port stands for the chosen engine, with that engine's uses.
      const fits = engine === 'jev' ? spec.jev : spec.llm;
      return override === null || !fits ? undefined : { port: override, engine: override.id };
    }
    if (engine === 'jev' && spec.jev && this.#key) return { port: this.#jevPort(), engine: 'jev' };
    if (engine === 'llm' && spec.llm) return { port: this.#llmPort(), engine: 'llm' };
    return undefined;
  }

  /** The gate's maximum p("the user decides") on Jev's word (0.45, research 08 §4.2). */
  get jevMaxP(): number {
    return this.#o.settings.instinct.jev.maxP;
  }

  view(): DecisionsView {
    return {
      engine: this.engine,
      threshold: this.#o.settings.decisions.threshold,
      jev: {
        keySet: this.#key !== null,
        ...(this.#key ? { keySource: this.#key.source } : {}),
        model: this.#o.settings.instinct.jev.model,
      },
    };
  }

  instinctView(): InstinctView {
    const engine = this.engine;
    return {
      title: instinctTitle(),
      description: instinctDescription(),
      engine,
      engineSource: this.#userEngine() !== undefined ? 'user' : 'default',
      engines: (['rules', 'llm', 'jev'] as const).map((id) => ({
        id,
        ...INSTINCT_ENGINE_TEXTS[id],
      })),
      uses: INSTINCT_USES.map((id) => {
        const spec = INSTINCT_SPECS[id];
        const mode = this.mode(id);
        const engines: DecisionEngine[] = [
          ...(spec.rules ? (['rules'] as const) : []),
          ...(spec.llm ? (['llm'] as const) : []),
          ...(spec.jev ? (['jev'] as const) : []),
        ];
        const withModel =
          (engine === 'jev' && spec.jev && this.#key !== null) || (engine === 'llm' && spec.llm);
        return {
          id,
          mode,
          defaultMode: spec.defaultMode,
          modes: [...spec.modes],
          label: spec.label,
          description: spec.description,
          engines,
          active: mode !== 'off' && (spec.rules || withModel),
          sends: spec.sends,
        };
      }),
      jev: {
        keySet: this.#key !== null,
        ...(this.#key ? { keySource: this.#key.source } : {}),
        model: this.#o.settings.instinct.jev.model,
        maxP: this.#o.settings.instinct.jev.maxP,
      },
    };
  }

  setEngine(engine: DecisionEngine): DecisionsView {
    this.#setEngine(engine);
    return this.view();
  }

  #setEngine(engine: DecisionEngine): void {
    if (engine === 'jev' && !this.#key) {
      throw new DecisionEngineError('no_key', decisionStrings().noKey);
    }
    patchSettingsFile(this.#o.home, { instinct: { engine } });
    this.#o.settings.instinct.engine = engine;
    this.apply();
  }

  /** Engine and modes of the uses (`PUT /api/settings/instinct`). */
  updateInstinct(update: InstinctUpdate): InstinctView {
    const uses = update.uses ?? {};
    for (const [use, mode] of Object.entries(uses) as [InstinctUse, InstinctMode][]) {
      if (!INSTINCT_SPECS[use].modes.includes(mode)) {
        throw new DecisionEngineError(
          'mode_not_available',
          decisionStrings().noMode(INSTINCT_SPECS[use].label, mode),
        );
      }
    }
    if (update.engine !== undefined) this.#setEngine(update.engine);
    if (Object.keys(uses).length > 0) {
      patchSettingsFile(this.#o.home, { instinct: { uses } });
      this.#o.settings.instinct.uses = { ...this.#o.settings.instinct.uses, ...uses };
      this.apply();
    }
    return this.instinctView();
  }

  /** Verifies the key with `GET /v1/models` (no tokens spent), saves it and uses it at once. */
  async setKey(key: string): Promise<DecisionsView> {
    const trimmed = key.trim();
    this.#o.log.redactor.addSecret(trimmed);
    const jev = this.#o.settings.instinct.jev;
    const verified = await verifyTypeSafeKey(trimmed, {
      ...(jev.baseURL ? { baseURL: jev.baseURL } : {}),
      ...(this.#o.fetch ? { fetch: this.#o.fetch } : {}),
    });
    if (!verified.ok) {
      throw new DecisionEngineError(
        verified.status === 401 || verified.status === 403 ? 'invalid_key' : 'verification_failed',
        verified.message,
      );
    }
    saveProviderKey(this.#o.secretsDir, TYPESAFE_PROVIDER_ID, trimmed);
    this.#key = { key: trimmed, source: 'file' };
    this.apply();
    return this.view();
  }

  removeKey(): DecisionsView {
    if (this.#key?.source === 'env') {
      throw new DecisionEngineError('key_from_env', decisionStrings().keyFromEnv(TYPESAFE_KEY_ENV));
    }
    removeProviderKey(this.#o.secretsDir, TYPESAFE_PROVIDER_ID);
    this.#key = this.#readKey();
    // Without a key Jev cannot answer: a choice of Jev goes back to the default
    // (the rules alone now, Jev again with a new key).
    if (!this.#key && this.#userEngine() === 'jev') {
      patchSettingsFile(this.#o.home, { instinct: { engine: null } });
      delete this.#o.settings.instinct.engine;
      if (this.#o.settings.decisions.engine === 'jev') delete this.#o.settings.decisions.engine;
    }
    this.apply();
    return this.view();
  }
}
