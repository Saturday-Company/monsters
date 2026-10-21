import { pick, type Lang } from '@monsters/shared';

/*
 * What the orchestrator reads when its final answer ends with a question (D-153, wave 3): the
 * reminder of the stop hook. Two families: the one of the app's language at the moment it is
 * sent. The Italian one is byte for byte what it was; the code that looks for the reminder in
 * the log accepts either.
 */

const en = {
  reminder:
    'You asked a question in plain text: if there are clear options, use ask_user with 2-4 options; ' +
    'if a fact only the user knows is missing, use ask_user without options; otherwise the plain-text question ' +
    'is fine as it is: reply only OK. Do not repeat the answer: the user has already read it.',
};

/** The English reminder of wave 3 (D-153), before the review of the English family: still read in a log. */
const EN_V1 =
  'You asked a question in the text: if there are clear options, use ask_user with 2-4 options; ' +
  'if a fact only the user knows is missing, ask_user without options; otherwise the question in the text ' +
  'is fine as it is and you reply only OK. Do not repeat the answer: the user has already read it.';

const it: typeof en = {
  reminder:
    'Hai fatto una domanda in testo: se ci sono opzioni chiare, usa ask_user con 2-4 opzioni; ' +
    "se manca un fatto che solo l'utente sa, ask_user senza opzioni; altrimenti la domanda in testo " +
    "va bene così e rispondi solo OK. Non ripetere la risposta: l'utente l'ha già letta.",
};

/** The prompts of the stop hook in the app's language now (or in `lang`). */
export const finalQuestionPrompts = (lang?: Lang) => pick({ en, it }, lang);

/** The reminder of each family: a log that holds either is a reminder already sent. */
export const FINAL_QUESTION_REMINDERS: readonly string[] = [it.reminder, en.reminder, EN_V1];
