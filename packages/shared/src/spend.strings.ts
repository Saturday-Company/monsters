import { pick } from './i18n.ts';

/** The words of the spending caps: money, periods and the sentence of a `spend` event (D-153). */
const en = {
  /** A number already formatted for the language, as money: "€10", "€0.43". */
  eur: (n: string) => `€${n}`,
  periodDay: 'for today',
  periodMonth: 'for this month',
  squad: 'all monsters’',
  whose: (name: string) => `${name}’s`,
  warning: (spent: string, percent: number, cap: string) =>
    `Spent ${spent}: that’s ${percent}% of ${cap}.`,
  stopped: (cap: string) => `Reached ${cap}: jobs with paid models stop until you raise the cap.`,
  /** "all monsters’ cap for today (€10)". */
  capOf: (whose: string, period: string, amount: string) => `${whose} cap ${period} (${amount})`,
};

const it: typeof en = {
  eur: (n) => `${n} €`,
  periodDay: 'di oggi',
  periodMonth: 'di questo mese',
  squad: 'di tutti i mostri',
  whose: (name) => `di ${name}`,
  warning: (spent, percent, cap) => `Spesi ${spent}: è l’${percent}% del ${cap}.`,
  stopped: (cap) =>
    `Raggiunto il ${cap}: i lavori con modelli a pagamento si fermano finché non alzi il tetto.`,
  capOf: (whose, period, amount) => `tetto ${whose} ${period} (${amount})`,
};

export const spendStrings = () => pick({ en, it });
