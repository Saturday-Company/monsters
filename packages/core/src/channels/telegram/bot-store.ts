import type { TelegramBotChat, TelegramChatType } from '@monsters/shared';
import type { Db } from '../../db/sqlite.ts';

/*
 * Bots dedicated to one monster (D-107), in the `telegram` namespace of the
 * core database (tables of migration 3 in `store.ts`): the bot, the groups it
 * reported (pending until the user approves them), the people the user let
 * talk to it, and the messages of its questions. The token is a secret
 * (`tgbot-<id>.key`), never here.
 */

export interface BotRow {
  /** The bot's Telegram id as text. */
  id: string;
  agent: string;
  username: string;
  name: string;
  dailyLimit?: number;
  /**
   * The people of its chats who are not the user get the monster's whole toolset (terminal,
   * writing files, other programs without a card, the whole vault). Off by default (D-114).
   */
  fullTools?: boolean;
  addedAt: number;
}

interface BotDbRow {
  id: string;
  agent: string;
  username: string;
  name: string;
  daily_limit: number | null;
  full_tools: number;
  added_at: number;
}

const toBot = (r: BotDbRow): BotRow => ({
  id: r.id,
  agent: r.agent,
  username: r.username,
  name: r.name,
  ...(r.daily_limit !== null ? { dailyLimit: r.daily_limit } : {}),
  ...(r.full_tools === 1 ? { fullTools: true } : {}),
  addedAt: r.added_at,
});

interface ChatDbRow {
  chat_id: number;
  title: string;
  type: string;
  status: 'pending' | 'approved';
  added_at: number;
}

const toChat = (r: ChatDbRow): TelegramBotChat => ({
  id: r.chat_id,
  title: r.title,
  type: r.type as TelegramChatType,
  status: r.status,
  addedAt: r.added_at,
});

export interface BotPerson {
  id: number;
  name: string;
  username?: string;
  status: 'pending' | 'approved';
  addedAt: number;
}

interface PersonDbRow {
  user_id: number;
  name: string;
  username: string | null;
  status: 'pending' | 'approved';
  added_at: number;
}

const toPerson = (r: PersonDbRow): BotPerson => ({
  id: r.user_id,
  name: r.name,
  ...(r.username ? { username: r.username } : {}),
  status: r.status,
  addedAt: r.added_at,
});

/**
 * Where a request comes from: the Telegram id of the person who added the bot to a group, or
 * of the group a person asked from (none for a request in private). `vouched`: someone the
 * user knows stands behind it (an allowed person added the bot, an approved group).
 */
export interface RequestSource {
  source?: number;
  vouched: boolean;
}

export interface PendingRequest extends RequestSource {
  id: number;
  addedAt: number;
}

export interface BotQuestionMessage {
  chatId: number;
  messageId: number;
  questionId: string;
  /** Who may answer it besides the user: the person whose request it is. */
  askedTo?: number;
  html: string;
}

interface BotQuestionDbRow {
  chat_id: number;
  message_id: number;
  question_id: string;
  asked_to: number | null;
  html: string;
}

const toBotQuestion = (r: BotQuestionDbRow): BotQuestionMessage => ({
  chatId: r.chat_id,
  messageId: r.message_id,
  questionId: r.question_id,
  ...(r.asked_to !== null ? { askedTo: r.asked_to } : {}),
  html: r.html,
});

export class TelegramBotStore {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  bots(): BotRow[] {
    return this.#db.all<BotDbRow>('SELECT * FROM telegram_bots ORDER BY added_at, id').map(toBot);
  }

  bot(id: string): BotRow | undefined {
    const row = this.#db.get<BotDbRow>('SELECT * FROM telegram_bots WHERE id = ?', id);
    return row ? toBot(row) : undefined;
  }

  addBot(b: BotRow): void {
    this.#db.run(
      `INSERT INTO telegram_bots (id, agent, username, name, daily_limit, added_at) VALUES (?, ?, ?, ?, ?, ?)`,
      b.id,
      b.agent,
      b.username,
      b.name,
      b.dailyLimit ?? null,
      b.addedAt,
    );
  }

  updateBot(
    id: string,
    patch: {
      agent?: string;
      username?: string;
      name?: string;
      dailyLimit?: number | null;
      fullTools?: boolean;
    },
  ): void {
    const b = this.bot(id);
    if (!b) return;
    this.#db.run(
      'UPDATE telegram_bots SET agent = ?, username = ?, name = ?, daily_limit = ?, full_tools = ? WHERE id = ?',
      patch.agent ?? b.agent,
      patch.username ?? b.username,
      patch.name ?? b.name,
      patch.dailyLimit === undefined ? (b.dailyLimit ?? null) : patch.dailyLimit,
      (patch.fullTools ?? b.fullTools ?? false) ? 1 : 0,
      id,
    );
  }

  removeBot(id: string): void {
    this.#db.run('DELETE FROM telegram_bot_moves WHERE bot = ?', id);
    this.#db.run('DELETE FROM telegram_bot_chats WHERE bot = ?', id);
    this.#db.run('DELETE FROM telegram_bot_people WHERE bot = ?', id);
    this.#db.run('DELETE FROM telegram_bot_questions WHERE bot = ?', id);
    this.#db.run('DELETE FROM telegram_bots WHERE id = ?', id);
  }

  chats(bot: string): TelegramBotChat[] {
    return this.#db
      .all<ChatDbRow>('SELECT * FROM telegram_bot_chats WHERE bot = ? ORDER BY added_at', bot)
      .map(toChat);
  }

  chat(bot: string, chatId: number): TelegramBotChat | undefined {
    const row = this.#db.get<ChatDbRow>(
      'SELECT * FROM telegram_bot_chats WHERE bot = ? AND chat_id = ?',
      bot,
      chatId,
    );
    return row ? toChat(row) : undefined;
  }

  /** A group seen for the first time is pending; a known one keeps its status (title updated). */
  noteChat(
    bot: string,
    c: { id: number; title: string; type: TelegramChatType },
    at: number,
    from: RequestSource = { vouched: true },
  ): void {
    this.#db.run(
      `INSERT INTO telegram_bot_chats (bot, chat_id, title, type, status, added_at, source, vouched) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
       ON CONFLICT (bot, chat_id) DO UPDATE SET title = excluded.title, type = excluded.type`,
      bot,
      c.id,
      c.title,
      c.type,
      at,
      from.source ?? null,
      from.vouched ? 1 : 0,
    );
  }

  /** The requests still waiting of a bot, oldest first, with where they come from. */
  pendingRequests(bot: string, kind: 'chats' | 'people'): PendingRequest[] {
    const sql =
      kind === 'chats'
        ? `SELECT chat_id AS id, added_at, source, vouched FROM telegram_bot_chats WHERE bot = ? AND status = 'pending' ORDER BY added_at`
        : `SELECT user_id AS id, added_at, source, vouched FROM telegram_bot_people WHERE bot = ? AND status = 'pending' ORDER BY added_at`;
    return this.#db
      .all<{ id: number; added_at: number; source: number | null; vouched: number }>(sql, bot)
      .map((r) => ({
        id: r.id,
        addedAt: r.added_at,
        ...(r.source !== null ? { source: r.source } : {}),
        vouched: r.vouched === 1,
      }));
  }

  /**
   * The group became a supergroup: the row keeps its status (approved stays
   * approved) under the new id, and so do the messages of its questions. A row
   * the new id already got (it was noted as pending first) gives way.
   */
  /** Notes that the group `from` is now `to` (kept for the work that still has the old id). */
  noteMove(bot: string, from: number, to: number): void {
    if (from === to) return;
    this.#db.run(
      `INSERT INTO telegram_bot_moves (bot, from_id, to_id) VALUES (?, ?, ?)
       ON CONFLICT (bot, from_id) DO UPDATE SET to_id = excluded.to_id`,
      bot,
      from,
      to,
    );
  }

  /** The groups of a bot that became supergroups: old id, new id. */
  moves(bot: string): [number, number][] {
    return this.#db
      .all<{
        from_id: number;
        to_id: number;
      }>('SELECT from_id, to_id FROM telegram_bot_moves WHERE bot = ?', bot)
      .map((r) => [r.from_id, r.to_id]);
  }

  migrateChat(bot: string, from: number, to: number): boolean {
    if (!this.chat(bot, from)) return false;
    this.#db.run('DELETE FROM telegram_bot_chats WHERE bot = ? AND chat_id = ?', bot, to);
    this.#db.run(
      `UPDATE telegram_bot_chats SET chat_id = ?, type = 'supergroup' WHERE bot = ? AND chat_id = ?`,
      to,
      bot,
      from,
    );
    this.#db.run(
      'UPDATE telegram_bot_questions SET chat_id = ? WHERE bot = ? AND chat_id = ?',
      to,
      bot,
      from,
    );
    return true;
  }

  approveChat(bot: string, chatId: number): boolean {
    return (
      this.#db.run(
        `UPDATE telegram_bot_chats SET status = 'approved' WHERE bot = ? AND chat_id = ?`,
        bot,
        chatId,
      ).changes > 0
    );
  }

  removeChat(bot: string, chatId: number): boolean {
    return (
      this.#db.run('DELETE FROM telegram_bot_chats WHERE bot = ? AND chat_id = ?', bot, chatId)
        .changes > 0
    );
  }

  people(bot: string): BotPerson[] {
    return this.#db
      .all<PersonDbRow>('SELECT * FROM telegram_bot_people WHERE bot = ? ORDER BY added_at', bot)
      .map(toPerson);
  }

  person(bot: string, userId: number): BotPerson | undefined {
    const row = this.#db.get<PersonDbRow>(
      'SELECT * FROM telegram_bot_people WHERE bot = ? AND user_id = ?',
      bot,
      userId,
    );
    return row ? toPerson(row) : undefined;
  }

  /** Adds someone (or updates their name); an approved person stays approved. */
  putPerson(
    bot: string,
    p: { id: number; name: string; username?: string | undefined },
    status: 'pending' | 'approved',
    at: number,
    from: RequestSource = { vouched: true },
  ): void {
    this.#db.run(
      `INSERT INTO telegram_bot_people (bot, user_id, name, username, status, added_at, source, vouched) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (bot, user_id) DO UPDATE SET name = excluded.name, username = excluded.username,
         status = CASE WHEN telegram_bot_people.status = 'approved' THEN 'approved' ELSE excluded.status END`,
      bot,
      p.id,
      p.name,
      p.username ?? null,
      status,
      at,
      from.source ?? null,
      from.vouched ? 1 : 0,
    );
  }

  approvePerson(bot: string, userId: number): boolean {
    return (
      this.#db.run(
        `UPDATE telegram_bot_people SET status = 'approved' WHERE bot = ? AND user_id = ?`,
        bot,
        userId,
      ).changes > 0
    );
  }

  removePerson(bot: string, userId: number): boolean {
    return (
      this.#db.run('DELETE FROM telegram_bot_people WHERE bot = ? AND user_id = ?', bot, userId)
        .changes > 0
    );
  }

  addQuestion(bot: string, m: BotQuestionMessage, at: number): void {
    this.#db.run(
      `INSERT OR REPLACE INTO telegram_bot_questions (bot, chat_id, message_id, question_id, asked_to, html, closed, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      bot,
      m.chatId,
      m.messageId,
      m.questionId,
      m.askedTo ?? null,
      m.html,
      at,
    );
  }

  question(bot: string, chatId: number, messageId: number): BotQuestionMessage | undefined {
    const row = this.#db.get<BotQuestionDbRow>(
      'SELECT * FROM telegram_bot_questions WHERE bot = ? AND chat_id = ? AND message_id = ?',
      bot,
      chatId,
      messageId,
    );
    return row ? toBotQuestion(row) : undefined;
  }

  /** Messages of a question that still show their buttons. */
  openQuestions(bot: string, questionId: string): BotQuestionMessage[] {
    return this.#db
      .all<BotQuestionDbRow>(
        'SELECT * FROM telegram_bot_questions WHERE bot = ? AND closed = 0 AND question_id = ? ORDER BY sent_at',
        bot,
        questionId,
      )
      .map(toBotQuestion);
  }

  closeQuestion(bot: string, chatId: number, messageId: number): void {
    this.#db.run(
      'UPDATE telegram_bot_questions SET closed = 1 WHERE bot = ? AND chat_id = ? AND message_id = ?',
      bot,
      chatId,
      messageId,
    );
  }
}
