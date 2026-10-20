import type { TeamDraft } from '@monsters/shared';

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
