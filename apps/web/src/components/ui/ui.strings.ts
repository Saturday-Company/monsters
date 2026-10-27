import { defineStrings } from '../../lib/i18n.ts';

/* Shared controls: switch words, copy path, note and link chips (D-153). */

const en = {
  on: 'On',
  off: 'Off',
  pathCopied: 'Path copied',
  copyPath: 'Copy the path',
  copied: 'Copied',
  copy: 'Copy',
  copyCode: 'Copy the code',
  codeBlock: 'Code',
  copyFailed: 'I can’t copy it: select it and copy it by hand.',
  inTrash: (name: string) => `“${name}” is in the trash`,
  openNote: (name: string) => `Open the note “${name}”`,
  inTrashTag: '(in the trash)',
  newTab: ' (opens in a new tab)',
  image: (alt: string) => (alt ? `Image: ${alt}` : 'Image'),
  /** The command that puts the focus on the message on screen (its key: Undo, Raise the cap…). */
  goToMessage: 'Go to the message',
};

const it: typeof en = {
  on: 'Acceso',
  off: 'Spento',
  pathCopied: 'Percorso copiato',
  copyPath: 'Copia il percorso',
  copied: 'Copiato',
  copy: 'Copia',
  copyCode: 'Copia il codice',
  codeBlock: 'Codice',
  copyFailed: 'Non riesco a copiarlo: selezionalo e copialo a mano.',
  inTrash: (name) => `“${name}” è nel cestino`,
  openNote: (name) => `Apri la nota “${name}”`,
  inTrashTag: '(nel cestino)',
  newTab: ' (si apre in una nuova scheda)',
  image: (alt) => (alt ? `Immagine: ${alt}` : 'Immagine'),
  goToMessage: 'Vai al messaggio',
};

export const uiStrings = defineStrings({ en, it });
