import { defineStrings } from '../../lib/i18n.ts';

/* Settings → Squad → Monsters’ decisions (the instinct) (D-153). */

const en = {
  trial: 'On trial',
  invalidKey: 'TypeSafe doesn’t recognize this key.',
  verificationFailed: 'I can’t verify the key with TypeSafe. Check your connection and try again.',
  keyFromEnv: 'The key is set on the computer, outside the app: change it there.',
  noKey:
    'To use the expert model you need its key first. Paste it below: as soon as it’s saved, it decides.',
  what: 'the monsters’ decisions',
  keyIncomplete: 'Paste the full key, with no spaces.',
  keySaved: 'Key saved: the expert model decides.',
  usesOn: (on: number, total: number) => `${on} of ${total} on`,
  usesWaiting: (n: number) => `${n} waiting for a model`,
  quick: 'Quick decisions',
  basic: 'Basic',
  smarter: 'Smarter',
  aboutRules: 'Simple rules decide, on this computer. Anything unclear goes to you.',
  aboutSmall: 'A small model of yours decides the easy cases: free, but slower.',
  aboutSmarter: 'The expert model decides in an instant and costs very little.',
  smarterNeeds: 'Smarter needs a TypeSafe key.',
  outboundTitle: 'Asks you before anything leaves the computer',
  outboundBefore:
    'Always on: publishing, writing to others, spending and deleting for good. What else to ask is in ',
  outboundLink: 'Permissions',
  outboundAfter: '.',
  chooseOneByOne: 'Choose one by one',
  whoDecides: 'Who decides',
  keyLabel: 'Key for the expert model',
  keyFromEnvStatus: (model: string) => `Set on the computer, outside the app · ${model}`,
  keySavedStatus: (model: string) => `Saved on this computer · ${model}`,
  active: 'Active',
  changeKey: 'Change key',
  needKey: 'To use the expert model you need its key: you create it at console.typesafe.ai.',
  newKeyLabel: 'New key for the expert model',
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
  keyFromEnv: 'La chiave è impostata sul computer, fuori dall’app: si cambia lì.',
  noKey:
    'Per usare il modello esperto serve prima la sua chiave. Incollala qui sotto: appena è salvata, decide lui.',
  what: 'le decisioni dei mostri',
  keyIncomplete: 'Incolla la chiave completa, senza spazi.',
  keySaved: 'Chiave salvata: decide il modello esperto.',
  usesOn: (on, total) => `${on} su ${total} accese`,
  usesWaiting: (n) => `${n} in attesa di un modello`,
  quick: 'Decisioni veloci',
  basic: 'Base',
  smarter: 'Più furbe',
  aboutRules: 'Decidono regole semplici, su questo computer. Le cose non chiare le chiedono a te.',
  aboutSmall: 'Un tuo modello piccolo decide i casi facili: gratis, ma più lento.',
  aboutSmarter: 'Decide il modello esperto, in un attimo, e costa pochissimo.',
  smarterNeeds: '“Più furbe” richiede una chiave di TypeSafe.',
  outboundTitle: 'Ti chiedono prima di qualsiasi cosa che esce dal computer',
  outboundBefore:
    'Sempre: pubblicare, scrivere ad altri, spendere e cancellare per sempre. Cos’altro chiederti lo scegli in ',
  outboundLink: 'Permessi',
  outboundAfter: '.',
  chooseOneByOne: 'Scegli uno per uno',
  whoDecides: 'Chi decide',
  keyLabel: 'Chiave del modello esperto',
  keyFromEnvStatus: (model) => `Impostata sul computer, fuori dall’app · ${model}`,
  keySavedStatus: (model) => `Salvata su questo computer · ${model}`,
  active: 'Attiva',
  changeKey: 'Cambia chiave',
  needKey: 'Per usare il modello esperto serve la sua chiave: la crei su console.typesafe.ai.',
  newKeyLabel: 'Nuova chiave del modello esperto',
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
