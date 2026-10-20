import { describe, expect, it } from 'vitest';
import { coreMigrations, migrate, openDb } from '../src/index.ts';
import { StateStore } from '../src/db/state-store.ts';
import { PlanLimits } from '../src/providers/plan-limits.ts';

const NOW = Date.parse('2026-10-17T15:00:00Z');

function store() {
  const db = openDb(':memory:');
  migrate(db, 'core', coreMigrations);
  return new StateStore(db);
}

describe('PlanLimits (D-111)', () => {
  it('merges partial readings per window and replaces a complete one', () => {
    let now = NOW;
    const limits = new PlanLimits(store(), () => now);
    limits.observe({
      plan: 'claude',
      partial: true,
      windows: [
        { id: 'five_hour', usedPercent: 9, resetsAt: NOW + 92 * 60_000 },
        { id: 'seven_day', usedPercent: 63, resetsAt: NOW + 3 * 86_400_000 },
      ],
    });
    now = NOW + 20 * 60_000;
    limits.observe({
      plan: 'claude',
      partial: true,
      windows: [{ id: 'seven_day_opus', usedPercent: 41, resetsAt: NOW + 3 * 86_400_000 }],
    });
    const view = limits.view('claude')!;
    expect(view.windows.map((w) => [w.id, w.observedAt])).toEqual([
      ['five_hour', NOW],
      ['seven_day', NOW],
      ['seven_day_opus', NOW + 20 * 60_000],
    ]);
    expect(view.observedAt).toBe(NOW + 20 * 60_000);
    expect(limits.view('chatgpt')).toBeNull();

    limits.observe({
      plan: 'chatgpt',
      partial: false,
      windows: [{ id: 'primary', usedPercent: 24, resetsAt: null, windowMinutes: 300 }],
    });
    limits.observe({
      plan: 'chatgpt',
      partial: false,
      windows: [{ id: 'secondary', usedPercent: 81, resetsAt: null, windowMinutes: 10080 }],
    });
    expect(limits.view('chatgpt')!.windows.map((w) => w.id)).toEqual(['secondary']);
  });

  it('shows a window as reset once its time has passed, without forgetting the reading', () => {
    let now = NOW;
    const limits = new PlanLimits(store(), () => now);
    limits.observe({
      plan: 'claude',
      partial: true,
      windows: [
        { id: 'five_hour', usedPercent: 94, resetsAt: NOW + 60 * 60_000 },
        { id: 'seven_day', usedPercent: 63, resetsAt: NOW + 3 * 86_400_000 },
      ],
    });
    now = NOW + 61 * 60_000;
    const view = limits.view('claude')!;
    expect(view.windows[0]).toMatchObject({ id: 'five_hour', usedPercent: 0, reset: true });
    expect(view.windows[1]).toMatchObject({ id: 'seven_day', usedPercent: 63, reset: false });
    expect(view.windows[0]!.observedAt).toBe(NOW);
  });

  it('persists in the state store and ignores a damaged one', () => {
    const state = store();
    new PlanLimits(state, () => NOW).observe({
      plan: 'claude',
      partial: true,
      windows: [{ id: 'five_hour', usedPercent: 9, resetsAt: NOW + 1000 }],
    });
    const again = new PlanLimits(state, () => NOW);
    expect(again.view('claude')?.windows[0]).toMatchObject({ id: 'five_hour', usedPercent: 9 });

    state.set('plan_limits.claude', { plan: 'claude', windows: [{ id: 5 }] });
    state.set('plan_limits.chatgpt', 'garbage');
    expect(new PlanLimits(state, () => NOW).all()).toEqual({ claude: null, chatgpt: null });
  });

  it('forgets a plan and tells the listeners', () => {
    const limits = new PlanLimits(store(), () => NOW);
    const seen: string[] = [];
    limits.onChange((p) => seen.push(p));
    limits.observe({
      plan: 'chatgpt',
      partial: false,
      windows: [{ id: 'primary', usedPercent: 1, resetsAt: null }],
    });
    limits.clear('chatgpt');
    expect(limits.view('chatgpt')).toBeNull();
    expect(seen).toEqual(['chatgpt']);
  });
});
