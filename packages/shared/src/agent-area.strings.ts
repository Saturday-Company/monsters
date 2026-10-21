import { pick } from './i18n.ts';

/** Why a vault area or a duty of a monster is not acceptable: the UI shows these (D-153). */
const en = {
  areaEmpty: 'A folder is needed: the top of your notes folder won’t work.',
  areaTooLong: (max: number) => `At most ${max} characters.`,
  areaTooDeep: (max: number) => `At most ${max} levels of folders.`,
  segmentTooLong: (max: number) => `Folder names up to ${max} characters.`,
  segmentChars: 'Only letters, numbers, spaces, dashes and dots (no * ? [ ] or hidden folders).',
  segmentDot: 'A folder name can’t end with a dot.',
  notANote: 'It has to be a folder, not a note.',
  reserved: (name: string) => `${name} is a reserved folder: pick another one.`,
  dutyOneLine: 'One line only.',
  dutyPlaceholder: 'No {{placeholders}}.',
  dutyHash: 'It can’t start with #.',
  nameChars: 'Only letters, spaces, apostrophes and dashes (24 at most).',
  projectNameChars: 'Only letters, numbers, spaces, apostrophes and dashes (40 at most).',
};

const it: typeof en = {
  areaEmpty: 'Serve una cartella: la radice del vault non va bene.',
  areaTooLong: (max) => `Al massimo ${max} caratteri.`,
  areaTooDeep: (max) => `Al massimo ${max} livelli di cartelle.`,
  segmentTooLong: (max) => `Nomi di cartella fino a ${max} caratteri.`,
  segmentChars:
    'Solo lettere, numeri, spazi, trattini e punti (niente * ? [ ] né cartelle nascoste).',
  segmentDot: 'Un nome di cartella non finisce con il punto.',
  notANote: 'Serve una cartella, non una nota.',
  reserved: (name) => `${name} è una cartella riservata: scegline un'altra.`,
  dutyOneLine: 'Una riga sola.',
  dutyPlaceholder: 'Niente {{segnaposto}}.',
  dutyHash: 'Non inizia con #.',
  nameChars: 'Solo lettere, spazi, apostrofi e trattini (al massimo 24).',
  projectNameChars: 'Solo lettere, numeri, spazi, apostrofi e trattini (al massimo 40).',
};

export const agentAreaStrings = () => pick({ en, it });
