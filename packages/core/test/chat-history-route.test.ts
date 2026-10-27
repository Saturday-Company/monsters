import {
  CHAT_PAGE,
  type ChatConversationsResponse,
  type ChatHistoryResponse,
  type LogEvent,
} from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { startTestHub } from './hub-helpers.ts';

/*
 * One page of a chat's history in one request (the leftover of D-173): the core chooses what
 * the chat shows, by the same rule the client applied over three `/api/events` requests.
 */

type Page = Omit<ChatHistoryResponse, 'events'> & { events: LogEvent[] };

describe('GET /api/chats/:agent/history', () => {
  it('the monster’s own events, what the chat shows of the others, the user’s words', async () => {
    const t = await startTestHub({});
    const log = t.core.log;
    const own = log.append({
      agent: 'dione',
      type: 'message',
      data: { role: 'agent', text: 'Here is the bio' },
    });
    const asked = log.append({
      agent: 'user',
      type: 'message',
      data: { role: 'user', text: 'A bio, please', to: 'dione' },
    });
    const delegated = log.append({
      agent: 'titan',
      type: 'delegation',
      data: { from: 'titan', to: 'dione', status: 'started', goal: 'Write a bio' },
    });
    // Not for a chat: another monster's words and tool calls.
    const other = log.append({
      agent: 'rhea',
      type: 'message',
      data: { role: 'agent', text: 'Searching' },
    });
    const page = await t.json<Page>('GET', '/api/chats/dione/history');
    const ids = page.events.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([own.id, asked.id, delegated.id]));
    expect(ids).not.toContain(other.id);
    // Newest first, each once; nothing older (short pages).
    expect(ids).toEqual([...ids].sort().reverse());
    expect(new Set(ids).size).toBe(ids.length);
    expect(page).toMatchObject({ floor: null, own: expect.any(Number) as number });
    // Before an id: only what is older.
    const older = await t.json<Page>(
      'GET',
      `/api/chats/dione/history?before=${encodeURIComponent(delegated.id)}`,
    );
    expect(older.events.every((e) => e.id < delegated.id)).toBe(true);
    expect(older.events.map((e) => e.id)).toContain(asked.id);
  });

  it('a full own page leaves the chat open below its edge', async () => {
    const t = await startTestHub({});
    const ids: string[] = [];
    for (let i = 0; i < CHAT_PAGE + 5; i++) {
      ids.push(
        t.core.log.append({
          agent: 'dione',
          type: 'message',
          data: { role: 'agent', text: `line ${i}` },
        }).id,
      );
    }
    const page = await t.json<Page>('GET', '/api/chats/dione/history');
    expect(page.own).toBe(CHAT_PAGE);
    expect(page.floor).toBe(ids.at(-CHAT_PAGE));
    const next = await t.json<Page>(
      'GET',
      `/api/chats/dione/history?before=${encodeURIComponent(page.floor!)}`,
    );
    expect(next.own).toBe(5);
    expect(next.floor).toBeNull();
  });

  it.each([
    ['an unknown monster is an empty chat, not a 404', '/api/chats/nobody/history', 200],
    ['a `before` that is not an id', '/api/chats/dione/history?before=x', 400],
  ])('%s', async (_, path, status) => {
    const t = await startTestHub({});
    const res = await t.api('GET', path);
    expect(res.status).toBe(status);
    if (status === 200) expect(await res.json()).toMatchObject({ floor: null, own: 0 });
  });
});

describe('the previous conversations of a chat', () => {
  /** Titan's chat: two closed conversations, a span with nothing of it, the current one. */
  async function chat() {
    const t = await startTestHub({});
    const log = t.core.log;
    const say = (to: string, text: string) =>
      log.append({ agent: 'user', type: 'message', data: { role: 'user', text, to } });
    const reply = (agent: string, text: string) =>
      log.append({ agent, type: 'message', data: { role: 'agent', text } });
    const reset = (to?: string) =>
      log.append({
        agent: 'user',
        type: 'new_conversation',
        data: { ...(to ? { to } : {}), channel: 'ui' },
      });
    const first = say('titan', `Plan the Lisbon trip:\n${'three days, '.repeat(20)}by train`);
    const firstReply = reply('titan', 'Here is the plan');
    say('titan', 'And the hotels?');
    const one = reset('titan');
    const second = say('titan', 'Posts for the week');
    reply('titan', 'Three posts');
    // Another chat's boundary is not Titan's; a span with nothing of Titan is left out.
    const rhea = reset('rhea');
    const two = reset();
    say('rhea', 'Sources for Rhea only');
    reset();
    const current = say('titan', 'Hello again');
    return { t, first, firstReply, second, one, two, rhea, current };
  }

  it('lists them newest first, with their first message and how many the user wrote', async () => {
    const { t, first, one, two } = await chat();
    const page = await t.json<ChatConversationsResponse>('GET', '/api/chats/titan/conversations');
    expect(page.next).toBeNull();
    expect(page.conversations.map((c) => [c.id, c.openedBy, c.messages])).toEqual([
      [two.id, one.id, 1],
      [one.id, null, 2],
    ]);
    const oldest = page.conversations[1]!;
    expect(oldest.title).toHaveLength(120);
    expect(oldest.title.startsWith('Plan the Lisbon trip: three days,')).toBe(true);
    expect(oldest.title.endsWith('…')).toBe(true);
    expect(oldest.startedAt).toBe(first.ts);
    expect(oldest.closedAt).toBe(one.ts);
    expect(page.conversations[0]!.title).toBe('Posts for the week');
  });

  it('pages with `before` and `limit`', async () => {
    const { t, one, two } = await chat();
    const page = await t.json<ChatConversationsResponse>(
      'GET',
      '/api/chats/titan/conversations?limit=1',
    );
    expect(page.conversations.map((c) => c.id)).toEqual([two.id]);
    expect(page.next).toBe(two.id);
    const older = await t.json<ChatConversationsResponse>(
      'GET',
      `/api/chats/titan/conversations?limit=1&before=${page.next}`,
    );
    expect(older.conversations.map((c) => c.id)).toEqual([one.id]);
    expect(older.next).toBeNull();
  });

  it('reads one of them: only its span, in the shape of the chat’s history', async () => {
    const { t, first, firstReply, second, one, current } = await chat();
    const page = await t.json<Page>('GET', `/api/chats/titan/conversations/${one.id}/history`);
    const ids = page.events.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([first.id, firstReply.id]));
    expect(ids).not.toContain(second.id);
    expect(ids).not.toContain(current.id);
    expect(ids).not.toContain(one.id);
    expect(page.floor).toBeNull();
  });

  it('refuses what is not one of its conversations', async () => {
    const { t, first, rhea } = await chat();
    const path = (id: string) => `/api/chats/titan/conversations/${id}/history`;
    // Not a boundary, a boundary of another monster's chat, not an id.
    for (const id of [first.id, rhea.id]) {
      const res = await t.api('GET', path(id));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'unknown_conversation' });
    }
    expect((await t.api('GET', path('x'))).status).toBe(400);
    expect((await t.api('GET', '/api/chats/titan/conversations?limit=0')).status).toBe(400);
  });
});
