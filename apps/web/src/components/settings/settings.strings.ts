import { defineStrings } from '../../lib/i18n.ts';

/* Settings: the page (SettingsView) and Permissions → "they always ask you" (D-153). */

const en = {
  view: {
    title: 'Settings',
    tabsLabel: 'Settings sections',
    hints: {
      squadra: 'Who’s on your squad, and who you are to the monsters.',
      modelli: 'What the monsters think with: keys and plans, and each one’s model.',
      permessi: 'What the monsters can do on their own, and what they always ask you first.',
      collegamenti:
        'Use the monsters from your phone, connect the apps they can use and choose how they search the web.',
      generale: 'Look and feel, your sign-in and where the notes and keys are kept.',
    },
  },
  askAlways: {
    what: 'what they always ask you',
    footerBefore: 'For everything else the monsters decide: you choose who decides in ',
    footerAfter: '.',
    fixed: 'Always: it can’t be turned off.',
    turnedOn: (what: string) => `From now on they ask you first: ${what.toLowerCase()}.`,
    turnedOff: 'Done.',
    other: 'Anything else to always ask you',
    otherEmpty: 'Nothing else.',
    otherPlaceholder: 'For example: before touching the work files.',
    saved: 'Saved.',
  },
};

const it: typeof en = {
  view: {
    title: 'Impostazioni',
    tabsLabel: 'Sezioni delle impostazioni',
    hints: {
      squadra: 'Chi c’è nella tua squadra, e chi sei tu per i mostri.',
      modelli: 'Con cosa pensano i mostri: chiavi e piani, e il modello di ognuno.',
      permessi: 'Cosa possono fare i mostri da soli, e cosa ti chiedono sempre prima.',
      collegamenti:
        'Usa i mostri dal telefono, collega le app che possono usare e scegli come cercano sul web.',
      generale: 'Aspetto, il tuo accesso e dove stanno le note e le chiavi.',
    },
  },
  askAlways: {
    what: 'cosa ti chiedono sempre',
    footerBefore: 'Per tutto il resto decidono i mostri: chi decide lo scegli in ',
    footerAfter: '.',
    fixed: 'Sempre: non si può spegnere.',
    turnedOn: (what) => `Da ora ti chiedono prima di: ${what.toLowerCase()}.`,
    turnedOff: 'Fatto.',
    other: 'Altro da chiederti sempre',
    otherEmpty: 'Niente altro.',
    otherPlaceholder: 'Per esempio: prima di toccare i file del lavoro.',
    saved: 'Salvato.',
  },
};

export const settingsStrings = defineStrings({ en, it });
