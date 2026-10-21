import { pick } from './i18n.ts';

/** The words of the model lists: effort levels and the lines on the Claude plan's models (D-153). */
const en = {
  effort: { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Very high', max: 'Max' },
  claudeModels: { haiku: 'fast', sonnet: 'balanced', opus: 'the most capable' },
};

const it: typeof en = {
  effort: { low: 'Basso', medium: 'Medio', high: 'Alto', xhigh: 'Molto alto', max: 'Massimo' },
  claudeModels: { haiku: 'veloce', sonnet: 'equilibrato', opus: 'il più capace' },
};

export const providerStrings = () => pick({ en, it });
