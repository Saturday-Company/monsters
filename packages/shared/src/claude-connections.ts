import { z } from 'zod';
import { AgentIdSchema } from './ids.ts';
import { McpCatalogIdSchema } from './mcp.ts';

/*
 * Services connected "tramite Claude" (D-069): gallery entries with
 * `viaClaude` (Slack, Google, Figma, Canva, Asana, HubSpot, Vercel, Claude
 * Design) that the monsters on the Claude plan reach through Claude Code,
 * with the user's Claude account. Monsters keeps only the choice (which
 * entries, which agents) and asks the Claude Code binary how they stand;
 * it never sees a token.
 *
 *   GET    /api/claude-connections[?check=1]  → ClaudeConnectionsResponse
 *   PUT    /api/claude-connections/:id        ClaudeConnectionRequest → ClaudeConnectionsResponse
 *   DELETE /api/claude-connections/:id        → ClaudeConnectionsResponse
 *   POST   /api/claude-connections/:id/check  → ClaudeConnectionsResponse
 *
 * Errors: 404 `unknown_service` (no such entry, or not reachable through
 * Claude), 404 `unknown_agent`.
 */

export const ClaudeConnectionStateSchema = z.enum([
  /** Ready on the Claude account. */
  'connected',
  /** On the account but to sign in (again), or Claude Design without `/design-login`. */
  'needs_login',
  /** Not on the Claude account yet. */
  'missing',
  /** Not checked yet. */
  'unknown',
  'error',
]);
export type ClaudeConnectionState = z.infer<typeof ClaudeConnectionStateSchema>;

export const ClaudeConnectionViewSchema = z.object({
  /** The gallery entry (`MCP_CATALOG`). */
  id: McpCatalogIdSchema,
  /** Chosen in the gallery: the agents on Claude get it in their runs. */
  added: z.boolean(),
  /** Agents that may use it; `*` = the whole team (those that work with Claude). */
  agents: z.array(z.string()),
  /** The worst state of its parts (Gmail, Drive and Calendar for Google). */
  state: ClaudeConnectionStateSchema,
  parts: z.array(z.object({ name: z.string(), state: ClaudeConnectionStateSchema })),
  /** Last problem, in plain Italian. */
  message: z.string().optional(),
  checkedAt: z.number().int().optional(),
});
export type ClaudeConnectionView = z.infer<typeof ClaudeConnectionViewSchema>;

export const ClaudeConnectionsResponseSchema = z.object({
  /** The Claude plan is connected (Claude Agent on, signed in with a subscription). */
  claude: z.boolean(),
  connections: z.array(ClaudeConnectionViewSchema),
});
export type ClaudeConnectionsResponse = z.infer<typeof ClaudeConnectionsResponseSchema>;

export const ClaudeConnectionRequestSchema = z.object({
  agents: z
    .array(z.union([AgentIdSchema, z.literal('*')]))
    .max(50)
    .optional(),
});
export type ClaudeConnectionRequest = z.infer<typeof ClaudeConnectionRequestSchema>;
