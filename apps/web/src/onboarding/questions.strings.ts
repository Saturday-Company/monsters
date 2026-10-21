import { defineStrings } from '../lib/i18n.ts';

/*
 * First start, step 2: the screens that group the fixed questions (D-153). The
 * questions themselves, their options and the guide's replies come from
 * `@monsters/shared/onboarding.ts`.
 */

const en = {
  screens: {
    lavoro: {
      title: 'What do you do, and what would you like to hand off?',
      hint: 'Pick whatever you like, even nothing: I need it to suggest the right squad.',
      work: 'Your work',
      workText: 'In your own words (if you like)',
      delegate: 'What eats your time',
    },
    regole: {
      title:
        'Two more things: what we never do without asking you, and how should we write to you?',
      hint: 'For everything else we work on our own and let you know at the end.',
      ask: 'Also ask me before',
      askText: 'Anything else to always ask you (if you like)',
    },
  },
  suggestedNames: 'Suggested names',
  alwaysAskTitle: 'Publishing, writing to others, spending and deleting:',
  alwaysAskText: 'we always ask you first.',
  writeName: (label: string | undefined) => `Enter ${label?.toLowerCase() ?? 'a name'}.`,
  pickOne: 'Pick an option.',
  badName: 'For names use letters only (spaces and apostrophes too), 24 at most.',
  back: 'Back',
  next: 'Next',
};

const it: typeof en = {
  screens: {
    lavoro: {
      title: 'Di cosa ti occupi, e cosa vorresti delegare?',
      hint: 'Scegli quello che vuoi, anche niente: mi serve per proporti la squadra giusta.',
      work: 'Il tuo lavoro',
      workText: 'In parole tue (se vuoi)',
      delegate: 'Cosa ti ruba tempo',
    },
    regole: {
      title: 'Due cose ancora: cosa non facciamo mai senza chiederti, e come ti scriviamo?',
      hint: 'Per tutto il resto lavoriamo da soli e ti avvisiamo alla fine.',
      ask: 'Chiedimi anche prima di',
      askText: 'Altro da chiederti sempre (se vuoi)',
    },
  },
  suggestedNames: 'Nomi suggeriti',
  alwaysAskTitle: 'Pubblicare, scrivere ad altri, spendere e cancellare:',
  alwaysAskText: 'te lo chiediamo sempre.',
  writeName: (label) => `Scrivi ${label?.toLowerCase() ?? 'un nome'}.`,
  pickOne: 'Scegli una opzione.',
  badName: 'Per i nomi usa solo lettere (anche spazi e apostrofi), massimo 24.',
  back: 'Indietro',
  next: 'Avanti',
};

export const questionsStrings = defineStrings({ en, it });
