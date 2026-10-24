import { z } from 'zod';
import {
  AllModelsFailedError,
  chatgptUnreachableText,
  classifyProviderError,
  costFromMetadata,
  errorMessage,
  estimateCostUsd,
  estimateTokens,
  formatModelRef,
  isStreamStart,
  StreamInterruptedError,
  subscriptionErrorOf,
  type ContextRescue,
  type ModelPrice,
  type ModelRef,
  type ProviderErrorKind,
  type ModelSession,
  type ProviderRegistry,
  type SessionEvent,
} from '@monsters/providers';
import { LANGS, type MonstersTool } from '@monsters/shared';
import { isStepCount, streamText, type ModelMessage, type StopCondition, type ToolSet } from 'ai';
import type { UserPart } from '../files/model-input.ts';
import { KilledError, type ControlScope } from '../kill/control-scope.ts';
import type { EventLog } from '../log/event-log.ts';
import { agentTokenLimit, limitTokens, type RunBudget } from '../team/run-limits.ts';
import { CallTracker, errorStreakReminder } from './call-tracker.ts';
import { contextLimitsFor, RunContext, type ContextLimits } from './context.ts';
import {
  contextLimit,
  ContextGuard,
  outputReserve,
  foldSteps,
  KEEP_TOOL_STEPS,
  type ResultLine,
} from './context-guard.ts';
import { createContextMeter, stepContext } from './context-usage.ts';
import type { AgentDefinition } from './definition.ts';
import { monstersCard, type CardContext, type HarnessCapabilities } from './monsters-card.ts';
import { createToolCallRepair } from './repair.ts';
import { splitMarkedMemory } from '../team/memory.ts';
import { sourcesRule, webMethod } from './templates.ts';
import { adaptTools, wrapExternalData, type ToolGuard } from './tool-adapter.ts';
import {
  DeferredTools,
  type MissedTool,
  recentToolUse,
  toolSearchConfigFor,
  type ToolSearchConfig,
  type ToolSetMemory,
} from './tool-search.ts';
import { cacheUsage } from './usage.ts';
import { runAgentPrompts, SUMMARY_TAGS } from './run-agent.prompts.ts';
import { runAgentStrings } from './run-agent.strings.ts';

/*
 * One agent working on one task (ARCHITECTURE §5.3): a stable system prompt
 * (AGENTS.md, rules, user profile, memory: the same for every task, so the
 * providers can cache it) and the task with its brief as the first message,
 * AI SDK loop with a step limit, every step and tool call in the event log,
 * clean stop on the kill switch signal. D-064: the last step has no tools and
 * asks for the report; repeated calls, failures in a row and malformed calls
 * are handled in the code; a stream that breaks after the first token is
 * retried once.
 */

/** Why a chain link was left, in the words of the action log (the app's language now). */
const fallbackReason = (kind: ProviderErrorKind): string => runAgentStrings().fallbackReason[kind];

/** Structured brief (same fields as `delegate`, ARCHITECTURE §5.4). */
export interface TaskBrief {
  goal: string;
  why?: string;
  /** Vault notes to read, as paths or [[wikilinks]]. */
  contextLinks?: string[];
  constraints?: string[];
  outputFormat?: string;
  doneWhen?: string;
}

export interface RunAgentOptions {
  agent: AgentDefinition;
  task: string | TaskBrief;
  /** Tools available in this core; the agent gets those listed in its agent.yaml. */
  tools: MonstersTool[];
  /**
   * Tools decided at runtime for this agent (MCP servers it may use), added
   * to those of its agent.yaml.
   */
  extraTools?: MonstersTool[];
  /** MCP services assigned to the agent but not connected now (`McpManager.unlinkedFor`). */
  unlinked?: readonly string[];
  /** The monsters of the squad that have the web, when this one has none (D-127): the card names them. */
  webElsewhere?: readonly string[];
  /** Causes the card says (D-132): why no web, the project, MCP tools past the cap. */
  card?: CardContext;
  /** From `RunController.startRun` (or a child scope): the kill switch aborts it. */
  signal: AbortSignal;
  /**
   * Scope the signal comes from (the run, or the delegation's child scope):
   * processes started by tools (`shell`) are tied to it. Without it tools
   * cannot start processes.
   */
  scope?: ControlScope;
  log: EventLog;
  runId: string;
  /** Builds the model session from the agent's fallback chain. */
  providers?: ProviderRegistry;
  /** Use this session instead (e.g. to keep the pinned model across tasks). */
  session?: ModelSession;
  /** Content of the agent's MEMORY.md: the caller reads it from the vault. */
  memory?: string;
  /** Essential user profile. */
  profile?: string;
  /** The "## Progetto" section of a project's monster (projects/context.ts, D-097). */
  project?: string;
  /** Parent event (e.g. the delegation that started this agent). */
  parentId?: string | null;
  /** How often partial text is written to the log. Default 250 ms. */
  partialFlushMs?: number;
  /** Earlier turns of the conversation, sent before the task (oldest first). */
  history?: ModelMessage[];
  /**
   * Summary of the turns older than `history` (C.3, D-082): sent first, as
   * the start of the earlier turns.
   */
  summary?: string;
  /**
   * Messages that arrived while the agent works: called before every step after
   * the first, the texts returned are added to the conversation as user turns
   * (with the parts of their files, when they have any).
   */
  inbox?: () => (string | InboxMessage)[];
  /** Parts after the text of the first message: the files the user attached (files/model-input.ts). */
  attachments?: UserPart[];
  /**
   * Cost limits of the whole run, shared by every agent of the run: each step
   * counts, the loop stops once they are exhausted and tools get `LIMIT_REACHED`.
   */
  budget?: RunBudget;
  /** How the tool results stay in the context: offload and masking (see `RunContext`). */
  contextLimits?: ContextLimits;
  /**
   * MCP tools loaded when needed past a threshold (`DeferredTools`, C.2):
   * default by the agent's models (free ones get a smaller set), `false` to
   * send them all.
   */
  toolSearch?: ToolSearchConfig | false;
  /**
   * Where the agent's tools of the last run are kept (D-168): a run that follows soon starts with
   * the same tools in the same order, so the prompt cache, which reads the tools first, is not
   * rewritten by a different preload.
   */
  toolMemory?: ToolSetMemory;
  /**
   * Own tools of the run that wait for `tools_search` in this turn, with the group the card
   * names them by (D-134): on a free chain the web for a request that does not seem to need it,
   * the rare note tools, the pages. Deferred, never taken away: the model can load them.
   */
  deferOwn?: ReadonlyMap<string, string>;
  /**
   * Stop hook: called once when the agent ends its turn with a text answer. A
   * reminder returned goes to the model as a system message and the agent gets
   * up to `FOLLOW_UP_STEPS` more steps. The extra steps count only if they call
   * a tool: a text-only reply is dropped and the first answer stands, unless
   * the hook says `textCounts` (a report rewritten after "finito davvero?",
   * D-067). May be async (the instinct answers in ~0.2 s).
   */
  onFinalAnswer?: (text: string) => FinalAnswerHook | Promise<FinalAnswerHook>;
  /**
   * A line for this turn only (the instinct's routing hint, D-067), added to
   * the first message: the system prompt stays the same for the cache.
   */
  hint?: string;
  /**
   * Observer of the loop (the instinct's "gira a vuoto?", D-067): called after
   * every step with the calls of the agent; what it returns before a step goes
   * to the agent as a reminder, or moves the session to the next model.
   */
  watcher?: StepWatcher;
  /** The instinct around the tool calls (outbound brake, injections, D-067). */
  guard?: ToolGuard;
  /** The context window of a model, when known (C.1: the `context` of every step). */
  contextWindow?: (ref: ModelRef) => number | undefined;
  /**
   * The price of a paid model (USD per million tokens), when the price list
   * knows it: a request whose provider reports no cost is counted with it,
   * and so is a request cut halfway (F-A4, D-114). Undefined for free models
   * and subscriptions, which cost nothing.
   */
  price?: (ref: ModelRef) => ModelPrice | undefined;
  /**
   * The project this run works for (D-097), written on every `provider_usage`:
   * the project's spending is what its runs spent, wherever the monster is
   * later (F-B13). Null: no project. Undefined: not written.
   */
  projectId?: string | null;
}

/** A message that arrived while the agent works, with the parts of its files. */
export interface InboxMessage {
  text: string;
  parts: UserPart[];
}

/** What a stop hook returns: a reminder (with how to treat the reply), or nothing. */
export type FinalAnswerHook = string | { text: string; textCounts?: boolean } | null | undefined;

/** One call of a tool as the loop saw it, in one line for the instinct. */
export interface StepCall {
  tool: string;
  /** Arguments, short. */
  args: string;
  /** Outcome in one line (`ok, 5 risultati`, `errore CONFLICT`, `ripetuta`). */
  outcome: string;
}

export interface StepWatcher {
  /** After a step: its number (0-based, over the whole turn) and its tool calls. */
  afterStep(step: number, calls: readonly StepCall[]): void;
  /** Before a step: a reminder for the agent, and whether to move to the next model. */
  beforeStep(): { reminder?: string; demote?: boolean } | null;
}

/** How far back the MCP tools an agent used count for the preloaded set. */
export const RECENT_TOOL_DAYS = 30;

/** Steps granted by a stop hook: a tool call, the reply after its result, one spare. */
export const FOLLOW_UP_STEPS = 3;

export type AgentRunStatus =
  'completed' | 'max_steps' | 'token_limit' | 'run_limit' | 'aborted' | 'failed';

/**
 * What ended a run that did not complete (D-160), when only the run knows it: the report of
 * a delegation says it, so the lead never has to guess ("X did not respond"). The limits are
 * already in the status (`run_limit`, `token_limit`, `max_steps`).
 */
export type RunStopCause =
  /** The user stopped this job or this monster. */
  | 'user'
  /** The kill switch stopped every monster. */
  | 'kill_switch'
  /** Monsters was closing. */
  | 'shutdown'
  /** The harness gave no sign of life and the watchdog stopped it (F-M3). */
  | 'watchdog'
  /** The harness could not reach Monsters' own tools (the `monsters` MCP server). */
  | 'tools_unavailable'
  /** The harness program reported an interruption Monsters did not ask for. */
  | 'harness';

/** The cause of an abort, from the reason of the scope that stopped the run. */
export function abortCause(reason: unknown): RunStopCause | undefined {
  if (!(reason instanceof KilledError)) return undefined;
  if (reason.scope === 'global')
    return /shutdown/.test(reason.message) ? 'shutdown' : 'kill_switch';
  return 'user';
}

export interface AgentRunResult {
  status: AgentRunStatus;
  /**
   * Final answer: the useful text of every step of the turn (an agent often
   * writes part of it before a tool call), without repetitions and without
   * text that only repeats the task. What the chat shows (D-038).
   */
  text: string;
  /**
   * Text of the last step that wrote any: the report of a delegated agent,
   * without the announcements of the steps before ("Ora cerco…", D-064).
   */
  finalText: string;
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
  /** Model that served the last step. */
  model: ModelRef | null;
  error?: string;
  /** Tools listed in agent.yaml but not available in this core. */
  missingTools: string[];
  /** The stop hook's reminder reached the agent and it got more steps. */
  followUp?: boolean;
  /** Why a run that did not complete stopped, when the status alone does not say (D-160). */
  stopCause?: RunStopCause;
}

export function resolveAgentTools(
  agent: AgentDefinition,
  available: MonstersTool[],
): { tools: MonstersTool[]; missing: string[] } {
  const byName = new Map(available.map((t) => [t.name, t]));
  const tools: MonstersTool[] = [];
  const missing: string[] = [];
  for (const name of agent.config.tools) {
    const t = byName.get(name);
    if (t) tools.push(t);
    else missing.push(name);
  }
  return { tools, missing };
}

/**
 * Plain text of the `aborted` error shown in the log, in the app's language. Neutral form
 * ("Rhea’s job stopped"): agent names have no grammatical gender.
 */
export function abortMessage(name: string, reason: string): string {
  const t = runAgentStrings();
  const m = /^stopped \((\w+)\)(?::\s*(.+))?$/.exec(reason);
  const why = m ? (m[2] ?? t.stopScope[m[1] ?? '']) : undefined;
  return t.aborted(name, why);
}

/** Text for comparisons: lower case, no @mentions, no punctuation, single spaces. */
function comparable(text: string): string {
  return text
    .toLowerCase()
    .replace(/@[\p{L}\p{N}_-]+/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Shorter tasks are not checked for echoes: "ciao" answered with "Ciao!" is fine. */
const ECHO_MIN_CHARS = 24;

/**
 * The text only repeats the task or a message of the user (a free model
 * sometimes answers with the request itself): an echo, not an answer.
 */
export function isEcho(text: string, sources: readonly string[]): boolean {
  const t = comparable(text);
  if (!t) return false;
  return sources.some((source) => {
    const s = comparable(source);
    return s.length >= ECHO_MIN_CHARS && (t === s || (s.includes(t) && t.length >= s.length * 0.6));
  });
}

/** The text so far is the beginning of a task or message: it may turn out to be an echo. */
function mayBeEcho(text: string, sources: readonly string[]): boolean {
  const t = comparable(text);
  return sources.some((source) => {
    const s = comparable(source);
    return s.length >= ECHO_MIN_CHARS && s.startsWith(t);
  });
}

/**
 * Words of a reply that only acknowledges (the stop hook's reminder asks for
 * "OK" when the question in the text is fine as it is, D-108).
 */
const ACK_WORDS = new Set(
  [
    // i18n-ignore: the words of an acknowledgement, in both languages (D-153)
    'ok okay okey va bene benissimo fatto ricevuto capito perfetto d accordo daccordo certo sì si',
    'inteso chiaro grazie confermo done got it noted understood sure yes alright all right fine',
    'thanks thank you cool great right of course',
  ]
    .join(' ')
    .split(' '),
);
/** An acknowledgement is short: "OK", "Ok, fatto.", "Va bene, grazie!". */
const ACK_MAX_WORDS = 4;

/** Lowercase words without punctuation, emoji or markdown. */
function ackWords(text: string): string[] {
  const t = comparable(text.replace(/[’']/g, ' '));
  return t ? t.split(/\s+/u) : [];
}

/**
 * The text only acknowledges ("OK", "Fatto.", "Va bene", empty): after a stop
 * hook's reminder it answers the system, not the user, and is never the
 * answer of the turn (D-108).
 */
export function isAcknowledgement(text: string): boolean {
  const words = ackWords(text);
  return words.length <= ACK_MAX_WORDS && words.every((w) => ACK_WORDS.has(w));
}

/** The text so far may still turn out to be only an acknowledgement (it is held, not shown). */
export function mayBeAcknowledgement(text: string): boolean {
  const words = ackWords(text);
  if (words.length > ACK_MAX_WORDS) return false;
  const last = words.pop();
  if (!words.every((w) => ACK_WORDS.has(w))) return false;
  return last === undefined || [...ACK_WORDS].some((w) => w.startsWith(last));
}

/**
 * Adds the text of a step to the answer of the turn: a repetition of a part
 * already there is skipped, a part repeated and extended replaces the old one.
 */
export function addAnswerPart(parts: readonly string[], text: string): string[] {
  const t = text.trim();
  const c = comparable(t);
  if (!c) return [...parts];
  if (parts.some((p) => comparable(p).includes(c))) return [...parts];
  return [...parts.filter((p) => !c.includes(comparable(p))), t];
}

function briefSection(task: TaskBrief): string {
  const lines: string[] = [];
  const p = runAgentPrompts();
  if (task.why) lines.push(p.whyNeeded(task.why));
  if (task.contextLinks?.length) lines.push(p.usefulNotes(task.contextLinks.join(', ')));
  if (task.constraints?.length) lines.push(p.constraints, ...task.constraints.map((c) => `- ${c}`));
  if (task.outputFormat) lines.push(p.outputFormat(task.outputFormat));
  if (task.doneWhen) lines.push(p.doneWhen(task.doneWhen));
  // A brief in another language made a note in that language (eval of 16/10, D-073):
  // the language of the notes is the one of the agent's instructions, always.
  if (lines.length > 0) lines.push(briefLanguageNote());
  return lines.join('\n');
}

/** The last line of every brief (D-073), in the family of the app's language. */
export const briefLanguageNote = (): string => runAgentPrompts().briefLanguageNote;

/**
 * The first message of a task: the goal, then the brief. The brief changes
 * with every delegation, so it stays out of the system prompt (D-064).
 */
export function taskMessage(task: TaskBrief): string {
  const brief = briefSection(task);
  return brief ? runAgentPrompts().currentTask(task.goal, brief) : task.goal;
}

/** The tag around the summary of the older turns (D-082), in the family of the app's language. */
export const summaryTag = (): string => runAgentPrompts().summaryTag;

/**
 * How the monster reads the summary of the older turns: data inside a tag,
 * never with the authority of Monsters or of the user. It is a model's
 * rewording of messages that may have quoted hostile pages (review of D-082).
 */
export const summaryHeader = (): string => {
  const p = runAgentPrompts();
  return `<${p.summaryTag} ${p.summaryAttr}="${p.summaryNote}">`;
};

/** An opening or closing tag of the summary in either family (a summary may come from the other). */
const SUMMARY_TAG_PATTERN = new RegExp(`</?\\s*(?:${SUMMARY_TAGS.join('|')})`, 'gi');

/** The summary of the older turns as data (a closing tag inside it is neutralised). */
export function summaryText(summary: string): string {
  const p = runAgentPrompts();
  const body = summary.trim().replace(SUMMARY_TAG_PATTERN, p.summaryNeutralised);
  return `${summaryHeader()}\n${body}\n</${p.summaryTag}>`;
}

/**
 * The earlier turns with the summary of the older ones first (D-082): a user
 * message, merged with the first turn when that is the user's too.
 */
export function historyWithSummary(
  summary: string | undefined,
  history: readonly ModelMessage[],
): ModelMessage[] {
  if (!summary?.trim()) return [...history];
  const head = summaryText(summary);
  const first = history[0];
  if (first?.role === 'user' && typeof first.content === 'string') {
    return [{ role: 'user', content: `${head}\n\n${first.content}` }, ...history.slice(1)];
  }
  return [{ role: 'user', content: head }, ...history];
}

/**
 * The line after an answer the model cut at its length limit (F-M4): the user
 * (or the orchestrator reading a report) knows it is not the whole answer, and
 * the next turn knows where to go on from.
 */
export const truncatedNote = (): string => runAgentStrings().truncatedNote;

/** What the agent reads at its last step, when no tool is available any more. */
export const finalStepNote = (): string => runAgentPrompts().finalStepNote;

/**
 * The agent's AGENTS.md for a run with these tools (D-134, A7 of the review of 19/10): the
 * web method and the sources rule were written in it when the monster was made with the web;
 * a run without web tools (permission off, the project's search off, a covered capo) does not
 * read how to use tools it does not have. Nothing changes on disk.
 */
export function instructionsForTools(instructions: string, toolNames: readonly string[]): string {
  if (toolNames.some((n) => n.startsWith('web_'))) return instructions;
  // Either family (D-153): the file keeps the language it was written in.
  let out = instructions;
  for (const lang of LANGS) {
    const heading = webMethod(lang).trim().split('\n')[0]!;
    out = out
      .replace(new RegExp(`\\n${escapeRegex(heading)}\\n[\\s\\S]*?(?=\\n## |$)`), '\n')
      .replace(`\n- ${sourcesRule(lang)}`, '');
  }
  return out;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Arguments that pick an element, not a filter of a list. */
const NOT_A_FILTER = /(?:^|_)(?:id|ids|key|chiave|idempotenza|idempotency)$/i;

/**
 * The filters of each tool, for the note of a long result (D-163): its optional arguments but
 * the ids and keys (`testo, stato, pagina, per_pagina`), at most six.
 */
export function filtersOf(tools: readonly MonstersTool[]): (tool: string) => readonly string[] {
  const cache = new Map<string, readonly string[]>();
  const byName = new Map(tools.map((t) => [t.name, t]));
  return (name) => {
    const known = cache.get(name);
    if (known) return known;
    const t = byName.get(name);
    let out: string[] = [];
    if (t) {
      try {
        const json = (t.inputJsonSchema ??
          z.toJSONSchema(t.inputSchema, { io: 'input', unrepresentable: 'any' })) as {
          properties?: Record<string, unknown>;
          required?: string[];
        };
        const required = new Set(json.required ?? []);
        out = Object.keys(json.properties ?? {})
          .filter((a) => !required.has(a) && !NOT_A_FILTER.test(a))
          .slice(0, 6);
      } catch {
        out = [];
      }
    }
    cache.set(name, out);
    return out;
  };
}

/**
 * The words the preload of the MCP tools ranks by (D-163): the request and the user's last
 * messages before it.
 */
export function turnWords(task: TaskBrief, history: readonly ModelMessage[]): string {
  const said = history
    .filter((m) => m.role === 'user')
    .slice(-2)
    .map((m) =>
      typeof m.content === 'string'
        ? m.content
        : m.content.map((p) => (p.type === 'text' ? p.text : '')).join(' '),
    );
  return [task.goal, ...(task.why ? [task.why] : []), ...said].join('\n');
}

/**
 * What the run tells the model about tools it called while they were not sent (D-134): loaded
 * now, past the run's cap, or not tools of this run. Never the user's no.
 */
export function missedToolsNote(missed: readonly MissedTool[]): string {
  const p = runAgentPrompts();
  const lines = missed.map((m) =>
    m.state === 'loaded'
      ? p.missedLoaded(m.name)
      : m.state === 'limit'
        ? p.missedLimit(m.name, m.max)
        : p.missedUnknown(m.name),
  );
  return lines.length > 0 ? `[Monsters] ${lines.join(' ')}` : '';
}

/**
 * System prompt, from the most stable part to the least: AGENTS.md, the rules
 * of the system, the "## Monsters" card (D-075), the user profile, the memory.
 * Nothing of the task: two delegations to the same agent send the same prefix
 * (D-064).
 */
export function buildSystemPrompt(options: {
  agent: AgentDefinition;
  memory?: string | undefined;
  profile?: string | undefined;
  toolNames: string[];
  /** Some tools return third-party data inside `<dati_esterni>`. */
  externalData?: boolean;
  /** A harness run: what the harness gives besides Monsters' tools (for the card). */
  harness?: HarnessCapabilities;
  /** The "## Progetto" section of a project's monster (D-097). */
  project?: string | undefined;
  /** What waits for `tools_search` (C.2, D-098): the card says it. */
  search?: { mcp: boolean; own: readonly string[] };
  /** Services assigned but not connected now: the card says it (connettori 6). */
  unlinked?: readonly string[] | undefined;
  /** The monsters of the squad that have the web, when this one has none (D-127). */
  webElsewhere?: readonly string[];
  /** Causes the card says (D-132): why no web, the project, MCP tools past the cap. */
  card?: CardContext;
}): string {
  const { agent } = options;
  const parts = [instructionsForTools(agent.instructions, options.toolNames).trim()];
  // Lines of the memory written after third-party text: data, not the monster's own memory.
  const memory = splitMarkedMemory(options.memory ?? '');
  const p = runAgentPrompts();
  const rules = [
    p.ruleSteps(agent.config.limits.maxSteps),
    p.ruleToolError,
    // D-132: who said no is part of the code; the model never guesses it.
    p.ruleWhoSaidNo,
  ];
  if (
    options.externalData ||
    memory.external.length > 0 ||
    options.toolNames.some((n) => n.startsWith('web_'))
  ) {
    rules.push(p.ruleExternalData);
  }
  if (options.toolNames.some((n) => n === 'shell' || n.startsWith('fs_'))) {
    rules.push(p.ruleTerminal);
  }
  parts.push(`${p.rulesHead}\n${rules.map((r) => `- ${r}`).join('\n')}`);
  parts.push(
    monstersCard({
      toolNames: options.toolNames,
      ...(options.harness ? { harness: options.harness } : {}),
      ...(options.search ? { mcpSearch: options.search.mcp, searched: options.search.own } : {}),
      ...(options.unlinked?.length ? { unlinked: options.unlinked } : {}),
      ...(options.webElsewhere ? { webElsewhere: options.webElsewhere } : {}),
      ...options.card,
    }),
  );
  if (options.project?.trim()) parts.push(options.project.trim());
  if (options.profile?.trim()) parts.push(`${p.profileHead}\n${options.profile.trim()}`);
  if (memory.own.trim()) parts.push(`${p.memoryHead}\n${memory.own.trim()}`);
  if (memory.external.length > 0) {
    parts.push(
      p.externalMemory(wrapExternalData(p.externalMemorySource, memory.external.join('\n'))),
    );
  }
  parts.push(accessNow());
  return parts.join('\n\n');
}

/**
 * Last in the system prompt, after the memory (D-141): the accesses of the card are those of
 * now. On 19/10 a memory and a summary said "la ricerca web è negata" after the user had
 * turned it on, and the monster believed them over the card.
 */
export const accessNow = (): string => runAgentPrompts().accessNow;

/**
 * The conversation of a pass rebuilt with the messages that arrived while the
 * agent worked (AG-15): `response` are the messages of the SDK (assistant and
 * tools only), `injected` the user messages added before a step, each placed
 * after the response messages that came before it.
 */
export function withInjected(
  sent: ModelMessage[],
  response: ModelMessage[],
  injected: readonly { after: number; message: ModelMessage }[],
): ModelMessage[] {
  if (injected.length === 0) return [...sent, ...response];
  const out = [...sent];
  let i = 0;
  for (const [n, m] of response.entries()) {
    while (i < injected.length && injected[i]!.after <= n) out.push(injected[i++]!.message);
    out.push(m);
  }
  while (i < injected.length) out.push(injected[i++]!.message);
  return out;
}

export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const { agent, log, runId, signal } = options;
  const agentId = agent.config.id;
  const parentId = options.parentId ?? null;
  const task: TaskBrief = typeof options.task === 'string' ? { goal: options.task } : options.task;
  const resolved = resolveAgentTools(agent, options.tools);
  const missing = resolved.missing;
  const names = new Set(resolved.tools.map((t) => t.name));
  const ownTools = [
    ...resolved.tools,
    ...(options.extraTools ?? []).filter((t) => !names.has(t.name) && names.add(t.name)),
  ];
  // Long results out of the context, old ones masked (C.2): `result_read` reads them again.
  // Pieces of a long result as big as the model's window allows; its note names the filters (D-163).
  const first = agent.config.models[0];
  const runContext = new RunContext(
    {
      ...contextLimitsFor(first ? options.contextWindow?.(first) : undefined),
      ...options.contextLimits,
    },
    filtersOf(ownTools),
  );
  const withContext = ownTools.length > 0 ? [...ownTools, runContext.tool()] : ownTools;
  // Many MCP tools: the most used ones and `tools_search`, the others on request (C.2).
  const deferral =
    options.toolSearch === false
      ? null
      : DeferredTools.plan(
          withContext,
          options.toolSearch ?? toolSearchConfigFor(agent.config.models),
          () =>
            recentToolUse(
              log.query({
                agent: agentId,
                type: 'tool_call',
                since: Date.now() - RECENT_TOOL_DAYS * 86_400_000,
                order: 'desc',
                limit: 1000,
              }),
            ),
          options.deferOwn,
          turnWords(task, options.history ?? []),
          options.toolMemory?.get(agentId),
        );
  const agentTools = deferral ? [...withContext, deferral.tool()] : withContext;

  const onSessionEvent = (e: SessionEvent) => {
    if (e.type !== 'fallback') return;
    // A ChatGPT plan error is logged once, with OpenAI's code, when the turn fails.
    if (e.kind === 'subscription') return;
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: {
        code: 'provider_fallback',
        message: runAgentStrings().fallbackLine(
          formatModelRef(e.from),
          e.to ? formatModelRef(e.to) : undefined,
          fallbackReason(e.kind),
          e.error,
        ),
      },
    });
  };
  let session = options.session;
  if (!session) {
    if (!options.providers) throw new Error('runAgent needs `providers` or `session`');
    session = options.providers.session(agent.config.models, { onEvent: onSessionEvent });
  }

  const budget = options.budget;
  const history = historyWithSummary(options.summary, options.history ?? []);
  const firstMessage = options.hint ? `${taskMessage(task)}\n\n${options.hint}` : taskMessage(task);
  const system = buildSystemPrompt({
    agent,
    memory: options.memory,
    profile: options.profile,
    project: options.project,
    toolNames: agentTools.map((t) => t.name),
    externalData: agentTools.some((t) => t.externalSource !== undefined),
    ...(deferral ? { search: { mcp: deferral.mcp, own: deferral.ownDeferred } } : {}),
    unlinked: options.unlinked,
    ...(options.webElsewhere ? { webElsewhere: options.webElsewhere } : {}),
    ...(options.card ? { card: options.card } : {}),
  });
  const calls = new CallTracker();
  const toolSet: ToolSet = adaptTools(agentTools, {
    calls,
    log,
    agentId,
    runId,
    signal,
    parentId,
    ...(options.scope ? { scope: options.scope } : {}),
    ...(budget ? { budget } : {}),
    ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
    ...(options.guard ? { guard: options.guard } : {}),
    // Links given in the task or the prompt are not "made up" (link check of web agents).
    knownText: [system, firstMessage, ...history.map((m) => JSON.stringify(m.content))].join('\n'),
  });

  // What each step's context holds, part by part (C.1): measured, never sent.
  const meter = createContextMeter({
    system,
    memory: options.memory,
    profile: options.profile,
    tools: toolSet,
    historyLength: history.length,
    summary: options.summary,
  });
  let stepParts: ReturnType<typeof meter.measure> | null = null;
  const sumParts = (p: ReturnType<typeof meter.measure>) =>
    Object.values(p).reduce((n: number, v) => n + (v ?? 0), 0);

  // The guard of the window (C.3, D-082): mask harder, then fold the earlier steps.
  const guard = new ContextGuard();
  const asUser = (text: string): ModelMessage => ({ role: 'user', content: text });
  const resultLine: ResultLine = (callId) => runContext.resultLine(callId);
  const windowNow = (): number | undefined => {
    const ref = session.pinned ?? session.effectiveChain()[0];
    return ref ? options.contextWindow?.(ref) : undefined;
  };
  const guardNote = (message: string) =>
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: { code: 'context_guard', message },
    });
  /** The messages of a step, shrunk as far as the window asks. */
  const fitWindow = (raw: ModelMessage[], tools: boolean | readonly string[]): ModelMessage[] => {
    const shape = () => {
      // From level 1 on, only the results of the last steps stay whole, at every step.
      if (guard.level >= 1) runContext.squeeze(raw, KEEP_TOOL_STEPS);
      return guard.apply(runContext.compact(raw), asUser, resultLine);
    };
    let out = shape();
    const window = windowNow();
    if (!window) return out;
    const limit = contextLimit(window, limits.maxOutputTokens);
    const estimate = () => guard.calibrated(sumParts(meter.measure(out, tools)));
    let now = estimate();
    if (now <= limit) return out;
    if (guard.level < 1) {
      guard.raise(1);
      out = shape();
      const before = now;
      now = estimate();
      guardNote(
        runAgentStrings().contextAlmostFull(agent.config.name, before, window, KEEP_TOOL_STEPS),
      );
      if (now <= limit) return out;
    }
    if (guard.level < 2) {
      guard.raise(2);
      out = shape();
      guardNote(runAgentStrings().contextStillFull(agent.config.name, now, window));
    }
    return out;
  };
  // A provider that still refuses the request as too long: the same fold, the same model (D-082).
  const rescue: ContextRescue = (ref, prompt) => {
    guard.raise(2);
    const folded = foldSteps(prompt, {
      keep: KEEP_TOOL_STEPS,
      line: resultLine,
      make: (text) => ({ role: 'user' as const, content: [{ type: 'text' as const, text }] }),
    });
    if (folded === prompt) return null;
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: {
        code: 'context_rescue',
        message: runAgentStrings().contextRescue(formatModelRef(ref)),
      },
    });
    return folded;
  };
  session.setContextRescue(rescue);
  // Every tool of the run can be called, only the loaded ones are sent (D-163).
  if (deferral) session.setToolFilter((name) => deferral.sends(name));

  const limits = agent.config.limits;
  const maxTokens = agentTokenLimit(agent.config, budget?.limits);
  let totalIn = 0;
  let totalOut = 0;
  /** What the token limits count (`limitTokens`): cache reads left out. */
  let counted = 0;
  let tokenLimitHit = false;
  /**
   * Why the last step had no tools (AG-03): the agent's steps, its tokens or
   * the run's budget ran out. Once set, the limits stop the loop.
   */
  let forced: 'max_steps' | 'token_limit' | 'run_limit' | null = null;
  const stopWhen: StopCondition<ToolSet>[] = [isStepCount(limits.maxSteps)];
  let runLimit: string | null = null;
  if (budget) {
    runLimit = budget.exhausted(agentId);
    // The report step comes first: the loop stops after it.
    stopWhen.push(() => (runLimit = budget.exhausted(agentId)) !== null && forced !== null);
  }
  if (maxTokens !== undefined) {
    stopWhen.push(() => {
      tokenLimitHit = counted >= maxTokens;
      return tokenLimitHit && forced !== null;
    });
  }
  /** The step about to start (counted over every pass) must be the last one. */
  const lastStepReason = (agentStep: number): typeof forced => {
    if (agentStep >= limits.maxSteps - 1) return 'max_steps';
    if (budget && (budget.exhausted(agentId) !== null || budget.stepsLeft() <= 1))
      return 'run_limit';
    if (maxTokens !== undefined && counted >= maxTokens) return 'token_limit';
    return null;
  };

  /** What the user asked in this turn: an answer that only repeats it is no answer. */
  const asked: string[] = [...new Set([task.goal, firstMessage])];
  // Partial text goes to the log in small batches, not per token.
  const flushMs = options.partialFlushMs ?? 250;
  let pending = '';
  let stepText = '';
  /** Useful text of the steps of this turn: together they are the answer. */
  let parts: string[] = [];
  /** Useful text of the last step that wrote any (the report of a delegation). */
  let finalText = '';
  /** First answer, kept while the extra steps of a stop hook may still drop their text. */
  let held: string | null = null;
  let heldParts: string[] = [];
  let heldFinal = '';
  /**
   * The first answer, logged as a message of its own when the extra steps
   * called a tool: it stays the answer if they end with nothing more to say.
   */
  let delivered = null as { parts: string[]; finalText: string } | null;
  /** Partial chunks were logged and no final message closed them yet. */
  let draftOpen = false;
  let timer: NodeJS.Timeout | undefined;
  /**
   * Sends the pending text to the log. While the text of the step could still
   * be only the task repeated, it waits; at the end of the step (`stepDone`) an
   * echo is dropped, never shown.
   */
  const flush = (stepDone = false) => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!pending || held !== null) return;
    if (stepDone ? isEcho(stepText, asked) : mayBeEcho(stepText, asked)) {
      if (stepDone) pending = '';
      return;
    }
    // After a reminder, an "OK" answers the system: never shown (D-108).
    if (followUp && (stepDone ? isAcknowledgement : mayBeAcknowledgement)(stepText)) {
      if (stepDone) pending = '';
      return;
    }
    const text = pending;
    pending = '';
    draftOpen = true;
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'message',
      data: { role: 'agent', text, partial: true },
    });
  };

  let steps = 0;
  let stepStarted = Date.now();
  /** Tool calls of the current step, for the watcher. */
  let stepCalls: StepCall[] = [];
  /** The stop hook's reminder reached the agent. */
  let followUp = false;
  /** The answer of the turn is already in the log as a message of its own. */
  let answerLogged = false;
  let lastFinish: string | undefined;
  let streamError: unknown;
  let aborted = false;
  /** A step only repeated the task. */
  let echoed = false;
  let servedModel: ModelRef | null = null;
  /** The project of the run on every `provider_usage` (F-B13). */
  const projectField = options.projectId !== undefined ? { project: options.projectId } : {};
  /**
   * The model's stream of the current step while it has not finished: a stream
   * broken halfway, asked again or stopped is billed all the same (F-A4).
   */
  let attempt: { chars: number; started: number } | null = null;
  /** Input tokens of the current step as measured before it (what a cut request read). */
  let stepInput = 0;
  /**
   * A request without the provider's final count: its tokens are the ones
   * known, or estimated (input as measured, output from the characters
   * received), its cost the provider's or the price list's.
   */
  const logPartial = (p: {
    ref: ModelRef;
    keyId?: string | undefined;
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    costUsd?: number | undefined;
    chars: number;
    durationMs: number;
    partial: 'interrupted' | 'aborted' | 'abandoned';
  }) => {
    const inputTokens = p.inputTokens ?? stepInput;
    const outputTokens = p.outputTokens ?? estimateTokens(p.chars);
    const priced =
      p.costUsd ?? estimateCostUsd({ inputTokens, outputTokens }, options.price?.(p.ref));
    const estimated =
      p.costUsd === undefined || p.inputTokens === undefined || p.outputTokens === undefined;
    totalIn += inputTokens;
    totalOut += outputTokens;
    counted += inputTokens + outputTokens;
    budget?.addUsage(inputTokens + outputTokens, priced ?? 0);
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'provider_usage',
      data: {
        provider: p.ref.provider,
        model: p.ref.model,
        inputTokens,
        outputTokens,
        ...(priced !== undefined ? { costUsd: priced } : {}),
        ...(estimated ? { estimated: true } : {}),
        partial: p.partial,
        durationMs: p.durationMs,
        ...(p.keyId !== undefined ? { keyId: p.keyId } : {}),
        step: steps,
        ...projectField,
      },
    });
  };
  /** The requests the session gave up after the model worked on them (F-A4). */
  const logAbandoned = () => {
    for (const a of session.takeAbandoned()) {
      logPartial({
        ref: a.ref,
        keyId: a.keyId,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        costUsd: a.costUsd,
        chars: a.chars,
        durationMs: a.durationMs,
        partial: a.reason === 'aborted' ? 'aborted' : 'abandoned',
      });
    }
  };
  /** The stream of the step ended without its finish: what it cost so far. */
  const closeAttempt = (partial: 'interrupted' | 'aborted') => {
    const open = attempt;
    attempt = null;
    if (!open) return;
    const served = session.lastServed;
    const ref = served?.ref ?? session.pinned ?? session.effectiveChain()[0];
    if (!ref) return;
    logPartial({
      ref,
      keyId: served?.keyId,
      chars: open.chars,
      durationMs: Date.now() - open.started,
      partial,
    });
  };

  // The run is already out of steps or tokens (a later turn, a late delegation).
  if (runLimit) {
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: { code: 'run_limit', message: runAgentStrings().noStart(agent.config.name, runLimit) },
    });
    return {
      text: '',
      finalText: '',
      steps: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      model: null,
      missingTools: missing,
      status: 'run_limit',
      error: runLimit,
    };
  }

  const inbox = options.inbox;
  /** User messages added before a step of the current pass, with their place (AG-15). */
  let injected: { after: number; message: ModelMessage }[] = [];
  /** A stream that broke after the first token is retried once per turn (AG-21). */
  let streamRetried = false;
  const repairToolCall = createToolCallRepair<ToolSet>((callId, what) =>
    calls.markRepaired(callId, what),
  );
  const pass = async (messages: ModelMessage[], conditions: StopCondition<ToolSet>[]) => {
    injected = [];
    const messagesSent = messages.length;
    const stepsBefore = steps;
    /** Streams started in the current step: a second one is the retry of a broken attempt. */
    let streamsInStep = 0;
    /** The current step's stream failed (its finish has no usage). */
    let stepFailed = false;
    const passWindow = windowNow();
    const maxOutputTokens =
      limits.maxOutputTokens ?? (passWindow ? outputReserve(passWindow) : undefined);
    const result = streamText({
      model: session,
      system,
      messages,
      tools: toolSet,
      stopWhen: conditions,
      abortSignal: signal,
      // Retries and fallbacks are handled by the model session and the rate budget;
      // a stream broken halfway is asked again once (`onError`).
      maxRetries: 0,
      streamRetries: 0,
      // Only the session's marker of a new attempt (`STREAM_START`).
      includeRawChunks: true,
      repairToolCall,
      // The room the guard keeps for the answer is the answer's limit too (D-082).
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      onError: ({ error }) => {
        // Only a failure of the stream after its start reaches here as a retry:
        // the session already walked the chain for the ones before the first
        // token. Tool calls of the broken attempt were not run (the SDK holds
        // them until the step ends), those of the steps before are not run again.
        if (!(error instanceof StreamInterruptedError) || streamRetried || signal.aborted) return;
        if (subscriptionErrorOf(error)) return;
        streamRetried = true;
        const from = servedModel ? formatModelRef(servedModel) : runAgentStrings().theModel;
        log.append({
          agent: agentId,
          runId,
          parentId,
          type: 'error',
          data: {
            code: 'stream_retry',
            message: runAgentStrings().streamBroke(from, errorMessage(error)),
          },
        });
        return { retry: true };
      },
      prepareStep: ({ stepNumber, messages, steps: done }) => {
        let next = messages;
        // A waiting tool called by its name (the card names it) before a search: it is
        // loaded now, so the call that failed works at the next step (D-098).
        const missedNote: ModelMessage[] = [];
        // A waiting tool called by its name ran at once (D-163): from now on it is sent.
        if (deferral) {
          deferral.calledDirectly(
            (done.at(-1)?.content ?? [])
              .filter((p) => p.type === 'tool-call' && !(p as { invalid?: boolean }).invalid)
              .map((p) => (p as { toolName: string }).toolName),
          );
        }
        const invalid = (done.at(-1)?.content ?? [])
          .filter((p) => p.type === 'tool-call' && (p as { invalid?: boolean }).invalid)
          .map((p) => (p as { toolName: string }).toolName);
        if (invalid.length > 0) {
          // The model reads what happened to each (D-134), never only the SDK's "unavailable
          // tool"; a tool of the run called with wrong arguments is not missing.
          const told = missedToolsNote(
            deferral
              ? deferral.loadCalled(invalid)
              : [...new Set(invalid)]
                  .filter((name) => !toolSet[name])
                  .map((name) => ({ name, state: 'unknown' as const })),
          );
          if (told) missedNote.push({ role: 'user', content: told });
        }
        const arrived = inbox && stepNumber > 0 ? inbox() : [];
        asked.push(...arrived.map((m) => (typeof m === 'string' ? m : m.text)));
        const extra: ModelMessage[] = [
          ...missedNote,
          ...arrived.map((m): ModelMessage =>
            typeof m === 'string' || m.parts.length === 0
              ? { role: 'user', content: typeof m === 'string' ? m : m.text }
              : {
                  role: 'user',
                  content: [
                    ...(m.text ? [{ type: 'text' as const, text: m.text }] : []),
                    ...m.parts,
                  ],
                },
          ),
        ];
        // The instinct's watcher ("gira a vuoto?", D-067): a reminder, or another model.
        const watched = stepNumber > 0 ? options.watcher?.beforeStep() : null;
        if (watched?.reminder) extra.push({ role: 'user', content: watched.reminder });
        if (watched?.demote) session.demote();
        // Failures in a row: a reminder, then another model (AG-16).
        const streak = stepNumber > 0 ? calls.streakAction() : null;
        if (streak) {
          extra.push({ role: 'user', content: errorStreakReminder(streak.count) });
          const moved = streak.action === 'demote' && session.demote();
          log.append({
            agent: agentId,
            runId,
            parentId,
            type: 'error',
            data: {
              code: 'tool_error_streak',
              message: runAgentStrings().errorStreak(agent.config.name, streak.count, moved),
            },
          });
        }
        if (extra.length > 0) {
          // Their place among the SDK's response messages: what was neither sent nor added.
          const after = messages.length - messagesSent - injected.length;
          for (const message of extra) injected.push({ after, message });
          next = [...next, ...extra];
        }
        // Last step of the agent or of the run: no tools, the report now (AG-03).
        const reason = lastStepReason(stepsBefore + stepNumber);
        const active = deferral?.activeNames();
        if (reason) {
          forced = reason;
          const last: ModelMessage[] = [
            ...fitWindow(next, false),
            { role: 'user', content: finalStepNote() },
          ];
          stepParts = meter.measure(last, false);
          stepInput = guard.calibrated(sumParts(stepParts));
          return { messages: last, toolChoice: 'none', activeTools: [] };
        }
        next = fitWindow(next, active ?? true);
        stepParts = meter.measure(next, active ?? true);
        stepInput = guard.calibrated(sumParts(stepParts));
        if (!active) return next === messages ? undefined : { messages: next };
        // A fixed order and a set that only grows: the prefix changes once per load. Every tool
        // stays active, so one called by its name runs; the session sends the loaded ones (D-163).
        return {
          ...(next === messages ? {} : { messages: next }),
          toolOrder: active,
        };
      },
    });

    try {
      for await (const part of result.stream) {
        switch (part.type) {
          case 'start-step':
            stepStarted = Date.now();
            stepText = '';
            streamsInStep = 0;
            stepCalls = [];
            stepFailed = false;
            break;
          case 'tool-result':
            if (options.watcher) stepCalls.push(stepCall(part.toolName, part.input, part.output));
            break;
          case 'tool-error':
            if (options.watcher) {
              stepCalls.push({
                tool: part.toolName,
                args: shortArgs(part.input),
                outcome: runAgentPrompts().outcomeError,
              });
            }
            break;
          case 'raw':
            if (!isStreamStart(part.rawValue)) break;
            // A new attempt of the same step after a broken stream: what the broken
            // one wrote is not part of the answer (the draft keeps what was flushed),
            // what it cost is (F-A4).
            if (streamsInStep++ > 0) {
              closeAttempt('interrupted');
              stepText = '';
              pending = '';
            }
            attempt = { chars: 0, started: Date.now() };
            break;
          case 'text-delta':
            pending += part.text;
            stepText += part.text;
            if (attempt) attempt.chars += part.text.length;
            timer ??= setTimeout(flush, flushMs);
            break;
          case 'reasoning-delta':
            if (attempt) attempt.chars += part.text.length;
            break;
          case 'tool-input-delta':
            if (attempt) attempt.chars += part.delta.length;
            break;
          case 'tool-call':
            if (held !== null) {
              // The extra steps act: the first answer becomes a message of its own.
              const first = held;
              delivered = { parts: heldParts, finalText: heldFinal };
              held = null;
              heldParts = [];
              heldFinal = '';
              draftOpen = false;
              log.append({
                agent: agentId,
                runId,
                parentId,
                type: 'message',
                data: { role: 'agent', text: first },
              });
            }
            flush(true);
            // The text before a tool call is a message of its own (clients close it here).
            draftOpen = false;
            break;
          case 'finish-step': {
            flush(true);
            // A step that ended on a failure has no count of its own: what it cost so far (F-A4).
            const cut =
              stepFailed &&
              part.usage.inputTokens === undefined &&
              part.usage.outputTokens === undefined;
            if (cut) closeAttempt('interrupted');
            attempt = null;
            logAbandoned();
            const served = session.lastServed;
            const model = served?.ref.model ?? part.response.modelId;
            const provider = served?.ref.provider ?? session.provider;
            const inTok = part.usage.inputTokens ?? 0;
            const outTok = part.usage.outputTokens ?? 0;
            totalIn += inTok;
            totalOut += outTok;
            const fresh = limitTokens(inTok, outTok, part.usage.inputTokenDetails?.cacheReadTokens);
            counted += fresh;
            const reported = costFromMetadata(part.providerMetadata);
            // No cost from the provider (a direct key): the price list's, when it has one (F-A4).
            const estimatedCost =
              reported === undefined
                ? estimateCostUsd(part.usage, options.price?.({ provider, model }))
                : undefined;
            const costUsd = reported ?? estimatedCost;
            budget?.addStep(fresh, costUsd ?? 0);
            lastFinish = part.finishReason;
            if (stepText.trim()) {
              if (isEcho(stepText, asked)) echoed = true;
              else if (followUp && isAcknowledgement(stepText)) {
                // The "OK" of the reply to a reminder: not a part of the answer (D-108).
              } else {
                parts = addAnswerPart(parts, stepText);
                finalText = stepText.trim();
              }
            }
            servedModel = { provider, model };
            if (stepParts) guard.calibrate(sumParts(stepParts), part.usage.inputTokens);
            const context = stepContext(
              stepParts,
              part.usage.inputTokens,
              options.contextWindow?.(servedModel),
            );
            stepParts = null;
            if (!cut)
              log.append({
                agent: agentId,
                runId,
                parentId,
                type: 'provider_usage',
                data: {
                  provider,
                  model,
                  ...(part.usage.inputTokens !== undefined ? { inputTokens: inTok } : {}),
                  ...(part.usage.outputTokens !== undefined ? { outputTokens: outTok } : {}),
                  ...cacheUsage(part.usage),
                  ...(costUsd !== undefined ? { costUsd } : {}),
                  ...(estimatedCost !== undefined ? { estimated: true } : {}),
                  durationMs: Date.now() - stepStarted,
                  ...(served && served.requested.model !== model
                    ? { requestedModel: served.requested.model }
                    : {}),
                  ...(served && served.queuedMs > 0 ? { queuedMs: served.queuedMs } : {}),
                  ...(served?.keyId !== undefined ? { keyId: served.keyId } : {}),
                  step: steps,
                  ...(context ? { context } : {}),
                  ...projectField,
                },
              });
            options.watcher?.afterStep(steps, stepCalls);
            steps++;
            break;
          }
          case 'error':
            streamError ??= part.error;
            stepFailed = true;
            break;
          case 'abort':
            aborted = true;
            break;
          default:
            break;
        }
      }
    } finally {
      // A step whose stream never finished (broken, stopped, failed on its retry) still cost.
      closeAttempt(aborted || signal.aborted ? 'aborted' : 'interrupted');
      logAbandoned();
    }
    return result;
  };

  const answer = () => parts.join('\n\n');
  /** The turn ended normally but without a word of answer. */
  const noAnswer = () =>
    streamError === undefined &&
    !aborted &&
    !signal.aborted &&
    lastFinish !== 'tool-calls' &&
    answer() === '';
  let emptyAnswers = 0;

  try {
    const files = options.attachments ?? [];
    const initial: ModelMessage[] = [
      ...history,
      files.length > 0
        ? {
            role: 'user',
            content: [
              ...(firstMessage ? [{ type: 'text' as const, text: firstMessage }] : []),
              ...files,
            ],
          }
        : { role: 'user', content: firstMessage },
    ];
    /** Conversation sent with the last pass, and that pass. */
    let sent = initial;
    let result = await pass(initial, stopWhen);

    // An empty answer (or the task repeated) is a failure of the model: ask the
    // same model again, then the next one of the chain (D-019).
    while (noAnswer() && emptyAnswers < 2) {
      const left = limits.maxSteps - steps;
      if (left <= 0 || (budget && budget.exhausted(agentId))) break;
      const from = servedModel ? formatModelRef(servedModel) : runAgentStrings().theModel;
      const other = emptyAnswers === 1 && session.demote();
      if (emptyAnswers === 1 && !other) break;
      emptyAnswers++;
      log.append({
        agent: agentId,
        runId,
        parentId,
        type: 'error',
        data: {
          code: 'empty_answer',
          message: runAgentStrings().emptyAnswerRetry(from, echoed, other),
        },
      });
      sent = withInjected(sent, withoutTrailingText(await result.responseMessages), injected);
      result = await pass(sent, [isStepCount(left), ...stopWhen.slice(1)]);
    }

    const hooked =
      streamError === undefined &&
      !aborted &&
      !signal.aborted &&
      lastFinish !== 'tool-calls' &&
      forced === null
        ? await options.onFinalAnswer?.(answer())
        : undefined;
    const reminder = typeof hooked === 'string' ? hooked : hooked?.text;
    /** A reply without tools replaces the first answer (a report rewritten after a check). */
    const textCounts = typeof hooked === 'object' && hooked !== null && hooked.textCounts === true;
    const left = limits.maxSteps - steps;
    if (reminder && answer() && left > 0 && !(budget && budget.exhausted(agentId))) {
      followUp = true;
      log.append({
        agent: agentId,
        runId,
        parentId,
        type: 'message',
        data: { role: 'system', text: reminder },
      });
      held = answer();
      heldParts = parts;
      heldFinal = finalText;
      parts = [];
      const firstFinish = lastFinish;
      const conversation = withInjected(sent, await result.responseMessages, injected);
      try {
        await pass(
          [...conversation, { role: 'user', content: runAgentPrompts().systemReminder(reminder) }],
          [isStepCount(Math.min(FOLLOW_UP_STEPS, left)), ...stopWhen.slice(1)],
        );
      } catch (err) {
        if (signal.aborted) aborted = true;
        else streamError ??= err;
      }
      if (held !== null && textCounts && answer() && !aborted && !signal.aborted) {
        // The new report stands: the first one was only a draft of it.
        held = null;
        heldParts = [];
        heldFinal = '';
      }
      if (held !== null && !aborted && !signal.aborted) {
        // No tool call (or the extra request failed before one): the first answer stands.
        parts = heldParts;
        finalText = heldFinal;
        held = null;
        pending = '';
        lastFinish = firstFinish;
        streamError = undefined;
      } else if (delivered !== null && answer() === '' && !aborted && !signal.aborted) {
        // A tool was called (`ask_user`), then nothing but an "OK": the first
        // answer, already in the chat, is the answer of the turn (D-108).
        parts = delivered.parts;
        finalText = delivered.finalText;
        answerLogged = true;
      }
    }
  } catch (err) {
    if (signal.aborted) aborted = true;
    else streamError ??= err;
  } finally {
    session.setContextRescue(null);
    session.setToolFilter(null);
    if (deferral) options.toolMemory?.set(agentId, deferral.kept());
    if (held !== null) {
      // The extra steps called no tool: their text is dropped, the first answer stands.
      parts = heldParts;
      finalText = heldFinal;
      held = null;
      pending = '';
    }
    flush(true);
  }

  // An answer cut at the model's length limit is not a complete one (F-M4). Said, not
  // continued by itself: another step reads the whole context again and may be cut too;
  // the user decides with «continua», and the note tells the next turn where it stopped.
  if (
    lastFinish === 'length' &&
    !aborted &&
    !signal.aborted &&
    streamError === undefined &&
    answer() !== ''
  ) {
    const note = truncatedNote();
    parts = [...parts, note];
    finalText = finalText ? `${finalText}\n\n${note}` : note;
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: {
        code: 'answer_truncated',
        message: runAgentStrings().answerTruncated(agent.config.name),
      },
    });
  }

  // A turn that did not finish still closes its partial text, so no client
  // shows the agent "writing" forever.
  const closeDraft = (status: 'aborted' | 'failed') => {
    if (!draftOpen) return;
    draftOpen = false;
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'message',
      data: { role: 'agent', text: '', status },
    });
  };

  const base = {
    text: answer(),
    finalText,
    steps,
    usage: { inputTokens: totalIn, outputTokens: totalOut },
    model: servedModel,
    missingTools: missing,
    ...(followUp ? { followUp } : {}),
  };

  if (aborted || signal.aborted) {
    const reason = signal.reason instanceof Error ? signal.reason.message : '';
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: { code: 'aborted', message: abortMessage(agent.config.name, reason) },
    });
    closeDraft('aborted');
    const cause = signal.aborted ? abortCause(signal.reason) : undefined;
    return { ...base, status: 'aborted', ...(cause ? { stopCause: cause } : {}) };
  }

  if (streamError !== undefined) {
    const message = failureMessage(agent.config.name, streamError);
    // A ChatGPT plan error keeps OpenAI's code: clients show it as it arrives (D-035).
    const plan = subscriptionErrorOf(streamError);
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: { code: plan?.code ?? 'agent_failed', message },
    });
    closeDraft('failed');
    return { ...base, status: 'failed', error: message };
  }

  let status: AgentRunStatus = 'completed';
  if (lastFinish === 'tool-calls' || forced !== null) {
    // A report written at the last step without tools is still a stop at a limit.
    status = runLimit
      ? 'run_limit'
      : tokenLimitHit || forced === 'token_limit'
        ? 'token_limit'
        : forced === 'run_limit'
          ? 'run_limit'
          : 'max_steps';
  }
  if (status === 'completed' && answer() === '') {
    // Nothing to deliver: a failure, never a "completed" with an empty answer.
    const message = runAgentStrings().emptyFailed(agent.config.name, echoed, emptyAnswers > 0);
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: { code: 'empty_answer', message },
    });
    closeDraft('failed');
    return { ...base, status: 'failed', error: message };
  }
  if (status !== 'completed') {
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: {
        code: status,
        message:
          (status === 'max_steps'
            ? steps >= limits.maxSteps
              ? runAgentStrings().maxSteps(agent.config.name, limits.maxSteps)
              : runAgentStrings().extraSteps(agent.config.name)
            : status === 'run_limit'
              ? runAgentStrings().stops(
                  agent.config.name,
                  runLimit ?? budget?.exhausted(agentId) ?? runAgentStrings().taskLimit,
                )
              : runAgentStrings().tokenLimit(agent.config.name, maxTokens ?? 0)) +
          (forced !== null && answer() ? runAgentStrings().reportAtLastStep : ''),
      },
    });
  }
  if (!answerLogged) {
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'message',
      data: { role: 'agent', text: answer() },
    });
  }
  return { ...base, status };
}

/** Arguments of a call in one short line, for the watcher. */
export function shortArgs(input: unknown, max = 120): string {
  let text: string;
  try {
    text = typeof input === 'string' ? input : (JSON.stringify(input) ?? '');
  } catch {
    text = String(input);
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** A call and its outcome in one line: errors by code, lists by length, the rest by size. */
export function stepCall(tool: string, input: unknown, output: unknown): StepCall {
  const args = shortArgs(input);
  const p = runAgentPrompts();
  if (output && typeof output === 'object' && 'error' in output) {
    const code = (output as { error?: { code?: unknown } }).error?.code;
    return {
      tool,
      args,
      outcome: `${p.outcomeError} ${typeof code === 'string' ? code : ''}`.trim(),
    };
  }
  if (typeof output === 'string') return { tool, args, outcome: p.outcomeChars(output.length) };
  if (Array.isArray(output)) return { tool, args, outcome: p.outcomeItems(output.length) };
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>;
    if (Array.isArray(o['results']))
      return { tool, args, outcome: p.outcomeResults(o['results'].length) };
    if (typeof o['path'] === 'string') return { tool, args, outcome: `ok ${o['path']}` };
  }
  return { tool, args, outcome: 'ok' };
}

/** The response without its last assistant message when that one is only text (to ask again). */
function withoutTrailingText(messages: ModelMessage[]): ModelMessage[] {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return messages;
  const onlyText =
    typeof last.content === 'string' || last.content.every((p) => p.type !== 'tool-call');
  return onlyText ? messages.slice(0, -1) : messages;
}

/** Why the turn failed, in words the user can act on. */
function failureMessage(name: string, err: unknown): string {
  if (err instanceof AllModelsFailedError && classifyProviderError(err.cause) === 'empty') {
    return runAgentStrings().emptyFailedChain(name);
  }
  // OpenAI out of reach for the ChatGPT sign-in: why, and that the sign-in stays.
  const unreachable = chatgptUnreachableText(err, 'in_use');
  if (unreachable) return unreachable;
  return errorMessage(err);
}
