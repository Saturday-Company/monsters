import { defineStrings } from '../../lib/i18n.ts';

/* The right-hand pane: Preview, Behind the scenes, Usage (D-153). */

const en = {
  tabs: { preview: 'Preview', terminal: 'Behind the scenes', usage: 'Usage' },
  grip: 'Panel width',
  gripTitle: 'Drag to change the width (double click: back to the default)',
  openChat: (terminal: boolean) =>
    `Open a monster’s chat to see ${terminal ? 'what it does' : 'its usage'}.`,
  panel: 'Right-hand pane',
  tabsLabel: 'What the pane shows',
  close: 'Close the pane',
  closeTitle: 'Close (Esc)',
  loading: 'Loading…',
};

const it: typeof en = {
  tabs: { preview: 'Anteprima', terminal: 'Dietro le quinte', usage: 'Consumi' },
  grip: 'Larghezza del pannello',
  gripTitle: 'Trascina per cambiare la larghezza (doppio clic: torna com’era)',
  openChat: (terminal) =>
    `Apri la chat di un mostro per vedere ${terminal ? 'cosa fa' : 'i suoi consumi'}.`,
  panel: 'Pannello a destra',
  tabsLabel: 'Cosa mostra il pannello',
  close: 'Chiudi il pannello',
  closeTitle: 'Chiudi (Esc)',
  loading: 'Carico…',
};

export const dockStrings = defineStrings({ en, it });
