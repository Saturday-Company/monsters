import {
  setAppLang,
  ulid,
  type AgentSummary,
  type EventInput,
  type LogEvent,
  type Question,
} from '@monsters/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocketLike, Transport } from '../src/lib/transport.ts';
import {
  boot,
  dismissUndoConflict,
  dropHeld,
  ingest,
  initApp,
  loadOlder,
  resetForTests,
  sendMessage,
  undoAction,
  useApp,
} from '../src/store/app.ts';
import { buildChat, chatThread, runOwners, undoConflictText } from '../src/store/derive.ts';

// The Italian copy is pinned in this file; the English one is in log-strings.test.ts.
beforeAll(() => setAppLang('it'));
afterAll(() => setAppLang('en'));

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

describe('store: events from the core', () => {
  beforeEach(() => resetForTests());

  it('closes a question when the core says it expired', () => {
    const asked = ev({
      agent: 'titan',
      runId: 'run1',
      type: 'question',
      data: {
        questionId: 'q1',
        question: 'Che tono?',
        options: [
          { id: '1', label: 'Serio' },
          { id: '2', label: 'Ironico' },
        ],
        blocking: true,
      },
    });
    ingest([asked]);
    expect(useApp.getState().questions['q1']?.status).toBe('open');
    ingest([
      ev({
        agent: 'titan',
        runId: 'run1',
        parentId: asked.id,
        type: 'question_expired',
        data: { questionId: 'q1', reason: 'kill' },
      }),
    ]);
    expect(useApp.getState().questions['q1']?.status).toBe('expired');
  });

  it('a service whose sign-in died is a toast with "Collega" (connettori 1)', () => {
    const message =
      'Notion chiede di nuovo l’accesso: premi «Collega» in Impostazioni → Collegamenti.';
    ingest([
      {
        ...ev({
          agent: 'system',
          type: 'mcp_server',
          data: { server: 'notion', action: 'needs_signin', transport: 'http', message },
        }),
        ts: Date.now(),
      },
    ]);
    const notice = useApp.getState().notice;
    expect(notice).toMatchObject({ text: message, tone: 'error' });
    expect(notice?.action?.label).toBe('Collega');
  });

  it('marks an action as undone from the undo event (also after a reload)', () => {
    ingest([
      ev({
        agent: 'rhea',
        type: 'vault_change',
        data: { action: 'create', path: 'Inbox/Idee.md', actionId: 'act1', commit: 'aaa' },
      }),
      ev({
        agent: 'user',
        type: 'vault_change',
        data: { action: 'undo', path: 'Inbox/Idee.md', commit: 'bbb', undoneActionId: 'act1' },
      }),
    ]);
    expect(useApp.getState().undone).toEqual({ act1: 'bbb' });
  });
});

describe('store: the first answer after the onboarding', () => {
  beforeEach(() => resetForTests());

  // The events the core writes for "ciao" right after the onboarding (e2e-core
  // onboarding test): the welcome, the turn, its draft and its final answer, with
  // the extra step of the stop hook in between.
  const flow = () => {
    const welcome = ev({
      agent: 'atlas',
      type: 'message',
      data: { role: 'agent', text: 'Ciao Giulio! Sono Atlas. Con me ci sono Rhea e Calendario.' },
    });
    const turn = [
      ev({
        agent: 'user',
        runId: 'r1',
        type: 'message',
        data: { role: 'user', text: 'ciao', to: 'atlas', channel: 'ui' },
      }),
      ev({ agent: 'atlas', runId: 'r1', type: 'run', data: { status: 'started', goal: 'ciao' } }),
      ev({
        agent: 'atlas',
        runId: 'r1',
        type: 'message',
        data: { role: 'agent', text: 'Ciao Giulio! Ci sono, ', partial: true },
      }),
      ev({
        agent: 'atlas',
        runId: 'r1',
        type: 'message',
        data: { role: 'agent', text: 'dimmi pure.', partial: true },
      }),
      ev({
        agent: 'atlas',
        runId: 'r1',
        type: 'message',
        data: { role: 'system', text: 'Promemoria' },
      }),
      ev({
        agent: 'atlas',
        runId: 'r1',
        type: 'message',
        data: { role: 'agent', text: 'Ciao Giulio! Ci sono, dimmi pure.' },
      }),
      ev({ agent: 'atlas', runId: 'r1', type: 'run', data: { status: 'completed' } }),
    ];
    return { welcome, turn };
  };
  const atlasBubbles = () => {
    const { events, pending } = useApp.getState();
    const scope = { orchestrator: 'atlas', owners: runOwners(events) };
    return chatThread(buildChat(events, pending), 'atlas', scope)
      .filter((i) => i.kind === 'agent')
      .map((i) => ({ text: i.text, streaming: i.streaming }));
  };
  const closed = [
    { text: 'Ciao Giulio! Sono Atlas. Con me ci sono Rhea e Calendario.', streaming: false },
    { text: 'Ciao Giulio! Ci sono, dimmi pure.', streaming: false },
  ];

  it('shows the welcome and one closed answer, the draft streaming only until the end', () => {
    const { welcome, turn } = flow();
    ingest([welcome]);
    for (const e of turn.slice(0, 4)) ingest([e]);
    expect(atlasBubbles()).toEqual([
      closed[0],
      { text: 'Ciao Giulio! Ci sono, dimmi pure.', streaming: true },
    ]);
    for (const e of turn.slice(4)) ingest([e]);
    expect(atlasBubbles()).toEqual(closed);
  });

  it('keeps one answer when the stream replays, duplicates and reorders the events', () => {
    const { welcome, turn } = flow();
    // Live events first, then the history page and a replay after a reconnection.
    ingest([turn[5]!, turn[3]!]);
    ingest([welcome, ...turn.slice(0, 4)]);
    ingest([...turn].reverse());
    ingest([turn[2]!, turn[3]!]);
    expect(atlasBubbles()).toEqual(closed);
    expect(useApp.getState().events).toHaveLength(turn.length + 1);
  });
});

describe('store: reconnection', () => {
  afterEach(() => resetForTests());

  it('reloads agents and questions at every hello (e.g. after the core restarted)', async () => {
    const titan = (state: AgentSummary['state']): AgentSummary => ({
      id: 'titan',
      name: 'Titan',
      role: 'orchestratore',
      color: '#888',
      isOrchestrator: true,
      genome: null,
      state,
    });
    const question = (status: Question['status']): Question => ({
      id: 'q1',
      from: 'titan',
      runId: 'run1',
      question: 'Che tono?',
      options: [
        { id: '1', label: 'Serio' },
        { id: '2', label: 'Ironico' },
      ],
      blocking: true,
      status,
      createdAt: 1,
    });
    let core = { agents: [titan('working')], questions: [question('open')] };
    const sockets: SocketLike[] = [];
    const answers: Record<string, () => unknown> = {
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
      '/api/agents': () => core.agents,
      '/api/questions': () => core.questions,
    };
    const transport: Transport = {
      kind: 'mock',
      request: (_method, path) => {
        const route = path.split('?')[0]!;
        if (route === '/api/events') return Promise.resolve({ status: 200, body: { events: [] } });
        const answer = answers[route];
        return Promise.resolve(
          answer ? { status: 200, body: answer() } : { status: 404, body: { error: 'not_found' } },
        );
      },
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
    initApp(transport);
    await boot();
    expect(useApp.getState().phase).toBe('ready');
    expect(useApp.getState().live['titan']?.mood).toBe('working');
    expect(useApp.getState().questions['q1']?.status).toBe('open');

    // The core crashed and came back: its runs and questions are closed.
    core = { agents: [titan('idle')], questions: [question('expired')] };
    sockets[0]!.onopen?.();
    sockets[0]!.onmessage?.({ data: JSON.stringify({ kind: 'hello', halted: false }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(useApp.getState().live['titan']?.mood).toBe('idle');
    expect(useApp.getState().questions['q1']?.status).toBe('expired');

    // The confused face is in the snapshot of the core (D-072), with its start.
    core = { agents: [{ ...titan('working'), confusedSince: 1234 }], questions: [] };
    sockets[0]!.onmessage?.({ data: JSON.stringify({ kind: 'hello', halted: false }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(useApp.getState().live['titan']).toMatchObject({
      mood: 'working',
      confused: true,
      since: 1234,
    });
    core = { agents: [titan('working')], questions: [] };
    sockets[0]!.onmessage?.({ data: JSON.stringify({ kind: 'hello', halted: false }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(useApp.getState().live['titan']?.confused).toBeUndefined();
  });
});

describe('store: what the monsters are doing now (D-157)', () => {
  afterEach(() => resetForTests());

  it('older history, other monsters’ answers and late events never make a monster look at work', async () => {
    const agent = (id: string, state: AgentSummary['state'], work: string[]): AgentSummary => ({
      id,
      name: id,
      role: 'r',
      color: '#888',
      isOrchestrator: id === 'titan',
      genome: null,
      state,
      work,
    });
    const question = (id: string, from: string, runId: string): Question => ({
      id,
      from,
      runId,
      question: '?',
      options: [],
      blocking: true,
      status: 'open',
      createdAt: 1,
    });
    // Titan waits for an answer in his run; Rhea waits for hers with no run (parked).
    const core = {
      agents: [agent('titan', 'waiting', ['run:r1']), agent('rhea', 'waiting', [])],
      questions: [question('q1', 'titan', 'r1'), { ...question('q2', 'rhea', 'r0'), parked: true }],
    };
    // The page before the history: Rhea's run cut at the page's edge (its end is in a newer page).
    const older = [
      ev({ agent: 'rhea', runId: 'r0', type: 'run', data: { status: 'started', goal: 'x' } }),
      ev({
        agent: 'rhea',
        runId: 'r0',
        type: 'tool_call',
        data: { callId: 'c', tool: 'web_search', input: { query: 'x' } },
      }),
    ];
    const history = [
      ev({ agent: 'rhea', runId: 'r0', type: 'run', data: { status: 'waiting_user' } }),
    ];
    const transport: Transport = {
      kind: 'mock',
      request: (_method, path) => {
        const [route, query = ''] = path.split('?');
        const body =
          route === '/api/events'
            ? { events: query.includes('before') ? older : history }
            : route === '/api/setup-status'
              ? { needsSetup: false }
              : route === '/api/me'
                ? { email: 'g@example.com', via: 'session', owner: true }
                : route === '/api/status'
                  ? {
                      version: '0',
                      halted: false,
                      haltedAt: null,
                      haltedReason: null,
                      runs: [],
                      uptimeMs: 1,
                    }
                  : route === '/api/agents'
                    ? core.agents
                    : route === '/api/questions'
                      ? core.questions
                      : null;
        return Promise.resolve(
          body ? { status: 200, body } : { status: 404, body: { error: 'not_found' } },
        );
      },
      connect: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close() {} }),
    };
    initApp(transport);
    await boot();
    expect(useApp.getState().phase).toBe('ready');
    const mood = (id: string) => useApp.getState().live[id]?.mood;
    expect([mood('titan'), mood('rhea')]).toEqual(['waiting', 'waiting']);

    // Scrolling up the chat loads the older page: it is history, not what Rhea does now.
    await loadOlder();
    expect(useApp.getState().events.length).toBe(3);
    expect(mood('rhea')).toBe('waiting');

    // Titan's answer moves Titan on, not Rhea, who still waits for hers.
    ingest([ev({ agent: 'user', runId: 'r1', type: 'answer', data: { questionId: 'q1' } })]);
    expect([mood('titan'), mood('rhea')]).toEqual(['working', 'waiting']);

    // Titan's run ends; a tool call logged late for it is not work.
    ingest([ev({ agent: 'titan', runId: 'r1', type: 'run', data: { status: 'completed' } })]);
    ingest([
      ev({
        agent: 'titan',
        runId: 'r1',
        type: 'tool_call',
        data: { callId: 'late', tool: 'vault_list', input: {} },
      }),
    ]);
    expect(mood('titan')).toBe('done');
  });
});

describe('store: undo of a note changed afterwards', () => {
  afterEach(() => resetForTests());

  it('keeps the conflict with its files, then undoes anyway with force', async () => {
    const bodies: unknown[] = [];
    const transport: Transport = {
      kind: 'mock',
      request: (_method, path, body) => {
        if (path !== '/api/vault/undo') return Promise.reject(new Error(`unexpected ${path}`));
        bodies.push(body);
        const forced = (body as { force?: boolean }).force === true;
        return Promise.resolve(
          forced
            ? { status: 200, body: { ok: true, commit: 'ccc', files: ['Inbox/Idee.md'] } }
            : {
                status: 409,
                body: {
                  error: 'conflict',
                  message: 'changed after the action: Inbox/Idee.md',
                  files: ['Inbox/Idee.md'],
                },
              },
        );
      },
      connect: () => {
        throw new Error('unused');
      },
    };
    initApp(transport);
    await undoAction('act1');
    expect(useApp.getState().undoConflicts).toEqual({ act1: ['Inbox/Idee.md'] });
    expect(useApp.getState().undone).toEqual({});
    expect(useApp.getState().notice).toBeNull();

    dismissUndoConflict('act1');
    expect(useApp.getState().undoConflicts).toEqual({});
    await undoAction('act1');
    await undoAction('act1', true);
    expect(bodies.at(-1)).toEqual({ actionId: 'act1', force: true });
    expect(useApp.getState().undone).toEqual({ act1: 'ccc' });
    expect(useApp.getState().undoConflicts).toEqual({});
  });

  it('holds the messages written while the monsters are stopped, and sends them on resume', async () => {
    const sent: unknown[] = [];
    const transport: Transport = {
      kind: 'mock',
      request: (_method, path, body) => {
        if (path !== '/api/messages') return Promise.reject(new Error(`unexpected ${path}`));
        sent.push(body);
        return Promise.resolve({ status: 200, body: { runId: 'r1' } });
      },
      connect: () => {
        throw new Error('unused');
      },
    };
    initApp(transport);
    useApp.setState({ phase: 'ready', halted: true });
    await sendMessage('prima');
    await sendMessage('seconda', 'rhea');
    expect(sent).toEqual([]);
    expect(useApp.getState().pending.map((p) => [p.text, p.held])).toEqual([
      ['prima', true],
      ['seconda', true],
    ]);
    dropHeld(useApp.getState().pending[0]!.tempId);
    ingest([ev({ agent: 'user', type: 'resume', data: { by: 'ui' } })]);
    await vi.waitFor(() => expect(sent).toEqual([{ text: 'seconda', to: 'rhea' }]));
    expect(useApp.getState().pending.some((p) => p.held)).toBe(false);
  });

  it('explains in one sentence what changed', () => {
    expect(undoConflictText(['Inbox/Idee.md'])).toBe(
      '“Idee” è cambiata dopo questa modifica: annullandola perdi anche quei cambiamenti.',
    );
    expect(undoConflictText(['a.md', 'b/c.md'])).toMatch(/^“a”, “c” sono cambiate dopo/);
  });
});
