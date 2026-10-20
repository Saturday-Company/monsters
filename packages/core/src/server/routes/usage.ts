import type { Hono } from 'hono';
import type { Hub } from '../../hub.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';

/*
 * The Consumi panel of a monster (D-075; contract in shared/src/usage.ts): the
 * context of its latest step, the totals of its current conversation, today and
 * this month against the spending caps.
 */

export function registerUsageRoutes(app: Hono<AppEnv>, h: RouteHelpers, deps: { hub: Hub }): void {
  const { requireAuth } = h;
  const { hub } = deps;

  app.get('/api/agents/:id/usage', requireAuth, async (c) => {
    const id = c.req.param('id');
    const agent = hub.team.get(id);
    if (!agent) return c.json({ error: 'unknown_agent' }, 404);
    // The share of the window follows the model the monster has now (D-086).
    return c.json(await hub.usage.view(id, agent.config.models));
  });
}
