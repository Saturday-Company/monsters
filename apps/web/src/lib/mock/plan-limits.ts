import { planLimitsView, type PlanLimitId, type PlanLimitsView } from '@monsters/shared';

/*
 * The plan limits of the mock (D-111): what a core would have kept after a
 * monster worked on the plan. Times are relative to now, so the block always
 * reads the same: a session at 9% that resets in 1 h 32, a week at 63%, Opus
 * at 41%; ChatGPT's two windows at 24% and 81%.
 */

const MIN = 60_000;
const DAY = 86_400_000;

/** The next Wednesday 16:00 (local), a few days away. */
function nextWednesday(now: number): number {
  const d = new Date(now);
  d.setHours(16, 0, 0, 0);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== 3);
  return d.getTime();
}

export function mockPlanLimits(plan: PlanLimitId, now = Date.now()): PlanLimitsView | null {
  const week = nextWednesday(now);
  return planLimitsView(
    plan === 'claude'
      ? {
          plan,
          windows: [
            {
              id: 'five_hour',
              usedPercent: 9,
              resetsAt: now + 92 * MIN,
              observedAt: now - 20 * MIN,
            },
            { id: 'seven_day', usedPercent: 63, resetsAt: week, observedAt: now - 20 * MIN },
            { id: 'seven_day_opus', usedPercent: 41, resetsAt: week, observedAt: now - 35 * MIN },
          ],
        }
      : {
          plan,
          windows: [
            {
              id: 'primary',
              usedPercent: 24,
              resetsAt: now + 75 * MIN,
              windowMinutes: 300,
              observedAt: now - 20 * MIN,
            },
            {
              id: 'secondary',
              usedPercent: 81,
              resetsAt: now + 4 * DAY,
              windowMinutes: 10_080,
              observedAt: now - 20 * MIN,
            },
          ],
        },
    now,
  );
}

/** The plan a first link of a chain works on, or null. */
export function planOfProvider(provider: string | undefined): PlanLimitId | null {
  if (provider === 'claude-agent') return 'claude';
  return provider === 'codex' || provider === 'chatgpt' ? 'chatgpt' : null;
}
