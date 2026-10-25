import { RunLimitsUpdateSchema, SpendUpdateSchema } from '@monsters/shared';
import type { Hono } from 'hono';
import type { Hub } from '../../hub.ts';
import { SpendError } from '../../team/spend.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';

/*
 * Spending caps (D-070; contract in shared/src/spend.ts): what the team spent
 * today and this month, in euros, and the caps of the team and of each monster.
 * The limits of each job (steps, tokens, cost; contract in shared/src/limits.ts) live here too:
 * the settings show them under the spending cap.
 */

export function registerSpendRoutes(app: Hono<AppEnv>, h: RouteHelpers, deps: { hub: Hub }): void {
  const { requireAuth, parseBody } = h;
  const { hub } = deps;

  app.get('/api/settings/spend', requireAuth, (c) => c.json(hub.spend.view()));

  app.put('/api/settings/spend', requireAuth, async (c) => {
    const body = await parseBody(c, SpendUpdateSchema);
    if (!body.ok) return body.res;
    try {
      return c.json(hub.spend.update(body.data));
    } catch (err) {
      if (err instanceof SpendError) return c.json({ error: err.code, message: err.message }, 404);
      throw err;
    }
  });

  app.get('/api/settings/limits', requireAuth, (c) => c.json(hub.runLimits.view()));

  app.put('/api/settings/limits', requireAuth, async (c) => {
    const body = await parseBody(c, RunLimitsUpdateSchema);
    if (!body.ok) return body.res;
    return c.json(hub.runLimits.update(body.data));
  });

  app.delete('/api/settings/limits', requireAuth, (c) => c.json(hub.runLimits.reset()));
}
