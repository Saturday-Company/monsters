import type { EventLog } from '../log/event-log.ts';

/*
 * Which runs of the core belong to an automation (D-094), from the
 * `automation_run_started` events of the log: the chat of a monster leaves
 * them out, and an answer to one of their questions goes on in the
 * automation, not in the chat. One index per log, brought up to date at a
 * lookup with the events written since, only when one was written (the query
 * by type scans every `automation_run_started` of the log: thousands after a
 * year of giri, M9 of 18/10).
 */

export interface AutomationRunRef {
  automationId: string;
  /** The first run of the giro. */
  giro: string;
}

interface Index {
  runs: Map<string, AutomationRunRef>;
  /** The runs of each giro, oldest first. */
  giri: Map<string, string[]>;
  last: string | undefined;
  /** An `automation_run_started` was logged since the last lookup. */
  dirty: boolean;
}

const PAGE = 1000;
const indexes = new WeakMap<EventLog, Index>();

function refresh(log: EventLog): Index {
  let index = indexes.get(log);
  if (!index) {
    const created: Index = { runs: new Map(), giri: new Map(), last: undefined, dirty: true };
    // At the insert, not at the delivery: an event written inside a listener is delivered
    // after that listener, and the code it runs may look the run up before (review of 19/10).
    log.onStored((type) => {
      if (type === 'automation_run_started') created.dirty = true;
    });
    indexes.set(log, (index = created));
  }
  if (!index.dirty) return index;
  index.dirty = false;
  for (;;) {
    const page = log.query({ type: 'automation_run_started', after: index.last, limit: PAGE });
    for (const e of page) {
      if (e.type !== 'automation_run_started' || !e.runId) continue;
      index.runs.set(e.runId, { automationId: e.data.automationId, giro: e.data.giro });
      const runs = index.giri.get(e.data.giro) ?? [];
      if (!runs.includes(e.runId)) runs.push(e.runId);
      index.giri.set(e.data.giro, runs);
    }
    if (page.length > 0) index.last = page.at(-1)!.id;
    if (page.length < PAGE) return index;
  }
}

/** The automation a run of the core belongs to, or null for the runs of the chat. */
export function automationRunOf(
  log: EventLog,
  runId: string | null | undefined,
): AutomationRunRef | null {
  if (!runId) return null;
  return refresh(log).runs.get(runId) ?? null;
}

/** A predicate for many lookups in a row (one refresh). */
export function automationRuns(log: EventLog): (runId: string | null | undefined) => boolean {
  const { runs } = refresh(log);
  return (runId) => runId !== null && runId !== undefined && runs.has(runId);
}

/** The runs of the core of a giro, oldest first (empty when unknown). */
export function runsOfGiro(log: EventLog, giro: string): string[] {
  return [...(refresh(log).giri.get(giro) ?? [])];
}
