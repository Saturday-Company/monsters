/*
 * Fake wire for the prompt-cache tests (D-168): the real OpenRouter and Anthropic providers of
 * the AI SDK talk to a `fetch` that records the exact request bodies and answers in each
 * provider's own format, with the usage fields the cache adds (OpenRouter's
 * `prompt_tokens_details.cached_tokens`, Anthropic's `cache_creation_input_tokens` and
 * `cache_read_input_tokens`). Never the network.
 */
import { KeyedProvider, OpenRouterProvider, type ModelProvider } from '@monsters/providers';

export interface WireUsage {
  /** Total prompt tokens the provider counts, cache reads and writes included. */
  prompt: number;
  completion: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** OpenRouter only: the cost it bills for the request, in dollars. */
  cost?: number;
}

export type WireStep =
  | { text: string; usage?: WireUsage }
  | { tool: { name: string; input: Record<string, unknown> }; usage?: WireUsage };

export interface Wire {
  fetch: typeof fetch;
  /** The JSON bodies of the chat requests, in order. */
  bodies: Record<string, unknown>[];
  /** The same requests as the exact text that went out. */
  raw: string[];
}

const DEFAULT_USAGE: WireUsage = { prompt: 1000, completion: 20 };

function sse(chunks: { event?: string; data: unknown }[]): Response {
  const body = chunks
    .map((c) => `${c.event ? `event: ${c.event}\n` : ''}data: ${JSON.stringify(c.data)}\n\n`)
    .join('');
  return new Response(body + (chunks[0]?.event ? '' : 'data: [DONE]\n\n'), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function openRouterReply(step: WireStep, model: string, n: number): Response {
  const u = step.usage ?? DEFAULT_USAGE;
  const delta =
    'tool' in step
      ? {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              index: 0,
              id: `call_${n}`,
              type: 'function',
              function: { name: step.tool.name, arguments: JSON.stringify(step.tool.input) },
            },
          ],
        }
      : { role: 'assistant', content: step.text };
  return sse([
    { data: { id: `gen-${n}`, model, choices: [{ index: 0, delta, finish_reason: null }] } },
    {
      data: {
        id: `gen-${n}`,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: 'tool' in step ? 'tool_calls' : 'stop' }],
        usage: {
          prompt_tokens: u.prompt,
          completion_tokens: u.completion,
          total_tokens: u.prompt + u.completion,
          ...(u.cacheRead !== undefined || u.cacheWrite !== undefined
            ? {
                prompt_tokens_details: {
                  cached_tokens: u.cacheRead ?? 0,
                  ...(u.cacheWrite !== undefined ? { cache_write_tokens: u.cacheWrite } : {}),
                },
              }
            : {}),
          ...(u.cost !== undefined ? { cost: u.cost } : {}),
        },
      },
    },
  ]);
}

function anthropicReply(step: WireStep, model: string, n: number): Response {
  const u = step.usage ?? DEFAULT_USAGE;
  const cacheRead = u.cacheRead ?? 0;
  const cacheWrite = u.cacheWrite ?? 0;
  const block =
    'tool' in step
      ? [
          {
            event: 'content_block_start',
            data: {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'tool_use',
                id: `toolu_${n}`,
                name: step.tool.name,
                input: {},
              },
            },
          },
          {
            event: 'content_block_delta',
            data: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'input_json_delta', partial_json: JSON.stringify(step.tool.input) },
            },
          },
        ]
      : [
          {
            event: 'content_block_start',
            data: {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            },
          },
          {
            event: 'content_block_delta',
            data: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: step.text },
            },
          },
        ];
  return sse([
    {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: `msg_${n}`,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          // Anthropic's `input_tokens` is only what is neither read from nor written to the cache.
          usage: {
            input_tokens: Math.max(0, u.prompt - cacheRead - cacheWrite),
            output_tokens: 1,
            cache_creation_input_tokens: cacheWrite,
            cache_read_input_tokens: cacheRead,
          },
        },
      },
    },
    ...block,
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    {
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason: 'tool' in step ? 'tool_use' : 'end_turn', stop_sequence: null },
        usage: { output_tokens: u.completion },
      },
    },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]);
}

/** A fetch that records every chat request and answers with the steps, one per request. */
export function wire(format: 'openrouter' | 'anthropic', model: string, steps: WireStep[]): Wire {
  const bodies: Record<string, unknown>[] = [];
  const raw: string[] = [];
  let n = 0;
  const doFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (!/\/(chat\/completions|messages)$/.test(url)) {
      return Promise.resolve(new Response('{}', { status: 404 }));
    }
    const text = typeof init?.body === 'string' ? init.body : '';
    raw.push(text);
    bodies.push(JSON.parse(text) as Record<string, unknown>);
    const step = steps[n] ?? { text: 'fine' };
    n += 1;
    return Promise.resolve(
      format === 'openrouter' ? openRouterReply(step, model, n) : anthropicReply(step, model, n),
    );
  };
  return { fetch: doFetch, bodies, raw };
}

export function openRouterOn(w: Wire): ModelProvider {
  return new OpenRouterProvider({ apiKey: 'sk-or-test', freeOnly: false, fetch: w.fetch });
}

export function anthropicOn(w: Wire): ModelProvider {
  return new KeyedProvider({ type: 'anthropic', apiKey: 'sk-ant-test', fetch: w.fetch });
}

// -- What changed between two requests -----------------------------------------------------

/** The part of a request body, as text, in the order the model reads it: tools, system, messages. */
export interface Layers {
  tools: string[];
  system: string[];
  messages: string[];
}

/**
 * A value without the cache markers, and with a lone text part written as the plain string it
 * stands for: the cache compares what the model reads, not where the marks sit (OpenRouter writes
 * a marked message as a list of parts, an unmarked one as a string).
 */
function plain(value: unknown): unknown {
  if (Array.isArray(value)) {
    const parts = value.map(plain);
    const only = parts[0] as { type?: unknown; text?: unknown } | undefined;
    return parts.length === 1 &&
      only?.type === 'text' &&
      typeof only.text === 'string' &&
      Object.keys(only).length === 2
      ? only.text
      : parts;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => k !== 'cache_control')
        .map(([k, v]) => [k, plain(v)]),
    );
  }
  return value;
}

/** A request body split into the layers a prompt cache reads in order, marks left out. */
export function layersOf(body: Record<string, unknown>): Layers {
  const tools = ((body['tools'] as unknown[] | undefined) ?? []).map((t) =>
    JSON.stringify(plain(t)),
  );
  const messages = (body['messages'] as { role: string }[] | undefined) ?? [];
  const system = [
    ...(body['system'] === undefined ? [] : [JSON.stringify(plain(body['system']))]),
    ...messages.filter((m) => m.role === 'system').map((m) => JSON.stringify(plain(m))),
  ];
  return {
    tools,
    system,
    messages: messages.filter((m) => m.role !== 'system').map((m) => JSON.stringify(plain(m))),
  };
}

/** The `cache_control` markers of a request: where they sit, as JSON paths. */
export function marksOf(body: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'cache_control') out.push(path);
        else walk(x, `${path}.${k}`);
      }
    }
  };
  walk(body, '$');
  return out;
}

/** Does `later` start with every item of `earlier`? */
export function startsWith(later: readonly string[], earlier: readonly string[]): boolean {
  return earlier.length <= later.length && earlier.every((x, i) => later[i] === x);
}

/** First index where two lists differ (the shorter length when one is a prefix of the other). */
export function firstDifference(a: readonly string[], b: readonly string[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}
