import { pick, type Lang } from '@monsters/shared';

/*
 * What a monster reads of its own memory (D-153, wave 3): the line that says how much older
 * text the prompt left out. Two families: the one of the app's language at the moment the
 * prompt is built. The Italian one is byte for byte what it was.
 */

const en = {
  olderNotShown: (chars: number) =>
    `[… ${chars} older characters not shown: the memory needs compacting]`,
};

const it: typeof en = {
  olderNotShown: (chars) =>
    `[… ${chars} caratteri più vecchi non mostrati: la memoria va compattata]`,
};

/** The prompts of the memory in the app's language now (or in `lang`). */
export const memoryPrompts = (lang?: Lang) => pick({ en, it }, lang);
