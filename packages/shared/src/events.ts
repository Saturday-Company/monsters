import { z } from 'zod';
import { ContextUsageSchema } from './context.ts';
import { EffortSchema } from './providers.ts';
import { FileKindSchema, PreviewItemSchema } from './files.ts';
import {
  AutomationIdSchema,
  AutomationNotifySchema,
  AutomationRunEndSchema,
  AutomationSkipReasonSchema,
  AutomationStatusSchema,
  AutomationTriggerSchema,
} from './automations.ts';
import { ActorSchema, AgentIdSchema, ProjectIdSchema, RunIdSchema } from './ids.ts';
import {
  DelegationVerdictSchema,
  InstinctModeSchema,
  InstinctUseSchema,
  ReceiptCriterionSchema,
  ReceiptDataSchema,
} from './instinct.ts';
import { FileEventDataSchema } from './files.ts';
import { McpServerDataSchema } from './mcp.ts';
import { SpendDataSchema } from './spend.ts';
import { TelegramOriginSchema } from './telegram.ts';
import { TeamDraftSchema } from './team-draft.ts';
import { UlidSchema } from './ulid.ts';
import { TOOL_FAILURE_CAUSES } from './tools.ts';

/*
 * Event log schemas (ARCHITECTURE §5.1). Every action of the system is an event:
 * the log is at the same time the audit trail, the stream for the UI and the
 * source to resume work after a restart.
 *
 * Unknown keys inside `data` are stripped on validation: to add a field, extend
 * the schema here so every producer and consumer agrees on it.
 */

/**
 * Where a command or message came from (`desktop`: the desktop app itself, M3.1;
 * `automation`: the objective of a run of an automation, D-094).
 */
export const ChannelSchema = z.enum([
  'ui',
  'cli',
  'telegram',
  'ssh',
  'api',
  'system',
  'desktop',
  'automation',
]);
export type Channel = z.infer<typeof ChannelSchema>;

/** A channel of the user (the app, the terminal, Telegram…), not of the core or of a monster (D-103). */
export function isUserChannel(by: Channel | undefined): boolean {
  return by !== undefined && by !== 'system' && by !== 'automation';
}

export const MessageDataSchema = z.object({
  role: z.enum(['user', 'agent', 'system']),
  text: z.string(),
  /** Addressee when the message is directed to a specific agent. */
  to: AgentIdSchema.optional(),
  channel: ChannelSchema.optional(),
  /** True for partial (streaming) chunks; the final message has it unset. */
  partial: z.boolean().optional(),
  /**
   * Set on the final message that closes partial chunks when the turn did not
   * finish (run stopped or failed); its text may be empty.
   */
  status: z.enum(['aborted', 'failed']).optional(),
  /**
   * User messages only: the run whose work Ferma stopped and that this message
   * starts again ("Riprendi e continua", "Chiedimelo di nuovo", D-072). The
   * user did not type it: the UI shows a status line, not a bubble.
   */
  resumeOf: RunIdSchema.optional(),
  /** User messages only: ids of the files attached (see files.ts). */
  attachments: z.array(z.string().min(1)).optional(),
  /**
   * The objective of a run of this automation (channel `automation`, D-094):
   * the run is not part of the monster's chat.
   */
  automationId: AutomationIdSchema.optional(),
  /**
   * User messages only: the monster that wrote it on the user's behalf (the
   * orchestrator's `project_send` to a project lead, D-097). The user did not
   * type it; the lead reads it as a request of that monster.
   */
  from: AgentIdSchema.optional(),
  /**
   * With `from`: the run of that monster the message comes from (D-098). The
   * lead's run inherits its taint (D-070): the text is the monster's, not the
   * user's words, and may carry what that run read.
   */
  fromRun: RunIdSchema.optional(),
  /**
   * User messages only: written to a bot dedicated to this monster (D-107),
   * by `sender` in that chat. Only an `owner` sender is the user; the others'
   * words are never the user's own (known sites, D-070).
   */
  telegram: TelegramOriginSchema.optional(),
});

/**
 * Which cap of a run or of an agent stopped a job, as data: the UI words it in its own language
 * (the `message` of the event is a sentence in the core's language, for the log and the model).
 * `plan`: the cap of a subscription harness (Claude Code, Codex), not the one of the API models.
 * `own`: the agent's own limit (its `agent.yaml`), not the run's. `value` is missing for the
 * spending cap (its figure is in euros, in the message).
 */
export const LIMIT_KINDS = [
  'steps',
  'tokens',
  'cost',
  'tree_cost',
  'spend',
  'agent_tokens',
  'agent_steps',
] as const;
export const LimitReasonSchema = z.object({
  kind: z.enum(LIMIT_KINDS),
  value: z.number().nonnegative().optional(),
  plan: z.boolean().optional(),
  own: z.boolean().optional(),
});
export type LimitReason = z.infer<typeof LimitReasonSchema>;

export const DelegationDataSchema = z.object({
  from: AgentIdSchema,
  to: AgentIdSchema,
  status: z.enum(['started', 'completed', 'failed', 'aborted']),
  goal: z.string(),
  why: z.string().optional(),
  doneWhen: z.string().optional(),
  contextLinks: z.array(z.string()).optional(),
  /**
   * Fields of the brief the delegating agent wrote itself (`why`, `context_links`,
   * `constraints`, `output_format`, `done_when`); the others got the defaults (D-065).
   */
  filled: z.array(z.string()).optional(),
  summary: z.string().optional(),
  error: z.string().optional(),
  /**
   * "Finito davvero?" (D-067), on `completed` and `failed`: the verdict and each
   * criterion of the brief checked on the log of the vault and by the instinct.
   */
  check: z
    .object({
      verdict: DelegationVerdictSchema,
      criteria: z.array(ReceiptCriterionSchema),
      /** The sub-agent got the reminder and more steps. */
      retried: z.boolean().optional(),
    })
    .optional(),
  /** `provider:model` that served the sub-agent last (pagella dei mostri). */
  model: z.string().optional(),
  /** Model tier of the turn (`light`, `strong`): see the `tier` use. */
  tier: z.enum(['light', 'strong']).optional(),
  /** Level of the delegation (D-109: its subtask's, or the request's), Medium included. */
  level: z.enum(['simple', 'medium', 'hard']).optional(),
  /** Effort the sub-agent worked at, only in "Automatica" (D-110). */
  effort: EffortSchema.optional(),
  steps: z.number().int().nonnegative().optional(),
  /** Cost of the sub-agent's model calls. */
  costUsd: z.number().nonnegative().optional(),
  /** Agent run status when it differs from the delegation's (`max_steps`…). */
  runStatus: z.string().optional(),
  /** With a limit as `runStatus`: which cap stopped the agent (older events have none). */
  limit: LimitReasonSchema.optional(),
});

export const ToolCallDataSchema = z.object({
  callId: z.string().min(1),
  tool: z.string().min(1),
  input: z.unknown(),
  /**
   * What the runtime fixed in a malformed call before running it (`name`,
   * `json`, `keys`, `values`): counted by the eval (D-064).
   */
  repaired: z.array(z.string()).optional(),
});

export const ToolResultDataSchema = z.object({
  callId: z.string().min(1),
  tool: z.string().min(1),
  ok: z.boolean(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  /** The same read-only call was already made: the earlier result was given again (D-064). */
  repeated: z.boolean().optional(),
  /**
   * A tool of a harness refused by the run's setup, never by the user (D-127):
   * `not_in_run`, a built-in the run does not have; `monsters_rule`, a fixed
   * rule of Monsters (its data, the harness configuration, a closed folder).
   */
  refusal: z.enum(['not_in_run', 'monsters_rule']).optional(),
  /** Why a failed call failed, written by the core (D-132): `user_declined` is the only no of the user. */
  cause: z.enum(TOOL_FAILURE_CAUSES).optional(),
});

export const DecisionDataSchema = z.object({
  /** What was being decided (e.g. "ask_or_proceed", "route"). */
  kind: z.string().min(1),
  question: z.string(),
  options: z.array(z.string()),
  choice: z.string(),
  decidedBy: z.enum(['rules', 'model', 'user']),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
  /*
   * Instinct (D-067): what the engine said, for the dataset (Laya) and to tune
   * the thresholds. Absent on decisions of the rules alone.
   */
  /** Use of the instinct that asked (`gate`, `done_check`, …). */
  use: InstinctUseSchema.optional(),
  /** `shadow`: the answer was logged and nothing changed. */
  mode: InstinctModeSchema.optional(),
  /** Engine that answered: `jev`, `llm` (or a test port). */
  engine: z.string().optional(),
  model: z.string().optional(),
  /** noul: p of "yes"; score: the score. */
  value: z.number().optional(),
  /** `high`, `mid`, `low`: where the value falls between the two thresholds of the use. */
  band: z.enum(['high', 'mid', 'low']).optional(),
  /** What the state sent to the engine looked like (already reduced and redacted). */
  state: z.unknown().optional(),
  /** What the core did with the answer (`retry`, `warn`, `hold`, `none`…). */
  action: z.string().optional(),
  latencyMs: z.number().nonnegative().optional(),
});

/**
 * Something the instinct did that the user should read in the Activity, in
 * plain Italian ("Il lavoro di Dione non era finito: le ho chiesto di
 * completarlo"). `subject` is the monster concerned (the UI shows its face:
 * `stuck` → the confused monster).
 */
export const InstinctDataSchema = z.object({
  use: InstinctUseSchema,
  action: z.enum([
    'route_hint',
    'tier',
    'tools',
    'shortcut',
    'retry',
    'doubt',
    'stuck_notice',
    'stuck_nudge',
    'stuck_demote',
    'final_question',
    'outbound_hold',
    'outbound_approved',
    'outbound_refused',
    'outbound_marked',
    'memory_skipped',
    'chain_reordered',
    /** A monster said an access was denied or missing and the log did not back it (D-140). */
    'access_claim',
  ]),
  message: z.string(),
  subject: AgentIdSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  /** Use-specific details (the tool, the category, the new chain…). */
  details: z.record(z.string(), z.unknown()).optional(),
});

/** External text that gave orders to the agents (injection use, D-067). */
export const SecurityDataSchema = z.object({
  /**
   * `injection_removed`: a text that gave orders to the agents was removed;
   * `injection_warned` only in logs written before 16/10 (the middle band no longer reaches the user);
   * `invisible_removed` (D-070): hidden characters (Unicode tags, smuggled selectors) taken out of external text;
   * `mcp_tools_changed` (D-070): tools of an MCP server new or changed since they were accepted, paused;
   * `mcp_tools_accepted`: the user accepted them;
   * `internal_denied` (D-078): a tool of a harness wanted the data folder of Monsters, refused.
   */
  action: z.enum([
    'injection_removed',
    'injection_warned',
    'invisible_removed',
    'mcp_tools_changed',
    'mcp_tools_accepted',
    'internal_denied',
  ]),
  /** Where the text came from (`web_fetch https://…`, `mcp:browser`). */
  source: z.string(),
  tool: z.string(),
  /** Highest p of the blocks (injections). */
  p: z.number().min(0).max(1).optional(),
  /** Blocks removed (for `injection_removed`). */
  blocks: z.number().int().nonnegative().optional(),
  /** Hidden characters removed (`invisible_removed`). */
  chars: z.number().int().nonnegative().optional(),
  /** MCP server and its tools (`mcp_tools_*`): names as the server gives them. */
  server: z.string().optional(),
  tools: z.array(z.object({ name: z.string(), change: z.enum(['new', 'changed']) })).optional(),
  message: z.string(),
});

export const QuestionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

/** 2-4 options, or none: an open question answered in free text. */
export const QuestionOptionsSchema = z
  .array(QuestionOptionSchema)
  .max(4)
  .refine((o) => o.length !== 1, 'no options (open question) or 2-4 options');

export const QuestionDataSchema = z.object({
  questionId: z.string().min(1),
  question: z.string().min(1),
  options: QuestionOptionsSchema,
  recommended: z.string().optional(),
  blocking: z.boolean(),
  /**
   * `brake`: the card of one tool call ("Rhea vuole …: procedo?"); `access`: a capo asks the
   * user for an access that is missing (`access_request`, D-130); absent: `ask_user`. Both
   * `brake` and `access` are the user's in person: never answered in a group nor by the CLI.
   */
  kind: z.enum(['brake', 'access']).optional(),
});

export const AnswerDataSchema = z.object({
  questionId: z.string().min(1),
  optionId: z.string().optional(),
  text: z.string().optional(),
  channel: ChannelSchema.optional(),
  /** Who answered, when the channel is shared by several people (a Telegram group). */
  by: z.string().max(120).optional(),
  /**
   * The user's message that gave the answer (a chat message to a monster waiting on a parked
   * question): a message requeued after a restart reads the question again with it.
   */
  message: z.string().min(1).optional(),
});

/** An open question that will never be answered: its run stopped or the core restarted. */
export const QuestionExpiredDataSchema = z.object({
  questionId: z.string().min(1),
  /**
   * `kill`: kill switch; `run_aborted`: its run was stopped; `restart`: left open by a
   * previous core; `agent_archived`: the monster that asked was archived.
   */
  reason: z.enum(['kill', 'run_aborted', 'restart', 'agent_archived', 'run_ended']).optional(),
});

/**
 * A question that waits for the user without a run behind it (D-078): the
 * monster ended its turn (`harness`: Claude Code or Codex never hold a call
 * open; `timeout`: a native run waited 10 minutes; `run_ended`: its run
 * finished with the question still open; `restart`: the core restarted while
 * it waited). It stays open: the answer starts a new run of that monster.
 */
export const QuestionParkedDataSchema = z.object({
  questionId: z.string().min(1),
  reason: z.enum(['harness', 'timeout', 'run_ended', 'restart']),
});

export const VaultChangeDataSchema = z.object({
  action: z.enum(['create', 'edit', 'move', 'delete', 'restore', 'undo', 'propose']),
  path: z.string(),
  fromPath: z.string().optional(),
  /** Git commit SHA recording the change, when available. */
  commit: z.string().optional(),
  actionId: z.string().optional(),
  /** Every file touched when the action changed more than one (move with links, undo, proposals). */
  files: z.array(z.string()).optional(),
  /** For `undo`: the action that was undone (so a client can mark it after a reload). */
  undoneActionId: z.string().optional(),
});

/**
 * `provider` of the `provider_usage` of a paid web search (D-071): its cost
 * counts like a model's, but it is not a model step (no request to the
 * model's rate budget, no "model of the turn").
 */
export const WEB_SEARCH_USAGE_PROVIDER = 'web_search';

export const ProviderUsageDataSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  /** Input tokens read from the provider's prompt cache (part of `inputTokens`). */
  cachedInputTokens: z.number().int().nonnegative().optional(),
  /** Input tokens written to the provider's prompt cache (Anthropic), part of `inputTokens`. */
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  /** Model asked for when it differs from the one that answered (e.g. `openrouter/free`). */
  requestedModel: z.string().optional(),
  /** Time spent waiting for the provider's rate budget. */
  queuedMs: z.number().nonnegative().optional(),
  /** 0-based step of the agent loop. */
  step: z.number().int().nonnegative().optional(),
  /**
   * Fingerprint of the key that served the request (12 hex digits of a SHA-256,
   * never the key): a restart restores only the requests of the key in use.
   */
  keyId: z
    .string()
    .regex(/^[0-9a-f]{12}$/)
    .optional(),
  /**
   * What the request's context held, part by part, and the model's window
   * (C.1, D-075): on the steps of the monsters, not on the instinct's calls or
   * the paid searches.
   */
  context: ContextUsageSchema.optional(),
  /**
   * A request that is not a step of the monster (C.3, D-082): `compaction`
   * wrote the summary of its conversation. Its cost counts; it is not the
   * model of the turn.
   */
  purpose: z.enum(['compaction']).optional(),
  /**
   * Monsters counted part of it (F-A4, D-114): the cost from the tokens and
   * the price list, when the provider reports none; on a `partial` request
   * also the tokens it never reported (input as measured, output from the
   * characters received).
   */
  estimated: z.literal(true).optional(),
  /**
   * A request without the provider's final count, billed all the same (F-A4):
   * `interrupted` (the stream broke after the answer started, asked again or
   * failed), `aborted` (stopped by the user or the kill switch), `abandoned`
   * (given up before the answer: empty, too slow, an error after reasoning).
   */
  partial: z.enum(['interrupted', 'aborted', 'abandoned']).optional(),
  /**
   * The project the run worked for (D-097), null outside any project: the
   * project's spending counts what its runs spent, not what its monsters
   * spend now (F-B13). Missing on older events: they count by membership.
   */
  project: ProjectIdSchema.nullable().optional(),
});

export const ErrorDataSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  /** With `run_limit`, `token_limit` and `max_steps`: which cap stopped the job. */
  limit: LimitReasonSchema.optional(),
  stack: z.string().optional(),
  /**
   * `provider_fallback` from a harness (D-093): the plan's limit on one model,
   * the same request on the next one of the same plan (`claude-agent:opus` →
   * `claude-agent:sonnet`).
   */
  fallback: z
    .object({ from: z.string(), to: z.string(), reason: z.enum(['usage_limit']) })
    .optional(),
});

export const KillScopeSchema = z.enum(['global', 'run', 'agent', 'tool']);
export type KillScope = z.infer<typeof KillScopeSchema>;

export const KillDataSchema = z.object({
  scope: KillScopeSchema,
  /** Id of the run/agent/tool call when the scope is not global. */
  target: z.string().optional(),
  reason: z.string().optional(),
  by: ChannelSchema,
  runsAborted: z.number().int().nonnegative().optional(),
  processesKilled: z.number().int().nonnegative().optional(),
});

export const ResumeDataSchema = z.object({
  by: ChannelSchema,
});

/**
 * `waiting_user` (D-078): the run ended with a question of its monster still
 * open (parked): the monster waits for the user, the answer starts a new run.
 */
export const RunStatusSchema = z.enum([
  'started',
  'completed',
  'failed',
  'aborted',
  'waiting_user',
]);

export const RunDataSchema = z.object({
  status: RunStatusSchema,
  goal: z.string().optional(),
  error: z.string().optional(),
  /**
   * Why a run was aborted when nobody stopped it: `restart`, left open by a
   * core that crashed; `shutdown`, the core was closed while it ran (D-078:
   * its questions stay open for the user).
   */
  reason: z.enum(['restart', 'shutdown']).optional(),
  /**
   * On the end of a run: it had read third-party text, or inherited it (a
   * message, a report, a summary, a file, D-103). Absent on older events:
   * their `tool_call` events say it instead.
   */
  tainted: z.literal(true).optional(),
  /** The first source of that text (`web_fetch`, `rapporto di un progetto`…). */
  taintSource: z.string().max(200).optional(),
  /**
   * On the start of a run: the Telegram chat of a dedicated bot it works for
   * (`telegramThread`, D-107). Its turns are the history of that chat, not
   * of the monster's chat in the app, and its answers go back there.
   */
  thread: z.string().max(120).optional(),
});

/**
 * The user starts a new conversation: the turns before this event no longer
 * reach the model's context (they stay in the log). Without `to` it is the
 * general conversation, so it applies to every agent (the orchestrator and
 * the direct `@Name` conversations); with `to` only to that agent.
 */
export const NewConversationDataSchema = z.object({
  /** Agent whose direct conversation starts over; omitted → every conversation. */
  to: AgentIdSchema.optional(),
  channel: ChannelSchema.optional(),
});

/**
 * The older part of a monster's conversation summarised (C.3 of the plan of
 * 16/10, D-082): written by the core when the turns since the latest
 * `new_conversation` no longer fit (more than `conversationTurns`, or past
 * `CONTEXT_COMPACT_AT` of the model's window). It covers the turns up to `to`
 * (inclusive) and, when `previous` is set, everything that summary covered:
 * the next runs send it instead of those turns, until a new one replaces it.
 * `agent` is the monster whose conversation it is.
 */
export const ConversationSummaryDataSchema = z.object({
  /** The summary, in Italian, as the monster reads it. */
  text: z.string().min(1).max(12_000),
  /** First event (message or answer) covered by this summary or the ones before it. */
  from: UlidSchema,
  /** Last event covered (inclusive): the turns after it are sent as they are. */
  to: UlidSchema,
  /** Turns (messages of the user and answers of the monster) covered in all. */
  turns: z.number().int().positive(),
  /** The summary this one extends (recursive: old summary + newer turns). */
  previous: UlidSchema.optional(),
  /** Why it was written: too many turns, or the context near the window. */
  reason: z.enum(['turns', 'context']),
  /** The model that wrote it. */
  provider: z.string().optional(),
  model: z.string().optional(),
  /**
   * A run it covers (or the summary it extends) read third-party text (web,
   * other programs): an instruction hidden there may live on in it, so the
   * run that reads it starts tainted (D-070, review of D-082).
   */
  tainted: z.boolean().optional(),
});
export type ConversationSummaryData = z.infer<typeof ConversationSummaryDataSchema>;

export const AuthDataSchema = z.object({
  action: z.enum([
    'setup',
    'login',
    'login_failed',
    'logout',
    'cli_token_issued',
    // Single-use login tokens of the desktop app (M3.1, D-045).
    'login_token_issued',
    'login_token',
    'login_token_failed',
    // Password changed from the settings (old one verified) or reset with `monsters password`.
    'password_changed',
    'password_change_failed',
    'password_reset',
    // "Conferma che sei tu": the password typed again in a session (review of 18/10, M1).
    'confirmed',
    'confirm_failed',
  ]),
  channel: ChannelSchema.optional(),
});

/**
 * The user changed what agents may do (settings, M2.1): `target` is an agent
 * id or `defaults` (the team's); `permissions: null` gives the agent the
 * team's defaults back.
 */
export const PermissionsDataSchema = z.object({
  target: z.string().min(1),
  permissions: z
    .object({
      vault: z.boolean(),
      web: z.boolean(),
      shell: z.boolean(),
      folders: z.array(z.object({ path: z.string(), write: z.boolean() })),
    })
    .nullable(),
  by: ChannelSchema,
});

/**
 * The user changed the team or the profile after the onboarding (Settings →
 * Squadra). `agent` is the id of the monster (stable: the name is only shown),
 * `name` its name after the change, `from` the name before a rename; `fields`
 * says what changed for `edit` and `profile`.
 */
export const TeamChangeDataSchema = z.object({
  action: z.enum(['add', 'rename', 'edit', 'look', 'archive', 'restore', 'profile']),
  agent: AgentIdSchema.optional(),
  name: z.string().optional(),
  from: z.string().optional(),
  fields: z.array(z.string()).optional(),
  by: ChannelSchema,
});

/**
 * The runtime kept the memory of an agent (D-065): `remembered`, lines of a
 * «Da ricordare:» section appended to its MEMORY.md; `over_limit`, the note is
 * longer than the prompt takes, and only its newest lines are shown.
 * `proposed`: lines of a run that read third-party text, that a person who is
 * not the user asked for or of a Telegram chat, waiting for the user (a draft,
 * review of 18/10, A2); `remembered` with `proposalId` confirms it,
 * `discarded` leaves it aside.
 */
export const MemoryDataSchema = z.object({
  /** `owned`: the user said marked lines are theirs (`lines`), the mark is gone. */
  action: z.enum(['remembered', 'over_limit', 'proposed', 'discarded', 'owned']),
  /** The agent's MEMORY.md. */
  path: z.string(),
  /** `remembered`: the lines added; `proposed`: the lines that wait. */
  lines: z.array(z.string()).optional(),
  /** `proposed`: why the lines wait for the user (the third-party text, the person who asked). */
  source: z.string().optional(),
  /** `proposed`: the lines carry third-party text: saved with the mark (`MEMORY_TAINT_MARK`). */
  tainted: z.literal(true).optional(),
  /** `remembered`, `discarded`: the proposal answered. */
  proposalId: z.string().optional(),
  /** `discarded` by the system: the draft expired, past the open drafts of a monster. */
  expired: z.literal(true).optional(),
  by: ChannelSchema.optional(),
  /** `over_limit`: length of the note and characters left out of the prompt. */
  chars: z.number().int().nonnegative().optional(),
  dropped: z.number().int().nonnegative().optional(),
});

/**
 * Something happened on a remote channel (M2.6, Telegram): the bot connected
 * or lost the connection, an account was paired or removed, a message was
 * ignored (not in the whitelist, a group, forwarded…). Never the token or a
 * long content: at most a short `preview`.
 */
export const ChannelDataSchema = z.object({
  channel: ChannelSchema,
  action: z.enum([
    'connected',
    'disconnected',
    'ignored',
    'paired',
    'pairing_failed',
    'pairing_started',
    'user_removed',
    'token_set',
    'token_removed',
    // A pasted token could not be checked: `reason` is the kind (network.ts), `message` the cause.
    'token_check_failed',
    // Bots dedicated to one monster (D-107).
    'bot_added',
    'bot_removed',
    'bot_changed',
    'chat_pending',
    'chat_approved',
    'chat_removed',
    'person_pending',
    'person_approved',
    'person_removed',
    'limit_reached',
    // The bot was removed from a group, or blocked: its replies there stop.
    'chat_left',
    // A group became a supergroup: it keeps its approval under the new id.
    'chat_migrated',
  ]),
  /** The dedicated bot (its entry id), when the event is one of theirs (D-107). */
  bot: z.string().max(32).optional(),
  /** The Telegram chat (a group) the event is about (D-107). */
  chatId: z.string().max(32).optional(),
  /** Id of the account on that channel (Telegram user id). */
  userId: z.string().optional(),
  /** Display name or @username of the account. */
  name: z.string().optional(),
  /** Why it was ignored or failed (`not_whitelisted`, `not_private`, `forwarded`, `wrong_code`…). */
  reason: z.string().optional(),
  /** First characters of an ignored message. */
  preview: z.string().max(80).optional(),
  message: z.string().optional(),
});

/**
 * A new monster proposed by the capo squadra (`team_propose_monster`, D-075):
 * `proposed` carries the draft, as the team's draft flow builds it (the id of
 * the proposal is the id of this event); `created` and `discarded` are the
 * user's answer from the chat card, by `user`, with `proposalId`. Nothing is
 * created without the user.
 */
export const MonsterProposalDataSchema = z.object({
  action: z.enum(['proposed', 'created', 'discarded']),
  /** The capo squadra that proposed it. */
  from: AgentIdSchema,
  /** `proposed`: the project the monster would join (proposed by its lead, D-097). */
  project: ProjectIdSchema.optional(),
  /** `created`, `discarded`: the `proposed` event. */
  proposalId: UlidSchema.optional(),
  /** `proposed`: the monster to add. */
  draft: TeamDraftSchema.optional(),
  /** `proposed`: the models it would use; absent, the capo squadra's. */
  models: z.array(z.object({ provider: z.string(), model: z.string() })).optional(),
  /** `created`: the new monster (its name may differ from the draft's). */
  agent: AgentIdSchema.optional(),
  name: z.string().optional(),
  by: ChannelSchema.optional(),
});

/** CLAUDE.md and AGENTS.md at the top of a project's folder: what a monster may propose (D-113). */
export const PROJECT_DOC_PROPOSAL_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;
/** Bytes of a proposed file at most (D-113). */
export const MAX_PROJECT_DOC_BYTES = 32 * 1024;
/** Bytes of a current file read at most: a bigger one is not changed with a proposal (D-113). */
export const MAX_PROJECT_DOC_READ_BYTES = 1024 * 1024;

/**
 * A change to CLAUDE.md or AGENTS.md of a project's folder proposed by a
 * monster of the project or by the orchestrator (`project_docs_propose`,
 * D-113). `proposed` carries the whole new text and the hash of the file it
 * was written on (the id of the proposal is the id of this event); the user
 * answers with `applied` (the core writes the file) or `discarded`, by
 * `user`; a new proposal of the same monster for the same file closes the
 * old one as `superseded`. Nothing is written without the user.
 */
export const ProjectDocsProposalDataSchema = z.object({
  action: z.enum(['proposed', 'applied', 'discarded', 'superseded']),
  project: ProjectIdSchema,
  /** The project's name when the event was written. */
  name: z.string(),
  file: z.enum(PROJECT_DOC_PROPOSAL_FILES),
  /** The monster that proposed it. */
  from: AgentIdSchema,
  /** `proposed`: the whole new text of the file. */
  content: z.string().max(MAX_PROJECT_DOC_BYTES).optional(),
  /** `proposed`: sha256 (hex) of the file's bytes when proposed; null, it was not there. */
  baseHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable()
    .optional(),
  /** `proposed`: why, one line in the user's language. */
  reason: z.string().max(300).optional(),
  /** `proposed`: the project's folder it was written for (moved since: it cannot be applied). */
  folder: z.string().max(1000).optional(),
  /** `proposed`: the run had read third-party text (D-103). */
  tainted: z.literal(true).optional(),
  taintSource: z.string().max(200).optional(),
  /** `applied`, `discarded`, `superseded`: the `proposed` event. */
  proposalId: UlidSchema.optional(),
  by: ChannelSchema.optional(),
});

/**
 * A monster shows the user something in the preview pane (`preview_show`,
 * plan of 16/10 feature 4, D-075): a note or a file, already checked against
 * what that monster may read. The web app opens it next to the chat of the
 * run's owner when that chat is on screen; the chat keeps a chip either way.
 */
export const PreviewDataSchema = z.object({
  item: PreviewItemSchema,
  /** What the chip says: the file's name or the note's title. */
  name: z.string().min(1).max(200),
  /** The file's kind, for the chip's icon (absent for notes). */
  fileKind: FileKindSchema.optional(),
  /** One line from the monster: why it shows it. */
  caption: z.string().max(200).optional(),
  /**
   * An HTML page served without scripts (`FileMeta.inert`, D-085): the app
   * never opens it by itself, the chip in the chat is enough.
   */
  inert: z.literal(true).optional(),
});
export type PreviewData = z.infer<typeof PreviewDataSchema>;

/*
 * Automations (D-094). A run of an automation ("giro") is one or more runs of
 * the core: the first one's id is `giro`, an answer to a question of it starts
 * the next one (`continues`). The envelope's `runId` is the run of the core.
 */

/** A run of an automation starts (before its `run started`); `agent` is the capo. */
export const AutomationRunStartedDataSchema = z.object({
  automationId: AutomationIdSchema,
  name: z.string(),
  giro: RunIdSchema,
  trigger: AutomationTriggerSchema,
  /** The slot it is for (epoch ms); absent for "Esegui ora". */
  slot: z.number().int().nonnegative().optional(),
  /** The run of the same giro it goes on from (an answer to its question). */
  continues: RunIdSchema.optional(),
});

/**
 * A run of an automation ended: `waiting_user` it waits for an answer (the
 * giro is not over), the others close the giro. Carries what the menu shows.
 */
export const AutomationRunFinishedDataSchema = z.object({
  automationId: AutomationIdSchema,
  name: z.string(),
  giro: RunIdSchema,
  status: AutomationRunEndSchema,
  error: z.string().optional(),
  /** Totals of the giro so far (every run of it). */
  costUsd: z.number().nonnegative().optional(),
  steps: z.number().int().nonnegative().optional(),
  tokens: z.number().int().nonnegative().optional(),
  /** Notes created or changed, files made. */
  notes: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  /** The capo's last answer, short (the notice of the app). */
  summary: z.string().max(600).optional(),
  /** Where the end is announced: the app shows a notice when `app`. */
  notify: AutomationNotifySchema.optional(),
});

/** A slot of an automation that did not run, and why. */
export const AutomationRunSkippedDataSchema = z.object({
  automationId: AutomationIdSchema,
  name: z.string(),
  trigger: AutomationTriggerSchema,
  slot: z.number().int().nonnegative().optional(),
  reason: AutomationSkipReasonSchema,
  message: z.string(),
  /** Slots missed while the core was off (this one included). */
  missed: z.number().int().positive().optional(),
});

/** The user (or a monster's proposal) created or changed an automation. */
export const AutomationChangeDataSchema = z.object({
  /** `discarded`: a draft left aside by the user (D-098), its file removed. */
  action: z.enum(['created', 'updated', 'deleted', 'paused', 'resumed', 'confirmed', 'discarded']),
  automationId: AutomationIdSchema,
  name: z.string(),
  by: ChannelSchema.optional(),
  /**
   * A draft proposed by a monster (`automation_propose`, D-098): `created`
   * with `status: 'draft'`, then `confirmed` or `discarded`, all with `from`
   * (the monster reads the outcome at its next turn).
   */
  from: AgentIdSchema.optional(),
  status: AutomationStatusSchema.optional(),
});

/**
 * A project was created, changed, confirmed (a draft made active), archived,
 * or a monster joined or left it (D-097).
 */
export const ProjectChangeDataSchema = z.object({
  action: z.enum([
    'created',
    'updated',
    'confirmed',
    'archived',
    'member_added',
    'member_removed',
    /** A draft left aside by the user (D-098): its file is removed. */
    'discarded',
    /** An archived project came back with its monsters (D-098). */
    'restored',
    /** "Ferma progetto" (D-098): the runs of its monsters stopped. */
    'stopped',
    /** CLAUDE.md and AGENTS.md of the folder approved by the user as they are (D-103). */
    'docs_approved',
  ]),
  project: ProjectIdSchema,
  name: z.string(),
  /** `member_added`, `member_removed`: the monster. */
  agent: AgentIdSchema.optional(),
  by: ChannelSchema.optional(),
  /**
   * A draft proposed by a monster (`project_propose`, D-098): `created` with
   * `status: 'draft'`, then `confirmed` or `discarded`, with `from`.
   */
  from: AgentIdSchema.optional(),
  status: z.enum(['draft', 'active']).optional(),
  /** `archived`: the monsters archived with it (a restore brings them back); `restored`, `confirmed`: the monsters now in it. */
  agents: z.array(AgentIdSchema).optional(),
  /** `stopped`: how many runs stopped. */
  runs: z.number().int().nonnegative().optional(),
  /** `archived`: its automations that were active and are paused with it (a restore resumes them, D-103). */
  automations: z.array(z.string().min(1).max(64)).optional(),
});

/**
 * The lead of a project finished the work the orchestrator sent it with
 * `project_send` (D-097): its last answer goes back to the orchestrator,
 * which reads it at its next turn and with `project_status`.
 */
export const ProjectReportDataSchema = z.object({
  project: ProjectIdSchema,
  /** The project's lead. */
  lead: AgentIdSchema,
  /** The orchestrator that sent the work. */
  to: AgentIdSchema,
  /** The `message` event of `project_send`. */
  request: UlidSchema,
  status: z.enum(['completed', 'failed', 'aborted', 'waiting_user']),
  /** The lead's last answer, short. */
  summary: z.string().max(3000),
  /**
   * Why it stopped without an answer (D-098): `restart` the core closed while
   * the lead worked on it, `stopped` "Ferma progetto" or the kill switch
   * dropped it before it started.
   */
  reason: z.enum(['restart', 'stopped']).optional(),
});

/**
 * Bulky events older than the archive's days moved out of the log into the monthly files
 * (`monsters log archive`, or the core's daily pass): the log keeps a note of what left it
 * and where (`dir/events-YYYY-MM.jsonl.gz`).
 */
export const LogArchiveDataSchema = z.object({
  events: z.number().int().nonnegative(),
  /** Events older than this (epoch ms) were looked at. */
  before: z.number().int(),
  months: z.array(z.object({ month: z.string(), events: z.number().int().nonnegative() })),
  dir: z.string(),
  by: ChannelSchema,
});

/**
 * An access a capo asked for with `access_request` (D-130): the user's tap
 * on "Sì, concedi" (`granted`, the core applied it), on "No" (`denied`), or a
 * grant that could not be applied any more (`failed`, `message` says why).
 * Written by `user` (granted, denied) or `system` (failed).
 */
export const AccessGrantDataSchema = z.object({
  questionId: z.string().min(1),
  /** The monster that asked. */
  from: AgentIdSchema,
  outcome: z.enum(['granted', 'denied', 'failed']),
  /** What it gives, in Italian: "a Pixel il web", "Canva al progetto «Progetto Social»". */
  summary: z.string().min(1).max(500),
  message: z.string().max(500).optional(),
  by: ChannelSchema.optional(),
});
export type AccessGrantData = z.infer<typeof AccessGrantDataSchema>;

/** Data schema for each event type. */
export const EventDataSchemas = {
  message: MessageDataSchema,
  delegation: DelegationDataSchema,
  tool_call: ToolCallDataSchema,
  tool_result: ToolResultDataSchema,
  decision: DecisionDataSchema,
  question: QuestionDataSchema,
  answer: AnswerDataSchema,
  question_expired: QuestionExpiredDataSchema,
  question_parked: QuestionParkedDataSchema,
  new_conversation: NewConversationDataSchema,
  conversation_summary: ConversationSummaryDataSchema,
  vault_change: VaultChangeDataSchema,
  provider_usage: ProviderUsageDataSchema,
  error: ErrorDataSchema,
  kill: KillDataSchema,
  resume: ResumeDataSchema,
  run: RunDataSchema,
  auth: AuthDataSchema,
  permissions: PermissionsDataSchema,
  team_change: TeamChangeDataSchema,
  channel: ChannelDataSchema,
  mcp_server: McpServerDataSchema,
  memory: MemoryDataSchema,
  instinct: InstinctDataSchema,
  security: SecurityDataSchema,
  receipt: ReceiptDataSchema,
  spend: SpendDataSchema,
  monster_proposal: MonsterProposalDataSchema,
  project_docs_proposal: ProjectDocsProposalDataSchema,
  preview: PreviewDataSchema,
  file: FileEventDataSchema,
  automation_run_started: AutomationRunStartedDataSchema,
  automation_run_finished: AutomationRunFinishedDataSchema,
  automation_run_skipped: AutomationRunSkippedDataSchema,
  automation_change: AutomationChangeDataSchema,
  project_change: ProjectChangeDataSchema,
  project_report: ProjectReportDataSchema,
  log_archive: LogArchiveDataSchema,
  access_grant: AccessGrantDataSchema,
} as const;

export type EventDataMap = {
  [K in keyof typeof EventDataSchemas]: z.infer<(typeof EventDataSchemas)[K]>;
};
export type EventType = keyof EventDataMap;

export const EVENT_TYPES = Object.keys(EventDataSchemas) as EventType[];
export const EventTypeSchema = z.enum(EVENT_TYPES as [EventType, ...EventType[]]);

const envelope = {
  agent: ActorSchema,
  runId: RunIdSchema.nullable().optional(),
  parentId: UlidSchema.nullable().optional(),
};

const storedEnvelope = {
  id: UlidSchema,
  ts: z.number().int().nonnegative(),
  agent: ActorSchema,
  runId: RunIdSchema.nullable(),
  parentId: UlidSchema.nullable(),
};

function inputVariant<T extends EventType>(type: T) {
  return z.object({ ...envelope, type: z.literal(type), data: EventDataSchemas[type] });
}

function storedVariant<T extends EventType>(type: T) {
  return z.object({ ...storedEnvelope, type: z.literal(type), data: EventDataSchemas[type] });
}

/** What a producer passes to `EventLog.append`: id and timestamp are assigned by the log. */
export const EventInputSchema = z.discriminatedUnion('type', [
  inputVariant('message'),
  inputVariant('delegation'),
  inputVariant('tool_call'),
  inputVariant('tool_result'),
  inputVariant('decision'),
  inputVariant('question'),
  inputVariant('answer'),
  inputVariant('question_expired'),
  inputVariant('question_parked'),
  inputVariant('new_conversation'),
  inputVariant('conversation_summary'),
  inputVariant('vault_change'),
  inputVariant('provider_usage'),
  inputVariant('error'),
  inputVariant('kill'),
  inputVariant('resume'),
  inputVariant('run'),
  inputVariant('auth'),
  inputVariant('permissions'),
  inputVariant('team_change'),
  inputVariant('channel'),
  inputVariant('mcp_server'),
  inputVariant('memory'),
  inputVariant('instinct'),
  inputVariant('security'),
  inputVariant('receipt'),
  inputVariant('spend'),
  inputVariant('monster_proposal'),
  inputVariant('project_docs_proposal'),
  inputVariant('preview'),
  inputVariant('file'),
  inputVariant('automation_run_started'),
  inputVariant('automation_run_finished'),
  inputVariant('automation_run_skipped'),
  inputVariant('automation_change'),
  inputVariant('project_change'),
  inputVariant('project_report'),
  inputVariant('log_archive'),
  inputVariant('access_grant'),
]);

/** An event as stored in the log and sent on the stream. */
export const LogEventSchema = z.discriminatedUnion('type', [
  storedVariant('message'),
  storedVariant('delegation'),
  storedVariant('tool_call'),
  storedVariant('tool_result'),
  storedVariant('decision'),
  storedVariant('question'),
  storedVariant('answer'),
  storedVariant('question_expired'),
  storedVariant('question_parked'),
  storedVariant('new_conversation'),
  storedVariant('conversation_summary'),
  storedVariant('vault_change'),
  storedVariant('provider_usage'),
  storedVariant('error'),
  storedVariant('kill'),
  storedVariant('resume'),
  storedVariant('run'),
  storedVariant('auth'),
  storedVariant('permissions'),
  storedVariant('team_change'),
  storedVariant('channel'),
  storedVariant('mcp_server'),
  storedVariant('memory'),
  storedVariant('instinct'),
  storedVariant('security'),
  storedVariant('receipt'),
  storedVariant('spend'),
  storedVariant('monster_proposal'),
  storedVariant('project_docs_proposal'),
  storedVariant('preview'),
  storedVariant('file'),
  storedVariant('automation_run_started'),
  storedVariant('automation_run_finished'),
  storedVariant('automation_run_skipped'),
  storedVariant('automation_change'),
  storedVariant('project_change'),
  storedVariant('project_report'),
  storedVariant('log_archive'),
  storedVariant('access_grant'),
]);

export interface EventEnvelope {
  id: string;
  /** Unix epoch in milliseconds. */
  ts: number;
  agent: string;
  runId: string | null;
  parentId: string | null;
}

/** A stored event; narrow with `T` (or by checking `type`) to get typed `data`. */
export type LogEvent<T extends EventType = EventType> = {
  [K in T]: EventEnvelope & { type: K; data: EventDataMap[K] };
}[T];

/** Input accepted by `EventLog.append`. */
export type EventInput<T extends EventType = EventType> = {
  [K in T]: {
    agent: string;
    runId?: string | null;
    parentId?: string | null;
    type: K;
    data: EventDataMap[K];
  };
}[T];
