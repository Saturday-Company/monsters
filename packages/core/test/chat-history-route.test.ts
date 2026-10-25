import { CHAT_PAGE, type ChatHistoryResponse, type LogEvent } from '@monsters/shared';
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
