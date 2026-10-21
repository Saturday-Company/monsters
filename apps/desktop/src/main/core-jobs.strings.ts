import { pick } from '@monsters/shared';

/*
 * The words of the confirmations before the local core stops (core-jobs.ts) and of the
 * notification shown the first time the window is closed. Typed dictionaries (D-153).
 */

const en = {
  /** "On this computer there's a task running: if <condition> it will stop." */
  running: (n: number, condition: string) =>
    n === 1
      ? `On this computer there’s a task running: if ${condition} it will stop.`
      : `On this computer there are ${n} tasks running: if ${condition} they will stop.`,
  leave: {
    unknownMessage: (name: string) => `Switch to “${name}”?`,
    condition: (name: string) => `you switch to “${name}”`,
    unknownDetail: (name: string) =>
      `If you switch to “${name}”, Monsters on this computer stops and any tasks in progress are interrupted. You’ll find it as it was when you go back to “This computer”.`,
    detail:
      'You’ll find them in Activity when you go back to “This computer”, but you’ll have to start them again.',
    go: 'Switch anyway',
    cancel: 'Cancel',
  },
  quit: {
    unknownMessage: 'Quit Monsters?',
    unknownUpdateMessage: 'Restart Monsters to update it?',
    quitCondition: 'you quit',
    updateCondition: 'you restart to update',
    updateDetail:
      'Monsters restarts on its own with the new version; any interrupted tasks are in Activity. If you prefer, update later.',
    unknownDetail:
      'If you quit, Monsters on this computer stops and any tasks in progress are interrupted. To let it keep working, just close the window.',
    detail: 'To let the monsters keep working, just close the window: Monsters stays on.',
    quit: 'Quit',
    restart: 'Restart',
    cancel: 'Cancel',
  },
  closeNotice: {
    title: 'Monsters keeps working',
    body: (quitKeys: string) =>
      `The monsters keep going even with the window closed. To really quit Monsters: Quit (${quitKeys}).`,
  },
};

const it: typeof en = {
  running: (n, condition) =>
    n === 1
      ? `Su questo computer c’è un lavoro in corso: se ${condition} si ferma.`
      : `Su questo computer ci sono ${n} lavori in corso: se ${condition} si fermano.`,
  leave: {
    unknownMessage: (name) => `Passare a «${name}»?`,
    condition: (name) => `passi a «${name}»`,
    unknownDetail: (name) =>
      `Se passi a «${name}», Monsters su questo computer si ferma e i lavori eventualmente in corso si interrompono. Lo ritrovi com’era tornando su «Questo computer».`,
    detail: 'Li ritrovi in Attività tornando su «Questo computer», ma dovrai farli ripartire.',
    go: 'Passa comunque',
    cancel: 'Annulla',
  },
  quit: {
    unknownMessage: 'Uscire da Monsters?',
    unknownUpdateMessage: 'Riavviare Monsters per aggiornarlo?',
    quitCondition: 'esci',
    updateCondition: 'riavvii per aggiornare',
    updateDetail:
      'Monsters si riavvia da solo con la versione nuova; i lavori interrotti li ritrovi in Attività. Se preferisci, aggiorna più tardi.',
    unknownDetail:
      'Uscendo, Monsters su questo computer si ferma e i lavori eventualmente in corso si interrompono. Per lasciarlo lavorare chiudi solo la finestra.',
    detail: 'Per lasciare lavorare i mostri chiudi solo la finestra: Monsters resta acceso.',
    quit: 'Esci',
    restart: 'Riavvia',
    cancel: 'Annulla',
  },
  closeNotice: {
    title: 'Monsters continua a lavorare',
    body: (quitKeys) =>
      `Anche a finestra chiusa i mostri vanno avanti. Per chiudere davvero Monsters: Esci (${quitKeys}).`,
  },
};

export const coreJobsStrings = () => pick({ en, it });
