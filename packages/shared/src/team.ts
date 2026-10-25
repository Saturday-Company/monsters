import { z } from 'zod';
import { AgentAreaSchema, AgentDutySchema, MAX_DUTIES } from './agent-area.ts';
import { agentAreaStrings } from './agent-area.strings.ts';
import { AgentStateSchema, PasswordSchema } from './api.ts';
import { AgentIdSchema, ProjectIdSchema } from './ids.ts';
import { AGENT_NAME_PATTERN } from './onboarding.ts';
import { ArchetypeSchema } from './team-draft.ts';
import { UlidSchema } from './ulid.ts';

export { ArchetypeSchema, TeamDraftSchema, type Archetype, type TeamDraft } from './team-draft.ts';

/*
 * The team after the onboarding (Settings → Squadra): monsters renamed,
 * re-skinned, given another role, archived and restored, added; the user's
 * profile; the password. Same rules as the rest of the API (JSON body,
 * anti-CSRF header, session or bearer).
 *
 *   GET    /api/team                          → TeamView
 *   GET    /api/team/agents/:id               → TeamMemberView (any squad: also a project's monster
 *                                             or lead, D-097; the edits below work on them too)
 *   PATCH  /api/team/agents/:id               TeamMemberUpdate → TeamMemberView
 *   PUT    /api/team/agents/:id/look          TeamLookRequest → TeamMemberView
 *   DELETE /api/team/agents/:id               → TeamArchiveResponse (archived, never deleted)
 *   POST   /api/team/archived/:id/restore     TeamRestoreRequest → TeamMemberView
 *   POST   /api/team/looks                    TeamLooksRequest → TeamLooksResponse (previews, nothing saved)
 *   GET    /api/team/suggestions              → TeamSuggestions
 *   POST   /api/team/drafts                   TeamDraftRequest → TeamDraft (nothing saved; a model call
 *                                             for `description`, refused while stopped)
 *   POST   /api/team/agents                   TeamMemberCreateRequest → TeamMemberView (201)
 *   POST   /api/team/proposals/:id/discard    → { ok: true } (a proposal of the capo squadra left
 *                                             aside, D-075; `monster_proposal` event)
 *   GET    /api/profile                       → ProfileView
 *   PUT    /api/profile                       ProfileUpdate → ProfileView
 *   POST   /api/auth/password                 PasswordChangeRequest → PasswordChangeResponse
 *                                             (browser session only; the other sessions are closed)
 *   POST   /api/auth/password/reset           → 409 `core_running`: never with the core running
 *                                             (review of 18/10, M1); `monsters password` with it stopped
 *
 * The id of a monster never changes: the name is only shown. A rename keeps the
 * chat, the delegations and the notes it wrote (they point to the id), moves its
 * memory folder `Agenti/<Name>/` in the notes and rewrites its AGENTS.md and the
 * capo squadra's. Every change is a `team_change` event (`auth` for the password).
 *
 * Errors: 409 `onboarding_pending`, 404 `unknown_agent`, 400 `invalid_request`,
 * 400 `invalid_name` (pattern, reserved, or the same/too similar to another monster's
 * name or id: `message` says which), 409 `busy` (a monster is working: wait or stop
 * them), 400 `orchestrator` (the capo squadra cannot be archived, and has no role to
 * edit), 409 `instructions_edited` (AGENTS.md was changed by hand: retry with
 * `force: true` to rewrite it; the old file is kept as `AGENTS.md.bak`), 409
 * `memory_conflict` (the notes already have a file where the memory would move), 400
 * `color_too_close` (a look whose colour is within 30° of another monster's), 409
 * `team_full` (at most `maxMembers` monsters besides the capo squadra), 409 `name_taken`
 * (restoring a monster whose name is in use: send another `name`), 409 `halted` (no
 * model call for a draft while Monsters is stopped), 409 `proposal_closed` (the
 * capo squadra's proposal was already used or left aside), 404 `unknown_proposal`. Password: 400 `wrong_password`,
 * 400 `same_password`, 429 `too_many_attempts` (with `Retry-After`), 403
 * `session_required` / `forbidden`, 409 `no_account`.
 */

/** Most monsters besides the capo squadra (the AGENTS.md of the capo lists up to 7). */
export const MAX_TEAM_MEMBERS = 7;

/** A monster's display name, as in the onboarding. */
export const TeamNameSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(24)
      .regex(AGENT_NAME_PATTERN, { error: () => agentAreaStrings().nameChars }),
  );

/** One line of the generated AGENTS.md: the same rules the generation follows. */
export function teamLine(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !/[\r\n]/.test(s), { error: () => agentAreaStrings().dutyOneLine })
    .refine((s) => !/\{\{[^}]*\}\}/.test(s), { error: () => agentAreaStrings().dutyPlaceholder })
    .refine((s) => !s.startsWith('#'), { error: () => agentAreaStrings().dutyHash });
}

export const TeamTitleSchema = teamLine(3, 60);
export const TeamRoleSchema = teamLine(5, 120);
export const TeamMissionSchema = teamLine(5, 200);
export const TeamContextSchema = teamLine(5, 200);
export const TeamDutiesSchema = z.array(AgentDutySchema).min(1).max(MAX_DUTIES);

export const TeamMemberViewSchema = z.object({
  id: AgentIdSchema,
  name: z.string(),
  /** One line, shown under the monster (for the capo squadra: "coordinatore della squadra di …"). */
  role: z.string(),
  color: z.string(),
  /** MonsterGenome from `@monsters/monster-kit`. */
  genome: z.unknown(),
  isOrchestrator: z.boolean(),
  state: AgentStateSchema,
  /** Subagents only: the fields of their AGENTS.md. */
  title: z.string().optional(),
  mission: z.string().optional(),
  duties: z.array(z.string()).optional(),
  /** Vault folder of its results. */
  area: z.string().optional(),
  /** Has web tools (still subject to the permissions). */
  web: z.boolean(),
  /** AGENTS.md was changed by hand: a role edit needs `force`. */
  instructionsEdited: z.boolean(),
  /** The project of the monster (D-097); absent = Squadra personale. */
  project: z.string().optional(),
  /** The lead of its project. */
  isLead: z.boolean().optional(),
});
export type TeamMemberView = z.infer<typeof TeamMemberViewSchema>;

export const ArchivedMemberViewSchema = z.object({
  id: AgentIdSchema,
  name: z.string(),
  role: z.string(),
  color: z.string(),
  genome: z.unknown(),
  archivedAt: z.number(),
});
export type ArchivedMemberView = z.infer<typeof ArchivedMemberViewSchema>;

export const TeamViewSchema = z.object({
  /** The capo squadra first, then the others by name. */
  members: z.array(TeamMemberViewSchema),
  /** Archived monsters, newest first: their chat stays in the log, they can come back. */
  archived: z.array(ArchivedMemberViewSchema),
  maxMembers: z.number().int(),
});
export type TeamView = z.infer<typeof TeamViewSchema>;

/**
 * What can change of one monster. The capo squadra takes only `name` (it is also
 * the profile's `orchestratorName`). Fields left out stay as they are.
 */
export const TeamMemberUpdateSchema = z.object({
  name: TeamNameSchema.optional(),
  role: TeamRoleSchema.optional(),
  title: TeamTitleSchema.optional(),
  mission: TeamMissionSchema.optional(),
  duties: TeamDutiesSchema.optional(),
  area: AgentAreaSchema.optional(),
  web: z.boolean().optional(),
  /** Rewrite an AGENTS.md changed by hand (the old one is kept as `AGENTS.md.bak`). */
  force: z.boolean().optional(),
});
export type TeamMemberUpdate = z.infer<typeof TeamMemberUpdateSchema>;

export const TeamLookRequestSchema = z.object({
  /** A genome from `POST /api/team/looks` (validated again by the monster kit). */
  genome: z.record(z.string(), z.unknown()),
});
export type TeamLookRequest = z.infer<typeof TeamLookRequestSchema>;

export const TeamLooksRequestSchema = z
  .object({
    /** New looks for this monster (its own colour is free to change). */
    agent: AgentIdSchema.optional(),
    /** …or for a monster still to be added. */
    name: TeamNameSchema.optional(),
    /** With `name`: the project it will join (its colour keeps away from that squad's, D-097). */
    project: ProjectIdSchema.optional(),
    count: z.number().int().min(1).max(6).default(3),
  })
  .refine((r) => (r.agent === undefined) !== (r.name === undefined), 'agent or name, not both');
export type TeamLooksRequest = z.input<typeof TeamLooksRequestSchema>;

export const MonsterLookSchema = z.object({ genome: z.unknown(), color: z.string() });
export const TeamLooksResponseSchema = z.object({ looks: z.array(MonsterLookSchema) });
export type TeamLooksResponse = z.infer<typeof TeamLooksResponseSchema>;

export const TeamArchiveResponseSchema = z.object({
  ok: z.literal(true),
  archived: ArchivedMemberViewSchema,
  /** Open questions of the monster that were closed (`question_expired`, reason `agent_archived`). */
  questionsClosed: z.number().int(),
});
export type TeamArchiveResponse = z.infer<typeof TeamArchiveResponseSchema>;

export const TeamRestoreRequestSchema = z.object({
  /** Another name, when its old one is now taken. */
  name: TeamNameSchema.optional(),
});
export type TeamRestoreRequest = z.infer<typeof TeamRestoreRequestSchema>;

export const TeamSuggestionsSchema = z.object({
  /** Starting archetypes not on the team yet. */
  archetypes: z.array(
    z.object({ archetype: ArchetypeSchema, name: z.string(), title: z.string(), role: z.string() }),
  ),
  /** Short descriptions to start a made-to-measure monster from (`POST /api/team/drafts`). */
  ideas: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })),
  /** Free names, in order. */
  names: z.array(z.string()),
});
export type TeamSuggestions = z.infer<typeof TeamSuggestionsSchema>;

export const TeamDraftRequestSchema = z.union([
  z.object({ archetype: ArchetypeSchema, name: TeamNameSchema.optional() }),
  z.object({
    /** What the monster should do, in the user's words. */
    description: z.string().trim().min(5).max(500),
    name: TeamNameSchema.optional(),
    /** Should it search the web (default: the model decides). */
    web: z.boolean().optional(),
  }),
]);
export type TeamDraftRequest = z.infer<typeof TeamDraftRequestSchema>;

export const TeamMemberCreateRequestSchema = z.object({
  name: TeamNameSchema,
  title: TeamTitleSchema,
  role: TeamRoleSchema,
  mission: TeamMissionSchema,
  context: TeamContextSchema.optional(),
  duties: TeamDutiesSchema,
  area: AgentAreaSchema,
  web: z.boolean(),
  genome: z.record(z.string(), z.unknown()),
  archetype: ArchetypeSchema.nullable().optional(),
  /**
   * The capo squadra's proposal this monster comes from (D-075): its suggested
   * model is used, and the outcome is logged for the capo's next turn.
   */
  proposal: UlidSchema.optional(),
  /** With `proposal`: false uses the capo squadra's models instead of the proposed one (D-079). */
  proposalModel: z.boolean().optional(),
});
export type TeamMemberCreateRequest = z.infer<typeof TeamMemberCreateRequestSchema>;

/** Kinds of choice the agents always ask about: they cannot be turned off. */
export const ASK_ALWAYS_FIXED = ['publish', 'contact', 'spend', 'delete'] as const;
/** Kinds the user may add. */
export const ASK_ALWAYS_EXTRAS = ['goal'] as const;
export const AskExtraSchema = z.enum(ASK_ALWAYS_EXTRAS);

export const ProfileOptionSchema = z.object({ id: z.string(), label: z.string() });

/**
 * An answer of the "Tell me more about you" card: the options picked (ids of `ProfileView.options`)
 * and the user's own words.
 */
export const ProfileAnswerSchema = z.object({
  options: z.array(z.string().min(1).max(40)).max(12),
  text: z.string().trim().max(1000),
});
export type ProfileAnswer = z.infer<typeof ProfileAnswerSchema>;

export const ProfileViewSchema = z.object({
  userName: z.string(),
  /** Name of the capo squadra. */
  orchestratorName: z.string(),
  /** Option id of the tone (`ProfileView.options.tones`). */
  tone: z.string(),
  /** Option id of the language (`it`, `en`, …). */
  language: z.string(),
  /** Free notes on the style, if any. */
  style: z.string(),
  askAlways: z.object({
    /** Always on, shown as such. */
    fixed: z.array(ProfileOptionSchema),
    /** Extra kinds turned on (ids of `options.extras`). */
    extras: z.array(AskExtraSchema),
    /** "Altro da chiederti sempre", in the user's words. */
    text: z.string(),
  }),
  /** What the user does; null until they answered or skipped the "Tell me more" card (older cores omit it). */
  work: ProfileAnswerSchema.nullable().default(null),
  /** What the user would like to hand off; null as `work`. */
  delegate: ProfileAnswerSchema.nullable().default(null),
  options: z.object({
    tones: z.array(ProfileOptionSchema),
    languages: z.array(ProfileOptionSchema),
    extras: z.array(ProfileOptionSchema),
    work: z.array(ProfileOptionSchema).default([]),
    delegate: z.array(ProfileOptionSchema).default([]),
  }),
});
export type ProfileView = z.infer<typeof ProfileViewSchema>;

export const ProfileUpdateSchema = z.object({
  userName: TeamNameSchema.optional(),
  /** Renames the capo squadra (as `PATCH /api/team/agents/:id`). */
  orchestratorName: TeamNameSchema.optional(),
  tone: z.string().min(1).max(40).optional(),
  language: z.string().min(1).max(10).optional(),
  style: z.string().trim().max(1000).optional(),
  askAlways: z
    .object({
      extras: z.array(AskExtraSchema).max(ASK_ALWAYS_EXTRAS.length),
      text: z.string().trim().max(1000),
    })
    .optional(),
  /** What the user does (an empty answer means "skipped": the card does not come back). */
  work: ProfileAnswerSchema.optional(),
  /** What the user would like to hand off. */
  delegate: ProfileAnswerSchema.optional(),
});
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

export const PasswordChangeRequestSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: PasswordSchema,
});
export type PasswordChangeRequest = z.infer<typeof PasswordChangeRequestSchema>;

export const PasswordResetRequestSchema = z.object({ newPassword: PasswordSchema });
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

export const PasswordChangeResponseSchema = z.object({
  ok: z.literal(true),
  /** Sessions logged out (every other browser; all of them for a reset). */
  sessionsClosed: z.number().int(),
});
export type PasswordChangeResponse = z.infer<typeof PasswordChangeResponseSchema>;
