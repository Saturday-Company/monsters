import { z } from 'zod';

/*
 * Telegram channel (M2.6). Same rules as the rest of the API (JSON body,
 * anti-CSRF header, session or bearer). The bot token never comes back.
 *
 *   GET    /api/telegram              → TelegramView
 *   PUT    /api/telegram/token        TelegramTokenRequest → TelegramView (verified with getMe)
 *   DELETE /api/telegram/token        → TelegramView
 *   POST   /api/telegram/pairing      → TelegramPairing (the only answer with the code)
 *   DELETE /api/telegram/pairing      → TelegramView
 *   DELETE /api/telegram/users/:id    → TelegramView
 *   PUT    /api/telegram/prefs        TelegramPrefsUpdate → TelegramView
 *
 * Bots dedicated to one monster (D-107), each with its own token and its own
 * loop; every answer is the whole TelegramView:
 *
 *   POST   /api/telegram/bots                          TelegramBotCreateRequest → TelegramView (201)
 *   PATCH  /api/telegram/bots/:id                      TelegramBotUpdateRequest → TelegramView
 *   DELETE /api/telegram/bots/:id                      → TelegramView
 *   POST   /api/telegram/bots/:id/chats/:chat/approve  → TelegramView
 *   DELETE /api/telegram/bots/:id/chats/:chat          → TelegramView (refused, or removed)
 *   POST   /api/telegram/bots/:id/people               TelegramBotPersonRequest → TelegramView
 *   POST   /api/telegram/bots/:id/people/:user/approve → TelegramView
 *   DELETE /api/telegram/bots/:id/people/:user         → TelegramView
 *
 * Errors: 400 `invalid_token` (nothing shaped like a token in the text, or Telegram does not
 * know it), 502
 * `verification_failed` (Telegram not reachable), 409 `token_from_env` (remove
 * `TELEGRAM_BOT_TOKEN` instead), 409 `no_token` (pairing without a bot), 404
 * `not_found` (user not in the whitelist; unknown bot, chat or person). Bots:
 * 409 `bot_in_use` (the main bot's token, or a bot already added), 400
 * `invalid_agent` (no such monster, or the God: he talks through the main
 * bot), 409 `owner` (a paired account cannot be removed from a bot).
 */

/** What BotFather gives: `<bot id>:<secret>`. */
export const TELEGRAM_TOKEN_PATTERN = /^\d{5,16}:[A-Za-z0-9_-]{30,64}$/;

/** A token inside a longer text (BotFather's whole message): not glued to other word characters. */
const TOKEN_IN_TEXT = /(?<![A-Za-z0-9_])\d{5,16}:[A-Za-z0-9_-]{30,64}(?![A-Za-z0-9_-])/;

/** The answer when nothing in the pasted text looks like a token. */
export const TELEGRAM_TOKEN_SHAPE_MESSAGE =
  'Questo non sembra un token di Telegram: è fatto come 123456789:AAE… e lo trovi nel messaggio di BotFather.';

/**
 * The token in what the user pasted: the token alone, BotFather's whole message ("Use this
 * token to access the HTTP API:\n<token>\nKeep your token secure…"), or a token broken by a
 * space or a line break when copied. Null when nothing there has the shape of a token: no
 * request leaves with it (a token with a space reaches Telegram as another URL).
 */
export function extractTelegramToken(text: string): string | null {
  const found = TOKEN_IN_TEXT.exec(text);
  if (found) return found[0];
  // Only a token with spaces or line breaks inside: never joins the words of a message.
  const joined = text.replace(/\s+/g, '');
  return TELEGRAM_TOKEN_PATTERN.test(joined) ? joined : null;
}

/** `HH:MM`, 24 hours. */
export const ClockTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const TelegramPrefsSchema = z.object({
  /** "Silenzioso di notte": between `from` and `to` (local time) notifications wait or arrive silently. */
  quietHours: z.object({
    enabled: z.boolean(),
    from: ClockTimeSchema,
    to: ClockTimeSchema,
  }),
  /** Which notifications to send: work finished, question waiting, error. */
  notify: z.object({
    done: z.boolean(),
    questions: z.boolean(),
    errors: z.boolean(),
  }),
});
export type TelegramPrefs = z.infer<typeof TelegramPrefsSchema>;

export const DEFAULT_TELEGRAM_PREFS: TelegramPrefs = {
  quietHours: { enabled: false, from: '22:00', to: '08:00' },
  notify: { done: true, questions: true, errors: true },
};

export const TelegramPrefsUpdateSchema = z.object({
  quietHours: TelegramPrefsSchema.shape.quietHours.partial().optional(),
  notify: TelegramPrefsSchema.shape.notify.partial().optional(),
});
export type TelegramPrefsUpdate = z.infer<typeof TelegramPrefsUpdateSchema>;

/** An account allowed to command the agents. */
export const TelegramUserSchema = z.object({
  /** Telegram user id (also the id of the private chat with the bot). */
  id: z.number().int().positive(),
  name: z.string(),
  username: z.string().optional(),
  addedAt: z.number().int().nonnegative(),
});
export type TelegramUser = z.infer<typeof TelegramUserSchema>;

/**
 * `off`: no token; `connecting`: first contact; `online`: polling;
 * `retrying`: Telegram not reachable, trying again; `conflict`: another
 * program polls the same token (or it has a webhook), tried again quietly;
 * `error`: needs the user (token refused).
 */
export const TelegramStatusSchema = z.enum([
  'off',
  'connecting',
  'online',
  'retrying',
  'conflict',
  'error',
]);
export type TelegramStatus = z.infer<typeof TelegramStatusSchema>;

// --- bots dedicated to one monster (D-107) ---------------------------------------

/** Where a message of a dedicated bot was written: a group, or a private chat with the bot. */
export const TelegramChatTypeSchema = z.enum(['private', 'group', 'supergroup']);
export type TelegramChatType = z.infer<typeof TelegramChatTypeSchema>;

/**
 * A group a dedicated bot was added to (it says so when it joins, or at the
 * first message): `pending` until the user approves it in the app; until then
 * the bot ignores it (a log line). Private chats need no approval: the person
 * does.
 */
export const TelegramBotChatSchema = z.object({
  /** Telegram chat id (negative for groups). */
  id: z.number().int(),
  title: z.string(),
  type: TelegramChatTypeSchema,
  status: z.enum(['pending', 'approved']),
  addedAt: z.number().int().nonnegative(),
});
export type TelegramBotChat = z.infer<typeof TelegramBotChatSchema>;

/**
 * Someone who may talk to a dedicated bot. `owner`: an account paired with the
 * main bot (the user), always allowed, the only one whose words are the user's;
 * the others are people of the group, asked with `/join` (pending until the
 * user approves) or added by id.
 */
export const TelegramBotPersonSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  username: z.string().optional(),
  status: z.enum(['pending', 'approved']),
  owner: z.boolean(),
  addedAt: z.number().int().nonnegative(),
});
export type TelegramBotPerson = z.infer<typeof TelegramBotPersonSchema>;

export const TelegramBotViewSchema = z.object({
  /** Entry id: the bot's Telegram id as text. */
  id: z.string(),
  /** The monster it talks for. */
  agent: z.string(),
  bot: z.object({ id: z.number().int(), username: z.string(), name: z.string() }),
  status: TelegramStatusSchema,
  /** Plain Italian, for the user. */
  error: z.string().optional(),
  /** Messages a day that reach the monster at most (the user's, or the default of 100). */
  dailyLimit: z.number().int().positive(),
  /** Messages that reached the monster today. */
  today: z.number().int().nonnegative(),
  chats: z.array(TelegramBotChatSchema),
  people: z.array(TelegramBotPersonSchema),
  /**
   * The people of its chats who are not the user get the monster's whole toolset: the
   * terminal, writing and deleting files, other programs without a card to the user, the
   * whole vault (D-114). Off by default.
   */
  fullTools: z.boolean(),
  addedAt: z.number().int().nonnegative(),
});
export type TelegramBotView = z.infer<typeof TelegramBotViewSchema>;

export const TELEGRAM_BOT_DAILY_MAX = 10_000;

export const TelegramBotCreateRequestSchema = z.object({
  /** What the user pasted: the core takes the token out of it (`extractTelegramToken`). */
  token: z.string().min(1).max(4096),
  /** Id of the monster (never the God: he talks through the main bot). */
  agent: z.string().min(1).max(64),
  dailyLimit: z.number().int().positive().max(TELEGRAM_BOT_DAILY_MAX).optional(),
});
export type TelegramBotCreateRequest = z.infer<typeof TelegramBotCreateRequestSchema>;

export const TelegramBotUpdateRequestSchema = z.object({
  agent: z.string().min(1).max(64).optional(),
  /** `null` goes back to the default (100 a day). */
  dailyLimit: z.number().int().positive().max(TELEGRAM_BOT_DAILY_MAX).nullable().optional(),
  /** See `TelegramBotView.fullTools`. */
  fullTools: z.boolean().optional(),
});
export type TelegramBotUpdateRequest = z.infer<typeof TelegramBotUpdateRequestSchema>;

/** Someone added by their Telegram user id (the other way is `/join` in the group). */
export const TelegramBotPersonRequestSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  name: z.string().trim().min(1).max(80).optional(),
});
export type TelegramBotPersonRequest = z.infer<typeof TelegramBotPersonRequestSchema>;

/**
 * Where a message written to a dedicated bot comes from (on the user-side
 * `message` event, D-107): the monster's chat in the app shows the sender and
 * "da Telegram · <gruppo>"; only `owner` text counts as the user's own words.
 */
export const TelegramOriginSchema = z.object({
  /** Entry id of the dedicated bot. */
  bot: z.string().min(1).max(32),
  chat: z.number().int(),
  chatType: TelegramChatTypeSchema,
  chatTitle: z.string().max(200).optional(),
  sender: z.object({
    id: z.number().int().positive(),
    name: z.string().max(80),
    username: z.string().max(64).optional(),
  }),
  /** The sender is an account paired with the main bot: the user. */
  owner: z.boolean(),
});
export type TelegramOrigin = z.infer<typeof TelegramOriginSchema>;

/** The conversation of one Telegram chat with the monster of a dedicated bot (its runs carry it). */
export function telegramThread(bot: string, chat: number): string {
  return `telegram:${bot}:${chat}`;
}

export const TelegramViewSchema = z.object({
  token: z.object({
    set: z.boolean(),
    /** `env`: from `TELEGRAM_BOT_TOKEN`, removable only there. */
    source: z.enum(['file', 'env']).optional(),
  }),
  bot: z.object({ id: z.number().int(), username: z.string(), name: z.string() }).optional(),
  status: TelegramStatusSchema,
  /** Plain Italian, for the user. */
  error: z.string().optional(),
  users: z.array(TelegramUserSchema),
  /** Active pairing code (the code itself only in the POST answer). */
  pairing: z
    .object({ expiresAt: z.number().int(), attemptsLeft: z.number().int().nonnegative() })
    .nullable(),
  prefs: TelegramPrefsSchema,
  /** Bots dedicated to one monster (D-107). */
  bots: z.array(TelegramBotViewSchema),
  /**
   * The monsters (not the God) with the terminal or other programs that do things (MCP),
   * by id: the settings warn when a bot is dedicated to one of them (D-114).
   */
  toolRisks: z
    .record(z.string(), z.object({ terminal: z.boolean(), programs: z.boolean() }))
    .optional(),
});
export type TelegramView = z.infer<typeof TelegramViewSchema>;

export const TelegramTokenRequestSchema = z.object({
  /** What the user pasted: the core takes the token out of it (`extractTelegramToken`). */
  token: z.string().min(1).max(4096),
});
export type TelegramTokenRequest = z.infer<typeof TelegramTokenRequestSchema>;

export const TelegramPairingSchema = z.object({
  /** One-time code: the user sends `/start <code>` to the bot. */
  code: z.string(),
  expiresAt: z.number().int(),
  attemptsLeft: z.number().int().nonnegative(),
  /** `https://t.me/<bot>?start=<code>`, when the bot is known. */
  link: z.string().optional(),
});
export type TelegramPairing = z.infer<typeof TelegramPairingSchema>;
