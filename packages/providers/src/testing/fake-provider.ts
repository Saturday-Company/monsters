import {
  APICallError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4StreamPart,
  type LanguageModelV4StreamResult,
  type LanguageModelV4Usage,
  type SharedV4ProviderMetadata,
} from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import { RateBudget, type RateLimitWindow } from '../rate-budget.ts';
import type { ListModelsOptions, ModelInfo, ModelProvider } from '../types.ts';

/*
 * Scriptable provider for tests: each model id has a queue of steps; every
 * request (doStream/doGenerate) consumes the next one. Steps can stream text,
 * call tools, fail with HTTP errors (429 with rate-limit headers), fail inside
 * the stream, or stream slowly so a test can abort halfway.
 */

export interface FakeToolCall {
  name: string;
  input: unknown;
  id?: string;
  /** Arguments sent as they are (e.g. broken JSON), instead of `JSON.stringify(input)`. */
  rawInput?: string;
}

export type FakeStep =
  | {
      kind: 'text';
      text: string;
      /** Characters per text-delta chunk. Default: the whole text at once. */
      chunkSize?: number;
      /** Delay before each chunk (ms). Default 0. */
      delayMs?: number;
      /** Model reported in `response-metadata` (e.g. what a router picked). */
      servedModel?: string;
      headers?: Record<string, string>;
      /** The stream waits for this promise before any content (abortable). */
      gate?: Promise<unknown>;
      /** The stream breaks with this error after the text, without finishing the step. */
      breakWith?: unknown;
      /** Usage reported at the end of the step. Default 12 in, 7 out. */
      usage?: LanguageModelV4Usage;
      /** Why the step finished. Default `stop`. */
      finishReason?: 'stop' | 'length' | 'other';
      /** Reasoning streamed before the text. */
      reasoning?: string;
      /** Provider metadata of the finish (e.g. OpenRouter's `{ openrouter: { usage: { cost } } }`). */
      providerMetadata?: SharedV4ProviderMetadata;
    }
  | {
      kind: 'tool-calls';
      calls: FakeToolCall[];
      /** Text streamed before the calls. */
      text?: string;
      servedModel?: string;
      headers?: Record<string, string>;
      /** The stream waits for this promise before any content (abortable). */
      gate?: Promise<unknown>;
      usage?: LanguageModelV4Usage;
    }
  | { kind: 'http-error'; status: number; message?: string; headers?: Record<string, string> }
  /**
   * What OpenRouter sends now and then: a stream without a single chunk. The
   * SDK turns it into a step with no content, no usage and finish reason `other`.
   */
  | { kind: 'empty' }
  /** The request succeeds but the stream sends an error before any content. */
  | { kind: 'stream-error'; error: unknown };

export type FakeScript = FakeStep[] | ((call: FakeCall) => FakeStep);

export interface FakeCall {
  model: string;
  /** 0-based index of the call for this model. */
  index: number;
  options: LanguageModelV4CallOptions;
}

export interface FakeProviderOptions {
  id?: string;
  /** Script per model id. */
  models: Record<string, FakeScript>;
  windows?: RateLimitWindow[];
  /** Whether exhausted limits block the whole account or one model (see `RateBudget`). */
  limitScope?: 'account' | 'model';
  maxWaitMs?: number;
  /** Mimic OpenRouter: pin the served model reported by the stream. */
  pinServedModel?: boolean;
  /** Fingerprint of a pretend key (see `ProviderBase.keyId`). */
  keyId?: string;
  now?: () => number;
}

const USAGE: LanguageModelV4Usage = {
  inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 7, text: 7, reasoning: undefined },
};

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return signal?.aborted ? Promise.reject(signal.reason as Error) : Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason as Error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

let callCounter = 0;

function stepParts(step: FakeStep, model: string): LanguageModelV4StreamPart[] {
  const parts: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }];
  if (step.kind === 'stream-error') {
    parts.push({ type: 'error', error: step.error });
    return parts;
  }
  if (step.kind === 'empty') {
    parts.push({
      type: 'finish',
      usage: {
        inputTokens: {
          total: undefined,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: undefined, text: undefined, reasoning: undefined },
      },
      finishReason: { unified: 'other', raw: undefined },
    });
    return parts;
  }
  if (step.kind !== 'text' && step.kind !== 'tool-calls') return parts;
  parts.push({
    type: 'response-metadata',
    id: `resp-${++callCounter}`,
    modelId: step.servedModel ?? model,
  });
  return parts;
}

function waitGate(gate: Promise<unknown>, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason as Error);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal!.reason as Error);
    signal?.addEventListener('abort', onAbort, { once: true });
    gate.then(
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      (err: unknown) => {
        signal?.removeEventListener('abort', onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function textChunks(text: string, size: number | undefined): string[] {
  if (!size || size >= text.length) return text ? [text] : [];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function buildStream(
  step: FakeStep,
  model: string,
  signal: AbortSignal | undefined,
): ReadableStream<LanguageModelV4StreamPart> {
  const head = stepParts(step, model);
  const queue: Pending[] = [...head];
  if ((step.kind === 'text' || step.kind === 'tool-calls') && step.gate) {
    queue.push({ type: 'gate', gate: step.gate });
  }
  if (step.kind === 'text' || step.kind === 'tool-calls') {
    const text = step.text ?? '';
    const chunks = textChunks(text, step.kind === 'text' ? step.chunkSize : undefined);
    const delay = step.kind === 'text' ? (step.delayMs ?? 0) : 0;
    if (step.kind === 'text' && step.reasoning) {
      queue.push({ type: 'reasoning-start', id: 'r0' });
      queue.push({ type: 'reasoning-delta', id: 'r0', delta: step.reasoning });
      queue.push({ type: 'reasoning-end', id: 'r0' });
    }
    if (chunks.length > 0) {
      queue.push({ type: 'text-start', id: 't0' });
      for (const c of chunks) {
        if (delay > 0) queue.push({ type: 'delay', ms: delay });
        queue.push({ type: 'text-delta', id: 't0', delta: c });
      }
      if (step.kind !== 'text' || step.breakWith === undefined)
        queue.push({ type: 'text-end', id: 't0' });
    }
    if (step.kind === 'text' && step.breakWith !== undefined) {
      queue.push({ type: 'error', error: step.breakWith });
      return streamOf(queue, signal);
    }
    if (step.kind === 'tool-calls') {
      for (const call of step.calls) {
        queue.push({
          type: 'tool-call',
          toolCallId: call.id ?? `call-${++callCounter}`,
          toolName: call.name,
          input: call.rawInput ?? JSON.stringify(call.input),
        });
      }
    }
    const reason = step.kind === 'text' ? (step.finishReason ?? 'stop') : 'stop';
    queue.push({
      type: 'finish',
      usage: step.usage ?? USAGE,
      finishReason:
        step.kind === 'tool-calls'
          ? { unified: 'tool-calls', raw: 'tool_calls' }
          : { unified: reason, raw: reason === 'other' ? undefined : reason },
      ...(step.kind === 'text' && step.providerMetadata
        ? { providerMetadata: step.providerMetadata }
        : {}),
    });
  }
  return streamOf(queue, signal);
}

type Pending =
  | LanguageModelV4StreamPart
  | { type: 'delay'; ms: number }
  | { type: 'gate'; gate: Promise<unknown> };

function streamOf(
  queue: Pending[],
  signal: AbortSignal | undefined,
): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream<LanguageModelV4StreamPart>({
    async pull(controller) {
      for (;;) {
        const next = queue.shift();
        if (!next) {
          controller.close();
          return;
        }
        if (next.type === 'delay' || next.type === 'gate') {
          try {
            if (next.type === 'delay') await sleep(next.ms, signal);
            else await waitGate(next.gate, signal);
          } catch (err) {
            controller.error(err);
            return;
          }
          continue;
        }
        controller.enqueue(next);
        return;
      }
    },
  });
}

export class FakeProvider implements ModelProvider {
  readonly kind = 'model';
  readonly auth = 'none';
  readonly id: string;
  readonly budget: RateBudget;
  readonly keyId: string | undefined;
  /** Every request received, in order. */
  readonly calls: FakeCall[] = [];
  readonly #scripts: Record<string, FakeScript>;
  readonly #counters = new Map<string, number>();
  readonly #pinServed: boolean;

  constructor(options: FakeProviderOptions) {
    this.id = options.id ?? 'fake';
    this.#scripts = options.models;
    this.#pinServed = options.pinServedModel ?? false;
    this.keyId = options.keyId;
    this.budget = new RateBudget({
      id: this.id,
      windows: options.windows ?? [],
      ...(options.limitScope ? { limitScope: options.limitScope } : {}),
      ...(options.maxWaitMs !== undefined ? { maxWaitMs: options.maxWaitMs } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
  }

  /** Calls received by one model. */
  callsTo(model: string): FakeCall[] {
    return this.calls.filter((c) => c.model === model);
  }

  model(modelId: string): LanguageModelV4 {
    const next = (options: LanguageModelV4CallOptions): FakeStep => {
      const script = this.#scripts[modelId];
      if (!script) {
        throw new APICallError({
          message: `model ${modelId} not found`,
          url: `fake://${this.id}/${modelId}`,
          requestBodyValues: {},
          statusCode: 404,
        });
      }
      const index = this.#counters.get(modelId) ?? 0;
      this.#counters.set(modelId, index + 1);
      const call: FakeCall = { model: modelId, index, options };
      this.calls.push(call);
      const step = typeof script === 'function' ? script(call) : script[index];
      if (!step) throw new Error(`fake script for ${modelId} has no step ${index}`);
      if (step.kind === 'http-error') {
        throw new APICallError({
          message: step.message ?? `HTTP ${step.status}`,
          url: `fake://${this.id}/${modelId}`,
          requestBodyValues: {},
          statusCode: step.status,
          ...(step.headers ? { responseHeaders: step.headers } : {}),
          isRetryable: step.status === 429 || step.status >= 500,
        });
      }
      return step;
    };

    return new MockLanguageModelV4({
      provider: this.id,
      modelId,
      doStream: (options): Promise<LanguageModelV4StreamResult> => {
        try {
          const step = next(options);
          const headers = 'headers' in step ? step.headers : undefined;
          return Promise.resolve({
            stream: buildStream(step, modelId, options.abortSignal),
            ...(headers ? { response: { headers } } : {}),
          });
        } catch (err) {
          return Promise.reject(err instanceof Error ? err : new Error('fake provider failure'));
        }
      },
    });
  }

  servedModelId(requested: string, served: string | undefined): string | undefined {
    if (!this.#pinServed || !served || served === requested) return undefined;
    return served;
  }

  listModels(options: ListModelsOptions = {}): Promise<ModelInfo[]> {
    const models = Object.keys(this.#scripts).map((id) => ({ id, tools: true, free: true }));
    return Promise.resolve(
      models.filter(
        (m) =>
          (options.tools === undefined || m.tools === options.tools) &&
          (options.free === undefined || m.free === options.free),
      ),
    );
  }
}

/* Step builders, to keep test scripts short. */

export const fake = {
  text(
    text: string,
    extra: Omit<Extract<FakeStep, { kind: 'text' }>, 'kind' | 'text'> = {},
  ): FakeStep {
    return { kind: 'text', text, ...extra };
  },
  toolCall(
    name: string,
    input: unknown,
    extra: { id?: string; text?: string; servedModel?: string; gate?: Promise<unknown> } = {},
  ): FakeStep {
    const { id, ...rest } = extra;
    return { kind: 'tool-calls', calls: [{ name, input, ...(id ? { id } : {}) }], ...rest };
  },
  toolCalls(calls: FakeToolCall[], extra: { gate?: Promise<unknown> } = {}): FakeStep {
    return { kind: 'tool-calls', calls, ...extra };
  },
  rateLimited(headers: Record<string, string> = {}): FakeStep {
    return { kind: 'http-error', status: 429, message: 'Rate limit exceeded', headers };
  },
  httpError(status: number, message?: string): FakeStep {
    return { kind: 'http-error', status, ...(message ? { message } : {}) };
  },
  streamError(error: unknown): FakeStep {
    return { kind: 'stream-error', error };
  },
  /** An empty answer: no text, no tool call, no usage (OpenRouter's empty stream). */
  empty(): FakeStep {
    return { kind: 'empty' };
  },
};
