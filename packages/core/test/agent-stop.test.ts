import { fake } from '@monsters/providers/testing';
import type { AgentStopResponse, LogEvent, Question, StatusResponse } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { deferred, never, startTestHub, type TestHub } from './hub-helpers.ts';

/*
 * "Stop" in one monster's chat (F-1): `POST /api/agents/:id/stop` stops that monster's work and
 * nothing else. Not the kill switch: the core is not halted, the next message starts a new run.
 */

type Sent = { runId: string };

const kills = (t: TestHub) =>
  t.events().filter((e): e is LogEvent<'kill'> => e.type === 'kill' && e.data.scope === 'agent');

const delegations = (events: LogEvent[]) =>
  events.filter((e): e is LogEvent<'delegation'> => e.type === 'delegation');

const started = (t: TestHub, agent: string) =>
  t.waitEvent(
    (e): e is LogEvent<'run'> =>
      e.type === 'run' && e.agent === agent && e.data.status === 'started',
  );

describe('POST /api/agents/:id/stop (F-1)', () => {
  it('stops a reply while it streams; the monster takes the next message at once', async () => {
    const t = await startTestHub({
      dione: [
        fake.text('Here is a very long bio that streams word by word, slowly', {
          chunkSize: 4,
          delayMs: 150,
        }),
        fake.text('Back at work.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'A bio', to: 'dione' });
    await t.waitEvent(
      (e): e is LogEvent<'message'> =>
        e.type === 'message' && e.agent === 'dione' && e.data.partial === true,
    );
    const report = await t.json<AgentStopResponse>('POST', '/api/agents/dione/stop');
    expect(report).toMatchObject({ stopped: 1, runs: [sent.runId], parts: 0 });
    expect((await t.runEnded(sent.runId)).data.status).toBe('aborted');

    // The turn's outcome: one `kill` of the monster in its run, before the end of the run.
    const [kill] = kills(t);
    expect(kill).toMatchObject({
      agent: 'dione',
      runId: sent.runId,
      data: { scope: 'agent', target: 'dione', runsAborted: 1, reason: 'You stopped Dione' },
    });
    const ids = t.events(sent.runId).map((e) => e.id);
    const end = t
      .events(sent.runId)
      .find((e) => e.type === 'run' && e.data.status === 'aborted')!.id;
    expect(ids.indexOf(kill!.id)).toBeLessThan(ids.indexOf(end));

    // Not the kill switch: nothing halted, and Dione answers the next message in a new run.
    const status = await t.json<StatusResponse>('GET', '/api/status');
    expect(status.halted).toBe(false);
    const next = await t.json<Sent>('POST', '/api/messages', { text: 'Again', to: 'dione' });
    expect(next.runId).not.toBe(sent.runId);
    expect((await t.runEnded(next.runId)).data.status).toBe('completed');
  });

  it('stops the lead and what it delegated: the turn really ends', async () => {
    const t = await startTestHub({
      titan: [fake.toolCall('delegate', { agent: 'Dione', goal: 'Write the newsletter' })],
      dione: [fake.text('never written', { gate: never })],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'The newsletter' });
    await started(t, 'titan');
    await t.waitEvent(
      (e): e is LogEvent<'delegation'> =>
        e.type === 'delegation' && e.data.to === 'dione' && e.data.status === 'started',
    );
    const report = await t.json<AgentStopResponse>('POST', '/api/agents/titan/stop');
    expect(report).toMatchObject({ stopped: 1, runs: [sent.runId] });
    expect((await t.runEnded(sent.runId)).data.status).toBe('aborted');
    await t.core.hub.dispatcher.idle();
    const ended = delegations(t.events(sent.runId)).filter((e) => e.data.status !== 'started');
    expect(ended.map((e) => e.data.status)).toEqual(['aborted']);
  });

  it('stops a monster’s part in another monster’s run: that run goes on, and hears why', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('delegate', { agent: 'Dione', goal: 'Write the newsletter' }),
        fake.text('Dione was stopped: I will tell Giulio.'),
      ],
      dione: [fake.text('never written', { gate: never })],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'The newsletter' });
    await t.waitEvent(
      (e): e is LogEvent<'delegation'> =>
        e.type === 'delegation' && e.data.to === 'dione' && e.data.status === 'started',
    );
    const report = await t.json<AgentStopResponse>('POST', '/api/agents/dione/stop');
    expect(report).toMatchObject({ stopped: 0, runs: [], parts: 1 });
    // Titan's run is not stopped: it reads "The user stopped Dione." and ends its turn.
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const ended = delegations(t.events(sent.runId)).find((e) => e.data.status !== 'started')!;
    expect(ended.data).toMatchObject({ status: 'aborted', error: 'The user stopped Dione.' });
    expect(kills(t)).toEqual([
      expect.objectContaining({
        agent: 'dione',
        runId: sent.runId,
        data: expect.objectContaining({ target: 'dione', runsAborted: 0 }) as unknown,
      }),
    ]);
  });

  it('stops the teammate a stopped delegate was asking, with it', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('delegate', { agent: 'Dione', goal: 'Write the newsletter' }),
        fake.text('Dione was stopped.'),
      ],
      dione: [fake.toolCall('ask_teammate', { agent: 'Rhea', question: 'Which sources?' })],
      rhea: [fake.text('never written', { gate: never })],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'The newsletter' });
    await t.waitEvent(
      (e): e is LogEvent<'delegation'> =>
        e.type === 'delegation' && e.data.to === 'rhea' && e.data.status === 'started',
    );
    const report = await t.json<AgentStopResponse>('POST', '/api/agents/dione/stop');
    expect(report).toMatchObject({ stopped: 0, parts: 2 });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const ended = delegations(t.events(sent.runId)).filter((e) => e.data.status !== 'started');
    expect(ended.map((e) => [e.data.from, e.data.to, e.data.status]).sort()).toEqual([
      ['dione', 'rhea', 'aborted'],
      ['titan', 'dione', 'aborted'],
    ]);
  });

  it('closes the open question of the run as `stopped`', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('ask_user', {
          question: 'Which tone?',
          options: ['Ironic', 'Serious'],
          blocking: true,
        }),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'A post' });
    const asked = await t.waitEvent((e): e is LogEvent<'question'> => e.type === 'question');
    await t.json<AgentStopResponse>('POST', '/api/agents/titan/stop');
    expect((await t.runEnded(sent.runId)).data.status).toBe('aborted');
    const expired = await t.waitEvent(
      (e): e is LogEvent<'question_expired'> => e.type === 'question_expired',
    );
    expect(expired.data).toEqual({ questionId: asked.data.questionId, reason: 'stopped' });
    expect(await t.json<Question[]>('GET', '/api/questions?status=open')).toEqual([]);
  });

  it('closes the question a stopped delegate asked, and only that', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('delegate', { agent: 'Rhea', goal: 'Find three sources' }),
        fake.text('Rhea was stopped.'),
      ],
      rhea: [fake.text('never written', { gate: never })],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Sources, please' });
    await t.waitEvent(
      (e): e is LogEvent<'delegation'> =>
        e.type === 'delegation' && e.data.to === 'rhea' && e.data.status === 'started',
    );
    const ask = (agent: string) =>
      t.core.hub.questions.create({
        agent,
        runId: sent.runId,
        question: `A question of ${agent}`,
        options: [],
        blocking: false,
      });
    const hers = ask('rhea');
    const his = ask('titan');
    const report = await t.json<AgentStopResponse>('POST', '/api/agents/rhea/stop');
    expect(report).toMatchObject({ stopped: 0, parts: 1 });
    const expired = t
      .events(sent.runId)
      .filter((e): e is LogEvent<'question_expired'> => e.type === 'question_expired');
    expect(expired.map((e) => e.data)).toEqual([{ questionId: hers.id, reason: 'stopped' }]);
    expect(t.core.hub.questions.list({ status: 'open' }).map((q) => q.id)).toContain(his.id);
  });

  it('nothing running: 200 with nothing stopped; an unknown monster is a 404', async () => {
    const t = await startTestHub({});
    expect(await t.json<AgentStopResponse>('POST', '/api/agents/dione/stop')).toEqual({
      stopped: 0,
      runs: [],
      parts: 0,
      processesKilled: 0,
      sendsDropped: 0,
      giriSkipped: 0,
    });
    expect(kills(t)).toEqual([]);
    const res = await t.api('POST', '/api/agents/nobody/stop');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'unknown_agent' });
  });

  it('leaves the other monsters’ work alone', async () => {
    const rheaGate = deferred();
    const t = await startTestHub({
      dione: [fake.text('never written', { gate: never })],
      rhea: [fake.text('Three sources found.', { gate: rheaGate.promise })],
    });
    const dione = await t.json<Sent>('POST', '/api/messages', { text: 'A bio', to: 'dione' });
    const rhea = await t.json<Sent>('POST', '/api/messages', { text: 'Sources', to: 'rhea' });
    await started(t, 'dione');
    await started(t, 'rhea');
    const report = await t.json<AgentStopResponse>('POST', '/api/agents/dione/stop');
    expect(report.runs).toEqual([dione.runId]);
    const status = await t.json<StatusResponse>('GET', '/api/status');
    expect(status.runs.map((r) => r.id)).toEqual([rhea.runId]);
    rheaGate.resolve();
    expect((await t.runEnded(rhea.runId)).data.status).toBe('completed');
    expect((await t.runEnded(dione.runId)).data.status).toBe('aborted');
  });
});
