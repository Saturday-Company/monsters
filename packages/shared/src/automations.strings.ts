import { formatDate, formatList, pick } from './i18n.ts';

/*
 * The schedule of an automation in words ("every Sunday at 11:00 PM", "ogni domenica alle 23:00"),
 * for the common cron patterns (D-153). Weekday numbers are cron's: 0 is Sunday.
 */

const ordinalRules = new Intl.PluralRules('en', { type: 'ordinal' });
const ordinalSuffix = { one: 'st', two: 'nd', few: 'rd', other: 'th' } as const;
const ordinal = (n: number) =>
  `${n}${ordinalSuffix[ordinalRules.select(n) as keyof typeof ordinalSuffix]}`;

const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const IT_DAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const IT_MONTHS = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
];

const en = {
  weekdays: EN_DAYS,
  months: EN_MONTHS,
  list: (items: string[]) => formatList(items),
  /** "at 11:00 PM" (the clock follows the locale: "at 23:00" in en-GB), "at 8:00 AM and 8:00 PM", "at midnight". */
  atTimes: (hours: number[], m: number) =>
    `at ${formatList(
      hours.map((h) =>
        h === 0 && m === 0
          ? 'midnight'
          : formatDate(Date.UTC(2000, 0, 1, h, m), {
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'UTC',
            }),
      ),
    )}`,
  everyDay: 'every day',
  /** "every Monday and Friday". */
  everyWeekdays: (days: string) => `every ${days}`,
  /** "Monday to Friday" (`from`, `to`: weekday indexes). */
  weekdayRange: (from: number, to: number) => `${EN_DAYS[from]!} to ${EN_DAYS[to]!}`,
  everyMinute: 'every minute',
  everyMinutes: (n: number) => `every ${n} minutes`,
  everyHour: (minute: number) => (minute === 0 ? 'every hour' : `every hour at minute ${minute}`),
  everyHours: (n: number, minute: number) =>
    minute === 0 ? `every ${n} hours` : `every ${n} hours at minute ${minute}`,
  /** `when` is "at 9:00 AM". */
  daily: (day: string, when: string) => `${day} ${when}`,
  monthly: (dayOfMonth: number, when: string) =>
    `on the ${ordinal(dayOfMonth)} of every month ${when}`,
  yearly: (dayOfMonth: number, month: number, when: string) =>
    `every year on ${EN_MONTHS[month - 1]!} ${ordinal(dayOfMonth)} ${when}`,
  inZone: (text: string, tz: string) => `${text} (${tz} time)`,
};

const it: typeof en = {
  weekdays: IT_DAYS,
  months: IT_MONTHS,
  list: (items) =>
    items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items.at(-1)!}`,
  atTimes: (hours, m) =>
    it.list(
      hours.map((h) => {
        if (h === 0 && m === 0) return 'a mezzanotte';
        const time = `${h}:${String(m).padStart(2, '0')}`;
        return h === 1 ? `all'${time}` : `alle ${time}`;
      }),
    ),
  everyDay: 'ogni giorno',
  everyWeekdays: (days) => `ogni ${days}`,
  weekdayRange: (from, to) =>
    `${from === 0 ? 'dalla' : 'dal'} ${IT_DAYS[from]!} ${to === 0 ? 'alla' : 'al'} ${IT_DAYS[to]!}`,
  everyMinute: 'ogni minuto',
  everyMinutes: (n) => `ogni ${n} minuti`,
  everyHour: (minute) => (minute === 0 ? 'ogni ora' : `ogni ora al minuto ${minute}`),
  everyHours: (n, minute) => (minute === 0 ? `ogni ${n} ore` : `ogni ${n} ore al minuto ${minute}`),
  daily: (day, when) => `${day} ${when}`,
  monthly: (dayOfMonth, when) => `il ${dayOfMonth === 1 ? '1°' : dayOfMonth} di ogni mese ${when}`,
  yearly: (dayOfMonth, month, when) =>
    `ogni anno il ${dayOfMonth === 1 ? '1°' : dayOfMonth} ${IT_MONTHS[month - 1]!} ${when}`,
  inZone: (text, tz) => `${text} (ora di ${tz})`,
};

export const automationStrings = () => pick({ en, it });
