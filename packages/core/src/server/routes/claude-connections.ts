import { ClaudeConnectionRequestSchema } from '@monsters/shared';
import type { Context, Hono } from 'hono';
import {
  ClaudeConnectionError,
  type ClaudeConnectionService,
} from '../../providers/claude-connections.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';

/*
 * Services connected through Claude (D-069, contract in
 * shared/src/claude-connections.ts): the choice of the gallery and the state
 * the Claude Code binary reports. No token goes through here.
 */

export function registerClaudeConnectionRoutes(
  app: Hono<AppEnv>,
  h: RouteHelpers,
  service: ClaudeConnectionService,
): void {
  const { requireAuth, parseBody, channelOf } = h;

  const guard = async (c: Context<AppEnv>, work: () => unknown) => {
    try {
      return c.json(await work());
    } catch (err) {
      if (err instanceof ClaudeConnectionError) {
        return c.json({ error: err.code, message: err.message }, 404);
      }
      throw err;
    }
  };

  app.get('/api/claude-connections', requireAuth, (c) =>
    guard(c, () => (c.req.query('check') === '1' ? service.check() : service.view())),
  );

  app.put('/api/claude-connections/:id', requireAuth, async (c) => {
    const body = await parseBody(c, ClaudeConnectionRequestSchema);
    if (!body.ok) return body.res;
    return guard(c, async () => {
      const id = c.req.param('id');
      const added = !service.view().connections.some((x) => x.id === id && x.added);
      service.set(id, body.data.agents, channelOf(c.get('auth')));
      // A service just added is checked at once: the panel shows how it stands.
      return added ? service.check(id) : service.view();
    });
  });

  app.delete('/api/claude-connections/:id', requireAuth, (c) =>
    guard(c, () => service.remove(c.req.param('id'), channelOf(c.get('auth')))),
  );

  app.post('/api/claude-connections/:id/check', requireAuth, (c) =>
    guard(c, () => service.check(c.req.param('id'))),
  );
}
