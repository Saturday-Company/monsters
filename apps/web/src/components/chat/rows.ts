import { dayKey } from '../../lib/utils.ts';
import { telegramWhere, type ChatItem } from '../../store/derive.ts';
import type { ChatBlock, Turn } from '../../store/turn.ts';

/*
 * The rows of a chat's transcript (docs/design.md, "The chat"): days and pauses as separators,
 * the turns, the items of no turn. A pure list, so the transcript can render only the rows near
 * the screen (`VirtualList`) and still know where everything is. The space above a row is its
 * own padding (not a margin): a row's measured height is then all the room it takes.
 */

/** A pause this long between two messages of the same sender keeps their bubbles apart. */
const GAP_MS = 30 * 60_000;

/** A pause this long between two turns of the same day shows the time at the head of the next. */
const TIME_GAP_MS = 5 * 60_000;

export type ChatRow =
  | { kind: 'day'; key: string; ts: number; space: string }
  | { kind: 'gap'; key: string; ts: number; space: string }
  | { kind: 'turn'; key: string; turn: Turn; space: string }
  | {
      kind: 'item';
      key: string;
      item: ChatItem;
      /** An open question of a previous conversation, shown in the current one. */
      carried: boolean;
      /** First bubble of its run of bubbles. */
      first: boolean;
      space: string;
    };

/** Same sender as the item before, with no pause: the bubbles stay together. */
export function sameRun(item: ChatItem, prev: ChatItem | undefined): boolean {
  if (!prev || item.ts - prev.ts > GAP_MS) return false;
  if (item.kind === 'agent')
    return prev.kind === 'agent' && prev.agent === item.agent && prev.via === item.via;
  if (item.kind === 'user') return prev.kind === 'user';
  if (item.kind === 'relayed') return prev.kind === 'relayed' && prev.from === item.from;
  if (item.kind === 'telegram')
    return (
      prev.kind === 'telegram' &&
      prev.sender.id === item.sender.id &&
      telegramWhere(prev) === telegramWhere(item)
    );
  return false;
}

/** The first item of a block: where it sits in time. */
export function firstOf(block: ChatBlock): ChatItem | null {
  if (block.kind === 'item') return block.item;
  return block.request ?? block.received[0] ?? block.column[0] ?? block.tasks[0] ?? null;
}

/** The time of the latest thing a turn said: a pause after it shows the time again. */
function lastTs(turn: Turn): number {
  let ts = turn.ts;
  for (const c of turn.column) if (c.ts > ts) ts = c.ts;
  return ts;
}

/** The rows of the blocks of a chat, in order. */
export function chatRows(blocks: readonly ChatBlock[]): ChatRow[] {
  const rows: ChatRow[] = [];
  let prevTs: number | null = null;
  let prevItem: ChatItem | undefined;
  for (const block of blocks) {
    const ts = block.kind === 'turn' ? block.ts : block.item.ts;
    const newDay = prevTs === null || dayKey(prevTs) !== dayKey(ts);
    const first = firstOf(block);
    const gap = !newDay && prevTs !== null && first?.kind !== 'reset' && ts - prevTs > TIME_GAP_MS;
    if (newDay)
      rows.push({ kind: 'day', key: `day-${block.id}`, ts, space: rows.length ? 'pt-2' : '' });
    else if (gap) rows.push({ kind: 'gap', key: `gap-${block.id}`, ts, space: 'pt-4' });
    if (block.kind === 'turn') {
      rows.push({
        kind: 'turn',
        key: block.id,
        turn: block,
        space: newDay || gap ? 'pt-2' : 'pt-5',
      });
      prevTs = lastTs(block);
      prevItem = undefined;
      continue;
    }
    const { item, carried } = block;
    const continues = !newDay && !gap && sameRun(item, prevItem);
    const event =
      item.kind === 'delegation' ||
      item.kind === 'system' ||
      item.kind === 'reset' ||
      item.kind === 'instinct' ||
      item.kind === 'report';
    rows.push({
      kind: 'item',
      // Stable: a question carried over keeps its element when the earlier messages open.
      key: item.id,
      item,
      carried,
      first: !continues,
      space: continues ? 'pt-1' : newDay || gap ? 'pt-2' : event ? 'pt-4' : 'pt-5',
    });
    prevTs = item.ts;
    prevItem = item;
  }
  return rows;
}

/** The key of the row that holds a question's card, if the chat shows it. */
export function rowOfQuestion(blocks: readonly ChatBlock[], questionId: string): string | null {
  for (const b of blocks) {
    if (b.kind === 'item') {
      if (b.item.kind === 'question' && b.item.questionId === questionId) return b.item.id;
    } else if (b.column.some((c) => c.kind === 'question' && c.questionId === questionId))
      return b.id;
  }
  return null;
}

/** The key of the row of the (first) turn of a run, if the chat shows it. */
export function rowOfRun(blocks: readonly ChatBlock[], runId: string): string | null {
  for (const b of blocks) if (b.kind === 'turn' && b.runId === runId) return b.id;
  return null;
}

/**
 * The user's messages that can be sent "Again": in each run only the last one the user wrote
 * (two requests in one run are two turns, the first already answered by the run going on); a
 * message outside any run stands for itself.
 */
export function againIds(items: readonly ChatItem[]): Set<string> {
  const last = new Map<string, string>();
  for (const it of items) if (it.kind === 'user') last.set(it.runId ?? `id:${it.id}`, it.id);
  return new Set(last.values());
}
