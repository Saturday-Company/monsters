import {
  ProjectCreateRequestSchema,
  ProjectMemberRequestSchema,
  ProjectMessageRequestSchema,
  ProjectUpdateRequestSchema,
} from '@monsters/shared';
import type { Context, Hono } from 'hono';
import type { Hub } from '../../hub.ts';
import { HaltedError } from '../../kill/run-controller.ts';
import { ProjectError } from '../../projects/service.ts';
import { DispatchError } from '../../team/dispatcher.ts';
import { TeamError } from '../../team/team-manager.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';
import { TEAM_ERROR_STATUS } from './squad.ts';

/*
 * Projects (D-097; contract in shared/src/projects.ts), with the same access
 * and origin checks as the rest of the API (session or bearer, anti-CSRF
 * header, JSON body). Changing a project is allowed while Monsters is stopped
 * (it starts no work); a message to a project is refused then (409 `halted`).
 */

const ONBOARDING_PENDING = 'Completa prima il primo avvio: la squadra non esiste ancora.';

export function registerProjectRoutes(app: Hono<AppEnv>, h: RouteHelpers, hub: Hub): void {
  const { requireAuth, parseBody, channelOf } = h;
  const projects = hub.projects;

  const guard = async (c: Context<AppEnv>, work: () => unknown, status: 200 | 201 | 202 = 200) => {
    try {
      return c.json(await work(), status);
    } catch (err) {
      if (err instanceof ProjectError) {
        return c.json({ error: err.code, message: err.message }, err.status);
      }
      if (err instanceof TeamError) {
        return c.json({ error: err.code, message: err.message }, TEAM_ERROR_STATUS[err.code]);
      }
      if (err instanceof HaltedError) return c.json({ error: 'halted', message: err.message }, 409);
      if (err instanceof DispatchError) {
        return c.json(
          { error: err.code, message: err.message },
          err.code === 'unknown_agent' ? 404 : 409,
        );
      }
      throw err;
    }
  };
  /** No project before the first start: its lead would be a monster with no team. */
  const ready = (c: Context<AppEnv>) =>
    hub.onboarding.done
      ? null
      : c.json({ error: 'onboarding_pending', message: ONBOARDING_PENDING }, 409);

  app.get('/api/projects', requireAuth, (c) => guard(c, () => projects.list()));

  app.post('/api/projects', requireAuth, async (c) => {
    const pending = ready(c);
    if (pending) return pending;
    const body = await parseBody(c, ProjectCreateRequestSchema);
    if (!body.ok) return body.res;
    return guard(c, () => projects.create(body.data, channelOf(c.get('auth'))), 201);
  });

  app.get('/api/projects/:id', requireAuth, (c) => guard(c, () => projects.get(c.req.param('id'))));

  app.patch('/api/projects/:id', requireAuth, async (c) => {
    const pending = ready(c);
    if (pending) return pending;
    const body = await parseBody(c, ProjectUpdateRequestSchema);
    if (!body.ok) return body.res;
    return guard(c, () => projects.update(c.req.param('id'), body.data, channelOf(c.get('auth'))));
  });

  app.post('/api/projects/:id/archive', requireAuth, (c) =>
    guard(c, () => projects.archive(c.req.param('id'), channelOf(c.get('auth')))),
  );

  // A draft confirmed: lead, monsters and first automations together, or nothing (D-098).
  app.post('/api/projects/:id/confirm', requireAuth, (c) => {
    const pending = ready(c);
    if (pending) return pending;
    return guard(c, () => projects.confirm(c.req.param('id'), channelOf(c.get('auth'))));
  });

  // A draft left aside (D-098); an active project is archived instead.
  app.delete('/api/projects/:id', requireAuth, (c) =>
    guard(c, () => projects.discard(c.req.param('id'), channelOf(c.get('auth')))),
  );

  app.post('/api/projects/:id/restore', requireAuth, (c) => {
    // Its monsters back with the Terminal they had: a recent confirmation (n. 6, 19/10).
    if (hub.squad.restoreGivesShell(projects.archivedSquad(c.req.param('id')))) {
      const refused = h.requireRecent(c);
      if (refused) return refused;
    }
    return guard(c, () => projects.restore(c.req.param('id'), channelOf(c.get('auth'))));
  });

  // "Ferma progetto" (D-098): the runs of its monsters, not the kill switch.
  app.post('/api/projects/:id/stop', requireAuth, (c) =>
    guard(c, () => projects.stop(c.req.param('id'), channelOf(c.get('auth')))),
  );

  // "Approva" (D-103): CLAUDE.md and AGENTS.md of the folder as they are now are the user's.
  app.post('/api/projects/:id/folder-docs/approve', requireAuth, (c) =>
    guard(c, () => projects.approveDocs(c.req.param('id'), channelOf(c.get('auth')))),
  );

  app.post('/api/projects/:id/members', requireAuth, async (c) => {
    const pending = ready(c);
    if (pending) return pending;
    const body = await parseBody(c, ProjectMemberRequestSchema);
    if (!body.ok) return body.res;
    return guard(
      c,
      () => projects.addMember(c.req.param('id'), body.data, channelOf(c.get('auth'))),
      201,
    );
  });

  app.delete('/api/projects/:id/members/:agent', requireAuth, (c) =>
    guard(c, () =>
      projects.removeMember(c.req.param('id'), c.req.param('agent'), channelOf(c.get('auth'))),
    ),
  );

  app.post('/api/projects/:id/messages', requireAuth, async (c) => {
    const pending = ready(c);
    if (pending) return pending;
    const body = await parseBody(c, ProjectMessageRequestSchema);
    if (!body.ok) return body.res;
    const unknownFile = body.data.attachments?.find((id) => !hub.files.get(id));
    if (unknownFile) {
      return c.json(
        { error: 'unknown_file', message: 'Un allegato non c’è più: toglilo e riprova.' },
        404,
      );
    }
    return guard(
      c,
      () =>
        projects.send(c.req.param('id'), {
          text: body.data.text,
          channel: channelOf(c.get('auth')),
          attachments: body.data.attachments,
        }),
      202,
    );
  });

  app.get('/api/projects/:id/spend', requireAuth, (c) =>
    guard(c, () => projects.spend(c.req.param('id'))),
  );
}
