import { defineStrings } from './i18n.ts';

/* The words of an automation and of its runs, outside React (D-153). */

const en = {
  /** Monday first. */
  weekdays: [
    { day: 1, short: 'Mon', long: 'Monday' },
    { day: 2, short: 'Tue', long: 'Tuesday' },
    { day: 3, short: 'Wed', long: 'Wednesday' },
    { day: 4, short: 'Thu', long: 'Thursday' },
    { day: 5, short: 'Fri', long: 'Friday' },
    { day: 6, short: 'Sat', long: 'Saturday' },
    { day: 0, short: 'Sun', long: 'Sunday' },
  ] as { day: number; short: string; long: string }[],
  runState: {
    completed: 'Done',
    running: 'Running',
    waiting_lead: 'Waiting for the lead',
    waiting_user: 'Waiting for an answer',
    skipped: 'Skipped',
    failed: 'Failed',
    aborted: 'Stopped',
  },
  trigger: {
    schedule: 'on schedule',
    catchup: 'caught up at startup',
    manual: 'started by you',
    answer: 'resumed after your answer',
  },
  steps: (n: number) => (n === 1 ? '1 step' : `${n} steps`),
  tokens: (n: string) => `${n} tokens`,
  free: 'free',
  limitSteps: (n: number) => `up to ${n} ${n === 1 ? 'step' : 'steps'}`,
  limitEur: (n: string) => `€${n} per run`,
  personalSquad: 'Personal squad',
};

const it: typeof en = {
  weekdays: [
    { day: 1, short: 'Lun', long: 'lunedì' },
    { day: 2, short: 'Mar', long: 'martedì' },
    { day: 3, short: 'Mer', long: 'mercoledì' },
    { day: 4, short: 'Gio', long: 'giovedì' },
    { day: 5, short: 'Ven', long: 'venerdì' },
    { day: 6, short: 'Sab', long: 'sabato' },
    { day: 0, short: 'Dom', long: 'domenica' },
  ],
  runState: {
    completed: 'Fatto',
    running: 'In corso',
    waiting_lead: 'Aspetta il capo',
    waiting_user: 'Aspetta una risposta',
    skipped: 'Saltato',
    failed: 'Errore',
    aborted: 'Fermato',
  },
  trigger: {
    schedule: 'all’ora prevista',
    catchup: 'recuperato all’accensione',
    manual: 'avviato da te',
    answer: 'ripreso dopo la tua risposta',
  },
  steps: (n) => `${n} ${n === 1 ? 'passo' : 'passi'}`,
  tokens: (n) => `${n} token`,
  free: 'gratis',
  limitSteps: (n) => `al massimo ${n} ${n === 1 ? 'passo' : 'passi'}`,
  limitEur: (n) => `${n} € a giro`,
  personalSquad: 'Squadra personale',
};

export const automationTextStrings = defineStrings({ en, it });
