import { InstinctUpdateSchema, type Receipt } from '@monsters/shared';
import type { Hono } from 'hono';
import type { Hub } from '../../hub.ts';
import type { EventLog } from '../../log/event-log.ts';
import { DecisionEngineError } from '../../team/decision-engine.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';
import { serverStrings } from '../server.strings.ts';

/*
 * The instinct (D-067; contract in shared/src/instinct.ts): engine and modes
 * of the uses, the pagella dei mostri, the receipts of a run and "Annulla
 * tutto il lavoro".
 */

const STATUS: Record<DecisionEngineError['code'], 400 | 409 | 502> = {
  no_key: 409,
  invalid_key: 400,
  verification_failed: 502,
  key_from_env: 409,
  mode_not_available: 400,
};

/** Run ids are ULIDs; anything else is not a run of this core. */
const RUN_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function registerInstinctRoutes(
  app: Hono<AppEnv>,
  h: RouteHelpers,
  deps: { hub: Hub; log: EventLog },
): void {
  const { requireAuth, parseBody } = h;
  const { hub, log } = deps;

  app.get('/api/settings/instinct', requireAuth, (c) => c.json(hub.decisions.instinctView()));

  app.put('/api/settings/instinct', requireAuth, async (c) => {
    const body = await parseBody(c, InstinctUpdateSchema);
    if (!body.ok) return body.res;
    try {
      return c.json(hub.decisions.updateInstinct(body.data));
    } catch (err) {
      if (err instanceof DecisionEngineError) {
        return c.json({ error: err.code, message: err.message }, STATUS[err.code]);
      }
      throw err;
    }
  });

  app.get('/api/instinct/scorecard', requireAuth, (c) => c.json(hub.instinct.scorecard.view()));

  app.get('/api/runs/:runId/receipts', requireAuth, (c) => {
    const runId = c.req.param('runId');
    if (!RUN_ID.test(runId)) return c.json({ error: 'not_found' }, 404);
    const receipts: Receipt[] = [];
    for (const e of log.query({ runId, type: 'receipt', order: 'asc', limit: 1000 })) {
      if (e.type === 'receipt') receipts.push({ ...e.data, id: e.id, ts: e.ts, runId });
    }
    return c.json(receipts);
  });

  app.post('/api/runs/:runId/undo', requireAuth, async (c) => {
    const runId = c.req.param('runId');
    if (!RUN_ID.test(runId) || log.query({ runId, limit: 1 }).length === 0) {
      return c.json({ error: 'not_found', message: serverStrings().unknownTask }, 404);
    }
    return c.json(await hub.undoRun(runId));
  });
}
