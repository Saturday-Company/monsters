import type { LogEvent } from './events.ts';
import { haltedStrings, haltedStringsAll } from './halted.strings.ts';

/*
 * The work Ferma left halfway (D-066, D-072), read from the event log: the
 * core uses it for "Riprendi e continua" (`POST /api/resume` with
 * `continue`), the UI to say in the halt band what is left. Pure functions.
 */

/** A request of the user whose work Ferma stopped: it can start again. */
export interface StoppedRequest {
  runId: string;
  /** The monster the request went to (who owned the run). */
  agent: string;
  /** What the user asked (a resumed request is unwrapped to the original one). */
  text: string;
  /**
   * Work a monster sent (`project_send`, D-098), not the user's words: who sent it and from
   * which run. It starts again as that monster's work, never as a request of the user.
   */
  from?: string;
  fromRun?: string;
}

/** The sender of a monster's message, for a `StoppedRequest`. */
function senderOf(data: { from?: string | undefined; fromRun?: string | undefined }) {
  return data.from ? { from: data.from, ...(data.fromRun ? { fromRun: data.fromRun } : {}) } : {};
}

/** What the latest Ferma left halfway. */
export interface HaltedWork {
  /** Questions closed by the stop, oldest first. */
  questions: { id: string; from: string; runId: string | null }[];
  /** Monsters whose work was stopped, in the order they stopped. */
  agents: string[];
  /** The user's requests behind that work, one per run: what "Riprendi e continua" starts again. */
  requests: StoppedRequest[];
}

/** Longest message of a person (`SendMessageRequestSchema`, the composer). */
export const MESSAGE_MAX_CHARS = 20_000;
/** What the resume phrase adds around a request: a resumed message may be this much longer. */
export const RESUME_EXTRA_CHARS = Math.max(
  ...haltedStringsAll.map((t) => t.resumeOpen.length + t.resumeClose.length),
);

/**
 * What the monster reads for a request Ferma stopped: the whole request, said
 * as such (lines and length kept: a long request must not lose its end, review
 * of 16/10). The UI shortens it only in its own status line. The phrase does
 * not count against the length of a message (D-074: a request of 19,980
 * characters came back with a 400); only a request longer than a message,
 * which the composer never sends, is cut, and the cut is said.
 */
export function resumeText(request: string): string {
  const t = haltedStrings();
  const r = request.trim();
  // The note says where a request longer than a message (from another channel) was cut.
  const body =
    r.length <= MESSAGE_MAX_CHARS
      ? r
      : `${r.slice(0, MESSAGE_MAX_CHARS - t.cutNote.length)}${t.cutNote}`;
  return `${t.resumeOpen}${body}${t.resumeClose}`;
}

/**
 * The request behind a resumed one ("Resume the work I stopped: “x”" → "x"), also when resumed
 * twice and whichever language wrote the phrase (the log keeps the ones of the past).
 */
export function originalRequest(text: string): string {
  let out = text;
  for (;;) {
    const t = haltedStringsAll.find(
      (x) => out.startsWith(x.resumeOpen) && out.endsWith(x.resumeClose),
    );
    if (!t) return out;
    out = out.slice(t.resumeOpen.length, out.length - t.resumeClose.length);
  }
}

/**
 * Questions expired by a global stop and runs aborted by it, from the events
 * logged after that `kill` (a delegated monster works in the run of who asked,
 * D-021, so the run covers its delegates too).
 */
export function stoppedSince(events: readonly LogEvent[]): Omit<HaltedWork, 'requests'> & {
  runs: string[];
} {
  const out = {
    questions: [] as HaltedWork['questions'],
    agents: [] as string[],
    runs: [] as string[],
  };
  const add = (runId: string | null) => {
    if (runId && !out.runs.includes(runId)) out.runs.push(runId);
  };
  for (const e of events) {
    if (e.type === 'question_expired' && e.data.reason === 'kill') {
      out.questions.push({ id: e.data.questionId, from: e.agent, runId: e.runId });
      add(e.runId);
    } else if (e.type === 'run' && e.data.status === 'aborted' && e.agent !== 'system') {
      if (!out.agents.includes(e.agent)) out.agents.push(e.agent);
      add(e.runId);
    }
  }
  return out;
}

/** Who each run belongs to: its `run started`, else the addressee of its first message, else who delegates in it. */
function runOwners(events: readonly LogEvent[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of events) {
    if (!e.runId || out.has(e.runId)) continue;
    if (e.type === 'run' && e.data.status === 'started') out.set(e.runId, e.agent);
    else if (e.type === 'message' && e.data.role === 'user' && e.data.to)
      out.set(e.runId, e.data.to);
    else if (e.type === 'delegation' && e.data.status === 'started') out.set(e.runId, e.data.from);
  }
  return out;
}

/** The first message of the user in each run (its request, unwrapped), in the order of the runs. */
export function requestsOf(
  events: readonly LogEvent[],
  runs: ReadonlySet<string> | readonly string[],
): StoppedRequest[] {
  const wanted = runs instanceof Set ? runs : new Set(runs as readonly string[]);
  if (wanted.size === 0) return [];
  const owners = runOwners(events);
  const seen = new Set<string>();
  const out: StoppedRequest[] = [];
  for (const e of events) {
    if (e.type !== 'message' || e.data.role !== 'user' || e.data.partial) continue;
    if (!e.runId || !wanted.has(e.runId) || seen.has(e.runId)) continue;
    seen.add(e.runId);
    // A run of an automation is not a request of the user: its next slot runs it again (D-094).
    if (e.data.channel === 'automation') continue;
    const agent = e.data.to ?? owners.get(e.runId);
    if (agent) {
      out.push({
        runId: e.runId,
        agent,
        text: originalRequest(e.data.text),
        ...senderOf(e.data),
      });
    }
  }
  return out;
}

/**
 * Messages of the user that waited for a busy monster (behind a run of an
 * automation, D-094, or of another chat, D-107) and whose run never started:
 * one request per run, its messages joined, oldest first (M8 of 18/10). A
 * message written by a monster (`project_send`, D-098) waits in a run of its
 * own: it is kept with its sender (`from`), to start again as that monster's
 * work. `events` (or `others`) must hold every `run` and `error` event of
 * those runs.
 */
export function waitingRequests(
  events: readonly LogEvent[],
  others: readonly LogEvent[] = [],
): StoppedRequest[] {
  const begun = new Set<string>();
  for (const e of [...events, ...others]) {
    if ((e.type === 'run' || e.type === 'error') && e.runId) begun.add(e.runId);
  }
  const byRun = new Map<string, StoppedRequest>();
  for (const e of events) {
    if (e.type !== 'message' || e.agent !== 'user' || e.data.role !== 'user') continue;
    if (e.data.partial || e.data.channel === 'automation' || !e.data.to) continue;
    if (!e.runId || begun.has(e.runId)) continue;
    const text = originalRequest(e.data.text);
    const known = byRun.get(e.runId);
    if (known && !known.from && !e.data.from) known.text = `${known.text}\n\n${text}`;
    else if (!known) {
      byRun.set(e.runId, { runId: e.runId, agent: e.data.to, text, ...senderOf(e.data) });
    }
  }
  return [...byRun.values()];
}

/**
 * The work the latest global stop interrupted, from the whole log: empty
 * when there was none, or once the monsters were resumed.
 */
export function haltedWork(events: readonly LogEvent[]): HaltedWork {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'resume') break;
    if (e.type === 'kill' && e.data.scope === 'global') {
      const { runs, ...rest } = stoppedSince(events.slice(i + 1));
      // Messages left waiting by the stop: since the stop or the resume before it.
      let from = i;
      while (from > 0) {
        const p = events[from - 1]!;
        if (p.type === 'resume' || (p.type === 'kill' && p.data.scope === 'global')) break;
        from--;
      }
      const waiting = waitingRequests(events.slice(from, i), events.slice(i));
      return { ...rest, requests: [...requestsOf(events, runs), ...waiting] };
    }
  }
  return { questions: [], agents: [], requests: [] };
}
