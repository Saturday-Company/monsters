import type { LogEvent, ScorecardRow, ScorecardView } from '@monsters/shared';
import type { AgentDefinition } from '../../agents/definition.ts';
import { HARNESS_PROVIDER_IDS } from '../../agents/run-harness.ts';
import type { StateStore } from '../../db/state-store.ts';
import type { EventLog } from '../../log/event-log.ts';
import { blockedByFreeOnly, hasTiers, type TieredRef } from './triage.ts';

/*
 * The pagella dei mostri (D-067, research 08 §5.9.1): the delegations checked
 * by "finito davvero?", by monster × model × tier, with steps and cost. After
 * at least 20 checked delegations of a model, the chain of a monster puts
 * first the model that finishes the most at the lowest cost: only among the
 * models of its own chain (the ones the user already has), never a paid one
 * with `freeOnly` on, never across a harness (Claude Agent, Codex), and with
 * an `instinct` event that says why. The chain in agent.yaml does not change:
 * the order is decided at every delegation, and the scorecard switch turns it off.
 */

/** Checked delegations of a model before the scorecard may move it. */
export const SCORECARD_MIN_DELEGATIONS = 20;

const STATE_KEY = 'instinct_scorecard_order';

interface Tally {
  agent: string;
  model: string;
  tier: 'light' | 'strong' | 'any';
  delegations: number;
  verified: number;
  doubt: number;
  incomplete: number;
  failed: number;
  steps: number;
  stepsN: number;
  cost: number;
  costN: number;
}

const refKey = (m: { provider: string; model: string }) => `${m.provider}:${m.model}`;

export interface ScorecardOptions {
  log: EventLog;
  state: StateStore;
  /** The scorecard use is on (it may reorder). */
  enabled: () => boolean;
  freeOnly: () => boolean;
  agentName: (id: string) => string;
  minDelegations?: number;
}

export class Scorecard {
  readonly #o: ScorecardOptions;
  readonly #tallies = new Map<string, Tally>();
  readonly #min: number;
  readonly #off: () => void;

  constructor(options: ScorecardOptions) {
    this.#o = options;
    this.#min = options.minDelegations ?? SCORECARD_MIN_DELEGATIONS;
    // The log is the source: the scorecard is rebuilt at every start.
    let after: string | undefined;
    for (;;) {
      const page = options.log.query({
        type: 'delegation',
        order: 'asc',
        limit: 1000,
        ...(after ? { after } : {}),
      });
      for (const e of page) this.#add(e as LogEvent<'delegation'>);
      if (page.length < 1000) break;
      after = page.at(-1)!.id;
    }
    this.#off = options.log.subscribe((e) => {
      if (e.type === 'delegation') this.#add(e);
    });
  }

  close(): void {
    this.#off();
  }

  #add(e: LogEvent<'delegation'>): void {
    const d = e.data;
    if (d.status !== 'completed' && d.status !== 'failed') return;
    if (!d.model) return;
    const tier = d.tier ?? 'any';
    const key = `${d.to}|${d.model}|${tier}`;
    let t = this.#tallies.get(key);
    if (!t) {
      t = {
        agent: d.to,
        model: d.model,
        tier,
        delegations: 0,
        verified: 0,
        doubt: 0,
        incomplete: 0,
        failed: 0,
        steps: 0,
        stepsN: 0,
        cost: 0,
        costN: 0,
      };
      this.#tallies.set(key, t);
    }
    t.delegations++;
    const verdict = d.status === 'failed' ? 'failed' : (d.check?.verdict ?? 'unchecked');
    if (verdict === 'verified') t.verified++;
    else if (verdict === 'doubt') t.doubt++;
    else if (verdict === 'incomplete') t.incomplete++;
    else if (verdict === 'failed') t.failed++;
    if (d.steps !== undefined) {
      t.steps += d.steps;
      t.stepsN++;
    }
    if (d.costUsd !== undefined) {
      t.cost += d.costUsd;
      t.costN++;
    }
  }

  static #row(t: Tally, name: string): ScorecardRow {
    const checked = t.verified + t.doubt + t.incomplete + t.failed;
    return {
      agent: t.agent,
      agentName: name,
      model: t.model,
      tier: t.tier,
      delegations: t.delegations,
      checked,
      verified: t.verified,
      doubt: t.doubt,
      incomplete: t.incomplete,
      failed: t.failed,
      successRate: checked > 0 ? t.verified / checked : null,
      avgSteps: t.stepsN > 0 ? t.steps / t.stepsN : null,
      avgCostUsd: t.costN > 0 ? t.cost / t.costN : null,
      costPerVerifiedUsd: t.verified > 0 ? t.cost / t.verified : null,
    };
  }

  rows(): ScorecardRow[] {
    return [...this.#tallies.values()]
      .map((t) => Scorecard.#row(t, this.#o.agentName(t.agent)))
      .sort((a, b) => a.agentName.localeCompare(b.agentName) || b.delegations - a.delegations);
  }

  view(): ScorecardView {
    return {
      enabled: this.#o.enabled(),
      minDelegations: this.#min,
      rows: this.rows(),
      reordered: this.#o.state.get<Record<string, string[]>>(STATE_KEY) ?? {},
    };
  }

  /** One agent's tallies by model, all tiers together. */
  #byModel(agent: string): Map<string, Tally> {
    const out = new Map<string, Tally>();
    for (const t of this.#tallies.values()) {
      if (t.agent !== agent) continue;
      const sum = out.get(t.model);
      if (!sum) out.set(t.model, { ...t, tier: 'any' });
      else {
        for (const k of [
          'delegations',
          'verified',
          'doubt',
          'incomplete',
          'failed',
          'steps',
          'stepsN',
          'cost',
          'costN',
        ] as const) {
          sum[k] += t[k];
        }
      }
    }
    return out;
  }

  /**
   * The chain of `agent` in the scorecard's order (unchanged when nothing is
   * earned, the use is off, the chain has a harness or has tiers). Logs an `instinct`
   * event when the order differs from the last one used.
   */
  order(agent: AgentDefinition, runId?: string | null): AgentDefinition {
    const models = agent.config.models as TieredRef[];
    if (!this.#o.enabled() || models.length < 2) return agent;
    if (models.some((m) => HARNESS_PROVIDER_IDS.has(m.provider))) return agent;
    // A chain with tiers has a base and a light and a strong link (D-093): reordering it would erase the base.
    if (hasTiers(models)) return agent;
    const tallies = this.#byModel(agent.config.id);
    const freeOnly = this.#o.freeOnly();
    const scoreOf = (m: TieredRef) => {
      const t = tallies.get(refKey(m));
      if (!t || blockedByFreeOnly(m, freeOnly)) return null;
      const row = Scorecard.#row(t, '');
      return row.checked >= this.#min ? row : null;
    };
    const slots = models.map((m, i) => ({ m, i, row: scoreOf(m) })).filter((s) => s.row !== null);
    if (slots.length < 2) return this.#remember(agent, null, runId);
    const ranked = [...slots].sort((a, b) => {
      const rate = (b.row!.successRate ?? 0) - (a.row!.successRate ?? 0);
      if (Math.abs(rate) > 1e-9) return rate;
      return (a.row!.costPerVerifiedUsd ?? Infinity) - (b.row!.costPerVerifiedUsd ?? Infinity);
    });
    const next = [...models];
    slots.forEach((s, k) => (next[s.i] = ranked[k]!.m));
    if (next.every((m, i) => m === models[i])) return this.#remember(agent, null, runId);
    const best = ranked[0]!;
    return this.#remember(
      { ...agent, config: { ...agent.config, models: next } },
      {
        why:
          `${refKey(best.m)} ha finito ${best.row!.verified} lavori controllati su ${best.row!.checked}` +
          (best.row!.costPerVerifiedUsd !== null
            ? ` (${best.row!.costPerVerifiedUsd.toFixed(4)} $ a lavoro)`
            : ''),
      },
      runId,
    );
  }

  /** Keeps the order used for the agent; an event when it changes. */
  #remember(
    agent: AgentDefinition,
    change: { why: string } | null,
    runId?: string | null,
  ): AgentDefinition {
    const all = { ...(this.#o.state.get<Record<string, string[]>>(STATE_KEY) ?? {}) };
    const id = agent.config.id;
    const order = agent.config.models.map(refKey);
    const before = all[id];
    if (!change) {
      if (before) {
        delete all[id];
        this.#o.state.set(STATE_KEY, all);
      }
      return agent;
    }
    if (before && before.join(',') === order.join(',')) return agent;
    all[id] = order;
    this.#o.state.set(STATE_KEY, all);
    this.#o.log.append({
      agent: 'system',
      runId: runId ?? null,
      type: 'instinct',
      data: {
        use: 'scorecard',
        action: 'chain_reordered',
        message: `Per ${agent.config.name} ora uso per primo ${order[0]}: ${change.why}.`,
        subject: id,
        details: { chain: order, ...(before ? { before } : {}) },
      },
    });
    return agent;
  }
}
