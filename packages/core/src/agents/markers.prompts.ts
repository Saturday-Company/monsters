import type { Lang } from '@monsters/shared';

/*
 * Words the prompts ask the models to write and the code then looks for in what they wrote
 * (D-153): each family has its own, the readers accept both (a file or a habit of the other
 * family still works).
 */

/** The heading of the lines the agent wants kept in its memory (`splitRemember`, memory.ts). */
export const REMEMBER_MARKER: Record<Lang, string> = {
  it: 'Da ricordare',
  en: 'To remember',
};

/** The heading of the choices a monster leaves to its capo in the report. */
export const DECIDE_MARKER: Record<Lang, string> = {
  it: 'Da decidere',
  en: 'To decide',
};
