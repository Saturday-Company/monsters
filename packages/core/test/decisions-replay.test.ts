import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CachingPort,
  calibration,
  casesFromEvents,
  loadCasesFromHome,
  loadLabeledCases,
  RecordedPort,
  replayCases,
  summarize,
  type DecisionCase,
} from '../eval/decisions/replay.ts';
import {
  createCoreServices,
  JevDecisionPort,
  migrate,
  QuestionStore,
  teamMigrations,
  type SystemOneRequest,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';

/** A fake TypeSafe: "needs the user" when the question talks about money or posting. */
function fakeJevFetch(): { fetch: typeof fetch; calls: number } {
  const state = { calls: 0 };
  const f: typeof fetch = (_input, init) => {
    state.calls++;
    const body = JSON.parse(init!.body as string) as {
      state: { question: string; options: string[]; recommended: string | null };
      questions: Record<string, { type: string }>;
    };
    const risky = /pubblic|€|\$|mail/i.test(body.state.question);
    const answers: Record<string, unknown> = {
      needs_user: { type: 'noul', noul: risky ? 0.9 : 0.03 },
    };
    // Since D-067 `recommended` is not in the state and the options are shuffled:
    // the fake picks the first option in alphabetical order, whatever the order shown.
    for (const id of ['option', 'option_rev']) {
      if (!body.questions[id]) continue;
      answers[id] = {
        type: 'choice',
        choice: body.state.recommended ?? [...body.state.options].sort()[0],
        probabilities: {},
        confidence: 0.85,
      };
    }
    if (body.questions['kind']) {
      answers['kind'] = { type: 'choice', choice: 'local', probabilities: {}, confidence: 0.9 };
    }
    return Promise.resolve(
      Response.json({
        model: 'jev-1.13.0',
        answers,
        usage: { input_tokens: 500, output_tokens: 10 },
      }),
    );
  };
  return {
    fetch: f,
    get calls() {
      return state.calls;
    },
  };
}

describe('decision replay (offline measure of the System 1)', () => {
  it('the hand-labelled set is valid: 20-40 Italian cases, all labelled', () => {
    const cases = loadLabeledCases();
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(cases.length).toBeLessThanOrEqual(40);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.expected).toBeDefined();
      expect(c.options.length).toBeGreaterThanOrEqual(2);
      if (c.recommended) expect(c.options).toContain(c.recommended);
      if (c.userChoice) expect(c.options).toContain(c.userChoice);
    }
    expect(cases.filter((c) => c.expected === 'ask').length).toBeGreaterThan(10);
    expect(cases.filter((c) => c.expected === 'proceed').length).toBeGreaterThan(8);
  });

  it('on the labelled set the rules alone never go on when the user had to be asked', async () => {
    // No model: the gray zone is asked, so every "proceed" comes from a rule.
    const down = new CachingPort({
      id: 'down',
      decide: (_r: SystemOneRequest) => Promise.reject(new Error('offline')),
    });
    const results = await replayCases(loadLabeledCases(), down, { mode: 'gate' });
    const proceeded = results.filter((r) => r.outcome === 'proceed');
    expect(proceeded.length).toBeGreaterThan(0);
    expect(proceeded.every((r) => r.decidedBy === 'rules')).toBe(true);
    // "Il riassunto lo vuoi lungo o corto?" used to pass as local ("riassunto").
    expect(results.find((r) => r.id === 'gusto-06')).toMatchObject({
      outcome: 'ask',
      rule: 'taste',
    });
    expect(summarize(results).expected.wrongProceed).toBe(0);
    // Days with their accent ("lunedì", "venerdì") are facts for the rules (AG-02).
    for (const id of ['fatti-02', 'fatti-05', 'fatti-06', 'fatti-07']) {
      expect(
        results.find((r) => r.id === id),
        id,
      ).toMatchObject({ outcome: 'ask', rule: 'facts' });
    }
  });

  it('rescores the gate on the recorded Jev answers, without calls: not worse than D-037', async () => {
    const recorded = RecordedPort.fromFile(
      join(import.meta.dirname, 'fixtures/decisions-conferma-2026-10-14.json'),
    );
    const results = await replayCases(loadLabeledCases(), new CachingPort(recorded), {
      mode: 'gate',
    });
    const report = summarize(results);
    // D-037: 29/34 right, 0 wrong "proceed"; the three cases added since go by the rules.
    expect(report.expected.wrongProceed).toBe(0);
    expect(report.expected.correct).toBeGreaterThanOrEqual(32);
    expect(results.find((r) => r.id === 'fatti-03')).toMatchObject({
      outcome: 'ask',
      rule: 'facts',
    });
    expect(results.find((r) => r.id === 'locale-13')).toMatchObject({
      outcome: 'proceed',
      rule: 'local',
    });
  });

  it('reads the user choices from the log of a MONSTERS_HOME (read-only)', () => {
    const home = tempHome();
    const s = createCoreServices({ home });
    migrate(s.db, 'team', teamMigrations);
    const questions = new QuestionStore(s.db, s.log);
    s.log.append({
      agent: 'titan',
      runId: 'r1',
      type: 'run',
      data: { status: 'started', goal: 'Post di lancio' },
    });
    const q1 = questions.create({
      agent: 'titan',
      runId: 'r1',
      question: 'Quale bozza preferisci?',
      options: [
        { id: 'a', label: 'Bozza A' },
        { id: 'b', label: 'Bozza B' },
      ],
      recommended: 'a',
      blocking: true,
    });
    const q2 = questions.create({
      agent: 'titan',
      runId: 'r1',
      question: 'Salvo in Inbox?',
      options: [
        { id: 'si', label: 'Sì' },
        { id: 'no', label: 'No' },
      ],
      recommended: 'si',
      blocking: true,
    });
    const q3 = questions.create({
      agent: 'titan',
      runId: 'r1',
      question: 'Come si chiama il cliente?',
      options: [],
      blocking: true,
    });
    questions.answer(q1.id, { optionId: 'b' }, 'ui');
    questions.answer(q2.id, { optionId: 'si' }, 'ui');
    questions.answer(q3.id, { text: 'Rossi' }, 'ui');
    s.db.close();

    const cases = loadCasesFromHome(home);
    expect(cases).toHaveLength(2); // the open question has nothing to compare with
    expect(cases[0]).toMatchObject({
      source: 'log',
      question: 'Quale bozza preferisci?',
      options: ['Bozza A', 'Bozza B'],
      recommended: 'Bozza A',
      userChoice: 'Bozza B',
      // The user did not take the recommended option: asking was needed.
      expected: 'ask',
      context: 'Post di lancio',
    });
    expect(cases[1]).toMatchObject({ userChoice: 'Sì', recommended: 'Sì' });
    expect(cases[1]!.expected).toBeUndefined();
  });

  it('accepts exported log events too', () => {
    const cases = casesFromEvents([
      {
        id: '1',
        type: 'question',
        runId: 'r',
        data: {
          questionId: 'q',
          question: 'X?',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
          recommended: 'a',
          blocking: true,
        },
      },
      { id: '2', type: 'answer', runId: 'r', data: { questionId: 'q', optionId: 'a' } },
      {
        id: '3',
        type: 'decision',
        runId: 'r',
        parentId: '2',
        data: {
          kind: 'user_choice',
          question: 'X?',
          options: ['A', 'B'],
          choice: 'A',
          decidedBy: 'user',
        },
      },
    ]);
    expect(cases).toEqual([
      expect.objectContaining({ question: 'X?', recommended: 'A', userChoice: 'A' }),
    ]);
  });

  it('replays through the gate and the port alone, with metrics, cost and one call per case', async () => {
    const jev = fakeJevFetch();
    const port = new CachingPort(
      new JevDecisionPort({ key: 'ts-test-0123456789', fetch: jev.fetch }),
    );
    const cases: DecisionCase[] = [
      {
        id: 'a',
        source: 'labeled',
        agent: 'titan',
        question: 'Pubblico il post?',
        options: ['Sì', 'No'],
        recommended: 'Sì',
        expected: 'ask',
      },
      {
        id: 'b',
        source: 'labeled',
        agent: 'titan',
        question: 'Uso Progetti o Inbox?',
        options: ['Progetti', 'Inbox'],
        recommended: 'Progetti',
        expected: 'proceed',
        userChoice: 'Progetti',
      },
      {
        id: 'c',
        source: 'labeled',
        agent: 'titan',
        question: 'Metto online la pagina?',
        options: ['Sì', 'Aspetta'],
        recommended: 'Sì',
        expected: 'ask',
      },
      {
        id: 'd',
        source: 'log',
        agent: 'titan',
        question: 'Quale opzione?',
        options: ['X', 'Y'],
        userChoice: 'Y',
      },
    ];
    const port1 = await replayCases(cases, port, { mode: 'port' });
    expect(jev.calls).toBe(4);
    const gate = await replayCases(cases, port, { mode: 'gate' });
    // Same requests: the gate mode costs nothing more.
    expect(jev.calls).toBe(4);

    const p = summarize(port1);
    expect(p).toMatchObject({ cases: 4, modelAsked: 4, failures: 0 });
    // c ("metto online") goes on with Jev: the costly mistake.
    expect(p.expected).toMatchObject({ n: 3, correct: 2, wrongProceed: 1, needlessAsk: 0 });
    // The fake does not see the recommended option any more (D-067): its option never
    // echoes it, so it agrees with no user here.
    expect(p.userChoice).toMatchObject({
      n: 2,
      optionAgree: 0,
      optionN: 2,
      proceededRight: 1,
      proceededWrong: 1,
    });
    expect(p.cost).toMatchObject({ calls: 4, inputTokens: 2000 });
    expect(p.cost.costUsd).toBeCloseTo(0.000084);
    expect(p.calibration.needsUser.n).toBe(3);

    const g = summarize(gate);
    // "Pubblico" is asked by the rules, without the model.
    expect(gate.find((r) => r.id === 'a')).toMatchObject({
      outcome: 'ask',
      decidedBy: 'rules',
      modelAsked: false,
    });
    // What the gate would spend: only the gray zone reaches the model.
    expect(g.modelAsked).toBe(3);
    expect(g.cost.calls).toBe(3);
  });

  it('calibration: Brier and ECE', () => {
    expect(calibration([])).toEqual({ n: 0, brier: null, ece: null });
    const perfect = calibration([
      { p: 1, y: 1 },
      { p: 0, y: 0 },
    ]);
    expect(perfect.brier).toBe(0);
    expect(perfect.ece).toBe(0);
    const unsure = calibration([
      { p: 0.5, y: 1 },
      { p: 0.5, y: 0 },
    ]);
    expect(unsure.brier).toBe(0.25);
    expect(unsure.ece).toBe(0);
  });

  it('a failing port makes the gate ask and is counted', async () => {
    const failing = new CachingPort({
      id: 'down',
      decide: (_r: SystemOneRequest) => Promise.reject(new Error('402')),
    });
    const results = await replayCases(
      [
        {
          id: 'x',
          source: 'file',
          agent: 'titan',
          question: 'Uso A o B?',
          options: ['A', 'B'],
          recommended: 'A',
          expected: 'proceed',
        },
      ],
      failing,
      { mode: 'port' },
    );
    expect(results[0]).toMatchObject({ outcome: 'ask', failed: true, modelAsked: true });
    expect(summarize(results).expected.needlessAsk).toBe(1);
  });
});
