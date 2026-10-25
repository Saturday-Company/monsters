import type { Notice } from './app.ts';

/*
 * The toasts in line (review of 25/10, W-18). One is on screen; the others wait.
 *
 * Two kinds of message. The answer to what the user just did ("Saved", "Change undone" with its
 * "Redo") is replaced by the next answer: the user has moved on. News from the core (a cap
 * reached, a tool changed, an automation ended: `fromEvent`) is not: with a key it stays on
 * screen until it is used or dismissed, and another piece of news waits behind it instead of
 * erasing it. An answer to the user, or an error, still comes first over news, which then comes
 * back. An error on screen is never covered, and an answer with a key is spared by news.
 */

/** Waiting messages kept at most; the plain ones go first. */
export const MAX_WAITING = 5;

/** The least a message with a key stays up, in ms: a keyboard or screen-reader user needs time. */
export const KEYED_MIN_MS = 30_000;

const isKeyed = (n: Notice): boolean => n.action !== undefined;

/** News with a key stays until it is used or dismissed. */
export const isSticky = (n: Notice): boolean => isKeyed(n) && n.fromEvent === true;

/** How long a message stays up by itself, in ms; null when it stays until it is used or dismissed. */
export function noticeDuration(n: Notice): number | null {
  if (isSticky(n)) return null;
  if (isKeyed(n)) return Math.max(n.ms ?? 0, KEYED_MIN_MS);
  return n.ms ?? (n.tone === 'error' ? 6000 : 3500);
}

export interface NoticeLine {
  notice: Notice | null;
  queue: readonly Notice[];
}

/** The line after a new message. */
export function pushNotice(line: NoticeLine, incoming: Notice): NoticeLine {
  const { notice, queue } = line;
  if (!notice) return { notice: incoming, queue };
  // The same words again (a repeated failure) are not queued twice.
  if (notice.text === incoming.text || queue.some((n) => n.text === incoming.text)) return line;
  // The message on screen goes back to the head of the line and comes back after the new one.
  const first = { notice: incoming, queue: [notice, ...queue] };
  if (notice.tone !== 'error') {
    if (notice.fromEvent) {
      // News on screen: the answer to the user, or an error, comes first.
      if (!incoming.fromEvent || incoming.tone === 'error') return first;
    } else if (!isKeyed(notice) || !incoming.fromEvent) {
      // An answer, plain or with a key, is replaced by the next answer.
      return { notice: incoming, queue };
    } else if (incoming.tone === 'error') {
      // An answer with a key is spared by news, unless the news is an error.
      return first;
    }
  }
  const waiting = [...queue, incoming];
  // Errors first, then keys, each in the order they came (the sort is stable).
  const rank = (n: Notice) => (n.tone === 'error' ? 0 : isKeyed(n) ? 1 : 2);
  waiting.sort((a, b) => rank(a) - rank(b));
  while (waiting.length > MAX_WAITING) {
    const drop = waiting.findLastIndex((n) => !isKeyed(n) && n.tone !== 'error');
    waiting.splice(drop >= 0 ? drop : waiting.length - 1, 1);
  }
  return { notice, queue: waiting };
}

/** The line after a message is dismissed, used or expired. */
export function dropNotice(line: NoticeLine, id: number): NoticeLine {
  if (line.notice?.id === id) {
    const [next, ...queue] = line.queue;
    return { notice: next ?? null, queue };
  }
  if (line.queue.some((n) => n.id === id)) {
    return { notice: line.notice, queue: line.queue.filter((n) => n.id !== id) };
  }
  return line;
}
