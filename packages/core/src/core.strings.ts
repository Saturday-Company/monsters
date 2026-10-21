import { pick } from '@monsters/shared';

/* What the core says when it starts or when the archive of the log has a problem (D-153). */

const en = {
  homeLocked: (home: string, url: string | undefined, pid: number) =>
    `Monsters is already running on ${home}${url ? ` (${url})` : ''}, process ${pid}: ` +
    'stop it before starting another one, or use another MONSTERS_HOME.',
  unhandledStorm: (code: string, message: string) =>
    `${code}: too many unhandled errors in a row (${message})`,
  archiveFailed: (message: string) => `log archive failed, no event lost: ${message}`,
  vacuumFailed: (message: string) =>
    `archive done, but the database VACUUM failed (I’ll try again later): ${message}`,
  archiveDamaged: (month: string, message: string, aside: string) =>
    `the ${month} archive can’t be read (${message}): set aside in ${aside}, the month starts again from a new file`,
};

const it: typeof en = {
  homeLocked: (home, url, pid) =>
    `Monsters è già in esecuzione su ${home}${url ? ` (${url})` : ''}, processo ${pid}: ` +
    'fermalo prima di avviarne un altro, oppure usa un’altra MONSTERS_HOME.',
  unhandledStorm: (code, message) => `${code}: troppi errori non gestiti di seguito (${message})`,
  archiveFailed: (message) => `archivio del registro non riuscito, nessun evento perso: ${message}`,
  vacuumFailed: (message) =>
    `archivio fatto, ma il VACUUM del database non è riuscito (riprovo più avanti): ${message}`,
  archiveDamaged: (month, message, aside) =>
    `l'archivio ${month} non si legge (${message}): messo da parte in ${aside}, il mese riparte da un file nuovo`,
};

export const coreStrings = () => pick({ en, it });
