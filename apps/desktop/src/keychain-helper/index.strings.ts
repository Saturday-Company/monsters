/*
 * The messages of the keychain helper (D-153). It runs in a utility process of its own that
 * does not hold the app's language: the main process puts it in the request (`lang`), and the
 * helper picks here. No `@monsters/shared` import on purpose: the helper's bundle stays tiny.
 */

const en = {
  notMonstersEntry: 'keychain entry that doesn’t belong to Monsters',
  badBinary: 'invalid keychain binary',
  binaryMismatch: 'the keychain binary isn’t the one that shipped with the app: not loading it',
};

const it: typeof en = {
  notMonstersEntry: 'voce del portachiavi che non è di Monsters',
  badBinary: 'binario del portachiavi non valido',
  binaryMismatch: 'il binario del portachiavi non è quello del programma: non lo carico',
};

export const helperStrings = (lang: 'en' | 'it' | undefined) => (lang === 'it' ? it : en);
