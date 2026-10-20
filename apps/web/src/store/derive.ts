import {
  CONFUSED_MIN_MS,
  WEB_SEARCH_USAGE_PROVIDER,
  haltedWork,
  originalRequest,
  requestsOf,
  resumeText,
  type AgentState,
  type AgentSummary,
  type EventDataMap,
  type FileEventData,
  type HaltedWork,
  type LogEvent,
  type PreviewData,
  type ReceiptData,
  type StoppedRequest,
  type TeamDraft,
} from '@monsters/shared';
import { clipText, noteKey, plainText } from '../lib/markdown.ts';
import { formatUsd, modelWords, toName } from '../lib/utils.ts';
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
 * of each monster, the chat timeline and plain-Italian descriptions of events.
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
   * confused face and "sta cambiando strada" until it moves on.
   */
  confused?: boolean | undefined;
}

export const DONE_MS = 4500;

/** The activity of a monster that waits for the user's answer (see `waitsForUser`). */
export const ASKED_ACTIVITY = 'Ti ho fatto una domanda';

/** A confused monster keeps its face at least this long, even if it calls a tool at once (as the core, D-072). */
export const CONFUSED_MS = CONFUSED_MIN_MS;

/** What the monitor and the strips say of a confused monster. */
export const CONFUSED_TEXT = 'sta cambiando strada';

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
  switch (tool) {
    case 'preview_show': {
      const what = str(i['note']) ?? str(i['file']);
      return str(i['note'])
        ? `Ti mostro la nota “${clip(String(what).split('/').pop()!.replace(/\.md$/i, ''), 34)}”`
        : 'Ti mostro un file';
    }
    case 'web_search':
      return str(i['query']) ? `Cerco “${clip(String(i['query']), 34)}”` : 'Cerco sul web';
    case 'web_fetch': {
      const url = str(i['url']);
      if (!url) return 'Leggo una pagina web';
      try {
        return `Leggo ${new URL(url).hostname.replace(/^www\./, '')}`;
      } catch {
        return 'Leggo una pagina web';
      }
    }
    case 'vault_search':
      return str(i['query'])
        ? `Cerco nelle note “${clip(String(i['query']), 26)}”`
        : 'Cerco nelle note';
    case 'vault_read':
      return str(i['path']) ? `Leggo ${baseName(String(i['path']))}` : 'Leggo una nota';
    case 'vault_write':
    case 'vault_create':
      return str(i['path']) ? `Scrivo ${baseName(String(i['path']))}` : 'Scrivo una nota';
    case 'vault_edit':
      return str(i['path']) ? `Sistemo ${baseName(String(i['path']))}` : 'Sistemo una nota';
    case 'vault_delete':
      return 'Butto una nota nel cestino';
    case 'vault_move':
      return str(i['path']) ? `Sposto ${baseName(String(i['path']))}` : 'Sposto una nota';
    case 'vault_list':
      return 'Guardo quali note ci sono';
    case 'vault_links':
      return 'Guardo i collegamenti tra le note';
    case 'vault_tags':
      return 'Guardo i tag delle note';
    case 'vault_history':
      return 'Guardo la storia di una nota';
    case 'vault_restore':
    case 'vault_undo':
      return 'Rimetto a posto una nota';
    case 'vault_propose':
      return 'Ti propongo una modifica';
    case 'vault_apply_proposal':
      return 'Applico una modifica proposta';
    case 'delegate': {
      const to = str(i['to']);
      return to ? `Passo il lavoro ${toName(capitalize(to))}` : 'Passo il lavoro a un collega';
    }
    case 'ask_user':
      return 'Ti faccio una domanda';
    case 'shell':
      return str(i['command']) ? `Eseguo ${clip(String(i['command']), 34)}` : 'Eseguo un comando';
    case 'fs_list':
      return 'Guardo i file in una cartella';
    case 'fs_read':
      return str(i['path']) ? `Leggo ${baseName(String(i['path']))}` : 'Leggo un file';
    case 'fs_write':
      return str(i['path']) ? `Scrivo ${baseName(String(i['path']))}` : 'Scrivo un file';
    case 'fs_move':
      return str(i['from']) ? `Sposto ${baseName(String(i['from']))}` : 'Sposto un file';
    case 'fs_delete':
      return 'Butto un file nel cestino';
    default:
      return describeExternalTool(tool, i) ?? 'Uso uno strumento';
  }
}

/** External tools (MCP, M2.5): `mcp__<server>__<tool>`. */
function describeExternalTool(tool: string, i: Record<string, unknown>): string | null {
  const m = /^mcp__([a-z0-9-]+)__(.+)$/.exec(tool);
  if (!m) return null;
  const [, server = '', name = ''] = m;
  if (server === 'browser') {
    const url = str(i['url']);
    if (name === 'browser_navigate' && url) {
      try {
        return `Apro ${new URL(url).hostname.replace(/^www\./, '')} nel browser`;
      } catch {
        return 'Apro una pagina nel browser';
      }
    }
    return 'Uso il browser';
  }
  return `Uso ${server}: ${clip(name.replace(/_/g, ' '), 30)}`;
}

/**
 * What a tool does, with its article, for sentences that need no gender
 * agreement: "Rhea ha finito la ricerca sul web".
 */
const TOOL_ACTION: Record<string, string> = {
  web_search: 'la ricerca sul web',
  web_fetch: 'la lettura di una pagina',
  vault_search: 'la ricerca nelle note',
  vault_read: 'la lettura di una nota',
  vault_list: 'l’elenco delle note',
  vault_write: 'la scrittura di una nota',
  vault_create: 'la scrittura di una nota',
  vault_edit: 'la modifica di una nota',
  vault_move: 'lo spostamento di una nota',
  vault_delete: 'lo spostamento nel cestino',
  vault_links: 'il controllo dei collegamenti',
  vault_tags: 'il controllo dei tag',
  vault_history: 'il controllo della storia di una nota',
  vault_restore: 'il ripristino di una nota',
  vault_undo: 'l’annullamento di una modifica',
  vault_propose: 'la proposta di modifica',
  vault_apply_proposal: 'la modifica proposta',
  delegate: 'la delega',
  ask_user: 'la domanda',
  team_propose_monster: 'la proposta di un nuovo mostro',
  project_send: 'il lavoro passato a un progetto',
  project_status: 'il controllo dei progetti',
  project_propose: 'la proposta di un progetto',
  automation_propose: 'la proposta di un’automazione',
  shell: 'il comando',
  fs_list: 'l’elenco dei file',
  fs_read: 'la lettura di un file',
  fs_write: 'la scrittura di un file',
  fs_move: 'lo spostamento di un file',
  fs_delete: 'lo spostamento di un file nel cestino',
};

export function toolAction(tool: string): string {
  if (tool.startsWith('mcp__browser__')) return 'l’uso del browser';
  if (tool.startsWith('mcp__')) return 'l’uso di un altro programma';
  return TOOL_ACTION[tool] ?? 'un’operazione';
}

/** Short name of a tool for the terminal: "Ricerca sul web". */
export function toolLabel(tool: string): string {
  return capitalize(toolAction(tool).replace(/^(la |il |lo |l’|un’)/, ''));
}

/** An error text that only says the work was stopped (kill switch, stop of a run). */
export function isStopText(text: string | undefined): boolean {
  return !!text && /^stopped\b|\babort|\bABORTED\b|interrott|si è fermat/i.test(text);
}

/** Display name of a model id: no provider prefix, "(gratis)" for free variants. */
export function modelLabel(model: string): string {
  if (model === 'openrouter/free') return 'gratuito scelto da OpenRouter';
  const name = model.split('/').pop() ?? model;
  return name.endsWith(':free') ? `${name.slice(0, -5)} (gratis)` : name;
}

/** Files the agents keep for themselves in `Agenti/<Nome>/` (memory, work state). */
export interface AgentFile {
  owner: string;
  kind: 'memory' | 'state' | 'other';
}

export function agentFileOf(path: string): AgentFile | null {
  const m = /^Agenti\/([^/]+)\/(.+)$/.exec(path);
  if (!m) return null;
  const file = m[2]!.toLowerCase();
  return {
    owner: m[1]!,
    kind: file === 'memory.md' ? 'memory' : file === 'stato.md' ? 'state' : 'other',
  };
}

export function baseName(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.md$/i, '');
}

/**
 * Next live state of the agents after one event. `prev` is not mutated; the
 * returned object is the same reference when nothing changed.
 */
export function applyLive(
  prev: Record<string, LiveState>,
  e: LogEvent,
  agentIds: readonly string[],
): Record<string, LiveState> {
  const at = e.ts;
  let next = prev;
  const set = (id: string, mood: LiveMood, activity?: string) => {
    if (!agentIds.includes(id)) return;
    const cur = next[id];
    if (cur && cur.mood === mood && cur.activity === activity && !cur.confused) return;
    if (next === prev) next = { ...prev };
    next[id] = { mood, activity, since: at };
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

  switch (e.type) {
    case 'run':
      if (e.data.status === 'started')
        set(e.agent, 'working', e.data.goal ? 'Ci penso…' : undefined);
      else if (e.data.status === 'completed') set(e.agent, 'done');
      // The turn ended on a parked question (D-078): the monster waits for the user.
      else if (e.data.status === 'waiting_user') set(e.agent, 'waiting', ASKED_ACTIVITY);
      else if (e.data.status === 'failed')
        set(
          e.agent,
          'error',
          next[e.agent]?.mood === 'error' ? next[e.agent]?.activity : 'Qualcosa è andato storto',
        );
      else set(e.agent, 'stopped');
      break;
    case 'message':
      if (e.data.role !== 'agent') break;
      // A turn closed because it was stopped or failed: the run event sets the mood.
      if (e.data.status) break;
      if (e.data.partial) movesOn(e.agent, 'talking', keepActivity(e.agent));
      else set(e.agent, 'done');
      break;
    case 'tool_call':
      movesOn(e.agent, 'working', describeTool(e.data.tool, e.data.input));
      break;
    case 'instinct': {
      // Going round in circles (D-067): the confused face while it changes its way.
      const id = e.data.subject;
      if (!id || !STUCK_ACTIONS.has(e.data.action) || !agentIds.includes(id)) break;
      const cur = next[id];
      if (cur && cur.mood !== 'working' && cur.mood !== 'talking' && cur.mood !== 'waiting') break;
      if (next === prev) next = { ...prev };
      next[id] = {
        mood: cur?.mood ?? 'working',
        activity: cur?.activity,
        since: at,
        confused: true,
      };
      break;
    }
    case 'delegation':
      if (e.data.status === 'started') {
        set(e.data.to, 'working', taskText(e.data.goal, 48));
        set(e.data.from, 'waiting', `Aspetto ${capitalize(e.data.to)}`);
      } else if (e.data.status === 'completed') {
        set(e.data.to, 'done');
        set(e.data.from, 'working', 'Riprendo il filo');
      } else if (e.data.status === 'failed') {
        set(
          e.data.to,
          'error',
          e.data.error ? clipText(plainText(e.data.error), 48) : 'Non ce l’ho fatta',
        );
      } else {
        set(e.data.to, 'stopped');
      }
      break;
    case 'question':
      set(e.agent, 'waiting', ASKED_ACTIVITY);
      break;
    case 'question_parked':
      // Still open with no run behind it (a restart, a harness that ended its turn).
      set(e.agent, 'waiting', ASKED_ACTIVITY);
      break;
    case 'answer':
      for (const id of agentIds) {
        if (next[id]?.mood === 'waiting' && next[id]?.activity === ASKED_ACTIVITY) {
          set(id, 'working', 'Ci penso…');
        }
      }
      break;
    case 'question_expired':
      // Its run is over (kill, stop or restart): nobody waits for the answer anymore.
      if (next[e.agent]?.mood === 'waiting' && next[e.agent]?.activity === ASKED_ACTIVITY)
        set(e.agent, 'stopped');
      break;
    case 'error':
      if (
        e.data.code === 'provider_fallback' ||
        e.data.code === 'search_fallback' ||
        e.data.code === 'semantic_off'
      )
        break;
      if (e.data.code === 'aborted' || isStopText(e.data.message)) set(e.agent, 'stopped');
      else set(e.agent, 'error', clipText(plainText(e.data.message), 48));
      break;
    case 'kill':
      if (e.data.scope === 'global') for (const id of agentIds) set(id, 'stopped');
      else if (e.data.target) set(e.data.target, 'stopped');
      break;
    case 'resume':
      for (const id of agentIds) set(id, 'idle');
      break;
    default:
      break;
  }
  return next;
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
      /** Written while the monsters were stopped: it goes when the user presses "Riprendi". */
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
      /** Said in a Telegram chat of the monster's own bot (D-107): "su Telegram · Saturday Team". */
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
      /** What the instinct said of this task ("non aveva finito…", "in dubbio"), D-068. */
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
      /** The run that failed: "Riprova" sends its request again, "Dietro le quinte" opens it. */
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
  /** The receipt of a turn (D-067): what was asked, done and checked, with "Annulla tutto". */
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
   * name and "da Telegram · <gruppo>". Not the user's bubble, even when the
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
    return where ? { via: where.replace(/^da /, 'su ') } : {};
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
            text: `Ripreso il lavoro fermato: «${clip(originalRequest(d.text), 80)}»`,
            tone: 'go',
            to: d.to,
          });
          break;
        }
        if (d.role === 'user' && d.telegram && d.to) {
          // Written to a monster's own bot on Telegram (D-107): who wrote it, and where.
          const o = d.telegram;
          if (e.runId) telegramRuns.set(e.runId, telegramWhere(o));
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
        // A stopped or failed run writes nothing more: close its open drafts.
        if (e.data.status !== 'aborted' && e.data.status !== 'failed') break;
        const suffix = `|${e.runId ?? ''}`;
        for (const [key, draft] of drafts) {
          if (!key.endsWith(suffix)) continue;
          draft.streaming = false;
          drafts.delete(key);
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
          runId: e.runId ?? undefined,
        });
        break;
      case 'kill':
        if (e.data.scope === 'global')
          items.push({
            kind: 'system',
            id: e.id,
            ts: e.ts,
            text: 'Hai fermato tutti i mostri',
            tone: 'stop',
          });
        break;
      case 'resume':
        items.push({
          kind: 'system',
          id: e.id,
          ts: e.ts,
          text: 'Si riparte: i mostri sono di nuovo liberi',
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
 * Who each run belongs to: the agent of its `run started`, else the addressee
 * of its first message, else who delegates in it (a delegated monster works in
 * the run of who asked, D-021).
 */
export function runOwners(events: readonly LogEvent[]): Map<string, string> {
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
  switch (item.kind) {
    case 'user':
      return `Tu: ${clipText(item.text.replace(/\s+/g, ' ').trim(), 90)}`;
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
        return `${nameOf(item.to)} ha finito «${taskText(item.goal, 70)}»`;
      if (item.status === 'started')
        return `Compito per ${nameOf(item.to)}: ${taskText(item.goal, 70)}`;
      return `Il compito di ${nameOf(item.to)} si è fermato`;
    case 'question':
      return `${nameOf(item.agent)} ti ha fatto una domanda`;
    case 'error':
      return errorSentence(
        { agent: item.agent, data: { code: item.code, message: item.text } },
        nameOf,
      );
    case 'system':
      return item.text;
    case 'reset':
      return 'Nuova conversazione';
    case 'instinct':
      return item.text;
    case 'receipt':
      return `Ricevuta: ${receiptSummary(item.data)}`;
    case 'proposal':
      return `${nameOf(item.agent)} propone un nuovo mostro: ${item.draft.name}`;
    case 'preview':
      return `${nameOf(item.from)} ti mostra «${clipText(item.data.name, 70)}»`;
    case 'file':
      return fileSentence(item.file, nameOf(item.agent));
  }
}

/** "da Telegram · Saturday Team", or "da Telegram · in privato" (D-107). */
export function telegramWhere(
  item: Pick<Extract<ChatItem, { kind: 'telegram' }>, 'chatType' | 'chatTitle'>,
): string {
  return item.chatType === 'private' || !item.chatTitle
    ? 'da Telegram · in privato'
    : `da Telegram · ${item.chatTitle}`;
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
export function questionsClosedAt(events: readonly LogEvent[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of events) {
    if ((e.type === 'answer' || e.type === 'question_expired') && !out.has(e.data.questionId))
      out.set(e.data.questionId, e.id);
  }
  return out;
}

/** Messages (bubbles) in a list of chat items: "12 messaggi". */
export function countMessages(items: readonly ChatItem[]): number {
  return items.filter(
    (it) =>
      it.kind === 'user' || it.kind === 'agent' || it.kind === 'relayed' || it.kind === 'telegram',
  ).length;
}

/**
 * How a lead's report went, in words (D-102): "ha finito", "si è interrotto:
 * Monsters si è chiuso", "fermato prima di cominciare". `tone` is the light.
 */
export function reportOutcome(
  item: Pick<Extract<ChatItem, { kind: 'report' }>, 'status' | 'reason'>,
): {
  text: string;
  tone: 'ok' | 'signal' | 'stop' | 'off';
} {
  if (item.reason === 'restart')
    return { text: 'si è interrotto: Monsters si è chiuso mentre ci lavorava', tone: 'stop' };
  if (item.reason === 'stopped') return { text: 'fermato prima di cominciare', tone: 'off' };
  switch (item.status) {
    case 'completed':
      return { text: 'ha finito', tone: 'ok' };
    case 'waiting_user':
      return { text: 'aspetta una tua risposta', tone: 'signal' };
    case 'failed':
      return { text: 'non ce l’ha fatta', tone: 'stop' };
    case 'aborted':
      return { text: 'si è fermato', tone: 'off' };
  }
}

/** "Social di Saturday: Iapetus ha finito", the report as one line (previews, names). */
export function reportSentence(
  item: Pick<Extract<ChatItem, { kind: 'report' }>, 'lead' | 'project' | 'status' | 'reason'>,
  nameOf: (id: string) => string,
  projectName: string = item.project,
): string {
  return `${projectName}: ${nameOf(item.lead)} ${reportOutcome(item).text}`;
}

/* ---------------------------------------------------- events among monsters */

/** Summaries that say nothing more than "finished": "Fatto", "Done", "Ok.". */
const EMPTY_SUMMARY =
  /^(fatto|fatta|fatti|finito|finita|completato|completata|eseguito|ok|okay|done|completed|finished|ecco|pronto|pronta)$/;

function comparable(s: string): string {
  return plainText(s)
    .toLocaleLowerCase('it-IT')
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

/** The line of a group of delegations: "4 compiti completati", "3 compiti · 1 in corso". */
export function delegationGroupLabel(items: readonly ChatItem[]): string {
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
  if (items.some((it) => it.kind === 'instinct')) return `${items.length} eventi tra i mostri`;
  if (done === total) return `${total} compiti completati`;
  if (open === total) return `${total} compiti passati alla squadra`;
  const parts = [
    done > 0 ? `${done} ${done === 1 ? 'completato' : 'completati'}` : '',
    open > 0 ? `${open} in corso` : '',
    other > 0 ? `${other} ${other === 1 ? 'fermato' : 'fermati'}` : '',
  ].filter(Boolean);
  return `${total} compiti: ${listText(parts)}`;
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
      // Semantic search not installed (D-046): how this installation is, not a failure.
      if (e.data.code === 'semantic_off') return 'system';
      return isQuietError(e) ? 'runs' : 'errors';
    case 'run':
      return 'runs';
    case 'mcp_server':
      return e.data.action === 'failed' || e.data.action === 'needs_signin' ? 'errors' : 'system';
    default:
      return 'system';
  }
}

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  messages: 'Messaggi',
  runs: 'Lavori',
  delegations: 'Deleghe',
  tools: 'Strumenti',
  questions: 'Domande',
  vault: 'Note',
  errors: 'Errori',
  instinct: 'Decisioni dei mostri',
  system: 'Sistema',
};

/** Vault verbs for "Rhea ha creato la nota X" and "Hai creato la nota X". */
const VAULT_VERB: Record<string, { third: string; you: string }> = {
  create: { third: 'ha creato la nota', you: 'Hai creato la nota' },
  edit: { third: 'ha modificato la nota', you: 'Hai modificato la nota' },
  move: { third: 'ha spostato la nota', you: 'Hai spostato la nota' },
  delete: { third: 'ha cestinato la nota', you: 'Hai cestinato la nota' },
  restore: { third: 'ha ripristinato la nota', you: 'Hai ripristinato la nota' },
  undo: { third: 'ha annullato una modifica a', you: 'Hai annullato una modifica a' },
  propose: { third: 'ha proposto una modifica a', you: 'Hai proposto una modifica a' },
};

/** Past participles agreeing with "nota" (feminine). */
const VAULT_PARTICIPLE: Record<string, string> = {
  create: 'creata',
  edit: 'aggiornata',
  move: 'spostata',
  delete: 'cestinata',
  restore: 'ripristinata',
  undo: 'riportata indietro',
  propose: 'con una modifica proposta',
};

/** Past participles agreeing with "appunti" (masculine plural). */
const NOTES_PARTICIPLE: Record<string, string> = {
  create: 'creati',
  edit: 'aggiornati',
  move: 'spostati',
  delete: 'nel cestino',
  restore: 'ripristinati',
  undo: 'riportati indietro',
  propose: 'con una modifica proposta',
};

/**
 * "Rhea ha aggiornato i suoi appunti": changes to the files agents keep for
 * themselves (their memory, the state of their work), never called notes.
 */
export function agentFileText(path: string, action: string): string | null {
  const f = agentFileOf(path);
  if (!f) return null;
  const writes = action === 'create' || action === 'edit';
  if (f.kind === 'memory')
    return writes
      ? `${f.owner} ha aggiornato i suoi appunti`
      : `Appunti di ${f.owner} ${NOTES_PARTICIPLE[action] ?? 'toccati'}`;
  if (f.kind === 'state')
    return writes
      ? `${f.owner} ha aggiornato lo stato dei suoi lavori`
      : `Stato dei lavori di ${f.owner}: nota ${VAULT_PARTICIPLE[action] ?? 'toccata'}`;
  return writes
    ? `${f.owner} ha aggiornato una nota di lavoro (${baseName(path)})`
    : `Nota di lavoro di ${f.owner} (${baseName(path)}) ${VAULT_PARTICIPLE[action] ?? 'toccata'}`;
}

/** Plain-Italian sentence for an `error` event (codes from the core and the tools). */
export function errorSentence(
  e: { agent: string; data: { code?: string | undefined; message: string } },
  nameOf: (id: string) => string,
): string {
  const who = nameOf(e.agent);
  const msg = e.data.message;
  switch (e.data.code) {
    case 'aborted':
      return `Il lavoro di ${who} si è fermato`;
    case 'search_fallback': {
      const to = /→\s*(\w+)\s*$/.exec(msg)?.[1]?.toLowerCase();
      const name =
        to === 'wikipedia'
          ? 'Wikipedia'
          : to === 'duckduckgo'
            ? 'DuckDuckGo'
            : to === 'brave'
              ? 'Brave'
              : 'un altro motore';
      return `La ricerca sul web non rispondeva: ${who} cerca su ${name}`;
    }
    case 'provider_fallback':
      return /→ nessuno\b/.test(msg)
        ? `Il modello di ${who} non risponde e non ci sono alternative: ${lowerFirst(msg)}`
        : `Il modello non rispondeva: ${who} passa a un altro`;
    case 'orphan_processes':
      return 'Chiusi dei programmi rimasti aperti dall’avvio precedente';
    case 'kill_hook':
      return 'Lo stop non è riuscito a chiudere tutto subito';
    case 'http_500':
      return 'Errore interno di Monsters';
    case 'run_limit':
      // The spending cap (D-070) stops a job in the middle with the same code: its words say so.
      if (/tetto di spesa/.test(msg)) return msg.replace(/\.$/, '');
      return `${who} si ferma qui: questo lavoro ha raggiunto il suo limite`;
    case 'spend_cap':
      return msg.replace(/\.$/, '');
    case 'context_guard':
      return `Il contesto di ${who} era quasi pieno: ha fatto spazio`;
    case 'answer_truncated':
      return `La risposta di ${who} è stata tagliata: il modello è arrivato alla lunghezza massima`;
    case 'context_rescue':
      return `Il modello ha trovato troppo lunga la richiesta di ${who}: fa spazio e riprova`;
    case 'compaction_failed':
      return `Il riassunto dei messaggi più vecchi di ${who} non è riuscito: vede solo gli ultimi`;
    default:
      if (isStopText(msg)) return `Il lavoro di ${who} si è fermato`;
      return e.agent === 'system' ? msg : `${who} ha avuto un problema: ${lowerFirst(msg)}`;
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
 * (both would read "Il lavoro di Bruno si è fermato") and the empty message
 * closing a turn that did not finish (it would read "Bruno ha risposto"). The
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
 * A message after a colon starts in lower case ("ha avuto un problema: il
 * foglio…"). Only when it opens with a common Italian word: names and
 * acronyms ("Telegram", "API") keep their capital.
 */
const COMMON_OPENERS =
  /^(Il|Lo|La|Le|Gli|I|L’|L'|Un|Uno|Una|Non|Nessun|Nessuna|Questo|Questa|Troppi|Troppe|Manca|Mancano|Impossibile|Errore|C’è|Ci)(?=[\s’'])/;
export function lowerFirst(text: string): string {
  return COMMON_OPENERS.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** True for `error` events that are not problems: a stop or an automatic fallback. */
export function isQuietError(e: LogEvent): boolean {
  if (e.type !== 'error') return false;
  const code = e.data.code;
  return (
    code === 'aborted' ||
    code === 'search_fallback' ||
    code === 'provider_fallback' ||
    code === 'semantic_off' ||
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
  const names = files.map((f) => `“${baseName(f)}”`);
  if (names.length === 0)
    return 'La nota è cambiata dopo questa modifica: annullandola perdi anche quei cambiamenti.';
  if (names.length === 1)
    return `${names[0]} è cambiata dopo questa modifica: annullandola perdi anche quei cambiamenti.`;
  const list = names.length > 3 ? `${names.slice(0, 3).join(', ')} e altre` : names.join(', ');
  return `${list} sono cambiate dopo questa modifica: annullandola perdi anche quei cambiamenti.`;
}

/**
 * Vault changes that are the user's notes: not the agents' own files
 * (`Agenti/<Nome>/MEMORY.md`…) nor the housekeeping of Monsters itself.
 */
export function isUserNoteChange(e: LogEvent): boolean {
  return e.type === 'vault_change' && e.agent !== 'system' && !agentFileOf(e.data.path);
}

/** "Bruno", "Bruno e Rhea", "Bruno, Rhea e Dione". */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`;
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
  const who = d.name ?? (d.userId ? `l’account ${d.userId}` : 'qualcuno');
  switch (d.action) {
    case 'connected':
      return `Telegram collegato${d.name ? ` (${d.name})` : ''}`;
    case 'disconnected': {
      // A dedicated bot says which one it is (the event carries `bot`).
      const bot = d.bot ? `Il bot ${d.name ?? 'dedicato'}` : 'Telegram';
      return d.reason === 'conflict'
        ? `${bot} è usato da un altro programma (o ha un webhook): Monsters riprova`
        : d.reason === 'error'
          ? `${bot} si è fermato: serve il tuo intervento`
          : d.bot
            ? `${bot} non risponde: Monsters riprova`
            : 'Telegram non risponde: Monsters riprova';
    }
    case 'ignored':
      return `Messaggio su Telegram ignorato: ${who} (${IGNORED_REASON[d.reason ?? ''] ?? d.reason ?? 'non ammesso'})`;
    case 'paired':
      return `${who} ora può comandare i mostri da Telegram`;
    case 'pairing_failed':
      return `Codice di collegamento rifiutato per ${who}`;
    case 'pairing_started':
      return 'Hai chiesto un codice per collegare un account Telegram';
    case 'user_removed':
      return `${who} non può più comandare i mostri da Telegram`;
    case 'token_set':
      return `Bot Telegram collegato${d.name ? `: ${d.name}` : ''}`;
    case 'token_removed':
      return 'Bot Telegram scollegato';
    case 'token_check_failed':
      return d.reason === 'refused_token'
        ? 'Telegram non ha riconosciuto il token incollato'
        : 'Non sono riuscito a verificare il token di Telegram';
    // Bots dedicated to one monster (D-107).
    case 'bot_added':
      return `Bot dedicato collegato${d.name ? `: ${d.name}` : ''}`;
    case 'bot_removed':
      return `Bot dedicato tolto${d.name ? `: ${d.name}` : ''}`;
    case 'bot_changed':
      return 'Bot dedicato cambiato';
    case 'chat_pending':
      return `Un bot dedicato è stato aggiunto al gruppo ${d.name ?? 'senza nome'}: aspetta la tua approvazione`;
    case 'chat_approved':
      return `Gruppo approvato per un bot dedicato${d.name ? `: ${d.name}` : ''}`;
    case 'chat_removed':
      return `Gruppo tolto da un bot dedicato${d.name ? `: ${d.name}` : ''}`;
    case 'person_pending':
      return `${who} chiede di parlare con un bot dedicato: aspetta la tua approvazione`;
    case 'person_approved':
      return `${who} può parlare con un bot dedicato`;
    case 'person_removed':
      return `${who} non può più parlare con un bot dedicato`;
    case 'limit_reached':
      return 'Un bot dedicato ha raggiunto i messaggi di oggi';
    case 'chat_migrated':
      return `Il gruppo${d.name ? ` ${d.name}` : ''} è diventato un supergruppo: resta approvato`;
    case 'chat_left':
      return d.chatId
        ? `Un bot dedicato non è più nel gruppo${d.name ? ` ${d.name}` : ''}: le risposte lì non partono`
        : `${who} ha bloccato il bot: le risposte a quell’account non partono`;
  }
}

const IGNORED_REASON: Record<string, string> = {
  not_whitelisted: 'non è tra gli account collegati',
  not_private: 'scritto in un gruppo',
  forwarded: 'messaggio inoltrato',
  not_text: 'non è testo',
  bot_or_anonymous: 'mittente sconosciuto',
  // Bots dedicated to one monster (D-107).
  chat_not_approved: 'gruppo non ancora approvato',
  not_allowed: 'non è tra le persone ammesse',
  rate_limited: 'troppi messaggi in un’ora',
  forged_button: 'pulsante non valido',
};

/** A choice logged by the DecisionGate, the onboarding or an answer, in words. */
function describeDecision(d: EventDataMap['decision'], who: string): string {
  if (d.use) {
    // The instinct asked itself something (its dataset): what about, not the raw answer.
    const label = labelOfUse(d.use);
    const what = label ? label.charAt(0).toLowerCase() + label.slice(1) : 'una decisione al volo';
    return `Decisione${who !== 'Monsters' ? ` per ${who}` : ''}: ${what}${d.mode === 'shadow' ? ' (solo annotato)' : ''}`;
  }
  switch (d.kind) {
    case 'user_choice':
      return `Hai scelto: “${clipText(plainText(d.choice), 80)}”`;
    case 'team_proposal':
      return `Squadra proposta: ${d.choice}`;
    case 'notify':
      return d.choice === 'now'
        ? 'Notifica su Telegram mandata subito'
        : d.choice === 'silent'
          ? 'Notifica su Telegram mandata senza suono'
          : d.choice === 'later'
            ? 'Notifica su Telegram rimandata a dopo le ore di silenzio'
            : 'Notifica su Telegram non mandata';
    case 'ask_or_proceed':
      return d.choice === 'ask_user'
        ? `${who} ha deciso di chiedere a te`
        : `${who} ha deciso senza chiederti: “${clipText(plainText(d.choice), 80)}”`;
    default:
      return `${who} ha scelto: “${clipText(plainText(d.choice), 80)}”`;
  }
}

/** One plain-Italian sentence for an event, as in "Rhea ha creato la nota Idee". */
export function describeEvent(e: LogEvent, nameOf: (id: string) => string): string {
  const who = nameOf(e.agent);
  switch (e.type) {
    case 'message':
      if (e.data.role === 'user')
        return e.data.to ? `Hai scritto ${toName(nameOf(e.data.to))}` : 'Hai scritto un messaggio';
      if (e.data.partial) return `${who} sta scrivendo`;
      // The closing of a turn that did not finish is not an answer.
      if (e.data.status === 'aborted') return `${who} si è fermato mentre scriveva`;
      if (e.data.status === 'failed') return `${who} non ha finito di scrivere`;
      return `${who} ha risposto`;
    case 'delegation': {
      const to = nameOf(e.data.to);
      const from = nameOf(e.data.from);
      switch (e.data.status) {
        case 'started':
          return `${from} ha passato un compito ${toName(to)}: “${taskText(e.data.goal, 90)}”`;
        case 'completed':
          return `${to} ha finito il compito per ${from}`;
        case 'failed':
          return `Il compito di ${to} per ${from} non è andato a buon fine`;
        default:
          return `Il compito di ${to} per ${from} si è fermato`;
      }
    }
    case 'tool_call':
      return `${who}: ${describeTool(e.data.tool, e.data.input).replace(/…$/, '')}`;
    case 'tool_result':
      if (e.data.ok) return `${who} ha finito ${toolAction(e.data.tool)}`;
      return isStopText(e.data.error)
        ? `${who} ha lasciato a metà ${toolAction(e.data.tool)}`
        : `${who} non ha completato ${toolAction(e.data.tool)}`;
    case 'decision':
      return describeDecision(e.data, who);
    case 'question':
      return `${who} ti ha fatto una domanda`;
    case 'answer':
      return 'Hai risposto a una domanda';
    case 'question_expired':
      return `La domanda di ${who} è scaduta`;
    case 'question_parked':
      return `${who} aspetta la tua risposta`;
    case 'new_conversation':
      return e.data.to
        ? `Hai iniziato una nuova conversazione con ${nameOf(e.data.to)}`
        : 'Hai iniziato una nuova conversazione';
    case 'conversation_summary':
      return `Riassunti i messaggi più vecchi della conversazione con ${who} (${e.data.turns})`;
    case 'vault_change': {
      const own = agentFileText(e.data.path, e.data.action);
      if (own) {
        const owner = agentFileOf(e.data.path)?.owner.toLocaleLowerCase('it-IT');
        return e.agent === 'system' || who.toLocaleLowerCase('it-IT') === owner
          ? own
          : `${own} (${who})`;
      }
      const verb = VAULT_VERB[e.data.action] ?? {
        third: 'ha toccato la nota',
        you: 'Hai toccato la nota',
      };
      const note = baseName(e.data.path);
      return e.agent === 'user' ? `${verb.you} ${note}` : `${who} ${verb.third} ${note}`;
    }
    case 'provider_usage':
      if (e.data.provider === 'typesafe')
        return `Decisione per ${who}: una domanda al modello esperto (TypeSafe)`;
      if (e.data.purpose === 'compaction')
        return `Riassunto della conversazione di ${who} con ${modelLabel(e.data.model)}`;
      if (e.data.provider === WEB_SEARCH_USAGE_PROVIDER)
        return `${who} ha cercato sul web con OpenRouter`;
      return `${who} ha usato il modello ${modelLabel(e.data.model)}`;
    case 'error':
      return errorSentence(e, nameOf);
    case 'kill':
      switch (e.data.scope) {
        case 'global':
          return 'Tutti i mostri sono stati fermati';
        case 'agent':
          return `Il lavoro di ${nameOf(e.data.target ?? e.agent)} è stato fermato`;
        case 'run':
          return 'Un lavoro è stato fermato';
        default:
          return 'Uno strumento è stato fermato';
      }
    case 'resume':
      return 'I mostri sono ripartiti';
    case 'run':
      switch (e.data.status) {
        case 'started':
          return `${who} ha iniziato un lavoro`;
        case 'completed':
          return `${who} ha finito il lavoro`;
        case 'waiting_user':
          return `${who} ha finito il turno: aspetta la tua risposta`;
        case 'failed':
          return `Il lavoro di ${who} non è andato a buon fine`;
        default:
          return e.data.reason === 'restart' || e.data.reason === 'shutdown'
            ? `Il lavoro di ${who} si è fermato al riavvio di Monsters`
            : `Il lavoro di ${who} si è fermato`;
      }
    case 'auth':
      switch (e.data.action) {
        case 'setup':
          return 'Account creato';
        case 'login':
          return 'Accesso eseguito';
        case 'login_failed':
          return 'Tentativo di accesso non riuscito';
        case 'logout':
          return 'Uscita dall’account';
        case 'login_token_issued':
          return 'Accesso automatico preparato per l’app';
        case 'login_token':
          return 'Accesso automatico dall’app desktop';
        case 'login_token_failed':
          return 'Accesso automatico non riuscito';
        case 'password_changed':
          return 'Hai cambiato la password';
        case 'password_change_failed':
          return 'Cambio della password non riuscito';
        case 'password_reset':
          return 'Password reimpostata dal computer';
        case 'confirmed':
          return 'Hai confermato che sei tu';
        case 'confirm_failed':
          return 'Conferma della password non riuscita';
        default:
          return 'Nuovo token per la riga di comando';
      }
    case 'team_change': {
      const name = e.data.name ?? (e.data.agent ? nameOf(e.data.agent) : 'un mostro');
      switch (e.data.action) {
        case 'add':
          return `Hai aggiunto ${name} alla squadra`;
        case 'rename':
          return `Hai cambiato nome ${e.data.from ? toName(e.data.from) : 'a un mostro'}: ora è ${name}`;
        case 'edit':
          return `Hai cambiato ruolo e compiti di ${name}`;
        case 'look':
          return `Hai cambiato l’aspetto di ${name}`;
        case 'archive':
          return `Hai tolto ${name} dalla squadra`;
        case 'restore':
          return `Hai riportato ${name} nella squadra`;
        default:
          return 'Hai cambiato le tue preferenze';
      }
    }
    case 'permissions':
      return e.data.target === 'defaults'
        ? 'Hai cambiato i permessi della squadra'
        : `Hai cambiato i permessi di ${nameOf(e.data.target)}`;
    case 'channel':
      return channelSentence(e.data);
    case 'memory': {
      if (e.data.action === 'over_limit') {
        return `La memoria di ${who} è lunga: vede solo le righe più recenti`;
      }
      const n = e.data.lines?.length ?? 0;
      const things = n === 1 ? 'una cosa nuova' : `${n} cose nuove`;
      // Lines of a run that is not only the user's wait for a confirmation (review 18/10, A2).
      if (e.data.action === 'proposed') return `${who} vuole ricordare ${things}: aspetta te`;
      if (e.data.action === 'discarded') return `La memoria di ${who} resta com’era`;
      return `${who} si ricorda ${things}`;
    }
    case 'mcp_server': {
      const name = e.data.server === 'browser' ? 'il browser' : `il programma “${e.data.server}”`;
      switch (e.data.action) {
        case 'added':
          return e.data.server === 'browser' ? 'Hai attivato il browser' : `Hai aggiunto ${name}`;
        case 'changed':
          return `Hai cambiato ${name}`;
        case 'removed':
          return `Hai tolto ${name}`;
        case 'connected':
          return `Collegato ${name}`;
        case 'disconnected':
          return `Chiuso ${name}`;
        case 'signed_in':
          return `Hai fatto l’accesso per ${name}`;
        case 'signed_out':
          return `Hai scollegato l’accesso di ${name}`;
        case 'tools_updated':
          return e.data.message ?? `${name} ha aggiornato i suoi strumenti`;
        case 'needs_signin':
          return `Serve di nuovo l’accesso per ${name}`;
        default:
          return `Non riesco ad avviare ${name}`;
      }
    }
    // The instinct (D-067): said again from its fields, in neutral forms (store/instinct.ts).
    case 'instinct':
      return instinctSentence(e.data, nameOf);
    case 'security':
      return securitySentence(e.data);
    case 'receipt':
      return `Ricevuta del lavoro di ${nameOf(e.data.agent)}: ${receiptSummary(e.data)}`;
    case 'spend':
      return e.data.message;
    case 'monster_proposal': {
      const name = e.data.name ?? e.data.draft?.name ?? 'un mostro';
      const from = nameOf(e.data.from);
      if (e.data.action === 'proposed') return `${from} propone un nuovo mostro: ${name}`;
      if (e.data.action === 'created') return `Hai creato ${name} dalla proposta di ${from}`;
      return `Hai lasciato stare la proposta di ${from} (${name})`;
    }
    case 'project_docs_proposal': {
      const what = `le istruzioni di «${e.data.name}» (${e.data.file})`;
      const from = nameOf(e.data.from);
      if (e.data.action === 'proposed') return `${from} propone di cambiare ${what}`;
      if (e.data.action === 'applied') return `Hai applicato la proposta di ${from} per ${what}`;
      if (e.data.action === 'superseded')
        return `${from} ha sostituito la sua proposta per ${what}`;
      return `Hai lasciato stare la proposta di ${from} per ${what}`;
    }
    case 'preview':
      return `${nameOf(e.agent)} ti mostra ${e.data.item.kind === 'note' ? 'la nota' : 'il file'} “${e.data.name}”`;
    case 'file':
      return fileSentence(e.data, who);
    // Automations (D-094): the menu of the next wave shows them in full.
    case 'automation_run_started':
      return `Automazione «${e.data.name}»: ${who} ha iniziato un giro`;
    case 'automation_run_finished':
      return e.data.status === 'completed'
        ? `Automazione «${e.data.name}»: giro finito`
        : e.data.status === 'waiting_user'
          ? `Automazione «${e.data.name}»: aspetta una tua risposta`
          : `Automazione «${e.data.name}»: il giro non è andato a buon fine`;
    case 'automation_run_skipped':
      return `Automazione «${e.data.name}»: giro saltato. ${e.data.message}`;
    case 'automation_change':
      return `Automazione «${e.data.name}»: ${
        {
          created: 'creata',
          updated: 'modificata',
          deleted: 'eliminata',
          paused: 'in pausa',
          resumed: 'ripresa',
          confirmed: 'confermata',
          discarded: 'bozza lasciata stare',
        }[e.data.action]
      }`;
    // Projects (D-097): the project pages of the next wave show them in full.
    case 'project_change':
      return `Progetto «${e.data.name}»: ${
        {
          created: 'creato',
          updated: 'modificato',
          confirmed: 'confermato',
          archived: 'archiviato',
          member_added: `${nameOf(e.data.agent ?? '')} è entrato nel progetto`,
          member_removed: `${nameOf(e.data.agent ?? '')} è uscito dal progetto`,
          discarded: 'bozza lasciata stare',
          restored: 'tornato dall’archivio',
          stopped: 'fermato',
          docs_approved: 'istruzioni della cartella approvate',
        }[e.data.action]
      }`;
    case 'project_report':
      return `${nameOf(e.data.lead)} ha mandato il rapporto del progetto a ${nameOf(e.data.to)}`;
    case 'log_archive':
      return `Monsters ha archiviato ${e.data.events} eventi vecchi (consumi, risultati degli strumenti, testo in arrivo) in ${e.data.dir}`;
    // An access a capo asked for (D-130): the user's tap, applied by the core.
    case 'access_grant':
      return e.data.outcome === 'granted'
        ? `Hai concesso ${e.data.summary} (l’ha chiesto ${nameOf(e.data.from)})`
        : e.data.outcome === 'denied'
          ? `Non hai concesso ${e.data.summary} (l’aveva chiesto ${nameOf(e.data.from)})`
          : `Non ho potuto concedere ${e.data.summary}: ${e.data.message ?? 'è cambiato qualcosa'}`;
  }
}

/** "Rhea ha salvato uno screenshot", "Dione ha creato una pagina: Prezzi". */
export function fileSentence(f: FileEventData, who: string): string {
  if (f.action === 'deleted') return `Hai eliminato il file ${f.name}`;
  if (f.kind === 'html') return `${who} ha creato una pagina${f.title ? `: ${f.title}` : ''}`;
  if (f.source === 'tool' && f.kind === 'image') return `${who} ha salvato uno screenshot`;
  return `${who} ha salvato il file ${f.name}`;
}

/** Display name lookup with sensible fallbacks for reserved actors. */
export function makeNameOf(agents: Record<string, AgentSummary>) {
  return (id: string) => {
    if (id === 'user') return 'Tu';
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

/** Short names of the tools for the instrumentation line ("Ricerca web ×3"). */
const TOOL_SHORT: Record<string, string> = {
  web_search: 'Ricerca web',
  web_fetch: 'Pagina web',
  vault_search: 'Ricerca note',
  vault_read: 'Lettura nota',
  vault_list: 'Elenco note',
  vault_write: 'Nota scritta',
  vault_create: 'Nota scritta',
  vault_edit: 'Nota modificata',
  vault_move: 'Nota spostata',
  vault_delete: 'Nota nel cestino',
  vault_links: 'Collegamenti',
  vault_tags: 'Tag',
  vault_history: 'Storia nota',
  vault_restore: 'Nota ripristinata',
  vault_undo: 'Annullamento',
  vault_propose: 'Proposta',
  vault_apply_proposal: 'Proposta applicata',
  delegate: 'Delega',
  ask_user: 'Domanda',
  team_propose_monster: 'Nuovo mostro',
  project_send: 'Al progetto',
  project_status: 'Stato progetti',
  project_propose: 'Nuovo progetto',
  automation_propose: 'Nuova automazione',
  preview_show: 'Anteprima',
  shell: 'Comando',
  fs_list: 'Elenco file',
  fs_read: 'Lettura file',
  fs_write: 'File scritto',
  fs_move: 'File spostato',
  fs_delete: 'File nel cestino',
};

/** "Ricerca web", "Browser", "Github" (an MCP server by its name). */
export function toolShort(tool: string): string {
  if (tool.startsWith('mcp__browser__')) return 'Browser';
  const mcp = /^mcp__(.+?)__/.exec(tool);
  if (mcp) return capitalize(mcp[1]!.replace(/[_-]+/g, ' '));
  return TOOL_SHORT[tool] ?? toolLabel(tool);
}

/**
 * A model id as the instrument names it: no provider, no `:free`, no
 * `-instruct`, words apart, versions with a dot ("claude-sonnet-4-5" → "claude
 * sonnet 4.5", "meta-llama/llama-3.3-70b-instruct:free" → "llama 3.3 70b").
 */
export function modelShort(model: string): string | null {
  // The free router picks a model it does not name: "gratis" already says it all.
  if (model === 'openrouter/free') return null;
  const name = (model.split('/').pop() ?? model).replace(/:free$/, '');
  return modelWords(name);
}

/** "0,8 s", "4,1 s", "41 s", "2 min 05 s", "1 h 12 min". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = ms / 1000;
  if (s < 10)
    return `${s.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
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
export function runStatsIndex(events: readonly LogEvent[]): Map<string, RunStats> {
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
}

/** The cost as the instrument says it: "gratis" on free models (or a reported 0), else dollars. */
export function costText(s: { costUsd?: number | undefined; free: boolean }): string | null {
  if (s.free && !s.costUsd) return 'gratis';
  if (s.costUsd === undefined) return null;
  return s.costUsd === 0 ? 'gratis' : formatUsd(s.costUsd);
}

/**
 * The instrumentation line of a turn: "Titan › Delega ×2 · Ricerca web ×3 ·
 * 4,1 s · gratis · llama 3.3 70b" (the UI shows it in upper case). Unknown
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
    return t.name === TOOL_SHORT['web_search'] && stats.searchEngine
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

/** "3 strumenti · 4,1 s · gratis" (shown in upper case); null for a conversation with no runs. */
export function conversationLine(sum: RunsSum): string | null {
  if (sum.runs === 0) return null;
  const parts = [`${sum.toolCalls} ${sum.toolCalls === 1 ? 'strumento' : 'strumenti'}`];
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
  if (request) return { agent: request.agent, text: `Riprova: «${clip(request.text, 600)}»` };
  const started = events.find(
    (e): e is LogEvent<'run'> =>
      e.type === 'run' && e.runId === runId && e.data.status === 'started',
  );
  const goal = started?.data.goal?.trim();
  return started && goal ? { agent: started.agent, text: `Riprova: «${clip(goal, 600)}»` } : null;
}

/** "la domanda di Titan e il lavoro di Rhea": what is left halfway, in words (null: nothing). */
export function haltedWorkText(w: HaltedWork, nameOf: (id: string) => string): string | null {
  const asked = [...new Set(w.questions.map((q) => q.from))];
  const parts: string[] = [];
  if (w.questions.length === 1) parts.push(`la domanda di ${nameOf(asked[0]!)}`);
  else if (w.questions.length > 1)
    parts.push(`${w.questions.length} domande (${listText(asked.map(nameOf))})`);
  // Who asked was waiting for the answer: its "work" is the question.
  const workers = w.agents.filter((a) => !asked.includes(a));
  if (workers.length > 0) parts.push(`il lavoro di ${listText(workers.map(nameOf))}`);
  return parts.length > 0 ? listText(parts) : null;
}

/**
 * "i messaggi per Rhea e Titan": the monsters whose request "Riprendi e continua" starts
 * again (null: nothing to start again).
 */
export function haltedResumeText(w: HaltedWork, nameOf: (id: string) => string): string | null {
  const who = [...new Set(w.requests.map((r) => r.agent))];
  if (who.length === 0) return null;
  const n = w.requests.length;
  return `${n === 1 ? 'il messaggio' : 'i messaggi'} per ${listText(who.map(nameOf))}`;
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
export function automationWork(events: readonly LogEvent[]): AutomationWork {
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
}

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
  return `Sta facendo l’automazione «${name}»: il tuo messaggio parte appena finisce`;
}
