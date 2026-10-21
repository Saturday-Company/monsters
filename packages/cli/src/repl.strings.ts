import { pick } from '@monsters/shared';

/*
 * The texts of the terminal chat (`monsters chat`, D-153). The commands are typed in either
 * language: the English dictionary names the English ones, the Italian one the Italian ones
 * (`repl.ts` accepts both, the English first).
 */

const en = {
  help: `Type a message and press Enter (@Name at the start talks to one agent).
  1, 2, …           answer the last question with that option
  /answer <text>    answer the last question with your words (alias /a, /r)
  /stop             stop every agent now (kill switch)
  /resume           let them work again (asks first)
  /new [@Name]      new conversation
  /status           what is running
  /help             this help
  /quit             leave the chat (alias /exit, Ctrl+D); the agents keep working
The Italian names work too: /risposta, /riprendi, /nuova, /stato, /aiuto, /esci.`,
  killEngaged: (reason: string | null) =>
    `Kill switch: ENGAGED${reason ? ` (${reason})` : ''}: type /resume to let them work.`,
  killOff: 'Kill switch: off',
  nothingRunning: 'Nothing running.',
  working: 'working',
  runLine: (name: string, goal: string, minutes: number) => `  ${name}: ${goal} (${minutes} min)`,
  questionsWaiting: (n: number) => `Questions waiting: ${n}.`,
  meanwhile: '; work goes on meanwhile',
  answerWithNumber: (tail: string) =>
    `   Type the number of your choice (or /answer <text>)${tail}.`,
  answerWithText: (tail: string) => `   Answer with /answer <text>${tail}.`,
  resumedBy: (by: string) => `▶ the agents can work again (${by})`,
  endOf: (status: string) => `(end: ${status})`,
  chatWith: (who: string) => `Monsters chat with ${who}. /help for the commands, /quit to leave.`,
  yourTeam: 'your team',
  haltedNotice: 'The agents are stopped (kill switch): /resume to let them work.',
  resumeAsk: 'Let the agents work again? [y/N]',
  resumed: 'Resumed: the agents can work again.',
  notStopped: 'They were not stopped.',
  stayStopped: 'Ok: they stay stopped.',
  chooseNumber: (n: number) => `! choose a number from 1 to ${n}`,
  stopped: (aborted: number, killed: number) =>
    `■ Stopped. Runs aborted: ${aborted}, processes killed: ${killed}. Nothing runs until /resume.`,
  noQuestion: '! no question is waiting for an answer',
  writeAnswer: '! write the answer after /answer',
  unknownCommand: (name: string) => `! unknown command /${name}: /help for the list`,
  newConversation: (who: string | null) =>
    `New conversation${who ? ` with ${who}` : ''}: the agents no longer see the earlier messages (they stay in the log).`,
  answerSent: (who: string) => `(answer sent to ${who})`,
  addedTo: (who: string) => `(added to the current work of ${who})`,
  isWorking: (who: string) => `(${who} is working…)`,
  connectionLost: 'Connection to the core lost: is Monsters still running?',
};

const it: typeof en = {
  help: `Scrivi un messaggio e premi Invio (@Nome all’inizio parla con un solo agente).
  1, 2, …           rispondi all’ultima domanda con quell’opzione
  /risposta <testo> rispondi all’ultima domanda con le tue parole (alias /r)
  /stop             ferma subito tutti gli agenti (interruttore)
  /riprendi         falli lavorare di nuovo (chiede conferma)
  /nuova [@Nome]    nuova conversazione
  /stato            cosa sta girando
  /aiuto            questo aiuto
  /esci             esci dalla chat (alias Ctrl+D); gli agenti continuano a lavorare
Funzionano anche i nomi inglesi: /answer, /resume, /new, /status, /help, /quit.`,
  killEngaged: (reason) =>
    `Interruttore: INSERITO${reason ? ` (${reason})` : ''}: scrivi /riprendi per farli lavorare.`,
  killOff: 'Interruttore: spento',
  nothingRunning: 'Non gira niente.',
  working: 'al lavoro',
  runLine: (name, goal, minutes) => `  ${name}: ${goal} (${minutes} min)`,
  questionsWaiting: (n) => `Domande in attesa: ${n}.`,
  meanwhile: '; intanto il lavoro continua',
  answerWithNumber: (tail) => `   Scrivi il numero della tua scelta (o /risposta <testo>)${tail}.`,
  answerWithText: (tail) => `   Rispondi con /risposta <testo>${tail}.`,
  resumedBy: (by) => `▶ gli agenti possono lavorare di nuovo (${by})`,
  endOf: (status) => `(fine: ${status})`,
  chatWith: (who) => `Chat di Monsters con ${who}. /aiuto per i comandi, /esci per uscire.`,
  yourTeam: 'la tua squadra',
  haltedNotice: 'Gli agenti sono fermi (interruttore): /riprendi per farli lavorare.',
  resumeAsk: 'Far lavorare di nuovo gli agenti? [s/N]',
  resumed: 'Ripreso: gli agenti possono lavorare di nuovo.',
  notStopped: 'Non erano fermi.',
  stayStopped: 'Ok: restano fermi.',
  chooseNumber: (n) => `! scegli un numero da 1 a ${n}`,
  stopped: (aborted, killed) =>
    `■ Fermati. Giri interrotti: ${aborted}, processi terminati: ${killed}. Non gira niente finché non scrivi /riprendi.`,
  noQuestion: '! nessuna domanda aspetta una risposta',
  writeAnswer: '! scrivi la risposta dopo /risposta',
  unknownCommand: (name) => `! comando sconosciuto /${name}: /aiuto per l’elenco`,
  newConversation: (who) =>
    `Nuova conversazione${who ? ` con ${who}` : ''}: gli agenti non vedono più i messaggi precedenti (restano nel registro).`,
  answerSent: (who) => `(risposta inviata a ${who})`,
  addedTo: (who) => `(aggiunto al lavoro in corso di ${who})`,
  isWorking: (who) => `(${who} sta lavorando…)`,
  connectionLost: 'Connessione al core persa: Monsters è ancora acceso?',
};

export const replStrings = () => pick({ en, it });
