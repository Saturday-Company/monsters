import { describe, expect, it } from 'vitest';
import {
  auc,
  loadInstinctCases,
  measureInstinct,
  measureTier,
  MeteredPort,
  noulStats,
} from '../eval/instinct/measure.ts';
import type { DecisionPort, SystemOneAnswer } from '../src/index.ts';

/* eval:instinct (D-067) offline: the labelled cases load, every use runs on a
 * fake port, the spending cap holds. No real model. */

const fakePort = (cost = 0.0001): DecisionPort => ({
  id: 'jev',
  decide: (request) =>
    Promise.resolve({
      answers: request.questions.map((q): SystemOneAnswer => ({
        id: q.id,
        value:
          q.type === 'choice'
            ? typeof q.options[0] === 'string'
              ? q.options[0]
              : q.options[0]!.label
            : 0.5,
        confidence: 0.5,
      })),
      usage: [{ provider: 'typesafe', model: 'jev-1.13.0', inputTokens: 300, costUsd: cost }],
    }),
});

describe('eval:instinct', () => {
  it('has the measured cases (normal and hard) and the new ones', () => {
    const c = loadInstinctCases();
    // 20 of 15/10 and 10 of 17/10 (D-093): the 30 levels of "Automatica".
    expect(c.routing).toHaveLength(30);
    expect(c.routing.filter((r) => r.tier === 2).length).toBeGreaterThanOrEqual(7);
    expect(c.done).toHaveLength(18);
    expect(c.loop).toHaveLength(15);
    // 20 of 15/10 and 20 replies of apps of 26/10 (D-195), several connectors.
    expect(c.injection).toHaveLength(40);
    expect(new Set(c.injection.map((i) => i.service).filter(Boolean)).size).toBeGreaterThanOrEqual(
      5,
    );
    expect(c.finalq).toHaveLength(20);
    expect(c.outbound.length).toBeGreaterThanOrEqual(10);
    expect(c.memory.length).toBeGreaterThanOrEqual(8);
  });

  it('runs every use with the core builders, and stops at the cap', async () => {
    const port = new MeteredPort(fakePort(), 1);
    const report = await measureInstinct(loadInstinctCases(), port);
    expect(report.gate.cases).toBe(40);
    expect(report.routing.route).toMatch(/\/30$/);
    expect(report.cost.calls).toBeGreaterThan(100);
    const capped = new MeteredPort(fakePort(0.01), 0.02);
    await expect(measureInstinct(loadInstinctCases(), capped)).rejects.toThrow(/tetto di spesa/);
  });

  it('the tier alone: agreement and the confusion of the levels', async () => {
    const port = new MeteredPort(fakePort(), 1);
    const report = await measureTier(loadInstinctCases().routing, port);
    // Every score 0.5 is "Media": right only on the medium ones.
    const medium = loadInstinctCases().routing.filter((r) => r.tier === 1).length;
    expect(report).toMatchObject({ n: 30, agree: medium, hardAsSimple: [], simpleAsHard: [] });
    expect(report.confusion.reduce((sum, r) => sum + (r[1] ?? 0), 0)).toBe(30);
    expect(port.calls).toBe(30);
    // The briefs of delegations (D-109): the tier alone, as the core asks it for a subtask.
    const subtasks = loadInstinctCases().subtasks;
    expect(subtasks).toHaveLength(10);
    const sub = new MeteredPort(fakePort(), 1);
    const asked: string[][] = [];
    const spy: DecisionPort = {
      id: 'jev',
      decide: (request, signal) => {
        asked.push(request.questions.map((q) => q.id));
        return sub.decide(request, signal);
      },
    };
    const subReport = await measureTier(subtasks, new MeteredPort(spy, 1), { subtask: true });
    expect(subReport.n).toBe(10);
    expect(asked.every((ids) => ids.join() === 'tier')).toBe(true);
  });

  it('AUC and bands', () => {
    expect(auc([0.9, 0.8], [0.1, 0.2])).toBe(1);
    expect(auc([0.1], [0.9])).toBe(0);
    const s = noulStats(
      [
        { id: 'a', set: 'normali', p: 0.9, expected: true },
        { id: 'b', set: 'normali', p: 0.1, expected: false },
        { id: 'c', set: 'difficili', p: 0.6, expected: false },
      ],
      { low: 0.15, high: 0.85 },
    );
    expect(s).toMatchObject({ at05: 2, high: '1/1', low: '1/1', mid: 1, errors: ['c:0.60'] });
  });
});
