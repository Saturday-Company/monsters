import {
  AnswerRequestSchema,
  BraveKeyRequestSchema,
  LanguageRequestSchema,
  NewConversationRequestSchema,
  OpenRouterKeyRequestSchema,
  OpenRouterSettingsRequestSchema,
  SendMessageRequestSchema,
  ToolError,
  UndoRequestSchema,
  WebSearchSettingsRequestSchema,
  type Question,
} from '@monsters/shared';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { Hub } from '../../hub.ts';
import { HaltedError } from '../../kill/run-controller.ts';
import { DispatchError } from '../../team/dispatcher.ts';
import { QuestionError } from '../../team/questions.ts';
import { ownerRequired, type AppEnv, type RouteHelpers } from '../app.ts';
import { serverStrings } from '../server.strings.ts';

/*
 * Team and conversation API (contract at the bottom of shared/src/api.ts):
 *   GET  /api/agents                    → AgentSummary[]
 *   POST /api/messages                  → { runId }
 *   POST /api/conversations             → { id, ts, to? } (new conversation: older turns leave
 *                                         the model's context, they stay in the log)
 *   GET  /api/questions?status=open     → Question[]
 *   POST /api/questions/:id/answer      → Question
 *   POST /api/vault/undo                → { ok, commit }
 *   POST /api/vault/reindex             → { ok, files, ms }
 *   GET  /api/settings                  → { openrouterKey: { set, freeOnly, label? }, braveKey: { set },
 *                                           vaultPath, userName }
 *   PUT  /api/settings/openrouter-key   → verifies and saves; the key never comes back
 *   PUT  /api/settings/openrouter       → { freeOnly }: paid models on or off, at once
 *   PUT  /api/settings/brave-key        → saves the web search key; it never comes back
 *   PUT  /api/settings/web-search       → { mode?, engine? }: the paid web search (D-071)
 */

const QuestionsQuerySchema = z.object({
  status: z.enum(['open', 'answered', 'expired']).optional(),
  runId: z.string().optional(),
});

const TOOL_ERROR_STATUS: Partial<Record<ToolError['code'], 400 | 404 | 409>> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_INPUT: 400,
  UNAVAILABLE: 409,
  USER_DECLINED: 409,
  SETTING_OFF: 409,
  BLOCKED_BY_POLICY: 409,
  NOT_IN_RUN: 409,
};

export function registerTeamRoutes(app: Hono<AppEnv>, h: RouteHelpers, hub: Hub): void {
  const { requireAuth, parseBody, channelOf, isOwner } = h;

  app.get('/api/agents', requireAuth, (c) => c.json(hub.team.summaries()));

  app.post('/api/messages', requireAuth, async (c) => {
    const body = await parseBody(c, SendMessageRequestSchema);
    if (!body.ok) return body.res;
    // No team until the first start is completed in the UI: no default team behind its back.
    if (!hub.onboarding.done) {
      return c.json(
        { error: 'onboarding_pending', message: serverStrings().onboardingPendingTeam },
        409,
      );
    }
    const unknownFile = body.data.attachments?.find((id) => !hub.files.get(id));
    if (unknownFile) {
      return c.json({ error: 'unknown_file', message: serverStrings().attachmentGone }, 404);
    }
    try {
      const sent = hub.send({
        ...body.data,
        channel: channelOf(c.get('auth')),
        ...(isOwner(c.get('auth')) ? {} : { notOwner: true }),
      });
      return c.json(sent, 202);
    } catch (err) {
      if (err instanceof HaltedError) {
        return c.json({ error: 'halted', message: err.message }, 409);
      }
      if (err instanceof DispatchError) {
        return c.json(
          { error: err.code, message: err.message },
          err.code === 'unknown_agent' ? 404 : 409,
        );
      }
      throw err;
    }
  });

  // New conversation (UI button, CLI `/nuova`, Telegram `/new` later). Allowed
  // while halted: it starts no work. 409 `busy` while an agent it applies to works.
  app.post('/api/conversations', requireAuth, async (c) => {
    const body = await parseBody(c, NewConversationRequestSchema);
    if (!body.ok) return body.res;
    if (!hub.onboarding.done) {
      return c.json(
        { error: 'onboarding_pending', message: serverStrings().onboardingPendingTeam },
        409,
      );
    }
    try {
      const event = hub.newConversation({ ...body.data, channel: channelOf(c.get('auth')) });
      return c.json(
        { id: event.id, ts: event.ts, ...(event.data.to ? { to: event.data.to } : {}) },
        201,
      );
    } catch (err) {
      if (err instanceof DispatchError) {
        return c.json(
          { error: err.code, message: err.message },
          err.code === 'unknown_agent' ? 404 : 409,
        );
      }
      throw err;
    }
  });

  app.get('/api/questions', requireAuth, (c) => {
    const parsed = QuestionsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const list: Question[] = hub.questions.list(parsed.data);
    return c.json(list);
  });

  app.post('/api/questions/:id/answer', requireAuth, async (c) => {
    const body = await parseBody(c, AnswerRequestSchema);
    if (!body.ok) return body.res;
    // A card of the brake (and a request of an access, D-130) is the user's in person: never
    // the CLI token, which a monster with the terminal can read (review of 18/10, M1). Its
    // other questions stay open to the CLI.
    if (hub.questions.ownerOnly(c.req.param('id')) && !isOwner(c.get('auth'))) {
      return c.json(ownerRequired(), 403);
    }
    try {
      return c.json(hub.answer(c.req.param('id'), body.data, channelOf(c.get('auth'))));
    } catch (err) {
      if (err instanceof QuestionError) {
        const status = err.code === 'not_found' ? 404 : err.code === 'not_open' ? 409 : 400;
        return c.json({ error: err.code, message: err.message }, status);
      }
      throw err;
    }
  });

  app.post('/api/vault/undo', requireAuth, async (c) => {
    const body = await parseBody(c, UndoRequestSchema);
    if (!body.ok) return body.res;
    try {
      const result = await hub.undo(body.data.actionId, { force: body.data.force });
      return c.json({
        ok: true,
        ...(result.commit ? { commit: result.commit } : {}),
        files: result.files,
      });
    } catch (err) {
      if (err instanceof ToolError) {
        const files = (err.details as { files?: unknown } | undefined)?.files;
        return c.json(
          {
            error: err.code.toLowerCase(),
            message: err.message,
            ...(Array.isArray(files) ? { files: files.map(String) } : {}),
          },
          TOOL_ERROR_STATUS[err.code] ?? 400,
        );
      }
      throw err;
    }
  });

  app.post('/api/vault/reindex', requireAuth, async (c) => {
    const result = await hub.vault.reindex();
    return c.json({ ok: true, ...result, vault: hub.vault.root });
  });

  app.get('/api/settings', requireAuth, (c) => c.json(hub.settingsView()));

  app.put('/api/settings/language', requireAuth, async (c) => {
    const body = await parseBody(c, LanguageRequestSchema);
    if (!body.ok) return body.res;
    return c.json(hub.setLanguage(body.data.language));
  });

  app.put('/api/settings/openrouter-key', requireAuth, async (c) => {
    const body = await parseBody(c, OpenRouterKeyRequestSchema);
    if (!body.ok) return body.res;
    const verified = await hub.setOpenRouterKey(body.data.key);
    if (!verified.ok) {
      return verified.status === 401 || verified.status === 403
        ? c.json({ error: 'invalid_key', message: verified.message }, 400)
        : c.json({ error: 'verification_failed', message: verified.message }, 502);
    }
    const { label, isFreeTier, limit, usage } = verified.info;
    return c.json({
      ok: true,
      ...(label !== undefined ? { label } : {}),
      ...(isFreeTier !== undefined ? { isFreeTier } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(usage !== undefined ? { usage } : {}),
    });
  });

  app.put('/api/settings/openrouter', requireAuth, async (c) => {
    const body = await parseBody(c, OpenRouterSettingsRequestSchema);
    if (!body.ok) return body.res;
    return c.json(hub.setOpenRouterFreeOnly(body.data.freeOnly));
  });

  app.put('/api/settings/web-search', requireAuth, async (c) => {
    const body = await parseBody(c, WebSearchSettingsRequestSchema);
    if (!body.ok) return body.res;
    return c.json(hub.setWebSearch(body.data));
  });

  app.put('/api/settings/brave-key', requireAuth, async (c) => {
    const body = await parseBody(c, BraveKeyRequestSchema);
    if (!body.ok) return body.res;
    hub.setBraveKey(body.data.key);
    return c.json({ ok: true });
  });
}
