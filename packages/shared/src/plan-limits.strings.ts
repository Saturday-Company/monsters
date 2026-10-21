import { formatNumber, pick } from './i18n.ts';

/** The names of the windows of a plan's limits ("Session", "Week", "5 hours"), D-111 and D-153. */
const en = {
  five_hour: 'Session',
  seven_day: 'Week',
  seven_day_opus: 'Opus week',
  seven_day_sonnet: 'Sonnet week',
  week: 'Week',
  day: 'Day',
  days: (n: number) => `${n} days`,
  hours: (n: number) => (n === 1 ? '1 hour' : `${n} hours`),
  /** Hours with a decimal: 90 minutes is "1.5 hours". */
  hoursDecimal: (h: number) => `${formatNumber(h, { maximumFractionDigits: 1 })} hours`,
  minutes: (n: number) => `${n} min`,
  secondWindow: 'Second window',
  window: 'Window',
};

const it: typeof en = {
  five_hour: 'Sessione',
  seven_day: 'Settimana',
  seven_day_opus: 'Opus settimana',
  seven_day_sonnet: 'Sonnet settimana',
  week: 'Settimana',
  day: 'Giorno',
  days: (n) => `${n} giorni`,
  hours: (n) => (n === 1 ? '1 ora' : `${n} ore`),
  hoursDecimal: (h) => `${formatNumber(h, { maximumFractionDigits: 1 })} ore`,
  minutes: (n) => `${n} min`,
  secondWindow: 'Seconda finestra',
  window: 'Finestra',
};

export const planLimitStrings = () => pick({ en, it });
