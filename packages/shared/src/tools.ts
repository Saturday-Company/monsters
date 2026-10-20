import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { z } from 'zod';
import type { AgentId, RunId } from './ids.ts';

/*
 * Common contract for every tool an agent can use (vault, web, team, shell, MCP…).
 * Tools are provider-agnostic: the agent runtime adapts them to the model loop
 * (AI SDK `tool()`), to harnesses (as an MCP server) and to the vault MCP server.
 *
 * The runtime logs `tool_call` / `tool_result` around every execution; a tool only
 * emits the extra domain events it owns (e.g. `vault_change`).
 */

/**
 * Machine-readable failure reasons, returned to the model so it can recover.
 *
 * Who said no is part of the code (D-132): `PERMISSION_DENIED` covered the
 * user, a setting, a site answering 403, a fixed rule of Monsters and the
 * harness alike, and a model read every one of them as "the user denied me".
 * Only `USER_DECLINED` is the user's no.
 */
export const TOOL_ERROR_CODES = [
  'INVALID_INPUT',
  'NOT_FOUND',
  'EXISTS',
  'CONFLICT',
  /** The user said no to this action (the brake's card): the only refusal of the user. */
  'USER_DECLINED',
  /** A setting the user can change is off (a permission, a folder, a service not given): the hint says where. */
  'SETTING_OFF',
  /** A service needs the user to sign in again or to fix its key: the hint says where. */
  'NOT_LINKED',
  /** A site or a service refused (HTTP 401/403, a wall against bots): nobody in Monsters can turn it on. */
  'SITE_REFUSED',
  /** A fixed rule of Monsters (its data, private addresses, system folders, a chat with other people): no setting changes it. */
  'BLOCKED_BY_POLICY',
  /** Not a tool of this run (another monster has it, or it was taken away): never the user's no. */
  'NOT_IN_RUN',
  'RATE_LIMITED',
  /** A cost limit of the run (delegations, open questions, steps, tokens): do not retry. */
  'LIMIT_REACHED',
  /** The same read-only call a third time: use the result already given (D-064). */
  'REPEATED_CALL',
  'UNAVAILABLE',
  'ABORTED',
  'INTERNAL',
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

/**
 * Why a tool call failed, in a closed vocabulary written by the core, never
 * guessed by the model (D-132, defence D2 of the review of 19/10): on every
 * failed `tool_result`, in the receipt, and in what the model reads.
 * `user_declined` is the only refusal of the user.
 */
export const TOOL_FAILURE_CAUSES = [
  'user_declined',
  /** A question or a card nobody answered in time (the user may not have seen it). */
  'user_no_answer',
  'setting_off',
  'not_linked',
  'site_refused',
  'monsters_policy',
  'not_in_run',
  /** A limit of the run or of a service (steps, cost, rate). */
  'limit',
  'error',
] as const;
export type ToolFailureCause = (typeof TOOL_FAILURE_CAUSES)[number];

/** The cause a code stands for (an error may say more with its own `failureCause`). */
export function toolFailureCause(code: string): ToolFailureCause {
  switch (code) {
    case 'USER_DECLINED':
      return 'user_declined';
    case 'SETTING_OFF':
      return 'setting_off';
    case 'NOT_LINKED':
      return 'not_linked';
    case 'SITE_REFUSED':
      return 'site_refused';
    case 'BLOCKED_BY_POLICY':
      return 'monsters_policy';
    case 'NOT_IN_RUN':
      return 'not_in_run';
    case 'LIMIT_REACHED':
    case 'RATE_LIMITED':
      return 'limit';
    default:
      return 'error';
  }
}

/**
 * What the model reads next to a failure that is not the user's no (D-132):
 * who said no and who can change it, in the user's language.
 */
export const TOOL_CAUSE_NOTE: Partial<Record<ToolFailureCause, string>> = {
  user_no_answer: 'Nessuno ha risposto in tempo (l’utente può non averlo visto): non è un suo no.',
  setting_off:
    'Un’impostazione è spenta: non è un no dell’utente. La cambia solo l’utente, dove dice il messaggio.',
  not_linked:
    'Il servizio va ricollegato o la sua chiave va sistemata dall’utente: non è un suo no.',
  site_refused:
    'Il sito o il servizio ha rifiutato: non è un permesso dell’utente né di Monsters, e nessuno lo può accendere da Monsters.',
  monsters_policy:
    'Regola fissa di Monsters: non è un no dell’utente e nessuna impostazione la cambia.',
  not_in_run: 'Non è uno strumento di questo lavoro: non è un no dell’utente.',
};

/** A failure the model should see and react to (not a crash). */
export class ToolError extends Error {
  readonly code: ToolErrorCode;
  /** What the agent can do instead, in plain words. */
  readonly hint: string | undefined;
  readonly details: unknown;
  /** The cause when the code alone does not say it (a question nobody answered). */
  readonly failureCause: ToolFailureCause | undefined;

  constructor(
    code: ToolErrorCode,
    message: string,
    options: { hint?: string; details?: unknown; failureCause?: ToolFailureCause } = {},
  ) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.hint = options.hint;
    this.details = options.details;
    this.failureCause = options.failureCause;
  }
}

/** Domain event a tool can add to the action log (type must exist in `events.ts`). */
export interface ToolEmittedEvent {
  type: string;
  data: unknown;
}

/** A process started for a tool call, tied to the kill switch. */
export interface ToolProcess {
  child: ChildProcess;
  /**
   * Stops the process with its descendants (SIGINT, then SIGKILL after a grace
   * period; the whole tree on Windows). Resolves once they are gone.
   */
  stop(): Promise<void>;
}

/** What the runtime gives a tool for one execution. */
export interface ToolContext {
  /** The agent calling the tool (`user` when invoked from the UI, `mcp:<client>` for external MCP clients). */
  agentId: AgentId;
  runId: RunId;
  /** Id of the `tool_call` event of this execution: parent for the events the tool logs itself. */
  callEventId?: string;
  /** Aborted by the kill switch or when the run ends: long work must honour it. */
  signal: AbortSignal;
  /** Appends a domain event to the action log, attributed to this agent and run. */
  emit(event: ToolEmittedEvent): void;
  /**
   * Starts a child process in its own process group, so the kill switch and the
   * end of the run reach its descendants too. Processes still alive when the
   * tool call ends are stopped. Absent outside the agent runtime.
   */
  spawn?(command: string, args: readonly string[], options?: SpawnOptions): ToolProcess;
  /**
   * Title of a web page the agent saw in this run (search results, pages read),
   * by URL: the vault tools use it to turn bare source URLs into `[title](url)`.
   * Only for agents with web tools.
   */
  linkTitle?: (url: string) => string | undefined;
}

export interface MonstersTool<I = unknown, O = unknown> {
  /** snake_case, unique across the toolset (e.g. `vault_search`). */
  name: string;
  /** Written for the model: what it does and when to use it, in a few lines. */
  description: string;
  inputSchema: z.ZodType<I>;
  /**
   * JSON Schema shown to the model instead of the one derived from
   * `inputSchema` (tools of external MCP servers, whose schema is JSON already).
   */
  inputJsonSchema?: Record<string, unknown>;
  /** Only reads data (MCP `readOnlyHint`). */
  readOnly?: boolean;
  /** May remove or overwrite data, even if reversible (MCP `destructiveHint`). */
  destructive?: boolean;
  /**
   * The argument holding the path of a file of the computer this tool writes
   * (from the gallery's data, D-092): the brake checks it like a file write of
   * the monsters, inside the folders they may change.
   */
  writesPath?: string;
  /**
   * The output carries third-party text (web pages, search results, notes): the
   * agent runtime hands it to the model inside a `<dati_esterni fonte="…">`
   * envelope, so "data, not instructions" has a visible boundary. Returns the
   * source shown in `fonte` (e.g. the URL).
   */
  externalSource?(input: I, output: O): string;
  execute(input: I, ctx: ToolContext): Promise<O>;
}

/** Identity helper that keeps input/output types inferred. */
export function defineTool<I, O>(tool: MonstersTool<I, O>): MonstersTool<I, O> {
  return tool;
}
