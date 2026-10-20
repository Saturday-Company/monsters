import { fake } from '@monsters/providers/testing';
import { resumeText, ulid, type LogEvent, type ResumeResponse } from '@monsters/shared';
import { describe, expect, it, vi } from 'vitest';
import { never, promptText, startTestHub } from './hub-helpers.ts';
import { requeueWaiting } from '../src/team/resume-work.ts';

/*
 * "Riprendi e continua" in the core (D-072): `POST /api/resume` with
 * `continue` starts again the requests the latest Ferma stopped, with a
 * message marked `resumeOf` (not typed by the user).
 */

type Sent = { runId: string; agent: string };

/** Under load a run may take more than `vi.waitFor`'s default second to reach its model. */
const AT_MODEL = { timeout: 10_000 };

const userMessages = (events: LogEvent[]) =>
  events.filter(
    (e): e is LogEvent<'message'> =>
      e.type === 'message' && e.agent === 'user' && e.data.role === 'user',
  );

describe('resume and continue', () => {
  it('starts each stopped request again, marked resumeOf, once', async () => {
    const t = await startTestHub({
      titan: [fake.text('mai', { gate: never }), fake.text('Ripartito.')],
      rhea: [fake.text('mai', { gate: never }), fake.text('mai', { gate: never })],
    });
    const first = await t.json<Sent>('POST', '/api/messages', { text: 'Tre post su Lisbona' });
    const second = await t.json<Sent>('POST', '/api/messages', {
      text: 'Cerca i voli',
      to: 'rhea',
    });
    await t.waitEvent(
      (e): e is LogEvent => e.type === 'run' && e.runId === second.runId && e.agent === 'rhea',
    );
    // Titan is at its model (its first, endless step): stopped before it, under load, the
    // run started again would take that step and never end.
    await vi.waitFor(
      () => expect(t.provider.calls.some((c) => c.model === 'titan')).toBe(true),
      AT_MODEL,
    );
    await t.json('POST', '/api/kill', {});
    await t.core.hub.dispatcher.idle();

    const res = await t.json<ResumeResponse>('POST', '/api/resume', { continue: true });
    expect(res.halted).toBe(false);
    expect(res.resumed).toBe(true);
    expect(res.continued?.map((c) => [c.agent, c.resumeOf])).toEqual([
      ['titan', first.runId],
      ['rhea', second.runId],
    ]);
    for (const c of res.continued ?? []) {
      const [msg] = userMessages(t.events(c.runId));
      expect(msg?.data).toMatchObject({ resumeOf: c.resumeOf, to: c.agent });
    }
    const titanRun = res.continued![0]!.runId;
    expect((await t.runEnded(titanRun)).data.status).toBe('completed');
    expect(userMessages(t.events(titanRun))[0]?.data.text).toBe(resumeText('Tre post su Lisbona'));
    // The model reads the request as a request started again.
    const titanCall = t.provider.calls.filter((c) => c.model === 'titan').at(-1)!;
    expect(promptText(titanCall.options.prompt)).toContain('Riprendi il lavoro che avevo fermato');

    // Not stopped any more: nothing starts again a second time.
    const again = await t.json<ResumeResponse>('POST', '/api/resume', { continue: true });
    expect(again).toMatchObject({ resumed: false, continued: [] });
  });

  /**
   * Holds Titan with an endless run of an automation: a message typed meanwhile waits (D-094).
   * Resolves once the automation is at its model, on Titan's first (endless) step: stopped
   * before it, under load, the run started again would take that step and never end.
   */
  const holdTitan = async (t: Awaited<ReturnType<typeof startTestHub>>) => {
    const agent = t.core.hub.team.get('titan')!;
    const runId = ulid();
    t.core.hub.dispatcher.startAutomation({
      agent,
      runId,
      automation: { automationId: 'a1', giro: runId, runs: [] },
      text: 'Il giro di prova',
    });
    await vi.waitFor(() => expect(t.provider.callsTo('titan')).toHaveLength(1), AT_MODEL);
    return runId;
  };

  it('a message waiting for a monster is a request Ferma left halfway (M8)', async () => {
    const t = await startTestHub({
      titan: [fake.text('mai', { gate: never }), fake.text('Fatto il riassunto.')],
    });
    await holdTitan(t);
    const waiting = await t.json<Sent & { queued: boolean }>('POST', '/api/messages', {
      text: 'Riassumi la riunione',
    });
    expect(waiting.queued).toBe(true);
    await t.json('POST', '/api/kill', {});
    await t.core.hub.dispatcher.idle();
    expect(t.core.hub.haltedRequests()).toEqual([
      { runId: waiting.runId, agent: 'titan', text: 'Riassumi la riunione' },
    ]);
    const res = await t.json<ResumeResponse>('POST', '/api/resume', { continue: true });
    expect(res.continued?.map((c) => c.resumeOf)).toEqual([waiting.runId]);
    expect((await t.runEnded(res.continued![0]!.runId)).data.status).toBe('completed');
    // Once resumed, a restart does not start it a second time.
    const home = t.home;
    await t.core.close();
    const again = await startTestHub({ titan: [fake.text('di nuovo')] }, { home });
    await again.core.hub.dispatcher.idle();
    expect(again.events(waiting.runId).filter((e) => e.type === 'run')).toEqual([]);
  });

  it('work of project_send that waited for a lead starts again with "Riprendi e continua", as Titan’s work', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('tools_search', { query: 'progetto lavoro' }),
        fake.toolCall('project_send', { project: 'Saturday', text: 'Prepara il piano dei post' }),
        fake.text('Ho passato il lavoro a Leda.'),
      ],
      leda: [fake.text('mai', { gate: never }), fake.text('Fatto.'), fake.text('Fatto.')],
    });
    await t.json('POST', '/api/projects', { name: 'Saturday', lead: { name: 'Leda' } });
    await t.core.hub.team.setModels('leda', [{ provider: 'fake', model: 'leda' }]);
    // Leda is busy: the work of the orchestrator waits for her, in a run of its own.
    await t.json('POST', '/api/projects/saturday/messages', { text: 'Riordina le note' });
    await vi.waitFor(() => expect(t.provider.callsTo('leda')).toHaveLength(1), AT_MODEL);
    const sent = await t.json<Sent>('POST', '/api/messages', {
      text: 'Fai fare il piano dei post a Saturday',
    });
    await t.runEnded(sent.runId);
    const work = userMessages(t.events()).find((m) => m.data.from === 'titan')!;
    await t.json('POST', '/api/kill', {});
    await t.core.hub.dispatcher.idle();
    expect(t.core.hub.haltedRequests()).toContainEqual({
      runId: work.runId,
      agent: 'leda',
      text: 'Prepara il piano dei post',
      from: 'titan',
      fromRun: sent.runId,
    });

    const res = await t.json<ResumeResponse>('POST', '/api/resume', { continue: true });
    const again = res.continued?.find((c) => c.resumeOf === work.runId);
    expect(again?.agent).toBe('leda');
    // Titan's work again, on the system channel, with its run: never the user's words.
    const [msg] = userMessages(t.events(again!.runId));
    expect(msg?.data).toMatchObject({
      from: 'titan',
      fromRun: sent.runId,
      channel: 'system',
      text: 'Prepara il piano dei post',
      resumeOf: work.runId,
    });
    await t.runEnded(again!.runId);
    const report = await t.waitEvent(
      (e): e is LogEvent<'project_report'> =>
        e.type === 'project_report' && e.data.request === msg!.id,
    );
    expect(report.data).toMatchObject({ to: 'titan', status: 'completed', summary: 'Fatto.' });
    const prompts = t.provider.callsTo('leda').map((c) => promptText(c.options.prompt));
    expect(prompts.some((p) => p.includes('[Da Titan') && p.includes('piano dei post'))).toBe(true);
  });

  it('a message waiting for a monster starts after a restart, in its own run (M8)', async () => {
    const t = await startTestHub({ titan: [fake.text('mai', { gate: never })] });
    await holdTitan(t);
    const first = await t.json<Sent>('POST', '/api/messages', { text: 'Prima cosa' });
    const second = await t.json<Sent>('POST', '/api/messages', { text: 'Seconda cosa' });
    expect(second.runId).toBe(first.runId);
    const home = t.home;
    await t.core.close();

    const again = await startTestHub({ titan: [fake.text('Fatte tutte e due.')] }, { home });
    expect((await again.runEnded(first.runId)).data.status).toBe('completed');
    const prompt = promptText(again.provider.callsTo('titan')[0]!.options.prompt);
    expect(prompt).toContain('Prima cosa');
    expect(prompt).toContain('Seconda cosa');
    // A second restart does not start it again.
    const home2 = again.home;
    await again.core.close();
    const third = await startTestHub({ titan: [fake.text('no')] }, { home: home2 });
    await third.core.hub.dispatcher.idle();
    expect(third.provider.callsTo('titan')).toHaveLength(0);
  });

  it('a waiting message that answered a parked question comes back with it (review of 19/10, 13)', async () => {
    const t = await startTestHub({});
    const log = t.core.log;
    log.append({
      agent: 'titan',
      runId: 'r-asked',
      type: 'question',
      data: {
        questionId: 'q1',
        question: 'Che tono?',
        options: [
          { id: '1', label: 'Ironico' },
          { id: '2', label: 'Serio' },
        ],
        blocking: true,
      },
    });
    const message = log.append({
      agent: 'user',
      runId: 'r-waiting',
      type: 'message',
      data: { role: 'user', text: 'sì', to: 'titan', channel: 'ui' },
    });
    const answer = log.append({
      agent: 'user',
      runId: 'r-asked',
      type: 'answer',
      data: { questionId: 'q1', text: 'sì', channel: 'ui', message: message.id },
    });
    const requeued: { items: { text: string; related?: string[] }[] }[] = [];
    const dispatcher = {
      requeueWaiting: (r: { items: { text: string; related?: string[] }[] }) => requeued.push(r),
    } as unknown as Parameters<typeof requeueWaiting>[1];
    expect(requeueWaiting(log, dispatcher, { halted: false })).toEqual(['r-waiting']);
    expect(requeued[0]!.items).toEqual([
      {
        eventId: message.id,
        text: 'Risposta alla tua domanda "Che tono?": sì',
        related: [answer.id],
      },
    ]);
  });

  it('plain resume starts nothing; a request stopped twice is the original one', async () => {
    const t = await startTestHub({
      titan: [fake.text('mai', { gate: never }), fake.text('mai', { gate: never })],
    });
    const first = await t.json<Sent>('POST', '/api/messages', { text: 'Tre post su Lisbona' });
    await t.json('POST', '/api/kill', {});
    await t.core.hub.dispatcher.idle();
    const plain = await t.json<ResumeResponse>('POST', '/api/resume');
    expect(plain.resumed).toBe(true);
    expect(plain.continued).toBeUndefined();
    expect(t.core.runs.activeRuns()).toEqual([]);
    expect(userMessages(t.events())).toHaveLength(1);

    // A request started again (by "Chiedimelo di nuovo"), stopped again.
    const resumedRun = await t.json<Sent>('POST', '/api/messages', {
      text: resumeText('Tre post su Lisbona'),
      to: 'titan',
      resumeOf: first.runId,
    });
    await t.json('POST', '/api/kill', {});
    await t.core.hub.dispatcher.idle();
    expect(t.core.hub.haltedRequests()).toEqual([
      { runId: resumedRun.runId, agent: 'titan', text: 'Tre post su Lisbona' },
    ]);
  });
});
