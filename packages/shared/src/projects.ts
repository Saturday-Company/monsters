import { z } from 'zod';
import { agentAreaStrings } from './agent-area.strings.ts';
import { AgentAreaSchema } from './agent-area.ts';
import { vaultLayout, type VaultLayout } from './vault-layout.ts';
import { AgentStateSchema } from './api.ts';
import { AgentIdSchema, ProjectIdSchema } from './ids.ts';
import {
  AutomationNotifySchema,
  AutomationScheduleSchema,
  VaultFolderSchema,
} from './automations.ts';
import { ModelRefViewSchema } from './providers.ts';
import { SpendAgentCapsSchema, SpendMeterViewSchema, SpendStatusSchema } from './spend.ts';
import { TeamDraftSchema } from './team-draft.ts';
import { TeamMemberCreateRequestSchema, TeamNameSchema } from './team.ts';

export { ProjectIdSchema, type ProjectId } from './ids.ts';

/*
 * Projects (plan of 17/10, B1; D-097): a squad with its own perimeter. A
 * project has its own monsters (a lead, `kind: lead`, and the monsters copied
 * or created for it: never shared with another squad), an area of the notes
 * (`Progetti/<name>/` by default: read everywhere as today, written in the
 * area), a folder on the computer where its monsters work (the `cwd` of their
 * terminal, files and harness), the connections it may use, a spending cap,
 * and its chat (the lead's). The orchestrator stays the single top figure: a
 * generic message goes to it, a message to a project goes to its lead.
 *
 * Files: `MONSTERS_HOME/projects/<id>/project.yaml` (`ProjectSchema`); the
 * monsters stay in `MONSTERS_HOME/agents/<id>/` with `project: <id>` in their
 * agent.yaml (absent = Squadra personale). Events keep no project column: an
 * event's project is its agent's.
 *
 *   GET    /api/projects                         → ProjectView[] (archived ones last)
 *   POST   /api/projects                         ProjectCreateRequest → ProjectView (201)
 *   GET    /api/projects/:id                     → ProjectView
 *   PATCH  /api/projects/:id                     ProjectUpdateRequest → ProjectView
 *                                                (`status: 'active'` confirms a draft: its lead is created)
 *   POST   /api/projects/:id/confirm             → ProjectView (a draft: lead, monsters and first
 *                                                automations created together, or nothing, D-098)
 *   DELETE /api/projects/:id                     → { ok: true } (a draft only: it is discarded)
 *   POST   /api/projects/:id/archive             → ProjectView (its monsters are archived, never deleted)
 *   POST   /api/projects/:id/restore             → ProjectView (an archived project and the monsters
 *                                                archived with it come back, D-098)
 *   POST   /api/projects/:id/stop                → ProjectStopResponse ("Ferma progetto": the runs of
 *                                                its monsters stop, not the kill switch, D-098)
 *   POST   /api/projects/:id/folder-docs/approve → ProjectView (CLAUDE.md and AGENTS.md of the folder
 *                                                as they are now are the user's, D-103)
 *   POST   /api/projects/:id/members             ProjectMemberRequest → ProjectView (201)
 *                                                (a copy of a monster with a memory of its own, or a new one)
 *   DELETE /api/projects/:id/members/:agent      → ProjectView (the monster is archived)
 *   POST   /api/projects/:id/messages            ProjectMessageRequest → SendResult (202, to the lead)
 *   GET    /api/projects/:id/spend               → ProjectSpendView
 *
 * Errors: 404 `unknown_project`, 404 `unknown_agent`, 400 `invalid_request`,
 * 400 `invalid_name` (a monster's name is unique across every squad), 400
 * `invalid_folder` (not absolute, not a folder, inside the data folder of
 * Monsters or the notes), 409 `project_draft` (a draft has no monsters yet:
 * confirm it first), 409 `project_archived`, 409 `name_taken` (another project
 * has that name), 409 `busy`, 409 `team_full`, 400 `orchestrator` (the lead
 * cannot be removed from its project), 409 `halted` (messages).
 */

/** Most monsters of a project besides its lead (as the Squadra personale). */
export const MAX_PROJECT_MEMBERS = 7;

/** First-level folder of the notes where the projects' areas go (`Progetti`, `Projects`: D-154). */
export function projectsVaultFolder(layout: VaultLayout = vaultLayout()): string {
  return layout.projects;
}

/** A project's name: also the folder of its notes, so letters, digits, spaces and dashes. */
export const ProjectNameSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(40)
      .regex(/^[\p{L}\p{N}][\p{L}\p{M}\p{N} '’-]*$/u, {
        error: () => agentAreaStrings().projectNameChars,
      }),
  );

/** `draft`: proposed, not confirmed (no monsters yet); `active`: in use. */
export const ProjectStatusSchema = z.enum(['draft', 'active']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

/** An absolute folder of the computer, checked by the core (exists, or created). */
export const ProjectFolderPathSchema = z.string().trim().min(1).max(1000);

/**
 * Connections given to the whole team (`*`) that the user turned off for a
 * project (D-164): every other one, also one connected later, reaches the
 * project's monsters.
 */
/** Names of the MCP servers (Impostazioni → App e Telegram). */
const McpOffListSchema = z.array(z.string().min(1).max(64)).max(100);
/** Ids of the services reached through Claude (D-069). */
const ClaudeOffListSchema = z.array(z.string().min(1).max(64)).max(50);

export const ProjectConnectionsSchema = z.object({
  mcp: McpOffListSchema.default([]),
  claude: ClaudeOffListSchema.default([]),
});
export type ProjectConnections = z.infer<typeof ProjectConnectionsSchema>;

/**
 * The same in a request (D-209): a list that is not sent is not touched. No `.default()` here,
 * and never `ProjectConnectionsSchema.partial()`: zod keeps the defaults under `.partial()`, so
 * turning off one MCP server would have sent `claude: []` and turned every Claude service on.
 */
export const ProjectConnectionsPatchSchema = z.object({
  mcp: McpOffListSchema.optional(),
  claude: ClaudeOffListSchema.optional(),
});
export type ProjectConnectionsPatch = z.infer<typeof ProjectConnectionsPatchSchema>;

/** Who leads the project: a new monster (a free name when absent) or a copy of one. */
export const ProjectLeadPlanSchema = z.object({
  name: TeamNameSchema.optional(),
  /** Copy this monster (its role, look and models; a memory of its own). */
  from: AgentIdSchema.optional(),
  /** What the project is for, one line: it goes in the lead's AGENTS.md (D-098). */
  goal: z.string().trim().min(3).max(300).optional(),
  /** Models of the lead; absent: the copied monster's, or the orchestrator's (Automatica: Forte). */
  models: z.array(ModelRefViewSchema).min(1).max(5).optional(),
});
export type ProjectLeadPlan = z.infer<typeof ProjectLeadPlanSchema>;

/**
 * A monster of a proposed project (D-098): a copy of one (`copyOf`, a memory
 * of its own), or a new one, as the draft `team_propose_monster` builds.
 */
export const ProjectPlanMemberSchema = z.union([
  z.object({ copyOf: AgentIdSchema, name: TeamNameSchema.optional() }),
  z.object({
    draft: TeamDraftSchema,
    /** Its models; absent: the lead's (Automatica: its base). */
    models: z.array(ModelRefViewSchema).min(1).max(5).optional(),
  }),
]);
export type ProjectPlanMember = z.infer<typeof ProjectPlanMemberSchema>;

/**
 * A first automation of a proposed project (D-098): created as an automation
 * draft (D-094) once the project is confirmed, so its giri start only after a
 * second tap. `participants` are names of the plan's monsters.
 */
export const ProjectPlanAutomationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  schedule: AutomationScheduleSchema,
  objective: z.string().trim().min(1).max(8000),
  participants: z.array(z.string().min(1).max(40)).max(8).default([]),
  resultsFolder: VaultFolderSchema.optional(),
  notify: AutomationNotifySchema.optional(),
});
export type ProjectPlanAutomation = z.infer<typeof ProjectPlanAutomationSchema>;

/** Most monsters a proposal brings besides its lead (D-098). */
export const MAX_PROPOSED_MEMBERS = 4;
/** Most first automations of a proposal. */
export const MAX_PROPOSED_AUTOMATIONS = 3;

/** What a draft becomes once confirmed: its lead, and with a proposal its monsters and automations. */
export const ProjectPlanSchema = z.object({
  lead: ProjectLeadPlanSchema,
  members: z.array(ProjectPlanMemberSchema).max(MAX_PROPOSED_MEMBERS).default([]),
  automations: z.array(ProjectPlanAutomationSchema).max(MAX_PROPOSED_AUTOMATIONS).default([]),
  /** The folder does not exist yet: it is created at the confirmation. */
  createFolder: z.boolean().optional(),
  /** Why the orchestrator proposes it, one line for the card. */
  why: z.string().max(300).optional(),
  /**
   * The run that proposed it had read third-party text (D-103): its first
   * automations start tainted until the user rewrites their objectives.
   */
  taint: z.object({ source: z.string().max(200) }).optional(),
});
export type ProjectPlan = z.infer<typeof ProjectPlanSchema>;

/** The file `projects/<id>/project.yaml`. */
export const ProjectSchema = z.object({
  id: ProjectIdSchema,
  name: ProjectNameSchema,
  /** The working folder of the project's monsters; absent = their own folders. */
  folder: z.string().min(1).max(1000).optional(),
  /** Area of the notes written by the project's monsters. */
  vaultArea: AgentAreaSchema,
  /** The lead (`kind: lead`); absent only while `draft`. */
  lead: AgentIdSchema.optional(),
  status: ProjectStatusSchema,
  /** What a draft will get once confirmed (its lead; a proposal also its monsters, D-098). */
  plan: ProjectPlanSchema.optional(),
  /** The project's own spending cap, in euros (D-070, third level). */
  spend: SpendAgentCapsSchema.default({}),
  /** Turned off by the user (D-164); a `connections` allow-list of before is dropped. */
  connectionsOff: ProjectConnectionsSchema.default({ mcp: [], claude: [] }),
  /** The project's monsters may search the web (still subject to their permissions). */
  webSearch: z.boolean().default(true),
  /** `user`, or the monster that proposed it. */
  createdBy: z.string().min(1).max(64).default('user'),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  archivedAt: z.number().int().nonnegative().optional(),
  /**
   * CLAUDE.md and AGENTS.md of the folder as the user approved them (D-103):
   * the hash of what reaches the prompt, recorded when the project got the
   * folder and at every "Approva". Different now: the runs of the project's
   * monsters start tainted, and the project page says so.
   */
  folderDocs: z
    .object({ hash: z.string().min(1).max(128), approvedAt: z.number().int().nonnegative() })
    .optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectFolderRequestSchema = z.object({
  path: ProjectFolderPathSchema,
  /** Create the folder when it does not exist (default false: it must exist). */
  create: z.boolean().optional(),
});

export const ProjectCreateRequestSchema = z.object({
  name: ProjectNameSchema,
  folder: ProjectFolderRequestSchema.optional(),
  /** Default `Progetti/<name>`. */
  vaultArea: AgentAreaSchema.optional(),
  lead: ProjectLeadPlanSchema.default({}),
  spend: SpendAgentCapsSchema.optional(),
  connectionsOff: ProjectConnectionsPatchSchema.optional(),
  webSearch: z.boolean().optional(),
  /** Default `active` (the lead is created now); `draft` waits for a confirmation. */
  status: ProjectStatusSchema.default('active'),
});
export type ProjectCreateRequest = z.input<typeof ProjectCreateRequestSchema>;

export const ProjectUpdateRequestSchema = z
  .object({
    name: ProjectNameSchema,
    /** null: the monsters work in their own folders again. */
    folder: ProjectFolderRequestSchema.nullable(),
    vaultArea: AgentAreaSchema,
    spend: SpendAgentCapsSchema,
    connectionsOff: ProjectConnectionsPatchSchema,
    webSearch: z.boolean(),
    /** `active` confirms a draft (its lead is created); an active project never goes back. */
    status: z.literal('active'),
    /** A draft only: who will lead it. */
    lead: ProjectLeadPlanSchema,
  })
  .partial()
  .refine((u) => Object.values(u).some((v) => v !== undefined), 'nothing to change');
export type ProjectUpdateRequest = z.input<typeof ProjectUpdateRequestSchema>;

/** A copy of a monster of any squad: role, look and models, a memory of its own. */
export const ProjectMemberCopyRequestSchema = z.object({
  copyOf: AgentIdSchema,
  /** Default "<Name> · <Project>" (or another free name). */
  name: TeamNameSchema.optional(),
});

/** A copy, or a new monster with the fields of "Aggiungi un mostro". */
export const ProjectMemberRequestSchema = z.union([
  ProjectMemberCopyRequestSchema,
  TeamMemberCreateRequestSchema,
]);
export type ProjectMemberRequest = z.infer<typeof ProjectMemberRequestSchema>;

export const ProjectMessageRequestSchema = z
  .object({
    text: z.string().max(20_000),
    attachments: z.array(z.string().min(1).max(64)).max(10).optional(),
  })
  .refine((m) => m.text.trim().length > 0 || (m.attachments?.length ?? 0) > 0, {
    message: 'empty message',
    path: ['text'],
  });
export type ProjectMessageRequest = z.infer<typeof ProjectMessageRequestSchema>;

export const ProjectMemberViewSchema = z.object({
  id: AgentIdSchema,
  name: z.string(),
  role: z.string(),
  color: z.string(),
  genome: z.unknown(),
  isLead: z.boolean(),
  state: AgentStateSchema,
  activity: z.string().optional(),
});
export type ProjectMemberView = z.infer<typeof ProjectMemberViewSchema>;

export const ProjectViewSchema = z.object({
  id: ProjectIdSchema,
  name: z.string(),
  status: ProjectStatusSchema,
  archived: z.boolean(),
  archivedAt: z.number().optional(),
  folder: z.string().optional(),
  /** The folder is there now (it may have been moved or deleted since). */
  folderExists: z.boolean(),
  vaultArea: z.string(),
  lead: AgentIdSchema.optional(),
  plan: ProjectPlanSchema.optional(),
  /** The lead first, then the others by name. */
  members: z.array(ProjectMemberViewSchema),
  maxMembers: z.number().int(),
  spend: SpendAgentCapsSchema,
  connectionsOff: z.object({ mcp: z.array(z.string()), claude: z.array(z.string()) }),
  webSearch: z.boolean(),
  createdBy: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /**
   * The instructions of the folder (D-103): `files` those there now (CLAUDE.md,
   * AGENTS.md); `changed` when they are not what the user approved (the
   * monsters' runs start tainted until "Approva", `POST …/folder-docs/approve`).
   */
  folderDocs: z.object({ files: z.array(z.string()), changed: z.boolean() }).optional(),
});
export type ProjectView = z.infer<typeof ProjectViewSchema>;

export const ProjectSpendViewSchema = z.object({
  project: ProjectIdSchema,
  caps: SpendAgentCapsSchema,
  day: SpendMeterViewSchema,
  month: SpendMeterViewSchema,
  status: SpendStatusSchema,
  agents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      paid: z.boolean(),
      day: SpendMeterViewSchema,
      month: SpendMeterViewSchema,
      /** Providers of its chain whose models have no price: not counted (D-114). */
      unpriced: z.array(z.string()).optional(),
      /** Providers of its chain priced by OpenRouter's list: counted at an estimated cost. */
      estimated: z.array(z.string()).optional(),
    }),
  ),
});
export type ProjectSpendView = z.infer<typeof ProjectSpendViewSchema>;

/** "Ferma progetto" (D-098): what stopped. */
export const ProjectStopResponseSchema = z.object({
  /** Runs of the project's monsters stopped (their delegations with them). */
  runsStopped: z.number().int().nonnegative(),
  /** Work of `project_send` that waited for the lead and will not start. */
  sendsDropped: z.number().int().nonnegative(),
  /** Giri of its automations that waited for the lead and are skipped. */
  giriSkipped: z.number().int().nonnegative(),
});
export type ProjectStopResponse = z.infer<typeof ProjectStopResponseSchema>;
