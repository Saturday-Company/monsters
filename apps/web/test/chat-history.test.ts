import {
  ulid,
  type AgentSummary,
  type EventInput,
  type LogEvent,
  type Question,
} from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawResponse, SocketLike, Transport } from '../src/lib/transport.ts';
import {
  ANSWER_UNDO_MS,
  boot,
  CHAT_PAGE,
  chatHistoryOf,
  chooseOption,
  HISTORY_PAGE,
  ingest,
  initApp,
  loadChatOlder,
  loadOlder,
  resetForTests,
  sendMessage,
  startNewConversation,
  undoChoice,
  useApp,
} from '../src/store/app.ts';
import { draftOf, keepHeld, saveDraft, storedHeld, takeHeld } from '../src/store/drafts.ts';

/*
 * The store against the races and gaps of the review of 25/10: a chat's own history (W-1),
 * late REST snapshots (W-2), the local new conversation (W-24), the keypad's undo (V-1), and
 * what is written but not sent yet (W-6, W-7).
 */

let clock = 1_760_000_000_000;
function ev<T extends EventInput>(input: T): LogEvent {
  clock += 1000;
  return {
    id: ulid(clock),
    ts: clock,
    agent: input.agent,
    runId: input.runId ?? null,
    parentId: input.parentId ?? null,
    type: input.type,
    data: input.data,
  } as LogEvent;
}

const titan = (state: AgentSummary['state'], work: string[] = []): AgentSummary => ({
  id: 'titan',
  name: 'Titan',
  role: 'lead',
  color: '#888',
  isOrchestrator: true,
  genome: null,
  state,
  work,
});

const question = (status: Question['status']): Question => ({
  id: 'q1',
  from: 'titan',
  runId: 'run_1',
  question: 'Which tone?',
  options: [
    { id: 'a', label: 'Serious' },
    { id: 'b', label: 'Ironic' },
  ],
  blocking: true,
  status,
  createdAt: 1,
});

/** A fake core: fixed answers, or a function of the path; every request and socket is kept. */
function fakeCore(routes: Record<string, (query: URLSearchParams, body: unknown) => unknown>) {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const sockets: { path: string; socket: SocketLike }[] = [];
  const base: typeof routes = {
    '/api/setup-status': () => ({ needsSetup: false }),
    '/api/me': () => ({ email: 'g@example.com', via: 'session', owner: true }),
    '/api/status': () => ({
      version: '0',
      halted: false,
      haltedAt: null,
      haltedReason: null,
      runs: [],
      uptimeMs: 1,
    }),
    '/api/events': () => ({ events: [] }),
    '/api/questions': () => [],
    '/api/agents': () => [titan('idle')],
  };
  const all = { ...base, ...routes };
  const transport: Transport = {
    kind: 'mock',
    request: async (method, path, body) => {
      requests.push({ method, path, body });
      const [route, query = ''] = path.split('?');
      const answer = all[`${method} ${route}`] ?? all[route!];
      if (!answer) return { status: 404, body: { error: 'not_found' } };
      const out = await answer(new URLSearchParams(query), body);
      return (out as RawResponse | undefined)?.status !== undefined &&
        (out as RawResponse).body !== undefined
        ? (out as RawResponse)
        : { status: 200, body: out };
    },
    connect: (path) => {
      const socket: SocketLike = {
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        close: () => {},
      };
      sockets.push({ path, socket });
      return socket;
    },
  };
  const send = (msg: unknown) => sockets.at(-1)!.socket.onmessage?.({ data: JSON.stringify(msg) });
  return { transport, requests, sockets, send };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('a late snapshot never takes back what the stream said (W-2)', () => {
  afterEach(() => resetForTests());

  it('a run that ended on the stream while /api/agents was on its way stays ended', async () => {
    let release: (() => void) | null = null;
    let calls = 0;
    const core = fakeCore({
      '/api/agents': () => {
        calls++;
        if (calls === 1) return [titan('idle')];
        // The snapshot the core took while the run was still going, delivered late.
        return new Promise((res) => {
          release = () => res([titan('working', ['run:run_1'])]);
        });
      },
    });
    initApp(core.transport);
    await boot();
    core.sockets[0]!.socket.onopen?.();
    const start = ev({ agent: 'titan', runId: 'run_1', type: 'run', data: { status: 'started' } });
    core.send({ kind: 'event', event: start });
    expect(useApp.getState().live['titan']?.mood).toBe('working');
    // A reconnection: the snapshot is asked for; the run ends meanwhile.
    core.send({ kind: 'hello', halted: false });
    const end = ev({ agent: 'titan', runId: 'run_1', type: 'run', data: { status: 'completed' } });
    core.send({ kind: 'event', event: end });
    expect(useApp.getState().live['titan']?.mood).toBe('done');
    release!();
    await vi.waitFor(() => expect(calls).toBe(2));
    await tick();
    expect(useApp.getState().live['titan']?.mood).toBe('done');
    expect(useApp.getState().live['titan']?.work).toBeUndefined();
  });

  it('a late list of questions never opens again one just answered, nor unpauses it', async () => {
    let release: (() => void) | null = null;
    let calls = 0;
    const core = fakeCore({
      '/api/questions': () => {
        calls++;
        if (calls === 1) return [{ ...question('open'), parked: true }];
        return new Promise((res) => {
          release = () => res([question('open')]);
        });
      },
    });
    initApp(core.transport);
    await boot();
    expect(useApp.getState().questions['q1']).toMatchObject({ status: 'open', parked: true });
    core.sockets[0]!.socket.onopen?.();
    core.send({ kind: 'hello', halted: false });
    release!();
    await vi.waitFor(() => expect(calls).toBe(2));
    await tick();
    // The snapshot is older than the pause: it stays.
    expect(useApp.getState().questions['q1']).toMatchObject({ status: 'open', parked: true });
    // Answered on Telegram; a late snapshot that still has it open changes nothing.
    ingest([ev({ agent: 'user', runId: 'run_1', type: 'answer', data: { questionId: 'q1' } })]);
    core.send({ kind: 'hello', halted: false });
    release!();
    await vi.waitFor(() => expect(calls).toBe(3));
    release!();
    await tick();
    expect(useApp.getState().questions['q1']?.status).toBe('answered');
  });

  it('at boot the snapshot is asked once the history page is in, so it is never older', async () => {
    const order: string[] = [];
    const core = fakeCore({
      '/api/events': () => {
        order.push('events');
        return { events: [] };
      },
      '/api/agents': () => {
        order.push('agents');
        return [titan('idle')];
      },
    });
    initApp(core.transport);
    await boot();
    expect(order).toEqual(['events', 'agents']);
  });
});

describe('a new conversation added ahead of the stream (W-24)', () => {
  afterEach(() => resetForTests());

  it('moves neither the live state nor the cursor until the stream’s copy comes', async () => {
    const start = ev({ agent: 'titan', runId: 'run_1', type: 'run', data: { status: 'started' } });
    // The run end was logged before the new conversation, and is still on its way.
    const end = ev({ agent: 'titan', runId: 'run_1', type: 'run', data: { status: 'completed' } });
    const later = ev({ agent: 'user', type: 'new_conversation', data: { channel: 'ui' } });
    const core = fakeCore({
      'POST /api/conversations': () => ({ id: later.id, ts: later.ts }),
    });
    initApp(core.transport);
    await boot();
    core.sockets[0]!.socket.onopen?.();
    core.send({ kind: 'event', event: start });
    await startNewConversation();
    expect(useApp.getState().events.at(-1)?.id).toBe(later.id);
    expect(useApp.getState().liveAt).toBe(start.id);
    core.send({ kind: 'event', event: end });
    expect(useApp.getState().live['titan']?.mood).toBe('done');
    // A reconnection now asks for what came after the run end, not after the local event.
    core.sockets[0]!.socket.onclose?.({ code: 1006, reason: '' });
    await vi.waitFor(() => expect(core.sockets.length).toBe(2), { timeout: 3000 });
    expect(core.sockets[1]!.path).toContain(`after=${end.id}`);
    // The stream's copy: now it counts, once.
    core.send({ kind: 'event', event: later });
    expect(useApp.getState().liveAt).toBe(later.id);
    expect(useApp.getState().events.filter((e) => e.id === later.id)).toHaveLength(1);
  });
});

describe('each chat loads its own history (W-1)', () => {
  beforeEach(() => resetForTests());
  afterEach(() => resetForTests());

  it('asks for its monster’s events before the hub’s pages, with what the others bring there', async () => {
    // The hub's first page is full: a long job of Enceladus.
    const noise = Array.from({ length: HISTORY_PAGE }, () =>
      ev({
        agent: 'enceladus',
        runId: 'run_n',
        type: 'tool_call',
        data: { callId: 'c', tool: 'vault_list', input: {} },
      }),
    ).reverse();
    const floor = noise.at(-1)!.id;
    const asked = ev({
      agent: 'user',
      runId: 'run_d',
      type: 'message',
      data: { role: 'user', text: 'A bio, please', to: 'dione' },
    });
    const answer = ev({
      agent: 'dione',
      runId: 'run_d',
      type: 'message',
      data: { role: 'agent', text: 'Here it is' },
    });
    // Older than the noise: put them before it.
    for (const e of [asked, answer]) {
      e.id = ulid(e.ts - 10_000_000);
    }
    const core = fakeCore({
      '/api/events': (q) => {
        if (!q.get('agent') && !q.get('type')) return { events: q.get('before') ? [] : noise };
        if (q.get('agent') === 'dione') return { events: [answer] };
        if (q.get('agent') === 'user') return { events: [asked] };
        return { events: [answer] };
      },
    });
    initApp(core.transport);
    await boot();
    expect(useApp.getState()).toMatchObject({ hasOlder: true, historyFloor: floor });
    expect(chatHistoryOf(useApp.getState(), 'dione')).toMatchObject({
      before: floor,
      hasOlder: true,
    });

    core.requests.length = 0;
    await Promise.all([loadChatOlder('dione'), loadChatOlder('dione')]);
    const paths = core.requests.map((r) => decodeURIComponent(r.path));
    // One load at a time; its three pages all end at the hub's floor.
    expect(paths).toHaveLength(3);
    expect(paths[0]).toContain('agent=dione');
    expect(paths[0]).toContain(`limit=${CHAT_PAGE}`);
    for (const p of paths) expect(p).toContain(`before=${floor}`);
    expect(paths.some((p) => p.includes('type=run,delegation,question'))).toBe(true);
    expect(paths.some((p) => p.includes('agent=user') && p.includes('type=message'))).toBe(true);
    // Short pages: the chat is complete; the same event in two pages is there once.
    const ids = useApp.getState().events.map((e) => e.id);
    expect(ids.filter((id) => id === answer.id)).toHaveLength(1);
    expect(ids).toContain(asked.id);
    expect(chatHistoryOf(useApp.getState(), 'dione')).toMatchObject({ hasOlder: false });
    // Not news for the live state: Dione does not look done.
    expect(useApp.getState().live['dione']).toBeUndefined();

    // "Load older" of Activity starts from the hub's floor, not from Dione's older events.
    core.requests.length = 0;
    await loadOlder();
    expect(decodeURIComponent(core.requests[0]!.path)).toContain(`before=${floor}`);
  });

  it('a full page leaves the chat open below its oldest edge', async () => {
    const own = Array.from({ length: CHAT_PAGE }, () =>
      ev({ agent: 'dione', runId: 'r', type: 'message', data: { role: 'agent', text: 'x' } }),
    ).reverse();
    const core = fakeCore({
      '/api/events': (q) => {
        if (!q.get('agent') && !q.get('type'))
          return {
            events: Array.from({ length: HISTORY_PAGE }, () =>
              ev({ agent: 'system', type: 'resume', data: { by: 'ui' } }),
            ).reverse(),
          };
        if (q.get('agent') === 'dione')
          return { events: q.get('before') === own.at(-1)!.id ? [] : own };
        return { events: [] };
      },
    });
    initApp(core.transport);
    await boot();
    core.requests.length = 0;
    await loadChatOlder('dione');
    // The others' pages cover the same span as the cut one: down to its edge, no further.
    const first = core.requests.map((r) => decodeURIComponent(r.path));
    expect(first.slice(1).every((p) => p.includes(`after=${own.at(-1)!.id}`))).toBe(true);
    expect(chatHistoryOf(useApp.getState(), 'dione')).toMatchObject({
      before: own.at(-1)!.id,
      hasOlder: true,
      loading: false,
    });
    core.requests.length = 0;
    await loadChatOlder('dione');
    const next = core.requests.map((r) => decodeURIComponent(r.path));
    expect(next[0]).toContain(`before=${own.at(-1)!.id}`);
    expect(next[1]).not.toContain('after=');
    expect(chatHistoryOf(useApp.getState(), 'dione').hasOlder).toBe(false);
  });
});

describe('an option picked with the keyboard waits a moment (V-1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    resetForTests();
  });

  it('leaves after the undo window, unless undone', async () => {
    const answers: unknown[] = [];
    const core = fakeCore({
      'POST /api/questions/q1/answer': (_q, body) => {
        answers.push(body);
        return { ...question('answered'), answer: { optionId: 'b' } };
      },
    });
    initApp(core.transport);
    useApp.setState({ questions: { q1: question('open') } });
    chooseOption('q1', 'b');
    expect(useApp.getState().choices).toEqual({ q1: 'b' });
    await vi.advanceTimersByTimeAsync(ANSWER_UNDO_MS - 100);
    expect(undoChoice('q1')).toBe(true);
    expect(useApp.getState().choices).toEqual({});
    await vi.advanceTimersByTimeAsync(ANSWER_UNDO_MS);
    expect(answers).toEqual([]);

    chooseOption('q1', 'a');
    await vi.advanceTimersByTimeAsync(ANSWER_UNDO_MS + 10);
    expect(answers).toEqual([{ optionId: 'a' }]);
    expect(useApp.getState().questions['q1']?.status).toBe('answered');
    expect(useApp.getState().choices).toEqual({});
    expect(undoChoice('q1')).toBe(false);
  });

  it('does not send for a question answered elsewhere meanwhile', async () => {
    const answers: unknown[] = [];
    const core = fakeCore({
      'POST /api/questions/q1/answer': (_q, body) => {
        answers.push(body);
        return question('answered');
      },
    });
    initApp(core.transport);
    useApp.setState({ questions: { q1: question('open') } });
    chooseOption('q1', 'a');
    useApp.setState({ questions: { q1: question('answered') } });
    await vi.advanceTimersByTimeAsync(ANSWER_UNDO_MS + 10);
    expect(answers).toEqual([]);
    expect(useApp.getState().choices).toEqual({});
  });
});

describe('what is written and not sent yet (W-6, W-7)', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetForTests();
  });

  it('keeps a draft per account and per chat, and forgets it once empty', () => {
    saveDraft('g@example.com', 'dione', 'Half a thought');
    saveDraft('g@example.com', 'rhea', 'Another');
    saveDraft('other@example.com', 'dione', 'Not mine');
    expect(draftOf('g@example.com', 'dione')).toBe('Half a thought');
    expect(draftOf('g@example.com', 'rhea')).toBe('Another');
    saveDraft('g@example.com', 'dione', '   ');
    expect(draftOf('g@example.com', 'dione')).toBe('');
    expect(draftOf('other@example.com', 'dione')).toBe('Not mine');
    expect(draftOf(null, 'dione')).toBe('');
  });

  it('says which held messages another tab already took', () => {
    const p = { tempId: 'pending-1', text: 'later', ts: 1, held: true };
    expect(keepHeld('g@example.com', p)).toBe(true);
    expect(keepHeld('g@example.com', { ...p, tempId: 'pending-2' })).toBe(true);
    expect(storedHeld('g@example.com').map((h) => h.tempId)).toEqual(['pending-1', 'pending-2']);
    expect([...takeHeld('g@example.com', ['pending-1'])]).toEqual([]);
    // Taken already: gone.
    expect([...takeHeld('g@example.com', ['pending-1', 'pending-2'])]).toEqual(['pending-1']);
    expect(storedHeld('g@example.com')).toEqual([]);
  });

  it('a message held while stopped survives a reload, and goes once resumed', async () => {
    const sent: unknown[] = [];
    let halted = true;
    const core = fakeCore({
      '/api/status': () => ({
        version: '0',
        halted,
        haltedAt: null,
        haltedReason: null,
        runs: [],
        uptimeMs: 1,
      }),
      'POST /api/messages': (_q, body) => {
        sent.push(body);
        return { runId: 'r1' };
      },
    });
    initApp(core.transport);
    await boot();
    expect(useApp.getState().halted).toBe(true);
    await sendMessage('when you are back', 'dione');
    expect(sent).toEqual([]);
    expect(storedHeld('g@example.com').map((h) => h.text)).toEqual(['when you are back']);

    // The page reloads: a new store, still stopped. The message is back, held.
    resetForTests();
    initApp(core.transport);
    await boot();
    expect(useApp.getState().pending.map((p) => [p.text, p.held])).toEqual([
      ['when you are back', true],
    ]);
    // Resumed while the app was closed: on the next start it goes, once.
    resetForTests();
    halted = false;
    initApp(core.transport);
    await boot();
    await vi.waitFor(() => expect(sent).toEqual([{ text: 'when you are back', to: 'dione' }]));
    expect(storedHeld('g@example.com')).toEqual([]);
  });
});
