import { DraftKindSchema } from '@monsters/shared';
import type { Context, Hono } from 'hono';
import { AutomationError } from '../../automations/service.ts';
import type { Hub } from '../../hub.ts';
import { DraftError } from '../../projects/drafts.ts';
import { MemoryProposalError } from '../../team/memory-proposals.ts';
import { ProjectError } from '../../projects/service.ts';
import { TeamError } from '../../team/team-manager.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';
import { TEAM_ERROR_STATUS } from './squad.ts';

/*
 * Drafts (D-098; contract in shared/src/drafts.ts): what the monsters proposed
 * and waits for the user, in one list for "Da rivedere". Confirming and
 * discarding go through the flow of each kind (same checks as from the app),
 * allowed while Monsters is stopped: they start no work.
 */

export function registerDraftRoutes(app: Hono<AppEnv>, h: RouteHelpers, hub: Hub): void {
  const { requireAuth, channelOf } = h;

  const guard = async (c: Context<AppEnv>, work: () => unknown) => {
    try {
      return c.json(await work());
    } catch (err) {
      if (err instanceof DraftError) {
        return c.json({ error: err.code, message: err.message }, err.status);
      }
      if (err instanceof ProjectError || err instanceof AutomationError) {
        return c.json({ error: err.code, message: err.message }, err.status);
      }
      if (err instanceof MemoryProposalError) {
        return c.json({ error: err.code, message: err.message }, 503);
      }
      if (err instanceof TeamError) {
        return c.json({ error: err.code, message: err.message }, TEAM_ERROR_STATUS[err.code]);
      }
      throw err;
    }
  };
  const kindOf = (c: Context<AppEnv>) => DraftKindSchema.safeParse(c.req.param('kind'));

  app.get('/api/drafts', requireAuth, (c) => guard(c, () => hub.drafts.list()));

  app.post('/api/drafts/:kind/:id/confirm', requireAuth, (c) => {
    const kind = kindOf(c);
    if (!kind.success)
      return c.json({ error: 'unknown_draft', message: 'Bozza sconosciuta.' }, 404);
    return guard(c, () =>
      hub.drafts.confirm(kind.data, c.req.param('id'), channelOf(c.get('auth'))),
    );
  });

  app.post('/api/drafts/:kind/:id/discard', requireAuth, (c) => {
    const kind = kindOf(c);
    if (!kind.success)
      return c.json({ error: 'unknown_draft', message: 'Bozza sconosciuta.' }, 404);
    return guard(c, () =>
      hub.drafts.discard(kind.data, c.req.param('id'), channelOf(c.get('auth'))),
    );
  });
}
