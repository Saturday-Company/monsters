import {
  mergePlanReading,
  planLimitsView,
  PlanLimitsSnapshotSchema,
  type PlanLimitId,
  type PlanLimitsReading,
  type PlanLimitsResponse,
  type PlanLimitsSnapshot,
  type PlanLimitsView,
} from '@monsters/shared';
import type { StateStore } from '../db/state-store.ts';

/*
 * Utilizzo del piano (D-111): the latest reading of each plan's windows, with
 * the time it was observed, kept in the state store so a restart does not
 * lose it. Fed only by what the harnesses print while a monster works on the
 * plan; nothing here calls out. The numbers carry no secret (percentages and
 * reset times), but nothing of the reading is logged anyway.
 */

const KEY = (plan: PlanLimitId) => `plan_limits.${plan}`;

export class PlanLimits {
  readonly #state: StateStore;
  readonly #now: () => number;
  readonly #snapshots = new Map<PlanLimitId, PlanLimitsSnapshot>();
  readonly #listeners = new Set<(plan: PlanLimitId) => void>();

  constructor(state: StateStore, now: () => number = Date.now) {
    this.#state = state;
    this.#now = now;
    for (const plan of ['claude', 'chatgpt'] as const) {
      const parsed = PlanLimitsSnapshotSchema.safeParse(state.get<unknown>(KEY(plan)));
      if (parsed.success && parsed.data.plan === plan) this.#snapshots.set(plan, parsed.data);
    }
  }

  /** A reading from a harness: merged into the plan's snapshot and saved. */
  observe(reading: PlanLimitsReading): void {
    const next = mergePlanReading(this.#snapshots.get(reading.plan), reading, this.#now());
    this.#snapshots.set(reading.plan, next);
    this.#state.set(KEY(reading.plan), next);
    for (const l of this.#listeners) l(reading.plan);
  }

  /** The plan's windows as they read now: one past its reset time is 0% and `reset`. */
  view(plan: PlanLimitId): PlanLimitsView | null {
    return planLimitsView(this.#snapshots.get(plan), this.#now());
  }

  all(): PlanLimitsResponse {
    return { claude: this.view('claude'), chatgpt: this.view('chatgpt') };
  }

  /** Forgets a plan (the user signed out of it): its numbers would be someone else's. */
  clear(plan: PlanLimitId): void {
    if (!this.#snapshots.delete(plan)) return;
    this.#state.delete(KEY(plan));
  }

  onChange(listener: (plan: PlanLimitId) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
