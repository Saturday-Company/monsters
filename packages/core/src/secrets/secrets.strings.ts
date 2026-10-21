import { pick } from '@monsters/shared';

/* Messages of the keychain and the secrets store that reach the user (D-153). */

const en = {
  keychainMac: 'macOS Keychain',
  keychainWindows: 'Windows Credential Manager',
  keychainUnreachable: (why: string) => `the keychain can’t be reached: ${why}`,
  keychainTimeout: (seconds: number) => `the keychain didn’t answer within ${seconds} s`,
  keychainModule: (message: string) => `keychain module not available: ${message}`,
  keychainAborted: 'waiting for the keychain was interrupted: the core is stopping',
  badMode: (value: string) => `invalid MONSTERS_SECRETS: ${value} (auto, keychain or file)`,
  cantDecrypt: (name: string) =>
    `the secret ${name} can’t be decrypted (different key or damaged file)`,
  keychainRequired: (detail: string) =>
    `keychain required (MONSTERS_SECRETS=keychain) but not usable: ${detail}`,
  keyInvalid: 'the key in the keychain isn’t valid',
  keyNotReturned: 'the keychain doesn’t return the key it just saved',
  keyMissing: (locked: string) =>
    `the keychain doesn’t have the key of this folder; encrypted: ${locked}`,
};

const it: typeof en = {
  keychainMac: 'Portachiavi di macOS',
  keychainWindows: 'Gestione credenziali di Windows',
  keychainUnreachable: (why) => `portachiavi non raggiungibile: ${why}`,
  keychainTimeout: (seconds) => `il portachiavi non ha risposto entro ${seconds} s`,
  keychainModule: (message) => `modulo del portachiavi non disponibile: ${message}`,
  keychainAborted: 'attesa del portachiavi interrotta: il core si sta fermando',
  badMode: (value) => `MONSTERS_SECRETS non valido: ${value} (auto, keychain o file)`,
  cantDecrypt: (name) =>
    `il segreto ${name} non si può decifrare (chiave diversa o file danneggiato)`,
  keychainRequired: (detail) =>
    `portachiavi richiesto (MONSTERS_SECRETS=keychain) ma non usabile: ${detail}`,
  keyInvalid: 'la chiave nel portachiavi non è valida',
  keyNotReturned: 'il portachiavi non restituisce la chiave appena salvata',
  keyMissing: (locked) => `il portachiavi non ha la chiave di questa cartella; cifrate: ${locked}`,
};

export const secretStrings = () => pick({ en, it });
