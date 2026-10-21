import {
  SPEND_DEFAULT_DAILY_EUR,
  SPEND_DEFAULT_MONTHLY_EUR,
  SPEND_WARN_AT,
  SpendUpdateSchema,
  USD_TO_EUR_DEFAULT,
  spendSentence,
  type AgentSummary,
  type EventInput,
  type SpendAgentCaps,
  type SpendMeterView,
  type SpendPeriod,
  type SpendStatus,
  type SpendView,
} from '@monsters/shared';
import type { RawResponse } from '../transport.ts';
import { tr } from './lang.ts';

/*
 * `/api/settings/spend` of the mock core (D-070): what the team spent today
 * and this month, the caps of the team and of each monster. `charge` spends
 * (a request with "tetto" or "spesa" in the chat of the mock does it), and
 * logs the 80% warning and the stop like the core.
 */

const fail = (status: number, error: string, message?: string): RawResponse => ({
  status,
  body: { error, ...(message ? { message } : {}) },
});

export class MockSpend {
  private dailyEur: number | null = SPEND_DEFAULT_DAILY_EUR;
  private monthlyEur: number | null = SPEND_DEFAULT_MONTHLY_EUR;
  private usdToEur = USD_TO_EUR_DEFAULT;
  private caps: Record<string, SpendAgentCaps> = {};
  /** Euros by agent. */
  private readonly day = new Map<string, number>();
  private readonly month = new Map<string, number>();
  private readonly alerts = new Set<string>();
  private readonly agents: () => AgentSummary[];
  private readonly log: (event: EventInput) => void;

  constructor(options: {
    agents: () => AgentSummary[];
    log: (event: EventInput) => void;
    demo: boolean;
  }) {
    this.agents = options.agents;
    this.log = options.log;
    if (options.demo) {
      // A little spent with a paid model by the researcher, the rest is free.
      this.day.set('rhea', 0.42);
      this.month.set('rhea', 6.8);
      this.month.set('dione', 1.15);
    }
  }

  private total(map: Map<string, number>, agent?: string): number {
    if (agent) return map.get(agent) ?? 0;
    return [...map.values()].reduce((s, v) => s + v, 0);
  }

  private cap(period: SpendPeriod, agent?: string): number | null {
    if (!agent) return period === 'day' ? this.dailyEur : this.monthlyEur;
    return (period === 'day' ? this.caps[agent]?.dailyEur : this.caps[agent]?.monthlyEur) ?? null;
  }

  private meter(period: SpendPeriod, agent?: string): SpendMeterView {
    const spentEur = this.total(period === 'day' ? this.day : this.month, agent);
    const capEur = this.cap(period, agent);
    return { spentEur, capEur, ratio: capEur ? spentEur / capEur : null };
  }

  private status(meters: SpendMeterView[]): SpendStatus {
    const top = Math.max(0, ...meters.map((m) => m.ratio ?? 0));
    return top >= 1 ? 'stopped' : top >= SPEND_WARN_AT ? 'warning' : 'ok';
  }

  /** Test hook: a monster whose chain has a direct key priced by OpenRouter's list (D-114). */
  private readonly estimatedBy = new Map<string, string>();
  estimate(agent: string, label: string): void {
    this.estimatedBy.set(agent, label);
  }

  /** In the mock the monsters on OpenRouter free do not spend; Rhea, Dione and Calypso have a paid model. */
  private paid(id: string): boolean {
    return id === 'rhea' || id === 'dione' || id === 'calypso';
  }

  view(): SpendView {
    const day = this.meter('day');
    const month = this.meter('month');
    const now = new Date();
    const dayFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const monthFrom = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return {
      usdToEur: this.usdToEur,
      warnAt: SPEND_WARN_AT,
      dayFrom,
      monthFrom,
      day,
      month,
      status: this.status([day, month]),
      agents: this.agents().map((a) => {
        const aDay = this.meter('day', a.id);
        const aMonth = this.meter('month', a.id);
        return {
          id: a.id,
          name: a.name,
          paid: this.paid(a.id),
          caps: this.caps[a.id] ?? {},
          day: aDay,
          month: aMonth,
          status: this.paid(a.id) ? this.status([day, month, aDay, aMonth]) : 'ok',
          ...(this.estimatedBy.has(a.id) ? { estimated: [this.estimatedBy.get(a.id)!] } : {}),
        };
      }),
      free: { requests: 214 },
      subscriptions: [
        {
          provider: 'claude-agent',
          label: tr('Claude subscription', 'Abbonamento Claude'),
          requests: 38,
          tokens: 412_000,
        },
      ],
      unpriced: [],
      ...(this.estimatedBy.size > 0
        ? {
            estimated: [...new Set(this.estimatedBy.values())].map((label) => ({
              provider: label.toLowerCase(),
              label,
            })),
          }
        : {}),
    };
  }

  /** Why a monster may not spend now, or null. */
  stopReason(agent: string): string | null {
    if (!this.paid(agent)) return null;
    for (const period of ['day', 'month'] as const) {
      for (const who of [undefined, agent]) {
        const m = this.meter(period, who);
        if (m.capEur !== null && m.spentEur >= m.capEur) {
          const name = who ? (this.agents().find((a) => a.id === who)?.name ?? who) : null;
          return tr(
            `${name ? `${name}’s` : 'the squad’s'} spending cap ${period === 'day' ? 'for today' : 'for this month'} was reached`,
            `raggiunto il tetto di spesa${name ? ` di ${name}` : ' della squadra'} ${period === 'day' ? 'di oggi' : 'di questo mese'}`,
          );
        }
      }
    }
    return null;
  }

  /** Spends `eur` for `agent` in the run, with the warning and the stop. */
  charge(agent: string, eur: number, runId: string | null): void {
    this.day.set(agent, (this.day.get(agent) ?? 0) + eur);
    this.month.set(agent, (this.month.get(agent) ?? 0) + eur);
    for (const period of ['day', 'month'] as const) {
      const m = this.meter(period);
      if (!m.capEur || m.ratio === null) continue;
      const action = m.ratio >= 1 ? 'stopped' : m.ratio >= SPEND_WARN_AT ? 'warning' : null;
      if (!action) continue;
      const key = `${period}:${action}`;
      if (this.alerts.has(key)) continue;
      this.alerts.add(key);
      if (action === 'stopped') this.alerts.add(`${period}:warning`);
      this.log({
        agent: 'system',
        runId,
        type: 'spend',
        data: {
          action,
          scope: 'team',
          period,
          spentEur: Math.round(m.spentEur * 100) / 100,
          capEur: m.capEur,
          subject: agent,
          message: spendSentence({
            action,
            scopeName: null,
            period,
            spentEur: m.spentEur,
            capEur: m.capEur,
          }),
        },
      });
    }
  }

  handle(method: string, path: string, body: unknown): RawResponse | null {
    if (path !== '/api/settings/spend') return null;
    if (method === 'GET') return { status: 200, body: this.view() };
    if (method !== 'PUT') return fail(405, 'method_not_allowed');
    const p = SpendUpdateSchema.safeParse(body);
    if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
    const u = p.data;
    const ids = new Set(this.agents().map((a) => a.id));
    for (const id of Object.keys(u.agents ?? {})) {
      if (!ids.has(id))
        return fail(
          404,
          'unknown_agent',
          tr(
            `There’s no monster “${id}” in the squad.`,
            `Non c’è nessun mostro “${id}” nella squadra.`,
          ),
        );
    }
    if (u.dailyEur !== undefined) this.dailyEur = u.dailyEur;
    if (u.monthlyEur !== undefined) this.monthlyEur = u.monthlyEur;
    if (u.usdToEur !== undefined) this.usdToEur = u.usdToEur;
    for (const [id, caps] of Object.entries(u.agents ?? {})) {
      if (caps === null) delete this.caps[id];
      else {
        const merged = { ...this.caps[id], ...caps };
        const clean: SpendAgentCaps = {};
        if (merged.dailyEur != null) clean.dailyEur = merged.dailyEur;
        if (merged.monthlyEur != null) clean.monthlyEur = merged.monthlyEur;
        if (Object.keys(clean).length) this.caps[id] = clean;
        else delete this.caps[id];
      }
    }
    // A cap raised above what was spent warns and stops again.
    for (const key of [...this.alerts]) {
      const [period, action] = key.split(':') as [SpendPeriod, string];
      const r = this.meter(period).ratio ?? 0;
      if (r < (action === 'stopped' ? 1 : SPEND_WARN_AT)) this.alerts.delete(key);
    }
    return { status: 200, body: this.view() };
  }
}
