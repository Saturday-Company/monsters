import { z } from 'zod';
import { AgentPermissionsSchema } from './api.ts';
import { AgentIdSchema } from './ids.ts';

/*
 * Permissions of the agents after the onboarding (M2.1). Same rules as the rest
 * of the API (JSON body, anti-CSRF header, session or bearer).
 *
 *   GET /api/permissions   → PermissionsResponse
 *   PUT /api/permissions   PermissionsUpdateRequest → PermissionsResponse
 *
 * `defaults` apply to every agent without permissions of its own; `agents[id]`
 * replaces them for one agent (`null` goes back to the defaults). A permission
 * removed holds from the next tool call, a permission granted from the next
 * run. Errors: 400 `invalid_folder` (missing, not a folder, inside the vault or
 * the data folder of Monsters; `path` says which), 404 `unknown_agent`.
 */

export const AgentPermissionsViewSchema = z.object({
  id: AgentIdSchema,
  name: z.string(),
  color: z.string(),
  isOrchestrator: z.boolean(),
  /** Effective permissions (own or the defaults), every field present. */
  permissions: AgentPermissionsSchema,
  /** The agent has permissions of its own. */
  custom: z.boolean(),
});
export type AgentPermissionsView = z.infer<typeof AgentPermissionsViewSchema>;

export const PermissionsResponseSchema = z.object({
  defaults: AgentPermissionsSchema,
  agents: z.array(AgentPermissionsViewSchema),
  /** Home folder of the user, for placeholders. */
  home: z.string(),
  /** Where each agent has its own working folder (`<workspaces>/<id>`). */
  workspaces: z.string(),
  /** `process.platform` of the core: the terminal is PowerShell on `win32`. */
  platform: z.string(),
});
export type PermissionsResponse = z.infer<typeof PermissionsResponseSchema>;

export const PermissionsUpdateRequestSchema = z.object({
  defaults: AgentPermissionsSchema.optional(),
  agents: z.record(AgentIdSchema, AgentPermissionsSchema.nullable()).optional(),
});
export type PermissionsUpdateRequest = z.infer<typeof PermissionsUpdateRequestSchema>;
