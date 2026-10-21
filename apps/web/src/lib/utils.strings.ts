import { defineStrings } from './i18n.ts';

/* Shared formatting helpers (D-153): words of dates, times and money. */

const en = {
  today: 'Today',
  yesterday: 'Yesterday',
  now: 'just now',
  minutesAgo: (n: number) => `${n} min ago`,
  hoursAgo: (n: number) => `${n} h ago`,
  /** "to Titan": the preposition before a name. */
  toName: (name: string) => `to ${name}`,
  moreChars: (n: number) => `${n} more characters`,
};

const it: typeof en = {
  today: 'Oggi',
  yesterday: 'Ieri',
  now: 'adesso',
  minutesAgo: (n) => `${n} min fa`,
  hoursAgo: (n) => `${n} h fa`,
  // With the euphonic d before an "a": "ad Atlas".
  toName: (name) => (/^[aàAÀ]/.test(name) ? `ad ${name}` : `a ${name}`),
  moreChars: (n) => `${n} caratteri in più`,
};

export const utilsStrings = defineStrings({ en, it });
