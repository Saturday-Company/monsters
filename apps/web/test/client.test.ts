import type { LogEvent } from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../src/lib/api.ts';
import { MOCK_SETUP_CODE, MockCore } from '../src/lib/mock/core.ts';
import { StreamClient, backoffDelay, type ConnectionState } from '../src/lib/stream.ts';
import type { SocketLike, Transport } from '../src/lib/transport.ts';

describe('backoffDelay', () => {
  it('grows exponentially with jitter and a cap', () => {
    const mid = () => 0.5;
    expect(backoffDelay(0, 500, 10_000, mid)).toBe(500);
    expect(backoffDelay(3, 500, 10_000, mid)).toBe(4000);
    expect(backoffDelay(12, 500, 10_000, mid)).toBe(10_000);
    expect(backoffDelay(0, 500, 10_000, () => 0)).toBe(350);
  });
});

describe('StreamClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reconnects with the last event as cursor and stops on auth close', () => {
    const sockets: { path: string; s: SocketLike }[] = [];
    const transport: Transport = {
      kind: 'mock',
      request: () => Promise.reject(new Error('unused')),
      connect: (path) => {
        const s: SocketLike = {
          onopen: null,
          onmessage: null,
          onclose: null,
          onerror: null,
          close: () => {},
        };
        sockets.push({ path, s });
        return s;
      },
    };
    const states: ConnectionState[] = [];
    const events: string[] = [];
    let cursor: string | undefined;
    let unauthorized = 0;
    const client = new StreamClient(
      transport,
      {
        onHello: () => {},
        onEvent: (e) => {
          events.push(e.id);
          cursor = e.id;
        },
        onState: (s) => states.push(s),
        onUnauthorized: () => unauthorized++,
      },
      { cursor: () => cursor, random: () => 0.5 },
    );
    client.start();
    expect(sockets[0]!.path).toBe('/api/stream');
    sockets[0]!.s.onopen?.();
    const event = {
      id: '01JZZZZZZZZZZZZZZZZZZZZZZZ',
      ts: 1,
      agent: 'titan',
      runId: null,
      parentId: null,
      type: 'resume',
      data: { by: 'ui' },
    } satisfies LogEvent;
    sockets[0]!.s.onmessage?.({ data: JSON.stringify({ kind: 'event', event }) });
    sockets[0]!.s.onmessage?.({
      data: JSON.stringify({ kind: 'event', event: { ...event, type: 'from_the_future' } }),
    });
    expect(events).toEqual([event.id]);

    sockets[0]!.s.onclose?.({ code: 1006, reason: '' });
    expect(states.at(-1)).toBe('reconnecting');
    vi.advanceTimersByTime(500);
    expect(sockets[1]!.path).toBe(`/api/stream?after=${event.id}`);

    sockets[1]!.s.onclose?.({ code: 4401, reason: 'session expired' });
    expect(unauthorized).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
  });
});

describe('ApiClient against the mock core', () => {
  it('runs setup with the one-time code, then login', async () => {
    const core = new MockCore({ mode: 'team', speed: 0.01 });
    const api = new ApiClient(core.transport());
    expect(await api.setupStatus()).toEqual({ needsSetup: true });
    await expect(
      api.setup({ email: 'a@b.it', password: 'password1', setupCode: '000000' }),
    ).rejects.toMatchObject({
      code: 'invalid_setup_code',
    });
    await api.setup({ email: 'a@b.it', password: 'password1', setupCode: MOCK_SETUP_CODE });
    expect(await api.me()).toMatchObject({ email: 'a@b.it' });
    await api.logout();
    expect(await api.me()).toBeNull();
    await expect(api.login('a@b.it', 'sbagliata')).rejects.toBeInstanceOf(ApiError);
    await api.login('a@b.it', 'password1');
    expect((await api.agents()).length).toBeGreaterThan(1);
  });

  it('streams a reply, asks a question and undoes a vault change', async () => {
    const core = new MockCore({ mode: 'demo', speed: 0.01 });
    const api = new ApiClient(core.transport());
    const [q] = await api.questions('open');
    expect(q?.options.length).toBeGreaterThanOrEqual(2);
    const answered = await api.answer(q!.id, { optionId: q!.recommended! });
    expect(answered.status).toBe('answered');
    await new Promise((r) => setTimeout(r, 300));
    const finals = core.events.filter(
      (e) => e.type === 'message' && e.agent === 'titan' && !e.data.partial,
    );
    expect(finals.at(-1)).toBeDefined();
    expect(core.events.some((e) => e.type === 'message' && e.data.partial)).toBe(true);

    const res = await api.undo('act_seed_lisbon');
    expect(res.ok).toBe(true);
    // The undo event names the undone action (the UI marks it "Annullata" after a reload).
    expect(core.events.at(-1)).toMatchObject({
      type: 'vault_change',
      data: { action: 'undo', undoneActionId: 'act_seed_lisbon' },
    });
    // Same error code as the real core.
    await expect(api.undo('act_seed_lisbon')).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('kills and resumes', async () => {
    const core = new MockCore({ mode: 'demo', speed: 0.01 });
    const api = new ApiClient(core.transport());
    expect((await api.kill()).halted).toBe(true);
    await expect(api.sendMessage({ text: 'ciao' })).rejects.toMatchObject({ code: 'halted' });
    expect((await api.resume()).halted).toBe(false);
    expect((await api.sendMessage({ text: 'ciao' })).runId).toMatch(/^run_/);
  });

  it('sends the anti-CSRF headers on state changes', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(new Response(JSON.stringify({ runId: 'r1' }), { status: 200 }));
    });
    try {
      const { httpTransport } = await import('../src/lib/transport.ts');
      const api = new ApiClient(httpTransport('http://127.0.0.1:4747'));
      await api.sendMessage({ text: 'ciao' });
      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers['X-Monsters-Request']).toBe('1');
      expect(headers['Content-Type']).toBe('application/json');
      expect(calls[0]!.init.credentials).toBe('same-origin');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('ApiClient: "Conferma che sei tu" (review of 18/10, M1)', () => {
  const ownerRequired = {
    status: 403,
    body: { error: 'owner_required', message: 'Questa la decidi solo tu' },
  };
  const transportOf = (answer: () => { status: number; body: unknown }, calls: string[]) =>
    ({
      kind: 'mock',
      request: (method: string, path: string) => {
        calls.push(`${method} ${path}`);
        return Promise.resolve(answer());
      },
      connect: () => {
        throw new Error('unused');
      },
    }) satisfies Transport;

  it('asks the password once, then sends the request again', async () => {
    const calls: string[] = [];
    let owner = false;
    const api = new ApiClient(
      transportOf(() => (owner ? { status: 200, body: { ok: true } } : ownerRequired), calls),
    );
    let asked = 0;
    api.confirmOwner = () => {
      asked++;
      owner = true;
      return Promise.resolve(true);
    };
    await api.logout();
    expect(asked).toBe(1);
    expect(calls).toEqual(['POST /api/logout', 'POST /api/logout']);
  });

  it('cancelled: the request fails with the reason, sent only once', async () => {
    const calls: string[] = [];
    const api = new ApiClient(transportOf(() => ownerRequired, calls));
    api.confirmOwner = () => Promise.resolve(false);
    const err: unknown = await api.logout().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('owner_required');
    expect(calls).toHaveLength(1);
  });
});
