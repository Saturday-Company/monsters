import { create } from 'zustand';

/*
 * The Inbox (docs/design.md, "The top rail"): "To review" and the news of the updates in one place.
 * One count, the same in every view and at every width: what waits for the user. It is derived from
 * the same things the "To review" tab lists, never from what was seen (so the number does not
 * depend on the browser, on which page is open or on whether the column is on screen).
 */

export type InboxTab = 'review' | 'news';

/** The tab on screen (the column and the sheet share it). */
export const useInbox = create<{ tab: InboxTab }>()(() => ({ tab: 'review' }));

export function setInboxTab(tab: InboxTab): void {
  if (useInbox.getState().tab !== tab) useInbox.setState({ tab });
}

/**
 * What waits for the user: the drafts to confirm, the questions shown in the chats (the automations'
 * own questions are in Automations, with their light there) and the tools held back. The notes the
 * monsters touched are information with their Undo, not a task: they never count. The news of an
 * update is a light on the key, not a number.
 */
export function inboxCount(input: {
  drafts: number;
  /** The open questions per chat (`useChats().waiting`). */
  waiting: ReadonlyMap<string, readonly unknown[]>;
  paused: number;
}): number {
  let questions = 0;
  for (const list of input.waiting.values()) questions += list.length;
  return input.drafts + questions + input.paused;
}
