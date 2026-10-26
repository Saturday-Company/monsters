import { fake } from '@monsters/providers/testing';
import type { LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { startTestHub, type TestHub } from './hub-helpers.ts';

/*
 * The monsters of a squad talk to each other (D-201): a monster at work asks a teammate with
 * `ask_teammate` and gets the answer back; the one asked answers and cannot ask a third, and a
 * coordinator is never asked (it delegates instead).
 */

type Sent = { runId: string };

const toolsOf = (t: TestHub, model: string, i = 0) =>
  (t.provider.callsTo(model)[i]?.options.tools ?? []).map((x) => x.name);

const delegations = (events: LogEvent[]) =>
  events.filter((e): e is LogEvent<'delegation'> => e.type === 'delegation');

const answers = (events: LogEvent[]) =>
  events
    .filter(
      (e): e is LogEvent<'tool_result'> =>
        e.type === 'tool_result' && e.data.tool === 'ask_teammate',
    )
    .map((e) => e.data.output as Record<string, unknown>);

describe('ask_teammate (D-201)', () => {
  it('a delegated monster asks a teammate and uses the answer; the one asked asks no third', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('delegate', { agent: 'Dione', goal: 'Write the November newsletter' }),
        fake.text('Here is the newsletter.'),
      ],
      dione: [
        fake.toolCall('ask_teammate', {
          agent: 'Rhea',
          question: 'Which three sources did you use for the November market note?',
          context: 'I am writing the newsletter from it',
        }),
        fake.text('Newsletter written, sources from Rhea: A, B, C.'),
      ],
      rhea: [fake.text('Sources: A, B and C.')],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'The November newsletter' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const events = t.events(sent.runId);

    // Dione had the tool, Rhea (asked) did not: a question never becomes a chain.
    expect(toolsOf(t, 'dione')).toContain('ask_teammate');
    expect(toolsOf(t, 'rhea')).not.toContain('ask_teammate');
    expect(toolsOf(t, 'titan')).not.toContain('ask_teammate');

    const asked = delegations(events).filter((e) => e.data.from === 'dione');
    expect(asked.map((e) => [e.data.to, e.data.status])).toEqual([
      ['rhea', 'started'],
      ['rhea', 'completed'],
    ]);
    // Rhea reads who asks and why: she does not see Dione's task.
    expect(asked[0]!.data.why).toContain('Dione');
    expect(asked[0]!.data.why).toContain('I am writing the newsletter from it');
    const [answer] = answers(events);
    expect(answer).toMatchObject({
      agent: 'Rhea',
      status: 'completed',
      summary: 'Sources: A, B and C.',
      next: expect.stringContaining('teammate’s answer') as unknown,
    });
    // Rhea's run hangs under Dione's question, which hangs under Titan's delegation.
    const titanDelegation = delegations(events).find((e) => e.data.from === 'titan')!;
    const call = events.find((e) => e.id === asked[0]!.parentId)!;
    expect(call).toMatchObject({ type: 'tool_call', agent: 'dione' });
    expect(call.parentId).toBe(titanDelegation.id);
  });

  it('a coordinator is not a teammate, and a wrong name gets the list', async () => {
    const t = await startTestHub({
      titan: [fake.toolCall('delegate', { agent: 'Dione', goal: 'Write a post' }), fake.text('ok')],
      dione: [
        fake.toolCall('ask_teammate', { agent: 'Titan', question: 'What tone?' }),
        fake.text('Post written.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'A post' });
    await t.runEnded(sent.runId);
    const failed = t
      .events(sent.runId)
      .find(
        (e): e is LogEvent<'tool_result'> =>
          e.type === 'tool_result' && e.data.tool === 'ask_teammate',
      );
    expect(JSON.stringify(failed?.data)).toContain('Teammates: Rhea');
    expect(t.provider.callsTo('titan')).toHaveLength(2);
  });

  it('in a direct chat a monster asks a teammate too', async () => {
    const t = await startTestHub({
      dione: [
        fake.toolCall('ask_teammate', { agent: 'Rhea', question: 'What did you find on Titan?' }),
        fake.text('Rhea says: methane lakes.'),
      ],
      rhea: [fake.text('Methane lakes.')],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', {
      text: 'Ask Rhea about Titan',
      to: 'dione',
    });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    expect(answers(t.events(sent.runId))[0]).toMatchObject({
      status: 'completed',
      summary: 'Methane lakes.',
    });
    expect(toolsOf(t, 'rhea')).not.toContain('ask_teammate');
  });
});
