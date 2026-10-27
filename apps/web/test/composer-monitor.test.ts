import { setAppLang, ulid, type EventInput, type LogEvent } from '@monsters/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composerPlaceholder, matchSlash, slashQuery } from '../src/components/chat/Composer.tsx';
import {
  applyLive,
  buildChat,
  chatThread,
  costText,
  runOwners,
  runStatsIndex,
  type LiveState,
} from '../src/store/derive.ts';
import { queuedMessages } from '../src/store/queued.ts';
import { buildTurns, runStepsIndex, turnCost, turnSentence, type Turn } from '../src/store/turn.ts';

/*
 * The writing field and the monitor of the chat (docs/design.md, "The chat"): the `/` menu, the
 * messages that wait for the monster's next step, and the outcome of a turn the user stopped.
 */

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

describe('the / menu', () => {
  it('opens only for a command word at the very start of the field', () => {
    expect(slashQuery('/', 1)).toBe('');
    expect(slashQuery('/ne', 3)).toBe('ne');
    expect(slashQuery('/NEW', 4)).toBe('new');
    // Not in the middle of a sentence, a path or a fraction, nor after a space.
    expect(slashQuery('and/or', 6)).toBeNull();
    expect(slashQuery('see /new', 8)).toBeNull();
    expect(slashQuery('/new now', 8)).toBeNull();
    expect(slashQuery('/a/b', 4)).toBeNull();
    expect(slashQuery('/new', 2)).toBeNull();
    expect(slashQuery('', 0)).toBeNull();
  });

  it('matches the commands by their name in either language', () => {
    const commands = [
      { id: 'new', names: ['nuova', 'new'] },
      { id: 'stop', names: ['ferma', 'stop'] },
      { id: 'behind', names: ['dietro', 'behind'] },
    ];
    expect(matchSlash(commands, '').map((c) => c.id)).toEqual(['new', 'stop', 'behind']);
    expect(matchSlash(commands, 'ne').map((c) => c.id)).toEqual(['new']);
    expect(matchSlash(commands, 'nu').map((c) => c.id)).toEqual(['new']);
    expect(matchSlash(commands, 'st').map((c) => c.id)).toEqual(['stop']);
    expect(matchSlash(commands, 'zz')).toEqual([]);
  });
});

describe('the placeholder', () => {
  const base = { name: 'Titan', halted: false, noModel: false, question: null, wide: true };
  it('names the commands only when there is room, and says nothing of them with a question', () => {
    expect(composerPlaceholder(base)).toBe('Message Titan… (@ for a monster, / for commands)');
    expect(composerPlaceholder({ ...base, wide: false })).toBe('Message Titan…');
    expect(
      composerPlaceholder({ ...base, question: { id: 'q', from: 'Titan', options: 3 } }),
    ).not.toContain('commands');
  });
});

describe('a message that waits for the next step', () => {
  const run = (agent = 'titan', runId = 'r1') =>
    ev({ agent, runId, type: 'run', data: { status: 'started', goal: 'x' } });
  const user = (text: string, runId = 'r1', extra: Record<string, unknown> = {}) =>
    ev({
      agent: 'user',
      runId,
      type: 'message',
      data: { role: 'user', text, to: 'titan', ...extra },
    });
  const usage = (agent = 'titan', runId = 'r1') =>
    ev({
      agent,
      runId,
      type: 'provider_usage',
      data: { provider: 'openrouter', model: 'm', inputTokens: 1, outputTokens: 1 },
    });
  const tool = (agent = 'titan', runId = 'r1') =>
    ev({
      agent,
      runId,
      type: 'tool_call',
      data: { callId: ulid(clock++), tool: 'web_search', input: {} },
    });

  const waiting = (events: LogEvent[]) => [...queuedMessages(events, 'titan', 'titan')];

  it('is queued from when it joins a run going until the step after the one under way', () => {
    const first = user('Plan the week');
    const second = user('and keep it short');
    // The first message starts the run: it is logged before `run started`.
    const events = [first, run(), tool(), second];
    // The monster is in the middle of a step: the message waits.
    expect(waiting(events)).toEqual([second.id]);
    // That step ends (its usage is logged): still not read, the next step has not started.
    events.push(usage());
    expect(waiting(events)).toEqual([second.id]);
    // The next thing it does belongs to a step that has read it.
    events.push(tool());
    expect(waiting(events)).toEqual([]);
  });

  it('is read after a second step of usage too, and never when the run is over', () => {
    const msg = user('also this');
    const events = [run(), tool(), msg, usage(), usage()];
    expect(waiting(events)).toEqual([]);
    const ended = [
      run(),
      msg,
      ev({ agent: 'titan', runId: 'r1', type: 'run', data: { status: 'completed' } }),
    ];
    expect(waiting(ended)).toEqual([]);
  });

  it('counts only the monster of the chat, the messages of the user to it, in a run going', () => {
    const mine = user('for Titan');
    const toRhea = ev({
      agent: 'user',
      runId: 'r1',
      type: 'message',
      data: { role: 'user', text: 'for Rhea', to: 'rhea' },
    });
    const telegram = user('from Telegram', 'r1', {
      telegram: {
        sender: { id: '1', name: 'Bob' },
        bot: 'b',
        chat: 'c',
        chatType: 'group',
        owner: false,
      },
    });
    const fromMonster = user('from a monster', 'r1', { from: 'rhea' });
    // Another monster's steps are not the monster's own: they do not read its inbox.
    const events = [
      run(),
      mine,
      toRhea,
      telegram,
      fromMonster,
      usage('rhea'),
      usage('rhea'),
      tool('rhea'),
    ];
    expect(waiting(events)).toEqual([mine.id]);
    // The first message of a run starts it: it is not queued behind anything.
    const alone = user('first', 'r2');
    expect(waiting([alone, run('titan', 'r2')])).toEqual([]);
    // A run of another message that has not started yet is not "after this step".
    expect(waiting([user('deferred', 'r3')])).toEqual([]);
  });
});

describe('a turn the user stopped from the chat', () => {
  const names: Record<string, string> = { titan: 'Titan', dione: 'Dione' };
  const nameOf = (id: string) => names[id] ?? id;

  function stoppedTurn(): Turn {
    const events = [
      ev({
        agent: 'user',
        runId: 'r1',
        type: 'message',
        data: { role: 'user', text: 'Plan', to: 'dione' },
      }),
      ev({ agent: 'dione', runId: 'r1', type: 'run', data: { status: 'started', goal: 'Plan' } }),
      ev({
        agent: 'dione',
        runId: 'r1',
        type: 'kill',
        data: {
          scope: 'agent',
          target: 'dione',
          by: 'ui',
          reason: 'You stopped Dione',
          runsAborted: 1,
          processesKilled: 0,
        },
      }),
      ev({ agent: 'dione', runId: 'r1', type: 'run', data: { status: 'aborted' } }),
    ];
    const items = buildChat(events, [], nameOf);
    const thread = chatThread(items, 'dione', { orchestrator: 'titan', owners: runOwners(events) });
    const blocks = buildTurns(thread, 'dione', {
      stats: runStatsIndex(events),
      steps: runStepsIndex(events),
    });
    return blocks.find((b): b is Turn => b.kind === 'turn')!;
  }

  it('says who the user stopped as the outcome of its strip', () => {
    const turn = stoppedTurn();
    expect(turn.stats?.stoppedAgent).toBe('dione');
    expect(turnSentence(turn, { nameOf, cost: turnCost(turn, costText) })).toMatch(
      /^You stopped Dione after \d+ s/,
    );
    setAppLang('it');
    try {
      expect(turnSentence(turn, { nameOf, cost: null })).toMatch(/^Hai fermato Dione dopo \d+ s/);
    } finally {
      setAppLang('en');
    }
  });

  it('reads the target of a stop of one monster as the monster, not as a run', () => {
    const ids = ['titan', 'dione'];
    const step = (live: Record<string, LiveState>, e: LogEvent) => applyLive(live, e, ids);
    let live: Record<string, LiveState> = {};
    live = step(
      live,
      ev({ agent: 'titan', runId: 'rt', type: 'run', data: { status: 'started', goal: 'a' } }),
    );
    live = step(
      live,
      ev({ agent: 'dione', runId: 'rd', type: 'run', data: { status: 'started', goal: 'b' } }),
    );
    // Dione's own run ends: the kill carries `target: 'dione'`, the run is the event's.
    live = step(
      live,
      ev({
        agent: 'dione',
        runId: 'rd',
        type: 'kill',
        data: { scope: 'agent', target: 'dione', by: 'ui', runsAborted: 1 },
      }),
    );
    expect(live['dione']?.mood).toBe('stopped');
    expect(live['titan']?.mood).toBe('working');
    // Dione's part inside Titan's run (`runsAborted: 0`): Titan's run goes on, Titan keeps working.
    live = step(
      live,
      ev({
        agent: 'dione',
        runId: 'rt',
        type: 'delegation',
        data: { from: 'titan', to: 'dione', status: 'started', goal: 'c' },
      }),
    );
    live = step(
      live,
      ev({
        agent: 'dione',
        runId: 'rt',
        type: 'kill',
        data: { scope: 'agent', target: 'dione', by: 'ui', runsAborted: 0 },
      }),
    );
    expect(live['titan']?.mood).not.toBe('stopped');
  });
});
