import {
  EventInputSchema,
  ToolError,
  ulid,
  vaultLayout,
  type MonstersTool,
  type ToolContext,
} from '@monsters/shared';
import { EXTERNAL_ACTOR_PREFIX, externalVaultTools } from '@monsters/vault';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { Hub } from '../../hub.ts';
import type { RunController } from '../../kill/run-controller.ts';
import type { EventLog } from '../../log/event-log.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';
import { inputPaths, protectedNote, TOKEN_CLOSED_VAULT_TOOLS } from '../protected-notes.ts';

/*
 * Vault tools for external AI clients (the MCP server `monsters mcp`, D-002:
 * the core stays the only writer of the vault). The client is an actor of its
 * own, `mcp-<client>`, with the permissions of a sub-agent; every call is in
 * the action log (`tool_call`, `tool_result`, `vault_change` with the commit)
 * like a call made by an agent.
 *
 *   POST /api/vault/tools/:name   { input, client? } → { ok: true, output, source? }
 *                                                     | { ok: false, error: { code, message, hint? } }
 *
 * `source` is set when the output carries note contents (vault_read,
 * vault_search): the MCP server hands it to the client inside
 * `<dati_esterni fonte="…">` (D-021), like the agents get it.
 */

const CallSchema = z.object({
  input: z.unknown().optional(),
  /** Name of the MCP client (e.g. "claude-ai"): becomes the actor `mcp-<slug>`. */
  client: z.string().max(200).optional(),
});

const MAX_LOGGED_CHARS = 4000;

/** `mcp-<slug>` for a client name; `mcp-client` when it has no usable letters. */
export function externalActorId(client: string | undefined): string {
  const slug = (client ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `${EXTERNAL_ACTOR_PREFIX}${slug || 'client'}`;
}

function preview(value: unknown): unknown {
  let json: string;
  try {
    json = JSON.stringify(value) ?? 'null';
  } catch {
    return String(value);
  }
  if (json.length <= MAX_LOGGED_CHARS) return value;
  return { truncated: true, preview: `${json.slice(0, MAX_LOGGED_CHARS)}…`, chars: json.length };
}

function externalSource(tool: MonstersTool, input: unknown, output: unknown): string | null {
  if (!tool.externalSource) return null;
  try {
    return tool.externalSource(input, output);
  } catch {
    return tool.name;
  }
}

export function registerVaultToolRoutes(
  app: Hono<AppEnv>,
  h: RouteHelpers,
  deps: { hub: Hub; log: EventLog; runs: RunController },
): void {
  const { hub, log, runs } = deps;
  const tools = new Map<string, MonstersTool>(
    externalVaultTools(hub.vault).map((t) => [t.name, t]),
  );

  app.post('/api/vault/tools/:name', h.requireAuth, async (c) => {
    const name = c.req.param('name');
    const tool = tools.get(name);
    const body = await h.parseBody(c, CallSchema);
    if (!body.ok) return body.res;
    const agent = externalActorId(body.data.client);
    if (hub.team.get(agent)) {
      // Not logged: the call would be attributed to the agent with that id.
      return c.json({ error: 'invalid_client', message: `${agent} is the id of an agent` }, 409);
    }

    // Every call is in the action log, refused ones included (unknown tool,
    // kill switch): the user sees what an external client tried to do.
    const rawInput = body.data.input ?? {};
    const callId = ulid();
    const call = log.append({
      agent,
      type: 'tool_call',
      // Truncated like the output: a client may send a whole note (or more).
      data: { callId, tool: tool?.name ?? name.slice(0, 100), input: preview(rawInput) },
    });
    const started = Date.now();
    const finish = (ok: boolean, output: unknown, error?: string) =>
      log.append({
        agent,
        parentId: call.id,
        type: 'tool_result',
        data: {
          callId,
          tool: tool?.name ?? name.slice(0, 100),
          ok,
          output: preview(output),
          ...(error !== undefined ? { error } : {}),
          durationMs: Date.now() - started,
        },
      });

    if (!tool) {
      finish(false, { error: { code: 'UNKNOWN_TOOL' } }, 'UNKNOWN_TOOL: no such vault tool');
      return c.json({ error: 'unknown_tool', message: 'no such vault tool' }, 404);
    }
    // Kill switch: no agent works, external ones included.
    if (runs.halted) {
      const message = 'Monsters is stopped (kill switch): run "monsters resume" first';
      finish(false, { error: { code: 'HALTED', message } }, `HALTED: ${message}`);
      return c.json({ error: 'halted', message }, 409);
    }

    const ctx: ToolContext = {
      agentId: agent,
      runId: 'external',
      callEventId: call.id,
      signal: runs.signal,
      emit: (event) =>
        log.append(
          EventInputSchema.parse({ agent, parentId: call.id, type: event.type, data: event.data }),
        ),
    };

    try {
      const parsed = tool.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw new ToolError('INVALID_INPUT', z.prettifyError(parsed.error), {
          hint: 'Fix the arguments to match the tool schema and call it again.',
        });
      }
      // A monster's memory, the profile and the private notes: never written by the token
      // (review of ondate 3-4, n. 7), whatever the client's permissions in the vault.
      if (
        !tool.readOnly &&
        !h.isOwner(c.get('auth')) &&
        (TOKEN_CLOSED_VAULT_TOOLS.has(tool.name) || inputPaths(parsed.data).some(protectedNote))
      ) {
        throw new ToolError('BLOCKED_BY_POLICY', 'this note is written only by the user', {
          hint: `The memory of the monsters, the profile and ${vaultLayout().private}/ change only from the app.`,
        });
      }
      const output = await tool.execute(parsed.data, ctx);
      finish(true, output);
      const source = externalSource(tool, parsed.data, output);
      return c.json({ ok: true, output, ...(source !== null ? { source } : {}) });
    } catch (err) {
      const error =
        err instanceof ToolError
          ? { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) }
          : {
              code: 'INTERNAL',
              message: err instanceof Error ? err.message : String(err),
            };
      finish(false, { error }, `${error.code}: ${error.message}`);
      return c.json({ ok: false, error });
    }
  });
}
