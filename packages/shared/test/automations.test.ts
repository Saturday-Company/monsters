import { afterEach, describe, expect, it } from 'vitest';
import {
  AutomationCreateSchema,
  AutomationUpdateSchema,
  describeSchedule,
  EventInputSchema,
  isTimeZone,
  setAppLang,
} from '../src/index.ts';

describe('describeSchedule', () => {
  afterEach(() => setAppLang('en'));

  it('says the common patterns in English', () => {
    const cases: [string, string][] = [
      ['0 23 * * 0', 'every Sunday at 11:00 PM'],
      ['0 23 * * 7', 'every Sunday at 11:00 PM'],
      ['0 8 * * *', 'every day at 8:00 AM'],
      ['30 1 * * *', 'every day at 1:30 AM'],
      ['0 0 * * *', 'every day at midnight'],
      ['0 8,20 * * *', 'every day at 8:00 AM and 8:00 PM'],
      ['0 9 * * 1-5', 'Monday to Friday at 9:00 AM'],
      ['0 9 * * 0,1,5', 'every Monday, Friday, and Sunday at 9:00 AM'],
      ['0 9 1 * *', 'on the 1st of every month at 9:00 AM'],
      ['15 18 15 * *', 'on the 15th of every month at 6:15 PM'],
      ['0 10 25 12 *', 'every year on December 25th at 10:00 AM'],
      ['0 10 2 3 *', 'every year on March 2nd at 10:00 AM'],
      ['0 10 23 3 *', 'every year on March 23rd at 10:00 AM'],
      ['*/15 * * * *', 'every 15 minutes'],
      ['0 * * * *', 'every hour'],
      ['20 * * * *', 'every hour at minute 20'],
      ['0 */2 * * *', 'every 2 hours'],
    ];
    for (const [cron, text] of cases) expect(describeSchedule(cron), cron).toBe(text);
    expect(describeSchedule('0 9 L * *')).toBe('cron: 0 9 L * *');
    expect(
      describeSchedule('0 8 * * *', { timezone: 'America/New_York', userTimezone: 'Europe/Rome' }),
    ).toBe('every day at 8:00 AM (America/New_York time)');
  });

  it('says the common patterns in Italian', () => {
    setAppLang('it');
    const cases: [string, string][] = [
      ['0 23 * * 0', 'ogni domenica alle 23:00'],
      ['0 23 * * 7', 'ogni domenica alle 23:00'],
      ['0 8 * * *', 'ogni giorno alle 8:00'],
      ['30 1 * * *', "ogni giorno all'1:30"],
      ['0 0 * * *', 'ogni giorno a mezzanotte'],
      ['0 8,20 * * *', 'ogni giorno alle 8:00 e alle 20:00'],
      ['0 9 * * 1-5', 'dal lunedì al venerdì alle 9:00'],
      ['0 9 * * 0,1,5', 'ogni lunedì, venerdì e domenica alle 9:00'],
      ['0 9 1 * *', 'il 1° di ogni mese alle 9:00'],
      ['15 18 15 * *', 'il 15 di ogni mese alle 18:15'],
      ['0 10 25 12 *', 'ogni anno il 25 dicembre alle 10:00'],
      ['*/15 * * * *', 'ogni 15 minuti'],
      ['0 * * * *', 'ogni ora'],
      ['0 */2 * * *', 'ogni 2 ore'],
    ];
    for (const [cron, text] of cases) expect(describeSchedule(cron), cron).toBe(text);
  });

  it('falls back to the expression, and names a zone other than the user’s', () => {
    setAppLang('it');
    expect(describeSchedule('0 9 L * *')).toBe('cron: 0 9 L * *');
    expect(describeSchedule('0 9 1-7 * 1')).toBe('cron: 0 9 1-7 * 1');
    expect(
      describeSchedule('0 8 * * *', { timezone: 'America/New_York', userTimezone: 'Europe/Rome' }),
    ).toBe('ogni giorno alle 8:00 (ora di America/New_York)');
    expect(
      describeSchedule('0 8 * * *', { timezone: 'Europe/Rome', userTimezone: 'Europe/Rome' }),
    ).toBe('ogni giorno alle 8:00');
  });
});

describe('automation schemas', () => {
  it('a create needs five cron fields and a known zone; the zone may be left to the core', () => {
    const base = { name: 'Post', lead: 'titan', objective: 'Scrivi.' };
    const ok = AutomationCreateSchema.parse({ ...base, schedule: { cron: '0 23 * * 0' } });
    expect(ok).toMatchObject({
      status: 'active',
      participants: [],
      limits: {},
      notify: { app: true, telegram: false },
    });
    expect(
      AutomationCreateSchema.safeParse({ ...base, schedule: { cron: '0 23 * *' } }).success,
    ).toBe(false);
    expect(
      AutomationCreateSchema.safeParse({
        ...base,
        schedule: { cron: '0 23 * * 0', timezone: 'Marte/Olympus' },
      }).success,
    ).toBe(false);
    expect(
      AutomationCreateSchema.safeParse({
        ...base,
        schedule: { cron: '0 23 * * 0' },
        resultsFolder: '../fuori',
      }).success,
    ).toBe(false);
    expect(isTimeZone('Europe/Rome')).toBe(true);
    expect(AutomationUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('the automation channel and events validate', () => {
    expect(
      EventInputSchema.safeParse({
        agent: 'user',
        runId: 'r1',
        type: 'message',
        data: { role: 'user', text: 'x', to: 'titan', channel: 'automation', automationId: 'post' },
      }).success,
    ).toBe(true);
    expect(
      EventInputSchema.safeParse({
        agent: 'system',
        type: 'automation_run_skipped',
        data: {
          automationId: 'post',
          name: 'Post',
          trigger: 'schedule',
          reason: 'busy',
          message: 'occupato',
        },
      }).success,
    ).toBe(true);
  });
});
