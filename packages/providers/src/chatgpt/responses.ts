import {
  APICallError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4Content,
  type LanguageModelV4FinishReason,
  type LanguageModelV4GenerateResult,
  type LanguageModelV4Prompt,
  type LanguageModelV4StreamPart,
  type LanguageModelV4StreamResult,
  type LanguageModelV4Usage,
  type SharedV4Warning,
} from '@ai-sdk/provider';
import type { PlanLimitsReading } from '@monsters/shared';
import { SubscriptionPlanError, isSubscriptionPlanCode } from '../errors.ts';
import { parseChatgptRateLimitHeaders } from '../harness/limits.ts';

/*
 * Responses API adapter for the ChatGPT plan usage (SIWC, research 06 §2.1,
 * docs "Models and inference" and "Preview limitations"): a LanguageModelV4
 * for our own loop, written for the subset that the plan route accepts.
 *
 * - `POST {base}/responses` with the SIWC bearer, `store: false`, `stream: true`
 *   on every request; the full history goes in `input` (no
 *   `previous_response_id`); system messages become `instructions` (explicit
 *   `role: system` items are refused).
 * - Parameters the route refuses are never sent (temperature, top_p,
 *   max_output_tokens, metadata, user, …): they come back as warnings.
 * - Our function tools travel in one namespace (`monsters`); calls and outputs
 *   carry the namespace back.
 * - Plan errors (`subscription_sharing_*`, `chatpass_v2_*`) become
 *   `SubscriptionPlanError` with OpenAI's code, before or during the stream:
 *   the session never falls back from them (D-035).
 */

export const TOOL_NAMESPACE = 'monsters';

/** A string field of a JSON event, or the fallback. */
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
}

export interface ResponsesModelOptions {
  modelId: string;
  /** `https://api.openai.com/v1` (the SIWC resource). */
  baseURL: string;
  /** A valid access token (refreshed by the caller when needed). */
  token: () => Promise<string>;
  fetch?: typeof fetch;
  provider?: string;
  /**
   * The plan's windows, as the headers of a response put them (D-111, D-156): called with
   * every response that carries some, the refused ones included.
   */
  onPlanLimits?: (reading: PlanLimitsReading) => void;
}

type InputItem = Record<string, unknown>;

const UNSUPPORTED_SETTINGS: [keyof LanguageModelV4CallOptions, string][] = [
  ['temperature', 'temperature'],
  ['topP', 'topP'],
  ['topK', 'topK'],
  ['maxOutputTokens', 'maxOutputTokens'],
  ['presencePenalty', 'presencePenalty'],
  ['frequencyPenalty', 'frequencyPenalty'],
  ['stopSequences', 'stopSequences'],
  ['seed', 'seed'],
];

function toBase64(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array) return Buffer.from(data).toString('base64');
  return null;
}

/** LanguageModelV4 prompt → instructions + Responses input items. */
export function convertPrompt(
  prompt: LanguageModelV4Prompt,
  warnings: SharedV4Warning[],
): { instructions: string | undefined; input: InputItem[] } {
  const system: string[] = [];
  const input: InputItem[] = [];
  for (const message of prompt) {
    switch (message.role) {
      case 'system':
        system.push(message.content);
        break;
      case 'user': {
        const content: Record<string, unknown>[] = [];
        for (const part of message.content) {
          if (part.type === 'text') {
            content.push({ type: 'input_text', text: part.text });
            continue;
          }
          const data: unknown = part.data;
          const tagged = (typeof data === 'object' && data !== null ? data : {}) as {
            type?: unknown;
            url?: unknown;
          };
          const url =
            data instanceof URL
              ? data.toString()
              : tagged.type === 'url'
                ? String(tagged.url)
                : null;
          const b64 =
            url === null
              ? toBase64(typeof data === 'object' && data && 'data' in data ? data.data : data)
              : null;
          if (part.mediaType.startsWith('image/')) {
            content.push({
              type: 'input_image',
              image_url: url ?? `data:${part.mediaType};base64,${b64 ?? ''}`,
            });
          } else if (b64 !== null) {
            content.push({
              type: 'input_file',
              filename: part.filename ?? 'file',
              file_data: `data:${part.mediaType};base64,${b64}`,
            });
          } else {
            warnings.push({ type: 'unsupported', feature: `file ${part.mediaType} by URL` });
          }
        }
        input.push({ role: 'user', content });
        break;
      }
      case 'assistant': {
        for (const part of message.content) {
          if (part.type === 'text') {
            if (part.text)
              input.push({
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: part.text }],
              });
          } else if (part.type === 'tool-call') {
            input.push({
              type: 'function_call',
              call_id: part.toolCallId,
              name: part.toolName,
              namespace: TOOL_NAMESPACE,
              arguments:
                typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {}),
            });
          } else if (part.type === 'tool-result') {
            input.push(functionOutput(part.toolCallId, part.toolName, part.output));
          }
          // Reasoning is not sent back: with store:false there is nothing to reference.
        }
        break;
      }
      case 'tool':
        for (const part of message.content) {
          if (part.type === 'tool-result') {
            input.push(functionOutput(part.toolCallId, part.toolName, part.output));
          }
        }
        break;
    }
  }
  return { instructions: system.length ? system.join('\n\n') : undefined, input };
}

function functionOutput(callId: string, name: string, output: unknown): InputItem {
  const o = output as { type: string; value?: unknown; reason?: string };
  let text: string;
  switch (o.type) {
    case 'text':
    case 'error-text':
      text = typeof o.value === 'string' ? o.value : JSON.stringify(o.value ?? '');
      break;
    case 'execution-denied':
      text = JSON.stringify({ error: o.reason ?? 'denied' });
      break;
    case 'content':
      text = (Array.isArray(o.value) ? o.value : [])
        .map((c: { type?: string; text?: string }) => (c.type === 'text' ? (c.text ?? '') : ''))
        .join('\n');
      break;
    default:
      text = JSON.stringify(o.value ?? null);
  }
  return {
    type: 'function_call_output',
    call_id: callId,
    name,
    namespace: TOOL_NAMESPACE,
    output: text,
  };
}

/** The request body: only fields the plan route accepts. */
export function buildRequestBody(
  modelId: string,
  options: LanguageModelV4CallOptions,
): { body: Record<string, unknown>; warnings: SharedV4Warning[] } {
  const warnings: SharedV4Warning[] = [];
  for (const [key, feature] of UNSUPPORTED_SETTINGS) {
    const v = options[key];
    if (v !== undefined && !(Array.isArray(v) && v.length === 0)) {
      warnings.push({
        type: 'unsupported',
        feature,
        details: 'not accepted by ChatGPT plan usage',
      });
    }
  }
  if (options.responseFormat?.type === 'json') {
    warnings.push({ type: 'unsupported', feature: 'responseFormat' });
  }
  const { instructions, input } = convertPrompt(options.prompt, warnings);
  const fns = (options.tools ?? []).flatMap((t) => {
    if (t.type !== 'function') {
      warnings.push({ type: 'unsupported', feature: `tool ${t.name}` });
      return [];
    }
    return [
      {
        type: 'function',
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        parameters: t.inputSchema,
      },
    ];
  });
  const body: Record<string, unknown> = {
    model: modelId,
    ...(instructions !== undefined ? { instructions } : {}),
    input,
    store: false,
    stream: true,
  };
  if (fns.length > 0) {
    body['tools'] = [
      {
        type: 'namespace',
        name: TOOL_NAMESPACE,
        description: 'Tools of Monsters: vault, web, team.',
        tools: fns,
      },
    ];
    const choice = options.toolChoice;
    if (choice?.type === 'none') body['tool_choice'] = 'none';
    else if (choice?.type === 'required' || choice?.type === 'tool')
      body['tool_choice'] = 'required';
    else body['tool_choice'] = 'auto';
  }
  return { body, warnings };
}

interface ResponsesError {
  code?: unknown;
  message?: unknown;
  param?: unknown;
  type?: unknown;
}

/** A plan error when OpenAI's code says so, otherwise an APICallError the session classifies. */
async function httpError(res: Response, url: string, body: unknown): Promise<Error> {
  const text = await res.text().catch(() => '');
  let error: ResponsesError | undefined;
  let detail: string | undefined;
  try {
    const parsed = JSON.parse(text) as { error?: ResponsesError; detail?: unknown };
    error = parsed.error;
    if (typeof parsed.detail === 'string') detail = parsed.detail;
  } catch {
    // not JSON
  }
  const requestId = res.headers.get('x-request-id') ?? undefined;
  if (error && isSubscriptionPlanCode(error.code)) {
    return new SubscriptionPlanError(
      error.code,
      typeof error.message === 'string' ? error.message : '',
      {
        status: res.status,
        ...(typeof error.param === 'string' ? { param: error.param } : {}),
        ...(requestId ? { requestId } : {}),
      },
    );
  }
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  return new APICallError({
    message:
      (typeof error?.message === 'string' ? error.message : detail) ??
      `ChatGPT answered ${res.status}`,
    url,
    requestBodyValues: body,
    statusCode: res.status,
    responseHeaders: headers,
    responseBody: text.slice(0, 20_000),
    isRetryable: res.status === 429 || res.status >= 500,
  });
}

function emptyUsage(): LanguageModelV4Usage {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };
}

function usageOf(u: unknown): LanguageModelV4Usage {
  const x = (u ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
  const cached = x.input_tokens_details?.cached_tokens;
  const reasoning = x.output_tokens_details?.reasoning_tokens;
  return {
    inputTokens: {
      total: x.input_tokens,
      noCache:
        x.input_tokens !== undefined && cached !== undefined
          ? x.input_tokens - cached
          : x.input_tokens,
      cacheRead: cached,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: x.output_tokens,
      text:
        x.output_tokens !== undefined && reasoning !== undefined
          ? x.output_tokens - reasoning
          : x.output_tokens,
      reasoning,
    },
  };
}

/** Splits an SSE byte stream into the JSON payloads of its `data:` lines. */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '');
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''))
          .join('\n');
        if (!data || data === '[DONE]') continue;
        try {
          yield JSON.parse(data);
        } catch {
          // ignore a malformed event
        }
      }
    }
  } finally {
    // Cancel the body, not only the reader: otherwise the server keeps generating (F-B7).
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function planErrorFromEvent(e: { code?: unknown; message?: unknown; param?: unknown }): Error {
  if (isSubscriptionPlanCode(e.code)) {
    return new SubscriptionPlanError(e.code, typeof e.message === 'string' ? e.message : '', {
      ...(typeof e.param === 'string' ? { param: e.param } : {}),
    });
  }
  const code = typeof e.code === 'string' ? e.code : 'response_failed';
  const err = new Error(
    `${code}: ${typeof e.message === 'string' ? e.message : 'the response failed'}`,
  );
  err.name = 'ChatGPTResponseError';
  return err;
}

export class ChatGPTResponsesModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4';
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = { 'image/*': [/^https:\/\//] };
  readonly #o: ResponsesModelOptions;

  constructor(options: ResponsesModelOptions) {
    this.#o = options;
    this.provider = options.provider ?? 'chatgpt';
    this.modelId = options.modelId;
  }

  /** A number of the usage block never costs a request. */
  #reportLimits(headers: Headers): void {
    if (!this.#o.onPlanLimits) return;
    try {
      const reading = parseChatgptRateLimitHeaders(headers, Date.now());
      if (reading) this.#o.onPlanLimits(reading);
    } catch {
      // ignored
    }
  }

  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    const { body, warnings } = buildRequestBody(this.modelId, options);
    const url = `${this.#o.baseURL.replace(/\/+$/, '')}/responses`;
    const token = await this.#o.token();
    const doFetch = this.#o.fetch ?? globalThis.fetch;
    // Our own controller, tied to the caller's signal: cancelling the stream closes the connection.
    const connection = new AbortController();
    const onCallerAbort = () => connection.abort(options.abortSignal?.reason);
    if (options.abortSignal?.aborted) onCallerAbort();
    else options.abortSignal?.addEventListener('abort', onCallerAbort, { once: true });
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...(options.headers as Record<string, string> | undefined),
      },
      body: JSON.stringify(body),
      signal: connection.signal,
    }).catch((err: unknown) => {
      options.abortSignal?.removeEventListener('abort', onCallerAbort);
      throw err;
    });
    this.#reportLimits(res.headers);
    if (!res.ok || !res.body) {
      options.abortSignal?.removeEventListener('abort', onCallerAbort);
      throw await httpError(res, url, body);
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const events = sseEvents(res.body);

    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      async start(controller) {
        controller.enqueue({ type: 'stream-start', warnings });
        /** item_id → call_id of the function calls being streamed. */
        const calls = new Map<string, { callId: string; name: string; args: string }>();
        const openText = new Set<string>();
        let sawToolCall = false;
        let finished = false;
        /** The reasoning of the model is shown as one reasoning part: a sign of life for the session. */
        let reasoning = false;
        const endReasoning = () => {
          if (reasoning) controller.enqueue({ type: 'reasoning-end', id: 'reasoning' });
          reasoning = false;
        };
        const finish = (reason: LanguageModelV4FinishReason, usage: LanguageModelV4Usage) => {
          endReasoning();
          for (const id of openText) controller.enqueue({ type: 'text-end', id });
          openText.clear();
          controller.enqueue({ type: 'finish', usage, finishReason: reason });
          finished = true;
        };
        try {
          for await (const raw of events) {
            const e = raw as Record<string, unknown> & { type?: string };
            // gpt-5 with a high effort thinks for a long time without text: the session would
            // read the silence as a hung request (F-A5), so these events show it is working.
            const itemType = (e['item'] as { type?: unknown } | undefined)?.type;
            if (
              e.type === 'response.in_progress' ||
              e.type?.startsWith('response.reasoning') ||
              (e.type?.startsWith('response.output_item.') && itemType === 'reasoning')
            ) {
              if (!reasoning) {
                reasoning = true;
                controller.enqueue({ type: 'reasoning-start', id: 'reasoning' });
              }
              if (typeof e['delta'] === 'string' && e['delta'] !== '')
                controller.enqueue({ type: 'reasoning-delta', id: 'reasoning', delta: e['delta'] });
              continue;
            }
            if (e.type === 'response.output_text.delta' || e.type === 'response.output_item.added')
              endReasoning();
            switch (e.type) {
              case 'response.created': {
                const r = (e['response'] ?? {}) as {
                  id?: string;
                  model?: string;
                  created_at?: number;
                };
                controller.enqueue({
                  type: 'response-metadata',
                  ...(r.id ? { id: r.id } : {}),
                  ...(r.model ? { modelId: r.model } : {}),
                  ...(r.created_at ? { timestamp: new Date(r.created_at * 1000) } : {}),
                });
                break;
              }
              case 'response.output_item.added': {
                const item = (e['item'] ?? {}) as Record<string, unknown>;
                if (item['type'] === 'message' && typeof item['id'] === 'string') {
                  openText.add(item['id']);
                  controller.enqueue({ type: 'text-start', id: item['id'] });
                } else if (item['type'] === 'function_call') {
                  const callId = str(item['call_id'], str(item['id']));
                  const name = str(item['name']);
                  calls.set(str(item['id'], callId), { callId, name, args: '' });
                  controller.enqueue({ type: 'tool-input-start', id: callId, toolName: name });
                }
                break;
              }
              case 'response.output_text.delta': {
                const id = str(e['item_id']);
                if (!openText.has(id)) {
                  openText.add(id);
                  controller.enqueue({ type: 'text-start', id });
                }
                controller.enqueue({ type: 'text-delta', id, delta: str(e['delta']) });
                break;
              }
              case 'response.function_call_arguments.delta': {
                const call = calls.get(str(e['item_id']));
                if (call) {
                  call.args += str(e['delta']);
                  controller.enqueue({
                    type: 'tool-input-delta',
                    id: call.callId,
                    delta: str(e['delta']),
                  });
                }
                break;
              }
              case 'response.output_item.done': {
                const item = (e['item'] ?? {}) as Record<string, unknown>;
                if (item['type'] === 'message' && typeof item['id'] === 'string') {
                  if (openText.delete(item['id']))
                    controller.enqueue({ type: 'text-end', id: item['id'] });
                } else if (item['type'] === 'function_call') {
                  const known = calls.get(str(item['id']));
                  const callId = str(item['call_id'], known?.callId ?? '');
                  const name = str(item['name'], known?.name ?? '');
                  const args =
                    typeof item['arguments'] === 'string'
                      ? item['arguments']
                      : (known?.args ?? '{}');
                  if (!known)
                    controller.enqueue({ type: 'tool-input-start', id: callId, toolName: name });
                  controller.enqueue({ type: 'tool-input-end', id: callId });
                  controller.enqueue({
                    type: 'tool-call',
                    toolCallId: callId,
                    toolName: name,
                    input: args || '{}',
                  });
                  sawToolCall = true;
                }
                break;
              }
              case 'response.completed': {
                const r = (e['response'] ?? {}) as { usage?: unknown };
                finish(
                  { unified: sawToolCall ? 'tool-calls' : 'stop', raw: 'completed' },
                  usageOf(r.usage),
                );
                break;
              }
              case 'response.incomplete': {
                const r = (e['response'] ?? {}) as {
                  usage?: unknown;
                  incomplete_details?: { reason?: string };
                };
                const reason = r.incomplete_details?.reason;
                finish(
                  {
                    unified: reason === 'max_output_tokens' ? 'length' : 'other',
                    raw: reason ?? 'incomplete',
                  },
                  usageOf(r.usage),
                );
                break;
              }
              case 'response.failed': {
                const r = (e['response'] ?? {}) as {
                  error?: Record<string, unknown>;
                  usage?: unknown;
                };
                controller.enqueue({ type: 'error', error: planErrorFromEvent(r.error ?? {}) });
                finish({ unified: 'error', raw: 'failed' }, usageOf(r.usage));
                break;
              }
              case 'error': {
                const err = (e['error'] ?? e) as Record<string, unknown>;
                controller.enqueue({ type: 'error', error: planErrorFromEvent(err) });
                break;
              }
              default:
                break;
            }
            if (finished) break;
          }
          if (!finished) {
            controller.enqueue({
              type: 'error',
              error: new Error('the ChatGPT stream ended before response.completed'),
            });
            finish({ unified: 'error', raw: undefined }, emptyUsage());
          }
          options.abortSignal?.removeEventListener('abort', onCallerAbort);
          controller.close();
        } catch (err) {
          options.abortSignal?.removeEventListener('abort', onCallerAbort);
          controller.error(err);
        }
      },
      async cancel() {
        // Abort first: a generator parked on `reader.read()` only returns once the read settles.
        connection.abort();
        options.abortSignal?.removeEventListener('abort', onCallerAbort);
        await events.return(undefined);
      },
    });
    return { stream, request: { body }, response: { headers } };
  }

  /** The plan route only streams: a non-streaming call collects the stream. */
  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    const result = await this.doStream(options);
    const content: LanguageModelV4Content[] = [];
    const texts = new Map<string, string>();
    let usage = emptyUsage();
    let finishReason: LanguageModelV4FinishReason = { unified: 'other', raw: undefined };
    let warnings: SharedV4Warning[] = [];
    let modelId: string | undefined;
    const reader = result.stream.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      switch (value.type) {
        case 'stream-start':
          warnings = value.warnings;
          break;
        case 'response-metadata':
          modelId = value.modelId ?? modelId;
          break;
        case 'text-delta':
          texts.set(value.id, (texts.get(value.id) ?? '') + value.delta);
          break;
        case 'text-end':
          content.push({ type: 'text', text: texts.get(value.id) ?? '' });
          texts.delete(value.id);
          break;
        case 'tool-call':
          content.push(value);
          break;
        case 'finish':
          usage = value.usage;
          finishReason = value.finishReason;
          break;
        case 'error':
          throw value.error;
        default:
          break;
      }
    }
    return {
      content,
      finishReason,
      usage,
      warnings,
      ...(result.request ? { request: result.request } : {}),
      response: {
        ...(modelId ? { modelId } : {}),
        ...(result.response?.headers ? { headers: result.response.headers } : {}),
      },
    };
  }
}
