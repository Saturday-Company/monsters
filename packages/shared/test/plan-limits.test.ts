import { describe, expect, it } from 'vitest';
import {
  mergePlanReading,
  planLimitsView,
  planPeak,
  planWindowLabel,
  planWindowTone,
  setAppLang,
  windowLengthLabel,
  type PlanLimitsSnapshot,
} from '../src/index.ts';

const NOW = Date.parse('2026-10-17T15:00:00Z');

const snapshot: PlanLimitsSnapshot = {
  plan: 'claude',
  windows: [
    { id: 'seven_day_opus', usedPercent: 41, resetsAt: NOW + 86_400_000, observedAt: NOW - 60_000 },
    { id: 'seven_day', usedPercent: 63, resetsAt: NOW + 86_400_000, observedAt: NOW - 1_200_000 },
    { id: 'five_hour', usedPercent: 94.6, resetsAt: NOW + 92 * 60_000, observedAt: NOW - 60_000 },
  ],
};

describe('planLimitsView', () => {
  it('orders Claude windows, rounds, names and tones them', () => {
    const view = planLimitsView(snapshot, NOW)!;
    expect(view.windows.map((w) => [w.id, w.label, w.usedPercent, w.tone, w.reset])).toEqual([
      ['five_hour', 'Session', 95, 'high', false],
      ['seven_day', 'Week', 63, 'ok', false],
      ['seven_day_opus', 'Opus week', 41, 'ok', false],
    ]);
    expect(view.observedAt).toBe(NOW - 60_000);
  });

  it('shows a window past its reset time as reset, at 0%', () => {
    const view = planLimitsView(snapshot, NOW + 2 * 3_600_000)!;
    const five = view.windows.find((w) => w.id === 'five_hour')!;
    expect(five).toMatchObject({ usedPercent: 0, reset: true, tone: 'ok' });
    expect(view.windows.find((w) => w.id === 'seven_day')).toMatchObject({
      usedPercent: 63,
      reset: false,
    });
  });

  it('names Codex windows by their length, the short one first', () => {
    const view = planLimitsView(
      {
        plan: 'chatgpt',
        windows: [
          {
            id: 'secondary',
            usedPercent: 81,
            resetsAt: null,
            windowMinutes: 10080,
            observedAt: NOW,
          },
          { id: 'primary', usedPercent: 24, resetsAt: null, windowMinutes: 300, observedAt: NOW },
        ],
      },
      NOW,
    )!;
    expect(view.windows.map((w) => [w.label, w.tone])).toEqual([
      ['5 hours', 'ok'],
      ['Week', 'warn'],
    ]);
  });

  it('is null with nothing observed', () => {
    expect(planLimitsView(null, NOW)).toBeNull();
    expect(planLimitsView({ plan: 'claude', windows: [] }, NOW)).toBeNull();
  });
});

describe('mergePlanReading', () => {
  it('updates only the windows a partial reading names', () => {
    const merged = mergePlanReading(
      snapshot,
      {
        plan: 'claude',
        partial: true,
        windows: [{ id: 'five_hour', usedPercent: 10, resetsAt: NOW + 5 * 3_600_000 }],
      },
      NOW,
    );
    expect(merged.windows).toHaveLength(3);
    expect(merged.windows.find((w) => w.id === 'five_hour')).toMatchObject({
      usedPercent: 10,
      observedAt: NOW,
    });
    expect(merged.windows.find((w) => w.id === 'seven_day')?.observedAt).toBe(NOW - 1_200_000);
  });

  it('replaces everything with a complete reading', () => {
    const merged = mergePlanReading(
      {
        plan: 'chatgpt',
        windows: [{ id: 'secondary', usedPercent: 5, resetsAt: null, observedAt: 1 }],
      },
      {
        plan: 'chatgpt',
        partial: false,
        windows: [{ id: 'primary', usedPercent: 24, resetsAt: null, windowMinutes: 300 }],
      },
      NOW,
    );
    expect(merged.windows).toEqual([
      { id: 'primary', usedPercent: 24, resetsAt: null, windowMinutes: 300, observedAt: NOW },
    ]);
  });
});

describe('labels, tones, peak', () => {
  it('names windows by length', () => {
    expect(windowLengthLabel(300)).toBe('5 hours');
    expect(windowLengthLabel(60)).toBe('1 hour');
    expect(windowLengthLabel(90)).toBe('1.5 hours');
    expect(windowLengthLabel(10080)).toBe('Week');
    expect(windowLengthLabel(2880)).toBe('2 days');
    expect(windowLengthLabel(45)).toBe('45 min');
    expect(windowLengthLabel(null)).toBeNull();
    expect(planWindowLabel('chatgpt', 'primary')).toBe('Window');
    expect(planWindowLabel('chatgpt', 'secondary')).toBe('Second window');
    expect(planWindowLabel('claude', 'seven_day_opus')).toBe('Opus week');
    setAppLang('it');
    try {
      expect(windowLengthLabel(300)).toBe('5 ore');
      expect(windowLengthLabel(60)).toBe('1 ora');
      expect(windowLengthLabel(90)).toBe('1,5 ore');
      expect(windowLengthLabel(10080)).toBe('Settimana');
      expect(windowLengthLabel(2880)).toBe('2 giorni');
      expect(planWindowLabel('chatgpt', 'primary')).toBe('Finestra');
      expect(planWindowLabel('claude', 'five_hour')).toBe('Sessione');
    } finally {
      setAppLang('en');
    }
  });

  it('warns at 80% and 95%', () => {
    expect([79, 80, 94, 95, 120].map(planWindowTone)).toEqual([
      'ok',
      'warn',
      'warn',
      'high',
      'high',
    ]);
  });

  it('finds the highest window', () => {
    expect(planPeak(planLimitsView(snapshot, NOW))?.id).toBe('five_hour');
    expect(planPeak(null)).toBeNull();
  });
});
