import { defineStrings } from '../../lib/i18n.ts';

/* The god's bar: its line, its label and its name for screen readers (D-153). */

const en = {
  /** "Rhea", "Rhea and Dione", "Rhea, Dione and 2 others". */
  names: (names: readonly string[]): string => {
    if (names.length <= 1) return names[0] ?? '';
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    const more = names.length - 2;
    return `${names[0]}, ${names[1]} and ${more === 1 ? 'one other' : `${more} others`}`;
  },
  halted: 'The monsters are stopped',
  offline: 'Not connected to the computer',
  waitingAnswer: 'Waiting for you',
  writing: 'Writing…',
  atWork: 'At work…',
  problem: 'Has a problem',
  atWorkWith: (names: string) => `At work: ${names}`,
  oneAsks: (name: string) => `${name} has a question`,
  manyAsk: (names: string) => `${names} have questions`,
  leadsAll: 'Leading all the squads',
  leadsSquad: 'Leading the squad',
  label: {
    halted: 'Stopped',
    offline: 'Not connected',
    working: (n: number) => `${n} at work`,
    questions: (n: number): string => (n === 1 ? '1 question' : `${n} questions`),
    withGod: (monsters: number, godName: string) => `${monsters} with ${godName}`,
    monsters: (n: number): string => (n === 1 ? '1 monster' : `${n} monsters`),
  },
  asksLabel: (question: string) => `asks you: ${question}`,
  unreadLabel: (n: number) => `${n} unread`,
  aria: (name: string, squads: number, line: string, label: string) =>
    `${name}. Leading ${squads === 1 ? 'the squad' : `the ${squads} squads`}: ${line}. ${label}`,
  open: (name: string, shortcut: string | null) =>
    `Open ${name}’s chat${shortcut ? ` (${shortcut})` : ''}`,
};

const it: typeof en = {
  names: (names) => {
    if (names.length <= 1) return names[0] ?? '';
    if (names.length === 2) return `${names[0]} e ${names[1]}`;
    const more = names.length - 2;
    return `${names[0]}, ${names[1]} e ${more === 1 ? 'un altro' : `altri ${more}`}`;
  },
  halted: 'I mostri sono fermi',
  offline: 'Non collegato al computer',
  waitingAnswer: 'Aspetta una tua risposta',
  writing: 'Sta scrivendo…',
  atWork: 'Al lavoro…',
  problem: 'Ha un problema',
  atWorkWith: (names) => `Al lavoro: ${names}`,
  oneAsks: (name) => `${name} aspetta una tua risposta`,
  manyAsk: (names) => `${names} aspettano una tua risposta`,
  leadsAll: 'A capo di tutte le squadre',
  leadsSquad: 'A capo della squadra',
  label: {
    halted: 'Fermi',
    offline: 'Non collegato',
    working: (n) => `${n} al lavoro`,
    questions: (n) => (n === 1 ? '1 domanda' : `${n} domande`),
    withGod: (monsters, godName) => `${monsters} con ${godName}`,
    monsters: (n) => (n === 1 ? '1 mostro' : `${n} mostri`),
  },
  asksLabel: (question) => `ti chiede: ${question}`,
  unreadLabel: (n) => `${n} da leggere`,
  aria: (name, squads, line, label) =>
    `${name}. A capo ${squads === 1 ? 'della squadra' : `delle ${squads} squadre`}: ${line}. ${label}`,
  open: (name, shortcut) => `Apri la chat di ${name}${shortcut ? ` (${shortcut})` : ''}`,
};

export const godStrings = defineStrings({ en, it });
