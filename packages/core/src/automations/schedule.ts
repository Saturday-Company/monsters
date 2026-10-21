import { Cron } from 'croner';
import type { AutomationSchedule } from '@monsters/shared';
import { automationStrings } from './automations.strings.ts';

/*
 * When an automation runs (D-094): five-field cron expressions in an IANA
 * time zone, computed by croner (MIT, no dependencies, time zones and DST
 * through `Intl`). Only the computation is used: the timers are the
 * service's, so tests drive them with a fake clock. On the day the clocks go
 * forward a slot in the missing hour runs at the first valid minute after it;
 * on the day they go back a slot in the repeated hour runs once.
 */

export class ScheduleError extends Error {
  readonly code = 'invalid_schedule';
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleError';
  }
}

/** Slots missed while the core was off counted at most this far (the policy needs one). */
const MAX_COUNTED = 1000;

function cronOf(schedule: AutomationSchedule): Cron {
  try {
    const cron = new Cron(schedule.cron.trim(), {
      timezone: schedule.timezone,
      mode: '5-part',
      paused: true,
    });
    // An unknown zone fails only when a date is computed.
    cron.nextRun(new Date(0));
    return cron;
  } catch (err) {
    throw new ScheduleError(automationStrings().scheduleWhen((err as Error).message));
  }
}

/** Throws `ScheduleError` when the expression or the zone is not valid, or never matches. */
export function checkSchedule(schedule: AutomationSchedule): void {
  if (nextSlot(schedule, Date.now()) === null) {
    throw new ScheduleError(automationStrings().scheduleNever);
  }
}

/** The first slot strictly after `after` (epoch ms), or null. */
export function nextSlot(schedule: AutomationSchedule, after: number): number | null {
  return cronOf(schedule).nextRun(new Date(after))?.getTime() ?? null;
}

/** The latest slot at or before `at`, or null. */
export function previousSlot(schedule: AutomationSchedule, at: number): number | null {
  // `previousRuns` looks strictly before its reference, in whole seconds: one second later includes `at`.
  const found = cronOf(schedule)
    .previousRuns(1, new Date(at + 1000))[0]
    ?.getTime();
  return found !== undefined && found <= at ? found : null;
}

export interface MissedSlot {
  /** The latest slot missed. */
  slot: number;
  /** How many slots were missed after `since` (at most 1000). */
  missed: number;
  /**
   * Run it now: less than half the interval (from that slot to the next) has
   * passed since it. Otherwise it is skipped and logged.
   */
  catchUp: boolean;
}

/**
 * The slots after `since` and up to `now` that never ran (the core was off),
 * reduced to the latest one: null when there is none.
 */
export function missedSlot(
  schedule: AutomationSchedule,
  since: number,
  now: number,
): MissedSlot | null {
  const slot = previousSlot(schedule, now);
  if (slot === null || slot <= since) return null;
  const cron = cronOf(schedule);
  const after = cron.nextRun(new Date(slot))?.getTime() ?? null;
  const interval = after === null ? Number.POSITIVE_INFINITY : after - slot;
  let missed = 0;
  for (let t = since; missed < MAX_COUNTED;) {
    const next = cron.nextRun(new Date(t))?.getTime();
    if (next === undefined || next > slot) break;
    missed++;
    t = next;
  }
  return { slot, missed: Math.max(1, missed), catchUp: now - slot < interval / 2 };
}
