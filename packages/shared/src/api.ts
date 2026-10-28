import { z } from 'zod';
import { AgentAreaSchema, AgentDutySchema, MAX_DUTIES } from './agent-area.ts';
import { EventTypeSchema, LogEventSchema } from './events.ts';
import { MESSAGE_MAX_ATTACHMENTS } from './files.ts';
import { MESSAGE_MAX_CHARS, RESUME_EXTRA_CHARS } from './halted.ts';
import { LangSchema } from './i18n.ts';
import { AgentIdSchema, EmailSchema } from './ids.ts';
import { UlidSchema } from './ulid.ts';
import { VaultLayoutIdSchema } from './vault-layout.ts';

/** Minimum password length for the local user. */
export const PASSWORD_MIN_LENGTH = 8;

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(1024);

/**
 * Header with the secret of a browser's session (S-B13), on every request authenticated by the
 * session cookie. Cookies do not tell ports apart: every other service on `127.0.0.1` the
 * browser visits receives the cookie, never this secret (kept by the UI in its tab). The
 * WebSocket gets it in its first message (`StreamAuthMessage`), the bytes of a file loaded by
 * an `<img>` or an `<iframe>` a ticket in the URL (`FILE_TICKET_PARAM`). A session of the
 * desktop app (its own cookie jar, D-044) has no secret.
 */
export const SESSION_SECRET_HEADER = 'X-Monsters-Session';

/** First message of the UI on `/api/stream` for a session bound to a secret (S-B13). */
export const StreamAuthMessageSchema = z.object({
  kind: z.literal('auth'),
  secret: z.string().min(1).max(200),
});
export type StreamAuthMessage = z.infer<typeof StreamAuthMessageSchema>;

/**
 * `partitioned`: the client keeps the session cookie in a jar no other site shares (the
 * desktop app, D-044), so the session is not bound to a secret.
 */
const PartitionedSchema = z.boolean().optional();

export const SetupRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  /** One-time code printed by `monsters start` (format XXXX-XXXX-XXXX). */
  setupCode: z.string().min(1).max(64),
  partitioned: PartitionedSchema,
  /** The app's language chosen on the first screen (D-153); absent: the one the core resolved. */
  language: LangSchema.optional(),
});
export type SetupRequest = z.infer<typeof SetupRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(1024),
  partitioned: PartitionedSchema,
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * Answer of `POST /api/setup` and `POST /api/login`: `sessionSecret` (S-B13) is what the UI
 * sends in `SESSION_SECRET_HEADER`; absent for a `partitioned` session.
 */
export const SessionResponseSchema = z.object({
  email: z.string(),
  sessionSecret: z.string().optional(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

/**
 * `POST /api/auth/confirm` ("Conferma che sei tu"): the password again, in the session that
 * asks. 403 `owner_required` (a session the CLI token opened) or `confirm_required` (the
 * password not typed in the last minutes, before the most sensitive changes) ask for it.
 */
export const ConfirmRequestSchema = z.object({ password: z.string().min(1).max(1024) });
export type ConfirmRequest = z.infer<typeof ConfirmRequestSchema>;

export const SetupStatusResponseSchema = z.object({
  needsSetup: z.boolean(),
  /** The app's language (D-153), also before sign-in; absent from older cores. */
  language: LangSchema.optional(),
  /** The names of the vault's folders (D-154: `it`, `en`); absent from older cores (Italian). */
  vaultLayout: VaultLayoutIdSchema.optional(),
});
export type SetupStatusResponse = z.infer<typeof SetupStatusResponseSchema>;

export const MeResponseSchema = z.object({
  email: z.string(),
  via: z.enum(['session', 'token']),
  /**
   * The user in person (a session opened with the password, or by the app): false for the
   * CLI token and the sessions it opened. Approvals, permissions, caps and Telegram need it
   * (403 `owner_required`); the UI asks the password again. Absent from older cores.
   */
  owner: z.boolean().optional(),
  /**
   * The password was typed in this session in the last minutes (or the desktop app opened it
   * on its own core): the most sensitive changes need it (403 `confirm_required`).
   */
  recent: z.boolean().optional(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const RunSummarySchema = z.object({
  id: z.string(),
  agent: z.string(),
  goal: z.string().optional(),
  startedAt: z.number(),
  pendingCalls: z.number().int().nonnegative(),
  processes: z.number().int().nonnegative(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const StatusResponseSchema = z.object({
  version: z.string(),
  halted: z.boolean(),
  haltedAt: z.number().nullable(),
  haltedReason: z.string().nullable(),
  runs: z.array(RunSummarySchema),
  uptimeMs: z.number(),
});
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

export const KillRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type KillRequest = z.infer<typeof KillRequestSchema>;

/** `POST /api/resume`: `continue` also starts again the work the latest Ferma stopped (D-072). */
export const ResumeRequestSchema = z.object({
  continue: z.boolean().optional(),
});
export type ResumeRequest = z.infer<typeof ResumeRequestSchema>;

export const ResumeResponseSchema = StatusResponseSchema.extend({
  /** False when the monsters were not stopped. */
  resumed: z.boolean().optional(),
  /** With `continue`: the runs started again, one per stopped request. */
  continued: z
    .array(z.object({ runId: z.string(), agent: z.string(), resumeOf: z.string() }))
    .optional(),
});
export type ResumeResponse = z.infer<typeof ResumeResponseSchema>;

/** Query string accepted by `GET /api/events`. Lists are comma-separated. */
export const EventsQuerySchema = z.object({
  agent: z.string().optional(),
  type: z.string().optional(),
  runId: z.string().optional(),
  since: z.coerce.number().int().nonnegative().optional(),
  until: z.coerce.number().int().nonnegative().optional(),
  after: UlidSchema.optional(),
  before: UlidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
export type EventsQuery = z.infer<typeof EventsQuerySchema>;

export const EventTypeListSchema = z.array(EventTypeSchema);

export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  /** `conflict` of an undo: the files changed after the action. */
  files: z.array(z.string()).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * How often the core sends `{ kind: 'ping' }` on the stream. The protocol-level ping is answered by
 * the browser on its own and says nothing to the page, so the page listens for this one: silence
 * for a few of these means the socket is dead (sleep, Wi-Fi change) and it reconnects.
 */
export const STREAM_HEARTBEAT_MS = 30_000;

/**
 * Messages sent by the core on the `/api/stream` WebSocket. `ping` is the application heartbeat
 * (`STREAM_HEARTBEAT_MS`); a client that does not know it ignores it, like any unknown kind.
 */
export const StreamMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hello'), halted: z.boolean() }),
  z.object({ kind: z.literal('event'), event: LogEventSchema }),
  z.object({ kind: z.literal('replay_done'), count: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('ping') }),
]);
export type StreamMessage = z.infer<typeof StreamMessageSchema>;

/*
 * Team and conversation API (M1.3 core, M1.5 UI). State-changing requests made with
 * the session cookie must send `Content-Type: application/json` and the anti-CSRF
 * header `X-Monsters-Request: 1`.
 *
 *   GET  /api/agents                      → AgentSummary[]
 *   POST /api/messages                    SendMessageRequest → SendMessageResponse
 *   GET  /api/questions?status=open       → Question[]
 *   POST /api/questions/:id/answer        AnswerRequest → Question
 *   POST /api/conversations               NewConversationRequest → NewConversationResponse (201)
 *                                         (logs `new_conversation`: older turns stay in the log
 *                                         but no longer reach the model; allowed while halted)
 *   POST /api/agents/:id/stop             → AgentStopResponse ("Stop" in one monster's chat, F-1:
 *                                         its work stops, not the kill switch; 200 with
 *                                         `stopped: 0` when nothing ran)
 *   POST /api/vault/undo                  UndoRequest → UndoResponse
 *   POST /api/vault/reindex               → { ok: true, files, ms, vault }
 *   POST /api/vault/tools/:name           { input, client? } → { ok, output | error } (MCP server)
 *   GET  /api/settings                    → SettingsResponse
 *   PUT  /api/settings/openrouter-key     OpenRouterKeyRequest → OpenRouterKeyResponse
 *                                         (verified with OpenRouter; the key never comes back)
 *   PUT  /api/settings/openrouter         OpenRouterSettingsRequest → SettingsResponse
 *                                         (paid models on or off, applied at once)
 *   PUT  /api/settings/brave-key          BraveKeyRequest → { ok: true }
 *                                         (optional web search key; never comes back)
 *
 * Errors of the setup (`POST /api/setup`): 403 `invalid_setup_code`, 409
 * `already_configured`, 400 `invalid_request`. Login: 401 `invalid_credentials`,
 * 429 `too_many_attempts`.
 * Team: 409 `halted` (kill switch engaged), 409 `no_provider` (no model configured),
 * 409 `onboarding_pending` (no team until the first start is completed in the UI), 404 `unknown_agent`, 404 `not_found`, 409 `not_open` (question already answered or
 * expired), 400 `invalid_option`; new conversation: 409 `busy` (an agent it applies to is
 * still working: wait for it or stop it), 404 `unknown_agent`. Undo: 404 `not_found`, 409 `conflict` (with `files` changed after the action; retry with
 * `force: true` to undo anyway), 400
 * `invalid_input` (e.g. already undone). OpenRouter key: 400 `invalid_key`, 502
 * `verification_failed` (OpenRouter unreachable or unexpected answer).
 *
 * Live updates arrive as log events on the `/api/stream` WebSocket: a question that
 * will never be answered is closed by a `question_expired` event, an undo carries
 * `undoneActionId` in its `vault_change` event.
 */

export const AgentStateSchema = z.enum(['idle', 'working', 'waiting', 'error', 'stopped']);
export type AgentState = z.infer<typeof AgentStateSchema>;

export const AgentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** One-line role, shown under the monster. */
  role: z.string(),
  /** CSS colour of the agent (bubbles, accents). */
  color: z.string(),
  isOrchestrator: z.boolean(),
  /** MonsterGenome from `@monsters/monster-kit` (validated there). */
  genome: z.unknown(),
  state: AgentStateSchema,
  /** Short "what I'm doing" line for the speech bubble, when working. */
  activity: z.string().optional(),
  /**
   * At work and going round in circles (the instinct's `stuck_*`, D-067):
   * since when (ms). Missing when it is not confused (D-072).
   */
  confusedSince: z.number().optional(),
  /**
   * The open work items of the agent (its runs, the tasks delegated to it), with the keys of
   * `workChangeOf` (D-157): the app seeds its live state with them, so the end of each one
   * is recognised. Older cores leave it out.
   */
  work: z.array(z.string()).optional(),
  /**
   * Provider of the first link of the agent's chain (e.g. `chatgpt`): the UI
   * shows "Using ChatGPT plan" next to the composer when it is a plan (M2.7).
   */
  provider: z.string().optional(),
  /**
   * The agent's chain of models: a step on a model no longer in it measures
   * the context key against the window of the first one (D-086).
   */
  models: z.array(z.object({ provider: z.string(), model: z.string() })).optional(),
  /** The project of the monster (D-097); absent = Squadra personale. */
  project: z.string().optional(),
  /** The lead of its project (`kind: lead`). */
  isLead: z.boolean().optional(),
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

export const SendMessageRequestSchema = z
  .object({
    // A resumed request carries the resume phrase around a whole message (D-074).
    text: z.string().max(MESSAGE_MAX_CHARS + RESUME_EXTRA_CHARS),
    /** Talk to a specific agent; omitted → the orchestrator. */
    to: z.string().optional(),
    /** Starts again the work of this run, stopped by Ferma: not typed by the user (D-072). */
    resumeOf: z.string().min(1).max(128).optional(),
    /** Ids of files uploaded with `POST /api/files` (files.ts); the text may then be empty. */
    attachments: z.array(z.string().min(1).max(64)).max(MESSAGE_MAX_ATTACHMENTS).optional(),
    /**
     * The sender's own id for this message (the UI's pending bubble, D-217): logged on the
     * `message` event, so the sender recognises its copy whatever the text. A second request with
     * the same id (a retry after a lost answer, another tab) is not logged again: the core answers
     * as it did the first time.
     */
    clientId: z.string().min(1).max(64).optional(),
  })
  .refine((m) => m.resumeOf !== undefined || m.text.length <= MESSAGE_MAX_CHARS, {
    message: `Too big: expected string to have <=${MESSAGE_MAX_CHARS} characters`,
    path: ['text'],
  })
  .refine((m) => m.text.trim().length > 0 || (m.attachments?.length ?? 0) > 0, {
    message: 'Too small: expected a text or an attachment',
    path: ['text'],
  });
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const SendMessageResponseSchema = z.object({
  runId: z.string(),
  /** Agent that received the message. */
  agent: z.string().optional(),
  /** True when the message joined the agent's active run. */
  queued: z.boolean().optional(),
  /** Id of the blocking question the message answered (the agent was waiting for it). */
  answered: z.string().optional(),
  /** The `message` event logged for it. */
  messageId: z.string().optional(),
});
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;

export const NewConversationRequestSchema = z.object({
  /** Start over only the direct conversation with this agent (id or name); omitted → every conversation. */
  to: z.string().trim().min(1).max(64).optional(),
});
export type NewConversationRequest = z.infer<typeof NewConversationRequestSchema>;

export const NewConversationResponseSchema = z.object({
  /** Id of the `new_conversation` event: the boundary in the log. */
  id: z.string(),
  ts: z.number(),
  /** Agent id when the conversation of a single agent started over. */
  to: z.string().optional(),
});
export type NewConversationResponse = z.infer<typeof NewConversationResponseSchema>;

/**
 * `POST /api/agents/:id/stop` (F-1): what stopped of one monster's work. Its runs (the turn of
 * its chat with the delegations and teammate questions it started, a run of its automations,
 * the chat of its Telegram bot) end as `aborted`, each after a `kill` event with `scope:
 * 'agent'`; its part in the runs of other monsters (a task delegated to it, a question a
 * teammate asked it) stops while those runs go on. Not the kill switch: the next message starts
 * a new run at once. Errors: 404 `unknown_agent`.
 */
export const AgentStopResponseSchema = z.object({
  /** Runs of the monster that ended (0: nothing of it was running). */
  stopped: z.number().int().nonnegative(),
  /** Their ids. */
  runs: z.array(z.string()),
  /** Its parts stopped inside the runs of other monsters (those runs go on). */
  parts: z.number().int().nonnegative(),
  processesKilled: z.number().int().nonnegative(),
  /** Messages other monsters wrote to it (`project_send`) that waited and will not start. */
  sendsDropped: z.number().int().nonnegative(),
  /** Giri of its automations that waited for it to be free and are skipped. */
  giriSkipped: z.number().int().nonnegative(),
});
export type AgentStopResponse = z.infer<typeof AgentStopResponseSchema>;

export const QuestionOptionViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
});

export const QuestionSchema = z.object({
  id: z.string(),
  /** Agent asking (usually the orchestrator). */
  from: z.string(),
  runId: z.string(),
  question: z.string(),
  /** 2-4 options, or none for an open question (free-text answer). */
  options: z
    .array(QuestionOptionViewSchema)
    .max(4)
    .refine((o) => o.length !== 1, 'no options (open question) or 2-4 options'),
  recommended: z.string().optional(),
  blocking: z.boolean(),
  status: z.enum(['open', 'answered', 'expired']),
  /**
   * Open with no run behind it (D-078): the monster ended its turn and waits
   * for the user; the answer starts a new run.
   */
  parked: z.boolean().optional(),
  createdAt: z.number(),
  answer: z.object({ optionId: z.string().optional(), text: z.string().optional() }).optional(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const AnswerRequestSchema = z
  .object({ optionId: z.string().optional(), text: z.string().max(5_000).optional() })
  .refine((a) => a.optionId !== undefined || a.text !== undefined, 'optionId or text required');
export type AnswerRequest = z.infer<typeof AnswerRequestSchema>;

export const UndoRequestSchema = z.object({
  actionId: z.string().min(1),
  /** Undo even if the files changed afterwards (those later changes are lost). */
  force: z.boolean().optional(),
});
export type UndoRequest = z.infer<typeof UndoRequestSchema>;

export const OpenRouterKeyRequestSchema = z.object({
  key: z.string().trim().min(10).max(500).regex(/^\S+$/, 'the key cannot contain spaces'),
});
export type OpenRouterKeyRequest = z.infer<typeof OpenRouterKeyRequestSchema>;

/** `PUT /api/settings/openrouter`: paid models on or off, at once, without a restart. */
export const OpenRouterSettingsRequestSchema = z.object({ freeOnly: z.boolean() });
export type OpenRouterSettingsRequest = z.infer<typeof OpenRouterSettingsRequestSchema>;

export const BraveKeyRequestSchema = z.object({
  key: z.string().trim().min(10).max(200).regex(/^\S+$/, 'the key cannot contain spaces'),
});
export type BraveKeyRequest = z.infer<typeof BraveKeyRequestSchema>;

export const BraveKeyResponseSchema = z.object({ ok: z.literal(true) });
export type BraveKeyResponse = z.infer<typeof BraveKeyResponseSchema>;

export const UndoResponseSchema = z.object({
  ok: z.literal(true),
  commit: z.string().optional(),
  files: z.array(z.string()).optional(),
});
export type UndoResponse = z.infer<typeof UndoResponseSchema>;

/**
 * Where the saved keys and tokens are protected (D-042): encrypted with a
 * master key kept in the system keychain, or (declared fallback) in files
 * readable only by the user.
 */
export const SecretsStatusSchema = z.object({
  backend: z.enum(['keychain', 'file']),
  /**
   * `keychain`: in use. `forced`: files chosen with `MONSTERS_SECRETS=file`.
   * `unavailable`: no keychain on this machine (or it refused). `timeout`: the
   * keychain did not answer (locked, waiting for a password). `error`: the
   * keychain gave an invalid or unstable key. `missing-key`: the keychain has no key for
   * this data directory but encrypted secrets are there; nothing is replaced until they
   * are saved again or `monsters secrets reset` (D-042).
   */
  reason: z.enum(['keychain', 'forced', 'unavailable', 'timeout', 'error', 'missing-key']),
  /** The keychain in use or tried ("Secret Service", "Portachiavi di macOS"…). */
  keychain: z.string().optional(),
  /** Why the keychain could not be used (never contains a secret). */
  detail: z.string().optional(),
  /** Saved secrets that cannot be read now (e.g. encrypted with a key the keychain no longer gives). */
  unreadable: z.array(z.string()),
  /** Encrypted secrets set aside at this start: the keychain no longer had their key. */
  quarantined: z.array(z.string()).optional(),
});
export type SecretsStatus = z.infer<typeof SecretsStatusSchema>;

/**
 * Paid web search on OpenRouter (D-071): `auto` follows "Usa anche modelli a
 * pagamento" (on when paid models are allowed), `on` and `off` are the user's
 * explicit choice.
 */
export const PaidSearchModeSchema = z.enum(['auto', 'on', 'off']);
export type PaidSearchMode = z.infer<typeof PaidSearchModeSchema>;
/** `parallel`: ~1 $ per 1,000 searches; `exa`: ~7 $, more precise. */
export const PaidSearchEngineSchema = z.enum(['parallel', 'exa']);
export type PaidSearchEngineName = z.infer<typeof PaidSearchEngineSchema>;

export const WebSearchSettingsSchema = z.object({
  mode: PaidSearchModeSchema,
  engine: PaidSearchEngineSchema,
  /** The paid search is used now. */
  active: z.boolean(),
  /**
   * Why it is not: turned off, no OpenRouter key, no credit, key refused, paused after errors, `auto` with free
   * models only, the spending cap of the team reached (D-070).
   */
  reason: z
    .enum(['off', 'no_key', 'no_credit', 'key_rejected', 'paused', 'free_only', 'spend_cap'])
    .optional(),
  /** Expected dollars per 1,000 searches with each engine. */
  usdPer1000: z.record(PaidSearchEngineSchema, z.number().nonnegative()),
});
export type WebSearchSettings = z.infer<typeof WebSearchSettingsSchema>;

export const WebSearchSettingsRequestSchema = z
  .object({ mode: PaidSearchModeSchema.optional(), engine: PaidSearchEngineSchema.optional() })
  .refine((b) => b.mode !== undefined || b.engine !== undefined, 'nothing to change');
export type WebSearchSettingsRequest = z.infer<typeof WebSearchSettingsRequestSchema>;

export const SettingsResponseSchema = z.object({
  openrouterKey: z.object({
    /** A key is configured (saved from the UI or `OPENROUTER_API_KEY`). */
    set: z.boolean(),
    /** Paid models are refused (spending cap 0 $). */
    freeOnly: z.boolean(),
    /** Name of the key on OpenRouter, when known. */
    label: z.string().optional(),
  }),
  /** Brave Search key for `web_search` (optional): only whether there is one. */
  braveKey: z.object({ set: z.boolean() }),
  /** Paid web search (D-071); absent from older cores. */
  webSearch: WebSearchSettingsSchema.optional(),
  /** Absolute path of the vault folder. */
  vaultPath: z.string(),
  /** How the agents address the user. */
  userName: z.string(),
  /** Where keys and tokens are kept (D-042). */
  secrets: SecretsStatusSchema.optional(),
  /** The app's language (D-153); absent from older cores. */
  language: LangSchema.optional(),
  /** The names of the vault's folders (D-154); absent from older cores (Italian). */
  vaultLayout: VaultLayoutIdSchema.optional(),
});
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;

export const OpenRouterKeyResponseSchema = z.object({
  ok: z.literal(true),
  label: z.string().optional(),
  /** False when the account has credits (1000 free requests per day instead of 50). */
  isFreeTier: z.boolean().optional(),
  limit: z.number().nullable().optional(),
  usage: z.number().optional(),
});
export type OpenRouterKeyResponse = z.infer<typeof OpenRouterKeyResponseSchema>;

/** `PUT /api/settings/language` (D-153). */
export const LanguageRequestSchema = z.object({ language: LangSchema });
export type LanguageRequest = z.infer<typeof LanguageRequestSchema>;

/*
 * Onboarding (M1.6): first start, questions, permissions, team proposal. Same
 * rules as above (JSON body, anti-CSRF header, session or bearer).
 *
 *   GET  /api/onboarding                  → OnboardingState (status and current step)
 *   POST /api/onboarding/answers          OnboardingAnswersRequest → OnboardingState
 *                                         (merges answers and permissions; writes profilo.md
 *                                         and the "always ask" rules once the answers are complete)
 *   POST /api/onboarding/team/propose     → OnboardingState (with `proposal`; LLM or fallback)
 *   POST /api/onboarding/monster          MonsterRegenerateRequest → ProposedAgent (new genome)
 *   POST /api/onboarding/team/confirm     TeamConfirmRequest → TeamConfirmResponse
 *
 * `access` (first screen) says how the team reaches a model: the OpenRouter key, the
 * Claude subscription (Claude Agent harness) or the ChatGPT plan. It must be set up
 * already (409 `access_unavailable` otherwise); the agents of the team start on it.
 *
 * Errors: 409 `onboarding_done` (the team already exists), 409 `answers_incomplete`,
 * 409 `no_proposal`, 409 `answers_changed` (the answers changed while the team was being
 * proposed: the proposal is dropped), 409 `halted` (kill switch engaged: no team proposal), 404
 * `unknown_member`, 400 `invalid_request` (also an unsafe area or duty) / `invalid_name`
 * (also a name whose id is taken, the orchestrator's included).
 * The questions themselves are fixed: `ONBOARDING_QUESTIONS` in onboarding.ts.
 */

export const OnboardingStepSchema = z.enum(['key', 'questions', 'permissions', 'team', 'done']);
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;

/** How the team reaches a model, chosen on the first screen of the onboarding. */
export const OnboardingAccessSchema = z.enum(['openrouter', 'claude-agent', 'chatgpt']);
export type OnboardingAccess = z.infer<typeof OnboardingAccessSchema>;

export const OnboardingAnswerSchema = z.object({
  values: z.record(z.string().max(40), z.array(z.string().trim().min(1).max(60)).max(12)),
  text: z.string().trim().max(1000).optional(),
});

export const OnboardingAnswersSchema = z.record(z.string().max(40), OnboardingAnswerSchema);

export const FolderGrantSchema = z.object({
  /** Absolute path (`~` allowed); the core checks it is an existing folder. */
  path: z.string().trim().min(1).max(1024),
  /** Also create, change, move and delete files. */
  write: z.boolean(),
});

/** Most folders granted to one agent. */
export const MAX_FOLDER_GRANTS = 20;

export const AgentPermissionsSchema = z.object({
  /** Write in the vault (reading is always allowed). */
  vault: z.boolean(),
  /** Search and read web pages. */
  web: z.boolean(),
  /** Terminal (`shell`) and CLIs in the agent's folder. Missing = false. */
  shell: z.boolean().optional(),
  /** Folders outside the vault (`fs_*` tools). Missing = none. */
  folders: z.array(FolderGrantSchema).max(MAX_FOLDER_GRANTS).optional(),
});

export const OnboardingAnswersRequestSchema = z.object({
  answers: OnboardingAnswersSchema.optional(),
  permissions: AgentPermissionsSchema.optional(),
  /** Go on without an OpenRouter key (the team proposal uses the fallback). */
  skipKey: z.boolean().optional(),
  /** The way to a model the user set up on the first screen (must be ready). */
  access: OnboardingAccessSchema.optional(),
});
export type OnboardingAnswersRequest = z.infer<typeof OnboardingAnswersRequestSchema>;

export const ProposedAgentSchema = z.object({
  id: AgentIdSchema,
  name: z.string(),
  /** With article, e.g. "la ricercatrice". */
  title: z.string(),
  /** One sentence: what the agent does. */
  role: z.string(),
  mission: z.string(),
  /** One sentence about the user. */
  context: z.string(),
  duties: z.array(z.string()).max(4),
  /** Vault folder for the results. */
  area: z.string(),
  /** Tool names assigned (only those allowed by the permissions). */
  tools: z.array(z.string()),
  color: z.string(),
  /** MonsterGenome from `@monsters/monster-kit`. */
  genome: z.unknown(),
  archetype: z.enum(['rhea', 'dione']).nullable(),
});
export type ProposedAgent = z.infer<typeof ProposedAgentSchema>;

export const TeamProposalSchema = z.object({
  orchestrator: z.object({
    id: AgentIdSchema,
    name: z.string(),
    color: z.string(),
    genome: z.unknown(),
  }),
  members: z.array(ProposedAgentSchema).min(1).max(5),
  /** `model` when an LLM proposed it, `fallback` for the fixed team. */
  source: z.enum(['model', 'fallback']),
  /** Model that answered, when known. */
  model: z.string().optional(),
  /** Model requests used for this proposal. */
  requests: z.number().int().nonnegative(),
});
export type TeamProposal = z.infer<typeof TeamProposalSchema>;

export const OnboardingStateSchema = z.object({
  status: z.enum(['pending', 'done']),
  step: OnboardingStepSchema,
  /** A model provider is configured. */
  hasKey: z.boolean(),
  keySkipped: z.boolean(),
  /** The way to a model chosen on the first screen (missing from older cores: null). */
  access: OnboardingAccessSchema.nullable().default(null),
  answers: OnboardingAnswersSchema,
  permissions: AgentPermissionsSchema.nullable(),
  proposal: TeamProposalSchema.nullable(),
  /** The starting agent: becomes the orchestrator with the chosen name. */
  guide: z.object({ name: z.string(), genome: z.unknown() }),
});
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

export const MonsterRegenerateRequestSchema = z.object({ id: AgentIdSchema });
export type MonsterRegenerateRequest = z.infer<typeof MonsterRegenerateRequestSchema>;

export const TeamConfirmMemberSchema = z.object({
  id: AgentIdSchema,
  name: z.string().trim().min(1).max(24).optional(),
  /** The duties as the user reviewed them (replace the proposed ones). */
  duties: z.array(AgentDutySchema).min(1).max(MAX_DUTIES).optional(),
  /** The vault folder as the user reviewed it: a plain folder, see `agentAreaProblem`. */
  area: AgentAreaSchema.optional(),
});

export const TeamConfirmRequestSchema = z.object({
  /** Proposed members to keep, in order, optionally renamed or with edited duties and area. */
  members: z.array(TeamConfirmMemberSchema).min(1).max(5),
});
export type TeamConfirmRequest = z.infer<typeof TeamConfirmRequestSchema>;

export const TeamConfirmResponseSchema = z.object({
  ok: z.literal(true),
  agents: z.array(AgentSummarySchema),
  /** First message of the orchestrator, also logged as a `message` event. */
  welcome: z.string(),
});
export type TeamConfirmResponse = z.infer<typeof TeamConfirmResponseSchema>;
