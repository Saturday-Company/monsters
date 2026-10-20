import {
  TelegramBotCreateRequestSchema,
  TelegramBotPersonRequestSchema,
  TelegramBotUpdateRequestSchema,
  TelegramPrefsUpdateSchema,
  TelegramTokenRequestSchema,
} from '@monsters/shared';
import type { Context, Hono } from 'hono';
import { botIdOf, TelegramBotsError, type TelegramBots } from '../../channels/telegram/bots.ts';
import { TelegramError, type TelegramChannel } from '../../channels/telegram/channel.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';

/*
 * Telegram settings (contract in shared/src/telegram.ts). The tokens never
 * come back; the pairing code only in the answer that creates it. Allowed
 * while halted: none of these starts work. The bots dedicated to a monster
 * (D-107) answer with the whole view, like the main bot.
 */

const STATUS: Record<TelegramError['code'] | TelegramBotsError['code'], 400 | 404 | 409 | 502> = {
  invalid_token: 400,
  verification_failed: 502,
  token_from_env: 409,
  no_token: 409,
  not_found: 404,
  bot_in_use: 409,
  other_bot: 409,
  invalid_agent: 400,
  owner: 409,
  already_sent: 409,
};

function fail(c: Context, err: unknown): Response {
  if (err instanceof TelegramError || err instanceof TelegramBotsError) {
    return c.json({ error: err.code, message: err.message }, STATUS[err.code]);
  }
  throw err;
}

/** A Telegram id of the path (chat ids of groups are negative). */
function chatIdOf(raw: string): number | null {
  const n = Number(raw);
  return /^-?\d{1,20}$/.test(raw) && Number.isSafeInteger(n) && n !== 0 ? n : null;
}

export function registerTelegramRoutes(
  app: Hono<AppEnv>,
  h: RouteHelpers,
  telegram: TelegramChannel,
  bots?: TelegramBots,
): void {
  const { requireAuth, parseBody } = h;

  app.get('/api/telegram', requireAuth, (c) => c.json(telegram.view()));

  app.put('/api/telegram/token', requireAuth, async (c) => {
    const body = await parseBody(c, TelegramTokenRequestSchema);
    if (!body.ok) return body.res;
    try {
      return c.json(await telegram.setToken(body.data.token));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.delete('/api/telegram/token', requireAuth, async (c) => {
    try {
      return c.json(await telegram.removeToken());
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/api/telegram/pairing', requireAuth, (c) => {
    try {
      return c.json(telegram.startPairing(), 201);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.delete('/api/telegram/pairing', requireAuth, (c) => c.json(telegram.cancelPairing()));

  app.delete('/api/telegram/users/:id', requireAuth, (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'invalid_request' }, 400);
    try {
      return c.json(telegram.removeUser(id));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.put('/api/telegram/prefs', requireAuth, async (c) => {
    const body = await parseBody(c, TelegramPrefsUpdateSchema);
    if (!body.ok) return body.res;
    return c.json(telegram.updatePrefs(body.data));
  });

  if (!bots) return;

  // «Manda comunque»: a reply the check held, sent by the user (OWNER_ONLY: /api/telegram).
  app.post('/api/telegram/held/:id/send', requireAuth, (c) => {
    const id = c.req.param('id');
    if (!/^[0-9A-Z]{26}$/.test(id)) return c.json({ error: 'invalid_request' }, 400);
    try {
      return c.json(bots.sendHeld(id, h.channelOf(c.get('auth'))));
    } catch (err) {
      return fail(c, err);
    }
  });

  // --- bots dedicated to one monster (D-107) ---------------------------------------

  /** Runs `work` on the bot of the path, answering with the whole view. */
  const onBot = async (
    c: Context<AppEnv>,
    work: (id: string) => unknown,
    status: 200 | 201 = 200,
  ): Promise<Response> => {
    const id = botIdOf(c.req.param('id') ?? '');
    if (!id) return c.json({ error: 'invalid_request' }, 400);
    try {
      await work(id);
      return c.json(telegram.view(), status);
    } catch (err) {
      return fail(c, err);
    }
  };

  app.post('/api/telegram/bots', requireAuth, async (c) => {
    const body = await parseBody(c, TelegramBotCreateRequestSchema);
    if (!body.ok) return body.res;
    try {
      await bots.add(body.data);
      return c.json(telegram.view(), 201);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.patch('/api/telegram/bots/:id', requireAuth, async (c) => {
    const body = await parseBody(c, TelegramBotUpdateRequestSchema);
    if (!body.ok) return body.res;
    // "Strumenti per gli altri" turned on (D-114): the people of the bot act with the user's
    // tools. Needs the password typed in the last minutes (`RECENT_ONLY` in app.ts).
    if (body.data.fullTools === true) {
      const refused = h.requireRecent(c);
      if (refused) return refused;
    }
    return onBot(c, (id) => bots.update(id, body.data));
  });

  // "Cambia il token": the same bot, a token BotFather issued again.
  app.put('/api/telegram/bots/:id/token', requireAuth, async (c) => {
    const body = await parseBody(c, TelegramTokenRequestSchema);
    if (!body.ok) return body.res;
    return onBot(c, (id) => bots.changeToken(id, body.data.token));
  });

  app.delete('/api/telegram/bots/:id', requireAuth, (c) => onBot(c, (id) => bots.remove(id)));

  app.post('/api/telegram/bots/:id/chats/:chat/approve', requireAuth, (c) => {
    const chat = chatIdOf(c.req.param('chat'));
    if (chat === null) return c.json({ error: 'invalid_request' }, 400);
    return onBot(c, (id) => bots.approveChat(id, chat));
  });

  app.delete('/api/telegram/bots/:id/chats/:chat', requireAuth, (c) => {
    const chat = chatIdOf(c.req.param('chat'));
    if (chat === null) return c.json({ error: 'invalid_request' }, 400);
    return onBot(c, (id) => bots.removeChat(id, chat));
  });

  app.post('/api/telegram/bots/:id/people', requireAuth, async (c) => {
    const body = await parseBody(c, TelegramBotPersonRequestSchema);
    if (!body.ok) return body.res;
    return onBot(c, (id) => bots.addPerson(id, body.data));
  });

  app.post('/api/telegram/bots/:id/people/:user/approve', requireAuth, (c) => {
    const user = chatIdOf(c.req.param('user'));
    if (user === null || user < 0) return c.json({ error: 'invalid_request' }, 400);
    return onBot(c, (id) => bots.approvePerson(id, user));
  });

  app.delete('/api/telegram/bots/:id/people/:user', requireAuth, (c) => {
    const user = chatIdOf(c.req.param('user'));
    if (user === null || user < 0) return c.json({ error: 'invalid_request' }, 400);
    return onBot(c, (id) => bots.removePerson(id, user));
  });
}
