import { pick } from '@monsters/shared';

/*
 * What a monster reads of the conversation rebuilt from the log (D-153, wave 3): the reports
 * of the projects' leads, the user's answers to its questions and proposals, the line with the
 * notes of its last job. Two families: the one of the app's language at the moment the turn is
 * rebuilt. The Italian one is byte for byte what it was. The English tag of the notes line
 * ("[Notes from this job: …]") is the one the summary prompts name.
 */

const en = {
  reportStatus: (status: string): string =>
    status === 'completed'
      ? 'has finished'
      : status === 'waiting_user'
        ? 'is waiting for an answer from the user'
        : 'has stopped',
  projectReport: (project: string, lead: string, how: string, summary: string) =>
    `[Report from the project “${project}”: ${lead} ${how}] ${summary}`,
  answer: (question: string, parts: string) => `Answer to your question "${question}": ${parts}`,
  theMonster: 'the monster',
  monsterCreated: (name: string) =>
    `[From the app] I created ${name} from your proposal: it is now in the squad.`,
  monsterDropped: (name: string) =>
    `[From the app] I dropped your proposal for ${name}: I did not create it.`,
  projectConfirmed: (name: string) =>
    `[From the app] I confirmed the project “${name}” you proposed: it now exists, with its lead and its monsters.`,
  projectDropped: (name: string) =>
    `[From the app] I dropped the project “${name}” you proposed: it does not exist.`,
  automationConfirmed: (name: string) =>
    `[From the app] I confirmed the automation “${name}”: from now on it runs on its schedule.`,
  automationDropped: (name: string) =>
    `[From the app] I dropped the automation “${name}” you proposed.`,
  docsApplied: (file: string, name: string) =>
    `[From the app] I applied your proposal for ${file} of “${name}”: the file is now as you wrote it.`,
  docsDropped: (file: string, name: string) =>
    `[From the app] I dropped your proposal for ${file} of “${name}”: the file stays as it was.`,
  notesOfJob: (shown: string, more: number) =>
    `[Notes from this job: ${shown}${more > 0 ? ` and ${more} more` : ''}]`,
};

const it: typeof en = {
  reportStatus: (status) =>
    status === 'completed'
      ? 'ha finito'
      : status === 'waiting_user'
        ? 'aspetta una risposta dell’utente'
        : 'si è fermato',
  projectReport: (project, lead, how, summary) =>
    `[Rapporto del progetto «${project}»: ${lead} ${how}] ${summary}`,
  answer: (question, parts) => `Risposta alla tua domanda "${question}": ${parts}`,
  theMonster: 'il mostro',
  monsterCreated: (name) => `[Dall'app] Ho creato ${name} dalla tua proposta: ora è nella squadra.`,
  monsterDropped: (name) =>
    `[Dall'app] Ho lasciato stare la tua proposta di ${name}: non l'ho creato.`,
  projectConfirmed: (name) =>
    `[Dall'app] Ho confermato il progetto «${name}» che hai proposto: ora c'è, con il suo capo e i suoi mostri.`,
  projectDropped: (name) =>
    `[Dall'app] Ho lasciato stare il progetto «${name}» che hai proposto: non c'è.`,
  automationConfirmed: (name) =>
    `[Dall'app] Ho confermato l'automazione «${name}»: da ora gira al suo orario.`,
  automationDropped: (name) =>
    `[Dall'app] Ho lasciato stare l'automazione «${name}» che hai proposto.`,
  docsApplied: (file, name) =>
    `[Dall'app] Ho applicato la tua proposta per ${file} di «${name}»: ora il file è come l'hai scritto.`,
  docsDropped: (file, name) =>
    `[Dall'app] Ho lasciato stare la tua proposta per ${file} di «${name}»: il file resta com'era.`,
  notesOfJob: (shown, more) =>
    `[Note di questo lavoro: ${shown}${more > 0 ? ` e altre ${more}` : ''}]`,
};

export const conversationPrompts = () => pick({ en, it });
