import { APICallError } from '@ai-sdk/provider';
import { settingsPath } from '@monsters/shared';
import { providerTexts } from './providers.strings.ts';
import { RateLimitedError } from './rate-budget.ts';
import type { ModelRef } from './types.ts';

/** Every link of a fallback chain failed. */
export class AllModelsFailedError extends Error {
  readonly attempts: { ref: ModelRef; error: string }[];
  constructor(attempts: { ref: ModelRef; error: string }[], cause?: unknown) {
    const tried = attempts.map((a) => `${a.ref.provider}:${a.ref.model} (${a.error})`).join('; ');
    super(providerTexts().allFailed(tried), { cause });
    this.name = 'AllModelsFailedError';
    this.attempts = attempts;
  }
}

/** Thrown when an agent references a provider that is not configured (any more). */
export class UnknownProviderError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(`provider "${provider}" is not configured`);
    this.name = 'UnknownProviderError';
    this.provider = provider;
  }
}

/**
 * The provider was removed or replaced (key deleted or saved again) while a
 * request waited for it: the chain moves on to another provider.
 */
export class ProviderRemovedError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(`provider "${provider}" was removed or replaced`);
    this.name = 'ProviderRemovedError';
    this.provider = provider;
  }
}

/**
 * An error of the ChatGPT plan usage (Sign in with ChatGPT): usage limit,
 * account not eligible, capability not supported, credentials refused. OpenAI
 * does not want a silent switch to another way of paying, so these errors stop
 * the fallback chain: the user sees them as they arrive and chooses (D-035).
 */
export class SubscriptionPlanError extends Error {
  /** OpenAI's `error.code`, e.g. `subscription_sharing_usage_limit_exceeded`. */
  readonly code: string;
  readonly status: number | undefined;
  /** OpenAI's `error.param` (unsupported capability). */
  readonly param: string | undefined;
  readonly requestId: string | undefined;
  constructor(
    code: string,
    message: string,
    options: { status?: number; param?: string; requestId?: string } = {},
  ) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'SubscriptionPlanError';
    this.code = code;
    this.status = options.status;
    this.param = options.param;
    this.requestId = options.requestId;
  }
}

/** Codes of OpenAI's structured errors that belong to the ChatGPT plan usage. */
export function isSubscriptionPlanCode(code: unknown): code is string {
  return (
    typeof code === 'string' &&
    (code.startsWith('subscription_sharing_') || code.startsWith('chatpass_v2_'))
  );
}

/** The ChatGPT plan error inside an error (or its causes), if any. */
export function subscriptionErrorOf(err: unknown): SubscriptionPlanError | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    if (e instanceof SubscriptionPlanError) return e;
    e = e instanceof Error ? e.cause : undefined;
  }
  return undefined;
}

/**
 * The model answered with nothing: no text (or only spaces) and no tool call.
 * OpenRouter sometimes closes a stream without a single chunk (no usage, no
 * finish reason): the AI SDK reports it as a normal step that ends with
 * `other`, and the agent would "complete" with an empty answer. The session
 * retries the same model once, then moves to the next link (D-019).
 */
export class EmptyResponseError extends Error {
  /** Finish reason reported with the empty answer (`other`, `stop`, `length`…), when any. */
  readonly finishReason: string | undefined;
  constructor(finishReason?: string) {
    super(providerTexts().emptyResponse(finishReason));
    this.name = 'EmptyResponseError';
    this.finishReason = finishReason;
  }
}

/**
 * A paid model asked to a provider limited to free models (OpenRouter with
 * `freeOnly`, the default): the user turns paid models on in the settings.
 */
export class PaidModelBlockedError extends Error {
  readonly model: string;
  constructor(model: string, provider = 'OpenRouter') {
    super(providerTexts().paidModelBlocked(model, provider, settingsPath('modelli')));
    this.name = 'PaidModelBlockedError';
    this.model = model;
  }
}

/** Error raised inside a stream (e.g. an upstream failure sent as an SSE chunk). */
export class StreamFailedError extends Error {
  constructor(cause: unknown) {
    super(errorMessage(cause), { cause });
    this.name = 'StreamFailedError';
  }
}

/**
 * A model that went silent (D-064): no first token within the time of the link
 * (the chain moves on), or no more data in the middle of the answer. Not an
 * abort: the kill switch did not stop it, the provider did not answer.
 */
export class StreamTimeoutError extends Error {
  readonly ref: ModelRef;
  readonly phase: 'first' | 'idle';
  readonly ms: number;
  constructor(ref: ModelRef, phase: 'first' | 'idle', ms: number) {
    const seconds = Math.round(ms / 1000);
    const t = providerTexts();
    const name = `${ref.provider}:${ref.model}`;
    super(phase === 'first' ? t.streamFirst(name, seconds) : t.streamIdle(name, seconds));
    this.name = 'StreamTimeoutError';
    this.ref = ref;
    this.phase = phase;
    this.ms = ms;
  }
}

/**
 * The stream broke after the model had started answering (an error chunk, a
 * dropped connection, silence): too late for a fallback, the agent loop may
 * ask the same step again once (D-064, AG-21).
 */
export class StreamInterruptedError extends Error {
  constructor(cause: unknown) {
    super(errorMessage(cause), { cause });
    this.name = 'StreamInterruptedError';
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || err.name === 'TimeoutError' || err.name === 'ResponseAborted')
  );
}

export function statusOf(err: unknown): number | undefined {
  if (APICallError.isInstance(err)) return err.statusCode;
  if (err instanceof StreamFailedError || err instanceof StreamInterruptedError) {
    return statusOf(err.cause);
  }
  if (err && typeof err === 'object') {
    const e = err as { statusCode?: unknown; status?: unknown; code?: unknown };
    for (const v of [e.statusCode, e.status, e.code]) if (typeof v === 'number') return v;
  }
  return undefined;
}

export function isRateLimitError(err: unknown): boolean {
  return err instanceof RateLimitedError || statusOf(err) === 429;
}

const CONTEXT_LENGTH =
  /context[ _-]?(length|window)|maximum context|context_length_exceeded|too many tokens|prompt is too long|(input|prompt|request) (is )?too (long|large)|exceeds? (the )?(maximum|max)?.{0,30}tokens|token limit/i;

/** A request refused because the conversation does not fit the model's context. */
export function isContextLengthError(err: unknown): boolean {
  const status = statusOf(err);
  if (status !== undefined && status !== 400 && status !== 413 && status !== 422) return false;
  const texts: string[] = [];
  for (let e: unknown = err, depth = 0; e && depth < 4; depth++) {
    if (e instanceof Error) texts.push(e.message);
    if (APICallError.isInstance(e) && e.responseBody) texts.push(e.responseBody);
    e = e instanceof Error ? e.cause : undefined;
  }
  return texts.some((t) => CONTEXT_LENGTH.test(t));
}

function errorTexts(err: unknown): string[] {
  const texts: string[] = [];
  for (let e: unknown = err, depth = 0; e && depth < 4; depth++) {
    if (e instanceof Error) texts.push(e.message);
    if (APICallError.isInstance(e) && e.responseBody) texts.push(e.responseBody.slice(0, 20_000));
    e = e instanceof Error ? e.cause : undefined;
  }
  return texts;
}

/** Billing problems: no credit left on the account (OpenAI `insufficient_quota`, Anthropic credit balance). */
const QUOTA =
  /insufficient[_ ]quota|exceeded your current quota|credit balance|insufficient (credits|funds|balance)|billing (hard )?limit|payment required/i;
/** A key the provider does not accept, reported with a 400 (Google `API_KEY_INVALID`). */
const BAD_KEY =
  /API_KEY_INVALID|API key not valid|invalid[_ ]api[_ ]key|incorrect api key|invalid x-api-key/i;
/**
 * A request this model cannot serve while others of the same provider may
 * (Ollama "does not support tools", a parameter not supported by this model).
 */
const MODEL_UNSUPPORTED =
  /does not support (tools|tool[_ ]?(use|calling|choice)|function[_ ]?calling|functions|images?|image input|vision|system (prompts?|messages?)|structured outputs?|json mode|streaming|reasoning|thinking)\b|(this|the) model does not support|not supported (with|by|for|on) (this|the) model|not a chat model/i;
/** OpenRouter's 403 when the input of the request was flagged by the model's moderation. */
const MODERATION = /\bflagged\b|moderation/i;
/** The model does not exist (any more) on this provider. */
const MODEL_GONE =
  /model[_ ]not[_ ]found|model_decommissioned|decommissioned|does not exist|unknown model|invalid model|no endpoints found|model .{1,80} (is )?not (found|supported|available)/i;

/**
 * What went wrong with a provider request, for the fallback and for the user:
 * - `auth`: the key is wrong, revoked or not allowed (401, 403);
 * - `quota`: no credit left on the account (402, `insufficient_quota`, …);
 * - `rate_limit`: too many requests, retry later (429, our own budget);
 * - `context`: the conversation does not fit this model;
 * - `model_gone`: the model does not exist (any more) here (404, decommissioned), or
 *   cannot serve this request while other models of the provider may (a 400 like
 *   Ollama's "does not support tools");
 * - `unavailable`: network errors, timeouts, server errors, a provider removed
 *   or replaced while the request waited for it;
 * - `bad_request`: the provider refused the request itself (400, 422);
 * - `aborted`: the kill switch or the caller stopped it;
 * - `subscription`: the ChatGPT plan refused the request (never a fallback, D-035);
 * - `empty`: the model answered with nothing (no text, no tool call);
 * - `paid_blocked`: a paid model on a provider limited to free models.
 */
export type ProviderErrorKind =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'context'
  | 'model_gone'
  | 'unavailable'
  | 'bad_request'
  | 'aborted'
  | 'subscription'
  | 'empty'
  | 'paid_blocked';

export function classifyProviderError(err: unknown): ProviderErrorKind {
  if (isAbortError(err)) return 'aborted';
  if (err instanceof SubscriptionPlanError) return 'subscription';
  if (
    (err instanceof StreamFailedError || err instanceof StreamInterruptedError) &&
    err.cause instanceof SubscriptionPlanError
  )
    return 'subscription';
  if (err instanceof StreamTimeoutError) return 'unavailable';
  if (err instanceof RateLimitedError) return 'rate_limit';
  if (err instanceof EmptyResponseError) return 'empty';
  if (err instanceof PaidModelBlockedError) return 'paid_blocked';
  if (err instanceof UnknownProviderError || err instanceof ProviderRemovedError)
    return 'unavailable';
  if (isContextLengthError(err)) return 'context';
  const status = statusOf(err);
  if (status === 401) return 'auth';
  const texts = status === undefined ? [] : errorTexts(err);
  if (status === 402 || (status !== undefined && texts.some((t) => QUOTA.test(t)))) return 'quota';
  // A flagged input is about this model's moderation, not about the key: the next link may answer.
  if (status === 403 && texts.some((t) => MODERATION.test(t))) return 'model_gone';
  if (status === 403) return 'auth';
  if (status === 404 || status === 410) return 'model_gone';
  const refused = status === 400 || status === 422;
  if (refused && texts.some((t) => BAD_KEY.test(t))) return 'auth';
  if (refused && texts.some((t) => MODEL_GONE.test(t) || MODEL_UNSUPPORTED.test(t)))
    return 'model_gone';
  if (status === 429) return 'rate_limit';
  if (status === 400 || status === 422) return 'bad_request';
  return 'unavailable';
}

/**
 * Whether the next link of a fallback chain is worth trying, whatever its
 * provider: rate limits, timeouts, server errors, models that disappeared,
 * network failures, a context too long for this model (another one may
 * have a larger window), an empty answer, a paid model the user did not allow.
 */
export function isFallbackError(err: unknown): boolean {
  const kind = classifyProviderError(err);
  return (
    kind === 'rate_limit' ||
    kind === 'context' ||
    kind === 'model_gone' ||
    kind === 'unavailable' ||
    kind === 'empty' ||
    kind === 'paid_blocked'
  );
}

/**
 * Errors about the provider rather than the model: a bad key, no credit, a
 * request this provider refuses, or a provider removed while the run used it. Every other model of the same provider would
 * fail too, a model of another provider may not: the chain skips to the next
 * link on a different provider.
 */
export function isProviderError(err: unknown): boolean {
  if (err instanceof UnknownProviderError || err instanceof ProviderRemovedError) return true;
  const kind = classifyProviderError(err);
  return kind === 'auth' || kind === 'quota' || kind === 'bad_request';
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const status = statusOf(err);
    return status !== undefined ? `${status} ${err.message}` : err.message;
  }
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; error?: { message?: unknown } };
    if (typeof e.message === 'string') return e.message;
    if (typeof e.error?.message === 'string') return e.error.message;
    try {
      return JSON.stringify(err);
    } catch {
      return 'unknown error';
    }
  }
  return String(err);
}
