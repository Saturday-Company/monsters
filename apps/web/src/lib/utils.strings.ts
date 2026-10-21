import { defineStrings } from './i18n.ts';

/* Shared formatting helpers (D-153): words of dates, times and money. */

/** "a Titan" / "ad Atlas": the Italian preposition with the euphonic d before an "a". */
export const toNameIt = (name: string): string =>
  /^[aàAÀ]/.test(name) ? `ad ${name}` : `a ${name}`;

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
  toName: toNameIt,
  moreChars: (n) => `${n} caratteri in più`,
};

export const utilsStrings = defineStrings({ en, it });
