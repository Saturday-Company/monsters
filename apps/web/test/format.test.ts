import { setAppLang, type LogEvent } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { detailsOf } from '../src/components/log/details.ts';
import {
  estimatedNotice,
  parseEur,
  unpricedNotice,
} from '../src/components/settings/SpendSection.tsx';
import { eurFirst, formatShortDay, formatUsd, parseAmount } from '../src/lib/utils.ts';

afterEach(() => setAppLang('en'));

describe('formatUsd', () => {
  it('shows small costs with their significant digits, never "0 $"', () => {
    expect(formatUsd(0.00002)).toBe('0,00002 $'); // a decision of Jev
    expect(formatUsd(0.0000234)).toBe('0,000023 $');
    expect(formatUsd(0.0012)).toBe('0,0012 $');
    expect(formatUsd(0.0000004)).toBe('< 0,000001 $');
  });

  it('cents and dollars as usual', () => {
    expect(formatUsd(0.042)).toBe('0,042 $');
    expect(formatUsd(0.5)).toBe('0,5 $');
    expect(formatUsd(1.254)).toBe('1,25 $');
    expect(formatUsd(0)).toBe('0 $');
  });
});

describe('cost in the details of the log', () => {
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
  it('a dot is a decimal point unless it groups thousands', () => {
    expect(parseAmount('0.43')).toBe(0.43); // it was 43
    expect(parseAmount('0,43')).toBe(0.43);
    expect(parseAmount('12.5')).toBe(12.5);
    expect(parseAmount('12,5 €')).toBe(12.5);
    expect(parseAmount('1.000')).toBe(1000);
    expect(parseAmount('1.000,50')).toBe(1000.5);
    expect(parseAmount('10')).toBe(10);
    expect(parseAmount('  ')).toBeNull();
    expect(parseAmount('dieci')).toBeUndefined();
    expect(parseAmount('1,2,3')).toBeUndefined();
    expect(parseAmount('-1')).toBeUndefined();
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
  it('is short enough for a narrow card', () => {
    const now = new Date(2026, 9, 18, 12).getTime();
    expect(formatShortDay(new Date(2026, 9, 18, 8).getTime(), now)).toBe('Oggi');
    expect(formatShortDay(new Date(2026, 9, 17, 21).getTime(), now)).toBe('Ieri');
    expect(formatShortDay(new Date(2026, 9, 16, 21, 27).getTime(), now)).toBe('ven 16 ott');
  });
});

describe('eurFirst', () => {
  it('puts the euro first and the dollar in brackets', () => {
    expect(eurFirst(1.09)).toBe('0,9 € (1,1 $)');
    expect(eurFirst(10, undefined, 0)).toBe('9 € (10 $)');
  });
});
