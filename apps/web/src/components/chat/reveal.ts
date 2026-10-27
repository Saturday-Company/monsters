import { create } from 'zustand';

/*
 * Where the open chat should scroll to, from elsewhere in the app: a question's card (To review →
 * a waiting question), a turn by its run (an anchor such as "open this turn"). The chat's
 * transcript renders only the rows near the screen once it is long (VirtualList.tsx), so a
 * `querySelector` from outside would miss a far row: the chat itself brings the row in. A target
 * that no chat takes within a few seconds is dropped (the chat may have to mount first).
 */

export type RevealTarget = { questionId: string } | { runId: string };

export const REVEAL_MS = 5000;

export const useChatReveal = create<{ target: RevealTarget | null; at: number }>(() => ({
  target: null,
  at: 0,
}));

/** Asks the chat that holds it to scroll to a question's card or to a turn. */
export function revealInChat(target: RevealTarget): void {
  useChatReveal.setState({ target, at: Date.now() });
}

/** The chat took it. */
export function revealDone(): void {
  useChatReveal.setState({ target: null, at: 0 });
}
