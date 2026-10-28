import type { LogEvent, ReceiptData } from '@monsters/shared';
import {
  capitalize,
  describeTool,
  growing,
  listText,
  toolShort,
  type ChatItem,
  type RunStats,
} from './derive.ts';
import { receiptCost, receiptNotes, type DoubtInfo } from './instinct.ts';
import { turnStrings } from './turn.strings.ts';

/*
 * The turn (docs/design.md, "The chat"): a request and everything the monster, and whoever it
 * involved, did to answer it, keyed by the run. The chat column keeps only what asks for an
 * action or must be read (the request, the replies with their files, questions, errors, drafts,
 * what needs a check); the work itself goes into one strip that opens. Pure functions over the
 * items of one chat (`chatThread`), tested without a browser; the objects stay the same between
 * two chunks of a streamed reply when nothing of them changed (`keepStable`), so the rows of the
 * chat do not render again.
 */

type Item<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>;

/** What starts a turn in a chat: your message, a Telegram message, another monster's message. */
export type TurnRequest = Item<'user'> | Item<'telegram'> | Item<'relayed'>;
/** What stays in the column, in order: the replies and what asks for an action. */
export type TurnColumnItem = Item<'agent'> | Item<'question'> | Item<'error'> | Item<'proposal'>;
/** What the turn made: files and what a monster showed in the preview, with the reply. */
export type TurnAttachment = Item<'file'> | Item<'preview'>;

/** A tool call of the run, by any monster in it: the steps of the strip. */
export interface TurnStep {
  /** The `tool_call` event. */
  id: string;
  ts: number;
  agent: string;
  tool: string;
  input: unknown;
}

/** Something that needs a check, as a short line under the reply: a doubt, orders removed. */
export interface TurnFlag {
  id: string;
  agent: string;
  text: string;
  tone: 'warn' | 'stop';
  /** A doubt of the check with what the person decides on (the chat shows it as a notice). */
  doubt?: DoubtInfo;
}

export interface Turn {
  kind: 'turn';
  /** `turn:<runId>`, and a number when one run holds two requests. */
  id: string;
  runId: string;
  ts: number;
  /** The chat it is in: the monster the strip speaks for. */
  agent: string;
  request: TurnRequest | null;
  /** Tasks this chat's monster received in the run (its chat shows them as the request). */
  received: Item<'delegation'>[];
  column: TurnColumnItem[];
  /** Tasks given in the run, as this chat sees them. */
  tasks: Item<'delegation'>[];
  /** What the instinct, the defenses and the spending cap said during the run. */
  instinct: Item<'instinct'>[];
  flags: TurnFlag[];
  attachments: TurnAttachment[];
  receipt: Item<'receipt'> | null;
  stats: RunStats | null;
  steps: readonly TurnStep[];
  /** The last bubble of the turn: its files go inside it. */
  lastBubble: string | null;
}

/** One block of a chat: a turn, or an item that belongs to none (a stop, a report, a reset…). */
export type ChatBlock = Turn | { kind: 'item'; id: string; item: ChatItem; carried: boolean };

/* ------------------------------------------------------------------ steps */

interface StepsState {
  value: Map<string, readonly TurnStep[]>;
  copied: boolean;
  /** The lists copied in this pass. */
  mine: Set<readonly TurnStep[]>;
}

/**
 * The tool calls of every run, following the log as it grows: a run's list keeps its identity
 * until a new call of that run comes. Questions to the user are their own card, not a step.
 */
export const runStepsIndex = growing<Map<string, readonly TurnStep[]>, StepsState>(
  () => ({ value: new Map(), copied: true, mine: new Set() }),
  (state, e: LogEvent) => {
    if (e.type !== 'tool_call' || !e.runId || e.data.tool === 'ask_user') return;
    if (!state.copied) {
      state.value = new Map(state.value);
      state.copied = true;
    }
    const step: TurnStep = {
      id: e.id,
      ts: e.ts,
      agent: e.agent,
      tool: e.data.tool,
      input: e.data.input,
    };
    const cur = state.value.get(e.runId);
    if (cur && state.mine.has(cur)) (cur as TurnStep[]).push(step);
    else {
      const next = [...(cur ?? []), step];
      state.value.set(e.runId, next);
      state.mine.add(next);
    }
  },
  (state) => state.mine.clear(),
);

/* ------------------------------------------------------------------ turns */

/** The run an item makes part of, as a turn; undefined for what stands on its own. */
function runOf(item: ChatItem): string | undefined {
  switch (item.kind) {
    case 'user':
    case 'telegram':
    case 'relayed':
    case 'agent':
    case 'question':
    case 'error':
    case 'proposal':
    case 'delegation':
    case 'instinct':
    case 'file':
    case 'preview':
    case 'receipt':
      return item.runId;
    default:
      // A lead's report, a stop, a new conversation: read on their own (D-102).
      return undefined;
  }
}

const isRequest = (item: ChatItem): item is TurnRequest =>
  item.kind === 'user' || item.kind === 'telegram' || item.kind === 'relayed';

/**
 * The blocks of one chat: its items grouped by run into turns, at the place of their first item;
 * what belongs to no run stays an item. `carried` are the questions of a previous conversation
 * shown in this one: on their own, with their caption. A second request in the same run starts a
 * second turn of it, so the column keeps the order in which things were said.
 */
export function buildTurns(
  items: readonly ChatItem[],
  chat: string,
  opts: {
    stats?: ReadonlyMap<string, RunStats> | undefined;
    steps?: ReadonlyMap<string, readonly TurnStep[]> | undefined;
    carried?: ReadonlySet<string> | undefined;
  } = {},
): ChatBlock[] {
  const out: ChatBlock[] = [];
  const current = new Map<string, Turn>();
  const parts = new Map<string, number>();
  for (const item of items) {
    const runId = item.id.startsWith('pending') ? undefined : runOf(item);
    if (!runId || opts.carried?.has(item.id)) {
      out.push({ kind: 'item', id: item.id, item, carried: !!opts.carried?.has(item.id) });
      continue;
    }
    let turn = current.get(runId);
    if (!turn || (isRequest(item) && (turn.request || turn.column.length > 0))) {
      const n = (parts.get(runId) ?? 0) + 1;
      parts.set(runId, n);
      turn = {
        kind: 'turn',
        id: n === 1 ? `turn:${runId}` : `turn:${runId}:${n}`,
        runId,
        ts: item.ts,
        agent: chat,
        request: null,
        received: [],
        column: [],
        tasks: [],
        instinct: [],
        flags: [],
        attachments: [],
        receipt: null,
        stats: opts.stats?.get(runId) ?? null,
        steps: opts.steps?.get(runId) ?? [],
        lastBubble: null,
      };
      current.set(runId, turn);
      out.push(turn);
    }
    switch (item.kind) {
      case 'user':
      case 'telegram':
      case 'relayed':
        turn.request = item;
        break;
      case 'agent':
        turn.column.push(item);
        turn.lastBubble = item.id;
        break;
      case 'question':
      case 'error':
      case 'proposal':
        turn.column.push(item);
        break;
      case 'delegation':
        if (item.to === chat && item.from !== item.to) turn.received.push(item);
        else {
          turn.tasks.push(item);
          // What the instinct said of a task that needs a look: under the reply too.
          for (const [i, c] of (item.checks ?? []).entries())
            if (c.tone)
              turn.flags.push({
                id: `${item.id}:${i}`,
                agent: item.to,
                text: c.text,
                tone: c.tone,
                ...(c.doubt ? { doubt: c.doubt } : {}),
              });
        }
        break;
      case 'instinct':
        turn.instinct.push(item);
        if (item.tone)
          turn.flags.push({
            id: item.id,
            agent: item.agent,
            text: item.text,
            tone: item.tone,
            ...(item.doubt ? { doubt: item.doubt } : {}),
          });
        break;
      case 'file':
      case 'preview':
        turn.attachments.push(item);
        break;
      case 'receipt':
        turn.receipt = item;
        break;
      default:
        break;
    }
  }
  // A turn where this chat's monster only did tasks for another one (its chat, D-021): the steps
  // are its own, and the run's time and cost belong to who asked.
  for (const b of out) {
    if (b.kind !== 'turn' || b.request || b.received.length === 0 || b.tasks.length > 0) continue;
    b.steps = stepsOf(b.steps, chat);
    b.stats = null;
  }
  return out;
}

const stepsBy = new WeakMap<readonly TurnStep[], Map<string, readonly TurnStep[]>>();

/** The steps of one monster, the same list for the same steps (the turn stays stable). */
function stepsOf(steps: readonly TurnStep[], agent: string): readonly TurnStep[] {
  let byAgent = stepsBy.get(steps);
  if (!byAgent) stepsBy.set(steps, (byAgent = new Map<string, readonly TurnStep[]>()));
  let out = byAgent.get(agent);
  if (!out) byAgent.set(agent, (out = steps.filter((x) => x.agent === agent)));
  return out;
}

/* -------------------------------------------------------------- stability */

/** Plain data equal to a depth of a few levels (arrays and plain objects; the rest by identity). */
export function sameValue(a: unknown, b: unknown, depth = 3): boolean {
  if (Object.is(a, b)) return true;
  if (depth === 0 || typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i], depth - 1)) return false;
    return true;
  }
  if (Array.isArray(b) || Object.getPrototypeOf(a) !== Object.prototype) return false;
  if (Object.getPrototypeOf(b) !== Object.prototype) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth - 1))
      return false;
  }
  return true;
}

/**
 * `next` with every element equal to one of `prev` (by id) replaced by that one: the identity of
 * what did not change survives a rebuild. `prev` itself when nothing changed at all.
 */
export function keepStable<T extends { id: string }>(
  prev: readonly T[] | undefined,
  next: readonly T[],
  same: (a: T, b: T) => boolean = (a, b) => sameValue(a, b),
): readonly T[] {
  if (!prev || prev.length === 0) return next;
  const before = new Map(prev.map((x) => [x.id, x]));
  let changed = prev.length !== next.length;
  const out = next.map((x, i) => {
    const old = before.get(x.id);
    const kept = old && (old === x || same(old, x)) ? old : x;
    if (kept !== prev[i]) changed = true;
    return kept;
  });
  return changed ? out : prev;
}

/** Two turns alike: their parts are the same objects (items already kept stable). */
function sameTurn(a: Turn, b: Turn): boolean {
  return (
    a.runId === b.runId &&
    a.agent === b.agent &&
    a.ts === b.ts &&
    a.request === b.request &&
    a.receipt === b.receipt &&
    a.stats === b.stats &&
    a.steps === b.steps &&
    a.lastBubble === b.lastBubble &&
    sameValue(a.received, b.received, 1) &&
    sameValue(a.column, b.column, 1) &&
    sameValue(a.tasks, b.tasks, 1) &&
    sameValue(a.instinct, b.instinct, 1) &&
    sameValue(a.attachments, b.attachments, 1) &&
    sameValue(a.flags, b.flags, 4)
  );
}

/** The blocks of a chat, keeping the identity of the turns and items that did not change. */
export function keepStableBlocks(
  prev: readonly ChatBlock[] | undefined,
  next: readonly ChatBlock[],
): readonly ChatBlock[] {
  return keepStable(prev, next, (a, b) =>
    a.kind === 'turn' && b.kind === 'turn'
      ? sameTurn(a, b)
      : a.kind === 'item' && b.kind === 'item' && a.item === b.item && a.carried === b.carried,
  );
}

/** A keeper of a chat's blocks across rebuilds (`keepStableBlocks` against the previous ones). */
export function stableBlocks(): (next: readonly ChatBlock[]) => readonly ChatBlock[] {
  let prev: readonly ChatBlock[] | undefined;
  return (next) => (prev = keepStableBlocks(prev, next));
}

/* ----------------------------------------------------------------- words */

/** The state of a turn's work, from the log: still open, or how it ended. */
export function turnEnd(turn: Turn): 'open' | 'done' | 'stopped' | 'failed' {
  const s = turn.stats;
  if (s?.ended) {
    if (s.status === 'failed') return 'failed';
    if (s.status === 'aborted') return 'stopped';
    return 'done';
  }
  if (turn.tasks.some((t) => t.status === 'started')) return 'open';
  if (turn.received.some((t) => t.status === 'started')) return 'open';
  return s ? 'open' : 'done';
}

/** How long, roughly: "12 s", "1 min", "1 h 5 min". */
export function roughDuration(ms: number): string {
  const s = turnStrings();
  const sec = Math.max(1, Math.round(ms / 1000));
  if (sec < 60) return s.seconds(sec);
  const min = Math.round(sec / 60);
  if (min < 60) return s.minutes(min);
  return s.hours(Math.floor(min / 60), min % 60);
}

/** The monsters asked for help in the turn, by id, in order (never the chat's own). */
export function turnHelpers(turn: Turn): string[] {
  const out: string[] = [];
  for (const t of turn.tasks) if (t.to !== turn.agent && !out.includes(t.to)) out.push(t.to);
  return out;
}

const SEARCH_TOOLS = new Set(['web_search', 'web_fetch']);

/** A step that reached outside the computer (the web, the browser, another program). */
export function isOutsideStep(step: TurnStep): boolean {
  return SEARCH_TOOLS.has(step.tool) || step.tool.startsWith('mcp__');
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** A step done, in the timeline of the strip: "Searched “tram 28”", "Read visitlisboa.com". */
export function doneStepText(step: TurnStep): string {
  const s = turnStrings();
  const i = (step.input ?? {}) as Record<string, unknown>;
  if (step.tool === 'web_search') {
    const q = str(i['query']);
    return q ? s.searched(clip(q, 60)) : s.searchedAny;
  }
  if (step.tool === 'web_fetch') {
    const host = hostOf(str(i['url']));
    return host ? s.read(host) : s.readAny;
  }
  if (step.tool.startsWith('mcp__browser__')) {
    const host = hostOf(str(i['url']));
    return host ? s.browsed(host) : s.browsedAny;
  }
  return s.used(toolShort(step.tool));
}

/** A step under way, in the live strip: the words of the monitor ("Searching “tram 28”"). */
export function liveStepText(step: TurnStep): string {
  return describeTool(step.tool, step.input);
}

/**
 * The live line of a turn at work: what its monster does and what the monsters it asked do,
 * "Asking Rhea · Searching “tram 28”". Empty when the log says nothing yet (the strip then says
 * the monster's own state).
 */
export function turnNow(turn: Turn, nameOf: (id: string) => string): string[] {
  const s = turnStrings();
  const open = turn.tasks.filter((t) => t.status === 'started' && t.to !== turn.agent);
  const parts: string[] = [];
  if (open.length > 0) {
    parts.push(s.asking(listText([...new Set(open.map((t) => nameOf(t.to)))])));
    for (const to of new Set(open.map((t) => t.to))) {
      const last = turn.steps.findLast((x) => x.agent === to && x.ts >= turn.ts);
      if (last) parts.push(liveStepText(last));
    }
    return parts.slice(0, 3);
  }
  const mine = turn.steps.findLast((x) => x.agent === turn.agent);
  const lastBubble = turn.column.findLast((c) => c.kind === 'agent');
  // Words written after the last call: the monster is writing, not using that tool any more.
  if (mine && !(lastBubble && lastBubble.ts > mine.ts)) parts.push(liveStepText(mine));
  return parts;
}

/** The notes the turn touched: from its receipt, else the ones written for its tasks. */
export function turnNotes(turn: Turn): string[] {
  if (turn.receipt) return receiptNotes(turn.receipt.data).map((n) => n.path);
  const out: string[] = [];
  for (const t of [...turn.tasks, ...turn.received])
    for (const n of t.notes ?? []) if (!out.includes(n)) out.push(n);
  return out;
}

/** The cost of the turn in words ("free", "$0.0001"), or null when unknown. */
export function turnCost(turn: Turn, costText: (s: RunStats) => string | null): string | null {
  if (turn.receipt) return receiptCost(turn.receipt.data);
  return turn.stats ? costText(turn.stats) : null;
}

/** How long the turn worked: the receipt's time, else from the run's start to its end. */
export function turnDuration(turn: Turn): number | undefined {
  return turn.receipt?.data.durationMs ?? turn.stats?.durationMs;
}

/**
 * The closed strip, one sentence: "Worked 1 min · asked Rhea and Dione · 2 notes · free". What is
 * unknown is left out, never guessed; the model only with the technical details (`model`).
 */
export function turnSentence(
  turn: Turn,
  opts: {
    nameOf: (id: string) => string;
    cost: string | null;
    /** Every note change of the turn was undone. */
    undone?: boolean | undefined;
    /** The model and its level, with "Show technical details" on. */
    model?: string | null | undefined;
  },
): string {
  const s = turnStrings();
  const end = turnEnd(turn);
  const ms = turnDuration(turn);
  const time = ms !== undefined && end !== 'open' ? roughDuration(ms) : null;
  const parts: string[] = [];
  if (end === 'stopped') {
    const by = turn.stats?.stoppedAgent;
    parts.push(by ? s.youStopped(opts.nameOf(by), time) : s.stopped(time));
  } else if (end === 'failed') parts.push(s.failed(time));
  else if (time) parts.push(s.worked(time));
  const helpers = turnHelpers(turn);
  if (helpers.length > 0) parts.push(s.asked(listText(helpers.map(opts.nameOf))));
  else {
    const searches = turn.steps.filter((x) => SEARCH_TOOLS.has(x.tool)).length;
    if (searches > 0) parts.push(s.searches(searches));
    else if (turn.steps.length > 0) parts.push(s.steps(turn.steps.length));
  }
  const notes = turnNotes(turn).length;
  if (notes > 0) parts.push(s.notes(notes));
  if (opts.undone) parts.push(s.undone);
  if (opts.cost) parts.push(opts.cost);
  if (opts.model) parts.push(opts.model);
  if (parts.length === 0) parts.push(s.done);
  return capitalize(parts.join(' · '));
}

/**
 * Whether the turn has work to show in a strip once it is over: tasks, steps, the instinct,
 * a receipt; with the technical details on, any run the log measured.
 */
export function turnHasWork(turn: Turn, details: boolean): boolean {
  if (turn.tasks.length > 0 || turn.steps.length > 0 || turn.instinct.length > 0) return true;
  if (turn.receipt) return true;
  return details && !!turn.stats && (turn.stats.durationMs !== undefined || !!turn.stats.lastModel);
}

/** The receipt's outcome of a task, matched by monster and goal (the receipt says it again). */
export function taskVerdict(
  receipt: ReceiptData | undefined,
  task: Item<'delegation'>,
): ReceiptData['delegations'][number] | undefined {
  return receipt?.delegations.find((d) => d.agent === task.to && d.goal === task.goal);
}
