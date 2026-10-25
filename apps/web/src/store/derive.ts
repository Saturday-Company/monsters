import {
  vaultLayout,
  appLang,
  CONFUSED_MIN_MS,
  formatNumber,
  onAppLang,
  WEB_SEARCH_USAGE_PROVIDER,
  haltedWork,
  originalRequest,
  requestsOf,
  resumeText,
  settingsPath,
  type AgentState,
  type AgentSummary,
  type EventDataMap,
  type FileEventData,
  type HaltedWork,
  type LimitReason,
  type LogEvent,
  type PreviewData,
  type ReceiptData,
  type StoppedRequest,
  type TeamDraft,
  workChangeOf,
  workOfRun,
} from '@monsters/shared';
import { clipText, noteKey, plainText } from '../lib/markdown.ts';
import { formatUsd, modelWords } from '../lib/utils.ts';
import { deriveStrings } from './derive.strings.ts';
import {
  instinctInChat,
  instinctSentence,
  instinctTone,
  receiptInChat,
  receiptSummary,
  securitySentence,
  STUCK_ACTIONS,
  labelOfUse,
} from './instinct.ts';

/*
 * Pure functions that turn the event log into what the UI shows: the live mood
 * of each monster, the chat timeline and plain-language descriptions of events.
 */

/** What a monster is doing right now, as seen by the UI. */
export type LiveMood = 'idle' | 'working' | 'talking' | 'waiting' | 'done' | 'error' | 'stopped';

export interface LiveState {
  mood: LiveMood;
  activity?: string | undefined;
  /** When the mood started (ms). `done` fades back to idle after a few seconds. */
  since: number;
  /**
   * The instinct saw it going round in circles (`stuck_*`, D-067): the
   * confused face and "is changing course" until it moves on.
   */
  confused?: boolean | undefined;
  /**
   * Its open work items, with the core's keys (`workChangeOf`, D-157): its runs, the tasks
   * it got and the tasks it waits for. It is at work only while it has one; `UNKNOWN_WORK` when
   * an older core said "at work" without them.
   */
  work?: readonly string[] | undefined;
}

export const DONE_MS = 4500;

/** The work of a monster an older core's snapshot called "at work" without its items. */
export const UNKNOWN_WORK = '?';

/** A mood of a monster at work: a run, words coming, or waiting (for another monster or for you). */
export function busyMood(mood: LiveMood | undefined): boolean {
  return mood === 'working' || mood === 'talking' || mood === 'waiting';
}

/**
 * The activity of a monster that waits for the user's answer (see `waitsForUser`). A live binding:
 * it follows the app's language (the components compare `live.activity` with it).
 */
export let ASKED_ACTIVITY = deriveStrings().live.asked;

/** A confused monster keeps its face at least this long, even if it calls a tool at once (as the core, D-072). */
export const CONFUSED_MS = CONFUSED_MIN_MS;

/** What the monitor and the strips say of a confused monster (a live binding, like `ASKED_ACTIVITY`). */
export let CONFUSED_TEXT = deriveStrings().live.confused;

onAppLang(() => {
  ASKED_ACTIVITY = deriveStrings().live.asked;
  CONFUSED_TEXT = deriveStrings().live.confused;
});

export function moodFromState(state: AgentState): LiveMood {
  switch (state) {
    case 'working':
      return 'working';
    case 'waiting':
      return 'waiting';
    case 'error':
      return 'error';
    case 'stopped':
      return 'stopped';
    default:
      return 'idle';
  }
}

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/** Short "what I'm doing" line for a tool call. */
export function describeTool(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const t = deriveStrings().tool;
  switch (tool) {
    case 'preview_show':
      return str(i['note'])
        ? t.previewNote(clip(String(str(i['note'])).split('/').pop()!.replace(/\.md$/i, ''), 34))
        : t.previewFile;
    case 'web_search':
      return str(i['query']) ? t.searchWeb(clip(String(i['query']), 34)) : t.searchWebAny;
    case 'web_fetch': {
      const url = str(i['url']);
      if (!url) return t.fetchAny;
      try {
        return t.fetchHost(new URL(url).hostname.replace(/^www\./, ''));
      } catch {
        return t.fetchAny;
      }
    }
    case 'vault_search':
      return str(i['query']) ? t.searchNotes(clip(String(i['query']), 26)) : t.searchNotesAny;
    case 'vault_read':
      return str(i['path']) ? t.readNote(baseName(String(i['path']))) : t.readNoteAny;
    case 'vault_write':
    case 'vault_create':
      return str(i['path']) ? t.writeNote(baseName(String(i['path']))) : t.writeNoteAny;
    case 'vault_edit':
      return str(i['path']) ? t.editNote(baseName(String(i['path']))) : t.editNoteAny;
    case 'vault_delete':
      return t.trashNote;
    case 'vault_move':
      return str(i['path']) ? t.moveNote(baseName(String(i['path']))) : t.moveNoteAny;
    case 'vault_list':
      return t.listNotes;
    case 'vault_links':
      return t.links;
    case 'vault_tags':
      return t.tags;
    case 'vault_history':
      return t.history;
    case 'vault_restore':
    case 'vault_undo':
      return t.restore;
    case 'vault_propose':
      return t.propose;
    case 'vault_apply_proposal':
      return t.applyProposal;
    case 'delegate': {
      const to = str(i['to']);
      return to ? t.delegate(capitalize(to)) : t.delegateAny;
    }
    case 'ask_user':
      return t.ask;
    case 'shell':
      return str(i['command']) ? t.shell(clip(String(i['command']), 34)) : t.shellAny;
    case 'fs_list':
      return t.fsList;
    case 'fs_read':
      return str(i['path']) ? t.fsRead(baseName(String(i['path']))) : t.fsReadAny;
    case 'fs_write':
      return str(i['path']) ? t.fsWrite(baseName(String(i['path']))) : t.fsWriteAny;
    case 'fs_move':
      return str(i['from']) ? t.fsMove(baseName(String(i['from']))) : t.fsMoveAny;
    case 'fs_delete':
      return t.fsTrash;
    default:
      return describeExternalTool(tool, i) ?? t.other;
  }
}

/** External tools (MCP, M2.5): `mcp__<server>__<tool>`. */
function describeExternalTool(tool: string, i: Record<string, unknown>): string | null {
  const m = /^mcp__([a-z0-9-]+)__(.+)$/.exec(tool);
  if (!m) return null;
  const [, server = '', name = ''] = m;
  const t = deriveStrings().tool;
  if (server === 'browser') {
    const url = str(i['url']);
    if (name === 'browser_navigate' && url) {
      try {
        return t.browserOpen(new URL(url).hostname.replace(/^www\./, ''));
      } catch {
        return t.browserOpenAny;
      }
    }
    return t.browser;
  }
  return t.mcp(server, clip(name.replace(/_/g, ' '), 30));
}

/**
 * What a tool does, as a phrase for sentences that need no gender agreement:
 * "Rhea finished searching the web" ("Rhea ha finito la ricerca sul web").
 */
export function toolAction(tool: string): string {
  const s = deriveStrings();
  if (tool.startsWith('mcp__browser__')) return s.browserAction;
  if (tool.startsWith('mcp__')) return s.mcpAction;
  return s.toolAction[tool] ?? s.otherAction;
}

/** Short name of a tool for the terminal: "Web search". */
export function toolLabel(tool: string): string {
  const s = deriveStrings();
  if (tool.startsWith('mcp__browser__')) return s.browserLabel;
  if (tool.startsWith('mcp__')) return s.mcpLabel;
  return s.toolLabel[tool] ?? s.otherLabel;
}

/** An error text that only says the work was stopped (kill switch, stop of a run). */
export function isStopText(text: string | undefined): boolean {
  // i18n-ignore: words matched in the core's texts, old ones in Italian and new ones in English
  return (
    !!text &&
    /^stopped\b|\babort|\bABORTED\b|interrott|interrupted|si è fermat|\b(?:was|were|been) stopped\b/i.test(
      text,
    )
  );
}

/** Display name of a model id: no provider prefix, "(free)" for free variants. */
export function modelLabel(model: string): string {
  const s = deriveStrings().model;
  if (model === 'openrouter/free') return s.freeRouter;
  const name = model.split('/').pop() ?? model;
  return name.endsWith(':free') ? s.free(name.slice(0, -5)) : name;
}

/** Files the agents keep for themselves in `Agenti/<Nome>/` (memory, work state; `Agents/`: D-154). */
export interface AgentFile {
  owner: string;
  kind: 'memory' | 'state' | 'other';
}

export function agentFileOf(path: string): AgentFile | null {
  const layout = vaultLayout();
  const parts = path.split('/');
  if (parts.length < 3 || parts[0] !== layout.agents || parts[1] === '') return null;
  const file = parts.slice(2).join('/').toLowerCase();
  return {
    owner: parts[1]!,
    kind:
      file === layout.memory.toLowerCase()
        ? 'memory'
        : file === layout.state.toLowerCase()
          ? 'state'
          : 'other',
  };
}

export function baseName(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.md$/i, '');
}

/** What `applyLive` may ask the rest of the app. */
export interface LiveContext {
  /** Who asked a question (the app's list of questions): an answer moves on that monster only. */
  askerOf?: (questionId: string) => string | undefined;
  /** True when the end of run `runId` is known: words or tools of it are late, not work. */
  runEnded?: (runId: string) => boolean;
}

/** The item learnt for a monster seen at work in a run whose item it is not known to have. */
function learntWork(runId: string, agent: string): string {
  return `task:${runId}:?:${agent}`;
}

/**
 * Next live state of the agents after one event. `prev` is not mutated; the
 * returned object is the same reference when nothing changed.
 *
 * A monster is at work only while one of its work items is open (D-157):
 * its runs and the tasks it got, as the core counts them (`workChangeOf`).
 * Words and tool calls with nothing open never make it look at work (a page
 * of old history, an event late after its run), unless `ctx.runEnded` says
 * their run is still going (a snapshot of the core that crossed its start):
 * then the item is learnt. The end of its last item always brings it to rest.
 */
export function applyLive(
  prev: Record<string, LiveState>,
  e: LogEvent,
  agentIds: readonly string[],
  ctx: LiveContext = {},
): Record<string, LiveState> {
  const { askerOf, runEnded } = ctx;
  const at = e.ts;
  let next = prev;
  const set = (id: string, mood: LiveMood, activity?: string) => {
    if (!agentIds.includes(id)) return;
    const cur = next[id];
    if (cur && cur.mood === mood && cur.activity === activity && !cur.confused) return;
    if (next === prev) next = { ...prev };
    next[id] = { mood, activity, since: at, ...(cur?.work?.length ? { work: cur.work } : {}) };
  };
  /** A confused monster moves on (a tool, words): it stays confused for a moment first. */
  const movesOn = (id: string, mood: LiveMood, activity?: string) => {
    const cur = next[id];
    if (cur?.confused && at - cur.since < CONFUSED_MS) {
      if (cur.activity === activity && cur.mood === mood) return;
      if (next === prev) next = { ...prev };
      next[id] = { ...cur, mood, activity };
      return;
    }
    set(id, mood, activity);
  };
  const keepActivity = (id: string) => next[id]?.activity;
  const workOf = (id: string): readonly string[] => next[id]?.work ?? [];
  const atWork = (id: string) => workOf(id).length > 0;
  const setWork = (id: string, work: readonly string[]) => {
    if (!agentIds.includes(id)) return;
    const cur: LiveState = next[id] ?? { mood: 'idle', since: at };
    if (next === prev) next = { ...prev };
    next[id] = {
      mood: cur.mood,
      activity: cur.activity,
      since: cur.since,
      ...(cur.confused ? { confused: true } : {}),
      ...(work.length ? { work } : {}),
    };
  };
  const open = (id: string, key: string) => {
    if (!workOf(id).includes(key)) setWork(id, [...workOf(id), key]);
  };
  /** Closes the items of `id` that match; true when one was open. */
  const close = (id: string, match: (key: string) => boolean): boolean => {
    const work = workOf(id);
    const left = work.filter((k) => !match(k));
    if (left.length === work.length) return false;
    setWork(id, left);
    return true;
  };
  /** At work for this event: an item open, or one learnt from a run still going. */
  const busyIn = (id: string): boolean => {
    if (atWork(id)) return true;
    if (!runEnded || !e.runId || runEnded(e.runId) || !agentIds.includes(id)) return false;
    open(id, learntWork(e.runId, id));
    return true;
  };
  /** Still at work on something else after an item ended: never left looking done or stopped. */
  const goesOn = (id: string) => {
    if (!busyMood(next[id]?.mood)) set(id, 'working', deriveStrings().live.thinking);
  };

  switch (e.type) {
    case 'run': {
      const runId = e.runId ?? '';
      if (e.data.status === 'started') {
        const change = workChangeOf(e);
        if (change) open(e.agent, change.key);
        set(e.agent, 'working', e.data.goal ? deriveStrings().live.thinking : undefined);
        break;
      }
      // The run takes along the tasks given within it (as the core does): their processes went
      // with its scope, and a task whose end never reached the log is over all the same.
      for (const id of agentIds) {
        if (id === e.agent || !runId) continue;
        if (close(id, (k) => workOfRun(k, runId)) && !atWork(id) && busyMood(next[id]?.mood)) {
          set(id, e.data.status === 'aborted' ? 'stopped' : 'idle');
        }
      }
      close(e.agent, (k) => (runId !== '' && workOfRun(k, runId)) || k === UNKNOWN_WORK);
      if (atWork(e.agent)) goesOn(e.agent);
      else if (e.data.status === 'completed') set(e.agent, 'done');
      // The turn ended on a parked question (D-078): the monster waits for the user.
      else if (e.data.status === 'waiting_user') set(e.agent, 'waiting', ASKED_ACTIVITY);
      else if (e.data.status === 'failed')
        set(
          e.agent,
          'error',
          next[e.agent]?.mood === 'error'
            ? next[e.agent]?.activity
            : deriveStrings().live.wentWrong,
        );
      else set(e.agent, 'stopped');
      break;
    }
    case 'message':
      if (e.data.role !== 'agent') break;
      // A turn closed because it was stopped or failed: the run event sets the mood.
      if (e.data.status) break;
      if (e.data.partial) {
        if (busyIn(e.agent)) movesOn(e.agent, 'talking', keepActivity(e.agent));
      } else set(e.agent, 'done');
      break;
    case 'tool_call':
      if (busyIn(e.agent)) movesOn(e.agent, 'working', describeTool(e.data.tool, e.data.input));
      break;
    case 'instinct': {
      // Going round in circles (D-067): the confused face while it changes its way.
      const id = e.data.subject;
      if (!id || !STUCK_ACTIONS.has(e.data.action) || !agentIds.includes(id)) break;
      const cur = next[id];
      if (!atWork(id) || (cur && !busyMood(cur.mood))) break;
      if (next === prev) next = { ...prev };
      next[id] = {
        mood: cur?.mood ?? 'working',
        activity: cur?.activity,
        since: at,
        confused: true,
        work: workOf(id),
      };
      break;
    }
    case 'delegation': {
      const change = workChangeOf(e)!;
      const { from, to } = e.data;
      if (change.open) {
        open(to, change.key);
        // Who delegates waits for the task: it is part of its work until the task ends.
        open(from, change.key);
        set(to, 'working', taskText(e.data.goal, 48));
        set(from, 'waiting', deriveStrings().live.waitingFor(capitalize(to)));
        break;
      }
      const learnt = learntWork(e.runId ?? '', to);
      close(to, (k) => k === change.key || k === learnt || k === UNKNOWN_WORK);
      if (atWork(to)) goesOn(to);
      else if (change.status === 'completed') set(to, 'done');
      else if (change.status === 'failed')
        set(
          to,
          'error',
          e.data.error ? clipText(plainText(e.data.error), 48) : deriveStrings().live.couldNot,
        );
      else set(to, 'stopped');
      if (from === to) break;
      close(from, (k) => k === change.key);
      // Who delegated takes the result (or the failure) up again, if its own work goes on.
      const waiting = next[from];
      if (waiting && waitsForUser(waiting)) break;
      if (atWork(from)) set(from, 'working', deriveStrings().live.pickingUp);
      else if (busyMood(waiting?.mood)) set(from, 'idle');
      break;
    }
    case 'question':
      // A question that does not block leaves the monster at work (as the core counts it).
      if (e.data.blocking) set(e.agent, 'waiting', ASKED_ACTIVITY);
      break;
    case 'question_parked':
      // Still open with no run behind it (a restart, a harness that ended its turn).
      set(e.agent, 'waiting', ASKED_ACTIVITY);
      break;
    case 'answer': {
      // Only the monster that asked goes on, and only if a run of its still holds the question:
      // a parked one goes on in a new run, which says so itself.
      const id = askerOf?.(e.data.questionId);
      const cur = id ? next[id] : undefined;
      if (!id || !cur || !waitsForUser(cur)) break;
      if (atWork(id)) set(id, 'working', deriveStrings().live.thinking);
      else set(id, 'idle');
      break;
    }
    case 'question_expired': {
      // Its run is over (kill, stop or restart): nobody waits for the answer anymore.
      const cur = next[e.agent];
      if (cur && waitsForUser(cur)) {
        if (atWork(e.agent)) set(e.agent, 'working', deriveStrings().live.thinking);
        else set(e.agent, 'stopped');
      }
      break;
    }
    case 'error':
      if (
        e.data.code === 'provider_fallback' ||
        e.data.code === 'search_fallback' ||
        NOTICE_CODES.has(e.data.code ?? '')
      )
        break;
      if (e.data.code === 'aborted' || isStopText(e.data.message)) set(e.agent, 'stopped');
      else set(e.agent, 'error', clipText(plainText(e.data.message), 48));
      break;
    case 'kill':
      if (e.data.scope === 'global') {
        for (const id of agentIds) {
          close(id, () => true);
          set(id, 'stopped');
        }
      } else if (e.data.target) {
        // One run stopped (its `run aborted` follows): what was given within it stops too.
        const runId = e.data.target;
        for (const id of agentIds) {
          if (close(id, (k) => workOfRun(k, runId)) && !atWork(id)) set(id, 'stopped');
        }
      }
      break;
    case 'resume':
      for (const id of agentIds) set(id, 'idle');
      break;
    default:
      break;
  }
  return next;
}

/** True when the monster waits for the user's answer to its question. */
function waitsForUser(live: LiveState): boolean {
  return live.mood === 'waiting' && live.activity === ASKED_ACTIVITY;
}

export function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/* ------------------------------------------------------------------ chat */

export type ChatItem =
  | {
      kind: 'user';
      id: string;
      ts: number;
      text: string;
      to?: string | undefined;
      pending?: boolean;
      /** Written while the monsters were stopped: it goes when the user presses "Resume". */
      held?: boolean;
      /** Ids of the files attached (shared/src/files.ts). */
      attachments?: string[] | undefined;
    }
  | {
      kind: 'agent';
      id: string;
      ts: number;
      agent: string;
      text: string;
      streaming: boolean;
      /** The run of the turn: its instrumentation (`runStats`) and its place in the terminal. */
      runId?: string | undefined;
      /** Said in a Telegram chat of the monster's own bot (D-107): "on Telegram · Saturday Team". */
      via?: string | undefined;
    }
  | {
      kind: 'delegation';
      id: string;
      ts: number;
      from: string;
      to: string;
      goal: string;
      status: 'started' | 'completed' | 'failed' | 'aborted';
      summary?: string | undefined;
      /** Notes the delegated monster wrote for this task (paths, oldest first). */
      notes?: string[] | undefined;
      /** What the instinct said of this task ("hadn’t finished…", "in doubt"), D-068. */
      checks?: { text: string; tone: 'warn' | 'stop' | null }[] | undefined;
    }
  | {
      kind: 'question';
      id: string;
      ts: number;
      questionId: string;
      agent: string;
      runId?: string | undefined;
    }
  | {
      kind: 'error';
      id: string;
      ts: number;
      agent: string;
      text: string;
      code?: string | undefined;
      /** With a limit as code: which cap stopped the job (older events have none). */
      limit?: LimitReason | undefined;
      /** The run that failed: "Try again" sends its request again, "Behind the scenes" opens it. */
      runId?: string | undefined;
    }
  | {
      kind: 'system';
      id: string;
      ts: number;
      text: string;
      tone: 'stop' | 'go';
      /** Only in this monster's chat (a request started again); else in every chat. */
      to?: string | undefined;
    }
  /** Something the instinct did during a job, as a line between seams (D-068). */
  | {
      kind: 'instinct';
      id: string;
      ts: number;
      /** The monster it is about. */
      agent: string;
      runId?: string | undefined;
      text: string;
      tone: 'warn' | 'stop' | null;
      /** Not a decision: a defense (text removed from a page) or the spending cap. */
      about?: 'defense' | 'spend' | undefined;
    }
  /** The receipt of a turn (D-067): what was asked, done and checked, with "Undo everything". */
  | {
      kind: 'receipt';
      id: string;
      ts: number;
      /** The monster that received the request. */
      agent: string;
      runId: string;
      data: ReceiptData;
    }
  /** A new conversation starts here: for everyone, or only with the agent `to`. */
  | { kind: 'reset'; id: string; ts: number; to?: string | undefined }
  /** A monster or one of its tools saved a file (a screenshot, a page, D-075). */
  | {
      kind: 'file';
      id: string;
      ts: number;
      /** The monster. */
      agent: string;
      runId?: string | undefined;
      file: FileEventData;
    }
  /** A new monster proposed by the capo squadra (D-075): the user creates it or leaves it. */
  | {
      kind: 'proposal';
      /** Id of the `proposed` event: the id of the proposal. */
      id: string;
      ts: number;
      /** The capo squadra that proposed it. */
      agent: string;
      runId?: string | undefined;
      draft: TeamDraft;
      models?: { provider: string; model: string }[] | undefined;
      status: 'proposed' | 'created' | 'discarded';
      /** `created`: the new monster (its name may differ from the draft's). */
      created?: { agent: string; name: string } | undefined;
    }
  /**
   * A message a monster wrote to another one for the user (the orchestrator's
   * `project_send` to a project's lead, D-097): in the chat of who received it,
   * as that monster's words, "Da Titan" (D-102).
   */
  | {
      kind: 'relayed';
      id: string;
      ts: number;
      /** Who wrote it. */
      from: string;
      /** Whose chat it is in (the lead). */
      to: string;
      text: string;
    }
  /**
   * A message written to a bot dedicated to a monster (D-107): by someone in a
   * Telegram group (or in private), in that monster's chat, with the sender's
   * name and "from Telegram · <group>". Not the user's bubble, even when the
   * sender is the user (`owner`): they wrote it there, not here.
   */
  | {
      kind: 'telegram';
      id: string;
      ts: number;
      /** Whose chat it is in (the bot's monster). */
      to: string;
      text: string;
      sender: { id: number; name: string; username?: string | undefined };
      /** The sender is an account paired with the main bot: the user. */
      owner: boolean;
      chatType: 'private' | 'group' | 'supergroup';
      chatTitle?: string | undefined;
    }
  /** A lead's report back to who sent it the work (`project_report`, D-097): in that chat (D-102). */
  | {
      kind: 'report';
      id: string;
      ts: number;
      /** The project's lead, who reports. */
      lead: string;
      /** Who sent the work: the chat it is in. */
      to: string;
      project: string;
      status: 'completed' | 'failed' | 'aborted' | 'waiting_user';
      reason?: 'restart' | 'stopped' | undefined;
      summary: string;
      runId?: string | undefined;
    }
  /** Something a monster shows in the preview pane (`preview_show`, D-075): a chip that opens it. */
  | {
      kind: 'preview';
      id: string;
      ts: number;
      /** The chat it belongs to: the run's owner, else who showed it. */
      agent: string;
      /** The monster that showed it. */
      from: string;
      runId?: string | undefined;
      data: PreviewData;
    };

export interface PendingSend {
  tempId: string;
  text: string;
  to?: string | undefined;
  ts: number;
  /** Held in the UI while the monsters are stopped (the core refuses messages then). */
  held?: boolean | undefined;
  /** Ids of the files attached. */
  attachments?: string[] | undefined;
}

/** What tells a sent message apart from the others while it waits for its event. */
const sentKey = (text: string, attachments: readonly string[] | undefined) =>
  attachments?.length ? `${text}\u0000${attachments.join(',')}` : text;

/**
 * The final answer of a turn without the parts the chat already shows as
 * bubbles of their own (text said before a tool call). The core sends the whole
 * answer of the turn, its parts separated by a blank line, so the channels that
 * only read final messages (Telegram, history) get all of it.
 */
export function unshownAnswer(text: string, shown: readonly string[]): string {
  let rest = text.trim();
  for (const part of shown) {
    if (!part) continue;
    const at = rest.indexOf(part);
    if (at < 0) continue;
    rest = `${rest.slice(0, at)}\n\n${rest.slice(at + part.length)}`;
  }
  return rest.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Builds the conversation shown in the chat. Top-level agent messages (no
 * parentId) appear as bubbles; delegated work shows up as compact chips, and its
 * details stay in the agent terminal. Partial chunks are deltas: they build a
 * live draft per agent and run, replaced by the final message (minus the parts
 * already shown before a tool call).
 */
export function buildChat(
  events: readonly LogEvent[],
  pending: readonly PendingSend[],
  nameOf: (id: string) => string = capitalize,
): ChatItem[] {
  const items: ChatItem[] = [];
  const drafts = new Map<string, Extract<ChatItem, { kind: 'agent' }>>();
  const delegations = new Map<string, Extract<ChatItem, { kind: 'delegation' }>>();
  /** The delegation each monster is working on, per run (`run|to`): its notes are collected. */
  const working = new Map<string, Extract<ChatItem, { kind: 'delegation' }>>();
  /** Text bubbles of the current turn closed by a tool call, per agent and run. */
  const closed = new Map<string, string[]>();
  const seenUserTexts: string[] = [];
  /** The first monster at work in each run; who made each tool call (by its event id). */
  const runAgent = new Map<string, string>();
  const caller = new Map<string, string>();
  /** Delegation items by the id of their `started` event (the instinct's lines point there). */
  const byStart = new Map<string, Extract<ChatItem, { kind: 'delegation' }>>();
  const proposals = new Map<string, Extract<ChatItem, { kind: 'proposal' }>>();
  /** Runs started by a message to a monster's own bot (D-107): where its answers went. */
  const telegramRuns = new Map<string, string>();
  const via = (runId: string | null) => {
    const where = runId ? telegramRuns.get(runId) : undefined;
    return where ? { via: where } : {};
  };

  for (const e of events) {
    if (e.runId && e.agent !== 'system' && e.agent !== 'user') {
      if (!runAgent.has(e.runId)) runAgent.set(e.runId, e.agent);
      if (e.type === 'tool_call') caller.set(e.id, e.agent);
    }
    switch (e.type) {
      case 'message': {
        const d = e.data;
        if (d.role === 'user' && d.resumeOf) {
          // Started again by "Riprendi e continua" (D-072): the user did not type it again.
          items.push({
            kind: 'system',
            id: e.id,
            ts: e.ts,
            text: deriveStrings().chat.resumed(clip(originalRequest(d.text), 80)),
            tone: 'go',
            to: d.to,
          });
          break;
        }
        if (d.role === 'user' && d.telegram && d.to) {
          // Written to a monster's own bot on Telegram (D-107): who wrote it, and where.
          const o = d.telegram;
          if (e.runId)
            telegramRuns.set(e.runId, deriveStrings().chat.telegramVia(telegramTitle(o)));
          items.push({
            kind: 'telegram',
            id: e.id,
            ts: e.ts,
            to: d.to,
            text: d.text,
            sender: {
              id: o.sender.id,
              name: o.sender.name,
              ...(o.sender.username ? { username: o.sender.username } : {}),
            },
            owner: o.owner,
            chatType: o.chatType,
            ...(o.chatTitle ? { chatTitle: o.chatTitle } : {}),
          });
          break;
        }
        if (d.role === 'user' && d.from) {
          // Written by a monster for the user (`project_send`): its words, not the user's (D-102).
          items.push({
            kind: 'relayed',
            id: e.id,
            ts: e.ts,
            from: d.from,
            to: d.to ?? d.from,
            text: d.text,
          });
          break;
        }
        if (d.role === 'user') {
          items.push({
            kind: 'user',
            id: e.id,
            ts: e.ts,
            text: d.text,
            to: d.to,
            ...(d.attachments?.length ? { attachments: d.attachments } : {}),
          });
          seenUserTexts.push(sentKey(d.text, d.attachments));
          break;
        }
        if (d.role !== 'agent' || e.parentId) break;
        const key = `${e.agent}|${e.runId ?? ''}`;
        const draft = drafts.get(key);
        if (d.partial) {
          if (draft) draft.text += d.text;
          else {
            const item = {
              kind: 'agent' as const,
              id: e.id,
              ts: e.ts,
              agent: e.agent,
              text: d.text,
              streaming: true,
              runId: e.runId ?? undefined,
              ...via(e.runId),
            };
            drafts.set(key, item);
            items.push(item);
          }
        } else {
          // The final message ends the turn: what it repeats of the closed bubbles goes.
          const rest = unshownAnswer(d.text, closed.get(key) ?? []);
          closed.delete(key);
          if (draft) {
            draft.text = rest || (d.text.trim() ? '' : draft.text);
            draft.streaming = false;
            drafts.delete(key);
            if (!draft.text.trim()) items.splice(items.indexOf(draft), 1);
          } else if (rest) {
            items.push({
              kind: 'agent',
              id: e.id,
              ts: e.ts,
              agent: e.agent,
              text: rest,
              streaming: false,
              runId: e.runId ?? undefined,
              ...via(e.runId),
            });
          }
        }
        break;
      }
      case 'run': {
        // An ended run writes nothing more: its open drafts close, and a task given within it
        // whose end is not in the log (a crash) is not shown at work forever (D-157).
        if (e.data.status === 'started') break;
        const suffix = `|${e.runId ?? ''}`;
        for (const [key, draft] of drafts) {
          if (!key.endsWith(suffix)) continue;
          draft.streaming = false;
          drafts.delete(key);
        }
        const prefix = `${e.runId ?? ''}|`;
        for (const [key, task] of delegations) {
          if (!key.startsWith(prefix) || task.status !== 'started') continue;
          task.status = 'aborted';
          const workKey = `${e.runId ?? ''}|${task.to}`;
          if (working.get(workKey) === task) working.delete(workKey);
        }
        break;
      }
      case 'tool_call': {
        // Text streamed before a tool call is a message on its own ("Ok, ask
        // Rhea…"): it is closed here and the next step starts a new draft.
        const key = `${e.agent}|${e.runId ?? ''}`;
        const draft = drafts.get(key);
        if (draft) {
          draft.streaming = false;
          closed.set(key, [...(closed.get(key) ?? []), draft.text.trim()]);
          drafts.delete(key);
        }
        break;
      }
      case 'delegation': {
        const d = e.data;
        const key = `${e.runId ?? ''}|${d.from}|${d.to}|${d.goal}`;
        const existing = delegations.get(key);
        const workKey = `${e.runId ?? ''}|${d.to}`;
        if (existing) {
          existing.status = d.status;
          existing.summary = d.summary ?? existing.summary;
          if (d.status !== 'started' && working.get(workKey) === existing) working.delete(workKey);
        } else {
          const item = {
            kind: 'delegation' as const,
            id: e.id,
            ts: e.ts,
            from: d.from,
            to: d.to,
            goal: d.goal,
            status: d.status,
            summary: d.summary,
          };
          delegations.set(key, item);
          byStart.set(e.id, item);
          items.push(item);
          if (d.status === 'started') working.set(workKey, item);
        }
        break;
      }
      case 'vault_change': {
        // A note written by a delegated monster for its task: the result to show with it.
        if (e.data.action !== 'create' && e.data.action !== 'edit') break;
        const task = working.get(`${e.runId ?? ''}|${e.agent}`);
        if (!task || agentFileOf(e.data.path)) break;
        const notes = (task.notes ??= []);
        if (!notes.includes(e.data.path)) notes.push(e.data.path);
        break;
      }
      case 'question':
        items.push({
          kind: 'question',
          id: e.id,
          ts: e.ts,
          questionId: e.data.questionId,
          agent: e.agent,
          runId: e.runId ?? undefined,
        });
        break;
      case 'error':
        if (isQuietError(e) || e.parentId || e.agent === 'system') break;
        items.push({
          kind: 'error',
          id: e.id,
          ts: e.ts,
          agent: e.agent,
          text: e.data.message,
          code: e.data.code,
          limit: e.data.limit,
          runId: e.runId ?? undefined,
        });
        break;
      case 'kill':
        if (e.data.scope === 'global')
          items.push({
            kind: 'system',
            id: e.id,
            ts: e.ts,
            text: deriveStrings().chat.stoppedAll,
            tone: 'stop',
          });
        break;
      case 'resume':
        items.push({
          kind: 'system',
          id: e.id,
          ts: e.ts,
          text: deriveStrings().chat.resumedAll,
          tone: 'go',
        });
        break;
      case 'new_conversation':
        items.push({ kind: 'reset', id: e.id, ts: e.ts, to: e.data.to });
        break;
      case 'instinct': {
        const d = e.data;
        if (!d.subject || !instinctInChat(d)) break;
        // About a task: said with the task itself, where its result is.
        const task = e.parentId ? byStart.get(e.parentId) : undefined;
        if (task && (d.action === 'retry' || d.action === 'doubt')) {
          (task.checks ??= []).push({ text: instinctSentence(d, nameOf), tone: instinctTone(d) });
          break;
        }
        items.push({
          kind: 'instinct',
          id: e.id,
          ts: e.ts,
          agent: d.subject,
          runId: e.runId ?? undefined,
          text: instinctSentence(d, nameOf),
          tone: instinctTone(d),
        });
        break;
      }
      case 'security': {
        // The monster that read the text: who made the call it came from.
        const owner =
          (e.parentId ? caller.get(e.parentId) : undefined) ??
          (e.runId ? runAgent.get(e.runId) : undefined);
        if (!owner) break;
        items.push({
          kind: 'instinct',
          id: e.id,
          ts: e.ts,
          agent: owner,
          runId: e.runId ?? undefined,
          text: securitySentence(e.data),
          tone: e.data.action === 'injection_removed' ? 'stop' : 'warn',
          about: 'defense',
        });
        break;
      }
      case 'spend': {
        // The spending cap (D-070): in the chat of the work that reached it.
        const owner = e.runId ? runAgent.get(e.runId) : undefined;
        if (!owner) break;
        items.push({
          kind: 'instinct',
          id: e.id,
          ts: e.ts,
          agent: owner,
          runId: e.runId ?? undefined,
          text: e.data.message,
          tone: e.data.action === 'stopped' ? 'stop' : 'warn',
          about: 'spend',
        });
        break;
      }
      case 'monster_proposal': {
        const d = e.data;
        if (d.action === 'proposed') {
          if (!d.draft) break;
          const item = {
            kind: 'proposal' as const,
            id: e.id,
            ts: e.ts,
            agent: d.from,
            runId: e.runId ?? undefined,
            draft: d.draft,
            models: d.models,
            status: 'proposed' as const,
          };
          proposals.set(e.id, item);
          items.push(item);
          break;
        }
        const item = d.proposalId ? proposals.get(d.proposalId) : undefined;
        if (!item) break;
        item.status = d.action;
        if (d.action === 'created' && d.agent) {
          item.created = { agent: d.agent, name: d.name ?? item.draft.name };
        }
        break;
      }
      case 'preview':
        items.push({
          kind: 'preview',
          id: e.id,
          ts: e.ts,
          agent: (e.runId ? runAgent.get(e.runId) : undefined) ?? e.agent,
          from: e.agent,
          runId: e.runId ?? undefined,
          data: e.data,
        });
        break;
      case 'file':
        // A file a monster or a tool made (D-075); the user's own files ride on the bubble.
        if (e.data.action !== 'created' || e.agent === 'user' || e.agent === 'system') break;
        items.push({
          kind: 'file',
          id: e.id,
          ts: e.ts,
          agent: e.agent,
          runId: e.runId ?? undefined,
          file: e.data,
        });
        break;
      case 'project_report':
        items.push({
          kind: 'report',
          id: e.id,
          ts: e.ts,
          lead: e.data.lead,
          to: e.data.to,
          project: e.data.project,
          status: e.data.status,
          reason: e.data.reason,
          summary: e.data.summary,
          runId: e.runId ?? undefined,
        });
        break;
      case 'receipt':
        if (!e.runId || !receiptInChat(e.data)) break;
        items.push({
          kind: 'receipt',
          id: e.id,
          ts: e.ts,
          agent: e.data.agent,
          runId: e.runId,
          data: e.data,
        });
        break;
      default:
        break;
    }
  }

  for (const p of pending) {
    const idx = seenUserTexts.indexOf(sentKey(p.text, p.attachments));
    if (idx >= 0) {
      seenUserTexts.splice(idx, 1);
      continue;
    }
    items.push({
      kind: 'user',
      id: p.tempId,
      ts: p.ts,
      text: p.text,
      to: p.to,
      pending: true,
      ...(p.held ? { held: true } : {}),
      ...(p.attachments?.length ? { attachments: p.attachments } : {}),
    });
  }
  return items;
}

/* --------------------------------------------------------------- threads */

/*
 * One chat per monster. The core already keeps a conversation per agent
 * (`recentConversation`, D-027): the user's messages addressed to it (to the
 * orchestrator when without an addressee), its own top-level answers and the
 * answers to its questions. The UI splits the timeline the same way, plus what
 * helps to follow the work: the delegations it gave or received, its errors,
 * the stops of the kill switch.
 */

export interface ChatScope {
  /** Id of the orchestrator: messages without an addressee are for it. */
  orchestrator: string;
  /** Agent that owns each run (the one it was started for). */
  owners: ReadonlyMap<string, string>;
}

/**
 * A derivation of the log computed once per list of events: the chat, the sidebar, a question
 * card and the Activity page all ask for the same thing at every new event. What it returns is
 * shared, so it is only read.
 */
function onceFor<T>(
  derive: (events: readonly LogEvent[]) => T,
): (events: readonly LogEvent[]) => T {
  const done = new WeakMap<readonly LogEvent[], T>();
  return (events) => {
    let out = done.get(events);
    if (out === undefined) {
      out = derive(events);
      done.set(events, out);
    }
    return out;
  };
}

/**
 * Who each run belongs to: the agent of its `run started`, else the addressee
 * of its first message, else who delegates in it (a delegated monster works in
 * the run of who asked, D-021).
 */
export const runOwners = onceFor((events): Map<string, string> => {
  const out = new Map<string, string>();
  for (const e of events) {
    if (!e.runId || out.has(e.runId)) continue;
    if (e.type === 'run' && e.data.status === 'started') out.set(e.runId, e.agent);
    else if (e.type === 'message' && e.data.role === 'user' && e.data.to)
      out.set(e.runId, e.data.to);
    else if (e.type === 'delegation' && e.data.status === 'started') out.set(e.runId, e.data.from);
  }
  return out;
});

/**
 * The chat a question belongs to: the one whose run it was asked in (a monster
 * working for the orchestrator asks there, where the request started), else
 * the chat of who asked. Its badge is counted there only.
 */
export function questionHome(
  item: Extract<ChatItem, { kind: 'question' }>,
  scope: ChatScope,
): string {
  return (item.runId && scope.owners.get(item.runId)) || item.agent;
}

/** The chats an item shows up in; null for every chat (stops, general new conversations). */
export function threadsOf(item: ChatItem, scope: ChatScope): readonly string[] | null {
  switch (item.kind) {
    case 'user':
      return [item.to ?? scope.orchestrator];
    case 'agent':
    case 'error':
      return [item.agent];
    case 'relayed':
    case 'telegram':
    case 'report':
      return [item.to];
    case 'delegation':
      return item.from === item.to ? [item.from] : [item.from, item.to];
    case 'question': {
      const home = questionHome(item, scope);
      return home === item.agent ? [home] : [home, item.agent];
    }
    case 'reset':
      return item.to ? [item.to] : null;
    case 'system':
      return item.to ? [item.to] : null;
    case 'instinct': {
      // The chat of the monster it is about, and the one where the request started.
      const home = (item.runId && scope.owners.get(item.runId)) || item.agent;
      return home === item.agent ? [home] : [home, item.agent];
    }
    case 'receipt':
    case 'proposal':
      return [item.agent];
    case 'preview':
      return item.agent === item.from ? [item.agent] : [item.agent, item.from];
    case 'file': {
      // The chat of the monster that made it, and the one where the request started.
      const home = (item.runId && scope.owners.get(item.runId)) || item.agent;
      return home === item.agent ? [home] : [home, item.agent];
    }
  }
}

/** The items of one monster's chat, in order. */
export function chatThread(
  items: readonly ChatItem[],
  agentId: string,
  scope: ChatScope,
): ChatItem[] {
  return items.filter((it) => {
    const t = threadsOf(it, scope);
    return t === null || t.includes(agentId);
  });
}

/**
 * The thread of every monster in one pass over the items (`chatThread` for each: the same
 * lists, but `threadsOf` is asked once per item and not once per item and monster).
 */
export function chatThreads(
  items: readonly ChatItem[],
  agentIds: readonly string[],
  scope: ChatScope,
): Map<string, ChatItem[]> {
  const out = new Map<string, ChatItem[]>(agentIds.map((id) => [id, []]));
  for (const it of items) {
    const where = threadsOf(it, scope);
    if (where === null) {
      for (const list of out.values()) list.push(it);
    } else {
      for (const id of new Set(where)) out.get(id)?.push(it);
    }
  }
  return out;
}

/** What the chat list shows of one chat. */
export interface ChatSummary {
  /** Latest item worth a preview (a stop only when there is nothing else). */
  last: ChatItem | undefined;
  /** Answers, questions and errors newer than the last item seen (`seen`, an event id). */
  unread: number;
}

const COUNTED = new Set<ChatItem['kind']>([
  'agent',
  'question',
  'error',
  'proposal',
  'relayed',
  'telegram',
  'report',
]);

export function chatSummary(thread: readonly ChatItem[], seen: string): ChatSummary {
  let last: ChatItem | undefined;
  let unread = 0;
  for (const it of thread) {
    // Stops, receipts and the lines of the instinct are not what the chat "says".
    if (it.kind !== 'system' && it.kind !== 'receipt' && it.kind !== 'instinct') last = it;
    if (COUNTED.has(it.kind) && it.id > seen) unread++;
  }
  // With nothing else to say, a stop is kept but not "Si riparte": it is in every chat, and only a
  // chat that really took up a job again (its own "Ripreso il lavoro…", with `to`) says so.
  const fallback = [...thread]
    .reverse()
    .find((it) => !(it.kind === 'system' && it.tone === 'go' && !it.to));
  return { last: last ?? fallback, unread };
}

/** One line of preview for the chat list, in plain text. */
export function previewText(item: ChatItem, nameOf: (id: string) => string): string {
  const c = deriveStrings().chat;
  switch (item.kind) {
    case 'user':
      return c.previewYou(clipText(item.text.replace(/\s+/g, ' ').trim(), 90));
    case 'agent':
      return clipText(plainText(item.text), 90) || '…';
    case 'relayed':
      return `${nameOf(item.from)}: ${clipText(plainText(item.text), 90)}`;
    case 'telegram':
      return `${item.sender.name}: ${clipText(item.text.replace(/\s+/g, ' ').trim(), 90)}`;
    case 'report':
      return reportSentence(item, nameOf);
    case 'delegation':
      if (item.status === 'completed')
        return c.delegationDone(nameOf(item.to), taskText(item.goal, 70));
      if (item.status === 'started')
        return c.delegationStarted(nameOf(item.to), taskText(item.goal, 70));
      return c.delegationStopped(nameOf(item.to));
    case 'question':
      return c.askedYou(nameOf(item.agent));
    case 'error':
      return errorSentence(
        { agent: item.agent, data: { code: item.code, message: item.text, limit: item.limit } },
        nameOf,
      );
    case 'system':
      return item.text;
    case 'reset':
      return c.newConversation;
    case 'instinct':
      return item.text;
    case 'receipt':
      return c.receipt(receiptSummary(item.data));
    case 'proposal':
      return c.proposes(nameOf(item.agent), item.draft.name);
    case 'preview':
      return c.showsYou(nameOf(item.from), clipText(item.data.name, 70));
    case 'file':
      return fileSentence(item.file, nameOf(item.agent));
  }
}

/** The group a Telegram message came from, or undefined for a private chat (D-107). */
function telegramTitle(
  item: Pick<Extract<ChatItem, { kind: 'telegram' }>, 'chatType' | 'chatTitle'>,
): string | undefined {
  return item.chatType === 'private' || !item.chatTitle ? undefined : item.chatTitle;
}

/** "from Telegram · Saturday Team", or "from Telegram · in private" (D-107). */
export function telegramWhere(
  item: Pick<Extract<ChatItem, { kind: 'telegram' }>, 'chatType' | 'chatTitle'>,
): string {
  return deriveStrings().chat.telegramWhere(telegramTitle(item));
}

/** One chat split at its latest new conversation. */
export interface ChatView {
  /** Where the current conversation starts; undefined when it never started over. */
  boundary?: Extract<ChatItem, { kind: 'reset' }> | undefined;
  /** Everything before the boundary: the previous conversations (oldest first). */
  earlier: ChatItem[];
  /** Questions of the previous conversations still waiting for an answer. */
  carried: Extract<ChatItem, { kind: 'question' }>[];
  /** The current conversation, after the boundary. */
  current: ChatItem[];
}

/**
 * Splits one chat (see `chatThread`) at its latest `new_conversation`: one for
 * everyone and one for this monster both start it over, as in the core
 * (`startsConversationOf`). The questions of the previous conversations that
 * were still open at the boundary are carried over (`carry`): they can still
 * be answered, and the answer stays in sight.
 */
export function splitConversation(
  items: readonly ChatItem[],
  carry: (questionId: string, boundaryId: string) => boolean,
): ChatView {
  let at = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]!.kind === 'reset') {
      at = i;
      break;
    }
  }
  if (at < 0) return { earlier: [], carried: [], current: items.slice() };
  const earlier = items.slice(0, at);
  const boundary = items[at] as Extract<ChatItem, { kind: 'reset' }>;
  return {
    boundary,
    earlier,
    carried: earlier.filter(
      (it): it is Extract<ChatItem, { kind: 'question' }> =>
        it.kind === 'question' && carry(it.questionId, boundary.id),
    ),
    current: items.slice(at + 1),
  };
}

/** Id of the event that closed each question (its answer or its expiry). */
export const questionsClosedAt = onceFor((events): Map<string, string> => {
  const out = new Map<string, string>();
  for (const e of events) {
    if ((e.type === 'answer' || e.type === 'question_expired') && !out.has(e.data.questionId))
      out.set(e.data.questionId, e.id);
  }
  return out;
});

/** Messages (bubbles) in a list of chat items. */
export function countMessages(items: readonly ChatItem[]): number {
  return items.filter(
    (it) =>
      it.kind === 'user' || it.kind === 'agent' || it.kind === 'relayed' || it.kind === 'telegram',
  ).length;
}

/**
 * How a lead's report went, in words (D-102): "finished", "was interrupted:
 * Monsters closed", "was stopped before starting". `tone` is the light.
 */
export function reportOutcome(
  item: Pick<Extract<ChatItem, { kind: 'report' }>, 'status' | 'reason'>,
): {
  text: string;
  tone: 'ok' | 'signal' | 'stop' | 'off';
} {
  const r = deriveStrings().report;
  if (item.reason === 'restart') return { text: r.restart, tone: 'stop' };
  if (item.reason === 'stopped') return { text: r.stopped, tone: 'off' };
  switch (item.status) {
    case 'completed':
      return { text: r.completed, tone: 'ok' };
    case 'waiting_user':
      return { text: r.waiting, tone: 'signal' };
    case 'failed':
      return { text: r.failed, tone: 'stop' };
    case 'aborted':
      return { text: r.aborted, tone: 'off' };
  }
}

/** "Social: Iapetus finished", the report as one line (previews, names). */
export function reportSentence(
  item: Pick<Extract<ChatItem, { kind: 'report' }>, 'lead' | 'project' | 'status' | 'reason'>,
  nameOf: (id: string) => string,
  projectName: string = item.project,
): string {
  return deriveStrings().report.sentence(projectName, nameOf(item.lead), reportOutcome(item).text);
}

/* ---------------------------------------------------- events among monsters */

/** Summaries that say nothing more than "finished": "Fatto", "Done", "Ok." (in either language). */
// i18n-ignore: words matched in the monsters' summaries
const EMPTY_SUMMARY =
  /^(fatto|fatta|fatti|finito|finita|completato|completata|eseguito|ok|okay|done|completed|finished|ecco|pronto|pronta)$/;

function comparable(s: string): string {
  return plainText(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * What the summary of a finished task adds to the task itself, or null when it
 * adds nothing ("Fatto", "Done", the task repeated). A leading "Fatto:" is
 * dropped: "Fatto: 5 spunti" → "5 spunti".
 */
export function doneSummary(goal: string, summary: string | undefined): string | null {
  if (!summary) return null;
  // i18n-ignore: the opening words of a summary, in the languages the monsters write in
  const rest = summary
    .trim()
    .replace(/^(fatto|fatta|done|ok|okay|ecco|finito|pronto)\s*[:!.,—–-]+\s*/i, '');
  const s = comparable(rest);
  if (!s || EMPTY_SUMMARY.test(s)) return null;
  const g = comparable(goal);
  if (s === g || (g.length > 0 && g.startsWith(s))) return null;
  return taskText(rest);
}

/** One row of the chat: an item, or a run of events among monsters folded into one line. */
export type ChatRow<T> = { kind: 'one'; row: T } | { kind: 'group'; id: string; rows: T[] };

/** The rows that fold when they come in a row: tasks among monsters and what the instinct said. */
const FOLDABLE = new Set<ChatItem['kind']>(['delegation', 'instinct']);

/** How many events among monsters in a row fold into one line ("4 compiti completati"). */
export const GROUP_MIN = 3;

/**
 * Folds runs of at least `min` event rows in a row (tasks among monsters, instinct lines; nothing
 * else between them) into one group; everything else stays as it is, in order.
 */
export function groupDelegations<T>(
  rows: readonly T[],
  itemOf: (row: T) => ChatItem,
  min = GROUP_MIN,
  /** Which rows may fold: by default every task and instinct line (a chat can say "not this one"). */
  canFold: (item: ChatItem) => boolean = (item) => FOLDABLE.has(item.kind),
): ChatRow<T>[] {
  const out: ChatRow<T>[] = [];
  let run: T[] = [];
  const flush = () => {
    if (run.length >= min) out.push({ kind: 'group', id: itemOf(run[0]!).id, rows: run });
    else for (const r of run) out.push({ kind: 'one', row: r });
    run = [];
  };
  for (const r of rows) {
    if (canFold(itemOf(r))) run.push(r);
    else {
      flush();
      out.push({ kind: 'one', row: r });
    }
  }
  flush();
  return out;
}

/** The line of a group of delegations: "4 tasks completed", "3 tasks: 2 completed and 1 in progress". */
export function delegationGroupLabel(items: readonly ChatItem[]): string {
  const g = deriveStrings().group;
  let done = 0;
  let open = 0;
  let other = 0;
  for (const it of items) {
    if (it.kind !== 'delegation') continue;
    if (it.status === 'completed') done++;
    else if (it.status === 'started') open++;
    else other++;
  }
  const total = done + open + other;
  // Lines of the instinct among the tasks: said as events, not counted as tasks.
  if (items.some((it) => it.kind === 'instinct')) return g.events(items.length);
  if (done === total) return g.done(total);
  if (open === total) return g.open(total);
  const parts = [
    done > 0 ? g.partDone(done) : '',
    open > 0 ? g.partOpen(open) : '',
    other > 0 ? g.partOther(other) : '',
  ].filter(Boolean);
  return g.mixed(total, listText(parts));
}

/* ------------------------------------------------------------------ notes */

/** What the event log says about the notes: where each one is now, and which are in the trash. */
export interface NoteIndex {
  /** Latest path of a note by its key (`noteKey`: the name, lower case). */
  pathOf: ReadonlyMap<string, string>;
  /** Keys of the notes whose latest change moved them to the trash. */
  trashed: ReadonlySet<string>;
}

let noteCache: { events: readonly LogEvent[]; index: NoteIndex } | null = null;

/** The `NoteIndex` of the log, computed once per list of events. */
export function noteIndex(events: readonly LogEvent[]): NoteIndex {
  if (noteCache?.events === events) return noteCache.index;
  const pathOf = new Map<string, string>();
  const trashed = new Set<string>();
  for (const e of events) {
    if (e.type !== 'vault_change' || agentFileOf(e.data.path)) continue;
    const key = noteKey(e.data.path);
    switch (e.data.action) {
      case 'delete':
        trashed.add(key);
        break;
      case 'create':
      case 'edit':
      case 'restore':
      case 'move':
        trashed.delete(key);
        pathOf.set(key, e.data.path);
        if (e.data.action === 'move' && e.data.fromPath) {
          const from = noteKey(e.data.fromPath);
          if (from !== key) pathOf.delete(from);
        }
        break;
      default:
        break;
    }
  }
  const index = { pathOf, trashed };
  noteCache = { events, index };
  return index;
}

/* --------------------------------------------------------- descriptions */

export type EventCategory =
  | 'messages'
  | 'runs'
  | 'delegations'
  | 'tools'
  | 'questions'
  | 'vault'
  | 'errors'
  | 'instinct'
  | 'system';

export function categoryOf(e: LogEvent): EventCategory {
  switch (e.type) {
    case 'message':
    case 'new_conversation':
    case 'conversation_summary':
      return 'messages';
    case 'delegation':
      return 'delegations';
    case 'provider_usage':
      // A question of the instinct to Jev (TypeSafe) is the instinct at work, not a tool.
      return e.data.provider === 'typesafe' ? 'instinct' : 'tools';
    case 'tool_call':
    case 'tool_result':
      return 'tools';
    case 'question':
    case 'answer':
    case 'question_expired':
    case 'question_parked':
      return 'questions';
    case 'decision':
      // An answer of the instinct (D-067) is its dataset, not a question for the user.
      if (e.data.use) return 'instinct';
      return e.data.kind === 'team_proposal' || e.data.kind === 'notify' ? 'system' : 'questions';
    case 'instinct':
    case 'security':
      return 'instinct';
    case 'spend':
      return 'errors';
    case 'receipt':
      return 'runs';
    case 'vault_change':
      return 'vault';
    case 'error':
      // A stop is part of a run's story, a fallback is the tools working around a problem.
      if (e.data.code === 'search_fallback' || e.data.code === 'provider_fallback') return 'tools';
      // Semantic search not installed (D-046), and what an older core still logs as an error but
      // is news (a `notice` now): how this installation is, not a failure.
      if (NOTICE_CODES.has(e.data.code ?? '')) return 'system';
      return isQuietError(e) ? 'runs' : 'errors';
    case 'run':
      return 'runs';
    case 'mcp_server':
      return e.data.action === 'failed' || e.data.action === 'needs_signin' ? 'errors' : 'system';
    default:
      return 'system';
  }
}

/** The name of an event category. */
export function categoryLabel(category: EventCategory): string {
  return deriveStrings().category[category];
}

/**
 * "Rhea updated their notes": changes to the files agents keep for
 * themselves (their memory, the state of their work), never called notes.
 */
export function agentFileText(path: string, action: string): string | null {
  const f = agentFileOf(path);
  if (!f) return null;
  const s = deriveStrings();
  const writes = action === 'create' || action === 'edit';
  if (f.kind === 'memory')
    return writes
      ? s.agentFile.memoryUpdated(f.owner)
      : s.agentFile.memoryOther(f.owner, s.vault.notesParticiple(action));
  if (f.kind === 'state')
    return writes
      ? s.agentFile.stateUpdated(f.owner)
      : s.agentFile.stateOther(f.owner, s.vault.noteParticiple(action));
  return writes
    ? s.agentFile.workUpdated(f.owner, baseName(path))
    : s.agentFile.workOther(f.owner, baseName(path), s.vault.noteParticiple(action));
}

/** The statuses and error codes that mean a limit of a job or of a monster stopped it. */
export const LIMIT_CODES: ReadonlySet<string> = new Set(['run_limit', 'token_limit', 'max_steps']);

/** The limit as the sentence's reason ("the job used all its 400 steps…"); `code` when the core sent none. */
function limitWhy(code: string, limit: LimitReason | undefined): string {
  const w = deriveStrings().error.limit.why;
  const n = (v: number | undefined) => formatNumber(v ?? 0);
  const plan = limit?.plan === true;
  switch (limit?.kind) {
    case 'steps':
      return w.steps(n(limit.value), plan);
    case 'tokens':
      return w.tokens(n(limit.value), plan);
    case 'cost':
      return w.cost(formatNumber(limit.value ?? 0, { maximumFractionDigits: 2 }));
    case 'tree_cost':
      return w.treeCost(formatNumber(limit.value ?? 0, { maximumFractionDigits: 2 }));
    case 'agent_tokens':
      return w.agentTokens(n(limit.value), plan);
    case 'agent_steps':
      return w.agentSteps(n(limit.value));
    default:
      return code === 'token_limit' ? w.tokenLimit : code === 'max_steps' ? w.maxSteps : w.runLimit;
  }
}

/** The limits that can be raised in Settings → … → Limits of each job (the others are a monster's own). */
function raisable(limit: LimitReason | undefined): boolean {
  switch (limit?.kind) {
    case 'steps':
    case 'tokens':
    case 'cost':
    case 'tree_cost':
      return true;
    case 'agent_tokens':
      return limit.own !== true;
    default:
      return false;
  }
}

/**
 * The exact reason a job stopped at a limit, and where to change it: "Franco stops here: the job
 * used all its 400 steps on the subscription. You can raise the limit in Settings → Models →
 * Spending cap → Limits of each job." Null when the core gave no `limit` (an older event) or it
 * was the spending cap (its own message says it).
 */
export function limitStopSentence(
  who: string,
  code: string,
  limit: LimitReason | undefined,
): string | null {
  if (!limit || limit.kind === 'spend') return null;
  return deriveStrings().error.limit.stopsHere(
    who,
    limitWhy(code, limit),
    raisable(limit) ? settingsPath('limiti') : null,
  );
}

/**
 * What a delegation that stopped at a limit says (the `error` of the event is the core's English
 * for the model): the reason and whether the monster still wrote a report. Null when the
 * delegation did not stop at a limit.
 */
export function delegationLimitSentence(
  d: {
    status: string;
    runStatus?: string | undefined;
    limit?: LimitReason | undefined;
    summary?: string | undefined;
  },
  who: string,
): string | null {
  const code = d.runStatus;
  if (!code || !LIMIT_CODES.has(code) || (d.status !== 'failed' && d.status !== 'aborted'))
    return null;
  const s = deriveStrings().error.limit;
  const reason =
    d.limit?.kind === 'spend'
      ? null
      : (limitStopSentence(who, code, d.limit) ??
        s.stopsHere(who, limitWhy(code, undefined), null));
  if (!reason) return null;
  return `${reason} ${d.summary?.trim() ? s.partial : s.noReport}`;
}

/** Plain sentence for an `error` event (codes from the core and the tools). */
export function errorSentence(
  e: {
    agent: string;
    data: { code?: string | undefined; message: string; limit?: LimitReason | undefined };
  },
  nameOf: (id: string) => string,
): string {
  const s = deriveStrings().error;
  const who = nameOf(e.agent);
  const msg = e.data.message;
  switch (e.data.code) {
    case 'aborted':
      return s.stopped(who);
    case 'search_fallback': {
      const to = /→\s*(\w+)\s*$/.exec(msg)?.[1]?.toLowerCase();
      return s.searchFallback(
        who,
        to === 'wikipedia' || to === 'duckduckgo' || to === 'brave' ? to : null,
      );
    }
    case 'provider_fallback':
      // i18n-ignore: "→ nessuno" / "→ none", the end of the core's fallback line
      return /→ (?:nessuno|none)\b/.test(msg)
        ? s.noAlternative(who, lowerFirst(msg))
        : s.switchModel(who);
    case 'orphan_processes':
      return s.orphans;
    case 'kill_hook':
      return s.killHook;
    case 'http_500':
      return s.internal;
    case 'run_limit':
      // The spending cap (D-070) stops a job in the middle with the same code: its words say so.
      // i18n-ignore: "tetto di spesa" / "spending cap", in the core's message
      if (/tetto di spesa|spending cap/i.test(msg)) return msg.replace(/\.$/, '');
      return limitStopSentence(who, 'run_limit', e.data.limit) ?? s.runLimit(who);
    case 'token_limit':
    case 'max_steps': {
      const exact = limitStopSentence(who, e.data.code, e.data.limit);
      if (exact) return exact;
      if (isStopText(msg)) return s.stopped(who);
      return e.agent === 'system' ? msg : s.problem(who, lowerFirst(msg));
    }
    case 'spend_cap':
      return msg.replace(/\.$/, '');
    case 'context_guard':
      return s.contextGuard(who);
    case 'answer_truncated':
      return s.truncated(who);
    case 'context_rescue':
      return s.contextRescue(who);
    case 'compaction_failed':
      return s.compactionFailed(who);
    default:
      if (isStopText(msg)) return s.stopped(who);
      return e.agent === 'system' ? msg : s.problem(who, lowerFirst(msg));
  }
}

/**
 * The empty message that closes the text of a turn that did not finish
 * (`status: aborted|failed`, D-024): not an answer, the stop or the error says
 * what happened.
 */
export function isEmptyClosing(e: LogEvent): boolean {
  return e.type === 'message' && e.data.status !== undefined && !e.data.text.trim();
}

/**
 * Drops the `aborted` error of an agent whose run also logged `run: aborted`
 * (both would read "Bruno’s work stopped") and the empty message
 * closing a turn that did not finish (it would read "Bruno replied"). The
 * full events stay in the log's data; this is only for the lists the user reads.
 */
export function withoutRepeatedStops(events: readonly LogEvent[]): LogEvent[] {
  const stopped = new Set<string>();
  for (const e of events)
    if (e.type === 'run' && e.data.status === 'aborted') stopped.add(`${e.agent}|${e.runId ?? ''}`);
  return events.filter(
    (e) =>
      !isEmptyClosing(e) &&
      !(
        e.type === 'error' &&
        (e.data.code === 'aborted' || isStopText(e.data.message)) &&
        stopped.has(`${e.agent}|${e.runId ?? ''}`)
      ),
  );
}

/**
 * A message after a colon starts in lower case ("had a problem: the
 * sheet…"). Only when it opens with a common word: names and acronyms
 * ("Telegram", "API") keep their capital.
 */
// i18n-ignore: opening words of the core's messages, old ones in Italian and new ones in English
const ITALIAN_OPENERS =
  /^(Il|Lo|La|Le|Gli|L’|L'|Un|Uno|Una|Non|Nessun|Nessuna|Questo|Questa|Troppi|Troppe|Manca|Mancano|Impossibile|Errore|C’è|Ci)(?=[\s’'])/;
// i18n-ignore: the Italian article "I" opens "I file…"; the English pronoun keeps its capital
const ITALIAN_ARTICLE = /^I(?=[\s’'])/;
// i18n-ignore: opening words of the core's English messages
const ENGLISH_OPENERS =
  /^(The|A|An|This|That|There|No|Not|Too|Missing|Unable|Invalid|Error|Could|Couldn’t|Can’t|Cannot)(?=[\s’'])/;
export function lowerFirst(text: string): string {
  const common =
    ITALIAN_OPENERS.test(text) ||
    (appLang() === 'it' ? ITALIAN_ARTICLE.test(text) : ENGLISH_OPENERS.test(text));
  return common ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * Codes that a core before the `notice` event (the leftover of C-11) logged as `error` although
 * nothing failed: read as notices, also from old logs and from an older core in client mode.
 */
const NOTICE_CODES = new Set([
  'semantic_off',
  'retired_model',
  'project_connections_reset',
  'project_connections_stale',
  'mcp_tools_limited',
]);

/** True for `error` events that are not problems: a stop or an automatic fallback. */
export function isQuietError(e: LogEvent): boolean {
  if (e.type !== 'error') return false;
  const code = e.data.code;
  return (
    code === 'aborted' ||
    code === 'search_fallback' ||
    code === 'provider_fallback' ||
    NOTICE_CODES.has(code ?? '') ||
    // Why one attempt at the team proposal failed: for a diagnosis, the user reads `onboarding`.
    code === 'onboarding_attempt' ||
    // The window kept in check (D-082): automatic, the run goes on.
    code === 'context_guard' ||
    code === 'context_rescue' ||
    code === 'compaction_failed' ||
    isStopText(e.data.message)
  );
}

/** A delegated task as a short readable line (models write it in Markdown, sometimes long). */
export function taskText(goal: string, n = 140): string {
  return clipText(plainText(goal), n);
}

/** One sentence on what changed after an action whose undo was refused. */
export function undoConflictText(files: readonly string[]): string {
  return deriveStrings().error.undoConflict(files.map((f) => `“${baseName(f)}”`));
}

/**
 * Vault changes that are the user's notes: not the agents' own files
 * (`Agenti/<Nome>/MEMORY.md`…) nor the housekeeping of Monsters itself.
 */
export function isUserNoteChange(e: LogEvent): boolean {
  return e.type === 'vault_change' && e.agent !== 'system' && !agentFileOf(e.data.path);
}

/** "Bruno", "Bruno and Rhea", "Bruno, Rhea and Dione". */
export function listText(items: readonly string[]): string {
  return deriveStrings().list(items);
}

/** Owners of the memories updated most recently (newest first, no repeats). */
export function recentMemoryOwners(events: readonly LogEvent[], max = 3): string[] {
  const out: string[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < max; i--) {
    const e = events[i]!;
    if (e.type !== 'vault_change' || e.agent === 'system') continue;
    if (e.data.action !== 'create' && e.data.action !== 'edit') continue;
    const f = agentFileOf(e.data.path);
    if (f?.kind === 'memory' && !out.includes(f.owner)) out.push(f.owner);
  }
  return out;
}

/** Vault actions that can be undone from the UI. */
export function isUndoable(e: LogEvent): boolean {
  return (
    e.type === 'vault_change' &&
    !!e.data.actionId &&
    ['create', 'edit', 'move', 'delete'].includes(e.data.action)
  );
}

/** A remote channel (Telegram) in words: connection, pairing, ignored messages. */
function channelSentence(d: EventDataMap['channel']): string {
  const s = deriveStrings().channel;
  const who = d.name ?? (d.userId ? s.account(String(d.userId)) : s.someone);
  switch (d.action) {
    case 'connected':
      return s.telegramConnected(d.name);
    case 'disconnected': {
      // A dedicated bot says which one it is (the event carries `bot`).
      const bot = s.bot(!!d.bot, d.name);
      return d.reason === 'conflict'
        ? s.conflict(bot)
        : d.reason === 'error'
          ? s.stoppedBot(bot)
          : s.noAnswer(bot);
    }
    case 'ignored':
      return s.ignored(who, s.ignoredReason[d.reason ?? ''] ?? d.reason ?? s.notAllowed);
    case 'paired':
      return s.paired(who);
    case 'pairing_failed':
      return s.pairingFailed(who);
    case 'pairing_started':
      return s.pairingStarted;
    case 'user_removed':
      return s.userRemoved(who);
    case 'token_set':
      return s.tokenSet(d.name);
    case 'token_removed':
      return s.tokenRemoved;
    case 'token_check_failed':
      return d.reason === 'refused_token' ? s.tokenRefused : s.tokenUnchecked;
    // Bots dedicated to one monster (D-107).
    case 'bot_added':
      return s.botAdded(d.name);
    case 'bot_removed':
      return s.botRemoved(d.name);
    case 'bot_changed':
      return s.botChanged;
    case 'chat_pending':
      return s.chatPending(d.name);
    case 'chat_approved':
      return s.chatApproved(d.name);
    case 'chat_removed':
      return s.chatRemoved(d.name);
    case 'person_pending':
      return s.personPending(who);
    case 'person_approved':
      return s.personApproved(who);
    case 'person_removed':
      return s.personRemoved(who);
    case 'limit_reached':
      return s.limitReached;
    case 'chat_migrated':
      return s.chatMigrated(d.name);
    case 'chat_left':
      return d.chatId ? s.chatLeft(d.name) : s.blocked(who);
  }
}

/** A choice logged by the DecisionGate, the onboarding or an answer, in words. */
function describeDecision(d: EventDataMap['decision'], who: string): string {
  const s = deriveStrings().decision;
  if (d.use) {
    // The instinct asked itself something (its dataset): what about, not the raw answer.
    const label = labelOfUse(d.use);
    const what = label ? label.charAt(0).toLowerCase() + label.slice(1) : s.quick;
    return s.instinct(who !== 'Monsters' ? s.forWho(who) : '', what, d.mode === 'shadow');
  }
  switch (d.kind) {
    case 'user_choice':
      return s.userChoice(clipText(plainText(d.choice), 80));
    case 'team_proposal':
      return s.teamProposal(d.choice);
    case 'notify':
      return d.choice === 'now'
        ? s.notifyNow
        : d.choice === 'silent'
          ? s.notifySilent
          : d.choice === 'later'
            ? s.notifyLater
            : s.notifyNone;
    case 'ask_or_proceed':
      return d.choice === 'ask_user'
        ? s.askUser(who)
        : s.proceed(who, clipText(plainText(d.choice), 80));
    default:
      return s.chose(who, clipText(plainText(d.choice), 80));
  }
}

/** One plain sentence for an event, as in "Rhea created the note Ideas". */
export function describeEvent(e: LogEvent, nameOf: (id: string) => string): string {
  const s = deriveStrings().event;
  const who = nameOf(e.agent);
  switch (e.type) {
    case 'message':
      if (e.data.role === 'user') return e.data.to ? s.wroteTo(nameOf(e.data.to)) : s.wroteMessage;
      if (e.data.partial) return s.writing(who);
      // The closing of a turn that did not finish is not an answer.
      if (e.data.status === 'aborted') return s.stoppedWriting(who);
      if (e.data.status === 'failed') return s.didNotFinishWriting(who);
      return s.replied(who);
    case 'delegation': {
      const to = nameOf(e.data.to);
      const from = nameOf(e.data.from);
      switch (e.data.status) {
        case 'started':
          return s.handedTask(from, to, taskText(e.data.goal, 90));
        case 'completed':
          return s.taskDone(to, from);
        case 'failed':
          return s.taskFailed(to, from);
        default:
          return s.taskStopped(to, from);
      }
    }
    case 'tool_call':
      return s.toolCall(who, describeTool(e.data.tool, e.data.input).replace(/…$/, ''));
    case 'tool_result':
      if (e.data.ok) return s.toolDone(who, toolAction(e.data.tool));
      return isStopText(e.data.error)
        ? s.toolHalf(who, toolAction(e.data.tool))
        : s.toolFailed(who, toolAction(e.data.tool));
    case 'decision':
      return describeDecision(e.data, who);
    case 'question':
      return s.question(who);
    case 'answer':
      return s.answer;
    case 'question_expired':
      return s.questionExpired(who);
    case 'question_parked':
      return s.questionParked(who);
    case 'new_conversation':
      return e.data.to ? s.newConversationWith(nameOf(e.data.to)) : s.newConversation;
    case 'conversation_summary':
      return s.summary(who, e.data.turns);
    case 'vault_change': {
      const own = agentFileText(e.data.path, e.data.action);
      if (own) {
        const owner = agentFileOf(e.data.path)?.owner.toLowerCase();
        return e.agent === 'system' || who.toLowerCase() === owner ? own : `${own} (${who})`;
      }
      return deriveStrings().vault.change(
        e.data.action,
        e.agent === 'user' ? null : who,
        baseName(e.data.path),
      );
    }
    case 'provider_usage':
      if (e.data.provider === 'typesafe') return s.typesafe(who);
      if (e.data.purpose === 'compaction') return s.compaction(who, modelLabel(e.data.model));
      if (e.data.provider === WEB_SEARCH_USAGE_PROVIDER) return s.webSearch(who);
      return s.usedModel(who, modelLabel(e.data.model));
    case 'error':
      return errorSentence(e, nameOf);
    // Something Monsters did or found on its own (the leftover of C-11): its own sentence.
    case 'notice':
      return e.data.message;
    case 'kill':
      switch (e.data.scope) {
        case 'global':
          return s.killAll;
        case 'agent':
          return s.killAgent(nameOf(e.data.target ?? e.agent));
        case 'run':
          return s.killRun;
        default:
          return s.killTool;
      }
    case 'resume':
      return s.resumed;
    case 'run':
      switch (e.data.status) {
        case 'started':
          return s.runStarted(who);
        case 'completed':
          return s.runCompleted(who);
        case 'waiting_user':
          return s.runWaiting(who);
        case 'failed':
          return s.runFailed(who);
        default:
          return e.data.reason === 'restart' || e.data.reason === 'shutdown'
            ? s.runRestart(who)
            : s.runStopped(who);
      }
    case 'auth':
      return s.auth[e.data.action] ?? s.auth['other']!;
    case 'team_change': {
      const name = e.data.name ?? (e.data.agent ? nameOf(e.data.agent) : s.aMonster);
      switch (e.data.action) {
        case 'add':
          return s.teamAdd(name);
        case 'rename':
          return s.teamRename(e.data.from, name);
        case 'edit':
          return s.teamEdit(name);
        case 'look':
          return s.teamLook(name);
        case 'archive':
          return s.teamArchive(name);
        case 'restore':
          return s.teamRestore(name);
        default:
          return s.teamOther;
      }
    }
    case 'permissions':
      return e.data.target === 'defaults'
        ? s.permissionsDefaults
        : s.permissionsOf(nameOf(e.data.target));
    case 'channel':
      return channelSentence(e.data);
    case 'memory': {
      if (e.data.action === 'over_limit') return s.memoryOverLimit(who);
      const things = s.memoryThings(e.data.lines?.length ?? 0);
      // Lines of a run that is not only the user's wait for a confirmation (review 18/10, A2).
      if (e.data.action === 'proposed') return s.memoryProposed(who, things);
      if (e.data.action === 'discarded') return s.memoryDiscarded(who);
      return s.memoryRemembers(who, things);
    }
    case 'mcp_server': {
      const name = e.data.server === 'browser' ? s.mcpBrowser : s.mcpApp(e.data.server);
      switch (e.data.action) {
        case 'added':
          return e.data.server === 'browser' ? s.mcpBrowserOn : s.mcpAdded(name);
        case 'changed':
          return s.mcpChanged(name);
        case 'removed':
          return s.mcpRemoved(name);
        case 'connected':
          return s.mcpConnected(name);
        case 'disconnected':
          return s.mcpDisconnected(name);
        case 'signed_in':
          return s.mcpSignedIn(name);
        case 'signed_out':
          return s.mcpSignedOut(name);
        case 'tools_updated':
          return e.data.message ?? s.mcpToolsUpdated(name);
        case 'needs_signin':
          return s.mcpNeedsSignin(name);
        default:
          return s.mcpFailed(name);
      }
    }
    // The instinct (D-067): said again from its fields, in neutral forms (store/instinct.ts).
    case 'instinct':
      return instinctSentence(e.data, nameOf);
    case 'security':
      return securitySentence(e.data);
    case 'receipt':
      return s.receipt(nameOf(e.data.agent), receiptSummary(e.data));
    case 'spend':
      return e.data.message;
    case 'monster_proposal': {
      const name = e.data.name ?? e.data.draft?.name ?? s.aMonster;
      const from = nameOf(e.data.from);
      if (e.data.action === 'proposed') return s.monsterProposed(from, name);
      if (e.data.action === 'created') return s.monsterCreated(name, from);
      return s.monsterDropped(from, name);
    }
    case 'project_docs_proposal': {
      const what = s.docsWhat(e.data.name, e.data.file);
      const from = nameOf(e.data.from);
      if (e.data.action === 'proposed') return s.docsProposed(from, what);
      if (e.data.action === 'applied') return s.docsApplied(from, what);
      if (e.data.action === 'superseded') return s.docsSuperseded(from, what);
      return s.docsDropped(from, what);
    }
    case 'preview':
      return e.data.item.kind === 'note'
        ? s.previewNote(nameOf(e.agent), e.data.name)
        : s.previewFile(nameOf(e.agent), e.data.name);
    case 'file':
      return fileSentence(e.data, who);
    // Automations (D-094): the menu of the next wave shows them in full.
    case 'automation_run_started':
      return s.automationStarted(e.data.name, who);
    case 'automation_run_finished':
      return e.data.status === 'completed'
        ? s.automationDone(e.data.name)
        : e.data.status === 'waiting_user'
          ? s.automationWaiting(e.data.name)
          : s.automationFailed(e.data.name);
    case 'automation_run_skipped':
      return s.automationSkipped(e.data.name, e.data.message);
    case 'automation_change':
      return s.automationChange(e.data.name, e.data.action);
    // Projects (D-097): the project pages of the next wave show them in full.
    case 'project_change':
      return s.projectChange(e.data.name, e.data.action, nameOf(e.data.agent ?? ''));
    case 'project_report':
      return s.projectReport(nameOf(e.data.lead), nameOf(e.data.to));
    case 'log_archive':
      return s.logArchive(e.data.events, e.data.dir);
    // An access a capo asked for (D-130): the user's tap, applied by the core.
    case 'access_grant':
      return e.data.outcome === 'granted'
        ? s.accessGranted(e.data.summary, nameOf(e.data.from))
        : e.data.outcome === 'denied'
          ? s.accessDenied(e.data.summary, nameOf(e.data.from))
          : s.accessFailed(e.data.summary, e.data.message);
  }
}

/** "Rhea saved a screenshot", "Dione created a page: Prices". */
export function fileSentence(f: FileEventData, who: string): string {
  const s = deriveStrings().event;
  if (f.action === 'deleted') return s.fileDeleted(f.name);
  if (f.kind === 'html') return s.fileHtml(who, f.title);
  if (f.source === 'tool' && f.kind === 'image') return s.fileScreenshot(who);
  return s.fileSaved(who, f.name);
}

/** Display name lookup with sensible fallbacks for reserved actors. */
export function makeNameOf(agents: Record<string, AgentSummary>) {
  return (id: string) => {
    if (id === 'user') return deriveStrings().chat.you;
    if (id === 'system') return 'Monsters';
    return agents[id]?.name ?? capitalize(id);
  };
}

/* ------------------------------------------------------- instrumentation */

/*
 * The instrumentation of the chat (docs/design.md, "Strumentazione"): under the
 * last bubble of a monster's turn, one line in Martian Mono with the tools of
 * the run, its time, its cost and the model; on the monster's monitor the sum
 * of the conversation. Built from the events of the run only: what is unknown
 * is left out, never guessed.
 */

/** "Web search", "Browser", "Github" (an MCP server by its name). */
export function toolShort(tool: string): string {
  const s = deriveStrings();
  if (tool.startsWith('mcp__browser__')) return s.browserShort;
  const mcp = /^mcp__(.+?)__/.exec(tool);
  if (mcp) return capitalize(mcp[1]!.replace(/[_-]+/g, ' '));
  return s.toolShort[tool] ?? toolLabel(tool);
}

/**
 * A model id as the instrument names it: no provider, no `:free`, no
 * `-instruct`, words apart, versions with a dot ("claude-sonnet-4-5" → "claude
 * sonnet 4.5", "meta-llama/llama-3.3-70b-instruct:free" → "llama 3.3 70b").
 */
export function modelShort(model: string): string | null {
  // The free router picks a model it does not name: "free" already says it all.
  if (model === 'openrouter/free') return null;
  const name = (model.split('/').pop() ?? model).replace(/:free$/, '');
  return modelWords(name);
}

/** "0.8 s", "4.1 s", "41 s", "2 min 05 s", "1 h 12 min" ("0,8 s" in Italian). */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = ms / 1000;
  if (s < 10) return `${formatNumber(s, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
  const total = Math.round(s);
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min ${String(total % 60).padStart(2, '0')} s`;
}

/** What one run did, from its events. */
export interface RunStats {
  runId: string;
  /** Tools by short name, in the order of first use, with how many calls. */
  tools: { name: string; count: number }[];
  /** All the tool calls of the run (every monster in it). */
  toolCalls: number;
  /** From `run started` to its end; undefined while it runs or when the start is missing. */
  durationMs?: number | undefined;
  /** Sum of the reported costs; undefined when no request reported one. */
  costUsd?: number | undefined;
  /** Every request of the run went to a model that never costs anything. */
  free: boolean;
  /** Last model per agent that answered in the run. */
  models: Record<string, string>;
  /** The last model of the run, whoever used it. */
  lastModel?: string | undefined;
  /** Engine of the last web search of the run ("OpenRouter", "Wikipedia"…), D-071. */
  searchEngine?: string | undefined;
  /** The run ended (completed, failed, stopped). */
  ended: boolean;
  /** Time of its first event: which conversation it belongs to. */
  firstTs: number;
}

/** Search engines by the `backend` id of a `web_search` result, as the instrument names them. */
const SEARCH_ENGINES: Record<string, string> = {
  'openrouter-parallel': 'OpenRouter',
  'openrouter-exa': 'OpenRouter Exa',
  duckduckgo: 'DuckDuckGo',
  wikipedia: 'Wikipedia',
  brave: 'Brave',
  searxng: 'SearXNG',
};

/** The engine of a logged `web_search` output (whole, or the preview of a long one). */
export function searchEngineOf(output: unknown): string | undefined {
  let id: string | undefined;
  if (output && typeof output === 'object') {
    const o = output as { backend?: unknown; preview?: unknown };
    if (typeof o.backend === 'string') id = o.backend;
    else if (typeof o.preview === 'string') id = /"backend":"([^"]+)"/.exec(o.preview)?.[1];
  }
  if (!id) return undefined;
  const last = id.split(',').pop()!.trim();
  return SEARCH_ENGINES[last] ?? last;
}

function isFreeModel(id: string | undefined): boolean {
  return !!id && (id === 'openrouter/free' || id.endsWith(':free'));
}

/** Stats of every run in the log, in one pass. */
export const runStatsIndex = onceFor((events): Map<string, RunStats> => {
  const out = new Map<string, RunStats>();
  const started = new Map<string, number>();
  const requests = new Map<string, number>();
  const get = (runId: string, ts: number): RunStats => {
    let s = out.get(runId);
    if (!s) {
      s = { runId, tools: [], toolCalls: 0, free: false, models: {}, ended: false, firstTs: ts };
      out.set(runId, s);
    }
    return s;
  };
  for (const e of events) {
    const runId = e.runId;
    if (!runId) continue;
    get(runId, e.ts);
    switch (e.type) {
      case 'run': {
        const s = get(runId, e.ts);
        if (e.data.status === 'started') {
          if (!started.has(runId)) started.set(runId, e.ts);
          s.ended = false;
          s.durationMs = undefined;
        } else {
          s.ended = true;
          const t0 = started.get(runId);
          if (t0 !== undefined) s.durationMs = Math.max(0, e.ts - t0);
        }
        break;
      }
      case 'tool_call': {
        const s = get(runId, e.ts);
        const name = toolShort(e.data.tool);
        const hit = s.tools.find((t) => t.name === name);
        if (hit) hit.count++;
        else s.tools.push({ name, count: 1 });
        s.toolCalls++;
        break;
      }
      case 'tool_result': {
        if (e.data.tool !== 'web_search' || !e.data.ok) break;
        const engine = searchEngineOf(e.data.output);
        if (engine) get(runId, e.ts).searchEngine = engine;
        break;
      }
      case 'provider_usage': {
        const s = get(runId, e.ts);
        const d = e.data;
        // A question of the instinct (Jev) or a paid web search (D-071): its cost
        // counts, it is not the model of the turn.
        if (
          d.provider === 'typesafe' ||
          d.provider === WEB_SEARCH_USAGE_PROVIDER ||
          d.purpose === 'compaction'
        ) {
          if (d.costUsd !== undefined) s.costUsd = (s.costUsd ?? 0) + d.costUsd;
          break;
        }
        const n = (requests.get(runId) ?? 0) + 1;
        requests.set(runId, n);
        const free = isFreeModel(d.model) || isFreeModel(d.requestedModel);
        s.free = n === 1 ? free : s.free && free;
        if (d.costUsd !== undefined) s.costUsd = (s.costUsd ?? 0) + d.costUsd;
        s.models[e.agent] = d.model;
        s.lastModel = d.model;
        break;
      }
      default:
        break;
    }
  }
  return out;
});

/** The cost as the instrument says it: "free" on free models (or a reported 0), else dollars. */
export function costText(s: { costUsd?: number | undefined; free: boolean }): string | null {
  const free = deriveStrings().instrumentation.free;
  if (s.free && !s.costUsd) return free;
  if (s.costUsd === undefined) return null;
  return s.costUsd === 0 ? free : formatUsd(s.costUsd);
}

/**
 * The instrumentation line of a turn: "Titan › Delegation ×2 · Web search ×3 ·
 * 4.1 s · free · llama 3.3 70b" (the UI shows it in upper case). Unknown
 * parts are left out; null when nothing is known beyond the name.
 */
export function instrumentationLine(
  stats: RunStats | undefined,
  name: string,
  agentId?: string,
): string | null {
  if (!stats) return null;
  const parts = stats.tools.map((t) => {
    const text = t.count > 1 ? `${t.name} ×${t.count}` : t.name;
    // Which engine answered the searches: a free one that got blocked shows here (D-071).
    return t.name === toolShort('web_search') && stats.searchEngine
      ? `${text} (${stats.searchEngine})`
      : text;
  });
  if (stats.durationMs !== undefined) parts.push(formatDuration(stats.durationMs));
  const cost = costText(stats);
  if (cost) parts.push(cost);
  const model = (agentId ? stats.models[agentId] : undefined) ?? stats.lastModel;
  const short = model ? modelShort(model) : null;
  if (short) parts.push(short);
  return parts.length > 0 ? `${name} › ${parts.join(' · ')}` : null;
}

/** The sum of the runs of a conversation, for the monster's monitor. */
export interface RunsSum {
  runs: number;
  toolCalls: number;
  durationMs: number;
  costUsd?: number | undefined;
  free: boolean;
}

export function sumRuns(list: readonly RunStats[]): RunsSum {
  let toolCalls = 0;
  let durationMs = 0;
  let costUsd: number | undefined;
  let priced = 0;
  let allFree = true;
  for (const s of list) {
    toolCalls += s.toolCalls;
    durationMs += s.durationMs ?? 0;
    if (s.costUsd !== undefined) costUsd = (costUsd ?? 0) + s.costUsd;
    // Runs without a model request say nothing about the cost.
    if (s.lastModel === undefined && s.costUsd === undefined) continue;
    priced++;
    allFree &&= s.free;
  }
  return { runs: list.length, toolCalls, durationMs, costUsd, free: priced > 0 && allFree };
}

/** "3 tools · 4.1 s · free" (shown in upper case); null for a conversation with no runs. */
export function conversationLine(sum: RunsSum): string | null {
  if (sum.runs === 0) return null;
  const parts = [deriveStrings().instrumentation.tools(sum.toolCalls)];
  if (sum.durationMs > 0) parts.push(formatDuration(sum.durationMs));
  const cost = costText(sum);
  if (cost) parts.push(cost);
  return parts.join(' · ');
}

/* ------------------------------------------------- work stopped by Ferma */

// The work the latest Ferma left halfway is read the same way by the core (D-072).
export { haltedWork, requestsOf, resumeText };
export type { HaltedWork, StoppedRequest };

/**
 * What "Riprova" sends for a run that failed: the user's request of the run,
 * else the goal it was started with; to the monster that owned it.
 */
export function retryOf(
  events: readonly LogEvent[],
  runId: string,
): { agent: string; text: string } | null {
  const [request] = requestsOf(events, new Set([runId]));
  if (request)
    return { agent: request.agent, text: deriveStrings().retry(clip(request.text, 600)) };
  const started = events.find(
    (e): e is LogEvent<'run'> =>
      e.type === 'run' && e.runId === runId && e.data.status === 'started',
  );
  const goal = started?.data.goal?.trim();
  return started && goal
    ? { agent: started.agent, text: deriveStrings().retry(clip(goal, 600)) }
    : null;
}

/** "Titan’s question and the work of Rhea": what is left halfway, in words (null: nothing). */
export function haltedWorkText(w: HaltedWork, nameOf: (id: string) => string): string | null {
  const s = deriveStrings().halted;
  const asked = [...new Set(w.questions.map((q) => q.from))];
  const parts: string[] = [];
  if (w.questions.length === 1) parts.push(s.question(nameOf(asked[0]!)));
  else if (w.questions.length > 1)
    parts.push(s.questions(w.questions.length, listText(asked.map(nameOf))));
  // Who asked was waiting for the answer: its "work" is the question.
  const workers = w.agents.filter((a) => !asked.includes(a));
  if (workers.length > 0) parts.push(s.work(listText(workers.map(nameOf))));
  return parts.length > 0 ? listText(parts) : null;
}

/**
 * "the messages for Rhea and Titan": the monsters whose request "Resume and continue" starts
 * again (null: nothing to start again).
 */
export function haltedResumeText(w: HaltedWork, nameOf: (id: string) => string): string | null {
  const who = [...new Set(w.requests.map((r) => r.agent))];
  if (who.length === 0) return null;
  return deriveStrings().halted.messages(w.requests.length, listText(who.map(nameOf)));
}

/* ------------------------------------------------------ automations (D-094) */

/** A giro of an automation its capo is working on now. */
export interface AutomationBusy {
  automationId: string;
  name: string;
  /** The run of the core in progress. */
  runId: string;
  /** The giro (the id of its first run). */
  giro: string;
}

export interface AutomationWork {
  /** Runs of the core that belong to a giro: they are not part of any chat. */
  runs: ReadonlySet<string>;
  /** The giro each capo is working on now, by agent. */
  busy: ReadonlyMap<string, AutomationBusy>;
  /** Giri waiting for an answer of the user. */
  waiting: number;
}

/**
 * The automations in the log: which runs are giri (the chat of the capo does
 * not show them, like the core's `recentConversation`), who is busy with one
 * (its chat says so: a message written now starts after it), and how many
 * giri wait for an answer.
 */
export const automationWork = onceFor((events): AutomationWork => {
  const runs = new Set<string>();
  const open = new Map<string, { agent: string; busy: AutomationBusy }>();
  const giri = new Map<string, 'running' | 'waiting' | 'done'>();
  for (const e of events) {
    if (e.type === 'automation_run_started' && e.runId) {
      runs.add(e.runId);
      open.set(e.runId, {
        agent: e.agent,
        busy: {
          automationId: e.data.automationId,
          name: e.data.name,
          runId: e.runId,
          giro: e.data.giro,
        },
      });
      giri.set(e.data.giro, 'running');
    } else if (e.type === 'automation_run_finished') {
      if (e.runId) open.delete(e.runId);
      giri.set(e.data.giro, e.data.status === 'waiting_user' ? 'waiting' : 'done');
    } else if (e.type === 'run' && e.runId && e.data.status !== 'started') {
      open.delete(e.runId);
    }
  }
  const busy = new Map<string, AutomationBusy>();
  for (const { agent, busy: b } of open.values()) busy.set(agent, b);
  let waiting = 0;
  for (const s of giri.values()) if (s === 'waiting') waiting++;
  return { runs, busy, waiting };
});

/** The events of the chats: everything but the giri of the automations. */
export function withoutAutomationRuns(
  events: readonly LogEvent[],
  runs: ReadonlySet<string>,
): readonly LogEvent[] {
  if (runs.size === 0) return events;
  return events.filter((e) => !e.runId || !runs.has(e.runId));
}

/** The status line of the chat of a capo busy with a giro. */
export function automationBusyText(name: string): string {
  return deriveStrings().automation.busy(name);
}
