import { AutomationCreateSchema, AutomationUpdateSchema } from '@monsters/shared';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { AutomationError, type AutomationService } from '../../automations/service.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';

/*
 * Automations (D-094; contract in shared/src/automations.ts). Changing the
 * definitions is allowed while Monsters is stopped (it starts no work); "Esegui
 * ora" is refused then (409 `halted`).
 */

const RunsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).optional() });

export function registerAutomationRoutes(
  app: Hono<AppEnv>,
  h: RouteHelpers,
  automations: AutomationService,
): void {
  const { requireAuth, parseBody, channelOf } = h;

  const guard = (c: Context<AppEnv>, work: () => unknown, status: 200 | 201 | 202 = 200) => {
    try {
      return c.json(work(), status);
    } catch (err) {
      if (err instanceof AutomationError) {
        return c.json({ error: err.code, message: err.message }, err.status);
      }
      throw err;
    }
  };

  app.get('/api/automations', requireAuth, (c) => guard(c, () => automations.list()));

  app.post('/api/automations', requireAuth, async (c) => {
    const body = await parseBody(c, AutomationCreateSchema);
    if (!body.ok) return body.res;
    return guard(c, () => automations.create(body.data, channelOf(c.get('auth'))), 201);
  });

  app.get('/api/automations/:id', requireAuth, (c) =>
    guard(c, () => automations.get(c.req.param('id'))),
  );

  app.patch('/api/automations/:id', requireAuth, async (c) => {
    const body = await parseBody(c, AutomationUpdateSchema);
    if (!body.ok) return body.res;
    return guard(c, () =>
      automations.update(c.req.param('id'), body.data, channelOf(c.get('auth'))),
    );
  });

  app.delete('/api/automations/:id', requireAuth, (c) =>
    guard(c, () => {
      automations.remove(c.req.param('id'), channelOf(c.get('auth')));
      return { ok: true };
    }),
  );

  app.post('/api/automations/:id/pause', requireAuth, (c) =>
    guard(c, () => automations.pause(c.req.param('id'), channelOf(c.get('auth')))),
  );

  app.post('/api/automations/:id/resume', requireAuth, (c) =>
    guard(c, () => automations.resume(c.req.param('id'), channelOf(c.get('auth')))),
  );

  app.post('/api/automations/:id/run', requireAuth, (c) =>
    guard(c, () => automations.runNow(c.req.param('id'), channelOf(c.get('auth'))), 202),
  );

  app.get('/api/automations/:id/runs', requireAuth, (c) => {
    const q = RunsQuerySchema.safeParse(c.req.query());
    if (!q.success) return c.json({ error: 'invalid_request' }, 400);
    return guard(c, () => automations.runs(c.req.param('id'), q.data.limit));
  });

  app.get('/api/automations/:id/runs/:runId', requireAuth, (c) =>
    guard(c, () => automations.run(c.req.param('id'), c.req.param('runId'))),
  );
}
