import { setAppLang } from '@monsters/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { againIds, chatRows, rowOfQuestion, rowOfRun } from '../src/components/chat/rows.ts';
import {
  offsets,
  rowAt,
  spanFor,
  spanFromEnd,
  spanServes,
  withRow,
} from '../src/components/chat/virtual.ts';
import type { ChatItem } from '../src/store/derive.ts';
import type { ChatBlock, Turn } from '../src/store/turn.ts';

/*
 * The long chat's transcript (stream J): the arithmetic of the window of rendered rows, and the
 * rows of a chat (separators, spacing, where a question or a turn is), without a browser.
 */

beforeAll(() => setAppLang('en'));
afterAll(() => setAppLang('en'));

describe('the window of rendered rows', () => {
  const heights = [100, 50, 200, 100, 300, 100, 100, 50];
  const off = offsets(heights);

  it('places each row after the ones before it', () => {
    expect(off).toEqual([0, 100, 150, 350, 450, 750, 850, 950, 1000]);
    expect(rowAt(off, 0)).toBe(0);
    expect(rowAt(off, 99)).toBe(0);
    expect(rowAt(off, 100)).toBe(1);
    expect(rowAt(off, 449)).toBe(3);
    expect(rowAt(off, 5000)).toBe(7);
  });

  it('covers the screen and one more screen each way', () => {
    // Screen from 400 to 600, one screen (200) over: rows from 200 to 800.
    expect(spanFor(off, 400, 600, 200)).toEqual({ start: 2, end: 5 });
    // At the top it does not go below row 0, at the end not past the last.
    expect(spanFor(off, 0, 200, 200)).toEqual({ start: 0, end: 3 });
    expect(spanFor(off, 800, 1000, 200)).toEqual({ start: 4, end: 7 });
    expect(spanFor(offsets([]), 0, 100, 100)).toEqual({ start: 0, end: -1 });
  });

  it('keeps the span while the screen is inside it with a margin, and shrinks one far too big', () => {
    const span = spanFor(off, 400, 600, 200);
    expect(spanServes(off, span, 400, 600, 200)).toBe(true);
    expect(spanServes(off, span, 420, 620, 200)).toBe(true);
    // Near its top edge: a new span is due.
    expect(spanServes(off, span, 180, 380, 200)).toBe(false);
    // Everything rendered for a screen of 100: too big.
    expect(spanServes(off, { start: 0, end: 7 }, 400, 500, 100)).toBe(false);
  });

  it('opens at the end, about the height asked', () => {
    expect(spanFromEnd(heights, 120)).toEqual({ start: 6, end: 7 });
    expect(spanFromEnd(heights, 5000)).toEqual({ start: 0, end: 7 });
  });

  it('keeps a focused row near the span, not one far away', () => {
    expect(withRow({ start: 10, end: 20 }, 5)).toEqual({ start: 5, end: 20 });
    expect(withRow({ start: 10, end: 20 }, 25)).toEqual({ start: 10, end: 25 });
    expect(withRow({ start: 100, end: 120 }, 5)).toEqual({ start: 100, end: 120 });
    expect(withRow({ start: 10, end: 20 }, -1)).toEqual({ start: 10, end: 20 });
  });
});

const DAY = 24 * 3_600_000;
const T0 = Date.UTC(2026, 9, 20, 9, 0);

function user(id: string, ts: number, runId?: string): ChatItem {
  return { kind: 'user', id, ts, text: id, ...(runId ? { runId } : {}) };
}

function turn(runId: string, ts: number, column: ChatItem[] = []): Turn {
  return {
    kind: 'turn',
    id: `turn:${runId}`,
    runId,
    ts,
    agent: 'titan',
    request: null,
    received: [],
    column: column as Turn['column'],
    tasks: [],
    instinct: [],
    flags: [],
    attachments: [],
    receipt: null,
    stats: null,
    steps: [],
    lastBubble: null,
  };
}

const item = (it: ChatItem, carried = false): ChatBlock => ({
  kind: 'item',
  id: it.id,
  item: it,
  carried,
});

describe('the rows of a chat', () => {
  it('puts a day before the first block and each new day, the time after a pause', () => {
    const blocks: ChatBlock[] = [
      turn('r1', T0),
      turn('r2', T0 + 60_000),
      turn('r3', T0 + 20 * 60_000),
      turn('r4', T0 + DAY),
    ];
    const rows = chatRows(blocks);
    expect(rows.map((r) => `${r.kind}:${r.space}`)).toEqual([
      'day:',
      'turn:pt-2',
      'turn:pt-5',
      'gap:pt-4',
      'turn:pt-2',
      'day:pt-2',
      'turn:pt-2',
    ]);
    expect(rows.map((r) => r.key)).toEqual([
      'day-turn:r1',
      'turn:r1',
      'turn:r2',
      'gap-turn:r3',
      'turn:r3',
      'day-turn:r4',
      'turn:r4',
    ]);
  });

  it('keeps messages of the same sender together', () => {
    const rows = chatRows([item(user('a', T0)), item(user('b', T0 + 1000))]);
    const [, a, b] = rows;
    expect(a).toMatchObject({ kind: 'item', first: true, space: 'pt-2' });
    expect(b).toMatchObject({ kind: 'item', first: false, space: 'pt-1' });
  });

  it('finds the row of a question and of a run', () => {
    const q: ChatItem = {
      kind: 'question',
      id: 'q-item',
      ts: T0,
      agent: 'titan',
      questionId: 'q1',
      runId: 'r2',
    };
    const blocks: ChatBlock[] = [
      turn('r1', T0),
      turn('r2', T0 + 1000, [q]),
      item(user('u', T0 + 2000)),
    ];
    expect(rowOfQuestion(blocks, 'q1')).toBe('turn:r2');
    expect(rowOfQuestion(blocks, 'nope')).toBeNull();
    expect(rowOfRun(blocks, 'r1')).toBe('turn:r1');
    expect(rowOfRun(blocks, 'r9')).toBeNull();
  });
});

describe('"Again" on the user’s messages', () => {
  it('is only on the last message of each run, and on a message outside any run', () => {
    const items = [
      user('a', T0, 'r1'),
      user('b', T0 + 1, 'r1'),
      user('c', T0 + 2, 'r2'),
      user('d', T0 + 3),
    ];
    expect([...againIds(items)].sort()).toEqual(['b', 'c', 'd']);
  });
});
