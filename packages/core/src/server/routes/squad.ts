import {
  MemoryOwnRequestSchema,
  ProfileUpdateSchema,
  TeamDraftRequestSchema,
  TeamLookRequestSchema,
  TeamLooksRequestSchema,
  TeamMemberCreateRequestSchema,
  TeamMemberUpdateSchema,
  TeamRestoreRequestSchema,
} from '@monsters/shared';
import type { Context, Hono } from 'hono';
import { TeamError, type TeamManager } from '../../team/team-manager.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';

/*
 * The team and the profile after the onboarding (Settings → Squadra; contract
 * in shared/src/team.ts). Changing files is allowed while Monsters is stopped
 * (it starts no work, and stopping is how to free a busy team); only the model
 * call of a made-to-measure draft is refused then.
 */

export const TEAM_ERROR_STATUS: Record<TeamError['code'], 400 | 404 | 409> = {
  onboarding_pending: 409,
  unknown_agent: 404,
  invalid_request: 400,
  invalid_name: 400,
  busy: 409,
  orchestrator: 400,
  instructions_edited: 409,
  memory_conflict: 409,
  color_too_close: 400,
  team_full: 409,
  name_taken: 409,
  halted: 409,
  unknown_proposal: 404,
  proposal_closed: 409,
  unknown_project: 404,
  project_draft: 409,
  project_archived: 409,
};

export function registerSquadRoutes(app: Hono<AppEnv>, h: RouteHelpers, team: TeamManager): void {
  const { requireAuth, parseBody, channelOf } = h;

  const guard = async (c: Context<AppEnv>, work: () => unknown, status: 200 | 201 = 200) => {
    try {
      return c.json(await work(), status);
    } catch (err) {
      if (err instanceof TeamError) {
        return c.json({ error: err.code, message: err.message }, TEAM_ERROR_STATUS[err.code]);
      }
      throw err;
    }
  };

  app.get('/api/team', requireAuth, (c) => guard(c, () => team.view()));

  // One monster of any squad, the personal one or a project's (D-097): its fields to edit.
  app.get('/api/team/agents/:id', requireAuth, (c) =>
    guard(c, () => team.member(c.req.param('id'))),
  );

  app.get('/api/team/suggestions', requireAuth, (c) => guard(c, () => team.suggestions()));

  app.post('/api/team/looks', requireAuth, async (c) => {
    const body = await parseBody(c, TeamLooksRequestSchema);
    if (!body.ok) return body.res;
    return guard(c, () => team.looks(body.data));
  });

  app.post('/api/team/drafts', requireAuth, async (c) => {
    const body = await parseBody(c, TeamDraftRequestSchema);
    if (!body.ok) return body.res;
    return guard(c, () => team.draft(body.data, c.req.raw.signal));
  });

  app.post('/api/team/agents', requireAuth, async (c) => {
    const body = await parseBody(c, TeamMemberCreateRequestSchema);
    if (!body.ok) return body.res;
    return guard(c, () => team.create(body.data, channelOf(c.get('auth'))), 201);
  });

  // A proposal of the capo squadra left aside (D-075); "Crea" is POST /api/team/agents.
  app.post('/api/team/proposals/:id/discard', requireAuth, (c) =>
    guard(c, () => team.discardProposal(c.req.param('id'), channelOf(c.get('auth')))),
  );

  app.patch('/api/team/agents/:id', requireAuth, async (c) => {
    const body = await parseBody(c, TeamMemberUpdateSchema);
    if (!body.ok) return body.res;
    return guard(c, () => team.update(c.req.param('id'), body.data, channelOf(c.get('auth'))));
  });

  app.put('/api/team/agents/:id/look', requireAuth, async (c) => {
    const body = await parseBody(c, TeamLookRequestSchema);
    if (!body.ok) return body.res;
    return guard(c, () =>
      team.setLook(c.req.param('id'), body.data.genome, channelOf(c.get('auth'))),
    );
  });

  // «È mia» on a line of the memory written after third-party text: OWNER_ONLY (app.ts).
  app.post('/api/team/agents/:id/memory/own', requireAuth, async (c) => {
    const body = await parseBody(c, MemoryOwnRequestSchema);
    if (!body.ok) return body.res;
    return guard(c, () => team.ownMemoryLine(c.req.param('id'), body.data.line));
  });

  app.delete('/api/team/agents/:id', requireAuth, (c) =>
    guard(c, () => team.archive(c.req.param('id'), channelOf(c.get('auth')))),
  );

  app.post('/api/team/archived/:id/restore', requireAuth, async (c) => {
    const body = await parseBody(c, TeamRestoreRequestSchema);
    if (!body.ok) return body.res;
    // Back with the Terminal it had: the same recent confirmation as giving it (n. 6, 19/10).
    if (team.restoreGivesShell([c.req.param('id')])) {
      const refused = h.requireRecent(c);
      if (refused) return refused;
    }
    return guard(c, () => team.restore(c.req.param('id'), body.data, channelOf(c.get('auth'))));
  });

  app.get('/api/profile', requireAuth, (c) => guard(c, () => team.profile()));

  app.put('/api/profile', requireAuth, async (c) => {
    const body = await parseBody(c, ProfileUpdateSchema);
    if (!body.ok) return body.res;
    return guard(c, () => team.updateProfile(body.data, channelOf(c.get('auth'))));
  });
}
