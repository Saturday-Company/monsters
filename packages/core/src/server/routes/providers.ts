import {
  AgentModelsRequestSchema,
  AUTO_MODELS_PROVIDER,
  autoChain,
  isOpenRouterFreeModel,
  ProviderKeyRequestSchema,
  ProviderUrlRequestSchema,
  type AgentModels,
  type AutoBase,
  type ProvidersResponse,
} from '@monsters/shared';
import type { AgentDefinition } from '../../agents/definition.ts';
import type { Context, Hono } from 'hono';
import type { Hub } from '../../hub.ts';
import { ProviderSetupError } from '../../providers/manager.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';
import { serverStrings } from '../server.strings.ts';

/*
 * Providers API (contract in shared/src/providers.ts): keys and local servers
 * of the providers, their models, the fallback chain of each agent. Keys go in
 * and never come back out.
 */

const STATUS: Record<ProviderSetupError['code'], 400 | 404 | 409 | 502> = {
  unknown_provider: 404,
  invalid_key: 400,
  verification_failed: 502,
  key_from_env: 409,
  invalid_request: 400,
};

/**
 * The base "Automatica" starts from: Media for everyone (D-110), the coordinators and the
 * developers too (before, D-093, they started Forte): Sonnet for Semplice and Media, Opus
 * for Difficile. Leggera and Forte stay for whoever picks them by hand.
 */
export function suggestedAutoBase(
  _agent: AgentDefinition,
  _permissions: { shell?: boolean; folders?: readonly unknown[] },
): AutoBase {
  return 'medium';
}

function agentModels(hub: Hub): AgentModels[] {
  return hub.team.list().map((a) => ({
    id: a.config.id,
    name: a.config.name,
    color: a.config.color,
    isOrchestrator: a.config.kind === 'orchestrator',
    models: a.config.models.map((m) => ({
      provider: m.provider,
      model: m.model,
      ...(m.tier ? { tier: m.tier } : {}),
    })),
    ...(a.config.autoModels ? { auto: { base: a.config.autoModels.base } } : {}),
    suggestedBase: suggestedAutoBase(a, hub.team.permissionsFor(a.config.id)),
  }));
}

export function registerProviderRoutes(app: Hono<AppEnv>, h: RouteHelpers, hub: Hub): void {
  const { requireAuth, parseBody } = h;
  const setup = hub.providerSetup;

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

  app.get('/api/providers', requireAuth, (c) => {
    const body: ProvidersResponse = { providers: setup.view(), agents: agentModels(hub) };
    return c.json(body);
  });

  app.put('/api/providers/:id/key', requireAuth, async (c) => {
    const body = await parseBody(c, ProviderKeyRequestSchema);
    if (!body.ok) return body.res;
    return guard(c, () => setup.setKey(c.req.param('id'), body.data.key));
  });

  app.delete('/api/providers/:id/key', requireAuth, (c) =>
    guard(c, () => setup.removeKey(c.req.param('id'))),
  );

  app.put('/api/providers/:id/url', requireAuth, async (c) => {
    const body = await parseBody(c, ProviderUrlRequestSchema);
    if (!body.ok) return body.res;
    return guard(c, () => setup.setLocal(c.req.param('id'), body.data.baseURL));
  });

  app.delete('/api/providers/:id/url', requireAuth, (c) =>
    guard(c, () => setup.removeLocal(c.req.param('id'))),
  );

  app.get('/api/providers/:id/models', requireAuth, (c) =>
    guard(c, async () => {
      const tools = c.req.query('tools');
      const models = await setup.models(c.req.param('id'), {
        ...(tools === '1' ? { tools: true } : {}),
        refresh: c.req.query('refresh') === '1',
      });
      return { models };
    }),
  );

  app.put('/api/agents/:id/models', requireAuth, async (c) => {
    const body = await parseBody(c, AgentModelsRequestSchema);
    if (!body.ok) return body.res;
    const agent = hub.team.get(c.req.param('id'));
    if (!agent) return c.json({ error: 'unknown_agent' }, 404);
    // "Automatica" (D-093): the core writes the chain of the base, whatever came with it.
    const auto = body.data.auto;
    if (auto && !hub.providers.has(AUTO_MODELS_PROVIDER)) {
      return c.json(
        {
          error: 'not_configured',
          message: serverStrings().autoNeedsClaude,
        },
        400,
      );
    }
    const models = auto ? autoChain(auto.base) : body.data.models;
    const missing = models.find((m) => !hub.providers.has(m.provider));
    if (missing) {
      return c.json(
        {
          error: 'not_configured',
          message: serverStrings().providerNotConfigured(missing.provider),
        },
        400,
      );
    }
    // A paid OpenRouter model would only fail at run time: say it now, in words.
    const paid = hub.settingsView().openrouterKey.freeOnly
      ? models.find((m) => m.provider === 'openrouter' && !isOpenRouterFreeModel(m.model))
      : undefined;
    if (paid) {
      return c.json(
        {
          error: 'paid_model_blocked',
          message: serverStrings().paidModelBlocked(paid.model),
        },
        400,
      );
    }
    await hub.team.setModels(agent.config.id, models, auto);
    return c.json(agentModels(hub).find((a) => a.id === agent.config.id));
  });
}
