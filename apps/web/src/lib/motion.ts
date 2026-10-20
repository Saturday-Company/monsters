import { useSyncExternalStore } from 'react';
import { usePrefs } from '../store/prefs.ts';

/*
 * The grammar of motion on the JavaScript side (docs/design.md, "Movimento",
 * D-084). The movements themselves are CSS (styles.css: `.rise-in`,
 * `.drop-in`, `.slide-in`, `.light-on`, keys and levers); this file only
 * holds the lengths that timers must match and the reduced-motion switch.
 */

/** One frame of the instrument's display. */
export const FRAME_MS = 40;
/** A press: a key going down, a lever snapping (two frames, `--dur-press`). */
export const PRESS_MS = 2 * FRAME_MS;
/** Something small coming in or a pane going out (three frames, `--dur-ui`). */
export const UI_MS = 3 * FRAME_MS;
/** A sheet or the pane coming in (four frames, `--dur-sheet`). */
export const SHEET_MS = 4 * FRAME_MS;
/** The name on a monitor flickering when the monster starts working (chat.css `monitor-kick`). */
export const KICK_MS = 13 * FRAME_MS;

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * "Riduci movimento", the system's or the app's, read outside React: the same
 * as `data-motion="reduced"` on <html> (store/prefs.ts `watchPrefs`).
 */
export function still(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset['motion'] === 'reduced')
    return true;
  return typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches;
}

function subscribeSystem(cb: () => void): () => void {
  const q = window.matchMedia?.(QUERY);
  q?.addEventListener('change', cb);
  return () => q?.removeEventListener('change', cb);
}

const systemStill = () => !!window.matchMedia?.(QUERY).matches;

/** `still()` as a hook: true when every change should be a change of state, at once. */
export function useStill(): boolean {
  const system = useSyncExternalStore(subscribeSystem, systemStill, () => false);
  const app = usePrefs((p) => p.reduceMotion);
  return system || app;
}
