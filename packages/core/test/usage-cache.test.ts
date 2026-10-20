import type { AgentUsageView, EventInput } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { EventLog, coreMigrations, migrate, openDb } from '../src/index.ts';
import { AgentUsage, USAGE_MAX_RUNS } from '../src/team/usage.ts';

/* The Consumi endpoint reads only the monster's runs and keeps them between reads (D-079). */

function setup() {
  const db = openDb(':memory:');
  migrate(db, 'core', coreMigrations);
  const log = new EventLog(db);
  const make = () =>
    new AgentUsage({
      log,
      spend: {
        view: () => ({ usdToEur: 0.9, warnAt: 0.8, day: {}, month: {}, agents: [] }),
      } as never,
      windows: { get: () => 100_000, resolve: () => Promise.resolve(100_000) } as never,
      classify: () => 'free',
      subscription: () => false,
    });
  return { db, log, make };
}

const started = (agent: string, runId: string): EventInput<'run'> => ({
  agent,
  runId,
  type: 'run',
  data: { status: 'started' },
});
const ended = (agent: string, runId: string): EventInput<'run'> => ({
  agent,
  runId,
  type: 'run',
  data: { status: 'completed' },
});
const step = (agent: string, runId: string, inputTokens: number): EventInput<'provider_usage'> => ({
  agent,
  runId,
  type: 'provider_usage',
  data: {
    provider: 'openrouter',
    model: 'x/y:free',
    inputTokens,
    outputTokens: 1,
    durationMs: 1,
    step: 0,
    context: {
      total: inputTokens,
      window: 100_000,
      source: 'estimated',
      parts: { conversation: inputTokens },
    },
  },
});

/** What two reads must agree on (the spend part is the same stub). */
const sums = (v: AgentUsageView) => ({ since: v.since, context: v.context, session: v.session });

describe('Consumi: the cached read', () => {
  it('matches a fresh read after new events, and ignores the other monsters', async () => {
    const { log, make } = setup();
    const usage = make();
    log.append(started('titan', 'r1'));
    log.append(step('titan', 'r1', 100));
    log.append(started('rhea', 'r2'));
    log.append(step('rhea', 'r2', 9_999));
    const first = await usage.view('titan');
    expect(first.session).toMatchObject({ runs: 1, calls: 1, inputTokens: 100 });

    // New steps: of titan's run, of a delegation inside it, of a new run, of another monster.
    log.append(step('titan', 'r1', 200));
    log.append(started('dione', 'r1'));
    log.append(step('dione', 'r1', 50));
    log.append(ended('titan', 'r1'));
    log.append(started('titan', 'r3'));
    log.append(step('titan', 'r3', 300));
    log.append(step('rhea', 'r2', 9_999));
    const again = await usage.view('titan');
    expect(again.session).toMatchObject({ runs: 2, calls: 4, inputTokens: 650 });
    expect(again.context).toMatchObject({ total: 300, runId: 'r3' });
    expect(sums(again)).toEqual(sums(await make().view('titan')));
    // Nothing new: the same sums.
    expect(sums(await usage.view('titan'))).toEqual(sums(again));
    // Rhea's own run only (titan's delegation to dione is titan's).
    expect((await usage.view('rhea')).session).toMatchObject({ runs: 1, calls: 2 });
    expect((await usage.view('dione')).session.calls).toBe(0);
  });

  it('after a change of model the share is against the new window (D-086)', async () => {
    const db = openDb(':memory:');
    migrate(db, 'core', coreMigrations);
    const log = new EventLog(db);
    const windows: Record<string, number> = { 'x/y:free': 100_000, 'big/model': 1_000_000 };
    const usage = new AgentUsage({
      log,
      spend: {
        view: () => ({ usdToEur: 0.9, warnAt: 0.8, day: {}, month: {}, agents: [] }),
      } as never,
      windows: {
        get: (_p: string, m: string) => windows[m],
        resolve: (_p: string, m: string) => Promise.resolve(windows[m]),
      } as never,
      classify: () => 'free',
      subscription: () => false,
    });
    log.append(started('titan', 'r1'));
    log.append(step('titan', 'r1', 50_000));
    const big = { provider: 'openrouter', model: 'big/model' };
    const same = await usage.view('titan', [{ provider: 'openrouter', model: 'x/y:free' }]);
    expect(same.context).toMatchObject({ total: 50_000, window: 100_000 });
    expect(same.context?.measuredWith).toBeUndefined();
    // A fallback of the chain stays what it is.
    const fallback = await usage.view('titan', [
      big,
      { provider: 'openrouter', model: 'x/y:free' },
    ]);
    expect(fallback.context).toMatchObject({ window: 100_000, model: 'x/y:free' });
    const changed = await usage.view('titan', [big]);
    expect(changed.context).toMatchObject({
      total: 50_000,
      window: 1_000_000,
      model: 'big/model',
      measuredWith: { provider: 'openrouter', model: 'x/y:free' },
    });
    // A model whose window nobody says: no share, never the old one.
    const unknown = await usage.view('titan', [{ provider: 'ollama', model: 'llama' }]);
    expect(unknown.context?.window).toBeNull();
    // The cached sums keep the step's own model.
    expect((await usage.view('titan')).context).toMatchObject({ window: 100_000 });
  });

  it('starts over with a new conversation (for it or for everyone)', async () => {
    const { log, make } = setup();
    const usage = make();
    log.append(started('titan', 'r1'));
    log.append(step('titan', 'r1', 100));
    expect((await usage.view('titan')).session.calls).toBe(1);
    const restart = log.append({ agent: 'user', type: 'new_conversation', data: { to: 'titan' } });
    const empty = await usage.view('titan');
    expect(empty.session).toMatchObject({ runs: 0, calls: 0 });
    expect(empty.since).toBe(restart.ts);
    log.append(started('titan', 'r2'));
    log.append(step('titan', 'r2', 40));
    expect((await usage.view('titan')).session).toMatchObject({ runs: 1, inputTokens: 40 });
    log.append({ agent: 'user', type: 'new_conversation', data: {} });
    expect((await usage.view('titan')).session.calls).toBe(0);
    // A run started before the new conversation is not part of it, even if it goes on.
    log.append(step('titan', 'r2', 40));
    expect((await usage.view('titan')).session.calls).toBe(0);
  });

  it('sums at most the latest runs, cached or not', async () => {
    const { log, make } = setup();
    const usage = make();
    for (let i = 0; i < USAGE_MAX_RUNS; i++) {
      log.append(started('titan', `a${i}`));
      log.append(step('titan', `a${i}`, 1));
    }
    expect((await usage.view('titan')).session.runs).toBe(USAGE_MAX_RUNS);
    for (let i = 0; i < 5; i++) {
      log.append(started('titan', `b${i}`));
      log.append(step('titan', `b${i}`, 10));
    }
    const view = await usage.view('titan');
    expect(view.session).toMatchObject({
      runs: USAGE_MAX_RUNS,
      inputTokens: USAGE_MAX_RUNS - 5 + 50,
    });
    expect(sums(view)).toEqual(sums(await make().view('titan')));
  });

  it('reads the runs through the indexes, not the whole log', () => {
    const { db, log } = setup();
    log.append(started('titan', 'r1'));
    const plans = [
      `SELECT run_id FROM events WHERE agent = 'titan' AND type = 'run' AND id > '' AND json_extract(data, '$.status') = 'started'`,
      `SELECT * FROM events INDEXED BY events_run WHERE run_id IN ('r1') AND type IN ('run', 'provider_usage') AND id > '' ORDER BY id`,
    ].map((sql) =>
      db
        .all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
        .map((r) => r.detail)
        .join(' | '),
    );
    expect(plans[0]).toContain('events_agent_type_id');
    expect(plans[1]).toContain('events_run');
    expect(plans.join(' ')).not.toMatch(/SCAN events\b/);
  });
});

describe('Consumi after an archive of the log (review of 19/10, n. 11)', () => {
  it('says the count is partial when the conversation started before the cut', async () => {
    const { log, make } = setup();
    log.append(started('titan', 'r1'));
    log.append(step('titan', 'r1', 100));
    log.append(ended('titan', 'r1'));
    const usage = make();
    expect((await usage.view('titan')).archivedBefore).toBeUndefined();
    const cut = Date.now() - 90 * 86_400_000;
    log.append({
      agent: 'system',
      type: 'log_archive',
      data: { events: 12, before: cut, months: [], dir: '/x', by: 'system' },
    });
    expect((await usage.view('titan')).archivedBefore).toBe(cut);
    // A new conversation after the cut is whole again.
    log.append({ agent: 'user', type: 'new_conversation', data: {} });
    expect((await make().view('titan')).archivedBefore).toBeUndefined();
  });
});
