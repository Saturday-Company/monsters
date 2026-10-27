import type { LogEvent } from '@monsters/shared';

/*
 * "Will read it after this step" (docs/design.md, "The chat"): a message written while the
 * monster works joins its run (core `Dispatcher.send`) and waits in the run's inbox; the run
 * takes the inbox at the start of its next model step. The log has no event for that moment, so
 * the chat reads it from the steps: a model step that was running when the message came ends
 * (its `provider_usage`), and the next thing the monster does (a tool call, words, another
 * step's usage) belongs to a step that has read it.
 */

/** How many of the latest events are read: a run older than this has long taken its inbox. */
const LOOKBACK = 800;

/**
 * The ids of the user's messages in `agentId`'s chat (`orchestrator`: the monster that gets
 * the messages with no addressee) that joined a run still going and have not been read yet.
 */
export function queuedMessages(
  events: readonly LogEvent[],
  agentId: string,
  orchestrator: string,
): Set<string> {
  const out = new Set<string>();
  /** The runs going: who works in them. */
  const open = new Map<string, string>();
  /** The messages waiting in each run, and whether the step that was running has ended. */
  const waiting = new Map<string, { id: string; stepEnded: boolean }[]>();
  for (let i = Math.max(0, events.length - LOOKBACK); i < events.length; i++) {
    const e = events[i]!;
    const runId = e.runId;
    if (!runId) continue;
    switch (e.type) {
      case 'run':
        if (e.data.status === 'started') open.set(runId, e.agent);
        else {
          // Over: the leftovers go to a new run of the chat, which is their own turn.
          open.delete(runId);
          waiting.delete(runId);
        }
        break;
      case 'message': {
        const d = e.data;
        if (d.role === 'user') {
          const mine = (d.to ?? orchestrator) === agentId;
          const typed = !d.from && !d.telegram && !d.resumeOf && d.channel !== 'automation';
          // Only a message that joined a run already going is queued; the first of a run starts it.
          if (mine && typed && open.get(runId) === agentId) {
            const list = waiting.get(runId) ?? [];
            list.push({ id: e.id, stepEnded: false });
            waiting.set(runId, list);
          }
          break;
        }
        if (e.agent === open.get(runId)) takeRead(waiting.get(runId));
        break;
      }
      case 'tool_call':
        if (e.agent === open.get(runId)) takeRead(waiting.get(runId));
        break;
      case 'provider_usage': {
        if (e.agent !== open.get(runId)) break;
        const list = waiting.get(runId);
        if (!list) break;
        // The step under way ends: the message is not read yet; one more step and it is.
        for (const w of [...list]) {
          if (!w.stepEnded) w.stepEnded = true;
          else list.splice(list.indexOf(w), 1);
        }
        break;
      }
      default:
        break;
    }
  }
  for (const list of waiting.values()) for (const w of list) out.add(w.id);
  return out;
}

/** The monster did something after the step that was running ended: it has read what waited. */
function takeRead(list: { id: string; stepEnded: boolean }[] | undefined): void {
  if (!list) return;
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.stepEnded) list.splice(i, 1);
}
