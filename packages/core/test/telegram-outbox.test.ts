import type { Api } from 'grammy';
import { describe, expect, it } from 'vitest';
import { Outbox } from '../src/channels/telegram/outbox.ts';

/* The pace of a chat's queue (review 2026-10-18, item 12): a gap between two sends to one chat. */

function outbox(gap: { private: number; group: number }) {
  const o = new Outbox({
    allowed: () => true,
    failed: () => {},
    chatGapMs: gap,
  });
  o.open({} as Api);
  return o;
}

async function times(o: Outbox, chatId: number, n: number): Promise<number[]> {
  const at: number[] = [];
  const done = new Promise<void>((resolve) => {
    for (let i = 0; i < n; i++) {
      o.enqueue(chatId, () => {
        at.push(Date.now());
        if (at.length === n) resolve();
        return Promise.resolve();
      });
    }
  });
  await done;
  return at;
}

describe('outbox: rhythm per chat', () => {
  it('holds the sends of a private chat at least the private gap apart', async () => {
    const o = outbox({ private: 120, group: 400 });
    const at = await times(o, 42, 3);
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(110);
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(110);
    await o.close();
  });

  it('uses the longer group gap for a group, and does not slow another chat', async () => {
    const o = outbox({ private: 10, group: 250 });
    const started = Date.now();
    const [group, other] = await Promise.all([times(o, -100, 2), times(o, 7, 1)]);
    expect(group[1]! - group[0]!).toBeGreaterThanOrEqual(240);
    expect(other[0]! - started).toBeLessThan(100);
    await o.close();
  });
});

describe('outbox: a new token and the closing (review of 19/10, item 11)', () => {
  it('a new Api of the same bot sends the messages still waiting, in their place', async () => {
    const o = outbox({ private: 10, group: 200 });
    const second = {} as Api;
    const used: Api[] = [];
    const sent = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    for (const s of sent) {
      o.enqueue(-100, (api) => {
        used.push(api);
        s.resolve();
        return Promise.resolve();
      });
    }
    await sent[0]!.promise;
    o.open(second);
    await sent[1]!.promise;
    expect(used[0]).not.toBe(second);
    expect(used[1]).toBe(second);
    await o.close();
  });

  it('the closing waits for the queue at the pace of the chat', async () => {
    const o = outbox({ private: 10, group: 1300 });
    let sent = 0;
    for (let i = 0; i < 4; i++) {
      o.enqueue(-100, () => {
        sent++;
        return Promise.resolve();
      });
    }
    await o.close();
    expect(sent).toBe(4);
  }, 15_000);
});

describe('outbox: a chat that may not receive (review of 28/10)', () => {
  it('drops what is queued for it, unless the job is the one answer to a request (`anyone`)', async () => {
    const o = new Outbox({
      allowed: (chat) => chat !== 42,
      failed: () => {},
      chatGapMs: { private: 0, group: 0 },
    });
    o.open({} as Api);
    const sent: string[] = [];
    const job = (what: string) => () => {
      sent.push(what);
      return Promise.resolve();
    };
    o.enqueue(42, job('refused'));
    o.enqueue(42, job('answer'), { anyone: true });
    o.enqueue(7, job('allowed'));
    await o.close();
    expect(sent.sort()).toEqual(['allowed', 'answer']);
  });
});
