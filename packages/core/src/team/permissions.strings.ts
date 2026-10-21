import { pick } from '@monsters/shared';

/* What the permissions say to the person when a folder can't be granted (D-153). */

const en = {
  fullPath: (example: string) => `Write the full path of the folder, for example ${example}.`,
  /** The name of the usual documents folder, for the example above. */
  documentsFolder: 'Documents',
  notFound: (path: string) => `The folder ${path} doesn’t exist.`,
  isFile: (path: string) => `${path} is a file, not a folder.`,
  notesFolder:
    'This is the notes folder: the monsters already use it, with history and undo. Pick another folder.',
  dataFolder: 'This is the Monsters data folder (keys, activity, monsters): it can’t be granted.',
  installFolder: 'This is the folder where Monsters is installed: it can’t be granted.',
};

const it: typeof en = {
  fullPath: (example) => `Scrivi il percorso completo della cartella, per esempio ${example}.`,
  documentsFolder: 'Documenti',
  notFound: (path) => `La cartella ${path} non esiste.`,
  isFile: (path) => `${path} è un file, non una cartella.`,
  notesFolder:
    'È la cartella delle note: i mostri la usano già, con la cronologia e l’annulla. Scegli un’altra cartella.',
  dataFolder:
    'È la cartella dei dati di Monsters (chiavi, attività, mostri): non si può concedere.',
  installFolder: 'È la cartella dove è installato Monsters: non si può concedere.',
};

export const permissionsStrings = () => pick({ en, it });
