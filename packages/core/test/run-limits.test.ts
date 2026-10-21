import { fake } from '@monsters/providers/testing';
import { ToolError, type LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { RunBudget, RunLimitsSchema, treeCostLimit } from '../src/index.ts';
import { inLang } from './prompt-lang.ts';
import { startTestHub, toolResultsSeen } from './hub-helpers.ts';

type Sent = { runId: string };

const failedResults = (events: LogEvent[], tool: string) =>
  events.filter(
    (e): e is LogEvent<'tool_result'> =>
      e.type === 'tool_result' && e.data.tool === tool && !e.data.ok,
  );

const delegate = (agent: string) => ({
  name: 'delegate',
  input: { agent, goal: `Un lavoro per ${agent}` },
});

describe('run limits', () => {
  it('caps the delegations started in one step', async () => {
    const t = await startTestHub(
      {
        titan: [
          fake.toolCalls([delegate('Rhea'), delegate('Dione'), delegate('Rhea')]),
          fake.text('Fatto con due.'),
        ],
        rhea: [fake.text('Fatto.')],
        dione: [fake.text('Fatto.')],
      },
      { hub: { settings: { limits: { maxParallelDelegations: 2 } } } },
    );
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'tre lavori' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const log = t.events(sent.runId);
    const started = log.filter((e) => e.type === 'delegation' && e.data.status === 'started');
    expect(started).toHaveLength(2);
    const refused = failedResults(log, 'delegate');
    expect(refused).toHaveLength(1);
    expect(refused[0]!.data.error).toMatch(
      /^LIMIT_REACHED: .*at most 2 delegations at the same time/,
    );
    // The model sees the code and a hint.
    const seen = toolResultsSeen(t.provider.callsTo('titan')[1]!.options.prompt);
    expect(seen).toContain('LIMIT_REACHED');
    expect(seen).toContain('next step');
  });

  it('caps the delegations of a whole run', async () => {
    const t = await startTestHub(
      {
        titan: [
          fake.toolCall('delegate', delegate('Rhea').input),
          fake.toolCall('delegate', delegate('Dione').input),
          fake.toolCall('delegate', { agent: 'Rhea', goal: 'Un altro lavoro per Rhea' }),
          fake.text('Basta così.'),
        ],
        rhea: [fake.text('Fatto.'), fake.text('Ancora.')],
        dione: [fake.text('Fatto.')],
      },
      { hub: { settings: { limits: { maxDelegationsPerRun: 2 } } } },
    );
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'lavora' });
    await t.runEnded(sent.runId);
    const log = t.events(sent.runId);
    expect(log.filter((e) => e.type === 'delegation' && e.data.status === 'started')).toHaveLength(
      2,
    );
    expect(t.provider.callsTo('rhea')).toHaveLength(1);
    expect(failedResults(log, 'delegate')[0]!.data.error).toMatch(
      /LIMIT_REACHED: .*at most 2 delegations per task/,
    );
  });

  it('caps the non-blocking questions left open in a run', async () => {
    const ask = (question: string) => ({
      question,
      options: ['Sì', 'No'],
      blocking: false,
      kind: 'publish',
    });
    const t = await startTestHub(
      {
        titan: [
          fake.toolCall('ask_user', ask('Pubblico il primo post?')),
          fake.toolCall('ask_user', ask('Pubblico il secondo post?')),
          fake.text('Ti ho chiesto del primo; per il secondo aspetto.'),
        ],
      },
      { hub: { settings: { limits: { maxOpenQuestionsPerRun: 1 } } } },
    );
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'pubblica' });
    await t.runEnded(sent.runId);
    expect(t.core.hub.questions.list({ runId: sent.runId })).toHaveLength(1);
    expect(failedResults(t.events(sent.runId), 'ask_user')[0]!.data.error).toMatch(
      /LIMIT_REACHED: .*at most 1 open questions/,
    );
  });

  it('stops the run when its model steps are used up', async () => {
    const t = await startTestHub(
      {
        titan: [
          fake.toolCall('web_search', { query: 'uno' }),
          fake.toolCall('web_search', { query: 'due' }),
          fake.toolCall('web_search', { query: 'tre' }),
          fake.text('Mai raggiunto.'),
        ],
      },
      { hub: { settings: { limits: { maxRunSteps: 2 } } } },
    );
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'cerca' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    expect(t.provider.callsTo('titan')).toHaveLength(2);
    const stop = t
      .events(sent.runId)
      .find((e): e is LogEvent<'error'> => e.type === 'error' && e.data.code === 'run_limit');
    expect(stop?.data.message).toContain('2 model steps');
  });

  it('counts steps and tokens across the agents of a run', () => {
    const budget = new RunBudget(RunLimitsSchema.parse({ maxRunTokens: 1000, maxRunSteps: 10 }));
    budget.addStep(600);
    expect(budget.exhausted()).toBeNull();
    const release = budget.beginDelegation();
    budget.addStep(500);
    release();
    expect(budget.exhausted()).toContain('1000 tokens');
    expect(() => budget.assertActive()).toThrow(ToolError);
    expect(() => budget.beginDelegation()).toThrow(/LIMIT|limit reached/);
    expect(RunLimitsSchema.parse({})).toEqual({
      maxParallelDelegations: 4,
      maxDelegationsPerRun: 12,
      maxOpenQuestionsPerRun: 3,
      maxRunSteps: 150,
      maxRunTokens: 1_500_000,
      maxRunCostUsd: 0.5,
      maxSubagentTokens: 400_000,
    });
  });

  it('a cost limit is written like the instinct’s costs: the language’s decimal separator (C13)', () => {
    const budget = (): RunBudget => {
      const b = new RunBudget(RunLimitsSchema.parse({ maxRunCostUsd: 1.5 }));
      b.addStep(10, 1.6);
      return b;
    };
    expect(budget().exhausted()).toBe('this task spent its 1.5 $ limit');
    inLang('it');
    expect(budget().exhausted()).toBe('questo compito ha speso il suo limite di 1,5 $');
  });

  it('a lead’s run keeps its steps and delegations; the cost has one limit for the tree (F-A6)', () => {
    const parent = new RunBudget(
      RunLimitsSchema.parse({ maxRunSteps: 10, maxRunCostUsd: 1, maxDelegationsPerRun: 3 }),
    );
    expect(treeCostLimit(parent.limits)).toBe(3);
    parent.addStep(100, 0.9);
    parent.assertSendRoom();
    parent.countSend();
    const child = new RunBudget(
      RunLimitsSchema.parse({ maxRunSteps: 150, maxRunCostUsd: 2, maxDelegationsPerRun: 3 }),
      parent,
    );
    // Its own steps and delegations: the sender's are not shared (review of 19/10, item 6).
    expect(child.stepsLeft()).toBe(150);
    for (let i = 0; i < 3; i++) child.beginDelegation()();
    expect(() => child.beginDelegation()).toThrow(/at most 3 delegations per task/);
    expect(parent.usage).toMatchObject({ steps: 1, delegations: 1 });
    // The sender over its own 1 $ does not stop the lead: the tree has 3 $.
    parent.addStep(10, 0.2);
    expect(parent.exhausted()).toMatch(/1 \$ limit/);
    child.addStep(100, 0.9);
    expect(child.exhausted()).toBeNull();
    // A second lead's run: together they reach the tree's limit, and everyone stops.
    parent.countSend();
    const other = new RunBudget(RunLimitsSchema.parse({ maxRunCostUsd: 2 }), parent);
    other.addUsage(50, 1.1);
    expect(other.exhausted()).toMatch(/3 \$ limit \(with the work sent to projects\)/);
    expect(child.exhausted()).toMatch(/3 \$ limit/);
    expect(parent.usage.costUsd).toBeCloseTo(1.1);
    // Every send is a delegation of the sender.
    const fresh = new RunBudget(RunLimitsSchema.parse({ maxDelegationsPerRun: 2 }));
    fresh.countSend();
    fresh.countSend();
    expect(() => fresh.assertSendRoom()).toThrow(/at most 2 delegations per task/);
    // `maxTreeCostUsd` sets it.
    expect(treeCostLimit(RunLimitsSchema.parse({ maxTreeCostUsd: 2 }))).toBe(2);
  });
});
