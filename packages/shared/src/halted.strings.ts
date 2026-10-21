import { pick } from './i18n.ts';

/**
 * What a resumed request says around the original one (D-153). It is written as a message of the
 * user, so it follows the app's language; `originalRequest` reads both, whatever the language is
 * now (messages already in the log keep the lead they were written with).
 */
const en = {
  resumeOpen: 'Resume the work I stopped: “',
  resumeClose: '”',
  cutNote: ' […the request went past the limit of one message and was cut here]',
};

const it: typeof en = {
  resumeOpen: 'Riprendi il lavoro che avevo fermato: «',
  resumeClose: '»',
  cutNote: ' […la richiesta continuava oltre il limite di un messaggio ed è stata tagliata qui]',
};

export const haltedStrings = () => pick({ en, it });
/** Both languages, for what reads back a text the core wrote earlier. */
export const haltedStringsAll: readonly (typeof en)[] = [en, it];
