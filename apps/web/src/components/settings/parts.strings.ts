import { defineStrings } from '../../lib/i18n.ts';

/* Settings: the building blocks (parts.tsx) and the words every group of rows shares (D-153). */

const en = {
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  change: 'Change',
  /** `what` reads after the verb: "your name". */
  changeWhat: (what: string) => `Change ${what}`,
  changeLabel: (label: string) => `Change: ${label}`,
  retry: 'Try again',
};

const it: typeof en = {
  cancel: 'Annulla',
  save: 'Salva',
  saving: 'Salvo…',
  change: 'Cambia',
  changeWhat: (what) => `Cambia ${what}`,
  changeLabel: (label) => `Cambia: ${label}`,
  retry: 'Riprova',
};

export const partsStrings = defineStrings({ en, it });
