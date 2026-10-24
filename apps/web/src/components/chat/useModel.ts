import { useSyncExternalStore } from 'react';
import { settingsPath } from '../../lib/router.ts';
import { getApi } from '../../store/app.ts';

/*
 * Whether a model is connected at all (a key, a subscription or a local
 * server): without one the monsters cannot work, and the chat says so plainly
 * instead of promising answers (D-053, audit 2.4). Asked to the core when the
 * chats are shown; unknown (null) until it answers, and then nothing is said.
 */

let missing: boolean | null = null;
const listeners = new Set<() => void>();

function set(next: boolean | null) {
  if (next === missing) return;
  missing = next;
  for (const l of listeners) l();
}

/** Asks the core again (the chats call it when they are shown). */
export function checkModel(): void {
  getApi()
    .providers()
    .then((r) => set(!r.providers.some((p) => p.configured)))
    .catch(() => {
      // An older core, or a network hiccup: say nothing rather than something wrong.
    });
}

/** True when no model is connected; false when one is, or when it is not known. */
export function useNoModel(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => missing === true,
  );
}

/** Settings → Modelli, where a model is connected (named, so the link says where it goes). */
export const MODELS_PATH = settingsPath('modelli');
