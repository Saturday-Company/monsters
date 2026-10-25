import { describe, expect, it } from 'vitest';
import { radioKeyTarget } from '../src/components/ui/radio-keys.ts';
import {
  dropNotice,
  isSticky,
  KEYED_MIN_MS,
  MAX_WAITING,
  noticeDuration,
  pushNotice,
  type NoticeLine,
} from '../src/store/notice-queue.ts';
import type { Notice } from '../src/store/app.ts';

/* The toasts in line and the arrow keys of a radio group (review of 25/10, W-18, W-31). */

let seq = 0;
const note = (
  text: string,
  tone: Notice['tone'] = 'info',
  extra: Partial<Notice> = {},
): Notice => ({ id: ++seq, text, tone, ...extra });
const keyed = (text: string, tone: Notice['tone'] = 'info', extra: Partial<Notice> = {}) =>
  note(text, tone, { action: { label: 'Do', run: () => {} }, ...extra });
const news = (text: string, tone: Notice['tone'] = 'info') =>
  keyed(text, tone, { fromEvent: true });
const empty: NoticeLine = { notice: null, queue: [] };
const on = (notice: Notice, queue: Notice[] = []): NoticeLine => ({ notice, queue });

describe('how long a toast stays', () => {
  it('plain ones go by themselves, errors a little later', () => {
    expect(noticeDuration(note('a'))).toBe(3500);
    expect(noticeDuration(note('a', 'error'))).toBe(6000);
    expect(noticeDuration(note('a', 'info', { ms: 1000 }))).toBe(1000);
  });

  it('one with a key stays a long while; news with a key until it is used', () => {
    expect(noticeDuration(keyed('a', 'info', { ms: 400 }))).toBe(KEYED_MIN_MS);
    expect(noticeDuration(keyed('a', 'info', { ms: 90_000 }))).toBe(90_000);
    expect(isSticky(news('a'))).toBe(true);
    expect(noticeDuration(news('a'))).toBeNull();
  });
});

describe('the toasts in line', () => {
  it('shows the first message at once', () => {
    const a = note('a');
    expect(pushNotice(empty, a)).toEqual({ notice: a, queue: [] });
  });

  it('replaces a plain answer, which is gone in seconds anyway', () => {
    const b = note('b');
    expect(pushNotice(on(note('a')), b).notice).toBe(b);
  });

  it('replaces an answer with a key by the next answer: the user has moved on', () => {
    const undone = keyed('Change undone');
    const redone = keyed('Change redone');
    expect(pushNotice(on(undone), redone)).toEqual({ notice: redone, queue: [] });
  });

  it('spares an answer with a key from news: the news waits', () => {
    const undo = keyed('Deleted');
    const cap = news('Cap reached');
    expect(pushNotice(on(undo), cap)).toEqual({ notice: undo, queue: [cap] });
    // An error from the core is too important to wait.
    const stopped = news('Stopped', 'error');
    expect(pushNotice(on(undo), stopped)).toEqual({ notice: stopped, queue: [undo] });
  });

  it('never erases news by newer news: it waits', () => {
    const cap = news('Cap reached');
    const done = news('Automation ended');
    expect(pushNotice(on(cap), done)).toEqual({ notice: cap, queue: [done] });
  });

  it('puts the answer to the user, and errors, over news, which comes back after', () => {
    const cap = news('Cap reached');
    const saved = note('Saved', 'success');
    const undone = keyed('Change undone');
    const failed = note('It failed', 'error');
    expect(pushNotice(on(cap), saved)).toEqual({ notice: saved, queue: [cap] });
    expect(pushNotice(on(cap), undone)).toEqual({ notice: undone, queue: [cap] });
    expect(pushNotice(on(cap), failed)).toEqual({ notice: failed, queue: [cap] });
  });

  it('never covers an unread error', () => {
    const failed = note('It failed', 'error');
    const info = note('Hello');
    expect(pushNotice(on(failed), info)).toEqual({ notice: failed, queue: [info] });
    expect(pushNotice(on(failed), note('It failed again', 'error')).notice).toBe(failed);
    expect(pushNotice(on(failed), news('Cap reached')).notice).toBe(failed);
  });

  it('puts errors first, then messages with a key, in the order they came', () => {
    const line = [note('plain'), keyed('keyed'), note('error', 'error')].reduce(
      pushNotice,
      on(note('on screen', 'error')),
    );
    expect(line.queue.map((n) => n.text)).toEqual(['error', 'keyed', 'plain']);
  });

  it('does not queue the same words twice', () => {
    const shown = note('x', 'error');
    expect(pushNotice(on(shown), note('x', 'error'))).toEqual(on(shown));
  });

  it('keeps the line short, losing the plain messages first', () => {
    const k = keyed('keyed');
    let line = pushNotice(on(note('on screen', 'error')), k);
    for (let i = 0; i < MAX_WAITING + 3; i++) line = pushNotice(line, note(`plain ${i}`));
    expect(line.queue).toHaveLength(MAX_WAITING);
    expect(line.queue).toContain(k);
  });

  it('moves on to the next message when one is used or dismissed', () => {
    const a = news('a');
    const b = note('b');
    const line = on(a, [b]);
    expect(dropNotice(line, a.id)).toEqual({ notice: b, queue: [] });
    expect(dropNotice(line, b.id)).toEqual({ notice: a, queue: [] });
    expect(dropNotice(line, 0)).toBe(line);
  });
});

describe('the arrows of a radio group', () => {
  it('move to the next and the previous, around the ends', () => {
    expect(radioKeyTarget('ArrowRight', 0, 3)).toBe(1);
    expect(radioKeyTarget('ArrowDown', 2, 3)).toBe(0);
    expect(radioKeyTarget('ArrowLeft', 0, 3)).toBe(2);
    expect(radioKeyTarget('ArrowUp', 1, 3)).toBe(0);
  });

  it('Home and End go to the ends; other keys are left alone', () => {
    expect(radioKeyTarget('Home', 2, 4)).toBe(0);
    expect(radioKeyTarget('End', 0, 4)).toBe(3);
    expect(radioKeyTarget('a', 0, 4)).toBeNull();
    expect(radioKeyTarget('ArrowRight', 0, 0)).toBeNull();
  });
});
