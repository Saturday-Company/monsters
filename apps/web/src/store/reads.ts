import { create } from 'zustand';

/*
 * What the user has already seen of each chat, for the unread badges of the
 * chat list. Per viewer and per browser (localStorage): a convenience, not
 * state the core needs. Ids are event ids (ULIDs sort by time), so "seen up to
 * X" is a single string per monster.
 */

export interface Reads {
  /** Last event id seen, per monster. */
  seen: Record<string, string>;
  /**
   * Everything up to this id counts as seen, for chats never opened here: set
   * the first time the chats are shown, so an existing history is not a wall
   * of badges.
   */
  baseline: string | null;
}

const KEY = 'monsters-reads';

function load(): Reads {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { seen: {}, baseline: null };
    const r = JSON.parse(raw) as Partial<Reads>;
    const seen: Record<string, string> = {};
    if (r.seen && typeof r.seen === 'object')
      for (const [k, v] of Object.entries(r.seen)) if (typeof v === 'string') seen[k] = v;
    return { seen, baseline: typeof r.baseline === 'string' ? r.baseline : null };
  } catch {
    return { seen: {}, baseline: null };
  }
}

export const useReads = create<Reads>()(() => load());

function save(): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(useReads.getState()));
  } catch {
    // private mode or storage blocked: the marks last for this tab only
  }
}

/** Marks a chat as seen up to `id` (never backwards). */
export function markSeen(agentId: string, id: string): void {
  const cur = seenOf(useReads.getState(), agentId);
  if (id <= cur) return;
  useReads.setState((s) => ({ seen: { ...s.seen, [agentId]: id } }));
  save();
}

/** Sets the baseline once, the first time the chats are shown. */
export function initBaseline(id: string): void {
  if (useReads.getState().baseline !== null) return;
  useReads.setState({ baseline: id });
  save();
}

/** The id a chat has been seen up to ('' when nothing). */
export function seenOf(r: Reads, agentId: string): string {
  const own = r.seen[agentId] ?? '';
  const base = r.baseline ?? '';
  return own > base ? own : base;
}
