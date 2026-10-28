import { PermissionsUpdateRequestSchema } from '@monsters/shared';
import type { Hono } from 'hono';
import { recentProofOf } from '../../auth/recent.ts';
import { PermissionsError, type PermissionsService } from '../../team/permissions.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';

/*
 * Permissions of the agents after the onboarding (contract in
 * shared/src/permissions.ts):
 *   GET /api/permissions   → PermissionsResponse
 *   PUT /api/permissions   → PermissionsResponse (defaults and/or per agent)
 * Allowed while halted: changing permissions starts no work.
 */

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
    // Turning on the Terminal of a monster wants the password typed in the last minutes: the
    // service decides (`ConfirmRequiredError` → 403 `confirm_required`, app.ts).
    try {
      return c.json(
        await permissions.update(body.data, channelOf(c.get('auth')), recentProofOf(c.get('auth'))),
      );
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
