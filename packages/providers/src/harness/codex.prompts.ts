import { pick, type Lang } from '@monsters/shared';

/*
 * What Codex's model reads from Monsters (D-135, D-153): the answer to its own
 * `request_user_input`. Two families, the one of the app's language when it is answered.
 */

const en = {
  userInputAnswer:
    '[Monsters, not the user] This question did not reach the user: in Monsters questions are asked with `ask_user` of the `monsters` server (if it is among your tools), otherwise write the question in the report. It is not a no from the user.',
};

const it: typeof en = {
  userInputAnswer:
    '[Monsters, non l’utente] Questa domanda non è arrivata all’utente: in Monsters le domande si fanno con `ask_user` del server `monsters` (se è tra i tuoi strumenti), altrimenti scrivi la domanda nel rapporto. Non è un no dell’utente.',
};

export const codexPrompts = (lang?: Lang) => pick({ en, it }, lang);
