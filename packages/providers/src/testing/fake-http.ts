/*
 * Fake HTTP servers speaking each provider's wire format (model list, SSE
 * chat streams, errors), so the real AI SDK providers run end to end without
 * the network. Every request is recorded with its URL, headers and body.
 */

export type WireFormat = 'anthropic' | 'openai' | 'google';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export type Route = (req: RecordedRequest) => Response | Promise<Response> | undefined;

export interface FakeHttp {
  fetch: typeof fetch;
  requests: RecordedRequest[];
  /** Requests whose URL contains `part`. */
  to(part: string): RecordedRequest[];
}

export function fakeHttp(...routes: Route[]): FakeHttp {
  const requests: RecordedRequest[] = [];
  const doFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).forEach(
      (v, k) => {
        headers[k] = v;
      },
    );
    const body = typeof init?.body === 'string' ? init.body : '';
    const req: RecordedRequest = { method: init?.method ?? 'GET', url, headers, body };
    requests.push(req);
    init?.signal?.throwIfAborted();
    for (const route of routes) {
      const res = await route(req);
      if (res) return res;
    }
    return json({ error: { message: `no route for ${req.method} ${url}` } }, 404);
  };
  return {
    fetch: doFetch,
    requests,
    to: (part) => requests.filter((r) => r.url.includes(part)),
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function sse(events: { event?: string; data: unknown }[], headers: Record<string, string> = {}) {
  const text = events
    .map(
      (e) =>
        `${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`,
    )
    .join('');
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
}

export interface FakeReply {
  /** A tool call; otherwise a text answer. */
  tool?: { name: string; input: Record<string, unknown> };
  text?: string;
  model?: string;
  headers?: Record<string, string>;
}

/** A streamed answer in the given wire format. */
export function streamReply(format: WireFormat, reply: FakeReply): Response {
  const model = reply.model ?? 'm';
  const headers = reply.headers ?? {};
  if (format === 'anthropic') {
    const block = reply.tool
      ? [
          {
            event: 'content_block_start',
            data: {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'tool_use', id: 'toolu_1', name: reply.tool.name, input: {} },
            },
          },
          {
            event: 'content_block_delta',
            data: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'input_json_delta', partial_json: JSON.stringify(reply.tool.input) },
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
              delta: { type: 'text_delta', text: reply.text ?? '' },
            },
          },
        ];
    return sse(
      [
        {
          event: 'message_start',
          data: {
            type: 'message_start',
            message: {
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 11, output_tokens: 1 },
            },
          },
        },
        ...block,
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        {
          event: 'message_delta',
          data: {
            type: 'message_delta',
            delta: { stop_reason: reply.tool ? 'tool_use' : 'end_turn', stop_sequence: null },
            usage: { output_tokens: 6 },
          },
        },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ],
      headers,
    );
  }
  if (format === 'google') {
    const part = reply.tool
      ? { functionCall: { name: reply.tool.name, args: reply.tool.input } }
      : { text: reply.text ?? '' };
    return sse(
      [
        {
          data: {
            candidates: [
              { content: { parts: [part], role: 'model' }, finishReason: 'STOP', index: 0 },
            ],
            usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 6, totalTokenCount: 17 },
            modelVersion: model,
          },
        },
      ],
      headers,
    );
  }
  // OpenAI chat completions (OpenAI, Groq, Mistral, Ollama, LM Studio).
  const delta = reply.tool
    ? {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            index: 0,
            id: 'call0abc1',
            type: 'function',
            function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.input) },
          },
        ],
      }
    : { role: 'assistant', content: reply.text ?? '' };
  const base = { id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1, model };
  return sse(
    [
      { data: { ...base, choices: [{ index: 0, delta, finish_reason: null }] } },
      {
        data: {
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: reply.tool ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 11, completion_tokens: 6, total_tokens: 17 },
          // Groq reports the usage here.
          x_groq: { usage: { prompt_tokens: 11, completion_tokens: 6, total_tokens: 17 } },
        },
      },
      { data: '[DONE]' },
    ],
    headers,
  );
}

/** An error answer shaped like the provider's. */
export function errorReply(
  format: WireFormat,
  status: number,
  message: string,
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {},
): Response {
  if (format === 'anthropic') {
    return json({ type: 'error', error: { type: 'error', message } }, status, headers);
  }
  if (format === 'google') {
    return json({ error: { code: status, message, status: 'ERROR', ...extra } }, status, headers);
  }
  return json({ error: { message, type: 'error', code: null, ...extra } }, status, headers);
}
