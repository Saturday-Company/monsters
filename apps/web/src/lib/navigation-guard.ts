/*
 * A hold on in-app navigation, for a form with unsaved changes (review W-4). The routes are
 * hashes, so the move has already happened when `hashchange` arrives: the guard listens before
 * everyone else (this module is imported by the router, so it registers first), and when a
 * blocker wants to hold the move it stops the event, puts the old address back and tells the
 * blocker where the person wanted to go. `proceedNavigation` makes that move later, for real.
 */

type Blocker = (to: string) => void;

let blocker: Blocker | null = null;
/** The address the app is on, as far as the listeners know. */
let current = typeof window === 'undefined' ? '' : window.location.hash;
let passing = false;

function withHash(hash: string): string {
  return window.location.href.replace(/#.*$/, '') + hash;
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', (e) => {
    const to = window.location.hash;
    if (blocker && !passing && to !== current) {
      e.stopImmediatePropagation();
      window.history.replaceState(window.history.state, '', withHash(current));
      blocker(to);
      return;
    }
    current = to;
  });
}

/** Holds back every move of the address until the returned function is called. */
export function holdNavigation(onBlocked: Blocker): () => void {
  blocker = onBlocked;
  // Some moves of the address make no event: start from where it is now.
  current = window.location.hash;
  return () => {
    if (blocker === onBlocked) blocker = null;
  };
}

/** Makes a move that `holdNavigation` held back. */
export function proceedNavigation(to: string): void {
  passing = true;
  try {
    window.history.replaceState(window.history.state, '', withHash(to));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } finally {
    passing = false;
  }
}
