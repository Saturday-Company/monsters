import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  HarnessCommandApproval,
  HarnessConnector,
  HarnessEvent,
  HarnessProvider,
  HarnessUsageEvent,
} from '@monsters/providers';
import {
  claudeBuiltinTools,
  claudeDontAskDenial,
  claudeRuleDenial,
  HARNESS_CONFIG_FILES,
} from '@monsters/providers';
import {
  settingsPath,
  ToolError,
  type Effort,
  type LimitReason,
  type MonstersTool,
  type PlanLimitsReading,
} from '@monsters/shared';
import { forbiddenEntries, type DataDirLock } from '@monsters/tools';
import type { ModelMessage } from 'ai';
import { KilledError, type ControlScope } from '../kill/control-scope.ts';
import type { EventLog } from '../log/event-log.ts';
import {
  agentTokenLimit,
  agentTokenLimitReason,
  limitTokens,
  type RunBudget,
} from '../team/run-limits.ts';
import {
  HARNESS_BASE_TOKENS,
  HarnessContextMeter,
  harnessParts,
  mcpToolTokens,
} from './context-usage.ts';
import type { AgentDefinition } from './definition.ts';
import {
  answerHarnessHook,
  checkHarnessCommand,
  monstersRuleRefusal,
  type HarnessHookContext,
  unavailableBuiltin,
  type RunWeb,
} from './harness-hooks.ts';
import {
  ALWAYS_LOADED_TOOLS,
  toolsCallDescriptor,
  type HarnessToolSessions,
} from './harness-tools.ts';
import type { CardContext } from './monsters-card.ts';
import {
  abortCause,
  abortMessage,
  buildSystemPrompt,
  instructionsForTools,
  isAcknowledgement,
  mayBeAcknowledgement,
  RECENT_TOOL_DAYS,
  resolveAgentTools,
  stepsLeftNote,
  taskMessage,
  type AgentRunResult,
  type FinalAnswerHook,
  type TaskBrief,
  summaryText,
  turnWords,
} from './run-agent.ts';
import { runAgentPrompts } from './run-agent.prompts.ts';
import { runAgentStrings } from './run-agent.strings.ts';
import { listWords, runHarnessPrompts } from './run-harness.prompts.ts';
import type { ToolGuard } from './tool-adapter.ts';
import { codexToolPlan, recentToolUse, toolSearchConfigFor } from './tool-search.ts';
import type { HarnessAttachments } from '../files/model-input.ts';

/*
 * One agent working on one task through a harness (Claude Agent, Codex): the
 * loop belongs to the official agent, Monsters prepares its folder, gives it
 * its tools over MCP and turns its events into the event log (ARCHITECTURE
 * §5.3, D-007, D-035):
 * - the workspace gets AGENTS.md, and loses any harness configuration written
 *   in it (D-079); Claude Code gets AGENTS.md in its appended system prompt;
 * - the agent's Monsters tools are an MCP session of this run (its permissions,
 *   its log entries, revoked at the end);
 * - text, tool calls of the harness's own tools, usage → `message`,
 *   `tool_call`/`tool_result`, `provider_usage` (calls to Monsters' tools are
 *   logged by the MCP endpoint itself);
 * - the process starts through the scope (`scope.spawn`): the kill switch, a
 *   `killRun` or the run budget stop it with its whole process group;
 * - at a limit (the run budget, the agent's tokens, the agent's steps) the
 *   harness first gets a wrap-up (D-170, D-196): its tools are refused with
 *   words that ask for the report, which ends the run at the limit with that
 *   text; stopped past a bound. A few steps before the agent's step cap the
 *   model is told to save its work (D-196).
 */

export const HARNESS_MCP_SERVER = 'monsters';

/**
 * A harness that sends no event for this long is hung (F-M3): the run is stopped. The clock
 * does not run while a hook or one of Monsters' tools works (they can wait for the user).
 * Longer than Claude Code's longest `Bash` (10 min) and than Codex's own watchdog (15 min,
 * codex.ts), which stops a silent turn first with a more precise error.
 */
export const HARNESS_IDLE_MS = 20 * 60_000;
/**
 * While an action of the harness itself is open (a `Bash`, a sub-agent, a Codex command or
 * file change) the harness may be silent this long: a build or a test suite takes minutes,
 * and its output does not always come back as events.
 */
export const HARNESS_ACTION_IDLE_MS = 60 * 60_000;

/** How long a harness may go on after a request that reached a limit, to finish its answer. */
const LIMIT_GRACE_MS = 1500;
/**
 * The wrap-up after a limit (D-170): every tool is refused with words that ask for the report,
 * and the harness has this long, and this many more model requests, to write it. Then it is
 * stopped as without a wrap-up. A refused call and the report take two requests.
 */
export const WRAP_UP_MS = 90_000;
export const WRAP_UP_REQUESTS = 3;
/** Events that end an answer rather than start more work (no stop for a limit on them). */
const LIMIT_TAIL_EVENTS = new Set<HarnessEvent['type']>([
  'usage',
  'text',
  'session',
  'plan-limits',
  'heartbeat',
  'done',
]);

/**
 * Statuses of the `monsters` server that leave the run without Monsters' tools (D-160).
 * `pending` too, but only when the model starts while it lasts (Claude Code 2.1.308 past
 * `CLAUDE_CODE_MCP_STARTUP_WAIT_MS`; Codex sends `pending`, then `connected`).
 */
// `missing`: Claude Code's init did not list the server at all (a setting kept it out).
const TOOLS_FAILED: ReadonlySet<string> = new Set(['failed', 'needs-auth', 'disabled', 'missing']);
/** Events of the model's work: Monsters' server still `pending` at one of them is not there. */
const ACTING_EVENTS = new Set<HarnessEvent['type']>(['text-delta', 'text', 'tool-call', 'usage']);
/** How long the core's own check of its tools endpoint may take. */
const TOOLS_PROBE_MS = 3000;

/** The program a harness runs, as the user knows it. */
function harnessProgram(id: string): string {
  return id === 'codex' ? 'Codex' : 'Claude Code';
}

/**
 * Why a harness could not reach Monsters' tools (D-160), in plain words: the core calls its
 * own endpoint with the run's token, as the harness would. No answer, a refused token or a
 * slow answer are the core's side; an answer that works means the harness's side.
 */
export async function monstersToolsCause(
  status: string,
  url: string,
  token: string,
  timeoutMs = TOOLS_PROBE_MS,
): Promise<string> {
  const c = runAgentStrings().mcpCause;
  let where = url;
  try {
    where = new URL(url).host;
  } catch {
    // The URL as it is.
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'monsters-self-check', version: '1' },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel().catch(() => {});
    if (res.status === 401) return c.token;
    if (!res.ok) return c.refused(res.status);
  } catch (err) {
    return (err as Error).name === 'TimeoutError' ? c.slow : c.unreachable(where);
  }
  if (status === 'pending') return c.pending;
  if (status === 'needs-auth') return c.needsAuth;
  return c.harnessSide;
}

/** A failed result written by the core's endpoint (`{"error":{"code":…}}`), not by the harness. */
function fromCore(output: unknown): boolean {
  if (typeof output !== 'string') return false;
  try {
    const v = JSON.parse(output) as { error?: { code?: unknown } } | null;
    return typeof v?.error?.code === 'string';
  } catch {
    return false;
  }
}

export interface RunHarnessOptions {
  agent: AgentDefinition;
  harness: HarnessProvider;
  /** Model on the harness (first link of the agent's chain). */
  model?: string;
  /**
   * Model of the same plan for the same request when `model` reaches the
   * plan's limit before saying anything (`usage_limit`, D-093: Opus → Sonnet).
   */
  fallbackModel?: string;
  /** Effort of the run (D-110), only in "Automatica": the harness's `--effort`. */
  effort?: Effort;
  /** Effort for `fallbackModel` (Opus → Sonnet changes it too). */
  fallbackEffort?: Effort;
  task: string | TaskBrief;
  /** A line for this turn only, after the task (the note of changed accesses, D-141). */
  hint?: string;
  tools: MonstersTool[];
  /** Tools of the external MCP servers assigned to the agent (D-033), served over our MCP. */
  extraTools?: MonstersTool[];
  /** MCP services assigned to the agent but not connected now (connettori 6). */
  unlinked?: readonly string[];
  signal: AbortSignal;
  scope: ControlScope;
  log: EventLog;
  runId: string;
  sessions: HarnessToolSessions;
  /** URL of the core's MCP endpoint (known once the server listens). */
  mcpUrl: () => string;
  /** Working folder of the agent. */
  workspace: string;
  /** Summary of the turns older than `history` (D-082): first in the conversation of the turn's message. */
  summary?: string;
  /** Session of the harness to continue (its earlier turns are in the context, D-079, D-199). */
  resume?: string;
  /**
   * What the run gets instead of `resume` when the harness no longer has that session (D-199):
   * the conversation, its summary and the notes of the job, as a turn without a session gets.
   */
  resumeFallback?: { history?: ModelMessage[]; summary?: string; notes?: string };
  /** Where the private files of each run go (0700, removed at the end). */
  scratchRoot: string;
  /** The agent has the `shell` permission: the harness may use its own terminal and files. */
  systemTools: boolean;
  /**
   * The data folder of Monsters (D-078): the harness's terminal and file tools
   * stay out of it, except the agent's working folder (hook of the core, deny
   * rules of the run).
   */
  dataDir?: string;
  /**
   * Folders closed to the harness's terminal and files in this run, with the
   * words for the model (the vault's `Privato/` in a Telegram chat, D-107;
   * Claude Code's transcripts, M6).
   */
  closedFolders?: readonly { path: string; message: string }[];
  /**
   * Claude Code's `projects` folder (one of `closedFolders` for the runs with the terminal): the
   * run reads what the harness saved for its own session in it (`tool-results/`), nothing else
   * and never a write (D-198). Without the terminal it gives a run with services reached through
   * Claude a `Read` for those files.
   */
  sessionOutputs?: string;
  memory?: string;
  profile?: string;
  /** The "## Progetto" section of a project's monster (D-097). */
  project?: string;
  /**
   * The project's folder (D-097): the harness works there instead of in
   * `workspace`. Nothing of it is removed or written (it is the user's): the
   * harness reads no instructions file of it (their text is in `project`)
   * and may not write its configuration files.
   */
  cwd?: string;
  /** The projects' folders, whose instructions the harness never writes (D-103). */
  instructionFolders?: () => string[];
  parentId?: string | null;
  history?: ModelMessage[];
  budget?: RunBudget;
  partialFlushMs?: number;
  /**
   * The instinct around the calls (D-067): on Monsters' tools inside the core,
   * on the harness's own tools through its hooks (D-069, Claude Code).
   */
  guard?: ToolGuard;
  /** Stop hook of the agent (D-069): "finito davvero?", the question left in the text. */
  onFinalAnswer?: (text: string) => FinalAnswerHook | Promise<FinalAnswerHook>;
  /** The agent has the web: the harness's own web search replaces Monsters' `web_search` (D-069). */
  webSearch?: boolean;
  /**
   * The monsters of the agent's squad that have the web, when it has none
   * (D-127): its instructions and a refused built-in say who to ask.
   */
  webElsewhere?: readonly string[];
  /** Causes the card says (D-132): why no web, the project, MCP tools past the cap. */
  card?: CardContext;
  /** Services the harness reaches with its own sign-in (Claude: claude.ai connectors, Claude Design). */
  connectors?: HarnessConnector[];
  /** Address of the core's hook endpoint (`/api/harness/hook` on loopback). */
  hookUrl?: () => string;
  /** The MCP servers as the harness found them at the start (connectors connected or not). */
  onMcpStatus?: (servers: { name: string; status: string }[]) => void;
  /** The plan's limits as the harness reported them (D-111). */
  onPlanLimits?: (reading: PlanLimitsReading) => void;
  /** The context window of a model, when known (C.1: the `context` of every step). */
  contextWindow?: (ref: { provider: string; model: string }) => number | undefined;
  /** The files the user attached to the message (files/model-input.ts). */
  attachments?: HarnessAttachments;
  /** Silence after which the harness counts as hung and is stopped (default `HARNESS_IDLE_MS`). */
  idleTimeoutMs?: number;
  /** The same while an action of the harness is open (default `HARNESS_ACTION_IDLE_MS`). */
  actionIdleTimeoutMs?: number;
  /** The project the run works for, on every `provider_usage` (F-B13). */
  projectId?: string | null;
  /** How long the wrap-up after a limit may last (default `WRAP_UP_MS`, D-170). */
  wrapUpMs?: number;
}

/** Harnesses with a web search of their own (D-069). */
const OWN_WEB_SEARCH: ReadonlySet<string> = new Set(['claude-agent', 'codex']);
/** Harnesses that call the core's hooks before their own tools and before stopping (D-069). */
const HOOKED: ReadonlySet<string> = new Set(['claude-agent']);

/**
 * The "## Strumenti di Monsters" section of a harness run: where Monsters'
 * tools are and, exactly, the web of this run (D-127): which tools, or that
 * it has none and who has it. Never "the web is denied in this session".
 */
export function monstersToolsSection(
  harnessId: string,
  web: RunWeb,
  run: {
    terminal?: boolean;
    docsPropose?: boolean;
    team?: boolean;
    ask?: boolean;
    /** The harness saves what it cannot show in full and the run may read it (D-198). */
    saved?: boolean;
  } = {},
): string {
  const server = `\`${HARNESS_MCP_SERVER}\``;
  const p = runHarnessPrompts();
  const claude = harnessId === 'claude-agent';
  const hasWeb = web.own || web.search || web.fetch;
  // Only what the run has (A5 of the review of 19/10): "la squadra" only with `delegate`.
  const parts = [p.vaultPart, ...(hasWeb ? [p.webPart] : []), ...(run.team ? [p.squadPart] : [])];
  const lines = [p.here(parts, server, p.and)];
  if (web.own) {
    lines.push(p.webOwn(claude, server));
  } else if (hasWeb) {
    const own = [...(web.search ? [p.webSearchPart] : []), ...(web.fetch ? [p.webFetchPart] : [])];
    lines.push(p.webOnly(own.join(` ${p.and} `), server, claude));
  } else {
    const who = web.elsewhere ?? [];
    lines.push(p.webNone(listWords(who), who.length, run.team === true));
  }
  if (harnessId === 'codex') {
    // Codex shows `request_user_input`; its questions never reach the user (M4, D-135).
    lines.push(p.codexAsk(run.ask === true, server));
    // Its commands reach the network by asking Monsters (D-158).
    if (run.terminal) lines.push(p.codexNetwork);
  }
  if (claude) {
    lines.push(p.claudeBuiltins);
    // The deny rules answer before any hook (D-127): only these words can say whose rule it is.
    if (run.terminal) lines.push(p.claudeRule(run.docsPropose === true));
    if (run.saved) lines.push(p.claudeSaved(run.terminal === true));
  }
  return `${p.head}\n${lines.join('\n')}`;
}

/**
 * The built-in a refused call of the harness names when it is not the run's
 * (D-127), or null: `dontAsk`'s own refusal, or a tool outside `--tools`
 * that the core's hook refused. A refusal of the core's checks (the data
 * folder, the brake) names a tool of the run: not this.
 */
export function refusedBuiltin(
  name: string,
  output: unknown,
  builtins: readonly string[] | undefined,
): { tool: string; refusal: 'not_in_run' | 'monsters_rule' } | null {
  if (!builtins || name.startsWith('mcp__')) return null;
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
  const denied = claudeDontAskDenial(text);
  if (denied) return { tool: denied, refusal: 'not_in_run' };
  // A deny rule of the run (the binary checks it before the hooks): Monsters', not the user's.
  if (claudeRuleDenial(text)) return { tool: name, refusal: 'monsters_rule' };
  return name !== 'tool' && !builtins.includes(name) ? { tool: name, refusal: 'not_in_run' } : null;
}

/** Characters of the conversation in a harness's appended prompt. */
export const HARNESS_HISTORY_CHARS = 6000;

/**
 * Earlier turns as text: the harness gets the conversation in the message of
 * the turn (D-169), before the new request: the summary of the older turns
 * first (D-082, whole and as data), then the newest turns within `max` characters.
 */
export function historyText(
  history: ModelMessage[] | undefined,
  max = HARNESS_HISTORY_CHARS,
  summary?: string,
): string {
  // The summary whole (it is already within SUMMARY_MAX_CHARS, D-082), as data; the turns in `max`.
  const head = summary?.trim() ? summaryText(summary) : '';
  const tail = turnsText(history, max);
  return [head, tail].filter(Boolean).join('\n\n');
}

function turnsText(history: ModelMessage[] | undefined, max: number): string {
  if (!history?.length || max <= 0) return '';
  const labels = runHarnessPrompts();
  const lines = history.map((m) => {
    const content =
      typeof m.content === 'string'
        ? m.content
        : m.content.map((p) => ('text' in p && typeof p.text === 'string' ? p.text : '')).join(' ');
    return `${m.role === 'user' ? labels.userLabel : labels.youLabel}: ${content}`;
  });
  const text = lines.join('\n');
  return text.length > max ? `…${text.slice(-max)}` : text;
}

function preview(value: unknown, max = 4000): unknown {
  let json: string;
  try {
    json = JSON.stringify(value) ?? 'null';
  } catch {
    return String(value);
  }
  return json.length <= max ? value : { truncated: true, preview: `${json.slice(0, max)}…` };
}

/** Providers that are harnesses (D-035): a chain starting with one never falls back. */
export const HARNESS_PROVIDER_IDS: ReadonlySet<string> = new Set(['claude-agent', 'codex']);

/**
 * URL of the core's MCP endpoint for the harness processes, which run on this
 * computer: an address the core really listens on (D-160). A wildcard
 * (`0.0.0.0`, `::`) is reached on 127.0.0.1; a specific address is used as it
 * is: a core listening only on `192.168.1.20` (or `127.0.0.2`) refuses
 * connections on 127.0.0.1, and Claude Code then started with the `monsters`
 * server `failed` and no tools. `localhost` stays a name: Node may have bound
 * it to `::1` only, the harness tries every address of the name. Traffic to an
 * address of this computer never leaves it.
 */
export function harnessMcpUrl(host: string, port: number): string {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  const wildcard = h === '' || h === '0.0.0.0' || /^[0:]+$/.test(h);
  const where = wildcard ? '127.0.0.1' : h.includes(':') ? `[${h}]` : h;
  return `http://${where}:${port}/api/harness/mcp`;
}

/** URL of the core's hook endpoint for the harness processes (D-069): loopback, like the MCP one. */
export function harnessHookUrl(host: string, port: number): string {
  return harnessMcpUrl(host, port).replace(/\/mcp$/, '/hook');
}

/**
 * The agent's chain starts with a harness that is not available (turned off,
 * not installed, signed out): a clear error, never the next link (D-035).
 */
export function harnessUnavailable(options: {
  agent: AgentDefinition;
  log: EventLog;
  runId: string;
  parentId?: string | null;
}): AgentRunResult {
  const { agent, log } = options;
  const provider = agent.config.models[0]?.provider ?? '';
  const name = provider === 'codex' ? 'Codex' : 'Claude Agent';
  const message = runAgentStrings().harnessUnavailable(
    agent.config.name,
    name,
    settingsPath('abbonamenti'),
  );
  log.append({
    agent: agent.config.id,
    runId: options.runId,
    parentId: options.parentId ?? null,
    type: 'error',
    data: { code: 'harness_unavailable', message },
  });
  return {
    status: 'failed',
    text: '',
    finalText: '',
    steps: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    model: null,
    missingTools: [],
    error: message,
  };
}

/**
 * The agent's working folder before a run (D-007, D-079): the configuration
 * a harness would read from it (`.claude/`, `.mcp.json`, CLAUDE.md, `.codex/`…)
 * is removed, whatever an earlier run wrote there, and AGENTS.md is written
 * again (Codex reads it; Claude Code gets it in the appended system prompt and
 * reads no file of the folder as settings or memory).
 */
export function prepareHarnessFolder(workspace: string, agent: AgentDefinition): void {
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  for (const name of HARNESS_CONFIG_FILES) {
    rmSync(join(workspace, name), { recursive: true, force: true });
  }
  writeFileSync(join(workspace, 'AGENTS.md'), agent.instructions.trim() + '\n');
}

/** The harness's base as the latest step of this agent measured it, or the default. */
function knownBase(log: EventLog, agentId: string, harnessId: string): number {
  for (const e of log.query({ agent: agentId, type: 'provider_usage', order: 'desc', limit: 50 })) {
    if (e.type !== 'provider_usage' || e.data.provider !== harnessId) continue;
    const base = e.data.context?.parts.base;
    if (base !== undefined && base > 0) return base;
  }
  return HARNESS_BASE_TOKENS[harnessId] ?? 0;
}

/**
 * Runs an agent on its harness. With `fallbackModel`, a request that reaches
 * the plan's limit before any answer runs again on that model, in the same
 * harness (D-093): a `provider_fallback` line instead of the error.
 */
export async function runHarnessAgent(options: RunHarnessOptions): Promise<AgentRunResult> {
  const { fallbackModel: next, fallbackEffort, ...rest } = options;
  const { effort: _first, ...restNoEffort } = rest;
  const first = await runWithTools(rest, next !== undefined && next !== options.model);
  if (!first.planLimited || !next) return withoutFlag(first);
  const { agent, harness, log, runId } = options;
  const from = `${harness.id}:${options.model ?? first.model?.model ?? runAgentStrings().modelWord}`;
  const to = `${harness.id}:${next}`;
  log.append({
    agent: agent.config.id,
    runId,
    parentId: options.parentId ?? null,
    type: 'error',
    data: {
      code: 'provider_fallback',
      message: runAgentStrings().planLimitFallback(from, to, first.error),
      fallback: { from, to, reason: 'usage_limit' },
    },
  });
  const second = withoutFlag(
    await runWithTools(
      { ...restNoEffort, model: next, ...(fallbackEffort ? { effort: fallbackEffort } : {}) },
      false,
    ),
  );
  return {
    ...second,
    steps: first.steps + second.steps,
    usage: {
      inputTokens: first.usage.inputTokens + second.usage.inputTokens,
      outputTokens: first.usage.outputTokens + second.usage.outputTokens,
    },
  };
}

/**
 * The events of a harness, ending as soon as `stalled` settles even if the harness never
 * returns (a stopped process normally ends its stream, this does not depend on it).
 */
async function* untilStalled<T>(
  source: AsyncIterable<T>,
  stalled: Promise<'stalled'>,
): AsyncGenerator<T> {
  const it = source[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await Promise.race([it.next(), stalled]);
      if (next === 'stalled' || next.done) return;
      yield next.value;
    }
  } finally {
    // Not awaited: a generator parked on a hung read only returns when that read settles.
    void Promise.resolve(it.return?.(undefined)).catch(() => {});
  }
}

type OnceResult = AgentRunResult & {
  planLimited?: boolean;
  /** Monsters' tools were not there at the start and nothing was done yet: start again. */
  toolsRetry?: boolean;
  /** The session to resume is gone and nothing was asked: start again without it (D-199). */
  resumeLost?: boolean;
};

function withoutFlag(r: OnceResult): AgentRunResult {
  const { planLimited: _flag, toolsRetry: _retry, resumeLost: _lost, ...result } = r;
  return result;
}

/** The run without its session: the conversation and the notes of the job instead (D-199). */
function withoutResume<T extends Omit<RunHarnessOptions, 'fallbackModel'>>(options: T): T {
  const { resume: _resume, resumeFallback, ...rest } = options;
  const hint = [resumeFallback?.notes, options.hint].filter(Boolean).join('\n\n');
  return {
    ...rest,
    ...(resumeFallback?.history?.length ? { history: resumeFallback.history } : {}),
    ...(resumeFallback?.summary ? { summary: resumeFallback.summary } : {}),
    ...(hint ? { hint } : {}),
  } as T;
}

/**
 * One run, started once more in a fresh harness process (a new session and token) when the
 * harness could not reach Monsters' tools at its start and had done nothing yet (D-160).
 */
async function runWithTools(
  options: Omit<RunHarnessOptions, 'fallbackModel'>,
  quietPlanLimit: boolean,
): Promise<OnceResult> {
  let first = await runHarnessOnce(options, quietPlanLimit, true);
  // The session to continue is gone (cleaned up by the harness): the same turn without it.
  if (first.resumeLost) {
    options = withoutResume(options);
    first = await runHarnessOnce(options, quietPlanLimit, true);
  }
  if (!first.toolsRetry) return first;
  return runHarnessOnce(options, quietPlanLimit, false);
}

async function runHarnessOnce(
  options: Omit<RunHarnessOptions, 'fallbackModel'>,
  /** The caller tries another model at the plan's limit: no error event for it. */
  quietPlanLimit: boolean,
  /** Monsters' tools missing at the start: start again once instead of stopping (D-160). */
  mayRetryTools = false,
): Promise<OnceResult> {
  const { agent, harness, log, runId } = options;
  const agentId = agent.config.id;
  const parentId = options.parentId ?? null;
  const task: TaskBrief = typeof options.task === 'string' ? { goal: options.task } : options.task;
  const resolved = resolveAgentTools(agent, options.tools);
  const missing = resolved.missing;
  // The plan's own web search (D-069) comes first. Monsters' `web_search` stays as a reserve
  // for when it fails (C-18): it spends no plan quota, and the instructions below say when to
  // use it, so the two do not compete. Removing it left the monster blind for the whole run
  // whenever the plan's search was unavailable (limit, region, a Codex that never had it).
  const ownSearch =
    options.webSearch === true &&
    OWN_WEB_SEARCH.has(harness.id) &&
    resolved.tools.some((t) => t.name === 'web_search');
  // External MCP tools assigned to the agent (D-033) reach the harness through our endpoint too.
  const names = new Set(resolved.tools.map((t) => t.name));
  const tools = [
    ...resolved.tools,
    ...(options.extraTools ?? []).filter((t) => !names.has(t.name) && names.add(t.name)),
  ];
  /*
   * Many MCP tools on Codex (D-163): its tool list cannot change in a session, so the server lists
   * the base tools, `tools_search` (it loads nothing) and `tools_call`; the session still holds
   * every tool, so a call by `tools_call` passes the same brake, permissions and log.
   */
  const codexPlan =
    harness.id === 'codex'
      ? codexToolPlan(
          tools,
          toolSearchConfigFor(agent.config.models),
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
          turnWords(task, options.history ?? []),
        )
      : null;
  const sessionTools = codexPlan ? [...tools, codexPlan.search] : tools;
  const connectors = harness.id === 'claude-agent' ? (options.connectors ?? []) : [];
  const hooked = HOOKED.has(harness.id) && options.hookUrl !== undefined;
  /*
   * The agent's own step cap (D-196) is counted here, not left to the harness's max-turns
   * alone: a harness that can be told (Claude Code's hooks, Codex's notes) hears when few steps
   * are left and gets the wrap-up at the cap; its max-turns stays as the backstop, past the
   * wrap-up's requests. Otherwise max-turns is the cap, as before.
   */
  const maxSteps = agent.config.limits.maxSteps;
  const stepsWrapUp = hooked || harness.id === 'codex';
  // Where the harness works: the project's folder (D-097), or the agent's own folder.
  const cwd = options.cwd ?? options.workspace;
  const lock: DataDirLock | undefined =
    options.dataDir && options.systemTools
      ? // The files the user attached stay readable even with a notes folder inside the data
        // folder (a custom MONSTERS_HOME): they are the user's data, never Monsters' own.
        {
          dataDir: options.dataDir,
          allowed: [options.workspace, ...(options.attachments?.read ?? [])],
        }
      : undefined;
  const budget = options.budget;

  const base = (
    status: AgentRunResult['status'],
    text = '',
    extra: Partial<AgentRunResult> = {},
  ): AgentRunResult => ({
    status,
    text,
    // The harness reports its last message: that is the report.
    finalText: text,
    steps,
    usage: { inputTokens: totalIn, outputTokens: totalOut },
    model: servedModel,
    missingTools: missing,
    ...(sessionId ? { harnessSession: { harness: harness.id, id: sessionId, cwd } } : {}),
    ...extra,
  });
  /** The harness's session of this run (D-199): a continuation resumes it. */
  let sessionId: string | undefined;
  let steps = 0;
  let totalIn = 0;
  let totalOut = 0;
  /** What the token limits count (`limitTokens`): cache reads left out. */
  let counted = 0;
  let servedModel: AgentRunResult['model'] = null;

  const runStop = budget?.exhaustedBy() ?? null;
  if (runStop) {
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: {
        code: 'run_limit',
        message: runAgentStrings().noStart(agent.config.name, runStop.message),
        limit: runStop.limit,
      },
    });
    return base('run_limit', '', { error: runStop.message, limit: runStop.limit });
  }

  // Codex reads AGENTS.md from the folder: the same text the prompt gets for these tools (D-134).
  prepareHarnessFolder(options.workspace, {
    ...agent,
    instructions: instructionsForTools(
      agent.instructions,
      tools.map((t) => t.name),
    ),
  });
  // Claude Code reads no file of the folder (D-079): AGENTS.md goes in the appended prompt.
  // In a project's folder Codex reads none either (D-097): the agent's AGENTS.md goes there too.
  const agentsMdInPrompt = harness.id === 'claude-agent' || options.cwd !== undefined;
  // The brief goes with the task, not in the instructions (D-064).
  const files = options.attachments;
  // What the harness saves for the session (a result too large for the context, an image of a
  // service) and tells the model to read (D-198): with the terminal, or with services reached
  // through Claude, whose results are the large ones.
  const savedOutputs =
    harness.id === 'claude-agent' &&
    options.sessionOutputs !== undefined &&
    (options.systemTools || connectors.length > 0)
      ? options.sessionOutputs
      : undefined;
  // The web of this run, said exactly (D-127): what it has, or who has it.
  const web: RunWeb = {
    search: tools.some((t) => t.name === 'web_search'),
    fetch: tools.some((t) => t.name === 'web_fetch'),
    own: ownSearch,
    ...(options.webElsewhere?.length ? { elsewhere: options.webElsewhere } : {}),
    ...(!options.systemTools && (files?.read.length || savedOutputs)
      ? { attachmentsOnly: true }
      : {}),
    ...(!options.systemTools && savedOutputs ? { savedOutputs: true } : {}),
  };
  // Claude Code's built-ins of this run (`--tools`, D-127): any other is not the run's.
  const builtins =
    harness.id === 'claude-agent'
      ? claudeBuiltinTools({
          systemTools: options.systemTools,
          ...(ownSearch ? { webSearch: true } : {}),
          ...(files?.read.length ? { readFiles: files.read } : {}),
          ...(savedOutputs ? { sessionOutputs: savedOutputs } : {}),
        })
      : undefined;
  const request = [taskMessage(task), options.hint ?? '', files?.text ?? '']
    .filter(Boolean)
    .join('\n\n');
  const history =
    options.history?.length || options.summary
      ? historyText(options.history, HARNESS_HISTORY_CHARS, options.summary)
      : '';
  // The conversation goes with the task, before the new request, not in the appended system prompt
  // (D-169): that text is identical turn after turn, so the harness's prompt cache keeps it. The
  // summary stays inside its data tag and the turns keep their labels, as they were.
  const prompt = history
    ? `${runHarnessPrompts().recent}\n${history}\n\n${runHarnessPrompts().currentRequest}\n${request}`
    : request;
  const instructions = [
    buildSystemPrompt({
      agent: agentsMdInPrompt ? agent : { ...agent, instructions: '' },
      memory: options.memory,
      profile: options.profile,
      project: options.project,
      toolNames: tools.map((t) => t.name),
      externalData: tools.some((t) => t.externalSource !== undefined),
      // The card names every MCP tool and says to call them with `tools_call` (D-163).
      ...(codexPlan ? { search: { mcp: true, own: [] } } : {}),
      harness: {
        id: harness.id,
        ownWebSearch: ownSearch,
        terminal: options.systemTools,
        connectors: connectors.map((c) => c.name),
      },
      unlinked: options.unlinked,
      ...(options.webElsewhere ? { webElsewhere: options.webElsewhere } : {}),
      ...(options.card ? { card: options.card } : {}),
    }).trim(),
    monstersToolsSection(harness.id, web, {
      terminal: options.systemTools,
      docsPropose: tools.some((t) => t.name === 'project_docs_propose'),
      team: tools.some((t) => t.name === 'delegate'),
      ask: tools.some((t) => t.name === 'ask_user'),
      saved: savedOutputs !== undefined,
    }),
  ].join('\n\n');
  // The context of each request (C.1): the total is the harness's, ours is estimated.
  const contextMeter = new HarnessContextMeter(
    harnessParts({
      // Inside `instructions` when it is in the appended prompt.
      agentsMd: agentsMdInPrompt ? '' : agent.instructions,
      instructions,
      memory: options.memory,
      profile: options.profile,
      history,
      summary: options.summary,
      tools: mcpToolTokens(
        codexPlan
          ? [
              ...sessionTools.filter((t) => codexPlan.exposed.includes(t.name)),
              toolsCallDescriptor(),
            ]
          : tools,
        HARNESS_MCP_SERVER,
        // Claude Code sends only the names of the tools it defers (D-169).
        harness.id === 'claude-agent' ? ALWAYS_LOADED_TOOLS : undefined,
      ),
      prompt: request,
    }),
    options.resume ? { resumed: { base: knownBase(log, agentId, harness.id) } } : {},
  );

  // A scope of its own: the run budget can stop this harness without stopping the run.
  const scope = options.scope.agent(`${agentId}-harness`);
  const onParentAbort = () => void scope.abort(options.signal.reason);
  options.signal.addEventListener('abort', onParentAbort, { once: true });
  const scratchDir = join(
    options.scratchRoot,
    `${runId}-${agentId}-${randomBytes(4).toString('hex')}`,
  );
  const toolNames = new Map<string, string>();
  /** Refused calls already told in plain words (D-127): `permission_denials` adds only the others. */
  const explained = new Set<string>();
  /** Calls the core's own hook refused and recorded as `internal_denied` (D-166). */
  const hookRefused = new Set<string>();
  /** `tool_call` events of the harness's own tools, by call id: logged once (stream or hook). */
  const callEvents = new Map<string, string>();
  /** The harness's own calls logged without their result yet. */
  const unanswered = new Set<string>();
  /** Calls closed by `closeUnanswered`: a result the harness sends later is not logged again. */
  const closedEarly = new Set<string>();
  const callEvent = (id: string, name: string, input: unknown): string => {
    const known = id ? callEvents.get(id) : undefined;
    if (known) return known;
    toolNames.set(id, name);
    const event = log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'tool_call',
      data: { callId: id, tool: `${harness.id}.${name}`, input: preview(input) },
    });
    if (id) {
      callEvents.set(id, event.id);
      unanswered.add(id);
    }
    return event.id;
  };
  /**
   * Every call of the harness's own logged gets its result: at a stop inside the abort, so it
   * comes before the end of the run (the kill switch logs it right after aborting); at the end
   * of a harness that left calls open, with what happened. Monsters' tools have theirs from the
   * endpoint's adapter.
   */
  const closeUnanswered = (aborted: boolean) => {
    for (const id of unanswered) {
      closedEarly.add(id);
      try {
        log.append({
          agent: agentId,
          runId,
          parentId,
          type: 'tool_result',
          data: {
            callId: id,
            tool: `${harness.id}.${toolNames.get(id) ?? 'tool'}`,
            ok: false,
            error: aborted ? 'aborted' : runAgentStrings().harnessCallUnanswered,
            ...(aborted ? {} : { cause: 'error' as const }),
          },
        });
      } catch {
        // A log that cannot write (a closing core) never breaks the abort of the others.
      }
    }
    unanswered.clear();
  };
  const onStop = () => closeUnanswered(true);
  scope.signal.addEventListener('abort', onStop, { once: true });
  let lastText = '';
  /*
   * The stop hook's reminder (D-069), handled like our loop does (D-025,
   * D-108): the reply to it counts only if it calls a tool. Without one the
   * first answer stands (a report rewritten after "finito davvero?" replaces
   * it, an "OK" never); with one the first answer becomes a message of its own
   * and stays the answer if the reply ends with nothing but an "OK".
   */
  /** The answer the reminder was about, while the reply to it may still be dropped. */
  let held = null as { text: string; textCounts: boolean } | null;
  /** The stream reached the end of the held answer: what follows is the reply, not shown yet. */
  let holding = false as boolean;
  /** The reminder reached the agent: an "OK" from now on answers the system, not the user. */
  let followUp = false as boolean;
  /** The held answer, logged as a message of its own when the reply called a tool. */
  let delivered = null as string | null;
  /** Text of the message being streamed (the deltas since the last complete one). */
  let messageText = '';
  /** What the stream showed so far is the first answer's; the reply is held from here. */
  const startHolding = () => {
    flush();
    holding = true;
    followUp = true;
  };
  const onFinalAnswer = options.onFinalAnswer
    ? async (text: string): Promise<FinalAnswerHook> => {
        // Past a limit the answer is the report (D-170): no "finito davvero?" asking for more work.
        if (limitHit || tokenLimitHit || stepLimitHit) return null;
        const hooked = await options.onFinalAnswer!(text);
        const reminder = typeof hooked === 'string' ? hooked : hooked?.text;
        if (reminder && held === null && delivered === null) {
          held = {
            text,
            textCounts: typeof hooked === 'object' && hooked !== null && hooked.textCounts === true,
          };
          // The stream may still be behind the answer the hook saw (it comes on stdout).
          if (lastText.trim() === text.trim()) startHolding();
        }
        return hooked;
      }
    : undefined;
  /*
   * Watchdog (F-M3): no event from the harness for `idleMs` stops it, unless a hook or one of
   * Monsters' tools is working (`busy`): those wait for the user or for other monsters. While
   * an action of the harness is open (a call without its result) the limit is `actionIdleMs`.
   */
  const idleMs = options.idleTimeoutMs ?? HARNESS_IDLE_MS;
  const actionIdleMs = Math.max(idleMs, options.actionIdleTimeoutMs ?? HARNESS_ACTION_IDLE_MS);
  let lastEvent = Date.now();
  let busy = 0;
  let stalled = false;
  /** The limit that stopped the harness, for the message. */
  let stalledAfterMs = idleMs;
  const openMonstersCalls = new Set<string>();
  /** Every call of the harness (its own tools and Monsters') still without a result. */
  const openCalls = new Set<string>();
  let onStall: () => void = () => {};
  const stallSignal = new Promise<'stalled'>((resolve) => {
    onStall = () => resolve('stalled');
  });
  const watchdog = setInterval(
    () => {
      if (busy > 0 || openMonstersCalls.size > 0) {
        lastEvent = Date.now();
        return;
      }
      const limit = openCalls.size > 0 ? actionIdleMs : idleMs;
      if (stalled || scope.aborted || Date.now() - lastEvent < limit) return;
      stalled = true;
      stalledAfterMs = limit;
      void scope.abort(new KilledError('agent', runAgentStrings().harnessNoSignal));
      onStall();
    },
    Math.max(10, Math.min(5000, Math.floor(idleMs / 4))),
  );
  watchdog.unref();
  const withBusy = async <T>(work: () => Promise<T>): Promise<T> => {
    busy++;
    try {
      return await work();
    } finally {
      busy--;
      lastEvent = Date.now();
    }
  };
  let limitHit = null as string | null;
  /** Which cap `limitHit` says, as data for the UI. */
  let limitReason: LimitReason | undefined;
  // A harness runs on a subscription: the plan's caps (`limits.plan`), apart from the API's.
  const maxTokens = agentTokenLimit(agent.config, budget?.limits, true);
  let tokenLimitHit = false as boolean;
  /** The agent's own step cap was reached on a harness that can wrap up (D-196). */
  let stepLimitHit = false as boolean;
  /** Model requests of this run against `maxSteps` (a turn's aggregate total is not one). */
  let agentSteps = 0;
  /** The model was told (or is about to be) that few steps are left: once per run. */
  let stepsWarned = false as boolean;
  /** Claude Code reads that note at its next hook or result of Monsters' tools. */
  let stepsNotePending = false as boolean;
  let limitTimer: NodeJS.Timeout | undefined;
  /** A limit was reached: the harness stops (now, or after a grace in which its answer may end). */
  const stopForLimit = () => {
    if (limitTimer) clearTimeout(limitTimer);
    limitTimer = undefined;
    if (!scope.aborted) {
      void scope.abort(
        new KilledError(
          'agent',
          limitHit ??
            (stepLimitHit ? `max steps ${maxSteps}` : `token limit ${maxTokens ?? ''}`.trim()),
        ),
      );
    }
  };
  /** Codex's way to tell the model something mid-turn (D-170), once the thread exists. */
  let steer: ((text: string) => Promise<boolean>) | undefined;
  /** The harness can be told to wrap up: Claude Code's hooks refuse its tools, Codex is told. */
  const canWrapUp = () => hooked || steer !== undefined;
  /**
   * The wrap-up after a limit (D-170), as our loop's last step without tools (AG-03): every tool
   * is refused with `reason`, and the report the model then writes ends the run at the limit.
   * `told`: the model read it (a refused call); `steered`: Codex got the note; `requests` made
   * since. On Codex the note counts as read only once a later request follows it (C-12): a
   * complete answer that ends the very request that reached the limit stays completed, as on
   * Claude Code, where only a refused call tells the model.
   */
  let wrapUp = null as {
    why: string;
    reason: string;
    requests: number;
    told: boolean;
    steered: boolean;
  } | null;
  /** Calls refused because of the limit: their results say so (`cause: limit`). */
  const limitRefused = new Set<string>();
  const wrapUpMs = options.wrapUpMs ?? WRAP_UP_MS;
  /**
   * Checks the run budget, the agent's token limit and its steps (D-196). The first time one is
   * reached the wrap-up starts when the harness allows it; otherwise the harness stops as soon
   * as it does more work, or after a short grace (the request that reached it may end a
   * complete answer).
   */
  const reachLimit = (): void => {
    if (limitHit || tokenLimitHit || stepLimitHit || scope.aborted) return;
    const hit = budget?.exhaustedBy();
    limitHit = hit?.message ?? null;
    limitReason = hit?.limit;
    tokenLimitHit = !limitHit && maxTokens !== undefined && counted >= maxTokens;
    stepLimitHit = !limitHit && !tokenLimitHit && stepsWrapUp && agentSteps >= maxSteps;
    if (!limitHit && !tokenLimitHit && !stepLimitHit) return;
    // The wrap-up's words say it all now: no "few steps left" after them.
    stepsNotePending = false;
    if (!canWrapUp()) {
      limitTimer = setTimeout(stopForLimit, LIMIT_GRACE_MS);
      return;
    }
    const why =
      limitHit ??
      (tokenLimitHit
        ? runAgentPrompts().agentTokensWhy(maxTokens ?? 0)
        : runAgentPrompts().agentStepsWhy(maxSteps));
    const wrap = {
      why,
      reason: runAgentPrompts().limitWrapUp(why),
      requests: 0,
      told: false,
      steered: false,
    };
    wrapUp = wrap;
    limitTimer = setTimeout(stopForLimit, wrapUpMs);
    // Claude Code reads it in the refusal of its next call; Codex gets it as a note at once.
    if (!hooked && steer) {
      void steer(wrap.reason).then((ok) => {
        if (ok) {
          wrap.steered = true;
        } else if (wrapUp === wrap && !scope.aborted) {
          // Not told: the stop as without a wrap-up.
          wrapUp = null;
          if (limitTimer) clearTimeout(limitTimer);
          limitTimer = setTimeout(stopForLimit, LIMIT_GRACE_MS);
        }
      });
    }
  };
  /**
   * Few of the agent's steps left (D-196): the model is told once to save its work and close
   * what it left open. Codex gets a note in its thread at once; Claude Code reads it at its
   * next hook (`additionalContext`) or result of Monsters' tools (`takeStepsNote`).
   */
  const warnSteps = (): void => {
    if (stepsWarned || !stepsWrapUp || wrapUp || scope.aborted) return;
    const note = stepsLeftNote(maxSteps - agentSteps, maxSteps, agentSteps);
    if (!note) return;
    stepsWarned = true;
    if (!hooked && steer) {
      // Not told: the next result of Monsters' tools says it.
      void steer(note).then((ok) => {
        if (!ok && !wrapUp) stepsNotePending = true;
      });
    } else {
      stepsNotePending = true;
    }
  };
  /** The "few steps left" note for the model, once, with the steps left when it reads it. */
  const takeStepsNote = (): string | null => {
    if (!stepsNotePending || wrapUp) return null;
    stepsNotePending = false;
    return stepsLeftNote(maxSteps - agentSteps, maxSteps, agentSteps);
  };
  /** During the wrap-up: the refusal for one call, recorded as refused for the limit. */
  const wrapUpRefusal = (callId: string): string | null => {
    if (canWrapUp()) reachLimit();
    if (!wrapUp) return null;
    wrapUp.told = true;
    if (callId) limitRefused.add(callId);
    return wrapUp.reason;
  };
  /** What the core checks before the harness's own tools (D-069, D-078, D-079, D-127), per call. */
  const hookContext = (): HarnessHookContext => ({
    log,
    agentId,
    runId,
    parentId,
    monstersServer: HARNESS_MCP_SERVER,
    ...(options.guard ? { guard: options.guard } : {}),
    ...(onFinalAnswer ? { onFinalAnswer } : {}),
    callEvent,
    refused: (id) => hookRefused.add(id),
    lastText: () => lastText,
    wrapUp: wrapUpRefusal,
    ...(hooked ? { stepsNote: takeStepsNote } : {}),
    ...(lock ? { lockout: { lock, cwd } } : {}),
    ...(options.closedFolders?.length && options.systemTools
      ? {
          closed: options.closedFolders.map((f) => ({
            lock: { dataDir: f.path, allowed: [] },
            cwd,
            message: f.message,
            ...(savedOutputs !== undefined && f.path === savedOutputs ? { ownOutputs: true } : {}),
          })),
        }
      : {}),
    ...(options.systemTools ? { workspace: cwd } : {}),
    ...(options.systemTools && options.instructionFolders
      ? { instructionFolders: options.instructionFolders() }
      : {}),
    ...(builtins
      ? {
          outside: {
            builtins,
            reason: (tool: string) => unavailableBuiltin(tool, web, HARNESS_MCP_SERVER).model,
            ...(web.attachmentsOnly ? { readable: files?.read ?? [] } : {}),
            ...(web.attachmentsOnly && savedOutputs ? { sessionOutputs: savedOutputs } : {}),
          },
        }
      : {}),
  });
  /**
   * Codex asks before a command leaves its sandbox (D-158): the check of Claude Code's `Bash`.
   * The command is already logged as `codex.shell` (its `item/started` comes first).
   */
  const approveCommand: HarnessCommandApproval | undefined =
    harness.id === 'codex' && options.systemTools
      ? (call, signal) =>
          withBusy(() =>
            checkHarnessCommand(
              call,
              {
                ...hookContext(),
                callEvent: (id, name, input) =>
                  callEvent(id, name === 'Bash' ? 'shell' : name, input),
              },
              AbortSignal.any([signal, scope.signal]),
            ),
          )
      : undefined;
  const { session, close } = options.sessions.open(
    sessionTools,
    {
      log,
      agentId,
      runId,
      signal: scope.signal,
      scope,
      parentId,
      /*
       * The run budget, and the wrap-up (D-170): past a limit, the agent's token limit and its
       * steps too (D-196), every one of Monsters' tools answers `LIMIT_REACHED` with the words
       * that ask for the report.
       */
      ...(budget || maxTokens !== undefined || stepsWrapUp
        ? {
            budget: {
              assertActive: (id?: string) => {
                const reason = wrapUpRefusal('');
                if (reason && wrapUp) {
                  throw new ToolError('LIMIT_REACHED', `limit reached: ${wrapUp.why}`, {
                    hint: reason,
                  });
                }
                budget?.assertActive(id);
              },
              addCost: (costUsd: number) => budget?.addCost(costUsd),
            },
          }
        : {}),
      knownText: [instructions, prompt].join('\n'),
      // Monsters' tools of a harness pass the same brake and injection check as our loop.
      ...(options.guard ? { guard: options.guard } : {}),
    },
    {
      trackSources: ownSearch,
      ...(stepsWrapUp ? { note: takeStepsNote } : {}),
      ...(codexPlan ? { exposed: codexPlan.exposed } : {}),
      ...(hooked
        ? {
            hook: (input: unknown, signal: AbortSignal) =>
              withBusy(() =>
                answerHarnessHook(input, hookContext(), AbortSignal.any([signal, scope.signal])),
              ),
          }
        : {}),
    },
  );

  const flushMs = options.partialFlushMs ?? 250;
  let pending = '';
  let draftOpen = false;
  /** Deltas were logged since the last complete message: its text is already there. */
  let streamed = false;
  let timer: NodeJS.Timeout | undefined;
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!pending || holding) return;
    // After a reminder, an "OK" answers the system: never shown (D-108).
    if (followUp && messageText && mayBeAcknowledgement(messageText)) return;
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
  let done: Extract<HarnessEvent, { type: 'done' }> | null = null;
  /** The harness did something already (text, a call, a model request): no new start then. */
  let acted = false as boolean;
  /** Monsters' tools were not there at the start (D-160): why, and whether to start again. */
  let toolsDown = null as { cause: string; retry: boolean } | null;
  /** Calls of Monsters' tools the harness made, by call id, and how many per tool (D-160). */
  const monstersCalls = new Map<string, { name: string; input: unknown }>();
  const harnessCalls = new Map<string, number>();
  /** Failed calls that never reached the core, already logged here (per tool). */
  const unseenLogged = new Map<string, number>();
  let started = Date.now();
  /** One served model request: `provider_usage`, run budget, the agent's token limit. */
  const recordUsage = (e: HarnessUsageEvent, afterAbort: boolean) => {
    totalIn += e.inTok;
    totalOut += e.outTok;
    const fresh = limitTokens(e.inTok, e.outTok, e.cacheReadTok);
    counted += fresh;
    servedModel = { provider: harness.id, model: e.model };
    const context = e.aggregate
      ? undefined
      : contextMeter.measure(e.inTok, options.contextWindow?.(servedModel));
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'provider_usage',
      data: {
        provider: harness.id,
        model: e.model,
        inputTokens: e.inTok,
        outputTokens: e.outTok,
        ...(e.cacheReadTok ? { cachedInputTokens: e.cacheReadTok } : {}),
        ...(e.cacheWriteTok ? { cacheWriteTokens: e.cacheWriteTok } : {}),
        durationMs: Date.now() - started,
        step: steps,
        ...(context ? { context } : {}),
        ...(options.projectId !== undefined ? { project: options.projectId } : {}),
      },
    });
    started = Date.now();
    steps++;
    if (!e.aggregate) agentSteps++;
    budget?.addStep(fresh, 0, true);
    if (afterAbort) return;
    // A request of the wrap-up (D-170): counted against its bound, never a new limit.
    if (wrapUp) {
      wrapUp.requests++;
      return;
    }
    reachLimit();
    warnSteps();
  };

  /** The last status of Monsters' server the harness reported (D-160). */
  let toolsStatus = undefined as string | undefined;
  /*
   * Monsters' tools are not there (D-160): the model would start without vault, web and
   * team, find nothing and tell the user "the team's tools did not respond". Never let it
   * improvise: started again once if it did nothing yet, stopped with the cause otherwise.
   */
  const toolsUnavailable = async (status: string): Promise<void> => {
    if (toolsDown) return;
    const retry = mayRetryTools && !acted;
    const cause = await withBusy(() => monstersToolsCause(status, options.mcpUrl(), session.token));
    toolsDown = { cause, retry };
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'mcp_server',
      data: {
        server: HARNESS_MCP_SERVER,
        action: 'failed',
        transport: 'http',
        message: runAgentStrings().monstersToolsDown(harnessProgram(harness.id), cause, retry),
      },
    });
    void scope.abort(new KilledError('agent', 'monsters tools unavailable'));
  };

  try {
    const events = harness.run(
      {
        prompt,
        cwd,
        ...(options.cwd !== undefined ? { foreignCwd: true } : {}),
        instructions,
        ...(options.model ? { model: options.model } : {}),
        ...(options.effort ? { effort: options.effort } : {}),
        mcp: { name: HARNESS_MCP_SERVER, url: options.mcpUrl(), token: session.token },
        systemTools: options.systemTools,
        ...(lock || options.closedFolders?.length
          ? {
              forbiddenPaths: [
                ...(lock ? forbiddenEntries(lock) : []),
                ...(options.closedFolders ?? []).map((f) => f.path),
              ],
            }
          : {}),
        ...(savedOutputs ? { sessionOutputs: savedOutputs } : {}),
        ...(files?.read.length ? { readFiles: files.read } : {}),
        ...(files?.images.length ? { images: files.images } : {}),
        ...(ownSearch ? { webSearch: true } : {}),
        ...(hooked
          ? {
              hooks: {
                url: options.hookUrl!(),
                token: session.token,
                stop: options.onFinalAnswer !== undefined,
              },
            }
          : {}),
        ...(approveCommand ? { approveCommand } : {}),
        ...(connectors.length > 0 ? { connectors } : {}),
        ...(options.resume ? { resume: options.resume } : {}),
        // The backstop past the wrap-up (D-196); the cap itself when the harness cannot be told.
        maxTurns: stepsWrapUp ? maxSteps + WRAP_UP_REQUESTS : maxSteps,
        spawn: (command, args, spawnOptions) => scope.spawn(command, args, spawnOptions),
        scratchDir,
        // A kill closes the run at once: the request in flight is recorded first.
        onAbortUsage: (usage) => recordUsage(usage, true),
        steer: (send) => {
          steer = send;
        },
      },
      scope.signal,
    );
    stream: for await (const e of untilStalled(events, stallSignal)) {
      lastEvent = Date.now();
      // More work after a limit stops the harness; in the wrap-up only past its requests (D-170).
      if (
        limitTimer &&
        !LIMIT_TAIL_EVENTS.has(e.type) &&
        (!wrapUp || wrapUp.requests >= WRAP_UP_REQUESTS)
      ) {
        stopForLimit();
      }
      // The model starts while Monsters' server is still connecting: its first request goes
      // without vault, web and team (Claude Code's `pending` at the init, D-160).
      if (toolsStatus === 'pending' && ACTING_EVENTS.has(e.type)) {
        await toolsUnavailable(toolsStatus);
        break stream;
      }
      switch (e.type) {
        case 'session':
          if (e.id) sessionId = e.id;
          if (e.model) servedModel = { provider: harness.id, model: e.model };
          break;
        case 'mcp-status': {
          try {
            options.onMcpStatus?.(
              Object.entries(e.servers).map(([name, status]) => ({ name, status })),
            );
          } catch {
            // The state of a connector never costs a run.
          }
          const status = e.servers[HARNESS_MCP_SERVER];
          if (status === undefined) break;
          toolsStatus = status;
          // `pending` may still turn `connected` (Codex sends several updates): it counts
          // only if the model starts while it lasts (the check before this switch).
          if (TOOLS_FAILED.has(status)) {
            await toolsUnavailable(status);
            break stream;
          }
          break;
        }
        case 'text-delta':
          acted = true;
          pending += e.delta;
          messageText += e.delta;
          streamed = true;
          timer ??= setTimeout(flush, flushMs);
          break;
        case 'text': {
          acted = true;
          const wasStreamed = streamed;
          const own = wasStreamed ? messageText : e.text;
          if (!wasStreamed) pending += e.text;
          streamed = false;
          messageText = '';
          if (followUp && isAcknowledgement(e.text)) {
            // The reply to the reminder: not shown, never the answer (D-108).
            if (pending.endsWith(own)) pending = pending.slice(0, pending.length - own.length);
            break;
          }
          lastText = e.text;
          if (!wasStreamed) flush();
          // The end of the answer the reminder was about: the reply starts here.
          if (held !== null && !followUp && e.text.trim() === held.text.trim()) startHolding();
          break;
        }
        case 'tool-call':
          acted = true;
          openCalls.add(e.id);
          if (e.monsters) {
            openMonstersCalls.add(e.id);
            monstersCalls.set(e.id, { name: e.name, input: e.input });
            harnessCalls.set(e.name, (harnessCalls.get(e.name) ?? 0) + 1);
          }
          messageText = '';
          if (held !== null) {
            // The reply acts (`ask_user`, D-078): the first answer is a message of its own.
            if (!followUp) startHolding();
            delivered = held.text;
            held = null;
            holding = false;
            draftOpen = false;
            log.append({
              agent: agentId,
              runId,
              parentId,
              type: 'message',
              data: { role: 'agent', text: delivered },
            });
          }
          flush();
          // The text before a tool call is a message of its own (clients close it here).
          draftOpen = false;
          if (e.monsters) break;
          // The hook may have logged it already, before the brake's events.
          callEvent(e.id, e.name, e.input);
          break;
        case 'tool-result':
          openCalls.delete(e.id);
          openMonstersCalls.delete(e.id);
          if (e.monsters) {
            // The endpoint logged every call that reached it; one that failed on the way
            // (a broken connection, an input the MCP server refused) is logged here (D-160).
            const call = monstersCalls.get(e.id);
            monstersCalls.delete(e.id);
            // A call cut by a stop never started for Monsters: nothing to log after the stop.
            if (!call || !e.isError || fromCore(e.output) || scope.aborted) break;
            const unseen =
              (harnessCalls.get(call.name) ?? 0) -
              session.received(call.name) -
              (unseenLogged.get(call.name) ?? 0);
            if (unseen <= 0) break;
            unseenLogged.set(call.name, (unseenLogged.get(call.name) ?? 0) + 1);
            const callEventId = log.append({
              agent: agentId,
              runId,
              parentId,
              type: 'tool_call',
              data: { callId: e.id, tool: call.name, input: preview(call.input) },
            }).id;
            const detail = (
              typeof e.output === 'string' ? e.output : JSON.stringify(e.output ?? '')
            ).slice(0, 500);
            log.append({
              agent: agentId,
              runId,
              parentId: callEventId,
              type: 'tool_result',
              data: {
                callId: e.id,
                tool: call.name,
                ok: false,
                error: runAgentStrings().toolNeverReached(detail),
                cause: 'error',
              },
            });
            break;
          }
          // The plan's web search: its links count as seen for the notes' link check.
          session.seen(e.output);
          // Its result was logged at the stop: one result per call.
          if (closedEarly.has(e.id)) break;
          unanswered.delete(e.id);
          {
            const name = toolNames.get(e.id) ?? 'tool';
            const limited = e.isError === true && limitRefused.has(e.id);
            const refused = e.isError && !limited ? refusedBuiltin(name, e.output, builtins) : null;
            if (refused) explained.add(e.id);
            log.append({
              agent: agentId,
              runId,
              parentId,
              type: 'tool_result',
              data: {
                callId: e.id,
                tool: `${harness.id}.${name}`,
                ok: !e.isError,
                // Refused by the run's setup (D-127): plain words, never "denied" as the user's no.
                ...(refused
                  ? {
                      error:
                        refused.refusal === 'monsters_rule'
                          ? monstersRuleRefusal(refused.tool)
                          : unavailableBuiltin(refused.tool, web, HARNESS_MCP_SERVER).user,
                      refusal: refused.refusal,
                    }
                  : { output: preview(e.output) }),
                // The cause of every failure (D-132), as on the native loop's tools.
                ...(e.isError
                  ? {
                      cause: limited
                        ? ('limit' as const)
                        : refused
                          ? refused.refusal === 'monsters_rule'
                            ? ('monsters_policy' as const)
                            : ('not_in_run' as const)
                          : ('error' as const),
                    }
                  : {}),
              },
            });
          }
          break;
        case 'usage':
          acted = true;
          recordUsage(e, scope.aborted);
          break;
        case 'plan-limits':
          try {
            options.onPlanLimits?.(e.reading);
          } catch {
            // A number of the usage block never costs a run.
          }
          break;
        case 'done':
          // Codex with `required` Monsters' server: the thread never started (D-160).
          if (e.code === 'mcp_unavailable') {
            await toolsUnavailable(toolsStatus ?? 'failed');
            break stream;
          }
          done = e;
          // Refusals of the run's rules whose words this core does not know (a later binary).
          for (const d of e.denials ?? []) {
            if (explained.has(d.id) || d.tool.startsWith(`mcp__${HARNESS_MCP_SERVER}__`)) continue;
            explained.add(d.id);
            const message = runAgentStrings().harnessRefused(d.tool);
            // A refusal mid-run is information: the monster read why and went on (D-166). It is an
            // error only when the run ended in one; one the hook recorded already says it as a record.
            if (e.reason === 'error') {
              log.append({
                agent: agentId,
                runId,
                parentId,
                type: 'error',
                data: { code: 'harness_refused', message },
              });
            } else if (!hookRefused.has(d.id)) {
              log.append({
                agent: agentId,
                runId,
                parentId: callEvents.get(d.id) ?? parentId,
                type: 'security',
                data: { action: 'internal_denied', source: 'harness_rules', tool: d.tool, message },
              });
            }
          }
          break;
      }
    }
  } catch (err) {
    if (!scope.aborted) done = { type: 'done', reason: 'error', error: (err as Error).message };
  } finally {
    clearInterval(watchdog);
    if (limitTimer) clearTimeout(limitTimer);
    flush();
    options.signal.removeEventListener('abort', onParentAbort);
    scope.signal.removeEventListener('abort', onStop);
    closeUnanswered(scope.aborted);
    close();
    scope.close();
    rmSync(scratchDir, { recursive: true, force: true });
  }

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

  /** The agent's step cap, as data for the UI (D-171). */
  const stepsLimit: LimitReason = { kind: 'agent_steps', value: maxSteps };
  // An answer the harness completed stays completed even if its last request reached a limit,
  // unless the model wrote it in the wrap-up (D-170, below).
  const answered = done?.reason === 'stop' && !options.signal.aborted;
  if (toolsDown && !answered && !options.signal.aborted) {
    // The `mcp_server` line already says why: a new start says nothing more.
    if (toolsDown.retry) return { ...base('failed', ''), toolsRetry: true };
    const message = runAgentStrings().harnessToolsUnavailable(
      agent.config.name,
      harnessProgram(harness.id),
      toolsDown.cause,
    );
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: { code: 'harness_tools_unavailable', message },
    });
    closeDraft('failed');
    return base('failed', lastText, { error: message, stopCause: 'tools_unavailable' });
  }
  // The user's stop or the kill switch during the wrap-up is theirs, not the limit's (D-170).
  if (limitHit && !answered && !options.signal.aborted) {
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: {
        code: 'run_limit',
        message: runAgentStrings().stops(agent.config.name, limitHit),
        ...(limitReason ? { limit: limitReason } : {}),
      },
    });
    closeDraft('aborted');
    return base('run_limit', lastText, {
      error: limitHit,
      ...(limitReason ? { limit: limitReason } : {}),
    });
  }
  if (tokenLimitHit && !answered && !options.signal.aborted) {
    const message = runAgentStrings().tokenLimit(agent.config.name, maxTokens ?? 0, true);
    const limit = agentTokenLimitReason(agent.config, maxTokens ?? 0, true);
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: { code: 'token_limit', message, limit },
    });
    closeDraft('aborted');
    return base('token_limit', lastText, { error: message, limit });
  }
  if (stepLimitHit && !answered && !options.signal.aborted) {
    // Stopped at the agent's steps without a report: past the wrap-up's bound, or not told.
    const message = runAgentStrings().maxSteps(agent.config.name, maxSteps);
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: { code: 'max_steps', message, limit: stepsLimit },
    });
    closeDraft('aborted');
    return base('max_steps', lastText, { error: message, limit: stepsLimit });
  }
  if (stalled && !answered && !options.signal.aborted) {
    const message = runAgentStrings().harnessStalled(
      agent.config.name,
      Math.round(stalledAfterMs / 60_000),
    );
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: { code: 'harness_stalled', message },
    });
    closeDraft('failed');
    return base('failed', lastText, { error: message, stopCause: 'watchdog' });
  }
  if (options.signal.aborted || done?.reason === 'aborted') {
    const reason = options.signal.reason instanceof Error ? options.signal.reason.message : '';
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: { code: 'aborted', message: abortMessage(agent.config.name, reason) },
    });
    closeDraft('aborted');
    // Not asked by Monsters: the harness program itself reported the interruption.
    const cause = options.signal.aborted ? abortCause(options.signal.reason) : 'harness';
    return base('aborted', lastText, cause ? { stopCause: cause } : {});
  }
  if (!done || done.reason === 'error') {
    // The session to resume is gone, before any request (D-199): the caller starts without it.
    if (options.resume && done?.code === 'resume_not_found' && steps === 0 && !lastText) {
      return { ...base('failed', ''), resumeLost: true };
    }
    // The plan's limit before any answer: the caller runs the same request on the next model.
    if (quietPlanLimit && done?.code === 'usage_limit' && !lastText && !draftOpen) {
      return { ...base('failed', '', done.error ? { error: done.error } : {}), planLimited: true };
    }
    const message = done?.error ?? runAgentStrings().harnessClosed(agent.config.name);
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: { code: done?.code ? `harness_${done.code}` : 'agent_failed', message },
    });
    closeDraft('failed');
    return base('failed', lastText, { error: message });
  }
  let text = done.text ?? lastText;
  // The reply to a reminder: an "OK" is never the answer (D-108).
  if ((held !== null || delivered !== null) && isAcknowledgement(text)) text = '';
  /** The answer is already in the log: the held one, after a reply that called a tool. */
  let logged = false;
  if (held !== null) {
    // No tool call after the reminder: the first answer stands, unless it is a report
    // rewritten after "finito davvero?" (`textCounts`).
    const rewritten = held.textCounts && text.trim() !== '' && text.trim() !== held.text.trim();
    if (!rewritten) text = held.text;
  } else if (delivered !== null && !text.trim()) {
    text = delivered;
    logged = true;
  }
  /*
   * The report of the wrap-up (D-170): the model was told it had no more tools and ended its
   * turn. Still a stop at the limit, as the report of our loop's last step (AG-03), but with its
   * text: a delegation hands it back as a partial report.
   */
  const wrapUpTold = wrapUp !== null && (wrapUp.told || (wrapUp.steered && wrapUp.requests > 0));
  const limitStatus = wrapUpTold
    ? limitHit
      ? 'run_limit'
      : tokenLimitHit
        ? 'token_limit'
        : 'max_steps'
    : null;
  const wrapUpLimit =
    limitStatus === 'run_limit'
      ? limitReason
      : limitStatus === 'token_limit'
        ? agentTokenLimitReason(agent.config, maxTokens ?? 0, true)
        : limitStatus === 'max_steps'
          ? stepsLimit
          : undefined;
  const wrapUpWhy =
    limitStatus === 'run_limit'
      ? runAgentStrings().stops(agent.config.name, limitHit ?? '')
      : limitStatus === 'token_limit'
        ? runAgentStrings().tokenLimit(agent.config.name, maxTokens ?? 0, true)
        : runAgentStrings().maxSteps(agent.config.name, maxSteps);
  if (limitStatus) {
    const reported = text.trim() !== '';
    const message = wrapUpWhy + (reported ? runAgentStrings().reportAtLastStep : '');
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: {
        code: limitStatus,
        message,
        ...(wrapUpLimit ? { limit: wrapUpLimit } : {}),
        ...(reported ? { report: true } : {}),
      },
    });
  } else if (done.reason === 'max-steps') {
    log.append({
      agent: agentId,
      runId,
      parentId,
      type: 'error',
      data: {
        code: 'max_steps',
        message: runAgentStrings().maxSteps(agent.config.name, maxSteps),
        limit: stepsLimit,
      },
    });
  }
  if (!logged) {
    log.append({ agent: agentId, runId, parentId, type: 'message', data: { role: 'agent', text } });
  }
  if (limitStatus) {
    return base(limitStatus, text, {
      error: limitStatus === 'run_limit' ? (limitHit ?? wrapUpWhy) : wrapUpWhy,
      ...(wrapUpLimit ? { limit: wrapUpLimit } : {}),
    });
  }
  if (done.reason === 'max-steps') return base('max_steps', text, { limit: stepsLimit });
  return base('completed', text);
}
