import { create } from 'zustand';

/*
 * The doubts of the check the person closed with "Looks fine" (the notice under a reply,
 * chat/TurnBlock.tsx): the ids of their events, per browser (localStorage, a convenience:
 * without storage a closed notice comes back with the page). The event stays in Activity.
 */

const KEY = 'monsters-doubts-ok';
/** The most ids kept: the oldest go first. */
const MAX = 300;

function read(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export const useDoubts = create<{ closed: readonly string[] }>()(() => ({ closed: read() }));

/** The person said it is fine: the notice of this doubt goes away. */
export function closeDoubt(id: string): void {
  const { closed } = useDoubts.getState();
  if (closed.includes(id)) return;
  const next = [...closed, id].slice(-MAX);
  useDoubts.setState({ closed: next });
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode or storage blocked: closed until the page reloads
  }
}
