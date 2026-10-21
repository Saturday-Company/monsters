import { planLimitsView, setAppLang, type PlanLimitsSnapshot } from '@monsters/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    expect(formatResetsIn(NOW + 30_000, NOW)).toBe('in under a minute');
    expect(formatResetsIn(NOW + 45 * 60_000, NOW)).toBe('in 45 min');
    expect(formatResetsIn(NOW + 92 * 60_000, NOW)).toBe('in 1 h 32 min');
    expect(formatResetsIn(NOW + 120 * 60_000, NOW)).toBe('in 2 h');
  });

  it('names the weekday and the time from a day on', () => {
    // Wednesday 21 October 2026, 16:00.
    expect(formatResetsIn(at(2026, 10, 21, 16, 0), NOW)).toBe('Wed 04:00 PM');
    expect(formatResetsIn(at(2026, 10, 19, 9, 5), NOW)).toBe('Mon 09:05 AM');
  });

  describe('in Italian', () => {
    beforeAll(() => setAppLang('it'));
    afterAll(() => setAppLang('en'));

    it('counts down and names the weekday', () => {
      expect(formatResetsIn(NOW + 30_000, NOW)).toBe('tra meno di un minuto');
      expect(formatResetsIn(NOW + 45 * 60_000, NOW)).toBe('tra 45 min');
      expect(formatResetsIn(NOW + 92 * 60_000, NOW)).toBe('tra 1 h 32');
      expect(formatResetsIn(NOW + 120 * 60_000, NOW)).toBe('tra 2 h');
      expect(formatResetsIn(at(2026, 10, 21, 16, 0), NOW)).toBe('mer 16:00');
      expect(formatResetsIn(at(2026, 10, 19, 9, 5), NOW)).toBe('lun 09:05');
    });

    it('reads how old a reading is', () => {
      expect(formatAgo(NOW - 10_000, NOW)).toBe('adesso');
      expect(formatAgo(NOW - 20 * 60_000, NOW)).toBe('20 min fa');
      expect(formatAgo(NOW - 3 * 3_600_000, NOW)).toBe('3 h fa');
      expect(formatAgo(NOW - 30 * 3_600_000, NOW)).toBe('ieri');
      expect(formatAgo(NOW - 4 * 86_400_000, NOW)).toBe('4 giorni fa');
    });

    it('says the notes of a window', () => {
      const view = planLimitsView(claudeSnapshot(NOW), NOW)!;
      const five = view.windows[0]!;
      expect(windowNote(five, NOW)).toBe('si azzera tra 1 h 32');
      const later = liveWindow(five, NOW + 100 * 60_000);
      expect(windowNote(later, NOW + 100 * 60_000)).toBe('azzerato · si aggiorna al prossimo uso');
      const [, week, opus] = view.windows.map((w) => liveWindow(w, NOW));
      expect(toneNote(week!)).toBe('in esaurimento');
      expect(toneNote(opus!)).toBe('quasi al limite');
      expect(toneNote({ ...opus!, usedPercent: 100 })).toBe('limite raggiunto');
    });

    it('renders the hint and the age of a reading', () => {
      const html = renderToStaticMarkup(
        createElement(PlanLimitsBlock, {
          plan: 'claude',
          view: planLimitsView(claudeSnapshot(Date.now()), Date.now()),
        }),
      );
      expect(html).toContain('Si aggiorna solo quando un mostro lavora con questo piano.');
      expect(html).toContain('Aggiornato 20 min fa');
      expect(
        renderToStaticMarkup(createElement(PlanLimitsBlock, { plan: 'chatgpt', view: null })),
      ).toContain('Ancora nessun dato');
    });
  });
});

describe('formatAgo', () => {
  it('reads how old a reading is', () => {
    expect(formatAgo(NOW - 10_000, NOW)).toBe('just now');
    expect(formatAgo(NOW - 20 * 60_000, NOW)).toBe('20 min ago');
    expect(formatAgo(NOW - 3 * 3_600_000, NOW)).toBe('3 h ago');
    expect(formatAgo(NOW - 30 * 3_600_000, NOW)).toBe('yesterday');
    expect(formatAgo(NOW - 4 * 86_400_000, NOW)).toBe('4 days ago');
    expect(formatAgo(NOW + 5000, NOW)).toBe('just now');
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

  it('turns a window that reset while the page was open to 0%, "reset"', () => {
    const five = view.windows[0]!;
    expect(windowNote(five, NOW)).toBe('resets in 1 h 32 min');
    expect(windowNote(view.windows[1]!, NOW)).toMatch(/^resets [A-Za-z]{3} \d\d:\d\d [AP]M$/);
    const later = liveWindow(five, NOW + 100 * 60_000);
    expect(later).toMatchObject({ reset: true, usedPercent: 0, tone: 'ok' });
    expect(windowNote(later, NOW + 100 * 60_000)).toBe('reset · updates on next use');
    expect(toneNote(later)).toBeNull();
  });

  it('says it in words from 80%, not by colour alone', () => {
    const [five, week, opus] = view.windows.map((w) => liveWindow(w, NOW));
    expect(toneNote(five!)).toBeNull();
    expect(toneNote(week!)).toBe('running low');
    expect(toneNote(opus!)).toBe('almost at the limit');
    expect(toneNote({ ...opus!, usedPercent: 100 })).toBe('limit reached');
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
    expect(html).toContain('running low');
    expect(html).toContain('almost at the limit');
    expect(html).toContain('Updated 20 min ago.');
    expect(html).toContain('It updates only when a monster works on this plan.');
    // Twenty lineette in each of the three bars.
    expect((html.match(/<i /g) ?? []).length).toBe(60);
  });

  it('says there is nothing yet when no run has reported', () => {
    const html = renderToStaticMarkup(
      createElement(PlanLimitsBlock, { plan: 'chatgpt', view: null }),
    );
    expect(html).toContain('No data yet');
    expect(html).toContain('ChatGPT');
    expect(html).not.toContain('<i ');
  });

  it('shows a reading older than its reset as reset', () => {
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
    expect(html).toContain('reset · updates on next use');
    expect(html).toContain('5 ore');
    expect(html).toContain('Updated 6 h ago');
    expect(html).not.toContain('almost at the limit');
  });
});

describe('the mock of ?mock=demo reads the same at any hour of the week', () => {
  it('the Claude week resets on a Wednesday at 16:00, at least a day away', () => {
    // Every half hour of a week, Tuesday evening included (the next Wednesday is hours away).
    for (let t = at(2026, 10, 19, 0, 0); t < at(2026, 10, 26, 0, 0); t += 30 * 60_000) {
      expect(formatResetsIn(nextWednesday(t), t), new Date(t).toString()).toBe('Wed 04:00 PM');
    }
  });
});
