import {
  setAppLang,
  ulid,
  type EventInput,
  type LogEvent,
  type ReceiptData,
} from '@monsters/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  automationWork,
  buildChat,
  chatThread,
  costText,
  grewFrom,
  questionsClosedAt,
  runOwners,
  runStatsIndex,
  type ChatItem,
} from '../src/store/derive.ts';
import { appendFolding } from '../src/store/event-cap.ts';
import {
  buildTurns,
  doneStepText,
  keepStable,
  keepStableBlocks,
  roughDuration,
  runStepsIndex,
  sameValue,
  stableBlocks,
  turnCost,
  turnEnd,
  turnNow,
  turnSentence,
  type Turn,
} from '../src/store/turn.ts';

/* The turn of a chat (store/turn.ts, docs/design.md "The chat"): the request, the replies, the strip. */

beforeAll(() => setAppLang('en'));
afterAll(() => setAppLang('en'));

let clock = 1_770_000_000_000;
function ev<T extends EventInput>(input: T, after = 1000): LogEvent {
  clock += after;
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

const names: Record<string, string> = { titan: 'Titan', rhea: 'Rhea', dione: 'Dione' };
const nameOf = (id: string) => names[id] ?? id;
const scope = (events: readonly LogEvent[]) => ({
  orchestrator: 'titan',
  owners: runOwners(events),
});

function receipt(over: Partial<ReceiptData> = {}): ReceiptData {
  return {
    request: 'Plan the weekend',
    agent: 'titan',
    status: 'completed',
    delegations: [],
    notes: [
      { path: 'Lisbon tips.md', action: 'create', agent: 'rhea', actionId: 'a1' },
      { path: 'Posts.md', action: 'create', agent: 'dione', actionId: 'a2' },
    ],
    externalTools: [],
    outbound: [],
    alerts: { stuck: 0, injections: 0 },
    usage: {
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      modelCalls: 5,
      instinctCostUsd: 0,
      instinctCalls: 0,
    },
    startedAt: 0,
    durationMs: 64_000,
    undoable: true,
    ...over,
  };
}

/** A Titan turn: request, a word before the tools, two tasks, a search, a file, the reply, a receipt. */
function weekend(): LogEvent[] {
  const r = 'r1';
  return [
    ev({
      agent: 'user',
      runId: r,
      type: 'message',
      data: { role: 'user', text: 'Plan the weekend', to: 'titan' },
    }),
    ev({ agent: 'titan', runId: r, type: 'run', data: { status: 'started' } }),
    ev({
      agent: 'titan',
      runId: r,
      type: 'message',
      data: { role: 'agent', text: 'On it.', partial: true },
    }),
    ev({
      agent: 'titan',
      runId: r,
      type: 'tool_call',
      data: { callId: 'c1', tool: 'delegate', input: { to: 'rhea' } },
    }),
    ev({
      agent: 'titan',
      runId: r,
      type: 'delegation',
      data: { from: 'titan', to: 'rhea', status: 'started', goal: 'Find tips' },
    }),
    ev({
      agent: 'rhea',
      runId: r,
      type: 'tool_call',
      data: { callId: 'c2', tool: 'web_search', input: { query: 'tram 28' } },
    }),
    ev({
      agent: 'rhea',
      runId: r,
      type: 'file',
      data: {
        action: 'created',
        id: 'f1',
        name: 'shot.png',
        kind: 'image',
        mime: 'image/png',
        size: 10,
      },
    } as unknown as EventInput),
    ev({
      agent: 'titan',
      runId: r,
      type: 'delegation',
      data: {
        from: 'titan',
        to: 'rhea',
        status: 'completed',
        goal: 'Find tips',
        summary: '5 tips',
      },
    }),
    ev({
      agent: 'titan',
      runId: r,
      type: 'delegation',
      data: { from: 'titan', to: 'dione', status: 'started', goal: 'Write posts' },
    }),
    ev({
      agent: 'titan',
      runId: r,
      type: 'delegation',
      data: { from: 'titan', to: 'dione', status: 'completed', goal: 'Write posts' },
    }),
    ev({
      agent: 'titan',
      runId: r,
      type: 'message',
      data: { role: 'agent', text: 'On it.\n\nAll done!' },
    }),
    ev({
      agent: 'titan',
      runId: r,
      type: 'provider_usage',
      data: { provider: 'openrouter', model: 'x/y:free' },
    }),
    ev({ agent: 'titan', runId: r, type: 'run', data: { status: 'completed' } }, 60_000),
    ev({ agent: 'titan', runId: r, type: 'receipt', data: receipt() }),
  ];
}

function titanTurns(events: LogEvent[], items?: ChatItem[]) {
  const all = items ?? buildChat(events, [], nameOf);
  const thread = chatThread(all, 'titan', scope(events));
  return buildTurns(thread, 'titan', {
    stats: runStatsIndex(events),
    steps: runStepsIndex(events),
  });
}

describe('buildTurns', () => {
  it('gathers a run into one turn: request, replies, tasks, files in the reply, receipt', () => {
    const blocks = titanTurns(weekend());
    expect(blocks).toHaveLength(1);
    const turn = blocks[0] as Turn;
    expect(turn.kind).toBe('turn');
    expect(turn.request).toMatchObject({ kind: 'user', text: 'Plan the weekend' });
    expect(turn.column.map((c) => c.kind)).toEqual(['agent', 'agent']);
    expect(turn.lastBubble).toBe(turn.column[1]!.id);
    expect(turn.tasks.map((t) => [t.to, t.status])).toEqual([
      ['rhea', 'completed'],
      ['dione', 'completed'],
    ]);
    expect(turn.attachments.map((a) => a.kind)).toEqual(['file']);
    expect(turn.receipt?.data.request).toBe('Plan the weekend');
    expect(turn.steps.map((s) => s.tool)).toEqual(['delegate', 'web_search']);
    expect(turnEnd(turn)).toBe('done');
  });

  it('says the closed strip in one sentence, the model only when asked', () => {
    const turn = titanTurns(weekend())[0] as Turn;
    const cost = turnCost(turn, costText);
    expect(turnSentence(turn, { nameOf, cost })).toBe(
      'Worked 1 min · asked Rhea and Dione · 2 notes · free',
    );
    expect(turnSentence(turn, { nameOf, cost, undone: true, model: 'Hard → Opus' })).toBe(
      'Worked 1 min · asked Rhea and Dione · 2 notes · job undone · free · Hard → Opus',
    );
    setAppLang('it');
    try {
      expect(turnSentence(turn, { nameOf, cost: turnCost(turn, costText) })).toBe(
        '1 min di lavoro · chiesto a Rhea e Dione · 2 note · gratis',
      );
    } finally {
      setAppLang('en');
    }
  });

  it('keeps on their own what belongs to no run: stops, reports, carried questions', () => {
    const events = [
      ev({ agent: 'user', type: 'kill', data: { scope: 'global' } } as unknown as EventInput),
      ...weekend(),
      ev({
        agent: 'iapetus',
        runId: 'r9',
        type: 'project_report',
        data: { lead: 'iapetus', to: 'titan', project: 'p1', status: 'completed', summary: 'Done' },
      } as unknown as EventInput),
      ev({
        agent: 'titan',
        runId: 'r2',
        type: 'question',
        data: { questionId: 'q1', question: 'Tone?', options: [] },
      } as unknown as EventInput),
    ];
    const items = buildChat(events, [], nameOf);
    const thread = chatThread(items, 'titan', scope(events));
    const q = thread.find((i) => i.kind === 'question')!;
    const blocks = buildTurns(thread, 'titan', { carried: new Set([q.id]) });
    expect(blocks.map((b) => (b.kind === 'turn' ? 'turn' : b.item.kind))).toEqual([
      'system',
      'turn',
      'report',
      'question',
    ]);
    expect(blocks[3]).toMatchObject({ kind: 'item', carried: true });
  });

  it('puts what needs a check under the reply: a doubt, orders removed', () => {
    const events = [
      ...weekend().slice(0, 5),
      ev({
        agent: 'titan',
        runId: 'r1',
        type: 'instinct',
        data: {
          use: 'verify',
          action: 'doubt',
          subject: 'rhea',
          message: 'in doubt: from a guide',
          engine: 'llm',
        },
      } as unknown as EventInput),
      ev({
        agent: 'titan',
        runId: 'r1',
        type: 'instinct',
        data: {
          use: 'route',
          action: 'route_hint',
          subject: 'titan',
          message: 'x',
          engine: 'llm',
          details: { route: 'rhea' },
        },
      } as unknown as EventInput),
    ];
    const turn = titanTurns(events)[0] as Turn;
    expect(turn.instinct).toHaveLength(2);
    expect(turn.flags).toEqual([expect.objectContaining({ tone: 'warn', agent: 'rhea' })]);
  });

  it('a doubt with what to decide: the unsure points and the notes ride on the flag', () => {
    const doubt = ev({
      agent: 'system',
      runId: 'r1',
      type: 'instinct',
      data: {
        use: 'done_check',
        action: 'doubt',
        subject: 'rhea',
        message: 'in doubt: Mirko can tell which project to show',
        details: {
          doubt: 'in doubt: Mirko can tell which project to show',
          points: ['Mirko can tell which project to show'],
          notes: ['Commerciale/Pitch.md', 'Agenti/Rhea/MEMORY.md'],
          goal: 'Prepare the pitch',
        },
      },
    } as unknown as EventInput);
    const turn = titanTurns([...weekend().slice(0, 5), doubt])[0] as Turn;
    expect(turn.flags).toEqual([
      expect.objectContaining({
        tone: 'warn',
        agent: 'rhea',
        // The monsters’ own folders are not "notes delivered".
        doubt: {
          id: doubt.id,
          agent: 'rhea',
          points: ['Mirko can tell which project to show'],
          notes: ['Commerciale/Pitch.md'],
        },
      }),
    ]);
  });

  it('starts a second turn when the same run gets a second request', () => {
    const r = 'r5';
    const events = [
      ev({
        agent: 'user',
        runId: r,
        type: 'message',
        data: { role: 'user', text: 'One', to: 'titan' },
      }),
      ev({ agent: 'titan', runId: r, type: 'message', data: { role: 'agent', text: 'Ok one' } }),
      ev({
        agent: 'user',
        runId: r,
        type: 'message',
        data: { role: 'user', text: 'Two', to: 'titan' },
      }),
      ev({ agent: 'titan', runId: r, type: 'message', data: { role: 'agent', text: 'Ok two' } }),
    ];
    const blocks = titanTurns(events) as Turn[];
    expect(blocks.map((b) => [b.id, b.request?.kind === 'user' ? b.request.text : null])).toEqual([
      ['turn:r5', 'One'],
      ['turn:r5:2', 'Two'],
    ]);
  });

  it('in the chat of a monster that got a task: its own steps, not the time and cost of the run', () => {
    const events = weekend();
    const items = buildChat(events, [], nameOf);
    const thread = chatThread(items, 'rhea', scope(events));
    const [turn] = buildTurns(thread, 'rhea', {
      stats: runStatsIndex(events),
      steps: runStepsIndex(events),
    }) as Turn[];
    expect(turn!.received).toHaveLength(1);
    expect(turn!.stats).toBeNull();
    expect(turn!.steps.map((s) => s.agent)).toEqual(['rhea']);
    expect(turnSentence(turn!, { nameOf, cost: null })).toBe('1 web search');
  });
});

describe('the live line', () => {
  it('says who was asked and what they are doing', () => {
    const events = weekend().slice(0, 6);
    const turn = titanTurns(events)[0] as Turn;
    expect(turnEnd(turn)).toBe('open');
    expect(turnNow(turn, nameOf)).toEqual(['Asking Rhea', 'Searching “tram 28”']);
  });

  it('says the steps done in the past tense, in the timeline', () => {
    const turn = titanTurns(weekend())[0] as Turn;
    expect(doneStepText(turn.steps[1]!)).toBe('Searched “tram 28”');
    expect(roughDuration(4_200)).toBe('4 s');
    expect(roughDuration(65_000)).toBe('1 min');
    expect(roughDuration(3_900_000)).toBe('1 h 5 min');
  });
});

describe('stability across chunks of a streamed reply', () => {
  it('keeps the objects that did not change, and the list itself when nothing changed', () => {
    const a = [
      { id: '1', n: [1, 2] },
      { id: '2', n: [3] },
    ];
    const b = [
      { id: '1', n: [1, 2] },
      { id: '2', n: [3, 4] },
    ];
    const kept = keepStable(a, b);
    expect(kept[0]).toBe(a[0]);
    expect(kept[1]).toBe(b[1]);
    expect(keepStable(a, structuredClone(a))).toBe(a);
    expect(sameValue({ x: [{ y: 1 }] }, { x: [{ y: 1 }] })).toBe(true);
    expect(sameValue({ x: [{ y: 1 }] }, { x: [{ y: 2 }] })).toBe(false);
  });

  it('rebuilds only the turn a chunk belongs to', () => {
    const base = weekend();
    const chunk = (text: string) =>
      ev({
        agent: 'titan',
        runId: 'r2',
        type: 'message',
        data: { role: 'agent', text, partial: true },
      });
    const ask = ev({
      agent: 'user',
      runId: 'r2',
      type: 'message',
      data: { role: 'user', text: 'More?', to: 'titan' },
    });
    const one = appendFolding([...base, ask], [chunk('Sure')]);
    const two = appendFolding(one, [chunk(', here')]);
    const keep = stableBlocks();
    const items1 = keepStable(undefined, buildChat(one, [], nameOf));
    const items2 = keepStable(items1, buildChat(two, [], nameOf));
    // The first turn's items are the same objects; the streamed bubble is new.
    expect(items2.filter((i) => items1.includes(i)).length).toBe(items2.length - 1);
    const turns = (events: LogEvent[], items: readonly ChatItem[]) =>
      keep(
        buildTurns(chatThread(items, 'titan', scope(events)), 'titan', {
          stats: runStatsIndex(events),
          steps: runStepsIndex(events),
        }),
      );
    const before = turns(one, items1);
    const after = turns(two, items2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect((after[1] as Turn).column[0]).toMatchObject({ text: 'Sure, here', streaming: true });
    expect(keepStableBlocks(after, [...after])).toBe(after);
  });
});

describe('derivations that grow with the log', () => {
  it('reads only what was added, and keeps the identity of what did not change', () => {
    const base = weekend();
    const later = [
      ...base,
      ev({
        agent: 'user',
        runId: 'r3',
        type: 'message',
        data: { role: 'user', text: 'Hi', to: 'rhea' },
      }),
      ev({
        agent: 'rhea',
        runId: 'r3',
        type: 'tool_call',
        data: { callId: 'x', tool: 'web_search', input: {} },
      }),
    ];
    const s1 = runStatsIndex(base);
    const s2 = runStatsIndex(later);
    expect(s2).not.toBe(s1);
    expect(s2.get('r1')).toBe(s1.get('r1'));
    expect(s2.get('r3')).toMatchObject({ toolCalls: 1 });
    // The same as reading the whole log at once (a list that does not continue a known one).
    expect(runStatsIndex([...later])).toEqual(s2);
    const o1 = runOwners(base);
    expect(runOwners(later).get('r3')).toBe('rhea');
    expect(o1.has('r3')).toBe(false);
    const st1 = runStepsIndex(base);
    const st2 = runStepsIndex(later);
    expect(st2.get('r1')).toBe(st1.get('r1'));
    expect(st2.get('r3')).toHaveLength(1);
  });

  it('a chunk folded in place changes nothing they read', () => {
    const base = [
      ...weekend(),
      ev({
        agent: 'titan',
        runId: 'r4',
        type: 'message',
        data: { role: 'agent', text: 'a', partial: true },
      }),
    ];
    const folded = appendFolding(base, [
      ev({
        agent: 'titan',
        runId: 'r4',
        type: 'message',
        data: { role: 'agent', text: 'b', partial: true },
      }),
    ]);
    expect(folded).toHaveLength(base.length);
    expect(grewFrom(base, folded)).toBe(true);
    expect(runStatsIndex(folded)).toBe(runStatsIndex(base));
    expect(runOwners(folded)).toBe(runOwners(base));
    expect(questionsClosedAt(folded)).toBe(questionsClosedAt(base));
    expect(automationWork(folded)).toBe(automationWork(base));
    // A page of history in front: read again from the start.
    const older = ev({ agent: 'user', type: 'resume', data: {} } as EventInput, -1e9);
    expect(grewFrom(base, [older, ...base])).toBe(false);
  });
});
