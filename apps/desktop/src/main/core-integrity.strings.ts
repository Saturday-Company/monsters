import { pick } from '@monsters/shared';

/* What the status page says of a failed integrity check of the core (D-153). */

const en = {
  changed: (where: string) => `${where} has changed`,
  extra: (where: string) => `${where} isn’t part of the program`,
  missing: (where: string) => `${where} is missing`,
  notAFile: (where: string) => `${where} isn’t a file`,
  manifest: (where: string) => `the list of the program’s files is missing (${where})`,
};

const it: typeof en = {
  changed: (where) => `${where} è cambiato`,
  extra: (where) => `${where} non fa parte del programma`,
  missing: (where) => `${where} manca`,
  notAFile: (where) => `${where} non è un file`,
  manifest: (where) => `manca l’elenco dei file del programma (${where})`,
};

export const coreIntegrityStrings = () => pick({ en, it });
