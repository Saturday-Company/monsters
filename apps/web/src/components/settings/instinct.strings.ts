import { defineStrings } from '../../lib/i18n.ts';

/* Settings → Squad → Monsters’ decisions (the instinct) (D-153). */

const en = {
  trial: 'On trial',
  invalidKey: 'TypeSafe doesn’t recognize this key.',
  verificationFailed: 'I can’t verify the key with TypeSafe. Check your connection and try again.',
  keyFromEnv: 'The key comes from TYPESAFE_API_KEY on the computer: change it there.',
  noKey:
    'To use the expert model you need the TypeSafe key first. Paste it below: as soon as it’s saved, it decides.',
  failed: 'I can’t read the monsters’ decisions right now. Try again in a moment.',
  keyIncomplete: 'Paste the full key, with no spaces.',
  keySaved: 'TypeSafe key saved: the expert model decides.',
  usesOn: (on: number, total: number) => `${on} of ${total} on`,
  usesWaiting: (n: number) => `${n} waiting for a model`,
  whoDecides: 'Who decides',
  keyLabel: 'TypeSafe key',
  keyFromEnvStatus: (model: string) => `Taken from TYPESAFE_API_KEY on the computer · ${model}`,
  keySavedStatus: (model: string) => `Saved on this computer · ${model}`,
  active: 'Active',
  changeKey: 'Change key',
  needKey: 'To use the expert model you need a TypeSafe key: you create it at console.typesafe.ai.',
  newKeyLabel: 'New TypeSafe key',
  keyHint: 'It stays on this computer and isn’t shown again after saving.',
  keyPlaceholder: 'Paste the key here',
  verifying: 'Verifying…',
  saveKey: 'Save the key',
  whatItDoes: 'What it does',
  whatTheyDecide: 'What the monsters decide',
  whatLeaves: 'What leaves the computer',
  privacy: {
    jev: 'With the expert model, for each decision only what’s needed goes to TypeSafe, already cleaned of keys; never the content of your notes:',
    rules:
      'Right now the computer decides on its own: nothing leaves it. With the expert model only this would leave, never the content of your notes:',
    llm: 'Right now one of your models decides, as for the rest of the work. With the expert model only this would leave, never the content of your notes:',
  },
};

const it: typeof en = {
  trial: 'In prova',
  invalidKey: 'TypeSafe non riconosce questa chiave.',
  verificationFailed:
    'Non riesco a verificare la chiave con TypeSafe. Controlla la connessione e riprova.',
  keyFromEnv: 'La chiave viene da TYPESAFE_API_KEY sul computer: si cambia lì.',
  noKey:
    'Per usare il modello esperto serve prima la chiave di TypeSafe. Incollala qui sotto: appena è salvata, decide lui.',
  failed: 'Non riesco a leggere le decisioni dei mostri adesso. Riprova tra poco.',
  keyIncomplete: 'Incolla la chiave completa, senza spazi.',
  keySaved: 'Chiave di TypeSafe salvata: decide il modello esperto.',
  usesOn: (on, total) => `${on} su ${total} accese`,
  usesWaiting: (n) => `${n} in attesa di un modello`,
  whoDecides: 'Chi decide',
  keyLabel: 'Chiave di TypeSafe',
  keyFromEnvStatus: (model) => `Presa da TYPESAFE_API_KEY sul computer · ${model}`,
  keySavedStatus: (model) => `Salvata su questo computer · ${model}`,
  active: 'Attiva',
  changeKey: 'Cambia chiave',
  needKey:
    'Per usare il modello esperto serve una chiave di TypeSafe: la crei su console.typesafe.ai.',
  newKeyLabel: 'Nuova chiave di TypeSafe',
  keyHint: 'Resta su questo computer e non la mostriamo più dopo il salvataggio.',
  keyPlaceholder: 'Incolla qui la chiave',
  verifying: 'Verifico…',
  saveKey: 'Salva la chiave',
  whatItDoes: 'Cosa fa',
  whatTheyDecide: 'Cosa decidono i mostri',
  whatLeaves: 'Cosa esce dal computer',
  privacy: {
    jev: 'Con il modello esperto, per ogni decisione va a TypeSafe solo quello che serve, già ripulito dalle chiavi; mai il contenuto delle tue note:',
    rules:
      'Adesso decide il computer da solo: non esce niente. Con il modello esperto uscirebbe solo questo, mai il contenuto delle tue note:',
    llm: 'Adesso decide uno dei tuoi modelli, come per il resto del lavoro. Con il modello esperto uscirebbe solo questo, mai il contenuto delle tue note:',
  },
};

export const instinctStrings = defineStrings({ en, it });
