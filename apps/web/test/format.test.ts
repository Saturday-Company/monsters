import type { LogEvent } from '@monsters/shared';
import { setAppLang } from '@monsters/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { detailsOf } from '../src/components/log/details.ts';
import {
  estimatedNotice,
  parseEur,
  unpricedNotice,
} from '../src/components/settings/SpendSection.tsx';
import {
  eurFirst,
  formatAgo,
  formatDay,
  formatListTime,
  formatTime,
  formatShortDay,
  formatUsd,
  parseAmount,
  timeParts,
} from '../src/lib/utils.ts';

/** Runs the tests inside in Italian, then back to English (the default). */
function inItalian(fn: () => void) {
  describe('in Italian', () => {
    beforeAll(() => setAppLang('it'));
    afterAll(() => setAppLang('en'));
    fn();
  });
}

describe('formatUsd', () => {
  it('shows small costs with their significant digits, never "$0"', () => {
    expect(formatUsd(0.00002)).toBe('$0.00002'); // a decision of Jev
    expect(formatUsd(0.0000234)).toBe('$0.000023');
    expect(formatUsd(0.0012)).toBe('$0.0012');
    expect(formatUsd(0.0000004)).toBe('< $0.000001');
  });

  it('cents and dollars as usual', () => {
    expect(formatUsd(0.042)).toBe('$0.042');
    expect(formatUsd(0.5)).toBe('$0.5');
    expect(formatUsd(1.254)).toBe('$1.25');
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.002, '€')).toBe('€0.002');
  });

  inItalian(() => {
    it('puts the symbol after, with the Italian separators', () => {
      expect(formatUsd(0.00002)).toBe('0,00002 $');
      expect(formatUsd(0.0000234)).toBe('0,000023 $');
      expect(formatUsd(0.0012)).toBe('0,0012 $');
      expect(formatUsd(0.0000004)).toBe('< 0,000001 $');
      expect(formatUsd(0.042)).toBe('0,042 $');
      expect(formatUsd(0.5)).toBe('0,5 $');
      expect(formatUsd(1.254)).toBe('1,25 $');
      expect(formatUsd(0)).toBe('0 $');
      expect(formatUsd(0.002, '€')).toBe('0,002 €');
    });
  });
});

describe('cost in the details of the log', () => {
  beforeEach(() => setAppLang('it'));
  afterEach(() => setAppLang('en'));
  const usage = (costUsd: number): LogEvent => ({
    id: '01J0000000000000000000000A',
    ts: 0,
    agent: 'system',
    runId: null,
    parentId: null,
    type: 'provider_usage',
    data: { provider: 'typesafe', model: 'jev', inputTokens: 480, costUsd },
  });
  const cost = (e: LogEvent) => detailsOf(e).find((f) => f.label === 'Costo')?.value;

  it('a decision of Jev is neither free nor "0 $"', () => {
    expect(cost(usage(0.00002))).toBe('0,00002 $');
    expect(cost(usage(0))).toBe('gratis');
  });

  it('shows the input tokens read from the prompt cache (D-064)', () => {
    const e = usage(0.001);
    if (e.type !== 'provider_usage') throw new Error('provider_usage');
    e.data = { ...e.data, inputTokens: 12_000, cachedInputTokens: 10_000, outputTokens: 300 };
    expect(detailsOf(e).find((f) => f.label === 'Token')?.value).toBe(
      '12.000 letti (10.000 dalla cache), 300 scritti',
    );
  });
});

describe('parseAmount and the spending caps (collaudo of 17/10)', () => {
  afterEach(() => setAppLang('en'));
  it('in English "," groups thousands and "." is the decimal point (W-3)', () => {
    expect(parseAmount('1,000')).toBe(1000); // it was 1
    expect(parseAmount('2,000')).toBe(2000);
    expect(parseAmount('200,000')).toBe(200000);
    expect(parseAmount('1,000,000')).toBe(1000000);
    expect(parseAmount('1,000.50')).toBe(1000.5);
    expect(parseAmount('0.43')).toBe(0.43); // it was 43
    expect(parseAmount('12.5')).toBe(12.5);
    expect(parseAmount('12,5 €')).toBe(12.5); // a comma that cannot be a group
    expect(parseAmount('$ 1000')).toBeUndefined();
    expect(parseAmount('1000 $')).toBe(1000);
    expect(parseAmount('10')).toBe(10);
    expect(parseAmount('  ')).toBeNull();
  });

  it('in Italian "." groups thousands and "," is the decimal mark', () => {
    expect(parseAmount('1.000', 'it')).toBe(1000);
    expect(parseAmount('200.000', 'it')).toBe(200000);
    expect(parseAmount('1.000.000', 'it')).toBe(1000000);
    expect(parseAmount('1.000,50', 'it')).toBe(1000.5);
    expect(parseAmount('0,43', 'it')).toBe(0.43);
    expect(parseAmount('12,5', 'it')).toBe(12.5);
    expect(parseAmount('12.5', 'it')).toBe(12.5);
    setAppLang('it');
    expect(parseAmount('1.000')).toBe(1000); // the language of the app is the default
  });

  it('refuses what it cannot read for sure, instead of truncating or guessing', () => {
    // A thousand or one? In English "1.000" is a decimal that looks like a group.
    expect(parseAmount('1.000')).toBeUndefined();
    expect(parseAmount('1,000', 'it')).toBeUndefined();
    expect(parseAmount('2.500')).toBeUndefined();
    // Not a decimal that looks like a group: a leading zero or a longer integer part.
    expect(parseAmount('0.500')).toBe(0.5);
    expect(parseAmount('1234.567')).toBe(1234.567);
    for (const bad of [
      '1,2,3',
      '1,00,000',
      '1,0000,000',
      '1.2.3',
      '1,000.5.0',
      '1.5,5',
      '12.',
      ',5',
      '-1',
      'dieci',
      '1e3',
    ]) {
      expect(parseAmount(bad), bad).toBeUndefined();
      expect(parseAmount(bad, 'it'), bad).toBeUndefined();
    }
    expect(parseAmount('1,000,5')).toBeUndefined();
  });

  it('a cap below 0,50 € is refused, not multiplied by a hundred', () => {
    expect(parseEur('0.43')).toBeUndefined();
    expect(parseEur('0.5')).toBe(0.5);
    expect(parseEur('0,50')).toBe(0.5);
    expect(parseEur('')).toBeNull();
  });

  it('a paid key without a price is said plainly on the cap’s card (D-114)', () => {
    expect(unpricedNotice([])).toBeNull();
    expect(unpricedNotice(['Anthropic', 'Anthropic'])).toBe(
      'The cap doesn’t count what you spend with Anthropic: Monsters doesn’t know the price of those models, so it stops nothing there. Check your spending on the provider’s site.',
    );
    expect(unpricedNotice(['Anthropic', 'OpenAI', 'Google'], 'The project’s cap')).toMatch(
      /^The project’s cap doesn’t count what you spend with Anthropic, OpenAI, and Google:/,
    );
    setAppLang('it');
    expect(unpricedNotice(['Anthropic', 'Anthropic'])).toBe(
      'Il tetto non conta quello che spendi con Anthropic: Monsters non conosce il prezzo di quei modelli, quindi lì non ferma niente. Controlla la spesa sul sito del fornitore.',
    );
    expect(unpricedNotice(['Anthropic', 'OpenAI', 'Google'], 'Il tetto del progetto')).toMatch(
      /^Il tetto del progetto non conta quello che spendi con Anthropic, OpenAI e Google:/,
    );
  });

  it('a direct key priced by OpenRouter’s list says its cost is estimated, and that it stops', () => {
    expect(estimatedNotice([])).toBeNull();
    const said = estimatedNotice(['Anthropic', 'OpenAI'])!;
    expect(said).toMatch(/^With Anthropic and OpenAI the cost is estimated/);
    expect(said).toContain('stops jobs');
    setAppLang('it');
    const detto = estimatedNotice(['Anthropic', 'OpenAI'])!;
    expect(detto).toMatch(/^Con Anthropic e OpenAI il costo è stimato/);
    expect(detto).toContain('ferma i lavori');
  });
});

describe('formatShortDay', () => {
  const now = new Date(2026, 9, 18, 12).getTime();
  const today = new Date(2026, 9, 18, 8).getTime();
  const yesterday = new Date(2026, 9, 17, 21).getTime();
  const friday = new Date(2026, 9, 16, 21, 27).getTime();

  it('is short enough for a narrow card', () => {
    expect(formatShortDay(today, now)).toBe('Today');
    expect(formatShortDay(yesterday, now)).toBe('Yesterday');
    expect(formatShortDay(friday, now)).toBe('Oct 16');
  });

  inItalian(() => {
    it('is short enough for a narrow card', () => {
      expect(formatShortDay(today, now)).toBe('Oggi');
      expect(formatShortDay(yesterday, now)).toBe('Ieri');
      expect(formatShortDay(friday, now)).toBe('ven 16 ott');
    });
  });
});

describe('dates in the log and in the chat list', () => {
  const now = new Date(2026, 9, 18, 12).getTime();
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

  it('writes the day of the log in English', () => {
    expect(formatDay(at(18, 8), now)).toBe('Today');
    expect(formatDay(at(17, 8), now)).toBe('Yesterday');
    expect(formatDay(at(12, 8), now)).toBe('Monday, October 12');
    expect(formatListTime(at(18, 10, 15), now)).toBe('10:15 AM');
    // No leading zero in English: "9:05 AM", "4:00 PM".
    expect(formatListTime(at(18, 9, 5), now)).toBe('9:05 AM');
    expect(formatListTime(at(18, 16, 0), now)).toBe('4:00 PM');
    expect(formatTime(at(18, 0, 30))).toBe('12:30 AM');
    expect(formatListTime(at(17, 10), now)).toBe('Yesterday');
    expect(formatListTime(at(14, 10), now)).toBe('Wed');
    expect(formatListTime(at(2, 10), now)).toBe('Oct 2');
  });

  it('says how long ago', () => {
    expect(formatAgo(now - 10_000, now)).toBe('just now');
    expect(formatAgo(now - 3 * 60_000, now)).toBe('3 min ago');
    expect(formatAgo(now - 2 * 3_600_000, now)).toBe('2 h ago');
    expect(formatAgo(now - 30 * 3_600_000, now)).toBe('Yesterday');
  });

  inItalian(() => {
    it('writes the day of the log in Italian', () => {
      expect(formatDay(at(18, 8), now)).toBe('Oggi');
      expect(formatDay(at(17, 8), now)).toBe('Ieri');
      expect(formatDay(at(12, 8), now)).toBe('Lunedì 12 ottobre');
      expect(formatListTime(at(18, 10, 15), now)).toBe('10:15');
      expect(formatListTime(at(18, 9, 5), now)).toBe('09:05');
      expect(formatTime(at(18, 16, 0))).toBe('16:00');
      expect(formatListTime(at(17, 10), now)).toBe('Ieri');
      expect(formatListTime(at(14, 10), now)).toBe('mer');
      expect(formatListTime(at(2, 10), now)).toBe('2 ott');
      expect(formatAgo(now - 10_000, now)).toBe('adesso');
      expect(formatAgo(now - 3 * 60_000, now)).toBe('3 min fa');
      expect(formatAgo(now - 2 * 3_600_000, now)).toBe('2 h fa');
    });
  });
});

describe('eurFirst', () => {
  it('puts the euro first and the dollar in brackets', () => {
    expect(eurFirst(1.09)).toBe('€0.9 ($1.1)');
    expect(eurFirst(10, undefined, 0)).toBe('€9 ($10)');
  });

  inItalian(() => {
    it('with the symbols after', () => {
      expect(eurFirst(1.09)).toBe('0,9 € (1,1 $)');
      expect(eurFirst(10, undefined, 0)).toBe('9 € (10 $)');
    });
  });
});

describe('timeParts, the clock of the status display', () => {
  // 17:27 UTC, whatever the zone: the parts agree with `formatTime` in each language.
  const ts = Date.UTC(2026, 9, 25, 17, 27);
  afterEach(() => setAppLang('en'));

  it('splits a 12-hour time the way the chat writes it', () => {
    setAppLang('en');
    const t = timeParts(ts);
    expect(t.text).toBe(formatTime(ts));
    expect(t.period).toMatch(/^(AM|PM)$/);
    expect(t.minute).toBe('27');
    expect(Number(t.hour)).toBeGreaterThanOrEqual(1);
    expect(Number(t.hour)).toBeLessThanOrEqual(12);
    expect(t.text.replace(/\s/g, ' ')).toBe(`${t.hour}:${t.minute} ${t.period}`);
  });

  it('keeps 24 hours with two digits in Italian, without a period', () => {
    setAppLang('it');
    const t = timeParts(ts);
    expect(t.text).toBe(formatTime(ts));
    expect(t.period).toBeNull();
    expect(t.hour).toMatch(/^\d{2}$/);
    expect(`${t.hour}:${t.minute}`).toBe(t.text);
  });
});
