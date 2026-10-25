import { pick } from '@monsters/shared';

/*
 * The texts a person reads from the automations (D-153): API errors, the reasons
 * a run did not start or ended, and the Telegram announcements. What the lead
 * reads at the start of a run (`#objective`, the recovery line) is for the model
 * and stays where it is until the prompts move (wave 3).
 */

const en = {
  // errors of the API
  notDraft: 'Only a draft can be set aside: this one is already active.',
  draftRun: 'This is a draft: confirm it before running it.',
  unknownRun: 'This run doesn’t exist.',
  unknownAutomation: 'This automation doesn’t exist.',
  unknownProject: (id: string) => `There is no project “${id}”.`,
  projectNoLead: (name: string) => `The project ${name} has no lead yet: confirm it first.`,
  squadNoLead: 'The squad has no lead.',
  noMonster: (id: string) => `There is no monster “${id}” in the squad.`,
  notInProject: (name: string, project: string) => `${name} isn’t part of the project ${project}.`,
  // why a run did not start or ended
  skippedAtStart: (when: string) =>
    `The computer was off (or Monsters was closed) for the run of ${when}: too much time has passed, so the run was skipped.`,
  skippedAsleep: (when: string) =>
    `The computer was asleep (or Monsters was stopped) for the run of ${when}: too much time has passed, so the run was skipped.`,
  halted: 'Monsters is stopped: the run didn’t start.',
  closing: 'Monsters is closing: the run didn’t start. Try again in a moment.',
  haltedResume: 'Monsters is stopped: the run didn’t resume.',
  killed: 'Monsters was stopped',
  leadGone: (lead: string) => `${lead} is no longer in the squad.`,
  noModel: (name: string) => `${name} has no model: connect one in Settings → Models.`,
  waitingUser: 'The previous run is still waiting for your answer.',
  stillRunning: 'The previous run hasn’t finished yet.',
  busyTooLong: (name: string, minutes: number) =>
    `${name} was busy with other work for more than ${minutes} minutes: the run was skipped.`,
  cantContinue: (lead: string) => `${lead} can’t continue the run`,
  pausedNoResume: 'the automation is paused: the run doesn’t resume with the answer',
  automationStopped: 'the automation was stopped',
  nothingRunning: 'the run has nothing left in progress',
  questionClosed: 'the question is no longer waiting for an answer',
  unconfirmed: (name: string, id: string) =>
    `automation “${name}” (${id}): active without the user’s confirmation, back to a draft to confirm`,
  errorOf: (name: string, message: string) => `automation “${name}”: ${message}`,
  unreadable: (file: string, message: string) => `automation not read (${file}): ${message}`,
  // the schedule
  scheduleWhen: (message: string) => `when: ${message}`,
  scheduleNever: 'when: this rule never fires',
  // announcements (Telegram)
  done: (name: string, who: string, body: string, notes: readonly string[]) =>
    `✅ Automation “${name}”: ${who} is done.${body}${notes.length > 0 ? `\n\n📝 Notes:\n${notes.join('\n')}` : ''}`,
  failed: (name: string, error: string | undefined) =>
    `⚠️ Automation “${name}”: the run didn’t go well${error ? ` (${error})` : ''}.`,
  stopped: (name: string) => `■ Automation “${name}”: the run was stopped.`,
  skipped: (name: string, message: string) => `⏭ Automation “${name}”: run skipped. ${message}`,
};

const it: typeof en = {
  notDraft: 'Solo una bozza si lascia stare: questa è già attiva.',
  draftRun: 'È una bozza: confermala prima di eseguirla.',
  unknownRun: 'Questo giro non c’è.',
  unknownAutomation: 'Questa automazione non c’è.',
  unknownProject: (id) => `Non c’è un progetto "${id}".`,
  projectNoLead: (name) => `Il progetto ${name} non ha ancora un capo: confermalo prima.`,
  squadNoLead: 'La squadra non ha un capo.',
  noMonster: (id) => `Nella squadra non c’è un mostro "${id}".`,
  notInProject: (name, project) => `${name} non fa parte del progetto ${project}.`,
  skippedAtStart: (when) =>
    `Il computer era spento (o Monsters chiuso) (giro di ${when}): è passato troppo tempo, il giro è saltato.`,
  skippedAsleep: (when) =>
    `Il computer dormiva (o Monsters era fermo) (giro di ${when}): è passato troppo tempo, il giro è saltato.`,
  halted: 'Monsters è fermo: il giro non è partito.',
  closing: 'Monsters si sta chiudendo: il giro non è partito. Riprova tra un attimo.',
  haltedResume: 'Monsters è fermo: il giro non è ripreso.',
  killed: 'Monsters è stato fermato',
  leadGone: (lead) => `${lead} non è più nella squadra.`,
  noModel: (name) => `${name} non ha un modello: collegane uno in Impostazioni → Modelli.`,
  waitingUser: 'Il giro precedente aspetta ancora una tua risposta.',
  stillRunning: 'Il giro precedente non è ancora finito.',
  busyTooLong: (name, minutes) =>
    `${name} era occupato con un altro lavoro da più di ${minutes} minuti: il giro è saltato.`,
  cantContinue: (lead) => `${lead} non può continuare il giro`,
  pausedNoResume: "l'automazione è in pausa: il giro non riprende con la risposta",
  automationStopped: "l'automazione è stata fermata",
  nothingRunning: 'il giro non ha più nulla in corso',
  questionClosed: 'la domanda non aspetta più una risposta',
  unconfirmed: (name, id) =>
    `automazione «${name}» (${id}): attiva senza una conferma dell'utente, torna una bozza da confermare`,
  errorOf: (name, message) => `automazione «${name}»: ${message}`,
  unreadable: (file, message) => `automazione non letta (${file}): ${message}`,
  scheduleWhen: (message) => `quando: ${message}`,
  scheduleNever: 'quando: questa regola non scatta mai',
  done: (name, who, body, notes) =>
    `✅ Automazione «${name}»: ${who} ha finito.${body}${notes.length > 0 ? `\n\n📝 Note:\n${notes.join('\n')}` : ''}`,
  failed: (name, error) =>
    `⚠️ Automazione «${name}»: il giro non è andato a buon fine${error ? ` (${error})` : ''}.`,
  stopped: (name) => `■ Automazione «${name}»: il giro si è fermato.`,
  skipped: (name, message) => `⏭ Automazione «${name}»: giro saltato. ${message}`,
};

export const automationStrings = () => pick({ en, it });
