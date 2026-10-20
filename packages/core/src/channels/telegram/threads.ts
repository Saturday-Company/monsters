import type { EventLog } from '../../log/event-log.ts';

/*
 * Which runs work for the Telegram chat of a dedicated bot (D-107), from the
 * `thread` of their `run` started events: the monster's chat in the app
 * leaves them out, and each chat's runs are the history of that chat. One
 * index per log, brought up to date on every lookup with the events written
 * since (an indexed query, usually empty), like the runs of the automations.
 */

interface Index {
  runs: Map<string, string>;
  /** The runs of each thread, oldest first. */
  threads: Map<string, string[]>;
  last: string | undefined;
}

const PAGE = 1000;
const indexes = new WeakMap<EventLog, Index>();

function refresh(log: EventLog): Index {
  let index = indexes.get(log);
  if (!index) indexes.set(log, (index = { runs: new Map(), threads: new Map(), last: undefined }));
  for (;;) {
    const page = log.query({ type: 'run', after: index.last, limit: PAGE });
    for (const e of page) {
      if (e.type !== 'run' || !e.runId || e.data.status !== 'started' || !e.data.thread) continue;
      index.runs.set(e.runId, e.data.thread);
      const runs = index.threads.get(e.data.thread) ?? [];
      if (!runs.includes(e.runId)) runs.push(e.runId);
      index.threads.set(e.data.thread, runs);
    }
    if (page.length > 0) index.last = page.at(-1)!.id;
    if (page.length < PAGE) return index;
  }
}

/** The thread a run works for, or null for the runs of the app's chat. */
export function threadOfRun(log: EventLog, runId: string | null | undefined): string | null {
  if (!runId) return null;
  return refresh(log).runs.get(runId) ?? null;
}

/** The thread of a group or supergroup (`telegram:<bot>:<chat>`, the chat's id below zero). */
export function isGroupThread(thread: string | null | undefined): boolean {
  return thread !== null && thread !== undefined && /^telegram:\d+:-\d+$/.test(thread);
}

/** A predicate for many lookups in a row (one refresh). */
export function threadRuns(log: EventLog): (runId: string | null | undefined) => boolean {
  const { runs } = refresh(log);
  return (runId) => runId !== null && runId !== undefined && runs.has(runId);
}

/** The runs of a thread, oldest first (empty when unknown). */
export function runsOfThread(log: EventLog, thread: string): string[] {
  return [...(refresh(log).threads.get(thread) ?? [])];
}
