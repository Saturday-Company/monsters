import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Hono } from 'hono';
import type { HarnessToolSessions } from '../../agents/harness-tools.ts';
import { harnessMcpServer } from '../../agents/harness-tools.ts';
import type { AppEnv } from '../app.ts';

/*
 * MCP endpoint of the harness runs (M2.7): `ALL /api/harness/mcp` with the
 * bearer token of one agent run (`HarnessToolSessions`). Not a user session:
 * the token opens only that run's tools and dies with the run. Host, Origin
 * and JSON checks of the app apply as everywhere.
 */

export const HARNESS_MCP_PATH = '/api/harness/mcp';
/**
 * Hooks of the harness runs (D-069): `POST /api/harness/hook` with the same
 * bearer token of the run, the hook input of Claude Code as the body, the
 * hook's answer as the response (it may wait for the user's answer to a card).
 */
export const HARNESS_HOOK_PATH = '/api/harness/hook';

const sessionOf = (sessions: HarnessToolSessions, auth: string | undefined) =>
  sessions.get(/^Bearer\s+(\S+)$/i.exec(auth ?? '')?.[1]);

export function registerHarnessMcpRoutes(
  app: Hono<AppEnv>,
  deps: { sessions: HarnessToolSessions; version: string },
): void {
  app.post(HARNESS_HOOK_PATH, async (c) => {
    const session = sessionOf(deps.sessions, c.req.header('authorization'));
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    return c.json(await session.hook(body, c.req.raw.signal));
  });

  const handlers = new WeakMap<object, ReturnType<typeof createMcpHandler>>();
  app.all(HARNESS_MCP_PATH, async (c) => {
    const session = sessionOf(deps.sessions, c.req.header('authorization'));
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    let handler = handlers.get(session);
    if (!handler) {
      handler = createMcpHandler(() => harnessMcpServer(session, deps.version), {
        legacy: 'stateless',
      });
      handlers.set(session, handler);
    }
    return handler.fetch(c.req.raw);
  });
}
