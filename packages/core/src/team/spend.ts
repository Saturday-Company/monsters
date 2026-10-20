import {
  SPEND_DEFAULT_DAILY_EUR,
  SPEND_DEFAULT_MONTHLY_EUR,
  SPEND_PERIOD_WORDS,
  SPEND_WARN_AT,
  SpendAgentCapsSchema,
  SpendCapEurSchema,
  USD_TO_EUR_DEFAULT,
  formatEur,
  spendSentence,
  type SpendAgentCaps,
  type SpendMeterView,
  type ProjectSpendView,
  type SpendPeriod,
  type SpendStatus,
  type SpendUpdate,
  type SpendView,
} from '@monsters/shared';
import { z } from 'zod';
import type { StateStore } from '../db/state-store.ts';
import type { EventLog } from '../log/event-log.ts';

/*
 * Spending caps in euros (D-070, research 07 §5.5). The meter sums the cost
 * the providers report (`provider_usage.costUsd`, in dollars) for today and
 * this month (local time of the computer), for the team and for each monster,
 * from the log at start and then event by event. At 80% of a cap one
 * `spend` warning (in the app; Telegram sends it as an error notification), at
 * 100% one `spend` stop: from then on the agents whose models cost money stop
 * (`stopReason`, through `RunBudget.spendCheck` and at the start of a turn),
 * until the cap is raised or the period ends. Subscriptions and free models
 * cost 0 and never stop; they are counted apart in the view.
 *
 * Three levels (D-097): the whole team (every squad), a project (what its
 * runs spent, cap in its project.yaml: a monster moved to another project
 * does not carry its spending there, F-B13) and a monster; the first one
 * reached stops the monster.
 *
 * The cost of a request is the provider's, or the price list's when the
 * provider reports none (F-A4). A paid model without a price is not counted
 * and never stops anything: the view says it (`unpriced`, D-114).
 */

export const SpendSettingsSchema = z.object({
  dailyEur: SpendCapEurSchema.default(SPEND_DEFAULT_DAILY_EUR),
  monthlyEur: SpendCapEurSchema.default(SPEND_DEFAULT_MONTHLY_EUR),
  usdToEur: z.number().min(0.1).max(10).default(USD_TO_EUR_DEFAULT),
  agents: z.record(z.string(), SpendAgentCapsSchema).default({}),
});
export type SpendSettings = z.infer<typeof SpendSettingsSchema>;
export const DEFAULT_SPEND_SETTINGS: SpendSettings = SpendSettingsSchema.parse({});

/** How a model request counts: money, free, a subscription, or paid without a price. */
export type UsageClass = 'paid' | 'free' | 'subscription' | 'unpriced';

export class SpendError extends Error {
  readonly code = 'unknown_agent';
  constructor(message: string) {
    super(message);
    this.name = 'SpendError';
  }
}

export interface SpendMeterOptions {
  log: EventLog;
  state: StateStore;
  settings: () => SpendSettings;
  save: (settings: SpendSettings) => void;
  /** How a request of this provider and model counts (cost already known). */
  classify: (provider: string, model: string, priced: boolean) => UsageClass;
  /** The agent's models cost money (a paid chain, not a subscription nor free models). */
  paidAgent: (agentId: string) => boolean;
  agents: () => { id: string; name: string }[];
  /** The projects in use, their monsters and their own caps (D-097). */
  projects?: () => { id: string; name: string; members: string[]; caps: SpendAgentCaps }[];
  /**
   * The paid models without a price in the monsters' chains (D-114): what
   * they spend is not counted, and the view says so before the first request.
   */
  unpricedModels?: () => { agent: string; provider: string }[];
  /**
   * Paid models of direct keys priced from OpenRouter's public list (D-114): counted at an
   * estimated cost, so the caps stop them too; the card says the cost is estimated.
   */
  estimatedModels?: () => { agent: string; provider: string }[];
  providerLabel: (provider: string) => string;
  now?: () => number;
}

/**
 * Where a cap holds: the team (every monster), a project (its monsters,
 * key `project:<id>`) or one monster (key: its id).
 */
interface Scope {
  key: string;
  /** For the sentences: null for the team. */
  name: string | null;
  /** The monsters it sums; undefined = all of them. */
  agents?: readonly string[];
  /** A project's scope sums what its runs spent, not its monsters (F-B13). */
  project?: string;
  caps: () => SpendAgentCaps | { dailyEur?: number | null; monthlyEur?: number | null };
}

const PROJECT_SCOPE = 'project:';

const ALERTS_KEY = 'spend_alerts';

function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function monthStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d.getTime();
}

interface Side {
  provider: string;
  requests: number;
  tokens: number;
}

export class SpendMeter {
  readonly #o: SpendMeterOptions;
  readonly #now: () => number;
  #dayFrom = 0;
  #monthFrom = 0;
  /** Dollars by agent. */
  #day = new Map<string, number>();
  #month = new Map<string, number>();
  /** Dollars by project, from the requests that say their project (F-B13). */
  #projectDay = new Map<string, number>();
  #projectMonth = new Map<string, number>();
  /** Dollars by agent of the older requests, written before the project was recorded. */
  #legacyDay = new Map<string, number>();
  #legacyMonth = new Map<string, number>();
  #freeRequests = 0;
  #subscriptions = new Map<string, Side>();
  #unpriced = new Map<string, Side>();
  readonly #off: () => void;

  constructor(options: SpendMeterOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
    this.#seed();
    this.#off = options.log.subscribe((e) => {
      if (e.type !== 'provider_usage') return;
      // A new day: the totals come from the log, this event included.
      const project = e.data.project;
      if (!this.#roll()) {
        const d = e.data;
        const cost = d.costUsd ?? 0;
        const tokens = (d.inputTokens ?? 0) + (d.outputTokens ?? 0);
        this.#add(e.agent, d.provider, d.model, 1, d.costUsd !== undefined ? 1 : 0, cost, tokens);
        this.#addProject(e.agent, project, cost, 'month');
        if (e.ts >= this.#dayFrom) {
          this.#day.set(e.agent, (this.#day.get(e.agent) ?? 0) + cost);
          this.#addProject(e.agent, project, cost, 'day');
        }
      }
      if ((e.data.costUsd ?? 0) > 0) this.#check(e.runId, e.agent, project);
    });
  }

  close(): void {
    this.#off();
  }

  /** The cost of a request on its project (F-B13), or on its agent when the event is older. */
  #addProject(
    agent: string,
    project: string | null | undefined,
    costUsd: number,
    period: SpendPeriod,
  ): void {
    if (project === null || costUsd === 0) return;
    if (project === undefined) {
      const legacy = period === 'day' ? this.#legacyDay : this.#legacyMonth;
      legacy.set(agent, (legacy.get(agent) ?? 0) + costUsd);
      return;
    }
    const map = period === 'day' ? this.#projectDay : this.#projectMonth;
    map.set(project, (map.get(project) ?? 0) + costUsd);
  }

  #add(
    agent: string,
    provider: string,
    model: string,
    requests: number,
    priced: number,
    costUsd: number,
    tokens: number,
  ): void {
    this.#month.set(agent, (this.#month.get(agent) ?? 0) + costUsd);
    const cls = this.#o.classify(provider, model, priced > 0);
    if (cls === 'free') this.#freeRequests += requests;
    const side =
      cls === 'subscription' ? this.#subscriptions : cls === 'unpriced' ? this.#unpriced : null;
    if (side) {
      const s = side.get(provider) ?? { provider, requests: 0, tokens: 0 };
      s.requests += requests;
      s.tokens += tokens;
      side.set(provider, s);
    }
  }

  /** Totals from the log: at start and when a day or a month begins. */
  #seed(): void {
    const now = this.#now();
    this.#dayFrom = dayStart(now);
    this.#monthFrom = monthStart(now);
    this.#day = new Map();
    this.#month = new Map();
    this.#projectDay = new Map();
    this.#projectMonth = new Map();
    this.#legacyDay = new Map();
    this.#legacyMonth = new Map();
    this.#freeRequests = 0;
    this.#subscriptions = new Map();
    this.#unpriced = new Map();
    for (const r of this.#o.log.usageTotals(this.#monthFrom)) {
      this.#add(r.agent, r.provider, r.model, r.requests, r.priced, r.costUsd, r.tokens);
    }
    for (const r of this.#o.log.usageTotals(this.#dayFrom)) {
      this.#day.set(r.agent, (this.#day.get(r.agent) ?? 0) + r.costUsd);
    }
    for (const [period, from] of [
      ['month', this.#monthFrom],
      ['day', this.#dayFrom],
    ] as const) {
      for (const r of this.#o.log.projectUsageTotals(from)) {
        this.#addProject(r.agent, r.legacy ? undefined : r.project, r.costUsd, period);
      }
    }
  }

  /** True when a new day (or month) began and the totals were read again. */
  #roll(): boolean {
    if (dayStart(this.#now()) === this.#dayFrom) return false;
    this.#seed();
    return true;
  }

  // --- caps ----------------------------------------------------------------------------

  #eur(usd: number): number {
    return usd * this.#o.settings().usdToEur;
  }

  #teamScope(): Scope {
    return { key: 'team', name: null, caps: () => this.#o.settings() };
  }

  #agentScope(agent: string): Scope {
    return {
      key: agent,
      name: this.#nameOf(agent),
      agents: [agent],
      caps: () => this.#o.settings().agents[agent] ?? {},
    };
  }

  #projects(): NonNullable<ReturnType<NonNullable<SpendMeterOptions['projects']>>> {
    return this.#o.projects?.() ?? [];
  }

  #projectScope(id: string): Scope | undefined {
    const p = this.#projects().find((x) => x.id === id);
    if (!p) return undefined;
    return {
      key: `${PROJECT_SCOPE}${p.id}`,
      name: p.name,
      agents: p.members,
      project: p.id,
      caps: () => this.#projects().find((x) => x.id === id)?.caps ?? {},
    };
  }

  /** A scope from its key (`team`, `project:<id>`, a monster's id). */
  #scopeOf(key: string): Scope | undefined {
    if (key === 'team') return this.#teamScope();
    if (key.startsWith(PROJECT_SCOPE)) return this.#projectScope(key.slice(PROJECT_SCOPE.length));
    return this.#agentScope(key);
  }

  #spent(period: SpendPeriod, scope: Scope): number {
    if (scope.project !== undefined) {
      // What the project's runs spent, plus the older requests of its monsters (F-B13).
      const legacy = period === 'day' ? this.#legacyDay : this.#legacyMonth;
      let total =
        (period === 'day' ? this.#projectDay : this.#projectMonth).get(scope.project) ?? 0;
      for (const a of scope.agents ?? []) total += legacy.get(a) ?? 0;
      return this.#eur(total);
    }
    const map = period === 'day' ? this.#day : this.#month;
    let total = 0;
    if (scope.agents) for (const a of scope.agents) total += map.get(a) ?? 0;
    else for (const v of map.values()) total += v;
    return this.#eur(total);
  }

  #cap(period: SpendPeriod, scope: Scope): number | null {
    const caps = scope.caps();
    return (period === 'day' ? caps.dailyEur : caps.monthlyEur) ?? null;
  }

  #meter(period: SpendPeriod, scope: Scope): SpendMeterView {
    const spentEur = this.#spent(period, scope);
    const capEur = this.#cap(period, scope);
    return { spentEur, capEur, ratio: capEur ? spentEur / capEur : null };
  }

  /**
   * Every cap that holds for an agent: the team's, its project's (D-097), its
   * own. With `project` (a request that says it, F-B13), that project's cap
   * instead of the one of the project the agent is in now.
   */
  #scopes(agent: string, project?: string | null): Scope[] {
    const id =
      project !== undefined ? project : this.#projects().find((p) => p.members.includes(agent))?.id;
    const scoped = id ? this.#projectScope(id) : undefined;
    return [this.#teamScope(), ...(scoped ? [scoped] : []), this.#agentScope(agent)];
  }

  #nameOf(id: string): string {
    return this.#o.agents().find((a) => a.id === id)?.name ?? id;
  }

  /**
   * Why an agent may not spend now (a sentence), or null. Agents whose models
   * cost nothing are never stopped, whatever the team spent.
   */
  stopReason(agentId: string): string | null {
    if (!this.#o.paidAgent(agentId)) return null;
    return this.capReached(agentId);
  }

  /**
   * The cap the team or the agent reached (a sentence), or null, whatever its
   * models: the paid web search of a monster on free models stops there too
   * and the free search takes over (D-071).
   */
  capReached(agentId: string): string | null {
    this.#roll();
    for (const period of ['day', 'month'] as const) {
      for (const scope of this.#scopes(agentId)) {
        const cap = this.#cap(period, scope);
        if (cap === null || this.#spent(period, scope) < cap) continue;
        const whose = scope.key.startsWith(PROJECT_SCOPE)
          ? ` del progetto ${scope.name}`
          : scope.name
            ? ` di ${scope.name}`
            : ' della squadra';
        return `raggiunto il tetto di spesa${whose} ${SPEND_PERIOD_WORDS[period]} (${formatEur(cap)})`;
      }
    }
    return null;
  }

  #periodKey(period: SpendPeriod): string {
    return `${period}:${period === 'day' ? this.#dayFrom : this.#monthFrom}`;
  }

  #alerts(): Set<string> {
    const keep = [this.#periodKey('day'), this.#periodKey('month')];
    const saved = this.#o.state.get<string[]>(ALERTS_KEY) ?? [];
    return new Set(saved.filter((k) => keep.some((p) => k.startsWith(`${p}:`))));
  }

  /** One warning at 80% and one stop at 100% per cap and period. */
  #check(runId: string | null, agent: string, project?: string | null): void {
    const alerts = this.#alerts();
    let changed = false;
    for (const period of ['day', 'month'] as const) {
      for (const scope of this.#scopes(agent, project)) {
        const cap = this.#cap(period, scope);
        if (!cap) continue;
        const spentEur = this.#spent(period, scope);
        const ratio = spentEur / cap;
        const action = ratio >= 1 ? 'stopped' : ratio >= SPEND_WARN_AT ? 'warning' : null;
        if (!action) continue;
        const key = `${this.#periodKey(period)}:${scope.key}:${action}`;
        if (alerts.has(key)) continue;
        alerts.add(key);
        // A stop says the warning too: no warning after it.
        if (action === 'stopped') alerts.add(`${this.#periodKey(period)}:${scope.key}:warning`);
        changed = true;
        this.#o.log.append({
          agent: 'system',
          runId,
          type: 'spend',
          data: {
            action,
            scope: scope.key,
            period,
            spentEur: Math.round(spentEur * 100) / 100,
            capEur: cap,
            subject: agent,
            message: spendSentence({
              action,
              scopeName: scope.key.startsWith(PROJECT_SCOPE)
                ? `progetto ${scope.name}`
                : scope.name,
              period,
              spentEur,
              capEur: cap,
            }),
          },
        });
      }
    }
    if (changed) this.#o.state.set(ALERTS_KEY, [...alerts]);
  }

  /**
   * After a cap changes (here, or a project's in its project.yaml): a cap no
   * longer reached may warn and stop again.
   */
  rearm(): void {
    const alerts = this.#alerts();
    for (const key of [...alerts]) {
      // `<period>:<from>:<scope>:<action>`; a project's scope has a colon of its own.
      const parts = key.split(':');
      const period = parts[0] as SpendPeriod;
      const action = parts.at(-1)!;
      const scope = this.#scopeOf(parts.slice(2, -1).join(':'));
      const cap = scope ? this.#cap(period, scope) : null;
      const ratio = scope && cap ? this.#spent(period, scope) / cap : 0;
      if (ratio < (action === 'stopped' ? 1 : SPEND_WARN_AT)) alerts.delete(key);
    }
    this.#o.state.set(ALERTS_KEY, [...alerts]);
  }

  // --- settings ----------------------------------------------------------------------------

  update(update: SpendUpdate): SpendView {
    const current = this.#o.settings();
    const known = new Set(this.#o.agents().map((a) => a.id));
    const agents: Record<string, SpendAgentCaps> = { ...current.agents };
    for (const [id, caps] of Object.entries(update.agents ?? {})) {
      if (!known.has(id)) throw new SpendError(`Non c’è nessun mostro “${id}” nella squadra.`);
      if (caps === null) {
        delete agents[id];
        continue;
      }
      const merged = { ...agents[id], ...caps };
      const clean: SpendAgentCaps = {};
      if (merged.dailyEur != null) clean.dailyEur = merged.dailyEur;
      if (merged.monthlyEur != null) clean.monthlyEur = merged.monthlyEur;
      if (Object.keys(clean).length === 0) delete agents[id];
      else agents[id] = clean;
    }
    const next: SpendSettings = {
      dailyEur: update.dailyEur !== undefined ? update.dailyEur : current.dailyEur,
      monthlyEur: update.monthlyEur !== undefined ? update.monthlyEur : current.monthlyEur,
      usdToEur: update.usdToEur ?? current.usdToEur,
      agents,
    };
    this.#o.save(next);
    this.rearm();
    return this.view();
  }

  #status(meters: SpendMeterView[]): SpendStatus {
    const top = Math.max(0, ...meters.map((m) => m.ratio ?? 0));
    return top >= 1 ? 'stopped' : top >= SPEND_WARN_AT ? 'warning' : 'ok';
  }

  view(): SpendView {
    this.#roll();
    const s = this.#o.settings();
    const team = this.#teamScope();
    const day = this.#meter('day', team);
    const month = this.#meter('month', team);
    const side = (m: Map<string, Side>) =>
      [...m.values()].map((v) => ({ ...v, label: this.#o.providerLabel(v.provider) }));
    // The paid models without a price in use now, before their first request too (D-114).
    const unpriced = new Map(this.#unpriced);
    for (const { provider } of this.#unpricedModels()) {
      if (!unpriced.has(provider)) unpriced.set(provider, { provider, requests: 0, tokens: 0 });
    }
    const estimated = [...new Set((this.#o.estimatedModels?.() ?? []).map((m) => m.provider))]
      .filter((provider) => !unpriced.has(provider))
      .map((provider) => ({ provider, label: this.#o.providerLabel(provider) }));
    return {
      usdToEur: s.usdToEur,
      warnAt: SPEND_WARN_AT,
      dayFrom: this.#dayFrom,
      monthFrom: this.#monthFrom,
      day,
      month,
      status: this.#status([day, month]),
      agents: this.#o.agents().map((a) => {
        const aDay = this.#meter('day', this.#agentScope(a.id));
        const aMonth = this.#meter('month', this.#agentScope(a.id));
        const paid = this.#o.paidAgent(a.id);
        const project = this.#projects().find((p) => p.members.includes(a.id));
        const scope = project ? this.#projectScope(project.id) : undefined;
        const pMeters = scope ? [this.#meter('day', scope), this.#meter('month', scope)] : [];
        return {
          id: a.id,
          name: a.name,
          paid,
          caps: s.agents[a.id] ?? {},
          day: aDay,
          month: aMonth,
          status: paid ? this.#status([day, month, ...pMeters, aDay, aMonth]) : 'ok',
          ...this.#unpricedOf(a.id),
          ...this.#estimatedOf(a.id),
        };
      }),
      projects: this.#projects().map((p) => {
        const scope = this.#projectScope(p.id)!;
        const pDay = this.#meter('day', scope);
        const pMonth = this.#meter('month', scope);
        return {
          id: p.id,
          name: p.name,
          caps: p.caps,
          day: pDay,
          month: pMonth,
          status: this.#status([day, month, pDay, pMonth]),
        };
      }),
      free: { requests: this.#freeRequests },
      subscriptions: side(this.#subscriptions),
      unpriced: side(unpriced),
      ...(estimated.length > 0 ? { estimated } : {}),
    };
  }

  #unpricedModels(): { agent: string; provider: string }[] {
    return this.#o.unpricedModels?.() ?? [];
  }

  /** The providers of an agent's chain whose price is unknown, by label (D-114). */
  #unpricedOf(agent: string): { unpriced?: string[] } {
    const labels = [
      ...new Set(
        this.#unpricedModels()
          .filter((m) => m.agent === agent)
          .map((m) => this.#o.providerLabel(m.provider)),
      ),
    ];
    return labels.length > 0 ? { unpriced: labels } : {};
  }

  /** The providers of an agent's chain whose cost is estimated from OpenRouter's list, by label. */
  #estimatedOf(agent: string): { estimated?: string[] } {
    const labels = [
      ...new Set(
        (this.#o.estimatedModels?.() ?? [])
          .filter((m) => m.agent === agent)
          .map((m) => this.#o.providerLabel(m.provider)),
      ),
    ];
    return labels.length > 0 ? { estimated: labels } : {};
  }

  /** A project's spending (D-097): its cap, its monsters, today and this month. */
  projectView(id: string): ProjectSpendView {
    this.#roll();
    const scope = this.#projectScope(id) ?? {
      key: `${PROJECT_SCOPE}${id}`,
      name: id,
      agents: [],
      caps: () => ({}),
    };
    const team = this.#teamScope();
    const day = this.#meter('day', scope);
    const month = this.#meter('month', scope);
    const p = this.#projects().find((x) => x.id === id);
    return {
      project: id,
      caps: p?.caps ?? {},
      day,
      month,
      status: this.#status([this.#meter('day', team), this.#meter('month', team), day, month]),
      agents: (scope.agents ?? []).map((a) => ({
        id: a,
        name: this.#nameOf(a),
        paid: this.#o.paidAgent(a),
        day: this.#meter('day', this.#agentScope(a)),
        month: this.#meter('month', this.#agentScope(a)),
        ...this.#unpricedOf(a),
        ...this.#estimatedOf(a),
      })),
    };
  }
}
