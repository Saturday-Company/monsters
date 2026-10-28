import { STREAM_HEARTBEAT_MS, type AgentSummary } from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamClient, TROUBLE_EVERY_MS, type StreamHandlers } from '../src/lib/stream.ts';
import type { RawResponse, SocketLike, Transport } from '../src/lib/transport.ts';
import { boot, initApp, resetForTests, stopAgent, useApp } from '../src/store/app.ts';

interface FakeSocket extends SocketLike {
  closed: { code?: number; reason?: string } | null;
}

function fakeTransport(request?: Transport['request']) {
  const sockets: FakeSocket[] = [];
  const transport: Transport = {
    kind: 'mock',
    request: request ?? (() => Promise.reject(new Error('unused'))),
    connect: () => {
      const s: FakeSocket = {
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        closed: null,
        close: (code, reason) => {
          s.closed = { code, reason };
        },
      };
      sockets.push(s);
      return s;
    },
  };
  return { sockets, transport };
}

const quiet: StreamHandlers = {
  onHello: () => {},
  onEvent: () => {},
  onState: () => {},
  onUnauthorized: () => {},
};

const ping = JSON.stringify({ kind: 'ping' });
const SILENCE_MS = STREAM_HEARTBEAT_MS * 2.5;

describe('StreamClient: a dead socket is noticed (heartbeat of the core)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function connected(handlers: Partial<StreamHandlers> = {}) {
    const { sockets, transport } = fakeTransport();
    const client = new StreamClient(
      transport,
      { ...quiet, ...handlers },
      { cursor: () => undefined, random: () => 0.5 },
    );
    client.start();
    sockets[0]!.onopen?.();
    return { client, sockets };
  }

  it('reconnects after 2.5 heartbeats of silence, and the heartbeats keep it alive', () => {
    const { client, sockets } = connected();
    sockets[0]!.onmessage?.({ data: ping });
    // The core is heard every heartbeat: nothing happens however long it goes on.
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(STREAM_HEARTBEAT_MS);
      sockets[0]!.onmessage?.({ data: ping });
    }
    expect(sockets).toHaveLength(1);

    // Then nothing more (laptop asleep, Wi-Fi changed): the socket is given up and a new one opened.
    vi.advanceTimersByTime(SILENCE_MS - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets[0]!.closed).toEqual({ code: 4000, reason: 'silent' });
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    client.stop();
  });

  it('any message counts as a sign of life, not only the ping', () => {
    const { client, sockets } = connected();
    sockets[0]!.onmessage?.({ data: ping });
    vi.advanceTimersByTime(SILENCE_MS - 1000);
    sockets[0]!.onmessage?.({ data: JSON.stringify({ kind: 'replay_done', count: 0 }) });
    vi.advanceTimersByTime(SILENCE_MS - 1000);
    expect(sockets).toHaveLength(1);
    client.stop();
  });

  it('does not judge a core that never sends the heartbeat (an older one)', () => {
    const { client, sockets } = connected();
    sockets[0]!.onmessage?.({ data: JSON.stringify({ kind: 'hello', halted: false }) });
    vi.advanceTimersByTime(SILENCE_MS * 10);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.closed).toBeNull();
    client.stop();
  });

  it('a socket that closes by itself is not closed twice and its watchdog is gone', () => {
    const { client, sockets } = connected();
    sockets[0]!.onmessage?.({ data: ping });
    sockets[0]!.onclose?.({ code: 1006, reason: '' });
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    // The old watchdog must not tear down the new socket.
    sockets[1]!.onopen?.();
    vi.advanceTimersByTime(SILENCE_MS * 4);
    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.closed).toBeNull();
    client.stop();
  });

  it('reconnects at once when the network comes back, and when the page is shown after a long silence', () => {
    const page = new EventTarget();
    const win = new EventTarget();
    const visibility = { visibilityState: 'hidden' };
    vi.stubGlobal('document', Object.assign(page, visibility));
    vi.stubGlobal('addEventListener', win.addEventListener.bind(win));
    vi.stubGlobal('removeEventListener', win.removeEventListener.bind(win));
    const { client, sockets } = connected();
    sockets[0]!.onmessage?.({ data: ping });

    // Page shown again soon after the last sign of life: the socket is trusted.
    vi.advanceTimersByTime(STREAM_HEARTBEAT_MS);
    (document as unknown as { visibilityState: string }).visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    expect(sockets).toHaveLength(1);

    // The same after the page slept for longer than a heartbeat and a half (timers frozen).
    vi.setSystemTime(Date.now() + STREAM_HEARTBEAT_MS * 2);
    page.dispatchEvent(new Event('visibilitychange'));
    expect(sockets[0]!.closed?.reason).toBe('silent');
    expect(sockets).toHaveLength(2);

    // The network changed: even a recent socket is not trusted.
    sockets[1]!.onopen?.();
    sockets[1]!.onmessage?.({ data: ping });
    win.dispatchEvent(new Event('online'));
    expect(sockets[1]!.closed?.reason).toBe('silent');
    expect(sockets).toHaveLength(3);

    // A pending wait is skipped too.
    sockets[2]!.onclose?.({ code: 1006, reason: '' });
    expect(sockets).toHaveLength(3);
    win.dispatchEvent(new Event('online'));
    expect(sockets).toHaveLength(4);

    // Stopped: the listeners are gone.
    client.stop();
    win.dispatchEvent(new Event('online'));
    expect(sockets).toHaveLength(4);
  });
});

describe('StreamClient: the session is checked again while the outage lasts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks once at the third attempt, then at most every 30 seconds', () => {
    const { sockets, transport } = fakeTransport();
    let trouble = 0;
    const client = new StreamClient(
      transport,
      { ...quiet, onTrouble: () => trouble++ },
      { cursor: () => undefined, random: () => 0.5, baseDelayMs: 500, maxDelayMs: 10_000 },
    );
    client.start();
    // The core is down: every socket fails at once.
    const fail = () => sockets.at(-1)!.onclose?.({ code: 1006, reason: '' });
    const tick = (ms: number) => {
      vi.advanceTimersByTime(ms);
      fail();
    };
    fail();
    tick(500);
    expect(trouble).toBe(0);
    tick(1000);
    expect(trouble).toBe(1);
    // Attempts ~10 s apart from now on.
    const startedAt = Date.now();
    while (Date.now() - startedAt < TROUBLE_EVERY_MS - 10_000) tick(10_000);
    expect(trouble).toBe(1);
    while (Date.now() - startedAt < TROUBLE_EVERY_MS * 3) tick(10_000);
    expect(trouble).toBe(4);

    // The core comes back and goes down again later: the next outage starts over.
    vi.advanceTimersByTime(10_000);
    sockets.at(-1)!.onopen?.();
    fail();
    tick(500);
    tick(1000);
    expect(trouble).toBe(5);
    client.stop();
  });
});

describe('store: an expired session goes to the login', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    resetForTests();
    vi.useRealTimers();
  });

  it('finds out on a later attempt when the core was down at the first check', async () => {
    let coreUp = true;
    let sessionValid = true;
    const answer = (route: string): RawResponse => {
      switch (route) {
        case '/api/setup-status':
          return { status: 200, body: { needsSetup: false } };
        case '/api/me':
          return sessionValid
            ? { status: 200, body: { email: 'g@example.com', via: 'session', owner: true } }
            : { status: 401, body: { error: 'unauthorized' } };
        case '/api/status':
          return {
            status: 200,
            body: {
              version: '0',
              halted: false,
              haltedAt: null,
              haltedReason: null,
              runs: [],
              uptimeMs: 1,
            },
          };
        case '/api/events':
          return { status: 200, body: { events: [] } };
        case '/api/agents':
        case '/api/questions':
          return { status: 200, body: [] };
        default:
          return { status: 404, body: { error: 'not_found' } };
      }
    };
    const { sockets, transport } = fakeTransport((_method, path) =>
      coreUp ? Promise.resolve(answer(path.split('?')[0]!)) : Promise.reject(new Error('down')),
    );
    initApp(transport);
    await boot();
    expect(useApp.getState().phase).toBe('ready');
    sockets[0]!.onopen?.();

    // The core goes away; by the time it is back the session has expired (or the bridge's was deleted).
    coreUp = false;
    sessionValid = false;
    const fail = () => sockets.at(-1)!.onclose?.({ code: 1006, reason: '' });
    fail();
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      fail();
    }
    // The first check (attempt 3) found the core unreachable: still waiting, not at the login.
    expect(useApp.getState().phase).toBe('ready');
    expect(useApp.getState().linkLost).toBe(true);

    coreUp = true;
    for (let i = 0; i < 6 && useApp.getState().phase === 'ready'; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      fail();
    }
    expect(useApp.getState().phase).toBe('login');
  });
});

describe('store: Stop on a monster that was not working', () => {
  afterEach(() => resetForTests());

  function agent(state: AgentSummary['state']): AgentSummary {
    return {
      id: 'titan',
      name: 'Titan',
      role: 'r',
      color: '#888',
      isOrchestrator: true,
      genome: null,
      state,
    };
  }

  async function stopWith(stopResult: { stopped: number; parts: number }) {
    let agents = [agent('working')];
    let agentReads = 0;
    const { transport } = fakeTransport((method, path) => {
      const route = path.split('?')[0]!;
      const ok = (body: unknown) => Promise.resolve({ status: 200, body });
      if (route === '/api/setup-status') return ok({ needsSetup: false });
      if (route === '/api/me') return ok({ email: 'g@example.com', via: 'session', owner: true });
      if (route === '/api/status')
        return ok({
          version: '0',
          halted: false,
          haltedAt: null,
          haltedReason: null,
          runs: [],
          uptimeMs: 1,
        });
      if (route === '/api/events') return ok({ events: [] });
      if (route === '/api/questions') return ok([]);
      if (route === '/api/agents' && method === 'GET') {
        agentReads++;
        return ok(agents);
      }
      if (route === '/api/agents/titan/stop')
        return ok({
          ...stopResult,
          runs: [],
          processesKilled: 0,
          sendsDropped: 0,
          giriSkipped: 0,
        });
      return Promise.resolve({ status: 404, body: { error: 'not_found' } });
    });
    initApp(transport);
    await boot();
    expect(useApp.getState().live['titan']?.mood).toBe('working');
    // The core says it is idle, while the UI missed the event that ended the work.
    agents = [agent('idle')];
    const before = agentReads;
    await stopAgent('titan');
    return { reads: agentReads - before };
  }

  it('reads the team again when the core had nothing to stop', async () => {
    const { reads } = await stopWith({ stopped: 0, parts: 0 });
    expect(reads).toBe(1);
    expect(useApp.getState().live['titan']?.mood).toBe('idle');
  });

  it('leaves the picture to the stream when something was stopped', async () => {
    expect((await stopWith({ stopped: 1, parts: 0 })).reads).toBe(0);
    resetForTests();
    expect((await stopWith({ stopped: 0, parts: 2 })).reads).toBe(0);
  });
});
