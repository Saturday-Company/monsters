import { defineStrings } from '../lib/i18n.ts';

/*
 * A failed note tool in plain words (store/tool-problem.ts): the core's error is English and
 * written for the model, this says in the person's language what happened and what to do.
 */

const en = {
  /** A write the monster's note areas do not allow; `areas` is its folders, null when unknown. */
  cannotWrite: (name: string, areas: string | null) =>
    `${name} can’t edit this note: it only writes in ${areas ?? 'its own folders'} and in the notes it created.`,
  cannotDelete: (name: string, areas: string | null) =>
    `${name} can’t delete or move this note: it only changes the notes in ${areas ?? 'its own folders'} and the ones it created.`,
  cannotMove: (name: string, areas: string | null) =>
    `${name} can’t move a note there: it only moves notes inside ${areas ?? 'its own folders'}.`,
  /** Where the setting that changes it is. */
  whereToChange: (name: string) =>
    `A monster’s folders are changed in Settings → Squad → ${name} → Where it writes in the notes.`,
  openSettings: (name: string) => `Open ${name}’s settings`,
  noteMissing: (name: string, note: string) =>
    `${name} looked for a note that doesn’t exist: “${note}”.`,
  noteNotThere: (name: string) => `${name} tried to edit a note that doesn’t exist yet.`,
  noSection: (title: string) => `The note has no section with that title: “${title}”.`,
  privateNote: 'This note is private: only you and the lead can read it.',
  systemFolder: 'That folder is managed by Monsters itself: the monsters don’t touch it.',
  notReachable:
    'Other people take part in this chat: the monsters here can only use the notes of its folder.',
  changedMeanwhile: (name: string) =>
    `The note changed in the meantime: ${name} has to read it again before editing it.`,
  alreadyExists: (name: string) =>
    `A note with that name already exists: ${name} didn’t overwrite it.`,
};

const it: typeof en = {
  cannotWrite: (name, areas) =>
    `${name} non può modificare questa nota: scrive solo ${areas ? `in ${areas}` : 'nelle sue cartelle'} e nelle note che ha creato.`,
  cannotDelete: (name, areas) =>
    `${name} non può cancellare né spostare questa nota: cambia solo le note ${areas ? `in ${areas}` : 'nelle sue cartelle'} e quelle che ha creato.`,
  cannotMove: (name, areas) =>
    `${name} non può spostare una nota lì: sposta le note solo dentro ${areas ?? 'le sue cartelle'}.`,
  whereToChange: (name) =>
    `Le cartelle di un mostro si cambiano in Impostazioni → Squadra → ${name} → Dove scrive nelle note.`,
  openSettings: (name) => `Apri le impostazioni di ${name}`,
  noteMissing: (name, note) => `${name} ha cercato una nota che non esiste: «${note}».`,
  noteNotThere: (name) => `${name} ha provato a modificare una nota che non esiste ancora.`,
  noSection: (title) => `La nota non ha una sezione con quel titolo: «${title}».`,
  privateNote: 'Questa nota è privata: la leggono solo tu e il capo.',
  systemFolder: 'Quella cartella la gestisce Monsters da solo: i mostri non la toccano.',
  notReachable:
    'In questa chat partecipano altre persone: qui i mostri possono usare solo le note della sua cartella.',
  changedMeanwhile: (name) =>
    `La nota è cambiata nel frattempo: ${name} deve rileggerla prima di modificarla.`,
  alreadyExists: (name) => `Esiste già una nota con quel nome: ${name} non l’ha sovrascritta.`,
};

export const toolProblemStrings = defineStrings({ en, it });
