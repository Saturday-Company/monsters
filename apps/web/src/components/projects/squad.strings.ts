import { defineStrings } from '../../lib/i18n.ts';

/* A project's Squad tab (D-153). */

const en = {
  lead: 'Lead',
  leadDuty: 'Coordinates the project and hands tasks to the others.',
  message: 'Message',
  messageLabel: (name: string) => `Message ${name}`,
  remove: 'Remove',
  removeQuestion: (name: string) => `Remove ${name}?`,
  removeConfirm: 'Yes, remove',
  archived: (name: string) => `${name} is in the archive: its chat stays in Activity.`,
  removalDescription: 'Goes to the archive: its chat stays in Activity.',
  nameTaken: 'There’s already a monster with this name, in this squad or another one.',
  copied: (name: string, source: string) =>
    `${name} is in the project: it does what ${source} does, with a memory of its own.`,
  copyLabel: (name: string) => `Copy ${name} into the project`,
  copy: 'Copy',
  copyName: 'Name of the copy',
  copyNameHint: 'Names are valid across all squads: two monsters are never called the same.',
  copying: 'Copying…',
  copyToProject: 'Copy into the project',
  cancel: 'Cancel',
  squadTitle: (n: number) => `Squad · ${n}`,
  full: (max: number) => `The project is full: at most ${max} monsters besides the lead.`,
  footer: 'The project’s monsters are its own: a memory, permissions and spending that stay here.',
  copyAMonster: 'Copy a monster',
  newMonster: 'New monster',
  copyDescription:
    'The copy has the original’s role, rules and models; name, look and memory are its own: the original stays in its squad.',
  close: 'Close',
};
const it: typeof en = {
  lead: 'Capo',
  leadDuty: 'Coordina il progetto e passa gli incarichi agli altri.',
  message: 'Scrivi',
  messageLabel: (name) => `Scrivi a ${name}`,
  remove: 'Togli',
  removeQuestion: (name) => `Togliere ${name}?`,
  removeConfirm: 'Sì, togli',
  archived: (name) => `${name} è nell’archivio: la sua chat resta in Attività.`,
  removalDescription: 'Va nell’archivio: la sua chat resta in Attività.',
  nameTaken: 'C’è già un mostro con questo nome, in questa o in un’altra squadra.',
  copied: (name, source) =>
    `${name} è nel progetto: fa quello che fa ${source}, con una memoria tutta sua.`,
  copyLabel: (name) => `Copia ${name} nel progetto`,
  copy: 'Copia',
  copyName: 'Nome della copia',
  copyNameHint: 'I nomi valgono in tutte le squadre: due mostri non si chiamano mai uguale.',
  copying: 'Lo copio…',
  copyToProject: 'Copia nel progetto',
  cancel: 'Annulla',
  squadTitle: (n) => `Squadra · ${n}`,
  full: (max) => `Il progetto è al completo: al massimo ${max} mostri oltre al capo.`,
  footer: 'I mostri del progetto sono suoi: una memoria, dei permessi e una spesa che restano qui.',
  copyAMonster: 'Copia un mostro',
  newMonster: 'Nuovo mostro',
  copyDescription:
    'La copia ha il ruolo, le regole e i modelli dell’originale; nome, aspetto e memoria sono suoi: l’originale resta nella sua squadra.',
  close: 'Chiudi',
};

export const squadStrings = defineStrings({ en, it });
