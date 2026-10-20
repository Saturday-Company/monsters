import type { TelegramUser } from '@monsters/shared';
import type { Migration } from '../../db/migrations.ts';
import type { Db } from '../../db/sqlite.ts';

/*
 * Whitelist of the Telegram accounts that may command the agents (namespace
 * `telegram` of the core database). An account joins only through pairing
 * with a code shown in the UI, and leaves from the UI.
 */

export const telegramMigrations: readonly Migration[] = [
  {
    version: 1,
    name: 'telegram_users',
    up: `
      CREATE TABLE telegram_users (
        id         INTEGER PRIMARY KEY,
        name       TEXT    NOT NULL,
        username   TEXT,
        added_at   INTEGER NOT NULL
      ) STRICT;
    `,
  },
  {
    // Questions sent to Telegram: after a restart the bot still knows which
    // message asks what (a reply to it is an answer, its buttons get removed).
    version: 2,
    name: 'telegram_questions',
    up: `
      CREATE TABLE telegram_questions (
        chat_id     INTEGER NOT NULL,
        message_id  INTEGER NOT NULL,
        question_id TEXT    NOT NULL,
        html        TEXT    NOT NULL,
        closed      INTEGER NOT NULL DEFAULT 0,
        sent_at     INTEGER NOT NULL,
        PRIMARY KEY (chat_id, message_id)
      ) STRICT;
      CREATE INDEX telegram_questions_question ON telegram_questions (question_id);
    `,
  },
  {
    // Bots dedicated to one monster (D-107): the bot, its groups, its people,
    // and the messages of its questions (a private chat has the same id for
    // every bot: the key has the bot).
    version: 3,
    name: 'telegram_bots',
    up: `
      CREATE TABLE telegram_bots (
        id          TEXT    PRIMARY KEY,
        agent       TEXT    NOT NULL,
        username    TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        daily_limit INTEGER,
        added_at    INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE telegram_bot_chats (
        bot      TEXT    NOT NULL,
        chat_id  INTEGER NOT NULL,
        title    TEXT    NOT NULL,
        type     TEXT    NOT NULL,
        status   TEXT    NOT NULL CHECK (status IN ('pending', 'approved')),
        added_at INTEGER NOT NULL,
        PRIMARY KEY (bot, chat_id)
      ) STRICT;
      CREATE TABLE telegram_bot_people (
        bot      TEXT    NOT NULL,
        user_id  INTEGER NOT NULL,
        name     TEXT    NOT NULL,
        username TEXT,
        status   TEXT    NOT NULL CHECK (status IN ('pending', 'approved')),
        added_at INTEGER NOT NULL,
        PRIMARY KEY (bot, user_id)
      ) STRICT;
      CREATE TABLE telegram_bot_questions (
        bot         TEXT    NOT NULL,
        chat_id     INTEGER NOT NULL,
        message_id  INTEGER NOT NULL,
        question_id TEXT    NOT NULL,
        asked_to    INTEGER,
        html        TEXT    NOT NULL,
        closed      INTEGER NOT NULL DEFAULT 0,
        sent_at     INTEGER NOT NULL,
        PRIMARY KEY (bot, chat_id, message_id)
      ) STRICT;
      CREATE INDEX telegram_bot_questions_question ON telegram_bot_questions (question_id);
    `,
  },
  {
    // The whole toolset for the people of a bot's chats (D-114): off by default, turned on
    // bot by bot in the settings.
    version: 4,
    name: 'telegram_bots_full_tools',
    up: `ALTER TABLE telegram_bots ADD COLUMN full_tools INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    // A group of a dedicated bot that became a supergroup: the old id leads to the new one
    // after a restart too (work queued with the old id, review of 19/10, item 9).
    version: 5,
    name: 'telegram_bot_moves',
    up: `
      CREATE TABLE telegram_bot_moves (
        bot     TEXT    NOT NULL,
        from_id INTEGER NOT NULL,
        to_id   INTEGER NOT NULL,
        PRIMARY KEY (bot, from_id)
      ) STRICT;
    `,
  },
  {
    // Who a request of a dedicated bot comes from (the person who added the bot to a group,
    // the group a person asked from) and whether someone the user knows vouches for it: a
    // stranger never seen cannot push out the real requests (residual of the review of 18/10).
    // Rows from before stay vouched (they keep the usual expiry).
    version: 6,
    name: 'telegram_bot_request_source',
    up: `
      ALTER TABLE telegram_bot_chats ADD COLUMN source INTEGER;
      ALTER TABLE telegram_bot_chats ADD COLUMN vouched INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE telegram_bot_people ADD COLUMN source INTEGER;
      ALTER TABLE telegram_bot_people ADD COLUMN vouched INTEGER NOT NULL DEFAULT 1;
    `,
  },
];

interface UserRow {
  id: number;
  name: string;
  username: string | null;
  added_at: number;
}

const toUser = (r: UserRow): TelegramUser => ({
  id: r.id,
  name: r.name,
  ...(r.username ? { username: r.username } : {}),
  addedAt: r.added_at,
});

export class TelegramUsers {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  list(): TelegramUser[] {
    return this.#db.all<UserRow>('SELECT * FROM telegram_users ORDER BY added_at, id').map(toUser);
  }

  has(id: number): boolean {
    return this.#db.get('SELECT 1 AS ok FROM telegram_users WHERE id = ?', id) !== undefined;
  }

  add(user: { id: number; name: string; username?: string | undefined }, at: number): TelegramUser {
    this.#db.run(
      `INSERT INTO telegram_users (id, name, username, added_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, username = excluded.username`,
      user.id,
      user.name,
      user.username ?? null,
      at,
    );
    return toUser(this.#db.get<UserRow>('SELECT * FROM telegram_users WHERE id = ?', user.id)!);
  }

  remove(id: number): boolean {
    return this.#db.run('DELETE FROM telegram_users WHERE id = ?', id).changes > 0;
  }
}

export interface QuestionMessage {
  chatId: number;
  messageId: number;
  questionId: string;
  html: string;
  closed: boolean;
}

interface QuestionMessageRow {
  chat_id: number;
  message_id: number;
  question_id: string;
  html: string;
  closed: number;
}

const toQuestionMessage = (r: QuestionMessageRow): QuestionMessage => ({
  chatId: r.chat_id,
  messageId: r.message_id,
  questionId: r.question_id,
  html: r.html,
  closed: r.closed === 1,
});

/** The Telegram messages that carry a question, and whether they were closed. */
export class TelegramQuestionMessages {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  add(m: { chatId: number; messageId: number; questionId: string; html: string }, at: number) {
    this.#db.run(
      `INSERT OR REPLACE INTO telegram_questions (chat_id, message_id, question_id, html, closed, sent_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      m.chatId,
      m.messageId,
      m.questionId,
      m.html,
      at,
    );
  }

  find(chatId: number, messageId: number): QuestionMessage | undefined {
    const row = this.#db.get<QuestionMessageRow>(
      'SELECT * FROM telegram_questions WHERE chat_id = ? AND message_id = ?',
      chatId,
      messageId,
    );
    return row ? toQuestionMessage(row) : undefined;
  }

  /** Messages still showing their buttons, of one question or of all. */
  open(questionId?: string): QuestionMessage[] {
    const rows =
      questionId === undefined
        ? this.#db.all<QuestionMessageRow>(
            'SELECT * FROM telegram_questions WHERE closed = 0 ORDER BY sent_at',
          )
        : this.#db.all<QuestionMessageRow>(
            'SELECT * FROM telegram_questions WHERE closed = 0 AND question_id = ? ORDER BY sent_at',
            questionId,
          );
    return rows.map(toQuestionMessage);
  }

  close(chatId: number, messageId: number): void {
    this.#db.run(
      'UPDATE telegram_questions SET closed = 1 WHERE chat_id = ? AND message_id = ?',
      chatId,
      messageId,
    );
  }

  /** Forgets closed messages sent before `before`. */
  prune(before: number): void {
    this.#db.run('DELETE FROM telegram_questions WHERE closed = 1 AND sent_at < ?', before);
  }
}
