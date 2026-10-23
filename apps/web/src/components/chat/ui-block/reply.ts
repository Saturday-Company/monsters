import { createContext } from 'react';

/*
 * The buttons of a drawn block (D-162) are suggested replies: a tap sends the label the user
 * sees, as their own message, in the chat the block is in. This file decides, apart from React,
 * WHEN a block's buttons may be pressed (the rules below) and carries what the block needs from
 * the chat that holds it. It is small and stays in the first bundle: the chat provides the
 * context, the block (a lazy chunk) reads it. Where there is no chat to send to (the agent
 * terminal, the page of an automation's round, the news) there is no provider and the buttons
 * are not drawn.
 */

/** Why the buttons of a block cannot be pressed now (`open`: they can). */
export type ReplyGate =
  | 'open'
  /** The block's message is still being written. */
  | 'streaming'
  /** The user wrote something after this message: its suggestions are old. */
  | 'answered'
  /** A question of the monster waits for its answer: the composer answers that. */
  | 'question'
  /** The monster is working in this chat: a message now would only queue behind the work. */
  | 'working'
  | 'halted'
  | 'noModel'
  | 'offline';

export interface ReplyState {
  streaming: boolean;
  /** A newer message of the user exists in this chat. */
  answered: boolean;
  question: boolean;
  working: boolean;
  halted: boolean;
  noModel: boolean;
  offline: boolean;
}

/** The first rule that closes the buttons, in the order of what the user most needs to hear. */
export function replyGate(s: ReplyState): ReplyGate {
  if (s.streaming) return 'streaming';
  if (s.answered) return 'answered';
  if (s.question) return 'question';
  if (s.working) return 'working';
  if (s.halted) return 'halted';
  if (s.noModel) return 'noModel';
  if (s.offline) return 'offline';
  return 'open';
}

/**
 * The messages of a chat that have a newer message of the user after them (a typed one, a
 * pending one, one that came from Telegram): their buttons are `answered`. Items are in chat order.
 */
export function answeredIds(items: readonly { id: string; kind: string }[]): Set<string> {
  const isUser = (kind: string) => kind === 'user' || kind === 'telegram';
  let last = -1;
  items.forEach((it, i) => {
    if (isUser(it.kind)) last = i;
  });
  return new Set(items.slice(0, Math.max(0, last)).map((it) => it.id));
}

/** What the chat gives the blocks of one of its messages. */
export interface UiReply {
  gate: ReplyGate;
  /**
   * Sends `label` as the user's message to the chat's monster: the path of the composer, so it is
   * logged, shown and held (while stopped) like a typed message. Rejects when the core refuses.
   */
  send: (label: string) => Promise<void>;
}

export const UiReplyContext = createContext<UiReply | null>(null);
