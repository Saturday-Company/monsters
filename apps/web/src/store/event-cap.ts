import type { LogEvent } from '@monsters/shared';
import type { ChatHistory } from './app.ts';

/*
 * The events in memory (W-25). Every event of a long session used to stay in the store, and
 * several derivations run over all of them at each new event (the chat, the runs, the
 * questions). The store keeps the newest ones; older ones are read again from the core when a
 * chat or Activity asks for them (`loadChatOlder`, `loadOlder`), so nothing is lost, only not
 * held.
 */

/** How far back a new chunk looks for the chunk it continues (events of other runs in between). */
const FOLD_LOOKBACK = 300;

type Chunk = LogEvent<'message'>;

/** A chunk of an answer being written: a monster's own words, not a delegate's, not a closing. */
function isChunk(e: LogEvent): e is Chunk {
  return (
    e.type === 'message' &&
    e.data.role === 'agent' &&
    e.data.partial === true &&
    e.data.status === undefined &&
    !e.parentId &&
    !!e.runId
  );
}

/** The chunk `e` continues: the latest event of its run, if that is a chunk of the same kind. */
function continuedChunk(events: readonly LogEvent[], e: Chunk): number {
  const stop = Math.max(0, events.length - FOLD_LOOKBACK);
  for (let i = events.length - 1; i >= stop; i--) {
    const x = events[i]!;
    if (x.runId !== null && x.runId !== e.runId) continue;
    // The latest event of this run (or one outside any run, which may touch it): it decides.
    if (x.runId === null || !isChunk(x) || x.agent !== e.agent) return -1;
    const [a, b] = [x.data, e.data];
    return a.to === b.to && a.channel === b.channel && a.automationId === b.automationId ? i : -1;
  }
  return -1;
}

/**
 * Appends events newer than all of `events`, folding each chunk of an answer into the chunk it
 * continues (a monster writing sends one every 250 ms; most of a busy log is made of them,
 * W-25). A chunk is folded only into the latest event of its run, so nothing happened in
 * between that could end the draft: the chat, the terminal and every other reading of the log
 * build the same pictures from the folded chunk as from the pieces. The folded chunk keeps the
 * id and time of the first piece.
 */
export function appendFolding(events: readonly LogEvent[], fresh: readonly LogEvent[]): LogEvent[] {
  const out = events.slice();
  for (const e of fresh) {
    const at = isChunk(e) ? continuedChunk(out, e) : -1;
    if (at < 0) {
      out.push(e);
      continue;
    }
    const into = out[at] as Chunk;
    out[at] = { ...into, data: { ...into.data, text: into.data.text + (e as Chunk).data.text } };
  }
  return out;
}

/** Events kept in memory, besides the pages of history the user asked for. */
export const EVENTS_KEEP = 5000;
/** How far over the cap the store may grow before it trims (the copy is not paid at each event). */
export const EVENTS_SLACK = 500;

export interface Trimmed {
  events: LogEvent[];
  /** The events that left, oldest first. */
  dropped: LogEvent[];
  /** Id of the oldest event that stayed: the log is complete from there on. */
  floor: string;
}

/**
 * The newest events of `events` (sorted by id) when it has grown over `keep + slack`; null when
 * there is nothing to do. `retain` keeps an old event anyway (a question still open: its card
 * must not vanish from the chat).
 */
export function trimEvents(
  events: readonly LogEvent[],
  keep: number,
  retain: (e: LogEvent) => boolean,
  slack: number = EVENTS_SLACK,
): Trimmed | null {
  if (events.length <= keep + slack) return null;
  const cut = events.length - keep;
  const kept = events.slice(cut);
  const dropped: LogEvent[] = [];
  const retained: LogEvent[] = [];
  for (let i = 0; i < cut; i++) {
    const e = events[i]!;
    (retain(e) ? retained : dropped).push(e);
  }
  return { events: retained.length ? [...retained, ...kept] : kept, dropped, floor: kept[0]!.id };
}

/**
 * The history of the chats after a trim: what a chat had loaded is now complete only from the
 * floor on, and older events are there to read again.
 */
export function chatsAfterTrim(
  chats: Readonly<Record<string, ChatHistory>>,
  floor: string,
): Record<string, ChatHistory> {
  const out: Record<string, ChatHistory> = {};
  for (const [id, h] of Object.entries(chats)) {
    // A chat that had everything now lacks what left; one with older pages keeps its newer edge.
    out[id] =
      !h.hasOlder || h.before === null || h.before < floor
        ? { ...h, before: floor, hasOlder: true }
        : h;
  }
  return out;
}
