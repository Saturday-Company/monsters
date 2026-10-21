import { errorMessage } from '@monsters/providers';
import type { InstinctMode, InstinctUse } from '@monsters/shared';
import type { EventLog } from '../../log/event-log.ts';
import {
  DecisionPortError,
  decisionErrorCode,
  optionLabel,
  SystemOneQuestionSchema,
  validateSystemOne,
  type DecisionPort,
  type SystemOneAnswer,
  type SystemOneRequest,
  type SystemOneResponse,
} from '../decision.ts';
import { instinctStrings } from './instinct.strings.ts';
import { bandOf, INSTINCT_QUESTIONS_VERSION, INSTINCT_SPECS } from './questions.ts';

/*
 * The instinct's service (D-067, research 08 §5.0): one way for every use to
 * ask its questions to the engine chosen in the settings (Jev, the small LLM,
 * or nothing), with:
 * - a mode per use: `off` (nothing asked), `shadow` (asked and logged, nothing
 *   changes: the dataset grows without risk), `on`;
 * - the questions of the same moment in one call (the state is paid once);
 * - a timeout per use (1.5 s on the critical path): past it, or on any error,
 *   the use goes on as it would without the instinct;
 * - the state passed through the log's redactor before it leaves (keys never do);
 * - a `decision` event for every answer, with `kind`, value, band, the reduced
 *   state and the mode: the dataset to tune the thresholds and to train Laya.
 * Model calls are `provider_usage` events, as for the agents.
 */

export interface EnginePort {
  port: DecisionPort;
  /** `jev`, `llm`, or the id of a test port. */
  engine: string;
}

export interface System1Options {
  log: Pick<EventLog, 'append'> & { redactor: { redact<T>(value: T): T } };
  /** The engine for a use, or undefined (rules only, no key, use not supported). */
  port: (use: InstinctUse) => EnginePort | undefined;
  /** The mode the user chose (or the default) for a use. */
  mode: (use: InstinctUse) => InstinctMode;
  now?: () => number;
}

/** How one question is written in its `decision` event. */
export interface QuestionLog {
  /** `kind` of the event (`done_check`, `constraint`, `route`…); default: the question id. */
  kind?: string;
  /** Thresholds for the band of a `noul` (low, high). */
  bands?: { low: number; high: number };
  /** Short text of the question for the log; default: the prompt. */
  question?: string;
  /**
   * The use this question serves, when one call asks for several (the
   * radiografia: route, tier, tools): its mode goes in the event.
   */
  use?: InstinctUse;
}

export interface AskParams {
  use: InstinctUse;
  agent: string;
  runId?: string | null;
  parentId?: string | null;
  request: SystemOneRequest;
  /** How each question goes in the log, by id. */
  logAs?: Record<string, QuestionLog>;
  /** Default: the timeout of the use. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface System1Answer {
  /** `on`: the use may act; `shadow`: only logged. */
  mode: 'on' | 'shadow';
  engine: string;
  model?: string;
  answers: Map<string, SystemOneAnswer>;
  /** `decision` event of each question, by id (parent of what the use does next). */
  events: Map<string, string>;
  latencyMs: number;
  costUsd: number;
}

/** Longest string of the state kept in a `decision` event (the log is not the dataset store). */
const STATE_PREVIEW_CHARS = 1_500;

function preview(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.length > STATE_PREVIEW_CHARS
      ? `${value.slice(0, STATE_PREVIEW_CHARS)}…[${value.length} caratteri]`
      : value;
  }
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => preview(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, preview(v, depth + 1)]),
  );
}

export class System1 {
  readonly #o: System1Options;
  readonly #now: () => number;

  constructor(options: System1Options) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
  }

  /** The mode of a use as the user set it. */
  mode(use: InstinctUse): InstinctMode {
    const mode = this.#o.mode(use);
    return INSTINCT_SPECS[use].modes.includes(mode) ? mode : INSTINCT_SPECS[use].defaultMode;
  }

  /** The use acts with the rules alone (its code checks, its regexes): mode `on`. */
  rulesOn(use: InstinctUse): boolean {
    return this.mode(use) === 'on';
  }

  /** The use would ask an engine now (mode not `off` and an engine for it). */
  available(use: InstinctUse): boolean {
    return this.mode(use) !== 'off' && this.#o.port(use) !== undefined;
  }

  /**
   * Asks the questions of one moment in one call. Null when the use is off,
   * has no engine, or the engine failed or was too slow: the caller then does
   * what it does without the instinct. An abort of `signal` is rethrown.
   */
  async ask(params: AskParams): Promise<System1Answer | null> {
    const mode = this.mode(params.use);
    const extra = Object.values(params.logAs ?? {})
      .map((l) => l.use)
      .filter((u): u is InstinctUse => u !== undefined);
    if (mode === 'off' && extra.every((u) => this.mode(u) === 'off')) return null;
    const engine = this.#o.port(params.use);
    if (!engine) return null;
    const spec = INSTINCT_SPECS[params.use];
    const timeoutMs = params.timeoutMs ?? spec.timeoutMs;
    const timeout = AbortSignal.timeout(Math.max(1, timeoutMs));
    const signal = params.signal ? AbortSignal.any([params.signal, timeout]) : timeout;
    // Only what the use put in the state, without the secrets the log knows.
    const request: SystemOneRequest = {
      state: this.#o.log.redactor.redact(params.request.state),
      questions: params.request.questions,
    };
    const started = this.#now();
    let response: SystemOneResponse;
    try {
      response = await engine.port.decide(request, signal);
      this.#usage(params, response.usage ?? []);
      validateSystemOne(request, response);
    } catch (err) {
      if (err instanceof DecisionPortError) this.#usage(params, err.usage);
      if (params.signal?.aborted) throw err;
      this.#failure(params, engine, timeout.aborted ? 'timeout' : decisionErrorCode(err), err);
      return null;
    }
    const latencyMs = this.#now() - started;
    const answers = new Map(response.answers.map((a) => [a.id, a]));
    const events = new Map<string, string>();
    const model = response.model;
    const state = preview(request.state);
    for (const raw of request.questions) {
      const q = SystemOneQuestionSchema.parse(raw);
      const a = answers.get(q.id)!;
      const how = params.logAs?.[q.id] ?? {};
      const value = typeof a.value === 'number' ? a.value : undefined;
      const options =
        q.type === 'choice'
          ? q.options.map(optionLabel)
          : q.type === 'noul'
            ? ['yes', 'no']
            : (q.levels ?? []);
      const levels = q.type === 'score' ? q.levels : undefined;
      const choice =
        typeof a.value === 'string'
          ? a.value
          : q.type === 'noul'
            ? a.value >= 0.5
              ? 'yes'
              : 'no'
            : levels
              ? (levels[Math.round(a.value)] ?? String(a.value))
              : String(a.value);
      const event = this.#o.log.append({
        agent: params.agent,
        runId: params.runId ?? null,
        parentId: params.parentId ?? null,
        type: 'decision',
        data: {
          kind: how.kind ?? q.id,
          question: how.question ?? q.prompt,
          options,
          choice,
          decidedBy: 'model',
          confidence: a.confidence,
          use: how.use ?? params.use,
          mode: this.mode(how.use ?? params.use),
          engine: engine.engine,
          ...(model ? { model } : {}),
          ...(value !== undefined ? { value } : {}),
          ...(value !== undefined && how.bands && q.type === 'noul'
            ? { band: bandOf(value, how.bands.low, how.bands.high) }
            : {}),
          state,
          latencyMs,
          reason: `istinto ${INSTINCT_QUESTIONS_VERSION}`,
        },
      });
      events.set(q.id, event.id);
    }
    const costUsd = (response.usage ?? []).reduce((s, u) => s + (u.costUsd ?? 0), 0);
    return {
      mode: mode === 'on' ? 'on' : 'shadow',
      engine: engine.engine,
      ...(model ? { model } : {}),
      answers,
      events,
      latencyMs,
      costUsd,
    };
  }

  #usage(params: AskParams, usage: NonNullable<SystemOneResponse['usage']>): void {
    for (const u of usage) {
      this.#o.log.append({
        agent: params.agent,
        runId: params.runId ?? null,
        parentId: params.parentId ?? null,
        type: 'provider_usage',
        data: u,
      });
    }
  }

  /** Failures logged once per use and code in a while: the use goes on without. */
  readonly #lastFailure = new Map<string, number>();
  #failure(params: AskParams, engine: EnginePort, code: string, err: unknown): void {
    const key = `${params.use}:${engine.engine}:${code}`;
    const now = this.#now();
    const last = this.#lastFailure.get(key);
    if (last !== undefined && now - last < 10 * 60_000) return;
    this.#lastFailure.set(key, now);
    this.#o.log.append({
      agent: 'system',
      runId: params.runId ?? null,
      type: 'error',
      data: {
        code: 'instinct_unavailable',
        // The provider's words stay in the log only (the code reaches nobody else).
        message: instinctStrings()
          .instinctDown(params.use, engine.engine, code, errorMessage(err))
          .slice(0, 400),
      },
    });
  }
}

/** A noul answer as a probability (undefined when missing). */
export function pOf(answer: System1Answer | null, id: string): number | undefined {
  const v = answer?.answers.get(id)?.value;
  return typeof v === 'number' ? v : undefined;
}

/** A choice answer with its confidence. */
export function choiceOf(
  answer: System1Answer | null,
  id: string,
): { value: string; confidence: number } | undefined {
  const a = answer?.answers.get(id);
  return a && typeof a.value === 'string'
    ? { value: a.value, confidence: a.confidence }
    : undefined;
}
