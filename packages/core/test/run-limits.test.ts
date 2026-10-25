import { fake } from '@monsters/providers/testing';
import { ToolError, type LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  agentTokenLimit,
  applyRunLimitsUpdate,
  DEFAULT_RUN_LIMITS,
  mergeRunLimits,
  RunBudget,
  RunLimitsSchema,
  runLimitsToSave,
  runLimitsView,
  treeCostLimit,
} from '../src/index.ts';
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
      plan: { maxRunSteps: 400, maxRunTokens: 5_000_000, maxSubagentTokens: 1_500_000 },
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

  it('counts the requests of a subscription harness apart, with caps of their own', () => {
    const budget = new RunBudget(
      RunLimitsSchema.parse({
        maxRunSteps: 2,
        maxRunTokens: 2000,
        plan: { maxRunSteps: 5, maxRunTokens: 9000 },
      }),
    );
    // Four harness requests would stop the API's two steps, not the plan's five.
    for (let i = 0; i < 4; i++) budget.addStep(1000, 0, true);
    expect(budget.usage).toMatchObject({ steps: 0, tokens: 0, planSteps: 4, planTokens: 4000 });
    expect(budget.exhausted()).toBeNull();
    // The last-step-without-tools logic is about the API steps.
    expect(budget.stepsLeft()).toBe(2);
    budget.addUsage(5000, 0, true);
    expect(budget.exhaustedBy()).toEqual({
      message: 'this task used all its 9000 tokens on the subscription',
      limit: { kind: 'tokens', value: 9000, plan: true },
    });
    const steps = new RunBudget(RunLimitsSchema.parse({ plan: { maxRunSteps: 2 } }));
    steps.addStep(10, 0, true);
    steps.addStep(10, 0, true);
    expect(steps.exhaustedBy()).toEqual({
      message: 'this task used all its 2 model steps on the subscription',
      limit: { kind: 'steps', value: 2, plan: true },
    });
    inLang('it');
    expect(steps.exhausted()).toBe(
      'questo compito ha usato tutti i suoi 2 passi del modello sull’abbonamento',
    );
  });

  it('API steps and tokens are checked against the API caps only', () => {
    const budget = new RunBudget(
      RunLimitsSchema.parse({ maxRunSteps: 2, plan: { maxRunSteps: 1 } }),
    );
    budget.addStep(10);
    budget.addStep(10);
    expect(budget.exhaustedBy()).toEqual({
      message: 'this task used all its 2 model steps',
      limit: { kind: 'steps', value: 2 },
    });
  });

  it('says the cost, the tree and the spending cap as data too', () => {
    const cost = new RunBudget(RunLimitsSchema.parse({ maxRunCostUsd: 1 }));
    cost.addStep(10, 1.2);
    expect(cost.exhaustedBy()?.limit).toEqual({ kind: 'cost', value: 1 });
    const tree = new RunBudget(RunLimitsSchema.parse({ maxRunCostUsd: 10, maxTreeCostUsd: 2 }));
    tree.addStep(10, 2.5);
    expect(tree.exhaustedBy()?.limit).toEqual({ kind: 'tree_cost', value: 2 });
    const spend = new RunBudget(RunLimitsSchema.parse({}));
    spend.spendCheck = (id) => (id === 'rhea' ? 'the cap is reached' : null);
    expect(spend.exhaustedBy('titan')).toBeNull();
    expect(spend.exhaustedBy('rhea')).toEqual({
      message: 'the cap is reached',
      limit: { kind: 'spend' },
    });
    expect(spend.exhausted('rhea')).toBe('the cap is reached');
  });

  it('a delegated agent on a harness uses the plan’s token limit; its own limit wins', () => {
    const limits = RunLimitsSchema.parse({});
    const sub = { kind: 'subagent' as const, limits: {} };
    expect(agentTokenLimit(sub, limits)).toBe(400_000);
    expect(agentTokenLimit(sub, limits, true)).toBe(1_500_000);
    expect(agentTokenLimit({ ...sub, limits: { maxTotalTokens: 7000 } }, limits, true)).toBe(7000);
    expect(agentTokenLimit({ kind: 'lead', limits: {} }, limits, true)).toBeUndefined();
  });

  it('an automation’s limits merge over the settings’, the plan field by field', () => {
    const base = RunLimitsSchema.parse({ plan: { maxRunTokens: 8_000_000 } });
    const merged = mergeRunLimits(base, { maxRunSteps: 20, plan: { maxRunSteps: 20 } });
    expect(merged).toMatchObject({
      maxRunSteps: 20,
      plan: { maxRunSteps: 20, maxRunTokens: 8_000_000, maxSubagentTokens: 1_500_000 },
    });
    expect(mergeRunLimits(base, undefined)).toBe(base);
    expect(mergeRunLimits(base, { maxRunCostUsd: 2 }).plan).toEqual(base.plan);
  });

  it('keeps in settings.json only what differs from the defaults', () => {
    expect(runLimitsToSave(DEFAULT_RUN_LIMITS)).toBeNull();
    const next = applyRunLimitsUpdate(DEFAULT_RUN_LIMITS, {
      maxRunSteps: 300,
      plan: { maxRunTokens: 9_000_000 },
    });
    expect(runLimitsToSave(next)).toEqual({ maxRunSteps: 300, plan: { maxRunTokens: 9_000_000 } });
    // What is not sent stays; the view shows the defaults to reset to.
    expect(applyRunLimitsUpdate(next, { maxRunCostUsd: 2 })).toMatchObject({
      maxRunSteps: 300,
      maxRunCostUsd: 2,
    });
    expect(runLimitsView(next).defaults.plan.maxRunSteps).toBe(400);
  });

  describe('the limits of each job in the settings', () => {
    const limitsOf = (home: string) =>
      (JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')) as { limits?: unknown })
        .limits;

    it('shows, saves, validates and resets them; new runs use them at once', async () => {
      const t = await startTestHub({
        titan: [
          fake.toolCall('web_search', { query: 'uno' }),
          fake.toolCall('web_search', { query: 'due' }),
          fake.toolCall('web_search', { query: 'tre' }),
          fake.text('Fatto.'),
        ],
      });
      const first = await t.json<{
        limits: { maxRunSteps: number; plan: { maxRunSteps: number } };
        defaults: { maxRunSteps: number };
      }>('GET', '/api/settings/limits');
      expect(first.limits).toMatchObject({ maxRunSteps: 150, plan: { maxRunSteps: 400 } });
      expect(first.defaults.maxRunSteps).toBe(150);
      expect(limitsOf(t.home)).toBeUndefined();

      // Out of bounds, or not a number: refused, nothing saved.
      for (const bad of [{ maxRunSteps: 0 }, { maxRunTokens: 5 }, { plan: { maxRunSteps: 1.5 } }]) {
        const res = await t.api('PUT', '/api/settings/limits', bad);
        expect([bad, res.status]).toEqual([bad, 400]);
      }
      expect(limitsOf(t.home)).toBeUndefined();

      const saved = await t.json<{ limits: { maxRunSteps: number } }>(
        'PUT',
        '/api/settings/limits',
        {
          maxRunSteps: 2,
          plan: { maxRunSteps: 800 },
        },
      );
      expect(saved.limits).toMatchObject({ maxRunSteps: 2, plan: { maxRunSteps: 800 } });
      expect(limitsOf(t.home)).toEqual({ maxRunSteps: 2, plan: { maxRunSteps: 800 } });
      // Without a restart: the next run stops at two steps and says which cap it was.
      const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'cerca' });
      await t.runEnded(sent.runId);
      expect(t.provider.callsTo('titan')).toHaveLength(2);
      const stop = t
        .events(sent.runId)
        .find((e): e is LogEvent<'error'> => e.type === 'error' && e.data.code === 'run_limit');
      expect(stop?.data.limit).toEqual({ kind: 'steps', value: 2 });

      const again = await t.json<{ limits: { maxRunSteps: number } }>(
        'PUT',
        '/api/settings/limits',
        {
          maxRunCostUsd: 3,
        },
      );
      expect(again.limits).toMatchObject({ maxRunSteps: 2, maxRunCostUsd: 3 });

      const reset = await t.json<{ limits: { maxRunSteps: number; maxRunCostUsd: number } }>(
        'DELETE',
        '/api/settings/limits',
      );
      expect(reset.limits).toMatchObject({ maxRunSteps: 150, maxRunCostUsd: 0.5 });
      expect(limitsOf(t.home)).toBeUndefined();
    });

    it('is kept across a restart', async () => {
      const first = await startTestHub({});
      await first.json('PUT', '/api/settings/limits', { plan: { maxSubagentTokens: 2_000_000 } });
      await first.core.close();
      const again = await startTestHub({}, { home: first.home, withoutTeam: true });
      const view = await again.json<{ limits: { plan: { maxSubagentTokens: number } } }>(
        'GET',
        '/api/settings/limits',
      );
      expect(view.limits.plan.maxSubagentTokens).toBe(2_000_000);
    });
  });
});
