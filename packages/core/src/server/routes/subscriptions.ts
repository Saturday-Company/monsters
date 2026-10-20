import { HarnessActivateRequestSchema } from '@monsters/shared';
import type { Context, Hono } from 'hono';
import type { Hub } from '../../hub.ts';
import { ProviderSetupError } from '../../providers/manager.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';

/*
 * Subscriptions API (contract in shared/src/providers.ts, M2.7): ChatGPT sign
 * in and out, Claude Agent and Codex on and off. Tokens never come back; the
 * Claude login is never handled here (only its state, asked to the binary).
 */

const STATUS: Record<ProviderSetupError['code'], 400 | 404 | 409 | 502> = {
  unknown_provider: 404,
  invalid_key: 400,
  verification_failed: 502,
  key_from_env: 409,
  invalid_request: 400,
};

export function registerSubscriptionRoutes(app: Hono<AppEnv>, h: RouteHelpers, hub: Hub): void {
  const { requireAuth, parseBody } = h;
  const subs = hub.subscriptions;

  const guard = async (c: Context<AppEnv>, work: () => unknown) => {
    try {
      return c.json(await work());
    } catch (err) {
      if (err instanceof ProviderSetupError) {
        return c.json({ error: err.code, message: err.message }, STATUS[err.code]);
      }
      throw err;
    }
  };

  app.get('/api/subscriptions', requireAuth, (c) =>
    guard(c, async () => {
      if (c.req.query('check') === '1' && subs.view().claude.state !== 'not_found') {
        await subs.checkClaude();
      }
      return subs.view();
    }),
  );

  app.post('/api/subscriptions/chatgpt/login', requireAuth, (c) =>
    guard(c, () => subs.startChatGPTLogin()),
  );

  app.delete('/api/subscriptions/chatgpt', requireAuth, (c) =>
    guard(c, async () => {
      await subs.signOutChatGPT();
      return subs.view();
    }),
  );

  app.post('/api/subscriptions/chatgpt/welcome', requireAuth, (c) =>
    guard(c, () => {
      subs.markWelcomeSeen();
      return subs.view();
    }),
  );

  app.post('/api/subscriptions/:id/activate', requireAuth, async (c) => {
    const body = await parseBody(c, HarnessActivateRequestSchema);
    if (!body.ok) return body.res;
    return guard(c, async () => {
      await subs.activate(c.req.param('id'), body.data.install);
      return subs.view();
    });
  });

  app.delete('/api/subscriptions/:id', requireAuth, (c) =>
    guard(c, () => {
      subs.deactivate(c.req.param('id'));
      return subs.view();
    }),
  );
}
