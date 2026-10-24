import type { LogEvent } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { parseAgentConfig } from '../src/agents/definition.ts';
import {
  BANDS,
  createCoreServices,
  migrate,
  System1,
  teamMigrations,
  tierOf,
  Triage,
  type CoreServices,
  type DecisionPort,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';

/*
 * The tier follows the score and the engine's confidence (D-169): Hard (Opus, high effort) needs
 * the hard score and a confidence of at least `BANDS.tier.hardConfidence`. The audit of 24/10
 * found a score of 1.32 with confidence 0 sent to Opus, while the question says "in doubt between
 * Medium and Hard it is Medium". Simple does not change.
 */

const opened: CoreServices[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.db.close();
});

describe('tierOf(score, confidence)', () => {
  const { simple, hard, hardConfidence } = BANDS.tier;

  it('the threshold is 0.5 and sits next to the other cuts', () => {
    expect(hardConfidence).toBe(0.5);
  });

  it('hard needs the hard score and a sure engine', () => {
    expect(tierOf(hard, hardConfidence)).toBe('hard');
    expect(tierOf(1.32, 0.5)).toBe('hard');
    expect(tierOf(2, 1)).toBe('hard');
    // The case of the audit: 1.32 with confidence 0.
    expect(tierOf(1.32, 0)).toBe('medium');
    expect(tierOf(hard, hardConfidence - 0.01)).toBe('medium');
    expect(tierOf(2, 0.49)).toBe('medium');
  });

  it('below the hard cut the confidence changes nothing', () => {
    expect(tierOf(hard - 0.01, 1)).toBe('medium');
    expect(tierOf(hard - 0.01, 0)).toBe('medium');
    expect(tierOf(simple, 0)).toBe('medium');
    expect(tierOf(simple - 0.01, 0)).toBe('simple');
    expect(tierOf(0, 1)).toBe('simple');
  });
});

describe('Triage applies the confidence and logs the tier it applied', () => {
  const agent = {
    config: parseAgentConfig({
      id: 'titan',
      name: 'Titan',
      role: 'Lead',
      color: '#336699',
      models: [{ provider: 'openrouter', model: 'a:free' }],
    }),
    instructions: 'You are Titan.',
  };

  function triage(score: number, confidence: number) {
    const s = createCoreServices({ home: tempHome() });
    opened.push(s);
    migrate(s.db, 'team', teamMigrations);
    const port: DecisionPort = {
      id: 'jev',
      decide: (request) =>
        Promise.resolve({
          answers: request.questions.map((q) => ({ id: q.id, value: score, confidence })),
          model: 'jev-test',
        }),
    };
    const system1 = new System1({
      log: s.log,
      port: () => ({ port, engine: port.id }),
      mode: () => 'on',
    });
    return { s, triage: new Triage(system1, s.log) };
  }

  const run = (t: ReturnType<typeof triage>) =>
    t.triage.run({
      agent,
      members: [],
      request: 'Why does the build fail only on Windows?',
      history: [],
      runId: 'r1',
      tier: true,
      web: false,
      rare: false,
      rules: [],
    });

  const decision = (s: CoreServices) =>
    (s.log.query({ type: 'decision', limit: 50 }) as LogEvent<'decision'>[]).find(
      (e) => e.data.kind === 'tier',
    )!;

  it('a hard score with confidence 0 is Medium, and the decision says Medium', async () => {
    const t = triage(1.32, 0);
    const out = await run(t);
    expect(out.tier).toBe('medium');
    const d = decision(t.s).data;
    expect(d.value).toBe(1.32);
    expect(d.confidence).toBe(0);
    expect(d.choice).toMatch(/^Medium/);
  });

  it('a hard score with confidence 0.5 is Hard, and the decision says Hard', async () => {
    const t = triage(1.32, 0.5);
    expect((await run(t)).tier).toBe('hard');
    expect(decision(t.s).data.choice).toMatch(/^Hard/);
  });

  it('a simple score stays Simple whatever the confidence', async () => {
    const t = triage(0.1, 0);
    expect((await run(t)).tier).toBe('simple');
    expect(decision(t.s).data.choice).toMatch(/^Simple/);
  });

  it('the level of a delegated subtask follows the same rule', async () => {
    // The delegation event the level hangs from: any event of the run will do.
    const level = async (score: number, confidence: number) => {
      const t = triage(score, confidence);
      const parent = t.s.log.append({
        agent: 'titan',
        runId: 'r1',
        type: 'message',
        data: { role: 'agent', text: 'delegating' },
      });
      const tier = await t.triage.subtaskTier({
        agent,
        subtask: 'Check the contract against the budget',
        runId: 'r1',
        parentId: parent.id,
      });
      return { tier, choice: decision(t.s).data.choice };
    };
    const unsure = await level(1.9, 0.2);
    expect(unsure.tier).toBe('medium');
    expect(unsure.choice).toMatch(/^Medium/);
    const sure = await level(1.9, 0.9);
    expect(sure.tier).toBe('hard');
    expect(sure.choice).toMatch(/^Hard/);
  });
});
