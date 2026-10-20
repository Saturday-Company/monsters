import { describe, expect, it } from 'vitest';
import { ChatGPTResponsesModel } from '../src/index.ts';

// F-B7: a cancelled ChatGPT stream must close the connection, not just drop the reader.
describe('ChatGPT stream cancel', () => {
  it('aborts the request when the stream is cancelled', async () => {
    let fetchSignal: AbortSignal | undefined;
    const enc = new TextEncoder();
    const doFetch = ((_url: unknown, init?: RequestInit) => {
      fetchSignal = init?.signal ?? undefined;
      let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          bodyController = c;
          c.enqueue(
            enc.encode('data: {"type":"response.created","response":{"id":"r1","model":"m"}}\n\n'),
          );
        },
      });
      // Like a real connection: an aborted request errors the body that was being read.
      init?.signal?.addEventListener('abort', () => bodyController?.error(new Error('aborted')));
      return Promise.resolve(
        new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      );
    }) as typeof fetch;
    const model = new ChatGPTResponsesModel({
      modelId: 'gpt-5',
      baseURL: 'https://api.test/v1',
      token: () => Promise.resolve('t'),
      fetch: doFetch,
    });
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    const reader = stream.getReader();
    await reader.read(); // stream-start
    await reader.read(); // response-metadata
    await reader.cancel();
    expect(fetchSignal?.aborted).toBe(true);
  });
});
