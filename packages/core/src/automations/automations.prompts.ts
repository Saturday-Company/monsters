import { pick } from '@monsters/shared';

/*
 * What the lead of an automation reads at the start of a run and when a run cut by a closing
 * of the core goes on (D-153): the Italian family is the one the models have always read; the
 * English one is its twin. They follow the app's language at the moment they are written.
 */

const it = {
  /** What the capo reads when a giro cut by a closing of the core goes on (B3). */
  recover:
    'Monsters si è chiuso (un riavvio o un aggiornamento) mentre lavoravi a questo giro. Riprendi da dove eri rimasto: quello che avevi già fatto è qui sopra, non rifarlo.',
  slot: (when: string) => `(giro di ${when})`,
  headSlot: (name: string, slot: string) => `[Automazione «${name}» ${slot}]`,
  headNow: (name: string) => `[Automazione «${name}», eseguita ora]`,
  participants: (names: string) => `Mostri che partecipano: ${names}.`,
  resultsFolder: (folder: string) => `Salva i risultati nella cartella «${folder}» delle note.`,
  manual: "È un giro dell'automazione, avviato dall'utente.",
  scheduled: "È un giro automatico: l'utente non sta guardando la chat.",
  closing:
    'Se ti serve una sua scelta, chiedigliela invece di tirare a indovinare; alla fine scrivi in breve cosa hai fatto e dove sono i risultati.',
};

const en: typeof it = {
  recover:
    'Monsters was closed (a restart or an update) while you were working on this run. Pick up where you left off: what you had already done is above, don’t redo it.',
  slot: (when) => `(run of ${when})`,
  headSlot: (name, slot) => `[Automation “${name}” ${slot}]`,
  headNow: (name) => `[Automation “${name}”, run now]`,
  participants: (names) => `Monsters taking part: ${names}.`,
  resultsFolder: (folder) => `Save the results in the “${folder}” folder of the notes.`,
  manual: 'This is a run of the automation, started by the user.',
  scheduled: 'This is an automatic run: the user is not watching the chat.',
  closing:
    'If you need a choice from the user, ask instead of guessing; at the end write briefly what you did and where the results are.',
};

export const automationPrompts = () => pick({ en, it });
