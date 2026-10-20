import { useEffect, useRef } from 'react';

/*
 * The browser's Back closes the pane on a phone (D-086): the pane covers the
 * whole screen there, and Back left the app instead of closing it. While it is
 * open the history has one entry more, with the same address (no `hashchange`,
 * the hash routing does not see it) and a mark in its state; Back takes it
 * away and the pane closes. ✕, Esc and Indietro of the rail go back the same
 * way (`closeByBack`): the pane closes when the history is back where it was,
 * so a page opened right after is never undone by a step back still on its
 * way. Closed by something else, the entry is taken away a moment later, only
 * while it is still the current one at the same address.
 */

const MARK = 'monstersDock';

const markOf = (state: unknown): string | undefined => {
  if (!state || typeof state !== 'object') return undefined;
  const v = (state as Record<string, unknown>)[MARK];
  return typeof v === 'string' ? v : undefined;
};

/** The entry is taken away a moment after the pane closes: one that opens again at once keeps it. */
let pendingBack: ReturnType<typeof setTimeout> | null = null;
/** The mark of the entry of the open pane. */
let current: string | null = null;

/**
 * Closes the pane: with a step back when its entry is the current one (the
 * `popstate` closes it), else at once.
 */
export function closeByBack(close: () => void): void {
  if (current !== null && markOf(window.history.state) === current) window.history.back();
  else close();
}

/** Pushes the entry while `active`; Back calls `close`. */
export function useBackCloses(active: boolean, close: () => void): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const href = window.location.href;
    if (pendingBack !== null) {
      clearTimeout(pendingBack);
      pendingBack = null;
    }
    let token = markOf(window.history.state);
    if (!token) {
      token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const base: unknown = window.history.state;
      window.history.pushState(
        { ...(base && typeof base === 'object' ? base : {}), [MARK]: token },
        '',
        href,
      );
    }
    const mine = token;
    current = mine;
    let popped = false;
    const onPop = (e: PopStateEvent) => {
      if (markOf(e.state) === mine) return;
      popped = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (current === mine) current = null;
      if (popped) return;
      pendingBack = setTimeout(() => {
        pendingBack = null;
        if (markOf(window.history.state) === mine && window.location.href === href) {
          window.history.back();
        }
      }, 0);
    };
  }, [active]);
}
