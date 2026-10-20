import {
  conversationUsage,
  type AgentUsageView,
  type PlanLimitsView,
  type EventType,
  type LogEvent,
  type UsageCostClass,
} from '@monsters/shared';
import type { EventLog } from '../log/event-log.ts';
import type { ModelWindows } from '../providers/windows.ts';
import { conversationStart } from './conversation.ts';
import type { SpendMeter } from './spend.ts';

/*
 * The Consumi panel of a monster (D-075, `GET /api/agents/:id/usage`): its
 * current conversation read from the log (since the latest "Nuova
 * conversazione" that applies to it), summed by `conversationUsage` of the
 * shared package (the UI's mock uses the same), with today and this month
 * from the spending meter.
 *
 * Cheap to read during a run (D-079): only the monster's own runs are read
 * (indexed on agent, type and id, then by run), at most the latest
 * `USAGE_MAX_RUNS`; between two reads the events stay in memory and only the
 * newer ones are read (the newest id of the log is the mark), and the sums are
 * kept until something new arrives. A new conversation reads again.
 *
 * The archive of the log (log/archive.ts) takes the usage and the tool calls older than its
 * cut out of the log: a conversation that started before the latest cut says so
 * (`archivedBefore`), its sums cover only what came after (review of 19/10, n. 11).
 */

// Runs belong to the monster that started them (`run started` carries it): no messages needed.
const TYPES: EventType[] = [
  'run',
  'provider_usage',
  'tool_call',
  'decision',
  'conversation_summary',
];
/** The panel sums the latest runs of the conversation: at most these many… */
export const USAGE_MAX_RUNS = 300;
/** …and at most these many events of theirs (a very long conversation keeps its newest end). */
export const USAGE_MAX_EVENTS = 20_000;
/** Monsters whose events are kept in memory (the panel looks at one or two at a time). */
const MAX_CACHED_AGENTS = 32;

export interface AgentUsageOptions {
  log: EventLog;
  spend: SpendMeter;
  windows: ModelWindows;
  classify: (provider: string, model: string, priced: boolean) => UsageCostClass;
  /** The monster works on a subscription (its chain starts with a harness or ChatGPT). */
  subscription: (agentId: string) => boolean;
  /** The limits of the plan the monster works on (D-111), as they read now. */
  planLimits?: (agentId: string) => PlanLimitsView | null;
}

/** What is kept of one monster's conversation between two reads. */
interface Cached {
  /** The conversation it belongs to (`new_conversation` id, or null). */
  start: string | null;
  /** The newest event of the log when it was read: later events sort after it. */
  high: string | null;
  /** The monster's runs in the window, oldest first. */
  runs: string[];
  /** Their events of `TYPES`, oldest first. */
  events: LogEvent[];
  /** The sums of `events`, until a new event arrives. */
  sums?: Pick<AgentUsageView, 'context' | 'session' | 'summary'>;
}

const byId = (a: LogEvent, b: LogEvent) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class AgentUsage {
  readonly #o: AgentUsageOptions;
  /** Per monster, the most recently read last. */
  readonly #cache = new Map<string, Cached>();

  constructor(options: AgentUsageOptions) {
    this.#o = options;
  }

  /**
   * `chain`: the monster's models now. When the latest step's model is not in
   * it any more (the user changed it), the share is against the window of the
   * first one (D-086): otherwise the key would keep the old model's
   * percentage until the next step. A fallback or a tier stays in the chain.
   */
  async view(
    agentId: string,
    chain?: readonly { provider: string; model: string }[],
  ): Promise<AgentUsageView> {
    const { log } = this.#o;
    const start = conversationStart(log, agentId);
    const spend = this.#o.spend.view();
    const c = this.#read(agentId, start);
    c.sums ??= conversationUsage({
      agentId,
      events: c.events,
      usdToEur: spend.usdToEur,
      classify: this.#o.classify,
      windowOf: (p, m) => this.#o.windows.get(p, m),
    });
    const { session } = c.sums;
    // A copy: a window resolved now must not stick to the cached sums.
    let context = c.sums.context ? { ...c.sums.context } : null;
    const current = chain?.[0];
    if (
      context &&
      current &&
      !chain.some((m) => m.provider === context!.provider && m.model === context!.model)
    ) {
      context = {
        ...context,
        provider: current.provider,
        model: current.model,
        window: (await this.#o.windows.resolve(current.provider, current.model)) ?? null,
        measuredWith: { provider: context.provider, model: context.model },
      };
    }
    if (context && context.window === null) {
      context.window = (await this.#o.windows.resolve(context.provider, context.model)) ?? null;
    }
    const since = start ? (log.get(start)?.ts ?? null) : null;
    const archivedBefore = this.#archivedBefore(since);
    const mine = spend.agents.find((a) => a.id === agentId);
    const empty = { spentEur: 0, capEur: null, ratio: null };
    return {
      agentId,
      since,
      subscription: this.#o.subscription(agentId),
      context,
      summary: c.sums.summary ?? null,
      session,
      planLimits: this.#o.planLimits?.(agentId) ?? null,
      ...(archivedBefore !== null ? { archivedBefore } : {}),
      spend: {
        usdToEur: spend.usdToEur,
        warnAt: spend.warnAt,
        day: spend.day,
        month: spend.month,
        agent: {
          paid: mine?.paid ?? false,
          day: mine?.day ?? empty,
          month: mine?.month ?? empty,
        },
      },
    };
  }

  /** The cut of the latest archive, when the conversation (since `since`) started before it. */
  #archivedBefore(since: number | null): number | null {
    const [note] = this.#o.log.query({
      type: 'log_archive',
      agent: 'system',
      order: 'desc',
      limit: 1,
    });
    if (note?.type !== 'log_archive' || note.data.events === 0) return null;
    const cut = note.data.before;
    return since === null || since < cut ? cut : null;
  }

  /**
   * The monster's runs in the conversation and their events: from memory when
   * nothing was logged since the last read, extended with the newer events
   * otherwise, read again when the conversation started over.
   */
  #read(agentId: string, start: string | null): Cached {
    const { log } = this.#o;
    const high = log.lastId();
    const old = this.#cache.get(agentId);
    if (old && old.start === start && old.high === high) return old;
    let c: Cached;
    if (!old || old.start !== start) {
      const runs = log.runsStartedBy(agentId, { after: start, limit: USAGE_MAX_RUNS }).reverse();
      c = { start, high, runs, events: log.runEvents(runs, TYPES, start) };
    } else {
      const fresh = log
        .runsStartedBy(agentId, { after: old.high ?? start, limit: USAGE_MAX_RUNS })
        .reverse()
        .filter((r) => !old.runs.includes(r));
      // A new run is read whole (its events normally all come after the mark anyway).
      const added = [
        ...log.runEvents(old.runs, TYPES, old.high ?? start),
        ...log.runEvents(fresh, TYPES, start),
      ];
      const events = added.length > 0 ? [...old.events, ...added] : old.events;
      if (added.length > 0 && !events.every((e, i) => i === 0 || events[i - 1]!.id < e.id)) {
        events.sort(byId);
      }
      c = {
        start,
        high,
        runs: fresh.length > 0 ? [...old.runs, ...fresh] : old.runs,
        events,
        ...(added.length === 0 && old.sums ? { sums: old.sums } : {}),
      };
    }
    if (c.runs.length > USAGE_MAX_RUNS) {
      c.runs = c.runs.slice(-USAGE_MAX_RUNS);
      const kept = new Set(c.runs);
      c.events = c.events.filter((e) => e.runId !== null && kept.has(e.runId));
    }
    if (c.events.length > USAGE_MAX_EVENTS) c.events = c.events.slice(-USAGE_MAX_EVENTS);
    this.#cache.delete(agentId);
    this.#cache.set(agentId, c);
    if (this.#cache.size > MAX_CACHED_AGENTS) {
      const oldest = this.#cache.keys().next().value;
      if (oldest !== undefined) this.#cache.delete(oldest);
    }
    return c;
  }
}
