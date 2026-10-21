import { planLimitsView, type PlanLimitsSnapshot } from '@monsters/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setAppLang } from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The expectations are the Italian texts (the names of the windows): this file runs in Italian,
// whatever the default language of the tests.
beforeEach(() => setAppLang('it'));
afterEach(() => setAppLang('en'));
import { PlanLimitsBlock } from '../src/components/usage/PlanLimitsBlock.tsx';
import {
  formatAgo,
  formatResetsIn,
  litSegments,
  liveWindow,
  toneNote,
  windowNote,
} from '../src/components/usage/plan-limits-format.ts';
import { nextWednesday } from '../src/lib/mock/plan-limits.ts';

// Local times: the tests build their dates the same way the formatters read them.
const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 17, 14, 30); // a Saturday

describe('formatResetsIn', () => {
  it('counts down within the day', () => {
    expect(formatResetsIn(NOW + 30_000, NOW)).toBe('tra meno di un minuto');
    expect(formatResetsIn(NOW + 45 * 60_000, NOW)).toBe('tra 45 min');
    expect(formatResetsIn(NOW + 92 * 60_000, NOW)).toBe('tra 1 h 32');
    expect(formatResetsIn(NOW + 120 * 60_000, NOW)).toBe('tra 2 h');
  });

  it('names the weekday and the time from a day on', () => {
    // Wednesday 21 October 2026, 16:00.
    expect(formatResetsIn(at(2026, 10, 21, 16, 0), NOW)).toBe('mer 16:00');
    expect(formatResetsIn(at(2026, 10, 19, 9, 5), NOW)).toBe('lun 09:05');
  });
});

describe('formatAgo', () => {
  it('reads how old a reading is', () => {
    expect(formatAgo(NOW - 10_000, NOW)).toBe('adesso');
    expect(formatAgo(NOW - 20 * 60_000, NOW)).toBe('20 min fa');
    expect(formatAgo(NOW - 3 * 3_600_000, NOW)).toBe('3 h fa');
    expect(formatAgo(NOW - 30 * 3_600_000, NOW)).toBe('ieri');
    expect(formatAgo(NOW - 4 * 86_400_000, NOW)).toBe('4 giorni fa');
    expect(formatAgo(NOW + 5000, NOW)).toBe('adesso');
  });
});

/** Three Claude windows at 9%, 83% and 97%, as read 20 minutes before `now`. */
const claudeSnapshot = (now: number): PlanLimitsSnapshot => ({
  plan: 'claude',
  windows: [
    { id: 'five_hour', usedPercent: 9, resetsAt: now + 92 * 60_000, observedAt: now - 20 * 60_000 },
    {
      id: 'seven_day',
      usedPercent: 83,
      resetsAt: now + 3 * 86_400_000,
      observedAt: now - 20 * 60_000,
    },
    {
      id: 'seven_day_opus',
      usedPercent: 97,
      resetsAt: now + 3 * 86_400_000,
      observedAt: now - 20 * 60_000,
    },
  ],
});
const snapshot = claudeSnapshot(NOW);

describe('liveWindow and the notes', () => {
  const view = planLimitsView(snapshot, NOW)!;

  it('turns a window that reset while the page was open to 0%, "azzerato"', () => {
    const five = view.windows[0]!;
    expect(windowNote(five, NOW)).toBe('si azzera tra 1 h 32');
    expect(windowNote(view.windows[1]!, NOW)).toMatch(/^si azzera [a-z]{3} \d\d:\d\d$/);
    const later = liveWindow(five, NOW + 100 * 60_000);
    expect(later).toMatchObject({ reset: true, usedPercent: 0, tone: 'ok' });
    expect(windowNote(later, NOW + 100 * 60_000)).toBe('azzerato · si aggiorna al prossimo uso');
    expect(toneNote(later)).toBeNull();
  });

  it('says it in words from 80%, not by colour alone', () => {
    const [five, week, opus] = view.windows.map((w) => liveWindow(w, NOW));
    expect(toneNote(five!)).toBeNull();
    expect(toneNote(week!)).toBe('in esaurimento');
    expect(toneNote(opus!)).toBe('quasi al limite');
    expect(toneNote({ ...opus!, usedPercent: 100 })).toBe('limite raggiunto');
  });

  it('lights one lineetta per 5%, and at least one while anything is used', () => {
    expect([0, 1, 9, 50, 83, 100, 140].map((p) => litSegments(p))).toEqual([
      0, 1, 2, 10, 17, 20, 20,
    ]);
  });
});

describe('PlanLimitsBlock', () => {
  it('renders a bar, percent, reset and age for each window, and the hint', () => {
    const html = renderToStaticMarkup(
      createElement(PlanLimitsBlock, {
        plan: 'claude',
        view: planLimitsView(claudeSnapshot(Date.now()), Date.now()),
      }),
    );
    expect(html).toContain('Sessione');
    expect(html).toContain('Settimana');
    expect(html).toContain('Opus settimana');
    expect(html).toMatch(/data-testid="plan-percent">9%</);
    expect(html).toMatch(/>83%</);
    expect(html).toContain('data-tone="warn"');
    expect(html).toContain('data-tone="high"');
    expect(html).toContain('in esaurimento');
    expect(html).toContain('quasi al limite');
    expect(html).toContain('Si aggiorna solo quando un mostro lavora con questo piano.');
    // Twenty lineette in each of the three bars.
    expect((html.match(/<i /g) ?? []).length).toBe(60);
  });

  it('says there is nothing yet when no run has reported', () => {
    const html = renderToStaticMarkup(
      createElement(PlanLimitsBlock, { plan: 'chatgpt', view: null }),
    );
    expect(html).toContain('Ancora nessun dato');
    expect(html).toContain('ChatGPT');
    expect(html).not.toContain('<i ');
  });

  it('shows a reading older than its reset as azzerato', () => {
    const old: PlanLimitsSnapshot = {
      plan: 'chatgpt',
      windows: [
        {
          id: 'primary',
          usedPercent: 99,
          resetsAt: Date.now() - 60_000,
          windowMinutes: 300,
          observedAt: Date.now() - 6 * 3_600_000,
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(PlanLimitsBlock, { plan: 'chatgpt', view: planLimitsView(old, Date.now()) }),
    );
    expect(html).toContain('data-tone="reset"');
    expect(html).toContain('azzerato · si aggiorna al prossimo uso');
    expect(html).toContain('5 ore');
    expect(html).toContain('Aggiornato 6 h fa');
    expect(html).not.toContain('quasi al limite');
  });
});

describe('the mock of ?mock=demo reads the same at any hour of the week', () => {
  it('the Claude week resets on a Wednesday at 16:00, at least a day away', () => {
    // Every half hour of a week, Tuesday evening included (the next Wednesday is hours away).
    for (let t = at(2026, 10, 19, 0, 0); t < at(2026, 10, 26, 0, 0); t += 30 * 60_000) {
      expect(formatResetsIn(nextWednesday(t), t), new Date(t).toString()).toBe('mer 16:00');
    }
  });
});
