import { parseUiBlock } from '@monsters/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UiTree } from '../src/components/chat/ui-block/UiBlock.tsx';
import { resolveUiBlock } from '../src/components/chat/ui-block/model.ts';
import {
  answeredIds,
  replyGate,
  UiReplyContext,
  type ReplyGate,
  type ReplyState,
} from '../src/components/chat/ui-block/reply.ts';

/*
 * The buttons of a drawn block (D-162): when they may be pressed, and what is drawn. A tap sends
 * the visible label through the composer's path: that part is in the e2e (blocchi.e2e.ts).
 */

const OPEN: ReplyState = {
  streaming: false,
  answered: false,
  question: false,
  working: false,
  halted: false,
  noModel: false,
  offline: false,
};
const gate = (over: Partial<ReplyState>): ReplyGate => replyGate({ ...OPEN, ...over });

describe('replyGate: when the buttons of a block can be pressed', () => {
  it('open only when the message is final, nothing newer is from the user and the monster is idle', () => {
    expect(gate({})).toBe('open');
  });

  it('closed while the message streams', () => {
    expect(gate({ streaming: true })).toBe('streaming');
  });

  it('closed once the user wrote something after the message (a tap closes all the buttons)', () => {
    expect(gate({ answered: true })).toBe('answered');
  });

  it('closed while the monster works, while a question waits, while stopped, offline, without a model', () => {
    expect(gate({ working: true })).toBe('working');
    expect(gate({ question: true })).toBe('question');
    expect(gate({ halted: true })).toBe('halted');
    expect(gate({ noModel: true })).toBe('noModel');
    expect(gate({ offline: true })).toBe('offline');
  });

  it('says the most useful reason first', () => {
    expect(gate({ streaming: true, answered: true, working: true })).toBe('streaming');
    expect(gate({ answered: true, working: true, halted: true })).toBe('answered');
    expect(gate({ question: true, working: true })).toBe('question');
    expect(gate({ working: true, halted: true })).toBe('working');
  });
});

describe('answeredIds: the messages that have a newer message of the user after them', () => {
  const item = (id: string, kind: string) => ({ id, kind });

  it('nothing from the user yet: nothing is answered', () => {
    expect(answeredIds([item('a1', 'agent'), item('a2', 'agent')]).size).toBe(0);
    expect(answeredIds([]).size).toBe(0);
  });

  it('everything before the last message of the user is answered, what comes after is not', () => {
    const ids = answeredIds([
      item('a1', 'agent'),
      item('u1', 'user'),
      item('a2', 'agent'),
      item('u2', 'user'),
      item('a3', 'agent'),
      item('a4', 'agent'),
    ]);
    expect([...ids].sort()).toEqual(['a1', 'a2', 'u1']);
    expect(ids.has('a3')).toBe(false);
    expect(ids.has('a4')).toBe(false);
  });

  it('a message that is still pending counts, and so does one written on Telegram', () => {
    // The pending bubble of a tap is a user item at once: the buttons close before the core answers.
    expect(answeredIds([item('a1', 'agent'), item('pending-1', 'user')]).has('a1')).toBe(true);
    expect(answeredIds([item('a1', 'agent'), item('t1', 'telegram')]).has('a1')).toBe(true);
  });

  it('other rows (events, receipts, other monsters) do not close the buttons', () => {
    const ids = answeredIds([
      item('a1', 'agent'),
      item('d1', 'delegation'),
      item('r1', 'receipt'),
      item('x1', 'relayed'),
    ]);
    expect(ids.size).toBe(0);
  });
});

const BLOCK = `root = Block([c, b])
c = Callout("Two ways to go")
b = Buttons([Button("Go deeper on Metricool", true), Button("Draft the note with the steps"), Button("Go deeper on Metricool")])`;

const parts = (source: string) => {
  const view = resolveUiBlock(source, false);
  if (view.kind !== 'tree') throw new Error(view.kind);
  return view.parts;
};

const draw = (source: string, reply: { gate: ReplyGate } | null, streaming = false) =>
  renderToStaticMarkup(
    createElement(
      UiReplyContext.Provider,
      { value: reply && { gate: reply.gate, send: () => Promise.resolve() } },
      createElement(UiTree, { parts: parts(source), streaming }),
    ),
  );

describe('Buttons in the block', () => {
  it('draws real buttons with the label as text, the suggested one as the primary key', () => {
    const html = draw(BLOCK, { gate: 'open' });
    const buttons = html.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? [];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain('type="button"');
    expect(buttons[0]).toContain('key-primary');
    expect(buttons[0]).toContain('>Go deeper on Metricool</button>');
    expect(buttons[1]).not.toContain('key-primary');
    expect(buttons[1]).toContain('>Draft the note with the steps</button>');
    // What a tap sends is told word for word in the title.
    expect(buttons[1]).toContain('title="Sends: “Draft the note with the steps”"');
    expect(html).toContain('role="group"');
    expect(html).not.toContain('aria-disabled');
  });

  it('shut: still there, aria-disabled, with the reason as title', () => {
    for (const [g, why] of [
      ['answered', 'You already replied after this message'],
      ['working', 'Still working: wait for the reply'],
      ['question', 'Answer the question first'],
    ] as const) {
      const html = draw(BLOCK, { gate: g });
      expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
      expect(html).toContain(`title="${why}"`);
      expect(html).toContain(`data-gate="${g}"`);
    }
  });

  it('shut while the block streams, whatever the chat says', () => {
    const html = draw(BLOCK, { gate: 'open' }, true);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(html).toContain('title="Wait for the reply to finish"');
  });

  it('at most four buttons are drawn', () => {
    const many = Array.from({ length: 7 }, (_, i) => `Button("Step ${i}")`).join(', ');
    const html = draw(`root = Block([b])\nb = Buttons([${many}])`, { gate: 'open' });
    expect(html.match(/<button\b/g)).toHaveLength(4);
    expect(html).not.toContain('Step 4');
  });

  it('not drawn where there is no chat to send to; a block of buttons only draws nothing', () => {
    const html = draw(BLOCK, null);
    expect(html).not.toContain('<button');
    expect(html).toContain('Two ways to go');
    expect(draw('root = Block([b])\nb = Buttons([Button("Go")])', null)).toBe('');
  });

  it('a half-written button (streaming) is not a button', () => {
    const view = resolveUiBlock('root = Block([b])\nb = Buttons([Button("Go deeper', true);
    // Either a skeleton or a partial tree: never a button with no words, never the source.
    if (view.kind === 'tree') {
      const html = renderToStaticMarkup(
        createElement(
          UiReplyContext.Provider,
          { value: { gate: 'open', send: () => Promise.resolve() } },
          createElement(UiTree, { parts: view.parts, streaming: true }),
        ),
      );
      expect(html).not.toContain('<button></button>');
      expect(html).not.toContain('root =');
    } else {
      expect(view.kind).toBe('skeleton');
    }
    expect(parseUiBlock('root = Block([b])\nb = Buttons([Button("Go")])').root).toBeTruthy();
  });
});
