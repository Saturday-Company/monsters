import {
  APICallError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4Prompt,
  type LanguageModelV4GenerateResult,
  type LanguageModelV4StreamPart,
  type LanguageModelV4StreamResult,
} from '@ai-sdk/provider';
import {
  AllModelsFailedError,
  classifyProviderError,
  EmptyResponseError,
  isProviderError,
  type ProviderErrorKind,
  StreamFailedError,
  errorMessage,
  isAbortError,
  isFallbackError,
  mentionsMedia,
  ProviderRemovedError,
  statusOf,
  StreamInterruptedError,
  StreamTimeoutError,
  SubscriptionPlanError,
} from './errors.ts';
import { costFromMetadata } from './cost.ts';
import { hasMediaParts } from './input-support.ts';
import { RateLimitedError } from './rate-budget.ts';
import type { ModelProvider, ModelRef } from './types.ts';

type JSONValue = null | string | number | boolean | { [k: string]: JSONValue } | JSONValue[];

/*
 * A model session: what one agent run talks to. It is itself a LanguageModelV4,
 * so the AI SDK loop does not know about fallbacks. For every request it:
 * - walks the fallback chain, pinned model first;
 * - waits for the provider's shared RateBudget (queue, honours the abort signal);
 * - on 429 / 5xx / missing model / network failure, tries the next link;
 * - on a refused key, no credit, a request the provider refuses (400) or a
 *   provider removed meanwhile (key deleted or saved again), skips the other
 *   links of that provider and tries the next one on another provider;
 * - pins the model that served the request (with `openrouter/free` that is the
 *   concrete model the router picked), keeping the rest of the chain, router
 *   included, as fallback;
 * - treats an empty answer (no text, no tool call: OpenRouter sometimes closes
 *   the stream without a chunk) as a failure of the model: the same link is
 *   tried once more, then the next one;
 * - gives each link a time for its first token (60 s, a local server 3 min):
 *   a stream that opens and sends nothing moves to the next link; once the
 *   answer started, silence or a failure ends the stream with a
 *   `StreamInterruptedError` chunk, which the agent loop may retry (D-064);
 * - marks the prompt for the cache of the models that need it (Anthropic,
 *   also through OpenRouter): system prompt and last message (D-064);
 * - on a request too long for a link (`context`), asks the caller once for a
 *   shorter prompt (`setContextRescue`, D-082) and tries the same link again
 *   before moving on.
 */

/** Time for the first token of a request, per link (D-064). */
export const DEFAULT_FIRST_CHUNK_MS = 60_000;
/** Silence allowed in the middle of an answer before the stream is given up (D-064). */
export const DEFAULT_IDLE_CHUNK_MS = 90_000;

/**
 * Raw chunk the session puts at the start of every stream it returns, when the
 * caller asks for raw chunks (the providers' own raw chunks are not passed on):
 * the AI SDK retries a broken step by calling the model again within the same
 * step, and this tells the agent loop where the new attempt begins (AG-21).
 */
export const STREAM_START = { monsters: 'stream-start' } as const;

export function isStreamStart(raw: unknown): boolean {
  return (
    !!raw && typeof raw === 'object' && (raw as { monsters?: unknown }).monsters === 'stream-start'
  );
}

/** Cache breakpoint understood by Anthropic and by OpenRouter for Anthropic's models. */
const CACHE_CONTROL = { anthropic: { cacheControl: { type: 'ephemeral' } } } as const;

/**
 * The prompt with cache breakpoints (AG-20, D-168), three of the four Anthropic allows:
 * - the last system message: the tools and the system prompt, the stable prefix;
 * - the last message: the conversation so far, read at the next step;
 * - the `user` or `tool` message before the last one: the end of the previous step. Anthropic
 *   finds a cached prefix by looking back at most 20 blocks from a breakpoint, and a step with
 *   many parallel calls adds more than that; this mark is where the last step's cache was
 *   written, so it is read whatever the step added (a rolling breakpoint).
 *
 * A `tool` message holds one result per call of the step, and OpenRouter
 * copies a message-level breakpoint onto each of them: four calls in parallel
 * plus the system prompt were five breakpoints, and Anthropic refused the
 * request (400, collaudo of 17/10). There the breakpoint goes on the last
 * result only, which both OpenRouter and Anthropic read per part.
 */
export function withPromptCache(prompt: LanguageModelV4Prompt): LanguageModelV4Prompt {
  const lastSystem = prompt.findLastIndex((m) => m.role === 'system');
  const last = prompt.length - 1;
  const previous = prompt.findLastIndex(
    (m, i) => i < last && (m.role === 'user' || m.role === 'tool'),
  );
  return prompt.map((m, i) => {
    if (i === lastSystem)
      return { ...m, providerOptions: { ...m.providerOptions, ...CACHE_CONTROL } };
    if ((i !== last && i !== previous) || m.role === 'system') return m;
    if (m.role === 'tool') {
      const at = m.content.findLastIndex((p) => p.type === 'tool-result');
      if (at < 0) return m;
      return {
        ...m,
        content: m.content.map((p, k) =>
          k === at ? { ...p, providerOptions: { ...p.providerOptions, ...CACHE_CONTROL } } : p,
        ),
      };
    }
    return { ...m, providerOptions: { ...m.providerOptions, ...CACHE_CONTROL } };
  });
}

type ReadResult<T> = Awaited<ReturnType<ReadableStreamDefaultReader<T>['read']>>;

/** `reader.read()` that gives up after `ms` with the error of `onTimeout`. */
async function readWithin<T>(
  reader: ReadableStreamDefaultReader<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<ReadResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export type SessionEvent =
  | { type: 'queued'; ref: ModelRef; waitedMs: number }
  | {
      type: 'fallback';
      from: ModelRef;
      to: ModelRef | null;
      error: string;
      kind: ProviderErrorKind;
      status?: number;
    }
  | { type: 'pinned'; ref: ModelRef; requested: ModelRef }
  /** A link refused a request too long for it: the same link gets the shorter prompt. */
  | { type: 'context_rescue'; ref: ModelRef; error: string }
  | { type: 'served'; ref: ModelRef; requested: ModelRef; queuedMs: number; attempts: number };

export interface ServedInfo {
  /** Model that answered (concrete id, after the router). */
  ref: ModelRef;
  /** Chain link that was asked. */
  requested: ModelRef;
  queuedMs: number;
  attempts: number;
  /** Fingerprint of the key that served it (`ProviderBase.keyId`). */
  keyId?: string;
}

/**
 * A request the session gave up after the model had started working on it (an
 * empty answer that still finished, reasoning cut by the first-token time, an
 * error or an abort after some reasoning): the provider bills it, but no step
 * of the agent loop reports it. The caller logs it (`takeAbandoned`, F-A4).
 */
export interface AbandonedAttempt {
  /** The model asked (the concrete one, when the stream said it). */
  ref: ModelRef;
  /** Fingerprint of the key that served it. */
  keyId?: string;
  /** Tokens the provider reported, when it finished the request. */
  inputTokens?: number;
  outputTokens?: number;
  /** Dollars the provider reported. */
  costUsd?: number;
  /** Characters the model sent before it was given up (reasoning, blank text). */
  chars: number;
  reason: 'empty' | 'timeout' | 'error' | 'aborted';
  durationMs: number;
}

export interface ModelSessionOptions {
  chain: ModelRef[];
  resolve: (providerId: string) => ModelProvider;
  /** Disable pinning (every request walks the chain from the top). */
  pin?: boolean;
  onEvent?: (event: SessionEvent) => void;
  /** Time for the first token when the provider sets none. Default `DEFAULT_FIRST_CHUNK_MS`. */
  firstChunkMs?: number;
  /** Silence allowed after the first token. Default `DEFAULT_IDLE_CHUNK_MS`. */
  idleChunkMs?: number;
}

function sameRef(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.model === b.model;
}

/**
 * Parts that mean the model has started answering: after one, no more fallback.
 * Whitespace-only text and reasoning do not count: an answer made only of them
 * is empty, and the session can still retry or move on.
 */
function isAnswerPart(part: LanguageModelV4StreamPart): boolean {
  switch (part.type) {
    case 'text-delta':
      return part.delta.trim() !== '';
    case 'tool-call':
    case 'tool-input-start':
    case 'tool-result':
    case 'file':
      return true;
    default:
      return false;
  }
}

/**
 * A finish that only says the stream closed: reason `other` and not a token
 * of usage. OpenRouter's package writes it when the connection ends without a
 * `finish_reason` (F-M4); a real finish always reports its tokens.
 */
function closedWithoutFinish(
  part: Extract<LanguageModelV4StreamPart, { type: 'finish' }>,
): boolean {
  return (
    part.finishReason.unified === 'other' &&
    part.usage.inputTokens.total === undefined &&
    part.usage.outputTokens.total === undefined
  );
}

/** Content of a generated answer that makes it an answer (text or tool calls). */
function hasAnswer(result: LanguageModelV4GenerateResult): boolean {
  return result.content.some(
    (c) =>
      (c.type === 'text' && c.text.trim() !== '') ||
      c.type === 'tool-call' ||
      c.type === 'tool-result' ||
      c.type === 'file',
  );
}

/**
 * A shorter prompt for a request a link refused as too long (D-082), or null
 * when nothing can be cut: then the chain goes on as for any `context` error.
 */
export type ContextRescue = (
  ref: ModelRef,
  prompt: LanguageModelV4Prompt,
  error: unknown,
) => LanguageModelV4Prompt | null | Promise<LanguageModelV4Prompt | null>;

/**
 * The prompt as one link of the chain can read it (images dropped for a model that
 * does not see): called for every link before its request, with the caller's prompt.
 */
export type PromptAdapter = (ref: ModelRef, prompt: LanguageModelV4Prompt) => LanguageModelV4Prompt;

/** Times an empty answer is asked again of the same link before the next one. */
const EMPTY_RETRIES = 1;

export class ModelSession implements LanguageModelV4 {
  readonly specificationVersion = 'v4';
  readonly provider = 'monsters-session';
  readonly supportedUrls: Record<string, RegExp[]> = {};
  readonly #chain: ModelRef[];
  readonly #resolve: (providerId: string) => ModelProvider;
  readonly #pinEnabled: boolean;
  readonly #onEvent: (event: SessionEvent) => void;
  readonly #firstChunkMs: number | undefined;
  readonly #idleChunkMs: number;
  #pinned: ModelRef | null = null;
  #lastServed: ServedInfo | null = null;
  /** Links moved to the end of the chain by `demote` (a model that keeps answering badly). */
  readonly #demoted: ModelRef[] = [];
  #contextRescue: ContextRescue | null = null;
  #promptAdapter: PromptAdapter | null = null;
  #toolFilter: ((name: string) => boolean) | null = null;
  #abandoned: AbandonedAttempt[] = [];

  constructor(options: ModelSessionOptions) {
    if (options.chain.length === 0) throw new Error('a model session needs at least one model');
    this.#chain = options.chain.map((r) => ({ ...r }));
    this.#resolve = options.resolve;
    this.#pinEnabled = options.pin ?? true;
    this.#onEvent = options.onEvent ?? (() => {});
    this.#firstChunkMs = options.firstChunkMs;
    this.#idleChunkMs = options.idleChunkMs ?? DEFAULT_IDLE_CHUNK_MS;
  }

  get modelId(): string {
    const ref = this.#pinned ?? this.#chain[0]!;
    return `${ref.provider}:${ref.model}`;
  }

  /** The model pinned for this session, if any. */
  get pinned(): ModelRef | null {
    return this.#pinned ? { ...this.#pinned } : null;
  }

  /** Who served the last request. */
  get lastServed(): ServedInfo | null {
    return this.#lastServed;
  }

  /** The chain as it will be tried now: pinned model first, configured order after. */
  effectiveChain(): ModelRef[] {
    const pinned = this.#pinned;
    const rest = this.#chain.filter((r) => !pinned || !sameRef(r, pinned));
    const ordered = [
      ...rest.filter((r) => !this.#demoted.some((d) => sameRef(d, r))),
      ...this.#demoted.filter((d) => rest.some((r) => sameRef(d, r))),
    ];
    return pinned ? [pinned, ...ordered] : ordered;
  }

  /**
   * The model that served the last request answered badly (e.g. it only
   * repeated the task): unpin it and move its link to the end of the chain, so
   * the next request goes to the next model. False when there is no other model
   * to try.
   */
  demote(): boolean {
    const served = this.#lastServed;
    if (!served) return false;
    const before = this.effectiveChain();
    if (before.length < 2) return false;
    this.#pinned = null;
    for (const ref of [served.requested, served.ref]) {
      if (!this.#demoted.some((d) => sameRef(d, ref))) this.#demoted.push({ ...ref });
    }
    const next = this.effectiveChain()[0];
    return next !== undefined && !sameRef(next, served.requested) && !sameRef(next, served.ref);
  }

  /**
   * The caller's emergency compaction (D-082): called at most once per request,
   * when a link refuses it as too long for its context; the shorter prompt it
   * returns goes to the same link. Null switches it off.
   */
  setContextRescue(rescue: ContextRescue | null): void {
    this.#contextRescue = rescue;
  }

  /**
   * Gives every link of the chain a prompt it can read: the caller builds the prompt for
   * the first model, a fallback that cannot read part of it (an image) gets it adapted
   * instead of a request its provider refuses. Null sends the prompt as it is.
   */
  setPromptAdapter(adapter: PromptAdapter | null): void {
    this.#promptAdapter = adapter;
  }

  /**
   * Which of the request's function tools go to the model (D-163): the caller keeps every tool
   * of a run callable, so a deferred tool called by its name runs at once, and sends only the
   * ones loaded so far. Null sends them all.
   */
  setToolFilter(filter: ((name: string) => boolean) | null): void {
    this.#toolFilter = filter;
  }

  /** The requests given up since the last call, which the provider may still bill (F-A4). */
  takeAbandoned(): AbandonedAttempt[] {
    const out = this.#abandoned;
    this.#abandoned = [];
    return out;
  }

  #abandon(
    provider: ModelProvider,
    ref: ModelRef,
    servedModel: string | undefined,
    what: {
      reason: AbandonedAttempt['reason'];
      chars: number;
      started: number;
      usage?: { inputTokens: { total?: number }; outputTokens: { total?: number } };
      providerMetadata?: unknown;
    },
  ): void {
    const inputTokens = what.usage?.inputTokens.total;
    const outputTokens = what.usage?.outputTokens.total;
    const costUsd = costFromMetadata(what.providerMetadata);
    // Nothing came back: nothing to bill as far as anyone can tell.
    const silent = inputTokens === undefined && outputTokens === undefined && costUsd === undefined;
    if (what.chars === 0 && silent) return;
    const model = provider.servedModelId?.(ref.model, servedModel) ?? ref.model;
    this.#abandoned.push({
      ref: { provider: ref.provider, model },
      ...(provider.keyId !== undefined ? { keyId: provider.keyId } : {}),
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
      chars: what.chars,
      reason: what.reason,
      durationMs: Math.max(0, Date.now() - what.started),
    });
  }

  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    return this.#withFallback(
      sentTools(options, this.#toolFilter),
      async (model, ref, provider, options) => {
        const started = Date.now();
        const result = await model.doGenerate(callOptionsFor(options, provider, ref));
        provider.budget.update(result.response?.headers, undefined, ref.model);
        if (!hasAnswer(result)) {
          this.#abandon(provider, ref, result.response?.modelId, {
            reason: 'empty',
            chars: 0,
            started,
            usage: result.usage,
            providerMetadata: result.providerMetadata,
          });
          throw new EmptyResponseError(result.finishReason.raw);
        }
        return { value: result, servedModel: result.response?.modelId, ref };
      },
    );
  }

  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    const idleMs = this.#idleChunkMs;
    return this.#withFallback(
      sentTools(options, this.#toolFilter),
      async (model, ref, provider, options) => {
        const requested = Date.now();
        const firstMs =
          provider.firstChunkTimeoutMs ?? this.#firstChunkMs ?? DEFAULT_FIRST_CHUNK_MS;
        // The time of the first token covers the request too (a server that
        // accepts the connection and never answers): this attempt gets its own
        // abort, the caller's signal still stops everything.
        const late = new AbortController();
        // The wait for the first answer part; a model that is reasoning shows signs of life,
        // so each reasoning part moves it on by the idle time instead (F-A5).
        let waitMs = firstMs;
        const timeout = () => new StreamTimeoutError(ref, 'first', waitMs);
        let timer = setTimeout(() => late.abort(timeout()), waitMs);
        const callSignal = options.abortSignal
          ? AbortSignal.any([options.abortSignal, late.signal])
          : late.signal;
        /** A failure caused by the first-token time is that timeout, not an abort. */
        const asTimeout = (err: unknown) =>
          late.signal.aborted && !options.abortSignal?.aborted ? timeout() : err;
        let result: LanguageModelV4StreamResult;
        try {
          result = await model.doStream({
            ...callOptionsFor(options, provider, ref),
            abortSignal: callSignal,
          });
        } catch (err) {
          clearTimeout(timer);
          throw asTimeout(err);
        }
        provider.budget.update(result.response?.headers, undefined, ref.model);
        const reader = result.stream.getReader();
        // Read ahead until the model starts answering: an error before that point
        // (e.g. an upstream 429 sent as a stream chunk) still allows a fallback,
        // and a stream that ends before any answer is an empty answer. A model
        // that sends nothing in time is given up: the next link answers.
        const buffered: LanguageModelV4StreamPart[] = [];
        let servedModel: string | undefined;
        let deadline = Date.now() + waitMs;
        /** What the model sent before its answer (reasoning, blank text): billed if given up. */
        let chars = 0;
        const abandon = (reason: AbandonedAttempt['reason'], finish?: LanguageModelV4StreamPart) =>
          this.#abandon(provider, ref, servedModel, {
            reason,
            chars,
            started: requested,
            ...(finish?.type === 'finish'
              ? { usage: finish.usage, providerMetadata: finish.providerMetadata }
              : {}),
          });
        for (;;) {
          let read: ReadResult<LanguageModelV4StreamPart>;
          try {
            read = await readWithin(reader, Math.max(0, deadline - Date.now()), timeout);
          } catch (err) {
            clearTimeout(timer);
            const why = asTimeout(err);
            if (why instanceof StreamTimeoutError) await reader.cancel(why).catch(() => {});
            abandon(why instanceof StreamTimeoutError ? 'timeout' : 'aborted');
            throw why;
          }
          const { value, done } = read;
          if (done || value.type === 'finish' || value.type === 'error' || isAnswerPart(value)) {
            clearTimeout(timer);
          }
          if (done) {
            abandon('empty');
            throw new EmptyResponseError();
          }
          if (value.type === 'finish') {
            await reader.cancel().catch(() => {});
            abandon('empty', value);
            throw new EmptyResponseError(value.finishReason.raw ?? value.finishReason.unified);
          }
          if (value.type === 'error') {
            await reader.cancel().catch(() => {});
            abandon('error');
            // The ChatGPT plan refused: as it arrives, never a fallback.
            if (value.error instanceof SubscriptionPlanError) throw value.error;
            const status = statusOf(value.error);
            if (status !== undefined) provider.budget.update(undefined, status, ref.model);
            throw new StreamFailedError(value.error);
          }
          if (value.type === 'response-metadata' && value.modelId) servedModel = value.modelId;
          if (value.type === 'text-delta' || value.type === 'reasoning-delta') {
            chars += value.delta.length;
          }
          buffered.push(value);
          if (isAnswerPart(value)) break;
          if (value.type.startsWith('reasoning-')) {
            // Reasoning is alive but not yet an answer: wait for the next sign, not the first token.
            waitMs = idleMs;
            deadline = Date.now() + waitMs;
            clearTimeout(timer);
            timer = setTimeout(() => late.abort(timeout()), waitMs);
          }
        }
        // After the first token: a failure or a silence ends the stream with a
        // `StreamInterruptedError` chunk (the loop may ask the step again); an
        // abort stays an abort.
        let ended = false;
        let finished = false;
        const marker = options.includeRawChunks === true;
        const stream = new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            if (marker) controller.enqueue({ type: 'raw', rawValue: STREAM_START });
            for (const part of buffered) controller.enqueue(part);
          },
          async pull(controller) {
            if (ended) return;
            try {
              const { value, done } = await readWithin(
                reader,
                idleMs,
                () => new StreamTimeoutError(ref, 'idle', idleMs),
              );
              // A connection closed cleanly in the middle of the answer: some providers turn it
              // into a finish `other` without usage, others just end the stream. Neither is a
              // complete answer (F-M4): the loop may ask the step again, as for a failure.
              const cut = done ? !finished : value.type === 'finish' && closedWithoutFinish(value);
              if (cut) {
                ended = true;
                controller.enqueue({
                  type: 'error',
                  error: new StreamInterruptedError(
                    new Error('the stream closed before the end of the answer'),
                  ),
                });
                controller.close();
                if (!done) await reader.cancel().catch(() => {});
              } else if (done) controller.close();
              else if (value.type === 'error' && !(value.error instanceof SubscriptionPlanError)) {
                ended = true;
                controller.enqueue({
                  type: 'error',
                  error: new StreamInterruptedError(value.error),
                });
                controller.close();
                await reader.cancel().catch(() => {});
              } else {
                if (value.type === 'finish') finished = true;
                controller.enqueue(value);
              }
            } catch (err) {
              if (options.abortSignal?.aborted || isAbortError(err)) {
                controller.error(err);
                return;
              }
              ended = true;
              controller.enqueue({ type: 'error', error: new StreamInterruptedError(err) });
              controller.close();
              await reader.cancel(err).catch(() => {});
            }
          },
          async cancel(reason) {
            await reader.cancel(reason);
          },
        });
        return { value: { ...result, stream }, servedModel, ref };
      },
    );
  }

  async #withFallback<T>(
    options: LanguageModelV4CallOptions,
    attempt: (
      model: LanguageModelV4,
      ref: ModelRef,
      provider: ModelProvider,
      options: LanguageModelV4CallOptions,
    ) => Promise<{ value: T; servedModel: string | undefined; ref: ModelRef }>,
  ): Promise<T> {
    const signal = options.abortSignal;
    /** The request as sent now: a context rescue replaces its prompt (once). */
    let current = options;
    let rescued = false;
    const chain = this.effectiveChain();
    const failures: { ref: ModelRef; error: string }[] = [];
    /** Providers whose key, credit or request was refused: their other links are skipped. */
    const refused = new Set<string>();
    let lastError: unknown;
    /** Empty answers of the current link: one more try before the next link. */
    let emptyTries = 0;
    /** The last link asked again after its 429, once. */
    let rateRetried = false;
    for (let i = 0; i < chain.length; i++) {
      const ref = chain[i]!;
      if (refused.has(ref.provider)) continue;
      signal?.throwIfAborted();
      // What this link is sent: the caller's prompt as the link reads it.
      const sent = this.#promptAdapter
        ? { ...current, prompt: this.#promptAdapter(ref, current.prompt) }
        : current;
      let provider: ModelProvider | undefined;
      try {
        // Inside the try: a provider removed since the session started (key
        // deleted) is a failure of this link, and the chain goes on.
        provider = this.#resolve(ref.provider);
        // A model held back by its own 429: try the next link instead of waiting.
        const modelWait = provider.budget.modelWaitTime(ref.model);
        if (modelWait > 0 && i < chain.length - 1) {
          throw new RateLimitedError(
            provider.id,
            `${ref.model} is rate limited for ${Math.ceil(modelWait / 1000)} s`,
            Date.now() + modelWait,
          );
        }
        const queuedMs = await provider.budget.acquire(signal, ref.model);
        if (queuedMs > 0) this.#onEvent({ type: 'queued', ref, waitedMs: queuedMs });
        signal?.throwIfAborted();
        // The key was deleted or saved again while this request waited: never
        // send it with the old one.
        if (this.#resolve(ref.provider) !== provider) throw new ProviderRemovedError(ref.provider);
        const { value, servedModel } = await attempt(
          provider.model(ref.model),
          ref,
          provider,
          sent,
        );
        this.#served(provider, ref, servedModel, queuedMs, i + 1);
        return value;
      } catch (err) {
        if (signal?.aborted || isAbortError(err)) throw err;
        if (err instanceof SubscriptionPlanError || provider?.stopsChain) {
          // OpenAI: no silent switch to another way of paying. The chain stops here.
          if (provider && APICallError.isInstance(err))
            provider.budget.update(
              err.responseHeaders,
              err.statusCode,
              ref.model,
              err.responseBody,
            );
          const status = statusOf(err);
          this.#onEvent({
            type: 'fallback',
            from: ref,
            to: null,
            error: errorMessage(err),
            kind:
              err instanceof SubscriptionPlanError ? 'subscription' : classifyProviderError(err),
            ...(status !== undefined ? { status } : {}),
          });
          throw err;
        }
        if (provider && APICallError.isInstance(err))
          provider.budget.update(err.responseHeaders, err.statusCode, ref.model, err.responseBody);
        lastError = err;
        failures.push({ ref, error: errorMessage(err) });
        const kind = classifyProviderError(err);
        if (kind === 'context' && !rescued && this.#contextRescue) {
          // Too long for this model: a shorter prompt to the same link first (D-082).
          rescued = true;
          const prompt = await this.#contextRescue(ref, current.prompt, err);
          signal?.throwIfAborted();
          if (prompt) {
            current = { ...current, prompt };
            this.#onEvent({ type: 'context_rescue', ref, error: errorMessage(err) });
            failures.pop();
            i--;
            continue;
          }
        }
        if (kind === 'empty' && emptyTries < EMPTY_RETRIES) {
          // An empty answer is often a hiccup: the same model once more.
          emptyTries++;
          this.#onEvent({ type: 'fallback', from: ref, to: ref, error: errorMessage(err), kind });
          i--;
          continue;
        }
        emptyTries = 0;
        // The last (often the only) link told us when to come back: wait for it in the budget and
        // ask once more, rather than failing the whole run on a short 429 (F-M5). The budget
        // refuses the wait itself when it is longer than its limit.
        if (
          kind === 'rate_limit' &&
          provider &&
          i === chain.length - 1 &&
          !rateRetried &&
          Math.max(provider.budget.modelWaitTime(ref.model), provider.budget.waitTime()) > 0
        ) {
          rateRetried = true;
          failures.pop();
          i--;
          continue;
        }
        // A 400 for a request that carried an image or a PDF is most likely this model's: the
        // next link (which gets what it can read) may take it, and the provider's other
        // models are not disabled by it (D-218). The file must be in what this request adds (the
        // turn since the model last spoke) or be what the error talks about: a bad tool schema
        // in a run that once had an image is not the image's fault, and stays the provider's.
        const inputRefused =
          kind === 'bad_request' &&
          (hasMediaParts(sent.prompt, { latestTurn: true }) ||
            (hasMediaParts(sent.prompt) && mentionsMedia(err)));
        const providerRefused = !inputRefused && isProviderError(err);
        if (providerRefused) refused.add(ref.provider);
        // A refused provider: the next link on another provider. Otherwise the next link.
        const next = providerRefused
          ? (chain.slice(i + 1).find((r) => !refused.has(r.provider)) ?? null)
          : isFallbackError(err) || inputRefused
            ? (chain[i + 1] ?? null)
            : null;
        const status = statusOf(err);
        this.#onEvent({
          type: 'fallback',
          from: ref,
          to: next,
          error: errorMessage(err),
          kind,
          ...(status !== undefined ? { status } : {}),
        });
        if (next === null && (providerRefused || !(isFallbackError(err) || inputRefused)))
          throw err;
        if (this.#pinned && sameRef(this.#pinned, ref)) this.#pinned = null;
      }
    }
    throw new AllModelsFailedError(failures, lastError);
  }

  #served(
    provider: ModelProvider,
    requested: ModelRef,
    servedModel: string | undefined,
    queuedMs: number,
    attempts: number,
  ): void {
    const concrete = provider.servedModelId?.(requested.model, servedModel) ?? requested.model;
    const ref: ModelRef = { provider: requested.provider, model: concrete };
    this.#lastServed = {
      ref,
      requested,
      queuedMs,
      attempts,
      ...(provider.keyId !== undefined ? { keyId: provider.keyId } : {}),
    };
    this.#onEvent({ type: 'served', ref, requested, queuedMs, attempts });
    if (!this.#pinEnabled) return;
    if (!this.#pinned || !sameRef(this.#pinned, ref)) {
      this.#pinned = ref;
      this.#onEvent({ type: 'pinned', ref, requested });
    }
  }
}

/** The request with only the function tools the filter lets through (provider tools stay). */
function sentTools(
  options: LanguageModelV4CallOptions,
  filter: ((name: string) => boolean) | null,
): LanguageModelV4CallOptions {
  if (!filter || !options.tools) return options;
  const tools = options.tools.filter((t) => t.type !== 'function' || filter(t.name));
  if (tools.length === options.tools.length) return options;
  if (tools.length > 0) return { ...options, tools };
  const { tools: _tools, toolChoice: _choice, ...rest } = options;
  return rest;
}

/**
 * The call options of one link: with cache breakpoints when its model needs
 * them, and without the providers' raw chunks (the session only adds its own
 * marker, `STREAM_START`).
 */
function callOptionsFor(
  options: LanguageModelV4CallOptions,
  provider: ModelProvider,
  ref: ModelRef,
): LanguageModelV4CallOptions {
  const raw = options.includeRawChunks ? { ...options, includeRawChunks: false } : options;
  const effort = effortOptions(ref);
  const base = effort ? { ...raw, providerOptions: { ...raw.providerOptions, ...effort } } : raw;
  return provider.promptCache?.(ref.model)
    ? { ...base, prompt: withPromptCache(base.prompt) }
    : base;
}

/**
 * The provider option of a link's effort (D-110): Anthropic's `effort`, OpenRouter's
 * `reasoning.effort` (its scale stops at `xhigh`, so `max` becomes that). Other
 * providers ignore it.
 */
export function effortOptions(
  ref: ModelRef,
): Record<string, Record<string, JSONValue>> | undefined {
  if (!ref.effort) return undefined;
  if (ref.provider === 'anthropic') return { anthropic: { effort: ref.effort } };
  if (ref.provider === 'openrouter') {
    return { openrouter: { reasoning: { effort: ref.effort === 'max' ? 'xhigh' : ref.effort } } };
  }
  return undefined;
}
