import { defineStrings } from '../lib/i18n.ts';

/* First start, the names screen: the only question before the squad. */

const en = {
  suggestedNames: 'Suggested names',
  writeName: (label: string | undefined) => `Enter ${label?.toLowerCase() ?? 'a name'}.`,
  badName: 'For names use letters only (spaces and apostrophes too), 24 at most.',
  next: 'Next',
};

const it: typeof en = {
  suggestedNames: 'Nomi suggeriti',
  writeName: (label) => `Scrivi ${label?.toLowerCase() ?? 'un nome'}.`,
  badName: 'Per i nomi usa solo lettere (anche spazi e apostrofi), massimo 24.',
  next: 'Avanti',
};

export const nameStrings = defineStrings({ en, it });
