import { describe, expect, it, vi } from 'vitest';
import { coreMigrations, EventLog, migrate, openDb } from '../src/index.ts';
import { MAX_QUERY_LIMIT, SCAN_FIRST_PAGE } from '../src/log/event-log.ts';
import { runsTainted } from '../src/team/compaction.ts';
import { conversationTurns } from '../src/team/conversation.ts';
import { MemoryProposals } from '../src/team/memory-proposals.ts';
import { haltedRequests, requeueWaiting } from '../src/team/resume-work.ts';
import type { TeamService } from '../src/team/team-service.ts';

/*
 * Readers of the log that stopped at the first page (D-215): `query` returns at most
 * `MAX_QUERY_LIMIT` events, and the streamed chunks of one long answer fill a page.
 */

function setup() {
  const db = openDb(':memory:');
  migrate(db, 'core', coreMigrations);
  return new EventLog(db);
}

/** A user's request to titan, `chunks` streamed pieces of its answer, then the answer. */
function longAnswer(log: EventLog, runId: string, chunks: number, final = 'Ecco i tre post.') {
  log.append({
    agent: 'user',
    runId,
    type: 'message',
    data: { role: 'user', text: 'Tre post su Lisbona', to: 'titan', channel: 'ui' },
  });
  log.append({ agent: 'titan', runId, type: 'run', data: { status: 'started' } });
  log.append({
    agent: 'titan',
    runId,
    type: 'vault_change',
    data: { action: 'create', path: 'Post/Lisbona.md' },
  });
  for (let i = 0; i < chunks; i++) {
    log.append({
      agent: 'titan',
      runId,
      type: 'message',
      data: { role: 'agent', text: `pezzo ${i} `, partial: true },
    });
  }
  log.append({ agent: 'titan', runId, type: 'message', data: { role: 'agent', text: final } });
  log.append({ agent: 'titan', runId, type: 'run', data: { status: 'completed' } });
}

describe('the query API never cuts a reader silently', () => {
  it('refuses a limit over the page, scan/all/find read every page', () => {
    const log = setup();
    for (let i = 0; i < MAX_QUERY_LIMIT + 250; i++) {
      log.append({ agent: 'titan', runId: 'r', type: 'error', data: { message: `e${i}` } });
    }
    expect(() => log.query({ limit: MAX_QUERY_LIMIT + 1 })).toThrow(RangeError);
    expect(log.query({ limit: MAX_QUERY_LIMIT })).toHaveLength(MAX_QUERY_LIMIT);
    const all = log.all({ runId: 'r' });
    expect(all).toHaveLength(MAX_QUERY_LIMIT + 250);
    expect(all.at(-1)?.data).toEqual({ message: `e${MAX_QUERY_LIMIT + 249}` });
    const desc = log.all({ runId: 'r', order: 'desc' });
    expect(desc.map((e) => e.id)).toEqual(all.map((e) => e.id).reverse());
    // Bounds of the filter hold on every page.
    expect(log.all({ after: all[10]!.id, before: all[1100]!.id })).toHaveLength(1089);
    expect(log.all({ after: all[10]!.id, before: all[1100]!.id, order: 'desc' })).toHaveLength(
      1089,
    );
    expect(
      log.find({ runId: 'r' }, (e) => e.type === 'error' && e.data.message === 'e1200')?.id,
    ).toBe(all[1200]!.id);
  });

  it('scan and find start with a small page and grow, all reads full pages', () => {
    const log = setup();
    for (let i = 0; i < 3_000; i++) {
      log.append({ agent: 'titan', runId: 'r', type: 'error', data: { message: `e${i}` } });
    }
    const spy = vi.spyOn(log, 'query');
    const limits = () => spy.mock.calls.map(([q]) => q?.limit);
    // A lookup that finds its event among the first rows parses one small page, not 1000 rows.
    expect(
      log.find({ runId: 'r' }, (e) => e.type === 'error' && e.data.message === 'e3'),
    ).toBeDefined();
    expect(limits()).toEqual([SCAN_FIRST_PAGE]);
    spy.mockClear();
    expect(log.find({ runId: 'r', order: 'desc' }, () => true)?.data).toEqual({ message: 'e2999' });
    expect(limits()).toEqual([SCAN_FIRST_PAGE]);
    // A reader that reads on grows its pages up to the cap and misses nothing.
    spy.mockClear();
    expect([...log.scan({ runId: 'r' })]).toHaveLength(3_000);
    expect(limits()).toEqual([50, 100, 200, 400, 800, 1000, 1000]);
    spy.mockClear();
    expect(log.all({ runId: 'r' })).toHaveLength(3_000);
    expect(limits()).toEqual([MAX_QUERY_LIMIT, MAX_QUERY_LIMIT, MAX_QUERY_LIMIT, MAX_QUERY_LIMIT]);
  });

  it('filters on data fields and on streamed chunks in SQL', () => {
    const log = setup();
    longAnswer(log, 'r1', 30);
    log.append({ agent: 'user', type: 'kill', data: { scope: 'global', by: 'ui' } });
    log.append({
      agent: 'user',
      type: 'kill',
      data: { scope: 'agent', target: 'titan', by: 'ui' },
    });
    expect(log.query({ type: 'kill', data: { scope: 'global' } })).toHaveLength(1);
    expect(log.query({ type: 'kill', data: { target: null } })).toHaveLength(1);
    expect(log.query({ type: 'message', data: { partial: true } })).toHaveLength(30);
    const finals = log.query({ runId: 'r1', partials: false });
    expect(finals.filter((e) => e.type === 'message').map((e) => e.data)).toEqual([
      { role: 'user', text: 'Tre post su Lisbona', to: 'titan', channel: 'ui' },
      { role: 'agent', text: 'Ecco i tre post.' },
    ]);
    expect(() => log.query({ data: { "x') OR 1 --": 1 } })).toThrow(RangeError);
  });
});

describe('the history of a long answer', () => {
  it('a Telegram chat or a giro keeps the final answer of a run with thousands of chunks', () => {
    const log = setup();
    longAnswer(log, 'r1', MAX_QUERY_LIMIT + 500);
    const turns = conversationTurns(log, undefined, {
      agentId: 'titan',
      isOrchestrator: false,
      turns: 10,
      runs: new Set(['r1']),
    });
    expect(turns.map((t) => [t.role, t.content])).toEqual([
      ['user', 'Tre post su Lisbona'],
      ['assistant', 'Ecco i tre post.'],
    ]);
  });

  it('the chat keeps it too, with the notes of the job', () => {
    const log = setup();
    longAnswer(log, 'r1', 3_500);
    const turns = conversationTurns(log, undefined, {
      agentId: 'titan',
      isOrchestrator: false,
      turns: 10,
    });
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(turns[1]!.content).toContain('Ecco i tre post.');
    expect(turns[1]!.content).toContain('Post/Lisbona.md');
  });
});

describe('the latest global stop after many Stops of one monster', () => {
  /** A message left waiting for titan, a global stop, then `stops` Stops of one monster. */
  function stoppedThenStops(stops: number) {
    const log = setup();
    const waiting = log.append({
      agent: 'user',
      runId: 'r-waiting',
      type: 'message',
      data: { role: 'user', text: 'Cerca i voli', to: 'titan', channel: 'ui' },
    });
    log.append({ agent: 'user', type: 'kill', data: { scope: 'global', by: 'ui' } });
    for (let i = 0; i < stops; i++) {
      log.append({
        agent: 'user',
        type: 'kill',
        data: { scope: 'agent', target: 'rhea', by: 'ui' },
      });
    }
    return { log, waiting };
  }

  it('a restart does not requeue what the global stop dropped', () => {
    const { log } = stoppedThenStops(60);
    const requeued: unknown[] = [];
    const dispatcher = {
      requeueWaiting: (r: unknown) => requeued.push(r),
    } as unknown as Parameters<typeof requeueWaiting>[1];
    expect(requeueWaiting(log, dispatcher, { halted: false })).toEqual([]);
    expect(requeued).toEqual([]);
  });

  it('"resume and continue" still finds what it left waiting', () => {
    const { log, waiting } = stoppedThenStops(60);
    const requests = haltedRequests(log);
    expect(requests.map((r) => [r.runId, r.agent, r.text])).toEqual([
      ['r-waiting', 'titan', waiting.data.text],
    ]);
  });
});

describe('a taint past the first page', () => {
  it('a web search after a thousand other calls still taints the run', () => {
    const log = setup();
    for (let i = 0; i < MAX_QUERY_LIMIT + 10; i++) {
      log.append({
        agent: 'titan',
        runId: 'r1',
        type: 'tool_call',
        data: { callId: `c${i}`, tool: 'vault_read', input: {} },
      });
    }
    expect(runsTainted(log, ['r1'])).toBe(false);
    log.append({
      agent: 'titan',
      runId: 'r1',
      type: 'tool_call',
      data: { callId: 'web', tool: 'web_search', input: { query: 'voli Lisbona' } },
    });
    expect(runsTainted(log, ['r1'])).toBe(true);
  });
});

describe('the open drafts of memory', () => {
  it('are found in a few pages, not one query per draft', () => {
    const log = setup();
    const ids: string[] = [];
    for (let i = 0; i < 2_000; i++) {
      ids.push(
        log.append({
          agent: 'titan',
          type: 'memory',
          data: { action: 'proposed', path: 'MEMORY.md', lines: [`riga ${i}`] },
        }).id,
      );
    }
    // Every third draft is answered, a half of them by a discard.
    ids.forEach((id, i) => {
      if (i % 3 !== 0) return;
      log.append({
        agent: 'titan',
        type: 'memory',
        data:
          i % 2 === 0
            ? { action: 'discarded', path: 'MEMORY.md', proposalId: id, by: 'ui' }
            : { action: 'remembered', path: 'MEMORY.md', proposalId: id, by: 'ui' },
      });
    });
    const proposals = new MemoryProposals({ log, team: {} as TeamService });
    const spy = vi.spyOn(log, 'query');
    const open = proposals.open();
    expect(open.map((e) => e.id)).toEqual(ids.filter((_, i) => i % 3 !== 0));
    // Pages of the log, not a query per draft.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
