import {
  requestsOf,
  resumeText,
  stoppedSince,
  telegramThread,
  waitingRequests,
  type Channel,
  type LogEvent,
  type StoppedRequest,
} from '@monsters/shared';
import { telegramText } from '../channels/telegram/lines.ts';
import type { EventLog } from '../log/event-log.ts';
import { answerText } from './conversation.ts';
import type { Dispatcher } from './dispatcher.ts';
import { RunBudget, type RunLimits } from './run-limits.ts';
import { teamStrings } from './team.strings.ts';

/*
 * "Riprendi e continua" (D-072): after the latest global stop, the requests
 * of the user whose work it interrupted start again, each in a new run, with
 * a message marked `resumeOf` (the model reads "Riprendi il lavoro che avevo
 * fermato: «…»", the UI shows a status line instead of the user's bubble).
 * The core does it, not the UI, so the CLI and Telegram can do the same and
 * nothing is lost between "resume" and "send".
 */

const PAGE = 1000;

/** How far back a message left waiting is looked for (as the work of `project_send`, D-098). */
export const WAITING_LOOKBACK_MS = 7 * 24 * 3600_000;

/** Dollars a run spent, from its `provider_usage` (what its budget counted). */
function runCost(log: EventLog, runId: string): number {
  let total = 0;
  for (let after: string | undefined; ;) {
    const page = log.query({
      runId,
      type: 'provider_usage',
      limit: PAGE,
      ...(after ? { after } : {}),
    });
    for (const e of page) if (e.type === 'provider_usage') total += e.data.costUsd ?? 0;
    if (page.length < PAGE) break;
    after = page.at(-1)!.id;
  }
  return total;
}

/**
 * The budget of a run that sent work to projects (`project_send`, F-A6), rebuilt from the log
 * once its live budget is gone (a restart, a Ferma): its cost, the cost of every run it sent
 * work to, its delegations and its sends. The work it sent that starts again later has it as
 * parent, so it keeps the limit of its tree (`maxTreeCostUsd`) instead of a new one.
 */
export function senderBudgetFromLog(
  log: EventLog,
  senderRun: string,
  limits: RunLimits,
): RunBudget {
  const own = runCost(log, senderRun);
  const first = log.query({ runId: senderRun, limit: 1 })[0];
  const sentRuns = new Set<string>();
  let sends = 0;
  if (first) {
    for (let after: string | undefined; ;) {
      const page = log.query({
        type: 'message',
        agent: 'user',
        since: first.ts,
        limit: PAGE,
        ...(after ? { after } : {}),
      });
      for (const e of page) {
        if (e.type !== 'message' || e.data.fromRun !== senderRun || !e.runId) continue;
        sends++;
        sentRuns.add(e.runId);
      }
      if (page.length < PAGE) break;
      after = page.at(-1)!.id;
    }
  }
  let tree = own;
  for (const runId of sentRuns) if (runId !== senderRun) tree += runCost(log, runId);
  let delegations = 0;
  for (let after: string | undefined; ;) {
    const page = log.query({
      runId: senderRun,
      type: 'delegation',
      limit: PAGE,
      ...(after ? { after } : {}),
    });
    for (const e of page) if (e.type === 'delegation' && e.data.status === 'started') delegations++;
    if (page.length < PAGE) break;
    after = page.at(-1)!.id;
  }
  return RunBudget.restored(limits, {
    costUsd: own,
    treeCostUsd: tree,
    delegations: delegations + sends,
  });
}

/**
 * The latest global `kill`, or null: matched in SQL, so any number of Stops of one monster
 * (kills of another scope) after it never hide it (D-215).
 */
function latestKill(log: EventLog): LogEvent<'kill'> | null {
  const [kill] = log.query({ type: 'kill', data: { scope: 'global' }, order: 'desc', limit: 1 });
  return kill?.type === 'kill' ? kill : null;
}

/**
 * Messages of the user in runs that never started (they waited for a busy
 * monster, D-094, D-107), logged after `after` and before `before`, within
 * the lookback: the runs a kill switch or a restart dropped (M8 of 18/10).
 * `sends`: the work of `project_send` too (a message of a monster, `from`);
 * after a restart the projects requeue it themselves (D-098).
 */
function waitingMessages(
  log: EventLog,
  bounds: {
    after?: string | undefined;
    before?: string | undefined;
    since: number;
    sends?: boolean;
  },
): LogEvent<'message'>[] {
  const messages: LogEvent<'message'>[] = [];
  for (let after = bounds.after; ;) {
    const page = log.query({
      type: 'message',
      agent: 'user',
      since: bounds.since,
      ...(after ? { after } : {}),
      ...(bounds.before ? { before: bounds.before } : {}),
      limit: PAGE,
    });
    for (const e of page) {
      if (e.type !== 'message' || !e.runId || e.data.role !== 'user' || e.data.partial) continue;
      if ((e.data.from && !bounds.sends) || e.data.channel === 'automation' || !e.data.to) {
        continue;
      }
      messages.push(e);
    }
    if (page.length < PAGE) break;
    after = page.at(-1)!.id;
  }
  const begun = new Map<string, boolean>();
  return messages.filter((m) => {
    const runId = m.runId!;
    let started = begun.get(runId);
    if (started === undefined) {
      started = log.query({ runId, type: ['run', 'error'], limit: 1 }).length > 0;
      begun.set(runId, started);
    }
    return !started;
  });
}

/**
 * The requests the latest global stop left halfway (none when there was no
 * stop): the runs it aborted, then the messages it left waiting (M8).
 */
export function haltedRequests(log: EventLog, now = Date.now()): StoppedRequest[] {
  const kill = latestKill(log);
  if (!kill) return [];
  const since: LogEvent[] = [];
  for (let after = kill.id; ;) {
    const page = log.query({ after, type: ['question_expired', 'run'], limit: PAGE });
    since.push(...page);
    if (page.length < PAGE) break;
    after = page.at(-1)!.id;
  }
  const { runs } = stoppedSince(since);
  const events = runs.flatMap((runId) => [
    ...log.query({ runId, type: 'run', limit: 1 }),
    ...log.query({ runId, type: 'message', agent: 'user', limit: 1 }),
  ]);
  // What waited at the stop was logged after the resume (or stop) before it.
  const previous = log.find(
    { type: ['kill', 'resume'], before: kill.id, order: 'desc' },
    (e) => e.type === 'resume' || (e.type === 'kill' && e.data.scope === 'global'),
  );
  const waiting = waitingMessages(log, {
    after: previous?.id,
    before: kill.id,
    since: Math.min(kill.ts, now) - WAITING_LOOKBACK_MS,
    // The work of `project_send` that waited for a lead starts again too (residual of D-098).
    sends: true,
  });
  return [...requestsOf(events, runs), ...waitingRequests(waiting)];
}

/**
 * The question a waiting message answered (its `answer` event names the message): the task
 * text of the run as the dispatcher made it, the question and the answer (review of 19/10,
 * item 13: requeued, it came back as a bare «sì»).
 */
function parkedAnswerOf(
  log: EventLog,
  m: LogEvent<'message'>,
): { text: string; related: string[] } | undefined {
  const [answer] = log.query({ type: 'answer', after: m.id, data: { message: m.id }, limit: 1 });
  if (answer?.type !== 'answer') return undefined;
  const [asked] = log.query({
    runId: answer.runId ?? '',
    type: 'question',
    data: { questionId: answer.data.questionId },
    order: 'desc',
    limit: 1,
  });
  if (asked?.type !== 'question') return undefined;
  return {
    text: answerText(asked.data, { optionId: answer.data.optionId, text: answer.data.text }),
    related: [answer.id],
  };
}

/**
 * At the start: the user's messages a previous core left waiting for a busy
 * monster (closed or crashed before their run started) start now, each run
 * with its id and its messages, or wait again for the monster to be free.
 * Only those logged after the latest global stop: what waited then is for
 * "Riprendi e continua" (`haltedRequests`). Nothing while the kill switch is
 * engaged. What cannot start is logged, never thrown. Returns the run ids.
 */
export function requeueWaiting(
  log: EventLog,
  dispatcher: Dispatcher,
  opts: { halted: boolean; now?: number },
): string[] {
  if (opts.halted) return [];
  const now = opts.now ?? Date.now();
  const kill = latestKill(log);
  const messages = waitingMessages(log, {
    after: kill?.id,
    since: now - WAITING_LOOKBACK_MS,
  });
  const byRun = new Map<string, LogEvent<'message'>[]>();
  for (const m of messages) byRun.set(m.runId!, [...(byRun.get(m.runId!) ?? []), m]);
  const out: string[] = [];
  for (const [runId, list] of byRun) {
    const first = list[0]!;
    const origin = first.data.telegram;
    try {
      dispatcher.requeueWaiting({
        agentId: first.data.to!,
        runId,
        items: list.map((m) => {
          // It answered a parked question (D-078): the run reads the question with it again.
          const answered = parkedAnswerOf(log, m);
          if (answered) return { eventId: m.id, ...answered };
          return {
            eventId: m.id,
            text: m.data.telegram ? telegramText(m.data.telegram, m.data.text) : m.data.text,
            ...(m.data.attachments?.length ? { attachments: [...m.data.attachments] } : {}),
          };
        }),
        ...(origin ? { thread: telegramThread(origin.bot, origin.chat) } : {}),
      });
      out.push(runId);
    } catch (err) {
      log.append({
        agent: first.data.to!,
        runId,
        type: 'error',
        data: {
          code: 'resume_failed',
          message: teamStrings().resumeMessageFailed((err as Error).message),
        },
      });
    }
  }
  return out;
}

export interface ContinuedRun {
  runId: string;
  agent: string;
  /** The stopped run it starts again. */
  resumeOf: string;
}

/** Starts again each request (call after `resume`): what could not start is logged, never thrown. */
export function continueRequests(
  requests: readonly StoppedRequest[],
  deps: {
    log: EventLog;
    dispatcher: Dispatcher;
    channel: Channel;
    /** A monster of the team: the sender of a `project_send` must still be there. */
    isAgent: (id: string) => boolean;
  },
): ContinuedRun[] {
  const out: ContinuedRun[] = [];
  for (const r of requests) {
    try {
      // Work a monster sent (`project_send`): again as its work, on the system channel, with
      // its run (taint and budget of the tree), never as the user's words.
      if (r.from !== undefined && !deps.isAgent(r.from)) {
        throw new Error(teamStrings().senderGone(r.from));
      }
      const sent =
        r.from !== undefined
          ? deps.dispatcher.send({
              text: r.text,
              to: r.agent,
              channel: 'system',
              from: r.from,
              ...(r.fromRun ? { fromRun: r.fromRun } : {}),
              resumeOf: r.runId,
            })
          : deps.dispatcher.send({
              text: resumeText(r.text),
              to: r.agent,
              channel: deps.channel,
              resumeOf: r.runId,
            });
      out.push({ runId: sent.runId, agent: sent.agent, resumeOf: r.runId });
    } catch (err) {
      // A monster taken away meanwhile, or without a model: say it, go on with the others.
      deps.log.append({
        agent: r.agent,
        runId: r.runId,
        type: 'error',
        data: {
          code: 'resume_failed',
          message: teamStrings().resumeWorkFailed((err as Error).message),
        },
      });
    }
  }
  return out;
}
