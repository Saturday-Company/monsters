import { fake } from '@monsters/providers/testing';
import type { LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { startTestHub } from './hub-helpers.ts';

/*
 * The sender's id of a message (D-217): logged on its `message` event, so the UI that sent it
 * finds its copy whatever the text; the same id again is answered as the first time, never
 * logged nor run twice (a retry after a lost answer, a held message sent by two tabs).
 */

type Sent = { runId: string; agent: string; queued: boolean; messageId?: string };

const userMessages = (events: readonly LogEvent[]) =>
  events.filter(
    (e): e is LogEvent<'message'> =>
      e.type === 'message' && e.agent === 'user' && e.data.role === 'user',
  );

describe('clientId of a message (D-217)', () => {
  it('is logged on the message, and the same id twice starts one run', async () => {
    const t = await startTestHub({ titan: [fake.text('Ciao!'), fake.text('Di nuovo ciao.')] });
    const first = await t.json<Sent>('POST', '/api/messages', {
      text: 'ciao',
      clientId: 'pending-a',
    });
    const again = await t.json<Sent>('POST', '/api/messages', {
      text: 'ciao',
      clientId: 'pending-a',
    });
    expect(again).toEqual(first);
    expect(first.messageId).toBeDefined();
    await t.runEnded(first.runId);
    const logged = userMessages(t.events());
    expect(logged).toHaveLength(1);
    expect(logged[0]!.id).toBe(first.messageId);
    expect(logged[0]!.data.clientId).toBe('pending-a');

    // The same words with another id are another message; none at all, as before.
    const other = await t.json<Sent>('POST', '/api/messages', {
      text: 'ciao',
      clientId: 'pending-b',
    });
    await t.runEnded(other.runId);
    expect(other.runId).not.toBe(first.runId);
    const plain = await t.json<Sent>('POST', '/api/messages', { text: 'senza id' });
    const all = userMessages(t.events());
    expect(all.map((e) => e.data.clientId)).toEqual(['pending-a', 'pending-b', undefined]);
    expect(all.at(-1)!.id).toBe(plain.messageId);
    await t.core.close();
  });
});
