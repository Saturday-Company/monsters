import {
  leadingMention,
  telegramThread,
  ulid,
  type Channel,
  type LogEvent,
  type TelegramOrigin,
} from '@monsters/shared';
import { telegramText } from '../channels/telegram/lines.ts';
import type { AgentDefinition } from '../agents/definition.ts';
import { HaltedError, type RunController, type RunHandle } from '../kill/run-controller.ts';
import type { EventLog } from '../log/event-log.ts';
import { fromLine } from '../projects/lines.ts';
import type { RunLimitsOverride } from './run-limits.ts';
import type { TeamService } from './team-service.ts';
import { teamStrings } from './team.strings.ts';
import { inflightSettled } from './team-tools.ts';

/*
 * Routing of the user's messages (ARCHITECTURE §5.4): without an addressee they
 * go to the orchestrator, with `to` or a leading `@Name` to that agent, with a
 * project's id or name to the project's lead (D-097). One run
 * per message; messages sent while the agent's run is active are queued for
 * that run (the agent sees them at its next step, or in a new turn of the run).
 *
 * A run of an automation (D-094) is a conversation of its own: it starts only
 * when the agent has nothing else running (`startAutomation`), and a message
 * of the user typed meanwhile never joins it: it waits, logged in a run of
 * its own, which starts as soon as the automation's run ends.
 *
 * The same for a message a monster writes on the user's behalf (`from`, the
 * orchestrator's `project_send`, D-098): it never joins the lead's active
 * run, it waits in a run of its own, started when the lead is free. The
 * queue of an agent starts one run at a time, in order.
 *
 * A message written to a bot dedicated to a monster (D-107) belongs to the
 * conversation of that Telegram chat (`thread`): it joins only a run of the
 * same chat, never the run of the app's chat or of another chat (and a
 * message of the app never joins a run of a chat), it never answers a
 * question by itself, and its addressee is always the bot's monster (no
 * `@Name`).
 */

export interface InboxItem {
  /** The `message` event of the user. */
  eventId: string;
  text: string;
  /** Other events this item stands for (the `answer` a message gave): kept out of the history. */
  related?: string[];
  /** Ids of the files attached to the message (shared/src/files.ts). */
  attachments?: string[];
}

export interface Conversation {
  agent: AgentDefinition;
  run: RunHandle;
  inbox: InboxItem[];
  /**
   * `message` event of the latest request of the user in the run: the first
   * one, or one typed while the run was active that did not answer a question.
   */
  request?: string;
  /** Set on a run of an automation (D-094). */
  automation?: AutomationContext;
  /** The Telegram chat of a dedicated bot the run works for (D-107). */
  thread?: string;
}

/** What the turns of a run of an automation need (D-094). */
export interface AutomationContext {
  automationId: string;
  /** The first run of the giro. */
  giro: string;
  /** The earlier runs of the giro: the history the agent reads (not its chat). */
  runs: readonly string[];
  /** Limits of the run instead of `settings.limits` (only the ones set). */
  limits?: RunLimitsOverride;
}

export type DispatchErrorCode = 'unknown_agent' | 'no_orchestrator' | 'no_provider' | 'busy';

export class DispatchError extends Error {
  readonly code: DispatchErrorCode;
  constructor(code: DispatchErrorCode, message: string) {
    super(message);
    this.name = 'DispatchError';
    this.code = code;
  }
}

/** Result of one turn of the agent: `failed` ends the run with that error. */
export interface TurnOutcome {
  status: 'ok' | 'failed';
  error?: string;
}

export type TurnExecutor = (conversation: Conversation, batch: InboxItem[]) => Promise<TurnOutcome>;

export interface DispatcherOptions {
  log: EventLog;
  runs: RunController;
  team: TeamService;
  execute: TurnExecutor;
  /** False when no provider of the agent's chain is configured. */
  canRun?: (agent: AgentDefinition) => boolean;
  /**
   * Answers with `text` the open blocking question of a run, if any (a message
   * typed while the agent waits for an answer is that answer). Returns the id
   * of the question answered, or null.
   */
  answerBlocking?: (
    runId: string,
    text: string,
    channel: Channel,
    notOwner?: boolean,
  ) => string | null;
  /** The files of a message were logged with it (`message` event id, addressee). */
  onAttachments?: (ids: readonly string[], messageId: string, agentId: string) => void;
  /**
   * Answers with `text` the parked question of an agent with no active run,
   * if any (D-078: a message to a monster that waits for an answer is that
   * answer). Returns the question, the task text of the new run (the
   * question and the answer) and the events it stands for; `note` when the
   * question is too old for a plain message to answer it (D-079): one line
   * the new run reads after the message; or null.
   */
  answerParked?: (
    agentId: string,
    text: string,
    channel: Channel,
    /** The `message` event of the text, logged already. */
    messageId: string,
  ) => { questionId: string; text: string; related: string[] } | { note: string } | null;
  /**
   * A run ended (completed or failed): its open questions are parked or
   * expire. Returns how many wait for the user: the run then ends as
   * `waiting_user` instead of `completed`.
   */
  settleRun?: (runId: string) => number;
}

export interface SendResult {
  runId: string;
  agent: string;
  /** True when the message joined an active run, or waits for the agent to be free. */
  queued: boolean;
  /** The `message` event logged. */
  messageId?: string;
  /** Question answered by the message (it was waiting for an answer). */
  answered?: string;
}

interface DeferredRun {
  runId: string;
  inbox: InboxItem[];
  request?: string;
  /** A message of a monster (`project_send`): a run of its own, nothing joins it. */
  own?: boolean;
  /** The Telegram chat it works for (D-107): only messages of that chat join it. */
  thread?: string;
}

/** What the `message` event of the user's side carries besides the text. */
interface Logged {
  text: string;
  resumeOf?: string | undefined;
  attachments?: string[] | undefined;
  from?: string | undefined;
  fromRun?: string | undefined;
  telegram?: TelegramOrigin | undefined;
}

export class Dispatcher {
  readonly #log: EventLog;
  readonly #runs: RunController;
  readonly #team: TeamService;
  readonly #execute: TurnExecutor;
  readonly #canRun: (agent: AgentDefinition) => boolean;
  readonly #answerBlocking: NonNullable<DispatcherOptions['answerBlocking']>;
  readonly #onAttachments: NonNullable<DispatcherOptions['onAttachments']>;
  readonly #answerParked: NonNullable<DispatcherOptions['answerParked']>;
  readonly #settleRun: NonNullable<DispatcherOptions['settleRun']>;
  readonly #byAgent = new Map<string, Conversation>();
  readonly #byRun = new Map<string, Conversation>();
  /**
   * Runs waiting for an agent to be free, oldest first: messages typed during a
   * run of an automation (one run for all of them), and each message written
   * by a monster (`own`, one run each, D-098).
   */
  readonly #deferred = new Map<string, DeferredRun[]>();
  readonly #loops = new Set<Promise<void>>();

  constructor(options: DispatcherOptions) {
    this.#log = options.log;
    this.#runs = options.runs;
    this.#team = options.team;
    this.#execute = options.execute;
    this.#canRun = options.canRun ?? (() => true);
    this.#answerBlocking = options.answerBlocking ?? (() => null);
    this.#onAttachments = options.onAttachments ?? (() => {});
    this.#answerParked = options.answerParked ?? (() => null);
    this.#settleRun = options.settleRun ?? (() => 0);
  }

  /** A monster by id or name, else the lead of the project of that id or name (D-097). */
  #addressee(key: string): AgentDefinition | undefined {
    const agent = this.#team.get(key);
    if (agent) return agent;
    const project = this.#team.project(key);
    return project ? this.#team.lead(project.id) : undefined;
  }

  /**
   * Picks the addressee: explicit `to`, then a leading `@Name`, then the
   * orchestrator. A project's id or name stands for its lead (D-097).
   */
  route(text: string, to?: string): { agent: AgentDefinition; text: string } {
    if (to !== undefined && to.trim() !== '') {
      const agent = this.#addressee(to);
      if (!agent) throw new DispatchError('unknown_agent', `no agent called "${to}"`);
      return { agent, text };
    }
    // The longest name first: "@Rhea · Saturday fai X" is the copy in the project (D-103).
    const mention = leadingMention(text, [
      ...this.#team.list().flatMap((a) => [a.config.name, a.config.id]),
      ...this.#team.activeProjects().flatMap((p) => [p.name, p.id]),
    ]);
    if (mention) {
      const agent = this.#addressee(mention.key);
      if (agent && mention.rest) return { agent, text: mention.rest };
    }
    const orchestrator = this.#team.orchestrator();
    if (!orchestrator) throw new DispatchError('no_orchestrator', 'the team has no orchestrator');
    return { agent: orchestrator, text };
  }

  /** Delivers a user message. Throws `HaltedError` while the kill switch is engaged. */
  send(params: {
    text: string;
    to?: string | undefined;
    channel: Channel;
    /** The run whose stopped work this message starts again (not typed by the user, D-072). */
    resumeOf?: string | undefined;
    /** Files attached (ids): a message with files is never taken as the answer to a question. */
    attachments?: string[] | undefined;
    /**
     * The monster that writes on the user's behalf (`project_send`, D-097):
     * logged with the message, never the answer to a question.
     */
    from?: string | undefined;
    /** With `from`: the run it writes from (its taint goes with the message, D-098). */
    fromRun?: string | undefined;
    /** Written to a bot dedicated to the monster `to` (D-107): who wrote it, and where. */
    telegram?: TelegramOrigin | undefined;
    /**
     * Written through the CLI token or a session it opened (review of 18/10, M1): never the
     * answer to a card of the brake, which only the user in person gives.
     */
    notOwner?: boolean | undefined;
  }): SendResult {
    if (this.#runs.halted) throw new HaltedError();
    const origin = params.telegram;
    // A dedicated bot speaks for its monster only: never a leading `@Name` (D-107).
    if (origin && (params.to === undefined || params.to.trim() === '')) {
      throw new DispatchError('unknown_agent', 'a dedicated bot needs its monster');
    }
    const { agent, text: plain } = this.route(params.text, params.to);
    const writer = params.from ? this.#team.get(params.from) : undefined;
    // What the agent reads: who wrote it first; the log keeps the words as they are.
    const text = writer
      ? `${fromLine(writer.config.name)}\n\n${plain}`
      : origin
        ? telegramText(origin, plain)
        : plain;
    const thread = origin ? telegramThread(origin.bot, origin.chat) : undefined;
    const files = params.attachments?.length ? [...params.attachments] : undefined;
    const logged: Logged = {
      text: plain,
      resumeOf: params.resumeOf,
      attachments: files,
      from: writer?.config.id,
      fromRun: writer ? params.fromRun : undefined,
      telegram: origin,
    };
    if (!this.#canRun(agent)) {
      throw new DispatchError('no_provider', teamStrings().noModelHint(agent.config.name));
    }
    const id = agent.config.id;
    const active = this.#byAgent.get(id);
    // A run of an automation holds the agent: the message waits for its end (D-094).
    if (active?.automation) {
      return this.#defer(agent, text, params.channel, logged, false, thread);
    }
    // A monster's message never enters the agent's work: a run of its own, when it is free (D-098).
    if (logged.from && (active || this.#deferred.has(id))) {
      return this.#defer(agent, text, params.channel, logged, true);
    }
    // A Telegram chat and the app's chat never share a run (D-107).
    if (active && active.thread !== thread) {
      return this.#defer(agent, text, params.channel, logged, false, thread);
    }
    if (active && !active.run.aborted && !active.run.closed) {
      const event = this.#logMessage(id, active.run.id, params.channel, {
        ...logged,
        from: undefined,
        fromRun: undefined,
      });
      // A request started again (or written by a monster, or in a Telegram chat) is not an
      // answer to a question of the run.
      const answered =
        params.resumeOf || files || logged.from || thread
          ? null
          : this.#answerBlocking(active.run.id, text, params.channel, params.notOwner === true);
      if (answered) {
        return { runId: active.run.id, agent: id, queued: true, answered, messageId: event.id };
      }
      active.inbox.push({ eventId: event.id, text, ...(files ? { attachments: files } : {}) });
      active.request = event.id;
      return { runId: active.run.id, agent: id, queued: true, messageId: event.id };
    }
    const runId = ulid();
    const event = this.#logMessage(id, runId, params.channel, logged);
    // The monster waits on a parked question: this message is the answer (D-078).
    const linked =
      params.resumeOf || files || logged.from || thread
        ? null
        : this.#answerParked(id, text, params.channel, event.id);
    const parked = linked && 'questionId' in linked ? linked : null;
    const item: InboxItem = parked
      ? { eventId: event.id, text: parked.text, related: parked.related }
      : linked && 'note' in linked
        ? { eventId: event.id, text: `${text}\n\n${linked.note}` }
        : { eventId: event.id, text, ...(files ? { attachments: files } : {}) };
    const run = this.#start(agent, [item], runId, event.id, undefined, thread);
    return {
      runId: run.id,
      agent: id,
      queued: false,
      messageId: event.id,
      ...(parked ? { answered: parked.questionId } : {}),
    };
  }

  /**
   * Work already in the log for an agent (a message of `project_send` left
   * waiting by a core that closed, D-098): its run `runId` starts now, or
   * waits for the agent to be free like a new one. Throws `HaltedError`
   * while the kill switch is engaged.
   */
  requeue(agentId: string, runId: string, item: InboxItem): SendResult {
    if (this.#runs.halted) throw new HaltedError();
    const agent = this.#team.get(agentId);
    if (!agent) throw new DispatchError('unknown_agent', `no agent called "${agentId}"`);
    if (!this.#canRun(agent)) {
      throw new DispatchError('no_provider', teamStrings().noModel(agent.config.name));
    }
    if (this.busy(agent.config.id)) {
      const queue = this.#deferred.get(agent.config.id) ?? [];
      queue.push({ runId, inbox: [item], request: item.eventId, own: true });
      this.#deferred.set(agent.config.id, queue);
      return { runId, agent: agent.config.id, queued: true, messageId: item.eventId };
    }
    this.#start(agent, [item], runId, item.eventId);
    return { runId, agent: agent.config.id, queued: false, messageId: item.eventId };
  }

  /**
   * Drops the runs of `project_send` waiting for these agents ("Ferma
   * progetto", D-098): their run ids. Messages of the user keep waiting.
   */
  dropOwnDeferred(agentIds: ReadonlySet<string>): string[] {
    const dropped: string[] = [];
    for (const [agentId, queue] of [...this.#deferred]) {
      if (!agentIds.has(agentId)) continue;
      const keep = queue.filter((d) => !d.own);
      dropped.push(...queue.filter((d) => d.own).map((d) => d.runId));
      if (keep.length > 0) this.#deferred.set(agentId, keep);
      else this.#deferred.delete(agentId);
    }
    return dropped;
  }

  /** True while the agent works (a run of its chat or of an automation) or has messages waiting. */
  busy(agentId: string): boolean {
    return this.#byAgent.has(agentId) || this.#deferred.has(agentId);
  }

  /** Run ids waiting for the agent to be free, oldest first. */
  waiting(agentId: string): string[] {
    return (this.#deferred.get(agentId) ?? []).map((d) => d.runId);
  }

  /**
   * Starts a run of an automation (D-094): a conversation of its own, with
   * `text` (the objective, logged as a message on the `automation` channel)
   * or `item` (an answer already in the log). Throws `busy` when the agent is
   * working, `HaltedError` while the kill switch is engaged.
   */
  startAutomation(params: {
    agent: AgentDefinition;
    runId: string;
    automation: AutomationContext;
    text?: string;
    item?: InboxItem;
  }): RunHandle {
    if (this.#runs.halted) throw new HaltedError();
    const { agent } = params;
    if (this.busy(agent.config.id)) {
      throw new DispatchError('busy', teamStrings().agentBusy(agent.config.name));
    }
    let item = params.item;
    if (params.text !== undefined) {
      const event = this.#log.append({
        agent: 'user',
        runId: params.runId,
        type: 'message',
        data: {
          role: 'user',
          text: params.text,
          to: agent.config.id,
          channel: 'automation',
          automationId: params.automation.automationId,
        },
      });
      item = { eventId: event.id, text: params.text };
    }
    if (!item) throw new Error('startAutomation needs a text or an item');
    return this.#start(agent, [item], params.runId, undefined, params.automation);
  }

  /**
   * A message for an agent held by another run: logged now, run after. The
   * user's messages share one waiting run; a monster's (`own`) gets its own.
   */
  #defer(
    agent: AgentDefinition,
    text: string,
    channel: Channel,
    logged: Logged,
    own = false,
    thread?: string,
  ): SendResult {
    const id = agent.config.id;
    const files = logged.attachments;
    const queue = this.#deferred.get(id) ?? [];
    // The user's messages share one waiting run, each Telegram chat its own (D-107).
    const waiting = own ? undefined : queue.find((d) => !d.own && d.thread === thread);
    const runId = waiting?.runId ?? ulid();
    const event = this.#logMessage(id, runId, channel, logged);
    if (waiting) {
      waiting.inbox.push({ eventId: event.id, text, ...(files ? { attachments: files } : {}) });
      waiting.request = event.id;
      return { runId, agent: id, queued: true, messageId: event.id };
    }
    const linked =
      logged.resumeOf || files || logged.from || thread
        ? null
        : this.#answerParked(id, text, channel, event.id);
    const parked = linked && 'questionId' in linked ? linked : null;
    const item: InboxItem = parked
      ? { eventId: event.id, text: parked.text, related: parked.related }
      : linked && 'note' in linked
        ? { eventId: event.id, text: `${text}\n\n${linked.note}` }
        : { eventId: event.id, text, ...(files ? { attachments: files } : {}) };
    queue.push({
      runId,
      inbox: [item],
      request: event.id,
      ...(own ? { own: true } : {}),
      ...(thread ? { thread } : {}),
    });
    this.#deferred.set(id, queue);
    return {
      runId,
      agent: id,
      queued: true,
      messageId: event.id,
      ...(parked ? { answered: parked.questionId } : {}),
    };
  }

  /** The agent is free: the oldest run that waited for it starts. */
  #flushDeferred(agentId: string): void {
    const queue = this.#deferred.get(agentId);
    const waiting = queue?.shift();
    if (!queue || !waiting) return;
    if (queue.length === 0) this.#deferred.delete(agentId);
    // Stopped, or the core is closing: what waits stays in the log (D-098 picks it up at the start).
    if (this.#runs.halted || this.#runs.closing) {
      this.#deferred.delete(agentId);
      return;
    }
    const agent = this.#team.get(agentId);
    try {
      if (!agent) throw new Error(`no agent called "${agentId}"`);
      this.#start(agent, waiting.inbox, waiting.runId, waiting.request, undefined, waiting.thread);
    } catch (err) {
      this.#log.append({
        agent: agentId,
        runId: waiting.runId,
        type: 'error',
        data: { code: 'run_failed', message: (err as Error).message },
      });
      // The next one may still start.
      this.#flushDeferred(agentId);
    }
  }

  /**
   * Starts a new conversation: logs a `new_conversation` event, the boundary
   * past which `recentConversation` does not go. Without `to` it applies to
   * every agent, with `to` to that agent only. Refused (`busy`) while a run of
   * an agent it applies to is active: its model context already holds the old
   * turns, and the messages typed meanwhile would join that run. Allowed while
   * the kill switch is engaged (it starts no work).
   */
  newConversation(params: {
    to?: string | undefined;
    channel: Channel;
  }): LogEvent<'new_conversation'> {
    let target: AgentDefinition | undefined;
    if (params.to !== undefined && params.to.trim() !== '') {
      target = this.#team.get(params.to);
      if (!target) throw new DispatchError('unknown_agent', `no agent called "${params.to}"`);
    }
    // A run of an automation (D-094) or of a Telegram chat (D-107) is not the chat: it does
    // not hold a new conversation.
    const busy = [...this.#byAgent.values()]
      .filter((c) => !c.automation && !c.thread && !c.run.aborted && !c.run.closed)
      .filter((c) => !target || c.agent.config.id === target.config.id)
      .map((c) => c.agent.config.name);
    if (busy.length > 0) {
      throw new DispatchError('busy', teamStrings().busyNewConversation(busy));
    }
    return this.#log.append({
      agent: 'user',
      type: 'new_conversation',
      data: { ...(target ? { to: target.config.id } : {}), channel: params.channel },
    });
  }

  #start(
    agent: AgentDefinition,
    inbox: InboxItem[],
    runId?: string,
    request?: string,
    automation?: AutomationContext,
    thread?: string,
  ): RunHandle {
    const id = agent.config.id;
    const run = this.#runs.startRun({
      agent: id,
      goal: inbox[0]!.text.slice(0, 200),
      ...(runId ? { runId } : {}),
      ...(thread ? { thread } : {}),
    });
    const conversation: Conversation = {
      agent,
      run,
      inbox,
      ...(request ? { request } : {}),
      ...(automation ? { automation } : {}),
      ...(thread ? { thread } : {}),
    };
    this.#byAgent.set(id, conversation);
    this.#byRun.set(run.id, conversation);
    const loop = this.#loop(conversation);
    this.#loops.add(loop);
    loop.finally(() => this.#loops.delete(loop)).catch(() => {});
    return run;
  }

  /** Messages still queued when a run failed get a run of their own. */
  #carryOver(c: Conversation): void {
    const left = c.inbox.splice(0);
    if (left.length === 0 || this.#runs.halted) return;
    const agent = this.#team.get(c.agent.config.id) ?? c.agent;
    try {
      this.#start(agent, left, undefined, undefined, undefined, c.thread);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#log.append({
        agent: c.agent.config.id,
        runId: c.run.id,
        type: 'error',
        data: { code: 'run_failed', message },
      });
    }
  }

  /** Adds a message (e.g. a late answer) to an active run. False if the run is not active. */
  deliver(runId: string, item: InboxItem): boolean {
    const c = this.#byRun.get(runId);
    if (!c || c.run.aborted || c.run.closed) return false;
    c.inbox.push(item);
    return true;
  }

  /**
   * Gives an agent something to work on that is already in the log (e.g. a
   * late answer to its question): joins its active run, or starts a new one.
   * Returns the run id, or null when nothing can start (kill switch, no model).
   */
  resume(agentId: string, item: InboxItem, thread?: string): string | null {
    if (this.#runs.halted) return null;
    const agent = this.#team.get(agentId);
    if (!agent || !this.#canRun(agent)) return null;
    const active = this.#byAgent.get(agent.config.id);
    // Not into a run of an automation (D-094) or of another chat (D-107): after it, in a run
    // of its own.
    const queue = this.#deferred.get(agent.config.id);
    const other = active !== undefined && active.thread !== thread;
    if (active?.automation || queue || other) {
      const list = queue ?? [];
      let waiting = list.find((d) => !d.own && d.thread === thread);
      if (waiting) waiting.inbox.push(item);
      else list.push((waiting = { runId: ulid(), inbox: [item], ...(thread ? { thread } : {}) }));
      this.#deferred.set(agent.config.id, list);
      return waiting.runId;
    }
    if (active && !active.run.aborted && !active.run.closed) {
      active.inbox.push(item);
      return active.run.id;
    }
    return this.#start(agent, [item], undefined, undefined, undefined, thread).id;
  }

  /** Active conversation of a run. */
  conversation(runId: string): Conversation | undefined {
    return this.#byRun.get(runId);
  }

  /**
   * Messages of the user already in the log, left waiting by a core that
   * closed before their run started (M8 of 18/10): the run `runId` starts now
   * with all of them, or waits again for the agent to be free, in the queue of
   * the user's messages (of that Telegram chat, D-107). Throws `HaltedError`
   * while the kill switch is engaged.
   */
  requeueWaiting(params: {
    agentId: string;
    runId: string;
    items: InboxItem[];
    thread?: string | undefined;
  }): SendResult {
    if (this.#runs.halted) throw new HaltedError();
    const { runId, items, thread } = params;
    const agent = this.#team.get(params.agentId);
    if (!agent) throw new DispatchError('unknown_agent', `no agent called "${params.agentId}"`);
    if (!this.#canRun(agent)) {
      throw new DispatchError('no_provider', teamStrings().noModel(agent.config.name));
    }
    const id = agent.config.id;
    const request = items.at(-1)?.eventId;
    if (this.busy(id)) {
      const queue = this.#deferred.get(id) ?? [];
      queue.push({
        runId,
        inbox: items,
        ...(request ? { request } : {}),
        ...(thread ? { thread } : {}),
      });
      this.#deferred.set(id, queue);
      return { runId, agent: id, queued: true, ...(request ? { messageId: request } : {}) };
    }
    this.#start(agent, items, runId, request, undefined, thread);
    return { runId, agent: id, queued: false, ...(request ? { messageId: request } : {}) };
  }

  /**
   * Forgets every conversation and queued message (kill switch). The
   * messages of the user that waited stay in the log, in runs never started:
   * `haltedRequests` offers them to "Riprendi e continua" (M8).
   */
  reset(): void {
    for (const c of this.#byRun.values()) c.inbox.length = 0;
    this.#byAgent.clear();
    this.#byRun.clear();
    this.#deferred.clear();
  }

  /** Resolves when every running loop has ended (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.#loops.size > 0) await Promise.allSettled([...this.#loops]);
  }

  #logMessage(to: string, runId: string, channel: Channel, m: Logged) {
    const { text, resumeOf, attachments, from, fromRun, telegram } = m;
    const event = this.#log.append({
      agent: 'user',
      runId,
      type: 'message',
      data: {
        role: 'user',
        text,
        to,
        channel,
        ...(resumeOf ? { resumeOf } : {}),
        ...(attachments ? { attachments } : {}),
        ...(from ? { from } : {}),
        ...(from && fromRun ? { fromRun } : {}),
        ...(telegram ? { telegram } : {}),
      },
    });
    if (attachments) this.#onAttachments(attachments, event.id, to);
    return event;
  }

  /** Parks or expires the open questions of a run that ends; how many wait for the user. */
  #settle(run: RunHandle): number {
    if (run.aborted) return 0;
    try {
      return this.#settleRun(run.id);
    } catch (err) {
      this.#log.append({
        agent: 'system',
        runId: run.id,
        type: 'error',
        data: { code: 'questions', message: teamStrings().questionsError((err as Error).message) },
      });
      return 0;
    }
  }

  async #loop(c: Conversation): Promise<void> {
    const { run } = c;
    try {
      while (!run.aborted) {
        const batch = c.inbox.splice(0);
        if (batch.length === 0) break;
        const outcome = await this.#execute(c, batch);
        if (outcome.status === 'failed') {
          this.#settle(run);
          run.finish('failed', outcome.error);
          this.#carryOver(c);
          return;
        }
      }
      // No await between the empty inbox and here: no message can be lost.
      run.finish(this.#settle(run) > 0 ? 'waiting_user' : 'completed');
    } catch (err) {
      if (!run.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          this.#log.append({
            agent: c.agent.config.id,
            runId: run.id,
            type: 'error',
            data: { code: 'run_failed', message },
          });
        } catch {
          // The log is closed or full: the run must still end.
        }
        this.#settle(run);
        run.finish('failed', message);
        this.#carryOver(c);
      }
    } finally {
      // A kill ends the model loop at once: let delegations log their own end first.
      await inflightSettled(run);
      const mine = this.#byAgent.get(c.agent.config.id) === c;
      if (mine) this.#byAgent.delete(c.agent.config.id);
      this.#byRun.delete(run.id);
      // The agent is free: what waited for it starts (D-094, D-098).
      if (mine) this.#flushDeferred(c.agent.config.id);
    }
  }
}
