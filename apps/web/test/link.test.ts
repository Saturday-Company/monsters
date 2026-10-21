import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composerPlaceholder } from '../src/components/chat/Composer.tsx';
import { displayState } from '../src/components/shell/StatusDisplay.tsx';
import { StreamClient } from '../src/lib/stream.ts';
import type { SocketLike, Transport } from '../src/lib/transport.ts';
import { LINK_LOST_MS, resetForTests, streamState, useApp } from '../src/store/app.ts';

describe('link to the core: lost after 10 s of reconnecting', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    resetForTests();
    vi.useRealTimers();
  });

  it('calls the link lost only when the stream stays down, and whole again when it is back', () => {
    streamState('open');
    streamState('reconnecting');
    vi.advanceTimersByTime(LINK_LOST_MS - 1);
    expect(useApp.getState().linkLost).toBe(false);
    vi.advanceTimersByTime(1);
    expect(useApp.getState().linkLost).toBe(true);
    streamState('open');
    expect(useApp.getState().linkLost).toBe(false);
  });

  it('does not call it lost when the stream comes back in time', () => {
    streamState('reconnecting');
    vi.advanceTimersByTime(3000);
    streamState('open');
    vi.advanceTimersByTime(LINK_LOST_MS * 2);
    expect(useApp.getState().linkLost).toBe(false);
  });
});

describe('StreamClient.retryNow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('connects at once instead of waiting for the backoff', () => {
    const sockets: SocketLike[] = [];
    const transport: Transport = {
      kind: 'mock',
      request: () => Promise.reject(new Error('unused')),
      connect: () => {
        const s: SocketLike = {
          onopen: null,
          onmessage: null,
          onclose: null,
          onerror: null,
          close: () => {},
        };
        sockets.push(s);
        return s;
      },
    };
    const client = new StreamClient(
      transport,
      { onHello: () => {}, onEvent: () => {}, onState: () => {}, onUnauthorized: () => {} },
      { cursor: () => undefined, random: () => 0.5, baseDelayMs: 5000 },
    );
    client.start();
    sockets[0]!.onclose?.({ code: 1006, reason: '' });
    expect(sockets).toHaveLength(1);
    client.retryNow();
    expect(sockets).toHaveLength(2);
    // A socket is already being opened: a second press does nothing.
    client.retryNow();
    expect(sockets).toHaveLength(2);
    // And the timer of the old wait is gone: no third socket when it would have fired.
    vi.advanceTimersByTime(20_000);
    expect(sockets).toHaveLength(2);
  });
});

describe('the words of a lost link', () => {
  it('say "not connected" on the display and in the field', () => {
    const d = displayState({
      halted: false,
      connection: 'closed',
      questions: [],
      nameOf: (id) => id,
      working: 0,
    });
    expect(d.text).toBe('Not connected');
    expect(
      composerPlaceholder({
        name: 'Titan',
        halted: false,
        offline: true,
        noModel: false,
        question: null,
        wide: true,
      }),
    ).toBe('Not connected: go ahead and write, the message stays here');
  });
});
