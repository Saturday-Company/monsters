import type { TeamDraft } from '@monsters/shared';
import { useEffect, useState } from 'react';

/*
 * "Cambia" on a proposal of the capo squadra (D-075): the draft goes to the
 * form of Settings → Squadra, which shows it when it opens. A module
 * slot, not app state: nothing else reads it, and it never outlives the move.
 */

export interface DraftHandoff {
  draft: TeamDraft;
  /** The proposal it comes from: the create request carries it. */
  proposal: string;
  /** The model the capo squadra proposed (D-079): shown in the form, kept unless unticked. */
  models?: { provider: string; model: string }[];
}

let pending: DraftHandoff | null = null;

export function handDraft(handoff: DraftHandoff): void {
  pending = handoff;
}

/** The draft handed over (null when there is none); `clearDraft` once it is shown. */
export function peekDraft(): DraftHandoff | null {
  return pending;
}

export function clearDraft(): void {
  pending = null;
}

/**
 * The draft handed over, for a form that opens with it: taken from the slot when the page mounts
 * and cleared there, and `consume` once the form is closed (cancelled or done), so the next
 * "Add a monster" opens empty instead of with the old draft again (review of 28/10).
 */
export function useDraftHandoff(): [handoff: DraftHandoff | null, consume: () => void] {
  const [handoff, setHandoff] = useState(peekDraft);
  useEffect(() => clearDraft(), []);
  return [handoff, () => setHandoff(null)];
}
