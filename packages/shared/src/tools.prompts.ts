import { pick, type Lang } from './i18n.ts';

/*
 * What the model reads next to a tool failure that is not the user's no (D-132, D-153): two
 * families, the one of the app's language when the note is written.
 */

const en = {
  user_no_answer: 'Nobody answered in time (the user may not have seen it): it is not their no.',
  setting_off:
    'A setting is off: it is not a no from the user. Only the user can change it, where the message says.',
  not_linked: 'The service has to be reconnected or its key fixed by the user: it is not their no.',
  site_refused:
    'The site or service refused: it is not a permission of the user or of Monsters, and nobody can turn it on from Monsters.',
  monsters_policy:
    'A fixed rule of Monsters: it is not a no from the user and no setting changes it.',
  not_in_run: 'It is not a tool of this job: it is not a no from the user.',
};

const it: typeof en = {
  user_no_answer: 'Nessuno ha risposto in tempo (l’utente può non averlo visto): non è un suo no.',
  setting_off:
    'Un’impostazione è spenta: non è un no dell’utente. La cambia solo l’utente, dove dice il messaggio.',
  not_linked:
    'Il servizio va ricollegato o la sua chiave va sistemata dall’utente: non è un suo no.',
  site_refused:
    'Il sito o il servizio ha rifiutato: non è un permesso dell’utente né di Monsters, e nessuno lo può accendere da Monsters.',
  monsters_policy:
    'Regola fissa di Monsters: non è un no dell’utente e nessuna impostazione la cambia.',
  not_in_run: 'Non è uno strumento di questo lavoro: non è un no dell’utente.',
};

export const toolCausePrompts = (lang?: Lang) => pick({ en, it }, lang);
