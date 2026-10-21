import { fake } from '@monsters/providers/testing';
import type { AgentSummary, LogEvent, Question } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  createCoreServices,
  migrate,
  QuestionStore,
  readsAsAnswer,
  teamMigrations,
  type CoreServices,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { promptText, startTestHub, toolResultsSeen } from './hub-helpers.ts';
import { inLang } from './prompt-lang.ts';

/*
 * D-078: questions do not expire on their own. When nothing waits for one
 * (a harness ended its turn, a native wait reached its limit, the run ended,
 * the core restarted) it is parked: still open, its answer starts a new run.
 */

type Sent = { runId: string; agent: string; queued: boolean; answered?: string };

const isType =
  <T extends LogEvent['type']>(
    type: T,
    extra: (e: Extract<LogEvent, { type: T }>) => boolean = () => true,
  ) =>
  (e: LogEvent): e is Extract<LogEvent, { type: T }> =>
    e.type === type && extra(e as Extract<LogEvent, { type: T }>);

function store(home = tempHome()): { s: CoreServices; q: QuestionStore } {
  const s = createCoreServices({ home });
  migrate(s.db, 'team', teamMigrations);
  return { s, q: new QuestionStore(s.db, s.log) };
}

function close(s: CoreServices): void {
  s.db.close();
  s.lock.release();
}

const ask = (q: QuestionStore, runId: string, kind: 'ask' | 'brake' = 'ask', blocking = true) =>
  q.create({
    agent: 'titan',
    runId,
    question: kind === 'brake' ? 'Titan vuole pubblicare: procedo?' : 'Che tono?',
    options: [
      { id: '1', label: 'Ironico' },
      { id: '2', label: 'Serio' },
    ],
    blocking,
    kind,
  });

describe('QuestionStore: parked questions', () => {
  it('a run that ends parks its questions and expires the cards of the brake', () => {
    const { s, q } = store();
    const mine = ask(q, 'r1');
    const side = ask(q, 'r1', 'ask', false);
    const brake = ask(q, 'r1', 'brake');
    const other = ask(q, 'r2');
    expect(q.settleRun('r1')).toBe(2);
    expect(q.get(mine.id)).toMatchObject({ status: 'open', parked: true });
    expect(q.get(side.id)).toMatchObject({ status: 'open', parked: true });
    expect(q.get(brake.id)?.status).toBe('expired');
    expect(q.get(other.id)?.parked).toBeUndefined();
    // Nothing is left open with nothing behind it: settling again changes nothing.
    expect(q.settleRun('r1')).toBe(2);
    const events = s.log.query({ runId: 'r1', limit: 100 });
    expect(
      events.filter(isType('question_parked')).map((e) => [e.data.questionId, e.data.reason]),
    ).toEqual([
      [mine.id, 'run_ended'],
      [side.id, 'run_ended'],
    ]);
    expect(events.filter(isType('question_expired')).map((e) => e.data.reason)).toEqual([
      'run_ended',
    ]);
    // Newest first.
    expect(q.parked('titan').map((x) => x.id)).toEqual([side.id, mine.id]);
    // A card of the brake never parks.
    expect(q.park(brake.id, 'harness')).toBe(false);
    close(s);
  });

  it('parked questions survive a restart; open ones of a previous core are parked', () => {
    const home = tempHome();
    const first = store(home);
    const parked = ask(first.q, 'r1');
    first.q.park(parked.id, 'harness');
    const waiting = ask(first.q, 'r2');
    const brake = ask(first.q, 'r2', 'brake');
    close(first.s);

    const second = store(home);
    expect(second.q.settleAtStartup()).toEqual({ parked: 1, expired: 1 });
    expect(second.q.get(parked.id)).toMatchObject({ status: 'open', parked: true });
    expect(second.q.get(waiting.id)).toMatchObject({ status: 'open', parked: true });
    expect(second.q.get(brake.id)?.status).toBe('expired');
    const reasons = second.s.log
      .query({ type: 'question_parked', limit: 10 })
      .filter(isType('question_parked'))
      .map((e) => [e.data.questionId, e.data.reason]);
    expect(reasons).toEqual([
      [parked.id, 'harness'],
      [waiting.id, 'restart'],
    ]);
    // Answered once, never twice.
    second.q.answer(waiting.id, { optionId: '1' }, 'ui');
    expect(() => second.q.answer(waiting.id, { optionId: '2' }, 'ui')).toThrow(/is answered/);
    expect(second.q.get(waiting.id)?.parked).toBeUndefined();
    close(second.s);
  });

  it('tells the listeners whether a wait received the answer', async () => {
    const { s, q } = store();
    const seen: [string, boolean][] = [];
    q.onAnswer((x, info) => seen.push([x.id, info.woke]));
    const held = ask(q, 'r1');
    const wait = q.waitFor(held.id, new AbortController().signal);
    expect(q.isAwaited(held.id)).toBe(true);
    q.answer(held.id, { optionId: '1' }, 'ui');
    expect(await wait).toEqual({ optionId: '1' });
    const loose = ask(q, 'r1');
    q.park(loose.id, 'harness');
    q.answer(loose.id, { text: 'serio' }, 'ui');
    expect(seen).toEqual([
      [held.id, true],
      [loose.id, false],
    ]);
    // A wait that gave up is no longer counted.
    const late = ask(q, 'r1');
    const ac = new AbortController();
    const gone = q.waitFor(late.id, ac.signal);
    ac.abort(new Error('timeout'));
    await expect(gone).rejects.toThrow('timeout');
    expect(q.isAwaited(late.id)).toBe(false);
    close(s);
  });
});

const tone = () =>
  fake.toolCall('ask_user', {
    question: 'Che tono?',
    options: ['Ironico', 'Serio'],
    kind: 'taste',
  });

describe('ask_user that does not hold the run (native, 10 minutes)', () => {
  it('past the wait the question parks, the run ends waiting, the card answer starts a new run', async () => {
    inLang('it');
    const t = await startTestHub(
      {
        titan: [
          tone(),
          fake.text('Aspetto la tua risposta sul tono.'),
          fake.text('Ok, scrivo i post con tono ironico.'),
        ],
      },
      { lang: 'it', hub: { askWaitMs: 80 } },
    );
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'scrivi 3 post' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('waiting_user');
    // The model was told to end its turn, not that the question expired.
    const result = toolResultsSeen(t.provider.calls[1]!.options.prompt);
    expect(result).toContain('"status":"waiting_user"');
    expect(result).toContain('End your turn now');
    expect(result).not.toContain('expired');

    const [open] = await t.json<Question[]>('GET', '/api/questions?status=open');
    expect(open).toMatchObject({ question: 'Che tono?', status: 'open', parked: true });
    const parked = t.events(sent.runId).find(isType('question_parked'))!;
    expect(parked.data).toEqual({ questionId: open!.id, reason: 'timeout' });
    // Nothing runs, the monster waits for the user.
    expect(t.core.runs.activeRuns()).toEqual([]);
    const agents = await t.json<AgentSummary[]>('GET', '/api/agents');
    const titan = agents.find((a) => a.id === 'titan');
    expect(titan?.state).toBe('waiting');
    expect(titan?.activity).toContain('Che tono?');

    await t.json('POST', `/api/questions/${open!.id}/answer`, { optionId: '1' });
    const next = await t.waitEvent(
      isType('run', (e) => e.data.status === 'started' && e.runId !== sent.runId),
    );
    expect(next.agent).toBe('titan');
    expect((await t.runEnded(next.runId!)).data.status).toBe('completed');
    const seen = promptText(t.provider.calls[2]!.options.prompt);
    expect(seen).toContain('Risposta alla tua domanda \\"Che tono?\\": Ironico');
    // The earlier turn is there: the request and the line that waited.
    expect(seen).toContain('scrivi 3 post');
    expect(seen).toContain('Aspetto la tua risposta sul tono.');
    expect((await t.json<Question[]>('GET', '/api/questions?status=open')).length).toBe(0);
    const after = await t.json<AgentSummary[]>('GET', '/api/agents');
    expect(after.find((a) => a.id === 'titan')?.state).toBe('idle');
    // Answered once: a second answer is refused.
    expect(
      (await t.api('POST', `/api/questions/${open!.id}/answer`, { optionId: '2' })).status,
    ).toBe(409);
  });

  it('an answer within the wait goes on in the same run (no restart)', async () => {
    const t = await startTestHub({
      titan: [tone(), fake.text('Ok, ironico.')],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'scrivi 3 post' });
    const q = await t.waitEvent(isType('question'));
    await new Promise((r) => setTimeout(r, 150));
    await t.json('POST', `/api/questions/${q.data.questionId}/answer`, { optionId: '1' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    expect(t.events().filter(isType('question_parked'))).toEqual([]);
    expect(t.events().filter(isType('run', (e) => e.data.status === 'started'))).toHaveLength(1);
  });

  it('a plain message to a monster that waits on a parked question is its answer', async () => {
    inLang('it');
    const t = await startTestHub(
      {
        titan: [
          tone(),
          fake.text('Aspetto la tua risposta sul tono.'),
          fake.text('Ok: tono serio.'),
          fake.text('Ecco la lista delle novità.'),
        ],
      },
      { lang: 'it', hub: { askWaitMs: 50 } },
    );
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'scrivi 3 post' });
    await t.runEnded(sent.runId);
    const [open] = await t.json<Question[]>('GET', '/api/questions?status=open');
    const typed = await t.json<Sent>('POST', '/api/messages', { text: 'serio, grazie' });
    expect(typed).toMatchObject({ agent: 'titan', queued: false, answered: open!.id });
    expect(typed.runId).not.toBe(sent.runId);
    expect((await t.runEnded(typed.runId)).data.status).toBe('completed');
    const answered = await t.json<Question[]>('GET', '/api/questions?status=answered');
    expect(answered[0]).toMatchObject({ id: open!.id, answer: { text: 'serio, grazie' } });
    // The answer names the message that gave it (a requeue after a restart reads it again).
    const message = t
      .events(typed.runId)
      .find(isType('message', (e) => e.agent === 'user' && e.data.text === 'serio, grazie'))!;
    expect(t.events().find(isType('answer'))!.data.message).toBe(message.id);
    const prompt = promptText(t.provider.calls[2]!.options.prompt);
    expect(prompt).toContain('Risposta alla tua domanda \\"Che tono?\\": serio, grazie');
    // The answer is in the request once, not again as an earlier turn.
    expect(prompt.split('serio, grazie')).toHaveLength(2);
    // The next message is a message again.
    const plain = await t.json<Sent>('POST', '/api/messages', { text: 'novità?' });
    expect(plain.answered).toBeUndefined();
    await t.runEnded(plain.runId);
    expect(promptText(t.provider.calls[3]!.options.prompt)).toContain('novità?');
  });

  it('past the window a plain message is a new request, with one line on the open question (D-079)', async () => {
    inLang('it');
    const t = await startTestHub(
      {
        titan: [
          tone(),
          fake.text('Aspetto la tua risposta sul tono.'),
          fake.text('Ecco le novità.'),
          fake.text('Ok: tono serio.'),
        ],
      },
      { lang: 'it', hub: { askWaitMs: 50, parkedAnswerWindowMs: -1 } },
    );
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'scrivi 3 post' });
    await t.runEnded(sent.runId);
    const [open] = await t.json<Question[]>('GET', '/api/questions?status=open');
    const typed = await t.json<Sent>('POST', '/api/messages', { text: 'novità di oggi?' });
    expect(typed.answered).toBeUndefined();
    await t.runEnded(typed.runId);
    const prompt = promptText(t.provider.calls[2]!.options.prompt);
    expect(prompt).toContain('novità di oggi?');
    expect(prompt).toContain('Hai una domanda ancora aperta per Giulio: «Che tono?»');
    // The card still answers it, and its answer starts the work again.
    const [still] = await t.json<Question[]>('GET', '/api/questions?status=open');
    expect(still).toMatchObject({ id: open!.id, parked: true });
    await t.json('POST', `/api/questions/${open!.id}/answer`, { optionId: '2' });
    const next = await t.waitEvent(
      isType(
        'run',
        (e) => e.data.status === 'started' && e.runId !== sent.runId && e.runId !== typed.runId,
      ),
    );
    await t.runEnded(next.runId!);
    expect(promptText(t.provider.calls[3]!.options.prompt)).toContain(
      'Risposta alla tua domanda \\"Che tono?\\": Serio',
    );
  });

  it('with options, a message that picks none is a new request; without options it is the answer (review of 16/10)', async () => {
    inLang('it');
    const t = await startTestHub(
      {
        titan: [
          tone(),
          fake.text('Aspetto la tua risposta sul tono.'),
          fake.text('Domani a Milano sole.'),
          fake.toolCall('ask_user', { question: 'Quali novità ci sono questo mese?' }),
          fake.text('Aspetto le novità.'),
          fake.text('Ok, scrivo delle cassate.'),
        ],
      },
      { lang: 'it', hub: { askWaitMs: 50 } },
    );
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'scrivi 3 post' });
    await t.runEnded(sent.runId);
    const [open] = await t.json<Question[]>('GET', '/api/questions?status=open');
    // A new request, not "Ironico" nor "Serio": it starts a run of its own, the card stays.
    const typed = await t.json<Sent>('POST', '/api/messages', {
      text: 'che tempo fa domani a Milano',
    });
    expect(typed.answered).toBeUndefined();
    await t.runEnded(typed.runId);
    const prompt = promptText(t.provider.calls[2]!.options.prompt);
    expect(prompt).not.toContain('Risposta alla tua domanda');
    expect(prompt).toContain('Hai una domanda ancora aperta per Giulio: «Che tono?»');
    const [still] = await t.json<Question[]>('GET', '/api/questions?status=open');
    expect(still).toMatchObject({ id: open!.id, parked: true });
    // An open question (no options): the next plain message is its answer, whatever it says.
    await t.json('POST', `/api/questions/${open!.id}/answer`, { optionId: '1' });
    const asked = await t.json<Sent>('POST', '/api/messages', { text: 'scrivi la newsletter' });
    await t.runEnded(asked.runId);
    const free = (await t.json<Question[]>('GET', '/api/questions?status=open')).find(
      (q) => q.options.length === 0,
    );
    expect(free).toBeDefined();
    const reply = await t.json<Sent>('POST', '/api/messages', {
      text: 'abbiamo le cassate nuove e il cannolo al pistacchio',
    });
    expect(reply.answered).toBe(free!.id);
  });

  it('open questions of a core before D-078 expire at the upgrade, never parked (D-079)', async () => {
    // An alpha.6 database: team migrations up to 1, a brake card left open.
    const home = tempHome();
    const old = createCoreServices({ home });
    migrate(old.db, 'team', teamMigrations.slice(0, 1));
    old.db.run(
      `INSERT INTO questions (id, agent, run_id, event_id, question, options, recommended, blocking, status, created_at)
       VALUES ('01JQOLDBRAKE0000000000000A', 'titan', '01JQOLDRUN00000000000000AA', NULL,
               'Titan vuole pubblicare: procedo?', '[{"id":"yes","label":"Sì"},{"id":"no","label":"No"}]',
               'no', 1, 'open', 1)`,
    );
    close(old);
    const t = await startTestHub({ titan: [] }, { home });
    expect(await t.json<Question[]>('GET', '/api/questions?status=open')).toEqual([]);
    const events = t.events();
    expect(events.filter(isType('question_parked'))).toEqual([]);
    expect(events.filter(isType('question_expired')).map((e) => e.data)).toEqual([
      { questionId: '01JQOLDBRAKE0000000000000A', reason: 'restart' },
    ]);
    // A later "Sì" is refused: nothing starts with a stale approval.
    const late = await t.api('POST', '/api/questions/01JQOLDBRAKE0000000000000A/answer', {
      optionId: 'yes',
    });
    expect(late.ok).toBe(false);
  });

  it('parked questions survive a restart of the core, and their answer starts the work again', async () => {
    inLang('it');
    const t = await startTestHub({ titan: [tone()] }, { lang: 'it' });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'scrivi 3 post' });
    const q = await t.waitEvent(isType('question'));
    // The core closes while the native run still waits on the question.
    await t.core.close();

    const again = await startTestHub(
      { titan: [fake.text('Ok, ironico come chiedi.')] },
      { home: t.home, withoutTeam: true, lang: 'it' },
    );
    const [open] = await again.json<Question[]>('GET', '/api/questions?status=open');
    expect(open).toMatchObject({ id: q.data.questionId, status: 'open', parked: true });
    expect(
      again
        .events(sent.runId)
        .filter(isType('question_parked'))
        .map((e) => e.data.reason),
    ).toEqual(['restart']);
    expect(again.events(sent.runId).filter(isType('question_expired'))).toEqual([]);
    const agents = await again.json<AgentSummary[]>('GET', '/api/agents');
    expect(agents.find((a) => a.id === 'titan')?.state).toBe('waiting');

    await again.json('POST', `/api/questions/${open!.id}/answer`, { optionId: '1' });
    const next = await again.waitEvent(
      isType('run', (e) => e.data.status === 'started' && e.runId !== sent.runId),
    );
    expect((await again.runEnded(next.runId!)).data.status).toBe('completed');
    expect(promptText(again.provider.calls[0]!.options.prompt)).toContain(
      'Risposta alla tua domanda \\"Che tono?\\": Ironico',
    );
  });

  it('stopping the work or the kill switch still expire a parked question', async () => {
    const t = await startTestHub(
      { titan: [tone(), fake.text('Aspetto.')] },
      { hub: { askWaitMs: 30 } },
    );
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'scrivi' });
    await t.runEnded(sent.runId);
    const [open] = await t.json<Question[]>('GET', '/api/questions?status=open');
    expect(open?.parked).toBe(true);
    await t.json('POST', '/api/kill', { reason: 'basta' });
    const expired = await t.waitEvent(isType('question_expired'));
    expect(expired.data).toEqual({ questionId: open!.id, reason: 'kill' });
    expect(await t.json<Question[]>('GET', '/api/questions?status=open')).toEqual([]);
  });
});

describe('readsAsAnswer: a plain message as the answer to a question with options', () => {
  const q = {
    options: [
      { id: '1', label: 'Ironico' },
      { id: '2', label: 'Tono serio e pacato' },
    ],
  };
  it.each([
    'Ironico',
    'serio, grazie',
    'la seconda',
    'sì',
    '2',
    'nessuna delle due',
    'ok',
    'va bene così',
    'b',
    'preferisco il tono serio e pacato',
  ])('"%s" answers', (text) => {
    expect(readsAsAnswer(q, text)).toBe(true);
  });
  it.each([
    'che tempo fa domani a Milano',
    'scrivimi una mail per il commercialista sulle fatture di settembre',
    'ok, ora cercami i voli per Lisbona di venerdì prossimo',
    'a che ora apre la posta?',
    'la lista delle cose da fare',
    '',
  ])('"%s" is a new request', (text) => {
    expect(readsAsAnswer(q, text)).toBe(false);
  });
  it('a question without options takes any message', () => {
    expect(readsAsAnswer({ options: [] }, 'scrivimi una mail per il commercialista')).toBe(true);
  });
});
