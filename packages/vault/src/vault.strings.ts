import { pick } from '@monsters/shared';

/*
 * What a person reads from the vault service (D-153): the warnings of the watcher and of the
 * reader, and the line the UI shows when the search by meaning is not available. The commit
 * messages of the notes' history and the notes' templates are data and stay as written.
 */

const en = {
  unreadable: (path: string, code: string) => `${path}: not readable (${code}), skipped`,
  /** `code` of an unreadable file with no error code. */
  permissions: 'permissions',
  notesFolder: '(notes folder)',
  watchLimit: (code: string) =>
    `system limit on watched files reached (${code}): changes made outside Monsters in some folders will show up at the next start`,
  watchError: (message: string) => `watching the notes folder: ${message}`,
  semanticOff:
    'Search by meaning isn’t available in this installation: searching by words instead.',
};

const it: typeof en = {
  unreadable: (path, code) => `${path}: non leggibile (${code}), saltato`,
  permissions: 'permessi',
  notesFolder: '(cartella del vault)',
  watchLimit: (code) =>
    `limite del sistema sui file osservati raggiunto (${code}): le modifiche fatte fuori da Monsters in alcune cartelle si vedranno al prossimo avvio`,
  watchError: (message) => `osservazione del vault: ${message}`,
  semanticOff:
    'La ricerca per significato non è disponibile in questa installazione: si cerca per parole.',
};

export const vaultStrings = () => pick({ en, it });
