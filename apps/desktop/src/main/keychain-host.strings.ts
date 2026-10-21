import { pick } from '@monsters/shared';

/*
 * The messages the keychain host answers the core with (they end up in the core's notices and
 * log). Typed dictionaries (D-153); call `keychainHostStrings()` where the answer is built.
 */

const en = {
  invalidOp: 'invalid keychain operation',
  invalidEntry: 'invalid keychain entry',
  notMonstersEntry: 'keychain entry that doesn’t belong to Monsters',
  invalidValue: 'invalid value for the keychain',
  alreadyRunning: 'request already in progress',
  tooMany: 'too many keychain requests',
  moduleUnavailable: 'keychain module not available',
  notInManifest: 'the keychain binary isn’t in the app’s file list',
  noAnswer: (seconds: number) => `the keychain didn’t answer within ${seconds} s`,
  unreachable: (why: string) => `keychain unreachable: ${why}`,
  exited: (code: number) => `keychain unreachable: the process exited (code ${code})`,
  invalidReply: 'invalid keychain reply',
};

const it: typeof en = {
  invalidOp: 'operazione del portachiavi non valida',
  invalidEntry: 'voce del portachiavi non valida',
  notMonstersEntry: 'voce del portachiavi che non è di Monsters',
  invalidValue: 'valore per il portachiavi non valido',
  alreadyRunning: 'richiesta già in corso',
  tooMany: 'troppe richieste al portachiavi',
  moduleUnavailable: 'modulo del portachiavi non disponibile',
  notInManifest: 'il binario del portachiavi non è nell’elenco dei file del programma',
  noAnswer: (seconds) => `il portachiavi non ha risposto entro ${seconds} s`,
  unreachable: (why) => `portachiavi non raggiungibile: ${why}`,
  exited: (code) => `portachiavi non raggiungibile: il processo è uscito (codice ${code})`,
  invalidReply: 'risposta del portachiavi non valida',
};

export const keychainHostStrings = () => pick({ en, it });
