import { pick } from '@monsters/shared';

/*
 * The refusal of an unsigned or badly signed update in a few words (update-signature.ts
 * `describeRefusal`, shown in the menu and in the dialog after "Check for updates").
 * Typed dictionaries (D-153).
 */

const en = {
  /** Without a version: the update could not even be named. */
  fetchAny: 'I can’t read the update and its signature: I’ll try again later',
  missingAny: 'the update isn’t signed: I’m not downloading it',
  invalidAny: 'the update’s signature isn’t valid: I’m not downloading it',
  missing: (version: string) => `update ${version} isn’t signed: I’m not downloading it`,
  noKeys: 'this version doesn’t have the key to verify updates: download Monsters from the website',
  unknownKey: (version: string) =>
    `update ${version} is signed with a key I don’t know: I’m not downloading it`,
  mismatch: (version: string) =>
    `update ${version} doesn’t match the signed one: I’m not downloading it`,
  fetch: (version: string) =>
    `I can’t read the signature of update ${version}: I’ll try again later`,
  invalid: (version: string) =>
    `the signature of update ${version} isn’t valid: I’m not downloading it`,
};

const it: typeof en = {
  fetchAny: 'non riesco a leggere l’aggiornamento e la sua firma: riprovo più tardi',
  missingAny: 'l’aggiornamento non è firmato: non lo scarico',
  invalidAny: 'la firma dell’aggiornamento non è valida: non lo scarico',
  missing: (version) => `l’aggiornamento ${version} non è firmato: non lo scarico`,
  noKeys:
    'questa versione non ha la chiave per verificare gli aggiornamenti: scarica Monsters dal sito',
  unknownKey: (version) =>
    `l’aggiornamento ${version} è firmato con una chiave che non conosco: non lo scarico`,
  mismatch: (version) =>
    `l’aggiornamento ${version} non corrisponde a quello firmato: non lo scarico`,
  fetch: (version) =>
    `non riesco a leggere la firma dell’aggiornamento ${version}: riprovo più tardi`,
  invalid: (version) => `la firma dell’aggiornamento ${version} non è valida: non lo scarico`,
};

export const updateSignatureStrings = () => pick({ en, it });
