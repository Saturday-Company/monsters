import { pick, type Lang } from '@monsters/shared';

/*
 * What Codex's model reads from Monsters (D-135, D-153): the answer to its own
 * `request_user_input`, and the note after a command Monsters did not let out of
 * the sandbox (D-158). Two families, the one of the app's language when it is answered.
 */

const en = {
  userInputAnswer:
    '[Monsters, not the user] This question did not reach the user: in Monsters questions are asked with `ask_user` of the `monsters` server (if it is among your tools), otherwise write the question in the report. It is not a no from the user.',
  commandRefused: (command: string, reason: string) =>
    `[Monsters] The command \`${command}\` did not run. Codex reports it as “rejected by user”; this is what Monsters’ checks answered: ${reason}`,
};

const it: typeof en = {
  userInputAnswer:
    '[Monsters, non l’utente] Questa domanda non è arrivata all’utente: in Monsters le domande si fanno con `ask_user` del server `monsters` (se è tra i tuoi strumenti), altrimenti scrivi la domanda nel rapporto. Non è un no dell’utente.',
  commandRefused: (command, reason) =>
    `[Monsters] Il comando \`${command}\` non è partito. Codex lo riporta come «rejected by user»; ecco cosa hanno risposto i controlli di Monsters: ${reason}`,
};

export const codexPrompts = (lang?: Lang) => pick({ en, it }, lang);
