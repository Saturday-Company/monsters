import {
  EventInputSchema,
  monotonicUlidFactory,
  type EventInput,
  type EventType,
  type LogEvent,
  type UlidFactory,
} from '@monsters/shared';
import type { Db, SqlValue } from '../db/sqlite.ts';
import { createRedactor, type Redactor } from './redact.ts';

export interface EventQuery {
  agent?: string | string[] | undefined;
  type?: EventType | EventType[] | undefined;
  runId?: string | undefined;
  /** Inclusive lower bound on `ts` (ms). */
  since?: number | undefined;
  /** Exclusive upper bound on `ts` (ms). */
  until?: number | undefined;
  /** Cursor: only events with id greater than this. */
  after?: string | undefined;
  /** Cursor: only events with id lower than this. */
  before?: string | undefined;
  /** Default 200, max 1000. */
  limit?: number | undefined;
  /** Default `asc` (oldest first). */
  order?: 'asc' | 'desc' | undefined;
}

export type EventListener = (event: LogEvent) => void;

export interface EventLogOptions {
  redactor?: Redactor;
  now?: () => number;
  idFactory?: UlidFactory;
  /** Called when a subscriber throws; subscribers never break `append`. */
  onListenerError?: (err: unknown) => void;
}

interface EventRow {
  id: string;
  ts: number;
  agent: string;
  run_id: string | null;
  parent_id: string | null;
  type: string;
  data: string;
}

export const DEFAULT_QUERY_LIMIT = 200;
export const MAX_QUERY_LIMIT = 1000;
/** Run ids per `IN (…)` of the run queries (well under SQLite's parameter limit). */
const RUN_CHUNK = 400;

function rowToEvent(row: EventRow): LogEvent {
  return {
    id: row.id,
    ts: row.ts,
    agent: row.agent,
    runId: row.run_id,
    parentId: row.parent_id,
    type: row.type,
    data: JSON.parse(row.data) as unknown,
  } as LogEvent;
}

function toList<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** One served model request, as `providerUsage` reads it back. */
export interface ProviderUsageEntry {
  ts: number;
  /** Fingerprint of the key that served it; absent in events written before D-019 M2.0. */
  keyId?: string;
  /** The model asked for (the chain's link when it differs from the one that answered). */
  model?: string;
}

/**
 * Append-only event log (ARCHITECTURE §5.1): audit trail, UI stream and resume
 * source. Events are validated, redacted, persisted and only then emitted.
 */
/** Requests of one agent to one model in a period (`usageTotals`). */
export interface UsageTotal {
  agent: string;
  provider: string;
  model: string;
  requests: number;
  priced: number;
  costUsd: number;
  /** Fresh input plus output: the cache reads are in `cachedTokens` (D-169). */
  tokens: number;
  /** Input tokens read from the provider's prompt cache. */
  cachedTokens: number;
}

/**
 * Dollars of one agent in a period, by the project its runs worked for
 * (`projectUsageTotals`, F-B13): `project` null outside any project;
 * `legacy` 1 for older events, written before the project was recorded.
 */
export interface ProjectUsageTotal {
  agent: string;
  project: string | null;
  legacy: number;
  costUsd: number;
}

export class EventLog {
  readonly #db: Db;
  readonly #redactor: Redactor;
  readonly #now: () => number;
  readonly #nextId: UlidFactory;
  readonly #listeners = new Set<EventListener>();
  /** Told of every event as soon as it is stored, before any delivery (`onStored`). */
  readonly #stored = new Set<(type: EventType) => void>();
  readonly #onListenerError: (err: unknown) => void;
  /** Events stored but not yet delivered to every subscriber, oldest first. */
  readonly #outbox: LogEvent[] = [];
  #delivering = false;

  constructor(db: Db, options: EventLogOptions = {}) {
    this.#db = db;
    this.#redactor = options.redactor ?? createRedactor();
    this.#now = options.now ?? Date.now;
    this.#nextId = options.idFactory ?? monotonicUlidFactory();
    this.#onListenerError =
      options.onListenerError ??
      ((err) => {
        console.error('[monsters] event listener failed:', err);
      });
  }

  /** The redactor used before writing: register loaded secrets on it. */
  get redactor(): Redactor {
    return this.#redactor;
  }

  /** Validates, redacts, stores and broadcasts an event. Returns the stored event. */
  append<T extends EventType>(input: EventInput<T>): LogEvent<T> {
    const parsed = EventInputSchema.parse(input);
    const ts = this.#now();
    const event = {
      id: this.#nextId(ts),
      ts,
      agent: parsed.agent,
      runId: parsed.runId ?? null,
      parentId: parsed.parentId ?? null,
      type: parsed.type,
      data: this.#redactor.redact(parsed.data),
    } as LogEvent;

    this.#db.run(
      'INSERT INTO events (id, ts, agent, run_id, parent_id, type, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
      event.id,
      event.ts,
      event.agent,
      event.runId,
      event.parentId,
      event.type,
      JSON.stringify(event.data),
    );

    for (const hook of this.#stored) hook(event.type);
    this.#outbox.push(event);
    this.#deliver();
    return event as LogEvent<T>;
  }

  /**
   * Delivers queued events in id order. An event appended by a subscriber
   * while another event is being delivered waits for that delivery to finish:
   * every subscriber sees the events in the order they were stored.
   */
  #deliver(): void {
    if (this.#delivering) return;
    this.#delivering = true;
    try {
      for (let event = this.#outbox.shift(); event; event = this.#outbox.shift()) {
        for (const listener of this.#listeners) {
          try {
            listener(event);
          } catch (err) {
            this.#onListenerError(err);
          }
        }
      }
    } finally {
      this.#delivering = false;
    }
  }

  get(id: string): LogEvent | undefined {
    const row = this.#db.get<EventRow>('SELECT * FROM events WHERE id = ?', id);
    return row ? rowToEvent(row) : undefined;
  }

  query(filter: EventQuery = {}): LogEvent[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    const agents = toList(filter.agent);
    if (agents.length > 0) {
      where.push(`agent IN (${agents.map(() => '?').join(', ')})`);
      params.push(...agents);
    }
    const types = toList(filter.type);
    if (types.length > 0) {
      where.push(`type IN (${types.map(() => '?').join(', ')})`);
      params.push(...types);
    }
    if (filter.runId !== undefined) {
      where.push('run_id = ?');
      params.push(filter.runId);
    }
    if (filter.since !== undefined) {
      where.push('ts >= ?');
      params.push(filter.since);
    }
    if (filter.until !== undefined) {
      where.push('ts < ?');
      params.push(filter.until);
    }
    if (filter.after !== undefined) {
      where.push('id > ?');
      params.push(filter.after);
    }
    if (filter.before !== undefined) {
      where.push('id < ?');
      params.push(filter.before);
    }
    const limit = Math.min(Math.max(1, filter.limit ?? DEFAULT_QUERY_LIMIT), MAX_QUERY_LIMIT);
    const order = filter.order === 'desc' ? 'DESC' : 'ASC';
    const sql = `SELECT * FROM events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id ${order} LIMIT ?`;
    params.push(limit);
    return this.#db.all<EventRow>(sql, ...params).map(rowToEvent);
  }

  /** The newest event id, or null on an empty log (a high-water mark: later events sort after it). */
  lastId(): string | null {
    return this.#db.get<{ id: string | null }>('SELECT MAX(id) AS id FROM events')?.id ?? null;
  }

  /**
   * The runs `agent` started after the event `after`, newest first, at most
   * `limit`: only runs whose first `started` event is the agent's and comes
   * after `after` (a sub-agent's start in someone else's run does not count).
   * Indexed on (agent, type, id) and (run_id, id): the cost follows the
   * agent's runs, not the size of the log.
   */
  runsStartedBy(agent: string, opts: { after?: string | null; limit: number }): string[] {
    const after = opts.after ?? '';
    const candidates = this.#db
      .all<{ run_id: string }>(
        `SELECT run_id, MIN(id) AS first FROM events
         WHERE agent = ? AND type = 'run' AND run_id IS NOT NULL AND id > ?
           AND json_extract(data, '$.status') = 'started'
         GROUP BY run_id ORDER BY first DESC LIMIT ?`,
        agent,
        after,
        Math.max(1, opts.limit),
      )
      .map((r) => r.run_id);
    const owned = new Set<string>();
    for (let i = 0; i < candidates.length; i += RUN_CHUNK) {
      const chunk = candidates.slice(i, i + RUN_CHUNK);
      const rows = this.#db.all<{ run_id: string; agent: string; first: string }>(
        `SELECT run_id, agent, MIN(id) AS first FROM events INDEXED BY events_run
         WHERE run_id IN (${chunk.map(() => '?').join(', ')}) AND type = 'run'
           AND json_extract(data, '$.status') = 'started'
         GROUP BY run_id`,
        ...chunk,
      );
      for (const r of rows) if (r.agent === agent && r.first > after) owned.add(r.run_id);
    }
    return candidates.filter((r) => owned.has(r));
  }

  /** Events of the given runs and types after the event `after`, oldest first (not capped). */
  runEvents(
    runIds: readonly string[],
    types: readonly EventType[],
    after?: string | null,
  ): LogEvent[] {
    const out: LogEvent[] = [];
    for (let i = 0; i < runIds.length; i += RUN_CHUNK) {
      const chunk = runIds.slice(i, i + RUN_CHUNK);
      out.push(
        ...this.#db
          .all<EventRow>(
            `SELECT * FROM events INDEXED BY events_run
             WHERE run_id IN (${chunk.map(() => '?').join(', ')})
               AND type IN (${types.map(() => '?').join(', ')}) AND id > ?
             ORDER BY id`,
            ...chunk,
            ...types,
            after ?? '',
          )
          .map(rowToEvent),
      );
    }
    return runIds.length > RUN_CHUNK ? out.sort((a, b) => (a.id < b.id ? -1 : 1)) : out;
  }

  /** Runs with a `started` event and no final one (left open by a core that stopped abruptly). */
  openRuns(): { runId: string; agent: string }[] {
    return this.#db
      .all<{ run_id: string; agent: string }>(
        `SELECT run_id, MIN(agent) AS agent FROM events
         WHERE type = 'run' AND run_id IS NOT NULL
         GROUP BY run_id
         HAVING SUM(json_extract(data, '$.status') <> 'started') = 0
         ORDER BY MIN(id)`,
      )
      .map((r) => ({ runId: r.run_id, agent: r.agent }));
  }

  /**
   * The `provider_usage` events since `since` (inclusive), by provider: one per
   * model request that was served, with the fingerprint of the key when logged.
   * Not capped like `query`.
   */
  providerUsage(since: number): Map<string, ProviderUsageEntry[]> {
    const rows = this.#db.all<{
      provider: string | null;
      key_id: string | null;
      model: string | null;
      ts: number;
    }>(
      `SELECT json_extract(data, '$.provider') AS provider,
              json_extract(data, '$.keyId') AS key_id,
              COALESCE(json_extract(data, '$.requestedModel'), json_extract(data, '$.model')) AS model,
              ts FROM events
       WHERE type = 'provider_usage' AND ts >= ? ORDER BY ts`,
      since,
    );
    const out = new Map<string, ProviderUsageEntry[]>();
    for (const r of rows) {
      if (typeof r.provider !== 'string') continue;
      const entry: ProviderUsageEntry = {
        ts: r.ts,
        ...(typeof r.key_id === 'string' ? { keyId: r.key_id } : {}),
        ...(typeof r.model === 'string' ? { model: r.model } : {}),
      };
      const list = out.get(r.provider);
      if (list) list.push(entry);
      else out.set(r.provider, [entry]);
    }
    return out;
  }

  /**
   * Model requests since `since` (inclusive), summed by agent, provider and
   * model: the spending caps (D-070). `priced` counts the requests whose
   * provider reported a cost.
   */
  usageTotals(since: number): UsageTotal[] {
    return this.#db.all<UsageTotal>(
      `SELECT agent,
              json_extract(data, '$.provider') AS provider,
              json_extract(data, '$.model') AS model,
              COUNT(*) AS requests,
              SUM(json_extract(data, '$.costUsd') IS NOT NULL) AS priced,
              COALESCE(SUM(json_extract(data, '$.costUsd')), 0) AS costUsd,
              COALESCE(SUM(MAX(COALESCE(json_extract(data, '$.inputTokens'), 0)
                - COALESCE(json_extract(data, '$.cachedInputTokens'), 0), 0)), 0)
                + COALESCE(SUM(json_extract(data, '$.outputTokens')), 0) AS tokens,
              COALESCE(SUM(json_extract(data, '$.cachedInputTokens')), 0) AS cachedTokens
       FROM events WHERE type = 'provider_usage' AND ts >= ?
       GROUP BY agent, provider, model`,
      since,
    );
  }

  projectUsageTotals(since: number): ProjectUsageTotal[] {
    return this.#db.all<ProjectUsageTotal>(
      `SELECT agent,
              json_extract(data, '$.project') AS project,
              json_type(data, '$.project') IS NULL AS legacy,
              COALESCE(SUM(json_extract(data, '$.costUsd')), 0) AS costUsd
       FROM events WHERE type = 'provider_usage' AND ts >= ?
       GROUP BY agent, legacy, project`,
      since,
    );
  }

  /** Subscribes to new events (in-process). Returns the unsubscribe function. */
  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Called with the type of each event right when it is stored, even when it is appended by a
   * subscriber and waits to be delivered: for indexes that must know at once that the log
   * grew (automations/run-index.ts). It must only note it: no append, no query.
   */
  onStored(hook: (type: EventType) => void): () => void {
    this.#stored.add(hook);
    return () => {
      this.#stored.delete(hook);
    };
  }

  get subscriberCount(): number {
    return this.#listeners.size;
  }
}
