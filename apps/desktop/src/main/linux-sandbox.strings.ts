import { pick } from '@monsters/shared';

/* The notice of the AppImage running without Chromium's sandbox (linux-sandbox.ts, D-153). */

const en = {
  title: 'Monsters',
  message: 'This version of Monsters is a little less protected',
  detail:
    'On this system the AppImage version can’t use one of the built-in browser’s protections. ' +
    'Monsters works all the same; for full protection install the .deb package.',
  buttons: ['Continue', 'Quit'] as readonly string[],
  checkboxLabel: 'Don’t show this warning again',
};

const it: typeof en = {
  title: 'Monsters',
  message: 'Questa versione di Monsters è un po’ meno protetta',
  detail:
    'Su questo sistema la versione AppImage non può usare una delle protezioni del browser ' +
    'interno. Monsters funziona lo stesso; per la protezione completa installa il pacchetto .deb.',
  buttons: ['Continua', 'Esci'],
  checkboxLabel: 'Non mostrare più questo avviso',
};

export const sandboxNoticeStrings = () => pick({ en, it });
