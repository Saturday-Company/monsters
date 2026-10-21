import { defineStrings } from '../../lib/i18n.ts';

/* Shared controls: switch words, copy path, note and link chips (D-153). */

const en = {
  on: 'On',
  off: 'Off',
  pathCopied: 'Path copied',
  copyPath: 'Copy the path',
  copied: 'Copied',
  copyFailed: 'I can’t copy it: select it and copy it by hand.',
  inTrash: (name: string) => `“${name}” is in the trash`,
  openNote: (name: string) => `Open the note “${name}”`,
  inTrashTag: '(in the trash)',
  newTab: ' (opens in a new tab)',
};

const it: typeof en = {
  on: 'Acceso',
  off: 'Spento',
  pathCopied: 'Percorso copiato',
  copyPath: 'Copia il percorso',
  copied: 'Copiato',
  copyFailed: 'Non riesco a copiarlo: selezionalo e copialo a mano.',
  inTrash: (name) => `“${name}” è nel cestino`,
  openNote: (name) => `Apri la nota “${name}”`,
  inTrashTag: '(nel cestino)',
  newTab: ' (si apre in una nuova scheda)',
};

export const uiStrings = defineStrings({ en, it });
