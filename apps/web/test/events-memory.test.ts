import { ulid, type EventInput, type LogEvent } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { chatData } from '../src/components/chat/useChats.ts';
import { ingest, resetForTests, useApp } from '../src/store/app.ts';
import { buildTerminal } from '../src/components/terminal/entries.ts';
import {
  appendFolding,
  chatsAfterTrim,
  EVENTS_KEEP,
  EVENTS_SLACK,
  trimEvents,
} from '../src/store/event-cap.ts';
import {
  automationWork,
  buildChat,
  chatThread,
  chatThreads,
  questionsClosedAt,
  runOwners,
  runStatsIndex,
} from '../src/store/derive.ts';
import type { AgentView } from '../src/store/hooks.ts';

/* The event store in a long session (W-25): a synthetic stream of thousands of events. */

let clock = 1_760_000_000_000;
function ev<T extends EventInput>(input: T): LogEvent {
  clock += 250;
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

/** A busy hub: two monsters answering in chunks (one partial every 250 ms), tools between them. */
function stream(n: number, from = 0): LogEvent[] {
  const out: LogEvent[] = [];
  let i = from;
  while (out.length < n) {
    const agent = i % 2 === 0 ? 'titan' : 'iris';
    const runId = `run_${i}`;
    out.push(ev({ agent, runId, type: 'run', data: { status: 'started' } }));
    out.push(
      ev({
        agent: 'user',
        runId,
        type: 'message',
        data: { role: 'user', text: `Question ${i}`, to: agent },
      }),
    );
    for (let k = 0; k < 14; k++)
      out.push(
        ev({
          agent,
          runId,
          type: 'message',
          data: { role: 'agent', text: `word ${k} `, partial: true },
        }),
      );
    out.push(
      ev({
        agent,
        runId,
        type: 'tool_call',
        data: { callId: `call_${i}`, tool: 'vault_read', input: {} },
      }),
    );
    out.push(
      ev({
        agent,
        runId,
        type: 'message',
        data: { role: 'agent', text: 'word '.repeat(14) },
      }),
    );
    out.push(ev({ agent, runId, type: 'run', data: { status: 'completed' } }));
    i++;
  }
  return out.slice(0, n);
}

/** Events that never fold into each other: a tool call of a run of its own. */
function plain(n: number): LogEvent[] {
  return Array.from({ length: n }, (_, i) =>
    ev({
      agent: 'titan',
      runId: `run_${i}`,
      type: 'tool_call',
      data: { callId: `call_${i}`, tool: 'vault_read', input: {} },
    }),
  );
}

const agents = ['titan', 'iris'].map(
  (id) => ({ id, name: id, isOrchestrator: id === 'titan' }) as unknown as AgentView,
);

/** Two monsters writing at once: their chunks alternate, with a tool call in the middle of each. */
function interleaved(): LogEvent[] {
  const out: LogEvent[] = [];
  const chunk = (agent: string, runId: string, text: string) =>
    ev({ agent, runId, type: 'message', data: { role: 'agent', text, partial: true } });
  for (const [agent, runId] of [
    ['titan', 'run_a'],
    ['iris', 'run_b'],
  ] as const)
    out.push(ev({ agent, runId, type: 'run', data: { status: 'started' } }));
  out.push(
    ev({
      agent: 'user',
      runId: 'run_a',
      type: 'message',
      data: { role: 'user', text: 'Hi', to: 'titan' },
    }),
  );
  for (let k = 0; k < 6; k++) {
    out.push(chunk('titan', 'run_a', `a${k} `), chunk('iris', 'run_b', `b${k} `));
    if (k === 2)
      out.push(
        ev({
          agent: 'titan',
          runId: 'run_a',
          type: 'tool_call',
          data: { callId: 'c1', tool: 'vault_read', input: {} },
        }),
      );
  }
  out.push(
    ev({
      agent: 'titan',
      runId: 'run_a',
      type: 'message',
      data: { role: 'agent', text: 'a0 a1 a2 a3 a4 a5 ' },
    }),
    ev({
      agent: 'iris',
      runId: 'run_b',
      type: 'message',
      data: { role: 'agent', text: 'b0 b1 b2 b3 b4 b5 ' },
    }),
    ev({ agent: 'titan', runId: 'run_a', type: 'run', data: { status: 'completed' } }),
    ev({ agent: 'iris', runId: 'run_b', type: 'run', data: { status: 'completed' } }),
  );
  return out;
}

const folded = (events: readonly LogEvent[]) =>
  events.reduce<LogEvent[]>((all, e) => appendFolding(all, [e]), []);

const only = (events: readonly LogEvent[]) => events.map((e) => e.id);

describe('trimEvents', () => {
  const log = stream(60);

  it('leaves a log alone until it is over keep + slack', () => {
    expect(trimEvents(log, 50, () => false, 10)).toBeNull();
    expect(trimEvents(log, 40, () => false, 30)).toBeNull();
  });

  it('keeps the newest, says what left and where the log is complete from', () => {
    const cut = trimEvents(log, 40, () => false, 10)!;
    expect(only(cut.events)).toEqual(only(log.slice(20)));
    expect(only(cut.dropped)).toEqual(only(log.slice(0, 20)));
    expect(cut.floor).toBe(log[20]!.id);
  });

  it('retains what the caller needs (an open question) in its place', () => {
    const keep = log[3]!;
    const cut = trimEvents(log, 40, (e) => e === keep, 10)!;
    expect(only(cut.events)).toEqual([keep.id, ...only(log.slice(20))]);
    expect(cut.dropped).not.toContain(keep);
  });

  it('a chat that had everything now lacks what left; one with older pages keeps its edge', () => {
    const chats = chatsAfterTrim(
      {
        whole: { before: 'A', hasOlder: false, loading: false },
        deep: { before: 'A', hasOlder: true, loading: false },
        near: { before: 'Z', hasOlder: true, loading: true },
      },
      'M',
    );
    expect(chats['whole']).toEqual({ before: 'M', hasOlder: true, loading: false });
    expect(chats['deep']).toEqual({ before: 'M', hasOlder: true, loading: false });
    expect(chats['near']).toEqual({ before: 'Z', hasOlder: true, loading: true });
  });
});

describe('folding the chunks of an answer being written (W-25)', () => {
  const log = interleaved();

  it('keeps one event per stretch of an answer, and the final message after it', () => {
    const f = folded(log);
    const chunks = f.filter((e) => e.type === 'message' && e.data.partial);
    // titan: before and after its tool call; iris: all in one.
    expect(chunks.map((e) => (e as LogEvent<'message'>).data.text)).toEqual([
      'a0 a1 a2 ',
      'b0 b1 b2 b3 b4 b5 ',
      'a3 a4 a5 ',
    ]);
    expect(f.length).toBe(log.length - 6 - 3 + 0);
    // The folded chunk has the id and the time of its first piece.
    expect(chunks[0]!.id).toBe(
      log.find((e) => e.agent === 'titan' && e.type === 'message' && e.data.partial)!.id,
    );
  });

  it('does not fold across an event of the same run, another monster, or a kind of chunk', () => {
    const [start, a, b] = [
      ev({ agent: 'titan', runId: 'r', type: 'run', data: { status: 'started' } }),
      ev({
        agent: 'titan',
        runId: 'r',
        type: 'message',
        data: { role: 'agent', text: 'x', partial: true },
      }),
      ev({
        agent: 'iris',
        runId: 'r',
        type: 'message',
        data: { role: 'agent', text: 'y', partial: true },
      }),
    ];
    // Another monster in the same run, or a chunk of a delegate, is its own draft.
    expect(folded([start, a, b]).length).toBe(3);
    const delegate = ev({
      agent: 'titan',
      runId: 'r',
      parentId: a.id,
      type: 'message',
      data: { role: 'agent', text: 'z', partial: true },
    });
    expect(folded([start, a, delegate]).length).toBe(3);
    // An event outside any run may touch the draft: nothing is folded over it.
    const kill = ev({ agent: 'system', type: 'kill', data: { scope: 'global', by: 'ui' } });
    const again = ev({
      agent: 'titan',
      runId: 'r',
      type: 'message',
      data: { role: 'agent', text: 'w', partial: true },
    });
    expect(folded([start, a, kill, again]).length).toBe(4);
  });

  it('the chat and the terminal are the same built from the folded log', () => {
    const f = folded(log);
    expect(f.length).toBeLessThan(log.length);
    expect(buildChat(f, [])).toEqual(buildChat(log, []));
    for (const agent of ['titan', 'iris'])
      expect(buildTerminal(f, agent)).toEqual(buildTerminal(log, agent));
    const long = stream(2_000);
    expect(buildChat(folded(long), [])).toEqual(buildChat(long, []));
  });
});

describe('the threads of the monsters', () => {
  it('one pass gives the lists chatThread gives, in the same order', () => {
    const items = buildChat(interleaved(), []);
    const owners = runOwners(interleaved());
    const scope = { orchestrator: 'titan', owners };
    const ids = ['titan', 'iris', 'nobody'];
    const all = chatThreads(items, ids, scope);
    for (const id of ids) expect(all.get(id)).toEqual(chatThread(items, id, scope));
  });
});

/** The measuring stream, short for the suite (5,000 on top of 2,000 is the same test with bigger numbers). */
const BASE = 1_000;
const LIVE = 3_000;

describe('the event store in a long session (W-25)', () => {
  afterEach(() => resetForTests());

  it('holds the newest events and says there is more to read', () => {
    const all = plain(EVENTS_KEEP + EVENTS_SLACK + 300);
    ingest(all.slice(0, 1000));
    for (const e of all.slice(1000)) ingest([e]);
    const { events, hasOlder, historyFloor } = useApp.getState();
    expect(events.length).toBeLessThanOrEqual(EVENTS_KEEP + EVENTS_SLACK);
    expect(events.length).toBeGreaterThanOrEqual(EVENTS_KEEP);
    // The newest are there, in order, and the log says from where it is complete.
    expect(events.at(-1)!.id).toBe(all.at(-1)!.id);
    expect(only(events)).toEqual([...only(events)].sort());
    expect(hasOlder).toBe(true);
    expect(historyFloor).toBe(events[0]!.id);
  });

  it('the events that left can be read again (a page of history is not taken for a repeat)', () => {
    const all = plain(EVENTS_KEEP + EVENTS_SLACK + 100);
    for (const e of all) ingest([e]);
    const gone = all[0]!;
    expect(useApp.getState().events.some((e) => e.id === gone.id)).toBe(false);
    ingest(all.slice(0, 50), { history: true });
    expect(useApp.getState().events.some((e) => e.id === gone.id)).toBe(true);
  });

  it('a page the user asked for is not trimmed by the next event', () => {
    const all = plain(EVENTS_KEEP + EVENTS_SLACK + 700);
    const older = all.slice(0, 400);
    ingest(all.slice(400, 400 + EVENTS_KEEP + EVENTS_SLACK - 10));
    ingest(older, { history: true });
    const after = EVENTS_KEEP + EVENTS_SLACK + 390;
    expect(useApp.getState().events.length).toBe(after);
    ingest([all[400 + EVENTS_KEEP + EVENTS_SLACK - 10]!]);
    expect(useApp.getState().events.length).toBe(after + 1);
    expect(useApp.getState().events[0]!.id).toBe(older[0]!.id);
  });

  it('the chats that had their own history get the new floor', () => {
    const all = plain(EVENTS_KEEP + EVENTS_SLACK + 10);
    ingest(all.slice(0, 20));
    useApp.setState({
      chats: { iris: { before: all[0]!.id, hasOlder: false, loading: false } },
    });
    for (const e of all.slice(20)) ingest([e]);
    const s = useApp.getState();
    expect(s.chats['iris']).toEqual({ before: s.events[0]!.id, hasOlder: true, loading: false });
  });

  it('a question still open keeps its event', () => {
    const q = ev({
      agent: 'titan',
      runId: 'run_q',
      type: 'question',
      data: { questionId: 'q1', question: 'Which tone?', options: [], blocking: true },
    });
    const all = plain(EVENTS_KEEP + EVENTS_SLACK + 10);
    ingest([q]);
    for (const e of all) ingest([e]);
    expect(useApp.getState().events.some((e) => e.id === q.id)).toBe(true);
    expect(useApp.getState().questions['q1']?.status).toBe('open');
  });

  /**
   * What the UI recomputes at each event: each derivation over all the events in memory. The same
   * stream is read as the store holds it now (folded chunks, capped) and as it used to be held
   * (every event, for good); CPU time of this process, so a busy machine does not skew it.
   */
  it('a long stream costs a fraction of what it did', { timeout: 120_000 }, () => {
    const cpu = () => {
      const u = process.cpuUsage();
      return (u.user + u.system) / 1000;
    };
    const derive = (events: LogEvent[]) => {
      const state = useApp.getState();
      chatData(events, state.pending, state.questions, agents, 'titan');
      questionsClosedAt(events);
      runStatsIndex(events);
      runOwners(events);
      automationWork(events);
    };
    const all = stream(BASE + LIVE);
    const cpuOf = (run: () => void) => {
      const t = cpu();
      run();
      return cpu() - t;
    };
    // The store as it is now, event by event.
    ingest(all.slice(0, BASE));
    let now = 0;
    let most = 0;
    for (const e of all.slice(BASE)) {
      ingest([e]);
      const events = useApp.getState().events;
      most = Math.max(most, events.length);
      now += cpuOf(() => derive(events));
    }
    // The same stream held as it used to be: every event, for good.
    let old = all.slice(0, BASE);
    let before = 0;
    for (const e of all.slice(BASE)) {
      old = [...old, e];
      before += cpuOf(() => derive(old));
    }
    console.warn(
      `${LIVE} events on top of ${BASE}, derivations at each event: ${before.toFixed(0)} ms before ` +
        `(${old.length} events in memory), ${now.toFixed(0)} ms now (at most ${most})`,
    );
    expect(most).toBeLessThanOrEqual(EVENTS_KEEP + EVENTS_SLACK);
    expect(most).toBeLessThan(old.length / 2);
    expect(now).toBeLessThan(before);
  });
});
