import { pick } from './i18n.ts';

/** Words of a drawn block written as text (Telegram, the terminal; D-162). */
const en = {
  chartInApp: 'The chart is in the app.',
  best: 'recommended',
  youCanReply: 'You can reply:',
};

const it: typeof en = {
  chartInApp: 'Il grafico è nell’app.',
  best: 'consigliata',
  youCanReply: 'Puoi rispondere:',
};

export const uiBlockStrings = () => pick({ en, it });
