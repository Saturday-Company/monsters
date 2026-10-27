import { ulid, type DraftView, type EventInput, type LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { firstWaitingRow } from '../src/components/log/activity.ts';
import { inboxCount } from '../src/store/inbox.ts';

/* The Inbox: one number for what waits for the user, and the one solid key of Activity. */

describe('inboxCount', () => {
  it('adds the drafts, the questions of the chats and the paused tools', () => {
    const waiting = new Map([
      ['titan', [{}, {}]],
      ['rhea', [{}]],
    ]);
    expect(inboxCount({ drafts: 3, waiting, paused: 1 })).toBe(7);
  });

  it('is zero when nothing waits, and does not depend on anything seen', () => {
    expect(inboxCount({ drafts: 0, waiting: new Map(), paused: 0 })).toBe(0);
    // Chats that have no questions left do not count.
    expect(inboxCount({ drafts: 0, waiting: new Map([['titan', []]]), paused: 0 })).toBe(0);
  });
});

let clock = 1_760_000_000_000;
function ev(input: EventInput): LogEvent {
  clock += 1000;
  return { id: ulid(clock), ts: clock, ...input } as LogEvent;
}

describe('firstWaitingRow', () => {
  const question = (id: string) =>
    ev({
      type: 'question',
      agent: 'titan',
      data: { questionId: id, question: '?', options: [] },
    } as unknown as EventInput);
  const state = (rows: LogEvent[], open: string[], drafts: DraftView[] | null = null) => ({
    events: rows,
    questions: Object.fromEntries(open.map((id) => [id, { status: 'open' }])),
    drafts,
  });

  it('is the first row of the list that still waits for you', () => {
    const rows = [question('q2'), question('q1')];
    expect(firstWaitingRow(rows, state(rows, ['q1', 'q2']))).toBe(rows[0]!.id);
    // The newest one was answered: the next that waits gets the solid key.
    expect(firstWaitingRow(rows, state(rows, ['q1']))).toBe(rows[1]!.id);
  });

  it('is null when nothing waits', () => {
    const rows = [question('q1')];
    expect(firstWaitingRow(rows, state(rows, []))).toBeNull();
    expect(firstWaitingRow([], state([], []))).toBeNull();
  });
});
