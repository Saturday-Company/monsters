import { z } from 'zod';
import { AgentIdSchema } from './ids.ts';

/*
 * External tools through MCP (M2.5): servers the user adds from the settings
 * (a program on the computer, stdio, or an address, Streamable HTTP) and the
 * agents that may use them. The browser is a preset: the Playwright MCP server
 * with a profile of its own. Same rules as the rest of the API (JSON body,
 * anti-CSRF header, session or bearer). Values of variables and headers go in
 * and never come back: only their names.
 *
 *   GET    /api/mcp-servers              → McpServersResponse
 *   PUT    /api/mcp-servers/:name        McpServerRequest → McpServersResponse (add or change)
 *   DELETE /api/mcp-servers/:name        → McpServersResponse (stops it, forgets its secrets)
 *   POST   /api/mcp-servers/:name/test   → McpTestResponse (starts it, lists its tools)
 *   POST   /api/mcp-servers/:name/accept McpAcceptRequest → McpServersResponse (paused tools back, D-070)
 *   POST   /api/mcp-servers/:name/oauth  → McpOAuthStartResponse (OAuth sign-in, D-063)
 *   DELETE /api/mcp-servers/:name/oauth  → McpServersResponse (revokes and forgets the tokens)
 *   GET    /api/mcp-oauth/callback       redirect of the authorization server (checked by `state`)
 *   POST   /api/mcp-oauth/finish         McpOAuthFinishRequest → McpOAuthFinishResponse (the address
 *                                         of a callback page that did not open, pasted: D-072)
 *
 * Errors: 404 `unknown_server`, 400 `invalid_server` (with a message for the
 * UI), 404 `unknown_agent`, 409 `halted` (test while everything is stopped).
 */

/** Name of a server: part of the tool names (`mcp__<name>__<tool>`), so short and plain. */
export const McpServerNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,23}$/, 'lettere minuscole, cifre e trattini, al massimo 24');

/** Id of a gallery entry: also the default name of the server it adds. */
export const McpCatalogIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/);

/** Name of the browser preset. */
export const BROWSER_SERVER = 'browser';

/** Variable or header name. */
const McpKeySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/);

export const McpTransportSchema = z.enum(['stdio', 'http']);
export type McpTransport = z.infer<typeof McpTransportSchema>;

export const McpServerRequestSchema = z.object({
  /** `browser`: the Playwright preset (command and arguments are chosen by the core). */
  preset: z.literal('browser').optional(),
  label: z.string().trim().max(60).optional(),
  transport: McpTransportSchema.optional(),
  /** stdio: the program and its arguments. */
  command: z.string().trim().max(500).optional(),
  args: z.array(z.string().max(2000)).max(50).optional(),
  /** http: the address of the server. */
  url: z.string().trim().max(2000).optional(),
  /**
   * Variables (stdio) and headers (http). An empty value keeps the one saved;
   * a name left out is removed. Values are kept in `secrets/`, never in the log.
   */
  env: z.record(McpKeySchema, z.string().max(4000)).optional(),
  headers: z.record(McpKeySchema, z.string().max(4000)).optional(),
  enabled: z.boolean().optional(),
  /** Agents that may use it; `*` = the whole team, also future agents. */
  agents: z
    .array(z.union([AgentIdSchema, z.literal('*')]))
    .max(50)
    .optional(),
  /** Only these tools (names as the server gives them); missing or empty = all. */
  tools: z.array(z.string().min(1).max(200)).max(200).optional(),
  /** Longest wait for one call, in seconds. */
  timeoutSec: z.number().int().min(5).max(600).optional(),
  /** Browser preset: show the window instead of running hidden. */
  showWindow: z.boolean().optional(),
  /** http: sign in with OAuth (tokens kept by the core, never in the API). */
  oauth: z.boolean().optional(),
  /** Id of the gallery entry it was added from (`MCP_CATALOG`). */
  catalog: McpCatalogIdSchema.optional(),
});
export type McpServerRequest = z.infer<typeof McpServerRequestSchema>;

export const McpToolViewSchema = z.object({
  /** As the server names it. */
  name: z.string(),
  /** As the agents see it (`mcp__<server>__<tool>`). */
  agentName: z.string(),
  description: z.string(),
  /** Why the agents do not get it (invalid schema, name taken…). */
  skipped: z.string().optional(),
});
export type McpToolView = z.infer<typeof McpToolViewSchema>;

/**
 * A tool of a server that is new or changed since the user accepted the server
 * (D-070, research 07 §5.9): the agents do not get it until "Accetta". A tool
 * that changes its description is how a "rug pull" starts.
 */
export const McpPausedToolSchema = z.object({
  name: z.string(),
  change: z.enum(['new', 'changed']),
  /** Description now (clipped). */
  description: z.string(),
  /** Description accepted before (changed tools whose description changed). */
  before: z.string().optional(),
  /** The arguments changed (name, type, required…). */
  schemaChanged: z.boolean(),
  /** First seen like this (ms). */
  since: z.number(),
  /** Fingerprint of the tool as shown: "Accetta" sends it back (`seen`). */
  hash: z.string().optional(),
});
export type McpPausedTool = z.infer<typeof McpPausedToolSchema>;

export const McpAcceptRequestSchema = z.object({
  /** Tools to accept (names as the server gives them); missing = all the paused ones. */
  tools: z.array(z.string().min(1).max(200)).max(200).optional(),
  /**
   * Fingerprints of the tools as the card showed them (name → `hash`): only
   * those are accepted, a tool that changed again stays paused.
   */
  seen: z.record(z.string().min(1).max(200), z.string().max(100)).optional(),
});
export type McpAcceptRequest = z.infer<typeof McpAcceptRequestSchema>;

export const McpServerStatusSchema = z.enum(['off', 'idle', 'starting', 'running', 'error']);
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;

export const McpServerViewSchema = z.object({
  name: McpServerNameSchema,
  label: z.string(),
  preset: z.literal('browser').optional(),
  transport: McpTransportSchema,
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  /** Names only: the values stay on the computer. */
  envKeys: z.array(z.string()),
  headerKeys: z.array(z.string()),
  enabled: z.boolean(),
  agents: z.array(z.string()),
  tools: z.array(z.string()),
  timeoutSec: z.number().int(),
  showWindow: z.boolean().optional(),
  status: McpServerStatusSchema,
  /** Last problem, in plain Italian. */
  error: z.string().optional(),
  /** Tools seen at the last connection. */
  knownTools: z.array(McpToolViewSchema).optional(),
  /** Gallery entry it was added from. */
  catalog: z.string().optional(),
  /** Tools new or changed since accepted, paused until "Accetta" (D-070). */
  pausedTools: z.array(McpPausedToolSchema).optional(),
  /**
   * OAuth servers: signed in, or waiting for the browser. Never the tokens.
   * `needsSignIn`: the service refused a sign-in that worked ("Serve l’accesso").
   * `moreScope`: a call was refused for a permission the access lacks (`403
   * insufficient_scope`); the next «Collega» asks for these scopes (the access still works
   * for the rest).
   */
  oauth: z
    .object({
      connected: z.boolean(),
      pending: z.boolean(),
      needsSignIn: z.literal(true).optional(),
      moreScope: z.string().optional(),
    })
    .optional(),
});
export type McpServerView = z.infer<typeof McpServerViewSchema>;

export const McpServersResponseSchema = z.object({
  servers: z.array(McpServerViewSchema),
  agents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string(),
      isOrchestrator: z.boolean(),
      /** The browser needs the web: agents without it do not get it. */
      web: z.boolean(),
    }),
  ),
  /** The browser preset: package and folder of its profile. */
  browser: z.object({ package: z.string(), profileDir: z.string() }),
});
export type McpServersResponse = z.infer<typeof McpServersResponseSchema>;

export const McpTestResponseSchema = z.object({
  ok: z.boolean(),
  tools: z.array(McpToolViewSchema),
  error: z.string().optional(),
  /** Name and version the server gave. */
  server: z.string().optional(),
});
export type McpTestResponse = z.infer<typeof McpTestResponseSchema>;

/**
 * Start of an OAuth sign-in: the page of the service to open in the browser,
 * or `connected` when the saved tokens still work (refreshed if needed).
 */
export const McpOAuthStartResponseSchema = z.object({
  status: z.enum(['redirect', 'connected']),
  authorizationUrl: z.string().optional(),
  /**
   * Where the service sends the browser back: the loopback address the user's
   * browser reached the core at (its own computer, through the tunnel of the
   * app or of `ssh -L` when the core is elsewhere, D-072).
   */
  redirectUri: z.string(),
  /**
   * The page of `redirectUri` may not open (core reached on the network): after
   * the sign-in the user pastes its address into Monsters.
   */
  paste: z.boolean().optional(),
});
export type McpOAuthStartResponse = z.infer<typeof McpOAuthStartResponseSchema>;

/** The address of the page the service sent the browser back to (with `code` and `state`). */
export const McpOAuthFinishRequestSchema = z.object({
  url: z.string().trim().min(1).max(8000),
});
export type McpOAuthFinishRequest = z.infer<typeof McpOAuthFinishRequestSchema>;

export const McpOAuthFinishResponseSchema = z.object({
  ok: z.boolean(),
  /** In plain Italian, as the callback page says it. */
  message: z.string(),
});
export type McpOAuthFinishResponse = z.infer<typeof McpOAuthFinishResponseSchema>;

/**
 * An MCP server was added, changed, removed, connected, lost or could not
 * start (`message` in plain Italian). Never carries variables or headers.
 */
export const McpServerDataSchema = z.object({
  server: z.string().min(1),
  action: z.enum([
    'added',
    'changed',
    'removed',
    'connected',
    'disconnected',
    'failed',
    /** OAuth: the user signed in, or signed out (tokens revoked and forgotten). */
    'signed_in',
    'signed_out',
    /** OAuth: the service refused a sign-in that worked; the user is told (app, Telegram). */
    'needs_signin',
    /** Tools added or changed by the server and accepted without a pause (gallery, D-070). */
    'tools_updated',
  ]),
  transport: McpTransportSchema.optional(),
  tools: z.number().int().nonnegative().optional(),
  message: z.string().optional(),
  // Same values as ChannelSchema (events.ts imports this module).
  by: z.enum(['ui', 'cli', 'telegram', 'ssh', 'api', 'system', 'desktop', 'automation']).optional(),
});
