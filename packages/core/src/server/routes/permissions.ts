import {
  PermissionsUpdateRequestSchema,
  type PermissionsResponse,
  type PermissionsUpdateRequest,
} from '@monsters/shared';
import type { Hono } from 'hono';
import { PermissionsError, type PermissionsService } from '../../team/permissions.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';

/*
 * Permissions of the agents after the onboarding (contract in
 * shared/src/permissions.ts):
 *   GET /api/permissions   → PermissionsResponse
 *   PUT /api/permissions   → PermissionsResponse (defaults and/or per agent)
 * Allowed while halted: changing permissions starts no work.
 */

/** True when `req` gives the Terminal to a monster (or to the defaults) that did not have it. */
export function grantsShell(req: PermissionsUpdateRequest, now: PermissionsResponse): boolean {
  const defaults = req.defaults ? req.defaults.shell === true : now.defaults.shell === true;
  if (defaults && now.defaults.shell !== true) return true;
  for (const view of now.agents) {
    const own = req.agents?.[view.id];
    let next: boolean;
    // Untouched: it follows the new defaults only when it has no permissions of its own.
    if (own === undefined) next = view.custom ? view.permissions.shell === true : defaults;
    else next = own === null ? defaults : own.shell === true;
    if (next && view.permissions.shell !== true) return true;
  }
  return false;
}

export function registerPermissionRoutes(
  app: Hono<AppEnv>,
  h: RouteHelpers,
  permissions: PermissionsService,
): void {
  const { requireAuth, parseBody, channelOf } = h;

  app.get('/api/permissions', requireAuth, (c) => c.json(permissions.view()));

  app.put('/api/permissions', requireAuth, async (c) => {
    const body = await parseBody(c, PermissionsUpdateRequestSchema);
    if (!body.ok) return body.res;
    // Turning on the Terminal of a monster needs the password typed in the last minutes
    // (`RECENT_ONLY` in app.ts): it is worth the user's whole account.
    if (grantsShell(body.data, permissions.view())) {
      const refused = h.requireRecent(c);
      if (refused) return refused;
    }
    try {
      return c.json(await permissions.update(body.data, channelOf(c.get('auth'))));
    } catch (err) {
      if (err instanceof PermissionsError) {
        return c.json(
          {
            error: err.code,
            message: err.message,
            ...(err.path !== undefined ? { path: err.path } : {}),
          },
          err.code === 'unknown_agent' ? 404 : 400,
        );
      }
      throw err;
    }
  });
}
