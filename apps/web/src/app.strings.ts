import { defineStrings } from './lib/i18n.ts';

/* The first screens of the app, before the shell (D-153). */

const en = {
  loading: 'Loading Monsters…',
};

const it: typeof en = {
  loading: 'Carico Monsters…',
};

export const appStrings = defineStrings({ en, it });
