import type {
  AgentStopResponse,
  AgentUsageView,
  ChatConversationsResponse,
  ChatHistoryResponse,
  LogEvent,
} from '@monsters/shared';
import { contextLevel } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { MockCore } from '../src/lib/mock/core.ts';

/*
 * The mock core answers like the real one: "Stop" in one monster's chat (F-1), the previous
 * conversations of a chat, and the usage the "conversation getting long" sentence reads.
 */

const core = () => {
  const c = new MockCore({ mode: 'demo', speed: 0.01 });
  const call = <T>(method: string, path: string, body?: unknown) => {
    const res = c.handle(method, path, body);
    return { status: res.status, body: res.body as T };
  };
  return { c, call };
};

describe('mock core: previous conversations', () => {
  it('the demo has two of Titan’s and one of Dione’s, newest first', () => {
    const { call } = core();
    const titan = call<ChatConversationsResponse>('GET', '/api/chats/titan/conversations').body;
    expect(titan.conversations).toHaveLength(2);
    expect(titan.next).toBeNull();
    const [newest, oldest] = titan.conversations;
    expect(newest!.title).toContain('newsletter');
    expect(oldest!.title).toContain('Porto');
    expect(oldest!.messages).toBe(2);
    expect(oldest!.openedBy).toBeNull();
    expect(newest!.openedBy).toBe(oldest!.id);
    const dione = call<ChatConversationsResponse>('GET', '/api/chats/dione/conversations').body;
    expect(dione.conversations.map((c) => c.title)).toEqual([
      expect.stringContaining('Lisbon') as unknown,
    ]);
  });

  it('reads one read-only, in the shape of the chat’s history', () => {
    const { call } = core();
    const [, oldest] = call<ChatConversationsResponse>('GET', '/api/chats/titan/conversations').body
      .conversations;
    const page = call<ChatHistoryResponse>(
      'GET',
      `/api/chats/titan/conversations/${oldest!.id}/history`,
    ).body;
    const texts = (page.events as LogEvent[]).flatMap((e) =>
      e.type === 'message' ? [e.data.text] : [],
    );
    expect(texts.some((t) => t.includes('Porto'))).toBe(true);
    expect(texts.some((t) => t.includes('newsletter'))).toBe(false);
    expect(page.floor).toBeNull();
    const unknown = call('GET', '/api/chats/dione/conversations/' + oldest!.id + '/history');
    expect(unknown.status).toBe(404);
  });
});

describe('mock core: Stop in one monster’s chat', () => {
  it('cuts the reply, ends the run and leaves the monster ready', async () => {
    const { c, call } = core();
    c.hold();
    const { runId } = call<{ runId: string }>('POST', '/api/messages', {
      text: 'A short bio, please',
      to: 'dione',
    }).body;
    const inRun = () => c.events.filter((e) => e.runId === runId);
    // Up to the first streamed words: the scripted steps wait in the queue, one at a time.
    for (let i = 0; i < 200; i++) {
      if (inRun().some((e) => e.type === 'message' && e.data.partial)) break;
      await new Promise((r) => setTimeout(r, 2));
      c.step();
    }
    expect(inRun().some((e) => e.type === 'message' && e.data.partial)).toBe(true);
    const report = call<AgentStopResponse>('POST', '/api/agents/dione/stop').body;
    expect(report).toMatchObject({ stopped: 1, runs: [runId], parts: 0 });
    c.release();
    const types = inRun().map((e) =>
      e.type === 'run' ? `run:${e.data.status}` : e.type === 'kill' ? 'kill' : e.type,
    );
    expect(types.indexOf('kill')).toBeLessThan(types.indexOf('run:aborted'));
    expect(types.filter((t) => t === 'run:completed')).toEqual([]);
    const cut = inRun().find((e) => e.type === 'message' && e.data.status === 'aborted');
    expect(cut).toBeDefined();
    // Nothing runs any more: 200 with nothing stopped.
    expect(call<AgentStopResponse>('POST', '/api/agents/dione/stop').body.stopped).toBe(0);
    expect(call('POST', '/api/agents/nobody/stop').status).toBe(404);
  });

  it('fillContext makes the conversation long, then full', () => {
    const { c, call } = core();
    const level = () => contextLevel(call<AgentUsageView>('GET', '/api/agents/dione/usage').body);
    expect(level()).toBe('ok');
    c.fillContext('dione', 0.65);
    expect(level()).toBe('long');
    c.fillContext('dione', 0.8);
    expect(level()).toBe('full');
  });
});
