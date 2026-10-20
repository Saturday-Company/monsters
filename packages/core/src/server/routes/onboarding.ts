import {
  MonsterRegenerateRequestSchema,
  OnboardingAnswersRequestSchema,
  TeamConfirmRequestSchema,
} from '@monsters/shared';
import type { Hono } from 'hono';
import { OnboardingError, type OnboardingService } from '../../onboarding/service.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';

/*
 * Onboarding API (contract at the bottom of shared/src/api.ts):
 *   GET  /api/onboarding                → OnboardingState
 *   POST /api/onboarding/answers        → OnboardingState
 *   POST /api/onboarding/team/propose   → OnboardingState (with the proposal)
 *   POST /api/onboarding/monster        → ProposedAgent (new genome)
 *   POST /api/onboarding/team/confirm   → { ok, agents, welcome }
 */

const STATUS: Record<OnboardingError['code'], 400 | 404 | 409> = {
  onboarding_done: 409,
  answers_incomplete: 409,
  no_proposal: 409,
  busy: 409,
  halted: 409,
  access_unavailable: 409,
  unknown_member: 404,
  invalid_request: 400,
  invalid_name: 400,
  invalid_folder: 400,
};

export function registerOnboardingRoutes(
  app: Hono<AppEnv>,
  h: RouteHelpers,
  onboarding: OnboardingService,
): void {
  const { requireAuth, parseBody } = h;

  const guard = async (
    run: () => Promise<Response>,
    c: { json: (b: unknown, s: 400 | 404 | 409) => Response },
  ) => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof OnboardingError) {
        return c.json({ error: err.code, message: err.message }, STATUS[err.code]);
      }
      throw err;
    }
  };

  app.get('/api/onboarding', requireAuth, (c) => c.json(onboarding.state()));

  app.post('/api/onboarding/answers', requireAuth, async (c) => {
    const body = await parseBody(c, OnboardingAnswersRequestSchema);
    if (!body.ok) return body.res;
    return guard(async () => c.json(await onboarding.submit(body.data)), c);
  });

  app.post('/api/onboarding/team/propose', requireAuth, async (c) =>
    guard(async () => c.json(await onboarding.propose(c.req.raw.signal)), c),
  );

  app.post('/api/onboarding/monster', requireAuth, async (c) => {
    const body = await parseBody(c, MonsterRegenerateRequestSchema);
    if (!body.ok) return body.res;
    return guard(() => Promise.resolve(c.json(onboarding.regenerate(body.data.id))), c);
  });

  app.post('/api/onboarding/team/confirm', requireAuth, async (c) => {
    const body = await parseBody(c, TeamConfirmRequestSchema);
    if (!body.ok) return body.res;
    return guard(async () => c.json({ ok: true, ...(await onboarding.confirm(body.data)) }), c);
  });
}
