import {
  AutomationCreateSchema,
  AutomationUpdateSchema,
  describeSchedule,
  formatDate,
  isUserChannel,
  localTimeZone,
  ulid,
  WEB_SEARCH_USAGE_PROVIDER,
  type Automation,
  type AutomationCreate,
  type AutomationRunDetail,
  type AutomationRunNowResponse,
  type AutomationRunSummary,
  type AutomationSkipReason,
  type AutomationTrigger,
  type AutomationUpdate,
  type AutomationView,
  type Channel,
  type Lang,
  type LogEvent,
  type Question,
} from '@monsters/shared';
import type { AgentDefinition } from '../agents/definition.ts';
import type { RunController } from '../kill/run-controller.ts';
import type { EventLog } from '../log/event-log.ts';
import { answerText } from '../team/conversation.ts';
import type { Dispatcher, InboxItem } from '../team/dispatcher.ts';
import type { QuestionStore } from '../team/questions.ts';
import type { RunLimits } from '../team/run-limits.ts';
import { OBJECTIVE_TEXT_TAIL, proposalText } from '../team/proposal-text.ts';
import type { TeamService } from '../team/team-service.ts';
import { automationStrings } from './automations.strings.ts';
import { automationRunOf, runsOfGiro } from './run-index.ts';
import { checkSchedule, missedSlot, nextSlot, ScheduleError } from './schedule.ts';
import { AutomationStore, automationIdFor } from './store.ts';

/*
 * The scheduler of the automations (plan of 17/10 §3 B3, D-094). Nothing to
 * reuse in the core: the definitions are files (`AutomationStore`), every
 * run ("giro") is in the event log. A giro opens a run of its own for the
 * capo (`Dispatcher.startAutomation`), never inside the user's work: when the
 * capo is busy it waits (at most `maxWaitMs`, then the slot is skipped as
 * `busy`). One giro at a time per automation; a question parks it as
 * `waiting_user` until the answer, which goes on in a new run of the same
 * giro. The kill switch skips the slots while Monsters is stopped. Slots
 * missed while the core was off: the latest runs at the start if less than
 * half the interval has passed since it, otherwise it is skipped and logged.
 */

export type AutomationErrorCode =
  | 'not_draft'
  | 'unknown_automation'
  | 'unknown_run'
  | 'unknown_agent'
  | 'invalid_schedule'
  | 'halted'
  | 'already_running'
  | 'draft'
  | 'no_provider'
  | 'unknown_project'
  | 'invalid_request';

const STATUS: Record<AutomationErrorCode, 400 | 404 | 409> = {
  not_draft: 409,
  unknown_automation: 404,
  unknown_run: 404,
  unknown_agent: 400,
  invalid_schedule: 400,
  halted: 409,
  already_running: 409,
  draft: 409,
  no_provider: 409,
  unknown_project: 404,
  invalid_request: 400,
};

export class AutomationError extends Error {
  readonly code: AutomationErrorCode;
  readonly status: 400 | 404 | 409;
  constructor(code: AutomationErrorCode, message: string) {
    super(message);
    this.name = 'AutomationError';
    this.code = code;
    this.status = STATUS[code];
  }
}

/** Time and timers of the scheduler (tests: a fake clock). */
export interface SchedulerClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export const systemClock: SchedulerClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref();
    return t;
  },
  clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
};

/**
 * Longest delay of one timer: a slot is reached in steps that look at the
 * clock of the wall each time (D-103). A timer does not count the time the
 * computer sleeps: one long timer would fire hours after its slot.
 */
const MAX_TIMER_MS = 60_000;
const PAGE = 1000;
const SUMMARY_CHARS = 600;
const AUTOMATION_EVENTS = [
  'automation_run_started',
  'automation_run_finished',
  'automation_run_skipped',
] as const;
type AutomationEvent = LogEvent<(typeof AUTOMATION_EVENTS)[number]>;

export interface AutomationServiceOptions {
  /** `<home>/automations`. */
  dir: string;
  log: EventLog;
  runs: RunController;
  team: TeamService;
  dispatcher: Dispatcher;
  questions: QuestionStore;
  /** False when no provider of the agent's chain is configured. */
  canRun: (agent: AgentDefinition) => boolean;
  /** Dollars → euros of the spending caps (the euro cap of a run). */
  usdToEur: () => number;
  /** The end of a giro on Telegram (when the automation asks for it). */
  telegram?: {
    announce(
      kind: 'done' | 'error',
      text: string,
      meta: { agent: string; runId: string | null },
    ): void;
  };
  /** The user's time zone: the default of a new automation. Default this computer's. */
  timezone?: () => string;
  clock?: SchedulerClock;
  /** How often a giro that waits checks whether the capo is free. Default 15 s. */
  waitPollMs?: number;
  /** How long a giro waits for the capo before the slot is skipped (`busy`). Default 1 hour. */
  maxWaitMs?: number;
}

interface Pending {
  automationId: string;
  trigger: AutomationTrigger;
  slot?: number | undefined;
  since: number;
  deadline: number;
  timer: unknown;
  /** An answer that goes on with a giro (instead of a new giro). */
  continuation?: Continuation | undefined;
}

/**
 * A giro that goes on in a new run: with an answer already in the log
 * (`item`), or with a line for the capo (`text`, after a closing of the core).
 */
type Continuation = { giro: string; item: InboxItem } | { giro: string; text: string };

/** What the capo reads when a giro cut by a closing of the core goes on (B3). */
const RECOVER_TEXT =
  'Monsters si è chiuso (un riavvio o un aggiornamento) mentre lavoravi a questo giro. Riprendi da dove eri rimasto: quello che avevi già fatto è qui sopra, non rifarlo.';

interface ActiveGiro {
  automationId: string;
  giro: string;
  lead: string;
  state: 'running' | 'waiting_user';
}

type EndStatus = 'completed' | 'failed' | 'aborted' | 'waiting_user';

/** The giri of the log, summed up as their events arrive (M9 of 18/10). */
interface HistoryIndex {
  /** The last automation event applied. */
  last: string | undefined;
  /** Giri and skipped slots of each automation, oldest first. */
  byAutomation: Map<string, AutomationRunSummary[]>;
  giri: Map<string, AutomationRunSummary>;
  /** Who logged the latest event of each giro (the capo). */
  agents: Map<string, string>;
  /** Giri whose latest event leaves them running or waiting for an answer. */
  open: Set<string>;
  /** An automation event was logged since the last read. */
  dirty: boolean;
  /** The latest slot handled (run or skipped) of each automation. */
  lastSlot: Map<string, number>;
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** An agent's own file (`Agenti/<Name>/MEMORY.md`): not a result. */
const isAgentFile = (path: string) => /^Agenti\/[^/]+\/MEMORY\.md$/u.test(path);

/**
 * The last `run` event of a run cut by the core, not by the run: the core closed
 * (`shutdown`), or it crashed (no end, or closed at the next start as left over, `restart`).
 */
function wasCut(end: LogEvent<'run'> | undefined): boolean {
  if (!end || end.data.status === 'started') return true;
  return (
    end.data.status === 'aborted' &&
    (end.data.reason === 'shutdown' || end.data.reason === 'restart')
  );
}

export class AutomationService {
  readonly #o: AutomationServiceOptions;
  readonly #store: AutomationStore;
  readonly #clock: SchedulerClock;
  readonly #timers = new Map<string, unknown>();
  readonly #next = new Map<string, number>();
  readonly #pending = new Map<string, Pending>();
  readonly #giri = new Map<string, ActiveGiro>();
  /** Runs of the core still running, by giro. */
  readonly #byRun = new Map<string, string>();
  /** Giri with an answer that wait for the open giro of their automation to end (B4). */
  readonly #queued = new Map<string, { giro: string; item: InboxItem }[]>();
  readonly #index: HistoryIndex = {
    last: undefined,
    byAutomation: new Map(),
    giri: new Map(),
    agents: new Map(),
    open: new Set(),
    dirty: true,
    lastSlot: new Map(),
  };
  /** Marks the index dirty when an automation event is logged (set at the first read). */
  #indexOff: (() => void) | undefined;
  #off: (() => void)[] = [];
  #started = false;

  constructor(options: AutomationServiceOptions) {
    this.#o = options;
    this.#store = new AutomationStore(options.dir);
    this.#clock = options.clock ?? systemClock;
  }

  get #waitPollMs(): number {
    return this.#o.waitPollMs ?? 15_000;
  }

  get #maxWaitMs(): number {
    return this.#o.maxWaitMs ?? 60 * 60_000;
  }

  #tz(): string {
    return this.#o.timezone?.() ?? localTimeZone();
  }

  // --- lifecycle --------------------------------------------------------------------------

  /**
   * Reads the definitions, closes the giri a previous core left open, runs or
   * skips the slots missed while it was off, and sets the timers. Call once
   * the core can run monsters (the HTTP server listens: harnesses call it).
   */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    for (const e of this.#store.load()) {
      this.#o.log.append({
        agent: 'system',
        type: 'error',
        data: {
          code: 'automation_invalid',
          message: automationStrings().unreadable(e.file, e.message),
        },
      });
    }
    this.#demoteUnconfirmed();
    this.#off.push(this.#o.log.subscribe((e) => this.#onEvent(e)));
    this.#off.push(this.#o.runs.onKill(() => this.#onKill()));
    const { lastSlot: lastSlots, recover, answered } = this.#rebuild();
    for (const giro of recover) this.#recover(giro);
    // Answered while another giro was open, then the core closed (review of 19/10, item 3).
    for (const { giro, item } of answered) {
      const s = this.#index.giri.get(giro);
      const a = s ? this.#store.get(s.automationId) : undefined;
      if (a) this.#continueGiro(a, giro, item);
      else this.#giri.delete(giro);
    }
    const now = this.#clock.now();
    for (const a of this.#store.list()) {
      if (a.status !== 'active') continue;
      try {
        const since = Math.max(lastSlots.get(a.id) ?? 0, a.activeSince ?? a.createdAt);
        const missed = missedSlot(a.schedule, since, now);
        if (missed?.catchUp) this.#fire(a, 'catchup', missed.slot);
        else if (missed) {
          const when = this.#slotWhen(a, missed.slot);
          this.#skip(
            a,
            'catchup',
            missed.slot,
            'missed',
            automationStrings().skippedAtStart(when),
            missed.missed,
          );
        }
      } catch (err) {
        this.#error(a, err);
      }
      this.#arm(a);
    }
  }

  /**
   * An automation is `active` only by the user (D-103): created active, confirmed
   * or resumed from the app, the terminal or Telegram. A file that says `active`
   * without such an event (written by hand, or by a monster through the data
   * folder, D-078) goes back to a draft, with a line in the log.
   */
  #demoteUnconfirmed(): void {
    const approved = new Map<string, boolean>();
    for (const e of this.#all({ type: 'automation_change' })) {
      if (e.type !== 'automation_change') continue;
      const id = e.data.automationId;
      const user = isUserChannel(e.data.by);
      switch (e.data.action) {
        case 'created':
          approved.set(id, user && e.data.status !== 'draft');
          break;
        case 'confirmed':
        case 'resumed':
          if (user) approved.set(id, true);
          break;
        case 'deleted':
        case 'discarded':
          approved.set(id, false);
          break;
        default:
          break;
      }
    }
    for (const a of this.#store.list()) {
      if (a.status !== 'active' || approved.get(a.id) === true) continue;
      this.#store.save({ ...a, status: 'draft', updatedAt: this.#clock.now() });
      this.#o.log.append({
        agent: 'system',
        type: 'error',
        data: {
          code: 'automation_unconfirmed',
          message: automationStrings().unconfirmed(a.name, a.id),
        },
      });
    }
  }

  /** Stops the timers and the waits (closing of the core). Giri already running go on. */
  stop(): void {
    for (const off of this.#off.splice(0)) off();
    // Without the listener, the next read queries the log again.
    this.#indexOff?.();
    this.#indexOff = undefined;
    for (const h of this.#timers.values()) this.#clock.clearTimer(h);
    this.#timers.clear();
    for (const p of this.#pending.values()) this.#clock.clearTimer(p.timer);
    this.#pending.clear();
    this.#started = false;
  }

  // --- definitions ------------------------------------------------------------------------

  list(): AutomationView[] {
    return this.#store.list().map((a) => this.#view(a));
  }

  /** Who wrote the objective, when it is a monster's text (D-103); undefined for the user's. */
  objectiveFrom(id: string): Automation['objectiveFrom'] {
    return this.#store.get(id)?.objectiveFrom;
  }

  get(id: string): AutomationView {
    return this.#view(this.#require(id));
  }

  /**
   * Creates an automation: from the menu (`active`, or `paused`), or a draft
   * to confirm later (`draft`, as `automation_propose` will make, D-094).
   */
  create(
    input: AutomationCreate,
    by: Channel,
    createdBy = 'user',
    /**
     * A monster's proposal (`automation_propose`, D-098): the event goes in its
     * run; `taint`: that run had read third-party text (D-103).
     */
    origin?: { runId?: string | null; parentId?: string | null; taint?: string | undefined },
  ): AutomationView {
    const p = AutomationCreateSchema.parse(input);
    // A monster's objective: the same local checks as the other proposals (D-079, D-103).
    if (createdBy !== 'user') {
      const checked = proposalText('objective', p.objective, {
        multiline: true,
        tail: OBJECTIVE_TEXT_TAIL,
      });
      if (checked.problem) throw new AutomationError('invalid_request', checked.problem);
      p.objective = checked.text;
    }
    const schedule = { cron: p.schedule.cron.trim(), timezone: p.schedule.timezone ?? this.#tz() };
    this.#checkSchedule(schedule);
    // The project by its id, also when it was named (D-097).
    const project =
      p.project !== undefined ? (this.#o.team.project(p.project)?.id ?? p.project) : undefined;
    const lead = this.#leadFor(p.lead, project);
    this.#checkAgents(lead, p.participants, project);
    const now = this.#clock.now();
    const a = this.#store.save({
      id: automationIdFor(p.name, (id) => this.#store.has(id)),
      name: p.name,
      lead,
      ...(project !== undefined ? { project } : {}),
      participants: [...new Set(p.participants)],
      schedule,
      objective: p.objective,
      ...(p.resultsFolder !== undefined ? { resultsFolder: p.resultsFolder } : {}),
      limits: p.limits,
      notify: p.notify,
      status: p.status,
      createdBy,
      createdAt: now,
      updatedAt: now,
      ...(p.status === 'active' ? { activeSince: now } : {}),
      ...(createdBy !== 'user'
        ? {
            objectiveFrom: {
              agent: createdBy,
              ...(origin?.taint
                ? { tainted: true as const, source: origin.taint.slice(0, 200) }
                : {}),
            },
          }
        : {}),
    });
    this.#change('created', a, by, origin);
    this.#arm(a);
    return this.get(a.id);
  }

  /** A draft left aside by the user (D-098): the file goes, the proposer reads it at its next turn. */
  discard(id: string, by: Channel): void {
    const a = this.#require(id);
    if (a.status !== 'draft') {
      throw new AutomationError('not_draft', automationStrings().notDraft);
    }
    this.remove(id, by);
  }

  /** The first slot after now of a schedule, and its Italian description (`automation_propose`). */
  preview(schedule: { cron: string; timezone?: string | undefined }): {
    cron: string;
    timezone: string;
    text: string;
    next: number | null;
  } {
    const s = { cron: schedule.cron.trim(), timezone: schedule.timezone ?? this.#tz() };
    this.#checkSchedule(s);
    return {
      ...s,
      text: describeSchedule(s.cron, { timezone: s.timezone, userTimezone: this.#tz() }),
      next: nextSlot(s, this.#clock.now()),
    };
  }

  /**
   * "Ferma progetto" (D-098): the giri waiting for one of these monsters to be
   * free do not start (skipped as `halted`). Returns how many.
   */
  cancelWaiting(agentIds: ReadonlySet<string>, message: string): number {
    let n = 0;
    for (const id of [...this.#queued.keys()]) {
      const a = this.#store.get(id);
      if (!a || !agentIds.has(a.lead)) continue;
      n += this.#queued.get(id)?.length ?? 0;
      this.#dropQueued(id, message);
    }
    for (const [id, p] of [...this.#pending]) {
      const a = this.#store.get(id);
      if (!a || !agentIds.has(a.lead)) continue;
      this.#clock.clearTimer(p.timer);
      this.#pending.delete(id);
      if (p.continuation) this.#closeGiro(p.continuation.giro, a, 'aborted', message);
      else this.#skip(a, p.trigger, p.slot, 'halted', message);
      n++;
    }
    return n;
  }

  update(id: string, input: AutomationUpdate, by: Channel): AutomationView {
    const current = this.#require(id);
    const u = AutomationUpdateSchema.parse(input);
    const schedule = u.schedule
      ? {
          cron: (u.schedule.cron ?? current.schedule.cron).trim(),
          timezone: u.schedule.timezone ?? current.schedule.timezone,
        }
      : current.schedule;
    if (u.schedule) this.#checkSchedule(schedule);
    const named = u.project ?? undefined;
    const project =
      u.project === null
        ? undefined
        : named !== undefined
          ? (this.#o.team.project(named)?.id ?? named)
          : current.project;
    // A project given without a lead: its lead receives the objective (D-097).
    const lead =
      u.lead ??
      (u.project !== undefined && u.project !== null
        ? this.#leadFor(undefined, project)
        : current.lead);
    const participants = u.participants ? [...new Set(u.participants)] : current.participants;
    if (u.lead || u.participants || u.project !== undefined) {
      this.#checkAgents(lead, participants, project);
    }
    const now = this.#clock.now();
    const status = u.status ?? current.status;
    const next: Automation = {
      ...current,
      ...(u.name !== undefined ? { name: u.name } : {}),
      lead,
      participants,
      schedule,
      ...(u.objective !== undefined ? { objective: u.objective } : {}),
      ...(u.limits !== undefined ? { limits: u.limits } : {}),
      notify: { ...current.notify, ...u.notify },
      status,
      updatedAt: now,
    };
    if (project === undefined) delete next.project;
    else next.project = project;
    // The user rewrote a monster's objective: from now on it is the user's own words (D-103).
    if (u.objective !== undefined && u.objective.trim() !== current.objective.trim()) {
      delete next.objectiveFrom;
    }
    if (u.resultsFolder === null) delete next.resultsFolder;
    else if (u.resultsFolder !== undefined) next.resultsFolder = u.resultsFolder;
    // Active again (confirmed, resumed): the slots of the pause were not missed.
    if (status === 'active' && current.status !== 'active') next.activeSince = now;
    const saved = this.#store.save(next);
    const action =
      status === current.status
        ? 'updated'
        : status === 'paused'
          ? 'paused'
          : current.status === 'draft'
            ? 'confirmed'
            : 'resumed';
    this.#change(action, saved, by);
    if (status !== 'active') this.#dropPending(saved.id);
    this.#arm(saved);
    return this.get(saved.id);
  }

  /**
   * A project archived (D-103): its active automations pause with it (a giro
   * would find no lead). Returns their ids, for the restore.
   */
  pauseProject(project: string, by: Channel): string[] {
    const ids = this.#store
      .list()
      .filter((a) => a.project === project && a.status === 'active')
      .map((a) => a.id);
    for (const id of ids) this.update(id, { status: 'paused' }, by);
    return ids;
  }

  /** A project restored: the automations paused with it run again (those still paused). */
  resumeProject(ids: readonly string[], by: Channel): string[] {
    const out: string[] = [];
    for (const id of ids) {
      if (this.#store.get(id)?.status !== 'paused') continue;
      try {
        this.update(id, { status: 'active' }, by);
        out.push(id);
      } catch (err) {
        const a = this.#store.get(id);
        if (a) this.#error(a, err);
      }
    }
    return out;
  }

  pause(id: string, by: Channel): AutomationView {
    return this.#require(id).status === 'paused'
      ? this.get(id)
      : this.update(id, { status: 'paused' }, by);
  }

  resume(id: string, by: Channel): AutomationView {
    return this.#require(id).status === 'active'
      ? this.get(id)
      : this.update(id, { status: 'active' }, by);
  }

  /** Deletes the file; its runs stay in the log, a giro running goes on to its end. */
  remove(id: string, by: Channel): void {
    const a = this.#require(id);
    this.#disarm(id);
    this.#dropPending(id);
    this.#store.remove(id);
    // A draft deleted is a draft left aside: its proposer reads it so (D-098).
    this.#change(a.status === 'draft' ? 'discarded' : 'deleted', a, by);
  }

  /** "Esegui ora": a giro now, or as soon as the capo is free. */
  runNow(id: string, _by: Channel): AutomationRunNowResponse {
    const a = this.#require(id);
    if (a.status === 'draft') {
      throw new AutomationError('draft', automationStrings().draftRun);
    }
    const out = this.#fire(a, 'manual', undefined, undefined, true);
    return out ?? { state: 'waiting_lead' };
  }

  // --- runs ---------------------------------------------------------------------------------

  /** The giri of an automation, newest first (skipped slots included). */
  runs(id: string, limit = 50): AutomationRunSummary[] {
    const a = this.#require(id);
    const out = this.#history(a.id, Math.max(1, limit)).map((s) => this.#withStats(s));
    const pending = this.#pendingSummary(a.id);
    return pending ? [pending, ...out] : out;
  }

  run(id: string, giro: string): AutomationRunDetail {
    const a = this.#require(id);
    const indexed = this.#refresh().giri.get(giro);
    if (!indexed || indexed.automationId !== a.id) {
      throw new AutomationError('unknown_run', automationStrings().unknownRun);
    }
    const run = this.#withStats(this.#live(indexed));
    const messages: AutomationRunDetail['messages'] = [];
    let finalAnswer: string | undefined;
    for (const runId of run.runIds) {
      for (const e of this.#all({ runId, type: 'message' })) {
        if (e.type !== 'message' || e.data.partial || !e.runId) continue;
        const user = e.agent === 'user' && e.data.role === 'user';
        if (!user && e.data.role !== 'agent') continue;
        if (!e.data.text.trim()) continue;
        messages.push({
          id: e.id,
          ts: e.ts,
          runId: e.runId,
          agent: e.agent,
          role: user ? 'user' : 'agent',
          text: e.data.text,
          ...(e.parentId !== null ? { delegated: true } : {}),
        });
        if (!user && e.parentId === null && e.agent === this.#leadOf(run.runIds, a)) {
          finalAnswer = e.data.text;
        }
      }
    }
    const results = this.#results(run.runIds);
    const questions = run.runIds
      .flatMap((runId) => this.#o.questions.list({ status: 'open', runId }))
      .map((q) => ({ id: q.id, question: q.question }));
    return {
      run,
      messages,
      ...(finalAnswer !== undefined ? { finalAnswer } : {}),
      notes: results.notes,
      files: results.files,
      questions,
    };
  }

  /**
   * An answer to a question of a giro (D-078) that no wait received: it goes
   * on in a new run of that giro, not in the chat. False when the question is
   * not of an automation (the caller resumes the monster as usual).
   */
  continueAfterAnswer(q: Question, item: InboxItem): boolean {
    const ref = automationRunOf(this.#o.log, q.runId);
    if (!ref) return false;
    const a = this.#store.get(ref.automationId);
    // Deleted meanwhile: nothing to go on with; the answer stays in the log.
    if (!a || this.#o.runs.halted) return true;
    this.#continueGiro(a, ref.giro, item);
    return true;
  }

  /** A giro answered goes on: now, or after the giro of the automation open meanwhile (B4). */
  #continueGiro(a: Automation, giro: string, item: InboxItem): void {
    // Paused (or back to a draft) since the question: the giro does not go on by itself (B4).
    if (a.status !== 'active') {
      this.#closeGiro(giro, a, 'aborted', automationStrings().pausedNoResume);
      return;
    }
    // Another giro of the automation is open (a later slot, B4): this one goes on after it.
    const pending = this.#pending.get(a.id);
    if (this.#activeGiro(a.id, giro) || (pending && pending.continuation?.giro !== giro)) {
      const queue = this.#queued.get(a.id) ?? [];
      if (!queue.some((c) => c.giro === giro)) queue.push({ giro, item });
      this.#queued.set(a.id, queue);
      return;
    }
    this.#goOn(a, { giro, item });
  }

  /** A giro goes on in a new run with an answer: now, or when the capo is free. */
  #goOn(a: Automation, continuation: { giro: string; item: InboxItem }): void {
    const lead = this.#o.team.byId(a.lead);
    if (!lead || !this.#o.canRun(lead)) {
      this.#closeGiro(continuation.giro, a, 'failed', automationStrings().cantContinue(a.lead));
      return;
    }
    this.#giri.set(continuation.giro, {
      automationId: a.id,
      giro: continuation.giro,
      lead: lead.config.id,
      state: 'running',
    });
    if (this.#o.dispatcher.busy(lead.config.id)) this.#wait(a, 'answer', undefined, continuation);
    else this.#begin(a, lead, 'answer', undefined, continuation);
  }

  /** The giro open before is over: the oldest giro that waited for it with an answer goes on (B4). */
  #takeQueued(id: string): void {
    const queue = this.#queued.get(id);
    if (!queue || queue.length === 0) return;
    if (this.#activeGiro(id) || this.#pending.has(id)) return;
    const next = queue.shift()!;
    if (queue.length === 0) this.#queued.delete(id);
    const a = this.#store.get(id);
    if (!a || this.#o.runs.halted) return;
    if (a.status !== 'active') {
      this.#closeGiro(next.giro, a, 'aborted', automationStrings().pausedNoResume);
      return;
    }
    this.#goOn(a, next);
  }

  /** The giri waiting for another giro to end close (kill switch, pause, deletion, Ferma progetto). */
  #dropQueued(id: string, message: string): void {
    const queue = this.#queued.get(id);
    if (!queue) return;
    this.#queued.delete(id);
    const a = this.#store.get(id);
    if (!a) return;
    for (const c of queue) this.#closeGiro(c.giro, a, 'aborted', message);
  }

  // --- scheduling ---------------------------------------------------------------------------

  #arm(a: Automation): void {
    this.#disarm(a.id);
    if (a.status !== 'active' || !this.#started) return;
    let next: number | null;
    try {
      next = nextSlot(a.schedule, this.#clock.now());
    } catch (err) {
      this.#error(a, err);
      return;
    }
    if (next === null) return;
    this.#next.set(a.id, next);
    this.#alarm(a.id, next);
  }

  #disarm(id: string): void {
    const h = this.#timers.get(id);
    if (h !== undefined) this.#clock.clearTimer(h);
    this.#timers.delete(id);
    this.#next.delete(id);
  }

  #alarm(id: string, at: number): void {
    const delay = Math.min(MAX_TIMER_MS, Math.max(0, at - this.#clock.now()));
    this.#timers.set(
      id,
      this.#clock.setTimer(() => this.#onAlarm(id, at), delay),
    );
  }

  #onAlarm(id: string, at: number): void {
    this.#timers.delete(id);
    const a = this.#store.get(id);
    if (!a || a.status !== 'active' || this.#next.get(id) !== at) return;
    // Woken early (a far slot is reached in steps): wait again.
    if (this.#clock.now() < at) return this.#alarm(id, at);
    try {
      // Late, after the computer slept (D-103): as at the start, the latest slot runs only within
      // half its interval, otherwise it is skipped as missed.
      const late = missedSlot(a.schedule, at - 1, this.#clock.now());
      if (late && !late.catchUp) {
        this.#skip(
          a,
          'schedule',
          late.slot,
          'missed',
          automationStrings().skippedAsleep(this.#slotWhen(a, late.slot)),
          late.missed,
        );
      } else if (late && late.slot !== at) this.#fire(a, 'catchup', late.slot, late.missed);
      else this.#fire(a, 'schedule', at);
    } catch (err) {
      this.#error(a, err);
    }
    try {
      const next = nextSlot(a.schedule, Math.max(this.#clock.now(), at));
      if (next === null) return void this.#next.delete(id);
      this.#next.set(id, next);
      this.#alarm(id, next);
    } catch (err) {
      this.#error(a, err);
    }
  }

  /**
   * A giro for a slot (or "Esegui ora", `manual`: refused with an error
   * instead of a skipped slot). Returns how it started, or null if skipped.
   */
  #fire(
    a: Automation,
    trigger: AutomationTrigger,
    slot?: number,
    missed?: number,
    manual = false,
  ): AutomationRunNowResponse | null {
    const fail = (reason: AutomationSkipReason, message: string, code: AutomationErrorCode) => {
      if (manual) throw new AutomationError(code, message);
      this.#skip(a, trigger, slot, reason, message, missed);
      return null;
    };
    if (this.#o.runs.halted) {
      return fail('halted', automationStrings().halted, 'halted');
    }
    const lead = this.#o.team.byId(a.lead);
    if (!lead) return fail('no_lead', automationStrings().leadGone(a.lead), 'unknown_agent');
    if (!this.#o.canRun(lead)) {
      return fail('no_provider', automationStrings().noModel(lead.config.name), 'no_provider');
    }
    const active = this.#activeGiro(a.id);
    if (active?.state === 'waiting_user') {
      return fail('waiting_user', automationStrings().waitingUser, 'already_running');
    }
    if (active || this.#pending.has(a.id)) {
      return fail('running', automationStrings().stillRunning, 'already_running');
    }
    if (this.#o.dispatcher.busy(lead.config.id)) {
      this.#wait(a, trigger, slot);
      return { state: 'waiting_lead' };
    }
    const runId = this.#begin(a, lead, trigger, slot);
    return runId ? { state: 'running', runId } : null;
  }

  /** The capo is busy: the giro checks again every `waitPollMs`, up to `maxWaitMs`. */
  #wait(
    a: Automation,
    trigger: AutomationTrigger,
    slot: number | undefined,
    continuation?: Pending['continuation'],
  ): void {
    const now = this.#clock.now();
    const p: Pending = {
      automationId: a.id,
      trigger,
      slot,
      since: now,
      deadline: now + this.#maxWaitMs,
      timer: undefined,
      continuation,
    };
    const tick = () => {
      p.timer = undefined;
      if (this.#pending.get(a.id) !== p) return;
      const current = this.#store.get(a.id);
      const lead = current ? this.#o.team.byId(current.lead) : undefined;
      if (!current || this.#o.runs.halted || !lead) {
        this.#pending.delete(a.id);
        // A resumed giro must end here, or it stays open and blocks every later one.
        if (current && continuation) {
          const why = this.#o.runs.halted
            ? automationStrings().haltedResume
            : automationStrings().leadGone(current.lead);
          this.#closeGiro(continuation.giro, current, 'aborted', why);
        } else if (current && this.#o.runs.halted) {
          this.#skip(current, trigger, slot, 'halted', automationStrings().halted);
        } else if (current)
          this.#skip(current, trigger, slot, 'no_lead', automationStrings().leadGone(current.lead));
        else if (continuation) this.#giri.delete(continuation.giro);
        return;
      }
      if (!this.#o.dispatcher.busy(lead.config.id)) {
        this.#pending.delete(a.id);
        this.#begin(current, lead, trigger, slot, continuation);
        return;
      }
      if (this.#clock.now() >= p.deadline) {
        this.#pending.delete(a.id);
        const minutes = Math.round(this.#maxWaitMs / 60_000);
        const message = automationStrings().busyTooLong(lead.config.name, minutes);
        if (continuation) this.#closeGiro(continuation.giro, current, 'failed', message);
        else this.#skip(current, trigger, slot, 'busy', message);
        return;
      }
      p.timer = this.#clock.setTimer(tick, this.#waitPollMs);
    };
    p.timer = this.#clock.setTimer(tick, this.#waitPollMs);
    this.#pending.set(a.id, p);
  }

  #dropPending(id: string): void {
    this.#dropQueued(id, automationStrings().automationStopped);
    const p = this.#pending.get(id);
    if (!p) return;
    this.#clock.clearTimer(p.timer);
    this.#pending.delete(id);
    // The giro waiting to resume ends with its timer (paused, archived or deleted).
    if (p.continuation) {
      const a = this.#store.get(id);
      if (a) {
        this.#closeGiro(p.continuation.giro, a, 'aborted', automationStrings().automationStopped);
      } else this.#giri.delete(p.continuation.giro);
    }
  }

  /** Opens a run of the giro for the capo; its id, or null when it could not start. */
  #begin(
    a: Automation,
    lead: AgentDefinition,
    trigger: AutomationTrigger,
    slot: number | undefined,
    continuation?: Pending['continuation'],
  ): string | null {
    const { log } = this.#o;
    const runId = ulid();
    const giro = continuation?.giro ?? runId;
    const previous = continuation ? runsOfGiro(log, giro) : [];
    log.append({
      agent: lead.config.id,
      runId,
      type: 'automation_run_started',
      data: {
        automationId: a.id,
        name: a.name,
        giro,
        trigger,
        ...(slot !== undefined ? { slot } : {}),
        ...(previous.length > 0 ? { continues: previous.at(-1)! } : {}),
      },
    });
    this.#giri.set(giro, { automationId: a.id, giro, lead: lead.config.id, state: 'running' });
    this.#byRun.set(runId, giro);
    const limits = this.#limits(a);
    try {
      this.#o.dispatcher.startAutomation({
        agent: lead,
        runId,
        automation: {
          automationId: a.id,
          giro,
          runs: previous,
          ...(limits ? { limits } : {}),
        },
        ...(continuation && 'item' in continuation
          ? { item: continuation.item }
          : { text: continuation?.text ?? this.#objective(a, lead, trigger, slot) }),
      });
      return runId;
    } catch (err) {
      this.#byRun.delete(runId);
      this.#finish(giro, runId, a, 'failed', (err as Error).message);
      return null;
    }
  }

  /** The limits of a run of the automation, as `RunLimits` (the euro cap in dollars). */
  #limits(a: Automation): Partial<RunLimits> | undefined {
    const out: Partial<RunLimits> = {};
    if (a.limits.maxSteps !== undefined) out.maxRunSteps = a.limits.maxSteps;
    if (a.limits.maxTotalTokens !== undefined) out.maxRunTokens = a.limits.maxTotalTokens;
    // Counted from the cost the providers report: a subscription reports none (D-064, D-070).
    if (a.limits.maxEur !== undefined) out.maxRunCostUsd = a.limits.maxEur / this.#o.usdToEur();
    return Object.keys(out).length > 0 ? out : undefined;
  }

  /** The day and time of a slot in the automation's time zone, in the app's language. */
  #slotWhen(a: Automation, slot: number, lang?: Lang): string {
    return formatDate(
      slot,
      {
        timeZone: a.schedule.timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      },
      lang,
    );
  }

  /** The slot as the lead reads it (for the model: Italian until the prompts move). */
  #slotText(a: Automation, slot: number): string {
    return `(giro di ${this.#slotWhen(a, slot, 'it')})`;
  }

  /** What the capo reads: the objective and what goes around it. */
  #objective(
    a: Automation,
    lead: AgentDefinition,
    trigger: AutomationTrigger,
    slot?: number,
  ): string {
    const head =
      slot !== undefined
        ? `[Automazione «${a.name}» ${this.#slotText(a, slot)}]`
        : `[Automazione «${a.name}», eseguita ora]`;
    const names = a.participants
      .filter((id) => id !== lead.config.id)
      .map((id) => this.#o.team.byId(id))
      .filter((x): x is AgentDefinition => x !== undefined)
      .map((x) => `${x.config.name} (${x.config.role})`);
    const lines = [head, a.objective];
    if (names.length > 0) lines.push(`Mostri che partecipano: ${names.join(', ')}.`);
    if (a.resultsFolder)
      lines.push(`Salva i risultati nella cartella «${a.resultsFolder}» delle note.`);
    lines.push(
      trigger === 'manual'
        ? "È un giro dell'automazione, avviato dall'utente."
        : "È un giro automatico: l'utente non sta guardando la chat.",
      'Se ti serve una sua scelta, chiedigliela invece di tirare a indovinare; alla fine scrivi in breve cosa hai fatto e dove sono i risultati.',
    );
    return lines.join('\n\n');
  }

  // --- the log ------------------------------------------------------------------------------

  #onEvent(e: LogEvent): void {
    if (e.type !== 'run' || !e.runId || e.data.status === 'started') return;
    const giro = this.#byRun.get(e.runId);
    if (giro === undefined) return;
    this.#byRun.delete(e.runId);
    // The core is closing (an update, a restart): the giro is not over, the next start takes
    // it up again (B3). No end in the log, nothing on Telegram.
    if (e.data.status === 'aborted' && e.data.reason === 'shutdown') return;
    const g = this.#giri.get(giro);
    const a = g ? this.#store.get(g.automationId) : undefined;
    this.#finish(giro, e.runId, a, e.data.status, e.data.error, g?.automationId);
  }

  /** Logs the end of a run of a giro: `waiting_user` keeps the giro open. */
  #finish(
    giro: string,
    runId: string,
    a: Automation | undefined,
    status: EndStatus,
    error?: string,
    automationId = a?.id,
  ): void {
    if (!automationId) return;
    const runs = runsOfGiro(this.#o.log, giro);
    const stats = this.#stats(runs.length > 0 ? runs : [runId]);
    const results = this.#results(runs);
    const lead = this.#giri.get(giro)?.lead ?? a?.lead ?? 'system';
    const answer = this.#lastAnswer(runs, lead);
    this.#o.log.append({
      agent: lead,
      runId,
      type: 'automation_run_finished',
      data: {
        automationId,
        name: a?.name ?? automationId,
        giro,
        status,
        ...(error ? { error } : {}),
        ...stats,
        ...(results.notes.length > 0 ? { notes: results.notes } : {}),
        ...(results.files.length > 0 ? { files: results.files.map((f) => f.name) } : {}),
        ...(answer ? { summary: clip(answer, SUMMARY_CHARS) } : {}),
        ...(a ? { notify: a.notify } : {}),
      },
    });
    if (status === 'waiting_user') {
      const g = this.#giri.get(giro);
      if (g) g.state = 'waiting_user';
      else this.#giri.set(giro, { automationId, giro, lead, state: 'waiting_user' });
      return;
    }
    this.#giri.delete(giro);
    if (a) this.#announceEnd(a, runId, status, lead, answer, results.notes, error);
    // A giro with an answer that waited for this one goes on now (B4).
    this.#takeQueued(automationId);
  }

  #announceEnd(
    a: Automation,
    runId: string,
    status: EndStatus,
    lead: string,
    answer: string | undefined,
    notesMade: readonly string[],
    error: string | undefined,
  ): void {
    if (status === 'completed') {
      const who = this.#o.team.byId(lead)?.config.name ?? lead;
      const body = answer ? `\n\n${clip(answer, 1500)}` : '';
      const notes = notesMade.slice(0, 10).map((p) => `• ${p}`);
      this.#announce(a, 'done', runId, automationStrings().done(a.name, who, body, notes));
    } else if (status === 'failed') {
      this.#announce(
        a,
        'error',
        runId,
        automationStrings().failed(a.name, error ? clip(error, 400) : undefined),
      );
    } else if (!this.#o.runs.halted) {
      this.#announce(a, 'error', runId, automationStrings().stopped(a.name));
    }
  }

  /** Closes a giro that will not go on (the capo is gone, or busy too long after an answer). */
  #closeGiro(giro: string, a: Automation, status: EndStatus, error: string): void {
    const runs = runsOfGiro(this.#o.log, giro);
    this.#finish(giro, runs.at(-1) ?? giro, a, status, error);
  }

  #skip(
    a: Automation,
    trigger: AutomationTrigger,
    slot: number | undefined,
    reason: AutomationSkipReason,
    message: string,
    missed?: number,
  ): void {
    this.#o.log.append({
      agent: 'system',
      type: 'automation_run_skipped',
      data: {
        automationId: a.id,
        name: a.name,
        trigger,
        ...(slot !== undefined ? { slot } : {}),
        reason,
        message,
        ...(missed !== undefined && missed > 1 ? { missed } : {}),
      },
    });
    // Stopped by the user, or the giro before still going: nothing to tell.
    if (reason !== 'halted' && reason !== 'running') {
      this.#announce(a, 'error', null, automationStrings().skipped(a.name, message));
    }
  }

  #announce(a: Automation, kind: 'done' | 'error', runId: string | null, text: string): void {
    if (!a.notify.telegram || !this.#o.telegram) return;
    try {
      this.#o.telegram.announce(kind, text, { agent: a.lead, runId });
    } catch {
      // Telegram is best effort: the menu has the run either way.
    }
  }

  #change(
    action: LogEvent<'automation_change'>['data']['action'],
    a: Automation,
    by: Channel,
    origin?: { runId?: string | null; parentId?: string | null },
  ): void {
    // A monster's draft (D-098): who proposed it, so it reads the outcome; the proposal in its run.
    const from = a.createdBy !== 'user' && this.#o.team.byId(a.createdBy) ? a.createdBy : undefined;
    const proposed = action === 'created' && from !== undefined && a.status === 'draft';
    this.#o.log.append({
      agent: proposed ? from : 'user',
      ...(proposed && origin?.runId ? { runId: origin.runId } : {}),
      ...(proposed && origin?.parentId ? { parentId: origin.parentId } : {}),
      type: 'automation_change',
      data: {
        action,
        automationId: a.id,
        name: a.name,
        by,
        ...(from ? { from } : {}),
        ...(action === 'created' ? { status: a.status } : {}),
      },
    });
  }

  #error(a: Automation, err: unknown): void {
    this.#o.log.append({
      agent: 'system',
      type: 'error',
      data: {
        code: 'automation',
        message: automationStrings().errorOf(a.name, (err as Error).message),
      },
    });
  }

  /** The kill switch: the giri that wait (for the capo, for an answer) end here. */
  #onKill(): void {
    for (const id of [...this.#queued.keys()]) this.#dropQueued(id, automationStrings().killed);
    for (const [id, p] of [...this.#pending]) {
      this.#clock.clearTimer(p.timer);
      this.#pending.delete(id);
      const a = this.#store.get(id);
      if (!a) continue;
      if (p.continuation)
        this.#closeGiro(p.continuation.giro, a, 'aborted', automationStrings().killed);
      else this.#skip(a, p.trigger, p.slot, 'halted', automationStrings().halted);
    }
    for (const g of [...this.#giri.values()]) {
      if (g.state !== 'waiting_user') continue;
      const a = this.#store.get(g.automationId);
      if (a) this.#closeGiro(g.giro, a, 'aborted', automationStrings().killed);
      else this.#giri.delete(g.giro);
    }
  }

  /**
   * At the start: the giri a previous core left open are closed (their runs
   * ended with it) or kept waiting for an answer. Returns the latest slot
   * handled (run or skipped) of each automation.
   */
  #rebuild(): {
    lastSlot: Map<string, number>;
    recover: string[];
    answered: { giro: string; item: InboxItem }[];
  } {
    const index = this.#refresh();
    // Only the giri still open in the log, and those with a question open (M9): never every giro.
    const asked = new Set<string>();
    for (const q of this.#o.questions.list({ status: 'open' })) {
      const ref = automationRunOf(this.#o.log, q.runId);
      if (ref) asked.add(ref.giro);
    }
    const recover: string[] = [];
    const answered: { giro: string; item: InboxItem }[] = [];
    // Answers no run took up yet: they waited for another giro (B4) or for the capo (review of
    // 19/10, item 3), only in memory.
    const pendingAnswers = this.#pendingAnswers(asked);
    for (const giro of new Set([...index.open, ...asked])) {
      const s = index.giri.get(giro);
      if (!s) continue;
      const a = this.#store.get(s.automationId);
      const lead = index.agents.get(giro) ?? a?.lead ?? 'system';
      const waiting = asked.has(giro);
      if (s.state === 'running') {
        const runId = s.runIds.at(-1) ?? giro;
        const end = this.#o.log
          .query({ runId, type: 'run', order: 'desc', limit: 1 })
          .find((r): r is LogEvent<'run'> => r.type === 'run');
        const status = end ? end.data.status : 'aborted';
        this.#giri.set(giro, { automationId: s.automationId, giro, lead, state: 'running' });
        // Cut by a closing of the core (an update, a restart, B3) or by a crash (the run never
        // ended, or the start closed it as left over): it goes on, not a failure.
        if (!waiting && wasCut(end) && a && this.#recoverable(a, s)) {
          recover.push(giro);
          continue;
        }
        const final: EndStatus =
          status === 'started' || status === 'aborted'
            ? waiting
              ? 'waiting_user'
              : 'aborted'
            : status;
        this.#finish(giro, runId, a, final, undefined, s.automationId);
      } else if (waiting && (s.state === 'waiting_user' || s.state === 'aborted')) {
        this.#giri.set(giro, { automationId: s.automationId, giro, lead, state: 'waiting_user' });
      } else if (s.state === 'waiting_user' && !pendingAnswers.has(giro)) {
        // No question open any more and no answer to go on with: it waits for nothing.
        this.#giri.set(giro, { automationId: s.automationId, giro, lead, state: 'waiting_user' });
        this.#finish(
          giro,
          s.runIds.at(-1) ?? giro,
          a,
          'aborted',
          automationStrings().questionClosed,
          s.automationId,
        );
      }
    }
    for (const [giro, item] of pendingAnswers) {
      const s = index.giri.get(giro);
      if (!s || s.state === 'running' || !this.#store.get(s.automationId)) continue;
      const lead = index.agents.get(giro) ?? this.#store.get(s.automationId)!.lead;
      this.#giri.set(giro, { automationId: s.automationId, giro, lead, state: 'waiting_user' });
      answered.push({ giro, item });
    }
    return { lastSlot: index.lastSlot, recover, answered };
  }

  /**
   * The giri with an answer given after their last event (start or end of a run): the answer
   * was taken in memory, to go on later, and the core closed before. The newest answer of each.
   * Giri with a question still open (`asked`) wait for it instead.
   */
  #pendingAnswers(asked: ReadonlySet<string>): Map<string, InboxItem> {
    const out = new Map<string, { eventId: string; text: string }>();
    for (const q of this.#o.questions.list({ status: 'answered' })) {
      const ref = automationRunOf(this.#o.log, q.runId);
      if (!ref || asked.has(ref.giro) || !q.answer) continue;
      const answer = this.#o.log
        .query({ runId: q.runId, type: 'answer', order: 'desc', limit: 20 })
        .find((e) => e.type === 'answer' && e.data.questionId === q.id);
      if (!answer) continue;
      const lastRun = runsOfGiro(this.#o.log, ref.giro).at(-1) ?? ref.giro;
      const last = this.#o.log
        .query({ runId: lastRun, type: [...AUTOMATION_EVENTS], order: 'desc', limit: 1 })
        .at(0);
      if (last && last.id > answer.id) continue;
      const seen = out.get(ref.giro);
      if (!seen || answer.id > seen.eventId) {
        out.set(ref.giro, { eventId: answer.id, text: answerText(q, q.answer) });
      }
    }
    return out;
  }

  /**
   * A giro cut by a closing of the core goes on at the start (B3): when the
   * automation is still active, its next slot has not come yet (else that slot
   * runs instead), and it was not cut more than twice (a giro that never lets
   * the core close ends as before).
   */
  #recoverable(a: Automation, s: AutomationRunSummary): boolean {
    if (a.status !== 'active' || this.#o.runs.halted) return false;
    try {
      const next = nextSlot(a.schedule, s.slot ?? s.startedAt);
      if (next !== null && next <= this.#clock.now()) return false;
    } catch {
      return false;
    }
    const cut = s.runIds.filter((runId) =>
      wasCut(
        this.#o.log
          .query({ runId, type: 'run', order: 'desc', limit: 1 })
          .find((r): r is LogEvent<'run'> => r.type === 'run'),
      ),
    ).length;
    return cut <= 2;
  }

  /** A giro cut by a closing of the core: a new run of it, which reads what was done (B3). */
  #recover(giro: string): void {
    const s = this.#index.giri.get(giro);
    const a = s ? this.#store.get(s.automationId) : undefined;
    if (!s || !a) {
      this.#giri.delete(giro);
      return;
    }
    const lead = this.#o.team.byId(a.lead);
    if (!lead || !this.#o.canRun(lead)) {
      this.#closeGiro(giro, a, 'aborted', automationStrings().cantContinue(a.lead));
      return;
    }
    const continuation = { giro, text: RECOVER_TEXT };
    if (this.#o.dispatcher.busy(lead.config.id)) this.#wait(a, s.trigger, s.slot, continuation);
    else this.#begin(a, lead, s.trigger, s.slot, continuation);
  }

  /** The open giro of an automation; one that waits for a question no longer open is closed. */
  #activeGiro(id: string, except?: string): ActiveGiro | undefined {
    // A giro answered that waits in the queue (B4) is not open: it goes on after the open one.
    const queued = new Set((this.#queued.get(id) ?? []).map((c) => c.giro));
    const g = [...this.#giri.values()].find(
      (x) => x.automationId === id && x.giro !== except && !queued.has(x.giro),
    );
    if (g?.state === 'running') {
      // A giro with no run alive and no resume queued is a leftover: close it.
      const alive =
        [...this.#byRun.values()].includes(g.giro) ||
        this.#pending.get(id)?.continuation?.giro === g.giro;
      if (alive) return g;
      const a = this.#store.get(id);
      if (a) this.#closeGiro(g.giro, a, 'aborted', automationStrings().nothingRunning);
      else this.#giri.delete(g.giro);
      return undefined;
    }
    if (!g || g.state !== 'waiting_user') return g;
    if (this.#openQuestions(runsOfGiro(this.#o.log, g.giro)) > 0) return g;
    const a = this.#store.get(id);
    if (a) this.#closeGiro(g.giro, a, 'aborted', automationStrings().questionClosed);
    else this.#giri.delete(g.giro);
    return undefined;
  }

  #openQuestions(runs: readonly string[]): number {
    return runs.reduce(
      (n, runId) => n + this.#o.questions.list({ status: 'open', runId }).length,
      0,
    );
  }

  // --- views --------------------------------------------------------------------------------

  #require(id: string): Automation {
    const a = this.#store.get(id);
    if (!a) throw new AutomationError('unknown_automation', automationStrings().unknownAutomation);
    return a;
  }

  #checkSchedule(schedule: { cron: string; timezone: string }): void {
    try {
      checkSchedule(schedule);
    } catch (err) {
      if (err instanceof ScheduleError) throw new AutomationError('invalid_schedule', err.message);
      throw err;
    }
  }

  /**
   * Who receives the objective (D-097): the lead given, else the lead of the
   * project, else the orchestrator.
   */
  #leadFor(lead: string | undefined, project: string | undefined): string {
    if (lead) return lead;
    if (project !== undefined) {
      const p = this.#o.team.project(project);
      if (!p)
        throw new AutomationError('unknown_project', automationStrings().unknownProject(project));
      const capo = this.#o.team.lead(p.id);
      if (!capo) {
        throw new AutomationError('unknown_agent', automationStrings().projectNoLead(p.name));
      }
      return capo.config.id;
    }
    const orchestrator = this.#o.team.orchestrator();
    if (!orchestrator) throw new AutomationError('unknown_agent', automationStrings().squadNoLead);
    return orchestrator.config.id;
  }

  #checkAgents(lead: string, participants: readonly string[], project?: string): void {
    for (const id of [lead, ...participants]) {
      if (!this.#o.team.byId(id)) {
        throw new AutomationError('unknown_agent', automationStrings().noMonster(id));
      }
    }
    if (project === undefined) return;
    const p = this.#o.team.project(project);
    if (!p)
      throw new AutomationError('unknown_project', automationStrings().unknownProject(project));
    // The monsters of a project's automation are its own (D-097).
    const outside = [lead, ...participants].find((id) => this.#o.team.projectOf(id)?.id !== p.id);
    if (outside) {
      const name = this.#o.team.byId(outside)?.config.name ?? outside;
      throw new AutomationError('unknown_agent', automationStrings().notInProject(name, p.name));
    }
  }

  #view(a: Automation): AutomationView {
    let nextRunAt: number | null = null;
    if (a.status === 'active') {
      try {
        nextRunAt = this.#next.get(a.id) ?? nextSlot(a.schedule, this.#clock.now());
      } catch {
        nextRunAt = null;
      }
    }
    const pending = this.#pendingSummary(a.id);
    const open = this.#openSummary(a.id);
    const last = this.#history(a.id, 2).find((s) => s.id !== open?.id);
    return {
      ...a,
      scheduleText: describeSchedule(a.schedule.cron, {
        timezone: a.schedule.timezone,
        userTimezone: this.#tz(),
      }),
      nextRunAt,
      current: pending ?? (open ? this.#withStats(open) : null),
      last: last ? this.#withStats(last) : null,
    };
  }

  #pendingSummary(id: string): AutomationRunSummary | null {
    const p = this.#pending.get(id);
    if (!p) return null;
    return {
      id: p.continuation?.giro ?? `attesa-${p.since}`,
      automationId: id,
      state: 'waiting_lead',
      trigger: p.trigger,
      ...(p.slot !== undefined ? { slot: p.slot } : {}),
      startedAt: p.since,
      runIds: p.continuation ? runsOfGiro(this.#o.log, p.continuation.giro) : [],
      costUsd: 0,
      steps: 0,
      tokens: 0,
    };
  }

  /**
   * The summary of every giro and skipped slot, brought up to date with the
   * events written since the last call (M9 of 18/10: one indexed query,
   * usually empty, instead of decoding the whole log at every read).
   */
  #refresh(): HistoryIndex {
    const index = this.#index;
    // Between two automation events there is nothing to read: not even a query.
    if (this.#indexOff && !index.dirty) return index;
    // At the insert (an event written inside a listener is delivered late, review of 19/10).
    this.#indexOff ??= this.#o.log.onStored((type) => {
      if ((AUTOMATION_EVENTS as readonly string[]).includes(type)) index.dirty = true;
    });
    index.dirty = false;
    for (;;) {
      const page = this.#o.log.query({
        type: [...AUTOMATION_EVENTS],
        after: index.last,
        limit: PAGE,
      });
      for (const e of page) this.#apply(index, e as AutomationEvent);
      if (page.length > 0) index.last = page.at(-1)!.id;
      if (page.length < PAGE) return index;
    }
  }

  #apply(index: HistoryIndex, e: AutomationEvent): void {
    const id = e.data.automationId;
    const push = (s: AutomationRunSummary) => {
      const list = index.byAutomation.get(id);
      if (list) list.push(s);
      else index.byAutomation.set(id, [s]);
    };
    if (e.type !== 'automation_run_finished' && e.data.slot !== undefined) {
      index.lastSlot.set(id, Math.max(index.lastSlot.get(id) ?? 0, e.data.slot));
    }
    if (e.type === 'automation_run_skipped') {
      push({
        id: e.id,
        automationId: id,
        state: 'skipped',
        trigger: e.data.trigger,
        ...(e.data.slot !== undefined ? { slot: e.data.slot } : {}),
        startedAt: e.ts,
        endedAt: e.ts,
        runIds: [],
        reason: e.data.reason,
        message: e.data.message,
        costUsd: 0,
        steps: 0,
        tokens: 0,
      });
      return;
    }
    let s = index.giri.get(e.data.giro);
    if (!s) {
      if (e.type !== 'automation_run_started') return;
      s = {
        id: e.data.giro,
        automationId: id,
        state: 'running',
        trigger: e.data.trigger,
        ...(e.data.slot !== undefined ? { slot: e.data.slot } : {}),
        startedAt: e.ts,
        runIds: [],
        costUsd: 0,
        steps: 0,
        tokens: 0,
      };
      index.giri.set(e.data.giro, s);
      push(s);
    }
    index.agents.set(e.data.giro, e.agent);
    if (e.type === 'automation_run_started') {
      if (e.runId && !s.runIds.includes(e.runId)) s.runIds.push(e.runId);
      s.state = 'running';
      delete s.endedAt;
      delete s.error;
    } else {
      s.state = e.data.status;
      s.costUsd = e.data.costUsd ?? 0;
      s.steps = e.data.steps ?? 0;
      s.tokens = e.data.tokens ?? 0;
      if (e.data.error) s.error = e.data.error;
      if (e.data.status !== 'waiting_user') s.endedAt = e.ts;
    }
    if (s.state === 'running' || s.state === 'waiting_user') index.open.add(s.id);
    else index.open.delete(s.id);
  }

  /** A copy of a summary with the state of the giro now (a giro no longer alive was aborted). */
  #live(s: AutomationRunSummary): AutomationRunSummary {
    const out = { ...s, runIds: [...s.runIds] };
    if (s.state === 'skipped') return out;
    const live = this.#giri.get(s.id);
    if (live) out.state = live.state;
    else if (out.state === 'running') out.state = 'aborted';
    return out;
  }

  /** The giri and skipped slots of an automation, newest first, at most `limit`. */
  #history(id: string, limit = Number.POSITIVE_INFINITY): AutomationRunSummary[] {
    const list = this.#refresh().byAutomation.get(id) ?? [];
    const out: AutomationRunSummary[] = [];
    for (let i = list.length - 1; i >= 0 && out.length < limit; i--) out.push(this.#live(list[i]!));
    return out;
  }

  /** The newest giro of an automation still running or waiting for an answer, for the menu. */
  #openSummary(id: string): AutomationRunSummary | undefined {
    const index = this.#refresh();
    let open: AutomationRunSummary | undefined;
    const giri = new Set([...index.open, ...[...this.#giri.values()].map((g) => g.giro)]);
    for (const giro of giri) {
      const s = index.giri.get(giro);
      if (!s || s.automationId !== id) continue;
      const live = this.#live(s);
      if (live.state !== 'running' && live.state !== 'waiting_user') continue;
      if (!open || live.startedAt > open.startedAt) open = live;
    }
    return open;
  }

  /** A giro still running: its totals from the log, not from the last end. */
  #withStats(s: AutomationRunSummary): AutomationRunSummary {
    if (s.state !== 'running' || s.runIds.length === 0) return s;
    return { ...s, ...this.#stats(s.runIds) };
  }

  #stats(runs: readonly string[]): { costUsd: number; steps: number; tokens: number } {
    let costUsd = 0;
    let steps = 0;
    let tokens = 0;
    for (const runId of runs) {
      for (const e of this.#all({ runId, type: 'provider_usage' })) {
        if (e.type !== 'provider_usage') continue;
        costUsd += e.data.costUsd ?? 0;
        if (e.data.provider === WEB_SEARCH_USAGE_PROVIDER || e.data.purpose) continue;
        steps++;
        tokens += (e.data.inputTokens ?? 0) + (e.data.outputTokens ?? 0);
      }
    }
    return { costUsd, steps, tokens };
  }

  /** Notes created or changed and files made in the runs (any monster of the run). */
  #results(runs: readonly string[]): { notes: string[]; files: { id: string; name: string }[] } {
    const notes: string[] = [];
    const files: { id: string; name: string }[] = [];
    for (const runId of runs) {
      for (const e of this.#all({ runId, type: ['vault_change', 'file'] })) {
        if (e.type === 'vault_change') {
          const { action, path } = e.data;
          if (action === 'delete') {
            const i = notes.indexOf(path);
            if (i >= 0) notes.splice(i, 1);
          } else if (['create', 'edit', 'move', 'restore'].includes(action) && !isAgentFile(path)) {
            if (action === 'move' && e.data.fromPath) {
              const i = notes.indexOf(e.data.fromPath);
              if (i >= 0) notes.splice(i, 1);
            }
            if (!notes.includes(path)) notes.push(path);
          }
        } else if (e.type === 'file') {
          if (e.data.action === 'created') files.push({ id: e.data.id, name: e.data.name });
          if (e.data.action === 'deleted') {
            const i = files.findIndex((f) => f.id === e.data.id);
            if (i >= 0) files.splice(i, 1);
          }
        }
      }
    }
    return { notes, files };
  }

  /** The capo's last final answer in the runs. */
  #lastAnswer(runs: readonly string[], lead: string): string | undefined {
    for (const runId of [...runs].reverse()) {
      const found = this.#o.log
        .query({ runId, type: 'message', agent: lead, order: 'desc', limit: 200 })
        .find(
          (e) =>
            e.type === 'message' &&
            e.data.role === 'agent' &&
            !e.data.partial &&
            e.parentId === null,
        );
      if (found?.type === 'message' && found.data.text.trim()) return found.data.text;
    }
    return undefined;
  }

  #leadOf(runs: readonly string[], a: Automation): string {
    const first = runs[0];
    const started = first
      ? this.#o.log.query({ runId: first, type: 'automation_run_started', limit: 1 })[0]
      : undefined;
    return started?.agent ?? a.lead;
  }

  /** Every event matching, oldest first, page after page. */
  #all(filter: { runId?: string; type: LogEvent['type'] | LogEvent['type'][] }): LogEvent[] {
    const out: LogEvent[] = [];
    for (let after: string | undefined; ;) {
      const page = this.#o.log.query({ ...filter, after, limit: PAGE });
      out.push(...page);
      if (page.length < PAGE) return out;
      after = page.at(-1)!.id;
    }
  }
}
