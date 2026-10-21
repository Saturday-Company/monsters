import { errorMessage } from '@monsters/providers';
import { CONTEXT_COMPACT_AT, type LogEvent } from '@monsters/shared';
import type { ModelMessage } from 'ai';
import { estimateTokens } from '../agents/context-usage.ts';
import type { AgentDefinition } from '../agents/definition.ts';
import type { ControlScope } from '../kill/control-scope.ts';
import { automationRunOf } from '../automations/run-index.ts';
import type { EventLog } from '../log/event-log.ts';
import {
  conversationStart,
  conversationTurns,
  mergeTurns,
  type ConversationOptions,
  type ConversationTurn,
} from './conversation.ts';
import { withoutAccessClaims } from './access-claims.ts';
import { isThirdPartySource } from './instinct/taint.ts';
import type { QuestionStore } from './questions.ts';
import { SUMMARY_EXPENDABLE } from './summarizer.prompts.ts';
import { teamStrings } from './team.strings.ts';

/*
 * Compaction of a conversation (C.3 of the plan of 16/10, D-082). Before, the
 * turns past the latest 12 were simply forgotten. Now, when the turns since the
 * latest "Nuova conversazione" (and after the latest summary) are more than
 * fit (`conversationTurns`, 12), or the next request would pass
 * `CONTEXT_COMPACT_AT` of the model's window, the older ones become a summary:
 * requests, decisions, the user's facts, notes and files, what was delivered,
 * what is open. It is an event of the log (`conversation_summary`, with the
 * range of turns it covers), sent first in the history of every next run, and
 * written again only when a threshold is crossed again: then the new summary
 * is the old one plus the turns after it (recursive), never every run, so the
 * prefix of the prompt stays the same between two compactions (cache).
 *
 * The summary is written **after** a turn, for the next one (`prepare`, in
 * the background with a time limit): a run never waits for it. `history` only
 * reads what is there: the summary, the turns after it, and when they do not
 * fit, the latest ones (truncation, as before).
 *
 * A summary of runs that read third-party text is marked `tainted`: an
 * instruction of a hostile page may live on in it, so the run that reads it
 * starts tainted, and it reaches the monster as data, not as Monsters' word.
 */

/** Turns kept as they are after a compaction: the latest exchanges. */
export const SUMMARY_KEEP_TURNS = 4;
/** Longest summary kept, in characters (the model is asked for less). */
export const SUMMARY_MAX_CHARS = 6000;
/** Turns read past the latest summary at most; past them the oldest are summarised in chunks. */
export const MAX_UNCOVERED = 200;
/** Turns of a backlog summarised at once. */
const BACKLOG_CHUNK = 120;
/** Tokens a summary may take, for the window check (`SUMMARY_MAX_CHARS` of prose). */
const SUMMARY_TOKENS = 1700;
/** Tokens left for the next request when the summary is written before it arrives. */
const REQUEST_TOKENS = 600;
/** Share of the window the history aims at after a compaction (room until the next one). */
export const COMPACT_TARGET = 0.55;
/** The rest of the prompt when no step of the monster measured it yet (instructions, tools). */
export const DEFAULT_FIXED_TOKENS = 6000;
/** A new summary shorter than this share of the old one is refused (facts were dropped). */
export const SHRINK_LIMIT = 0.35;
/** New turns after a failed summary before it is tried again. */
export const RETRY_AFTER_TURNS = 4;
/** The longest a summary may take: past it the next run goes on without (truncation). */
export const SUMMARY_TIMEOUT_MS = 30_000;
/** Framing of a turn in the chat templates. */
const TURN_OVERHEAD = 4;

/** What a summarizer gets: the old summary, if any, and the turns to fold into it. */
export interface SummaryInput {
  agent: AgentDefinition;
  previous: string | null;
  turns: readonly ConversationTurn[];
  runId: string;
  signal: AbortSignal;
  /** Where a harness started for the summary lives (the kill switch reaches it). */
  scope?: ControlScope | undefined;
}

export interface SummaryOutput {
  text: string;
  provider?: string | undefined;
  model?: string | undefined;
}

/** Writes the summary (a model of the monster's own provider, `summarizer.ts`); throws on failure. */
export type Summarizer = (input: SummaryInput) => Promise<SummaryOutput>;

interface TurnSource {
  agent: AgentDefinition;
  isOrchestrator: boolean;
  /** The files of past messages (a line with their names, see `ConversationOptions.files`). */
  files?: ConversationOptions['files'];
  /** Names of monsters and projects (`ConversationOptions.names`, D-097). */
  names?: ConversationOptions['names'];
  /** Window of the model that will serve the first step, when known. */
  window?: number | undefined;
  /** Tokens of the rest of the prompt (instructions, memory, tools), as last measured. */
  fixedTokens?: number | undefined;
}

export interface HistoryRequest extends TurnSource {
  /** Events to leave out (the messages the agent is about to receive as its task). */
  exclude?: ReadonlySet<string>;
  /** The message of this turn: its tokens count for the window check. */
  request: string;
  /** Only these runs, as they are, without a summary: a giro of an automation (D-094). */
  runs?: ReadonlySet<string>;
}

export interface PrepareRequest extends TurnSource {
  /** The run that just ended its turn: the summary and its cost belong to it. */
  runId: string;
  /** A scope for a harness started for the summary (a service scope: it outlives the run). */
  scope?: () => ControlScope | undefined;
  signal?: AbortSignal;
}

export interface CompactedHistory {
  /** The turns sent as they are, merged, oldest first. */
  history: ModelMessage[];
  /** Summary of the older turns, sent before them; null when none. */
  summary: string | null;
  /** The summary covers runs that read third-party text: the run starts tainted. */
  tainted: boolean;
  /** Some turns after the summary did not fit and were left out. */
  truncated?: boolean;
}

/** Tokens of turns as the model gets them. */
export function turnTokens(turns: readonly ConversationTurn[]): number {
  return turns.reduce((n, t) => n + estimateTokens(t.content) + TURN_OVERHEAD, 0);
}

/**
 * When the conversation must be compacted: more turns than fit, or the next
 * request past the threshold of the window; null otherwise.
 */
export function compactionTrigger(o: {
  /** Turns after the latest summary. */
  turns: number;
  maxTurns: number;
  /** Estimated tokens of the next request. */
  estimate: number;
  window?: number | undefined;
  threshold?: number;
}): 'turns' | 'context' | null {
  if (o.turns > o.maxTurns) return 'turns';
  if (o.window && o.estimate > o.window * (o.threshold ?? CONTEXT_COMPACT_AT)) return 'context';
  return null;
}

/**
 * How many of the latest turns stay as they are: `keep`, fewer when even
 * those with a summary would pass `target` of the window (the history aims
 * below the threshold, so that the next compaction is not the next run).
 */
export function turnsToKeep(o: {
  turns: readonly ConversationTurn[];
  keep: number;
  maxTurns: number;
  /** Tokens besides the turns and the summary (rest of the prompt, the request). */
  base: number;
  window?: number | undefined;
  target?: number;
}): number {
  let keep = Math.min(o.keep, o.maxTurns, o.turns.length);
  if (!o.window) return keep;
  const limit = o.window * (o.target ?? COMPACT_TARGET);
  while (keep > 0 && o.base + SUMMARY_TOKENS + turnTokens(o.turns.slice(-keep)) > limit) keep--;
  return keep;
}

/** A tool of the log (`web_fetch`, `mcp__x__y`, a harness's `claude-agent.WebSearch`) that reads third-party text. */
export function readsThirdParty(tool: string): boolean {
  const dot = tool.indexOf('.');
  const name = dot > 0 && !tool.startsWith('mcp__') ? tool.slice(dot + 1) : tool;
  return (
    isThirdPartySource(name) ||
    name === 'WebSearch' ||
    name === 'WebFetch' ||
    name === 'web_search' ||
    name.startsWith('mcp__')
  );
}

/**
 * Any of these runs read third-party text: its end event says so (D-103: also
 * a taint it inherited, from a message, a report, a summary or a file), or,
 * for events older than that, one of its `tool_call` events.
 */
export function runsTainted(log: EventLog, runIds: Iterable<string>): boolean {
  for (const runId of new Set(runIds)) {
    for (const e of log.query({ runId, type: 'run', limit: 50 })) {
      if (e.type === 'run' && e.data.tainted === true) return true;
    }
    for (const e of log.query({ runId, type: 'tool_call', limit: 5000 })) {
      if (e.type === 'tool_call' && readsThirdParty(e.data.tool)) return true;
    }
  }
  return false;
}

export interface CompactorOptions {
  log: EventLog;
  questions?: QuestionStore | undefined;
  summarize: Summarizer;
  /** Turns that fit in the history (`settings.conversationTurns`). */
  maxTurns: () => number;
  /** Off: the latest turns only, as before D-082. Default on. */
  enabled?: () => boolean;
  keepTurns?: number;
  threshold?: number;
  timeoutMs?: number;
}

export class ConversationCompactor {
  readonly #o: CompactorOptions;
  /** Summaries being written, by agent: one at a time. */
  readonly #running = new Map<string, Promise<unknown>>();
  /** After a failure: the turns after the summary there were, by agent (retry after a few more). */
  readonly #failedAt = new Map<string, { summary: string | null; turns: number }>();

  constructor(options: CompactorOptions) {
    this.#o = options;
  }

  /** The latest summary of the agent's current conversation, if any. */
  latestSummary(agentId: string): LogEvent<'conversation_summary'> | null {
    const start = conversationStart(this.#o.log, agentId) ?? undefined;
    const [latest] = this.#o.log.query({
      type: 'conversation_summary',
      agent: agentId,
      after: start,
      order: 'desc',
      limit: 1,
    });
    return latest?.type === 'conversation_summary' ? latest : null;
  }

  /** Resolves when no summary is being written (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.#running.size > 0) await Promise.allSettled([...this.#running.values()]);
  }

  /**
   * The history of the next run of `agent`, without writing anything: the
   * summary of the older turns and the turns after it; the latest that fit
   * when they are more than `maxTurns` or past the threshold of the window.
   */
  history(req: HistoryRequest): CompactedHistory {
    const { log, questions } = this.#o;
    const agentId = req.agent.config.id;
    const maxTurns = this.#o.maxTurns();
    const base = {
      agentId,
      isOrchestrator: req.isOrchestrator,
      ...(req.exclude ? { exclude: req.exclude } : {}),
      ...(req.files ? { files: req.files } : {}),
      ...(req.names ? { names: req.names } : {}),
    };
    if (maxTurns <= 0) return { history: [], summary: null, tainted: false };
    if (req.runs) {
      return plain(
        conversationTurns(log, questions, { ...base, turns: maxTurns, runs: req.runs }),
        null,
        false,
      );
    }
    const latest = this.#o.enabled?.() === false ? null : this.latestSummary(agentId);
    // A summary written before D-141 may still say "Canva non è collegato": never read again.
    const previous = latest ? withoutAccessClaims(latest.data.text).text : null;
    // One more than fit: whether some were left out.
    const all = conversationTurns(log, questions, {
      ...base,
      turns: maxTurns + 1,
      after: latest?.data.to,
    });
    let turns = all.length > maxTurns ? all.slice(1) : all;
    if (req.window) {
      const limit = req.window * (this.#o.threshold ?? CONTEXT_COMPACT_AT);
      const fixed =
        (req.fixedTokens ?? DEFAULT_FIXED_TOKENS) +
        estimateTokens(req.request) +
        (previous ? estimateTokens(previous) + TURN_OVERHEAD : 0);
      while (turns.length > 0 && fixed + turnTokens(turns) > limit) turns = turns.slice(1);
    }
    const out = plain(turns, previous, latest?.data.tainted === true);
    return turns.length < all.length ? { ...out, truncated: true } : out;
  }

  /**
   * After a turn: when the conversation as it is now would not fit the next
   * run, the older turns become a summary for it. In the background, at most
   * one per agent, within `SUMMARY_TIMEOUT_MS`; never throws (a failure is an
   * `error` event and the next run has the latest turns). Resolves with what
   * was written, or null.
   */
  prepare(req: PrepareRequest): Promise<'turns' | 'context' | null> {
    const agentId = req.agent.config.id;
    // A run of an automation is not the chat: nothing of it to summarise (D-094).
    if (this.#running.has(agentId) || automationRunOf(this.#o.log, req.runId)) {
      return Promise.resolve(null);
    }
    const job = this.#prepare(req).catch(() => null);
    this.#running.set(agentId, job);
    void job.finally(() => this.#running.delete(agentId));
    return job;
  }

  async #prepare(req: PrepareRequest): Promise<'turns' | 'context' | null> {
    const { log, questions } = this.#o;
    const agentId = req.agent.config.id;
    const maxTurns = this.#o.maxTurns();
    if (maxTurns <= 0 || this.#o.enabled?.() === false) return null;
    const base = {
      agentId,
      isOrchestrator: req.isOrchestrator,
      ...(req.files ? { files: req.files } : {}),
      ...(req.names ? { names: req.names } : {}),
    };
    const latest = this.latestSummary(agentId);
    const previous = latest ? withoutAccessClaims(latest.data.text).text : null;
    let turns = conversationTurns(log, questions, {
      ...base,
      turns: MAX_UNCOVERED,
      after: latest?.data.to,
    });
    // More than can be read at once: the oldest first, a chunk at a time, nothing lost.
    const backlog = turns.length >= MAX_UNCOVERED;
    if (backlog) {
      turns = conversationTurns(log, questions, {
        ...base,
        turns: BACKLOG_CHUNK,
        after: latest?.data.to,
        oldest: true,
      });
    }
    const threshold = this.#o.threshold ?? CONTEXT_COMPACT_AT;
    const fixed = (req.fixedTokens ?? DEFAULT_FIXED_TOKENS) + REQUEST_TOKENS;
    const summaryTokens = previous ? estimateTokens(previous) + TURN_OVERHEAD : 0;
    const reason = backlog
      ? 'turns'
      : compactionTrigger({
          turns: turns.length,
          maxTurns,
          estimate: fixed + summaryTokens + turnTokens(turns),
          window: req.window,
          threshold,
        });
    if (!reason) return null;
    // The rest of the prompt alone is past the threshold: a summary would not help.
    if (reason === 'context' && req.window && fixed + SUMMARY_TOKENS > req.window * threshold) {
      return null;
    }
    // A summary that failed is tried again only after a few more turns, not at every turn.
    const failed = this.#failedAt.get(agentId);
    if (failed && failed.summary === (latest?.id ?? null)) {
      if (turns.length - failed.turns < RETRY_AFTER_TURNS) return null;
    }
    const keep = backlog
      ? 0
      : turnsToKeep({
          turns,
          keep: this.#o.keepTurns ?? SUMMARY_KEEP_TURNS,
          maxTurns,
          base: fixed,
          window: req.window,
        });
    let covered = turns.slice(0, turns.length - keep);
    // Never past the monster's latest answer: what came after it is still to be answered.
    if (!backlog) {
      let lastAnswer = -1;
      turns.forEach((t, i) => {
        if (t.role === 'assistant') lastAnswer = i;
      });
      covered = covered.slice(0, lastAnswer + 1);
    }
    if (covered.length === 0) return null;
    const timeout = AbortSignal.timeout(this.#o.timeoutMs ?? SUMMARY_TIMEOUT_MS);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    const scope = req.scope?.();
    try {
      const out = await this.#o.summarize({
        agent: req.agent,
        previous,
        turns: covered,
        runId: req.runId,
        signal,
        scope,
      });
      signal.throwIfAborted();
      // What the assistant said about its accesses is not a fact nor a decision (D-141).
      const text = fitSummary(withoutAccessClaims(out.text).text);
      if (text.length < 20) throw new Error(teamStrings().summaryEmpty);
      // A recursive summary much shorter than the old one lost its facts (seen on 16/10, D-082).
      if (previous && text.length < previous.length * SHRINK_LIMIT) {
        throw new Error(teamStrings().summaryShrunk);
      }
      const tainted =
        latest?.data.tainted === true ||
        runsTainted(
          log,
          covered.flatMap((t) => (t.runId ? [t.runId] : [])),
        );
      log.append({
        agent: agentId,
        runId: req.runId,
        type: 'conversation_summary',
        data: {
          text,
          from: latest?.data.from ?? covered[0]!.id,
          to: covered.at(-1)!.id,
          turns: (latest?.data.turns ?? 0) + covered.length,
          ...(latest ? { previous: latest.id } : {}),
          reason,
          ...(out.provider ? { provider: out.provider } : {}),
          ...(out.model ? { model: out.model } : {}),
          ...(tainted ? { tainted: true } : {}),
        },
      });
      this.#failedAt.delete(agentId);
      return reason;
    } catch (err) {
      if (req.signal?.aborted) return null;
      const why = timeout.aborted
        ? teamStrings().summaryTimeout(Math.round((this.#o.timeoutMs ?? SUMMARY_TIMEOUT_MS) / 1000))
        : errorMessage(err);
      this.#failedAt.set(agentId, { summary: latest?.id ?? null, turns: turns.length });
      log.append({
        agent: agentId,
        runId: req.runId,
        type: 'error',
        data: {
          code: 'compaction_failed',
          message: teamStrings().compactionFailed(
            req.agent.config.name,
            why,
            Math.min(maxTurns, turns.length),
          ),
        },
      });
      return null;
    } finally {
      scope?.close();
    }
  }
}

/**
 * Tokens of the rest of the prompt (harness base, instructions, memory and
 * profile, tools) as the agent's latest measured step had them (D-076), or
 * undefined before its first step.
 */
export function fixedContextTokens(log: EventLog, agentId: string): number | undefined {
  for (const e of log.query({ agent: agentId, type: 'provider_usage', order: 'desc', limit: 30 })) {
    if (e.type !== 'provider_usage' || !e.data.context) continue;
    const p = e.data.context.parts;
    return (p.base ?? 0) + (p.instructions ?? 0) + (p.memory ?? 0) + (p.tools ?? 0);
  }
  return undefined;
}

/** Sections of a summary given up first when it is too long: what was delivered, then the requests. */
const EXPENDABLE = SUMMARY_EXPENDABLE;

/**
 * A summary within `max` characters: trimmed; when longer, the lines of
 * "Consegnato" go first (from the last), then those of "Richieste e
 * obiettivi"; the facts, the decisions, the notes and what is open stay. Only
 * past that it is cut.
 */
export function fitSummary(text: string, max = SUMMARY_MAX_CHARS): string {
  let lines = text.trim().split('\n');
  const size = () => lines.join('\n').length;
  for (const head of EXPENDABLE) {
    if (size() <= max) break;
    const start = lines.findIndex((l) => head.test(l.trim()));
    if (start < 0) continue;
    let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l.trim()));
    if (end < 0) end = lines.length;
    while (size() > max && end - 1 > start) {
      lines = [...lines.slice(0, end - 1), ...lines.slice(end)];
      end--;
    }
    if (end - 1 === start && size() > max) lines.splice(start, 1);
  }
  const out = lines.join('\n').trim();
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/** Turns as history: without a summary it starts with a user turn, as before D-082. */
function plain(
  turns: readonly ConversationTurn[],
  summary: string | null,
  tainted: boolean,
): CompactedHistory {
  const history = mergeTurns(turns);
  if (!summary) while (history[0] && history[0].role !== 'user') history.shift();
  return { history, summary, tainted };
}
