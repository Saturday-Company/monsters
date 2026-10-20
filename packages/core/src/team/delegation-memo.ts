/*
 * Delegations already completed in a run (D-064, AG-16): a free model that
 * delegates the same goal to the same agent again gets the earlier report,
 * marked `repeated`, instead of a second run of the agent. Only completed
 * delegations count: a failed or partial one may be worth another try.
 */

const memos = new WeakMap<object, Map<string, Record<string, unknown>>>();

/** Agent and goal, normalized: case, punctuation and spaces do not make a new task. */
export function delegationKey(agentId: string, goal: string): string {
  const g = goal
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return `${agentId}|${g}`;
}

export const REPEATED_DELEGATION_NOTE =
  'You already delegated this goal to this agent in this task and it completed: this is its earlier report, ' +
  'nothing was run again. Use it; delegate again only with a different goal (what is missing, what to change).';

/** The report of the same delegation completed earlier in the run, if any. */
export function earlierDelegation(
  run: object,
  agentId: string,
  goal: string,
): Record<string, unknown> | undefined {
  return memos.get(run)?.get(delegationKey(agentId, goal));
}

/** Keeps the report of a completed delegation for the rest of the run. */
export function rememberDelegation(
  run: object,
  agentId: string,
  goal: string,
  report: Record<string, unknown>,
): void {
  if (report.status !== 'completed') return;
  let memo = memos.get(run);
  if (!memo) memos.set(run, (memo = new Map<string, Record<string, unknown>>()));
  memo.set(delegationKey(agentId, goal), report);
}
