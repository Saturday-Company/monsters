import {
  decisionErrorCode,
  DecisionPortError,
  scoreRange,
  SystemOneQuestionSchema,
  validateSystemOne,
  type DecisionPort,
  type SystemOneAnswer,
  type SystemOneRequest,
  type SystemOneResponse,
} from './decision.ts';

/*
 * Jev (TypeSafe) as a System 1 backend of the DecisionGate (M2.9, D-037).
 *
 * Official HTTP API (docs.typesafe.ai/api, read on 14/10/2026), called with
 * `fetch` (no SDK): `POST /v1/systemone` with `{ state, model, questions }`,
 * where `questions` is a map id → `{ type, instructions, criteria }` and the
 * answers come back under the same ids. Differences from our `/v1/systemone`
 * contract, handled here and not in the contract:
 * - our `prompt` is their `instructions`; our questions are a list, theirs a map;
 * - `choice`: our `options` become `criteria` (option → its description, or
 *   `null`); the answer is `{ choice, probabilities, confidence }`;
 * - `noul`: our `criteria` (`{ true, false }`) pass as they are; the answer is
 *   `{ noul }` with no confidence; the docs suggest |2p − 1| (the Choice
 *   formula for two options), used here;
 * - `score`: no min/max but 2-10 ordered levels (ours when given, otherwise
 *   numbers); the answer is the probability-weighted level index (0…n−1),
 *   mapped back onto [min, max];
 * - usage is `{ input_tokens, output_tokens }`; input is billed, output free.
 * Errors (401, 402, 422, 429, 529, timeout) throw `DecisionPortError`: the
 * gate then falls back (small LLM, or asking the user). After 401/402 the port
 * stays closed until the key changes; after 429/529 for a short pause.
 * The version is pinned (`jev-1.13.0`, D-067): the thresholds of the instinct
 * are measured on it, and the aliases move.
 */

export const TYPESAFE_BASE_URL = 'https://api.typesafe.ai';
export const JEV_DEFAULT_MODEL = 'jev-1.13.0';
export const JEV_DEFAULT_TIMEOUT_MS = 8_000;
/** Provider id of `provider_usage` events and of the key file `secrets/typesafe.key`. */
export const TYPESAFE_PROVIDER_ID = 'typesafe';
export const TYPESAFE_KEY_ENV = 'TYPESAFE_API_KEY';

/** Declared prices (docs.typesafe.ai/models): USD per million input tokens, output free. */
export const JEV_PRICES_USD_PER_MTOK: Readonly<Record<string, number>> = {
  'jev-1.13.0': 0.042,
  'jev-1.14.0': 0.042,
};

export type JevErrorCode =
  | 'invalid_key'
  | 'no_credit'
  | 'invalid_request'
  | 'rate_limited'
  | 'overloaded'
  | 'server_error'
  | 'timeout'
  | 'network'
  | 'bad_response'
  | 'unavailable';

/** Why a Jev call failed. The message never contains the key. */
export class JevError extends DecisionPortError {
  override readonly code: JevErrorCode;
  readonly status: number | undefined;
  constructor(
    code: JevErrorCode,
    message: string,
    status?: number,
    usage: ConstructorParameters<typeof DecisionPortError>[1] = [],
  ) {
    super(message, usage, code);
    this.name = 'JevError';
    this.code = code;
    this.status = status;
  }
}

export interface JevDecisionPortOptions {
  /** The API key, read at each call (a key saved from the UI applies at once). */
  key: string | (() => string | null);
  /** Default `jev-1.13.0`: a pinned version keeps the thresholds stable. */
  model?: string;
  baseURL?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  /** Pause after 429/529 without `retry-after`. Default 30 s. */
  backoffMs?: number;
}

type WireQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] };

interface ScoreScale {
  min: number;
  step: number;
}

/** Levels of a score question: integers when the range has 3-10 of them, otherwise 5 even steps. */
export function scoreLevels(min: number, max: number): { levels: string[]; scale: ScoreScale } {
  const span = max - min;
  if (Number.isInteger(min) && Number.isInteger(max) && span >= 2 && span <= 9) {
    return {
      levels: Array.from({ length: span + 1 }, (_, i) => String(min + i)),
      scale: { min, step: 1 },
    };
  }
  const n = 5;
  const step = span / (n - 1);
  const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
  return {
    levels: Array.from({ length: n }, (_, i) => fmt(min + i * step)),
    scale: { min, step },
  };
}

/** Our request in TypeSafe's shape, plus what is needed to read the answers back. */
export function toTypeSafeRequest(
  request: SystemOneRequest,
  model: string,
): {
  body: { state: unknown; model: string; questions: Record<string, WireQuestion> };
  scales: Map<string, ScoreScale>;
} {
  const questions: Record<string, WireQuestion> = {};
  const scales = new Map<string, ScoreScale>();
  for (const raw of request.questions) {
    const q = SystemOneQuestionSchema.parse(raw);
    if (q.type === 'noul') {
      questions[q.id] = {
        type: 'noul',
        instructions: q.prompt,
        ...(q.criteria ? { criteria: { true: q.criteria.true, false: q.criteria.false } } : {}),
      };
    } else if (q.type === 'choice') {
      questions[q.id] = {
        type: 'choice',
        instructions: q.prompt,
        criteria: Object.fromEntries(
          q.options.map((o) =>
            typeof o === 'string' ? [o, null] : [o.label, o.description ?? null],
          ),
        ),
      };
    } else if (q.levels) {
      scales.set(q.id, { min: 0, step: 1 });
      questions[q.id] = { type: 'score', instructions: q.prompt, criteria: q.levels };
    } else {
      const { levels, scale } = scoreLevels(q.min, q.max);
      scales.set(q.id, scale);
      questions[q.id] = { type: 'score', instructions: q.prompt, criteria: levels };
    }
  }
  return { body: { state: request.state, model, questions }, scales };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** TypeSafe's answers in our shape. Throws on a malformed body. */
export function fromTypeSafeAnswers(
  request: SystemOneRequest,
  raw: unknown,
  scales: Map<string, ScoreScale>,
): SystemOneAnswer[] {
  if (!isRecord(raw) || !isRecord(raw['answers'])) throw new Error('no answers in the response');
  const answers = raw['answers'];
  const out: SystemOneAnswer[] = [];
  for (const rawQ of request.questions) {
    const q = SystemOneQuestionSchema.parse(rawQ);
    const a = answers[q.id];
    if (!isRecord(a)) throw new Error(`no answer for question ${q.id}`);
    if (q.type === 'noul') {
      const p = a['noul'];
      if (typeof p !== 'number' || !Number.isFinite(p)) throw new Error(`bad noul for ${q.id}`);
      const value = clamp01(p);
      out.push({ id: q.id, value, confidence: Math.abs(2 * value - 1) });
    } else if (q.type === 'choice') {
      const choice = a['choice'];
      const confidence = a['confidence'];
      if (typeof choice !== 'string' || typeof confidence !== 'number') {
        throw new Error(`bad choice for ${q.id}`);
      }
      out.push({ id: q.id, value: choice, confidence: clamp01(confidence) });
    } else {
      const score = a['score'];
      const confidence = a['confidence'];
      const scale = scales.get(q.id)!;
      if (typeof score !== 'number' || typeof confidence !== 'number') {
        throw new Error(`bad score for ${q.id}`);
      }
      const { min, max } = scoreRange(q);
      const value = Math.min(max, Math.max(min, scale.min + score * scale.step));
      out.push({ id: q.id, value, confidence: clamp01(confidence) });
    }
  }
  return out;
}

/** Longest pause a `retry-after` can impose: a huge value must not switch Jev off for good. */
export const JEV_MAX_RETRY_AFTER_MS = 600_000;

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  const s = Number(h);
  const ms = Number.isFinite(s) ? s * 1000 : Date.parse(h) - Date.now();
  return Number.isNaN(ms) ? undefined : Math.min(JEV_MAX_RETRY_AFTER_MS, Math.max(0, ms));
}

const DETAIL_MAX = 200;
/** Shortest start of the key that counts as a leak when a server echoes a cut key. */
const KEY_PREFIX_MIN = 8;

/**
 * Hides the key in a text: the whole key, then any start of it of at least
 * {@link KEY_PREFIX_MIN} characters (a server that echoes a truncated key).
 */
export function maskKey(text: string, key: string): string {
  let out = text.replaceAll(key, '***');
  for (let n = key.length - 1; n >= KEY_PREFIX_MIN; n--) {
    out = out.replaceAll(key.slice(0, n), '***');
  }
  return out;
}

/** The raw text of an error body (`detail`, `message` or `error`): bounded, not masked. */
async function errorText(res: Response, limit: number): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (isRecord(body)) {
      for (const k of ['detail', 'message', 'error']) {
        const v = body[k];
        if (typeof v === 'string') return v.slice(0, limit);
        if (isRecord(v) && typeof v['message'] === 'string') return v['message'].slice(0, limit);
      }
      if (Array.isArray(body['detail'])) return JSON.stringify(body['detail']).slice(0, limit);
    }
  } catch {
    // Not JSON: the status says enough.
  }
  return '';
}

/**
 * A short, key-free description of an error body. The key is masked before
 * the cut: cutting first could leave a piece of it at the edge.
 */
async function errorDetail(res: Response, key: string): Promise<string> {
  // Bounded first (a hostile body can be huge), with room for a key across the bound;
  // a key cut by this bound leaves a start of it, which `maskKey` hides too.
  const raw = await errorText(res, DETAIL_MAX + key.length + 1_024);
  return maskKey(raw, key).slice(0, DETAIL_MAX);
}

export class JevDecisionPort implements DecisionPort {
  readonly id = 'jev';
  readonly model: string;
  readonly #key: () => string | null;
  readonly #baseURL: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #backoffMs: number;
  /** Closed after an error that repeats on every call: until this time, or until the key changes. */
  #closed: { until: number; key: string | null; error: JevError } | null = null;

  constructor(options: JevDecisionPortOptions) {
    const key = options.key;
    this.#key = typeof key === 'function' ? key : () => key;
    this.model = options.model ?? JEV_DEFAULT_MODEL;
    this.#baseURL = (options.baseURL ?? TYPESAFE_BASE_URL).replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#backoffMs = options.backoffMs ?? 30_000;
  }

  async decide(request: SystemOneRequest, signal?: AbortSignal): Promise<SystemOneResponse> {
    const key = this.#key();
    if (!key) throw new JevError('unavailable', 'nessuna chiave TypeSafe');
    const closed = this.#closed;
    if (closed && closed.key === key && this.#now() < closed.until) {
      throw new JevError(closed.error.code, closed.error.message, closed.error.status);
    }
    this.#closed = null;

    const { body, scales } = toTypeSafeRequest(request, this.model);
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const started = this.#now();
    let res: Response;
    try {
      res = await this.#fetch(`${this.#baseURL}/v1/systemone`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      if (timeout.aborted) {
        throw new JevError('timeout', `Jev non ha risposto entro ${this.#timeoutMs} ms`);
      }
      throw new JevError('network', `Jev non raggiungibile (${(err as Error).name})`);
    }

    if (!res.ok) throw await this.#failure(res, key);

    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      throw new JevError('bad_response', 'risposta di Jev non leggibile', res.status);
    }
    const durationMs = this.#now() - started;
    const served = isRecord(raw) && typeof raw['model'] === 'string' ? raw['model'] : this.model;
    const usageRaw = isRecord(raw) && isRecord(raw['usage']) ? raw['usage'] : {};
    const inputTokens = usageRaw['input_tokens'];
    const outputTokens = usageRaw['output_tokens'];
    // `served` comes from the server: only the table's own keys ("__proto__" is not a model).
    const price = Object.hasOwn(JEV_PRICES_USD_PER_MTOK, served)
      ? JEV_PRICES_USD_PER_MTOK[served]
      : undefined;
    const usage: NonNullable<SystemOneResponse['usage']> = [
      {
        provider: TYPESAFE_PROVIDER_ID,
        model: served,
        ...(typeof inputTokens === 'number' ? { inputTokens } : {}),
        ...(typeof outputTokens === 'number' ? { outputTokens } : {}),
        ...(typeof inputTokens === 'number' && price !== undefined
          ? { costUsd: (inputTokens * price) / 1_000_000 }
          : {}),
        durationMs,
        ...(served !== this.model ? { requestedModel: this.model } : {}),
      },
    ];
    let answers: SystemOneAnswer[];
    try {
      answers = fromTypeSafeAnswers(request, raw, scales);
      validateSystemOne(request, { answers });
    } catch (err) {
      throw new JevError(
        'bad_response',
        `risposta di Jev non valida: ${(err as Error).message}`,
        res.status,
        usage,
      );
    }
    return { answers, model: served, usage };
  }

  async #failure(res: Response, key: string): Promise<JevError> {
    // An error body that echoes the key must not carry it into a reason or the log.
    const detail = await errorDetail(res, key);
    const suffix = detail ? `: ${detail}` : '';
    const close = (error: JevError, ms: number) => {
      this.#closed = { until: this.#now() + ms, key, error };
      return error;
    };
    switch (res.status) {
      case 401:
      case 403:
        // Until the key changes (a day at most: a key fixed on the console works again).
        return close(
          new JevError('invalid_key', `chiave TypeSafe rifiutata (${res.status})`, res.status),
          86_400_000,
        );
      case 402:
        return close(
          new JevError('no_credit', `credito TypeSafe finito (402)${suffix}`, 402),
          3_600_000,
        );
      case 422:
      case 400:
        return new JevError(
          'invalid_request',
          `richiesta rifiutata da Jev (${res.status})${suffix}`,
          res.status,
        );
      case 429:
      case 529:
        return close(
          new JevError(
            res.status === 429 ? 'rate_limited' : 'overloaded',
            res.status === 429 ? 'limite di richieste di Jev (429)' : 'Jev è sovraccarico (529)',
            res.status,
          ),
          retryAfterMs(res) ?? this.#backoffMs,
        );
      default:
        return new JevError('server_error', `errore di Jev (${res.status})${suffix}`, res.status);
    }
  }
}

/** Verification of a key: `GET /v1/models`, no tokens spent. */
export async function verifyTypeSafeKey(
  key: string,
  options: { baseURL?: string; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ ok: true; models: string[] } | { ok: false; status?: number; message: string }> {
  const base = (options.baseURL ?? TYPESAFE_BASE_URL).replace(/\/+$/, '');
  let res: Response;
  try {
    res = await (options.fetch ?? fetch)(`${base}/v1/models`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (err) {
    return { ok: false, message: `TypeSafe non raggiungibile (${(err as Error).name})` };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, message: 'TypeSafe non riconosce questa chiave.' };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: `risposta inattesa di TypeSafe (${res.status})`,
    };
  }
  try {
    const body: unknown = await res.json();
    const list = isRecord(body) && Array.isArray(body['models']) ? body['models'] : [];
    const models = list
      .map((m) => (isRecord(m) && typeof m['name'] === 'string' ? m['name'] : null))
      .filter((m): m is string => m !== null);
    return { ok: true, models };
  } catch {
    return { ok: true, models: [] };
  }
}

/**
 * Tries the ports in order (Jev, then the small LLM): the first answer wins.
 * Model calls spent by the ports that failed are carried over, so the gate
 * logs them. An abort stops at once. Failures are reported as codes
 * (`jev: no_credit`, which may reach the agent) and as messages
 * (`fallbackDetail`: provider text, only for the log).
 */
export class FallbackDecisionPort implements DecisionPort {
  readonly id: string;
  readonly ports: readonly DecisionPort[];

  constructor(ports: DecisionPort[]) {
    if (ports.length === 0) throw new Error('FallbackDecisionPort needs at least one port');
    this.ports = ports;
    this.id = ports.map((p) => p.id).join('>');
  }

  async decide(request: SystemOneRequest, signal?: AbortSignal): Promise<SystemOneResponse> {
    const spent: NonNullable<SystemOneResponse['usage']> = [];
    const codes: string[] = [];
    const details: string[] = [];
    for (const port of this.ports) {
      try {
        const response = await port.decide(request, signal);
        return {
          ...response,
          usage: [...spent, ...(response.usage ?? [])],
          ...(codes.length > 0 ? { fallbackFrom: codes, fallbackDetail: details } : {}),
        };
      } catch (err) {
        if (signal?.aborted) throw err;
        if (err instanceof DecisionPortError) spent.push(...err.usage);
        codes.push(`${port.id}: ${decisionErrorCode(err)}`);
        details.push(`${port.id}: ${(err as Error).message}`);
      }
    }
    throw new DecisionPortError(details.join('; '), spent, codes.join('; '));
  }
}
