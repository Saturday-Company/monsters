import { describe, expect, it } from 'vitest';
import {
  AutomationCreateSchema,
  AutomationUpdateSchema,
  describeSchedule,
  EventInputSchema,
  isTimeZone,
} from '../src/index.ts';

describe('describeSchedule', () => {
  it('says the common patterns in Italian', () => {
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
