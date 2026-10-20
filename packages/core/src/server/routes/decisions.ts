import { DecisionsUpdateSchema, TypeSafeKeyRequestSchema } from '@monsters/shared';
import type { Context, Hono } from 'hono';
import { DecisionEngineError, type DecisionEngineService } from '../../team/decision-engine.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';

/*
 * Engine of the DecisionGate and the TypeSafe key (contract in
 * shared/src/decisions.ts). The key never comes back.
 */

const STATUS: Record<DecisionEngineError['code'], 400 | 409 | 502> = {
  no_key: 409,
  invalid_key: 400,
  verification_failed: 502,
  key_from_env: 409,
  mode_not_available: 400,
};

function fail(c: Context, err: unknown): Response {
  if (err instanceof DecisionEngineError) {
    return c.json({ error: err.code, message: err.message }, STATUS[err.code]);
  }
  throw err;
}

export function registerDecisionRoutes(
  app: Hono<AppEnv>,
  h: RouteHelpers,
  decisions: DecisionEngineService,
): void {
  const { requireAuth, parseBody } = h;

  app.get('/api/settings/decisions', requireAuth, (c) => c.json(decisions.view()));

  app.put('/api/settings/decisions', requireAuth, async (c) => {
    const body = await parseBody(c, DecisionsUpdateSchema);
    if (!body.ok) return body.res;
    try {
      return c.json(decisions.setEngine(body.data.engine));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.put('/api/settings/typesafe-key', requireAuth, async (c) => {
    const body = await parseBody(c, TypeSafeKeyRequestSchema);
    if (!body.ok) return body.res;
    try {
      return c.json(await decisions.setKey(body.data.key));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.delete('/api/settings/typesafe-key', requireAuth, (c) => {
    try {
      return c.json(decisions.removeKey());
    } catch (err) {
      return fail(c, err);
    }
  });
}
