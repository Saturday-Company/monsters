import type { LogEvent } from './events.ts';

/*
 * The work items of a monster (D-1xx-idle): its runs and the tasks delegated
 * to it. A monster is at work only while one of them is open; the core
 * (`TeamService`) and the app (`applyLive`) follow the same items with the
 * same keys, so the app never shows a monster at work that the core sees idle,
 * and the core's snapshot (`AgentSummary.work`) can seed the app's state.
 */

/** A work item opened or closed by an event. */
export interface WorkChange {
  /** Whose item it is: the run's agent, or the monster that got the task. */
  agent: string;
  key: string;
  /** The run the item belongs to: it ends with it at the latest. */
  runId: string | null;
  open: boolean;
  /** How it ended (closing changes only). */
  status?: 'completed' | 'waiting_user' | 'failed' | 'aborted';
}

/**
 * The item a `run` or `delegation` event opens or closes, or null. A task is
 * keyed by the `delegate` call that opened it (its `parentId`, the same on its
 * start and end), or by its goal when the call is unknown.
 */
export function workChangeOf(e: LogEvent): WorkChange | null {
  if (e.type === 'run') {
    if (!e.runId) return null;
    const status = e.data.status;
    return {
      agent: e.agent,
      key: `run:${e.runId}`,
      runId: e.runId,
      open: status === 'started',
      ...(status !== 'started' ? { status } : {}),
    };
  }
  if (e.type === 'delegation') {
    const status = e.data.status;
    return {
      agent: e.data.to,
      key: `task:${e.runId ?? ''}:${e.parentId ?? `~${e.data.goal}`}:${e.data.to}`,
      runId: e.runId,
      open: status === 'started',
      ...(status !== 'started' ? { status } : {}),
    };
  }
  return null;
}

/** True when `key` belongs to run `runId`: the run itself or a task given within it. */
export function workOfRun(key: string, runId: string): boolean {
  return key === `run:${runId}` || key.startsWith(`task:${runId}:`);
}
