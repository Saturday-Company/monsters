import { defineStrings } from '../lib/i18n.ts';

/* The texts of the app store (store/app.ts) and its hooks (store/hooks.ts), D-153. */

const en = {
  mood: {
    idle: 'available',
    working: 'working',
    talking: 'writing',
    waiting: 'waiting',
    done: 'done',
    error: 'has a problem',
    stopped: 'stopped',
  },
  waitsForAnswer: 'waiting for your answer',
  notices: {
    raiseCap: 'Raise the cap',
    view: 'View',
    connect: 'Connect',
    aConnectedApp: 'A connected app',
    toolChanged: (who: string) => `${who} changed a tool: I’m keeping it paused until you decide.`,
    serviceSignIn: 'An app is asking you to sign in again.',
    automationDone: (name: string) => `Automation “${name}”: run finished.`,
    automationWaiting: (name: string) => `Automation “${name}”: waiting for your answer.`,
    automationFailed: (name: string) => `Automation “${name}”: the run didn’t succeed.`,
    sessionEnded: 'Your session has ended: sign in again.',
    undone: 'Done: the change was undone.',
  },
  askAgain: (question: string) => `You had asked me: “${question}”. Please ask me again.`,
};

const it: typeof en = {
  mood: {
    idle: 'disponibile',
    working: 'al lavoro',
    talking: 'sta scrivendo',
    waiting: 'in attesa',
    done: 'ha finito',
    error: 'ha un problema',
    stopped: 'fermo',
  },
  waitsForAnswer: 'aspetta una tua risposta',
  notices: {
    raiseCap: 'Alza il tetto',
    view: 'Vedi',
    connect: 'Collega',
    aConnectedApp: 'Un’app collegata',
    toolChanged: (who) => `${who} ha cambiato uno strumento: lo tengo fermo finché non decidi.`,
    serviceSignIn: 'Un’app chiede di nuovo l’accesso.',
    automationDone: (name) => `Automazione «${name}»: giro finito.`,
    automationWaiting: (name) => `Automazione «${name}»: aspetta una tua risposta.`,
    automationFailed: (name) => `Automazione «${name}»: il giro non è andato a buon fine.`,
    sessionEnded: 'La sessione è finita: accedi di nuovo.',
    undone: 'Fatto: la modifica è stata annullata.',
  },
  askAgain: (question) => `Mi avevi chiesto: «${question}». Chiedimelo di nuovo, per favore.`,
};

export const appStrings = defineStrings({ en, it });
