import { pick, type Lang } from '@monsters/shared';

/*
 * What the squad lead reads of `team_propose_monster` (D-153, wave 3): the descriptions of the
 * fields, with their examples, and the hint for an unknown colour. Two families: the one of the
 * app's language at the moment the tool is built. The Italian one is byte for byte what it was
 * (English prose, Italian examples: the examples are what the monster will be written in).
 */

const en = {
  role: 'What it does, one line, e.g. "keeps ideas in order"',
  mission: 'Its job in the second person, e.g. "you collect ideas and put them in order"',
  title: 'With the article, e.g. "the archivist"',
  area: 'Notes folder it writes in, e.g. "Ideas" (it reads every note)',
  color: 'e.g. "green" or "#4f8df7"',
  unknownColourHint: 'Use a colour name (red, green, blue, purple…) or #rrggbb, or leave it out.',
};

const it: typeof en = {
  role: 'What it does, one line, e.g. "tiene in ordine le idee"',
  mission: 'Its job in the second person, e.g. "raccogli le idee e le metti in ordine"',
  title: 'With the article, e.g. "l’archivista"',
  area: 'Notes folder it writes in, e.g. "Idee" (it reads every note)',
  color: 'e.g. "verde" or "#4f8df7"',
  unknownColourHint: 'Use a colour name (rosso, verde, blu, viola…) or #rrggbb, or leave it out.',
};

/** The descriptions of the proposal tool in the app's language now (or in `lang`). */
export const proposeMonsterPrompts = (lang?: Lang) => pick({ en, it }, lang);
