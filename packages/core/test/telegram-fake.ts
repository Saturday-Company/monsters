import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/*
 * A fake Telegram Bot API on 127.0.0.1 (grammY talks to it through `apiRoot`):
 * long polling with offsets, messages, edits, callback answers, and failures
 * on demand. Tests never reach the real Telegram. Several bots (tokens) on
 * the same server each have their own updates (D-107).
 */

export interface FakeUser {
  id: number;
  first_name: string;
  username?: string;
}

export interface ApiCall {
  method: string;
  token: string;
  payload: Record<string, unknown>;
  at: number;
}

export interface SentMessage {
  message_id: number;
  chat_id: number;
  /** The bot that sent it. */
  token: string;
  text: string;
  reply_to?: number;
  parse_mode?: string;
  reply_markup?: {
    inline_keyboard?: { text: string; callback_data: string }[][];
    force_reply?: boolean;
  };
  disable_notification?: boolean;
  edits: string[];
}

type Waiter = { token: string; offset: number; resolve: (updates: unknown[]) => void };

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** What the real Bot API refuses: over 4096 visible characters, broken UTF-16. */
function invalid(payload: Record<string, unknown>): string | null {
  const raw = typeof payload['text'] === 'string' ? payload['text'] : '';
  const visible =
    payload['parse_mode'] === 'HTML'
      ? raw
          .replace(/<[^>]*>/g, '')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
      : raw;
  if (visible.length > 4096) return 'Bad Request: message is too long';
  const markup = payload['reply_markup'] as SentMessage['reply_markup'] | undefined;
  const buttons = (markup?.inline_keyboard ?? []).flat().map((b) => b.text);
  if ([raw, ...buttons].some((t) => LONE_SURROGATE.test(t))) {
    return 'Bad Request: strings must be encoded in UTF-8';
  }
  return null;
}

export const FAKE_TOKEN = '123456789:AAFakeTokenForTestsOnly_abcdefghijklmn';
export const FAKE_BOT = {
  id: 123456789,
  is_bot: true,
  first_name: 'Monsters Test',
  username: 'monsters_test_bot',
};

/**
 * How long a wait lasts by default. A reply may come after a real child process (the
 * terminal starts PowerShell on Windows), several times slower on the Windows runners.
 */
const WAIT_MS = process.platform === 'win32' ? 20_000 : 4000;

export class FakeTelegram {
  readonly token: string;
  readonly calls: ApiCall[] = [];
  readonly messages: SentMessage[] = [];
  /** Offsets asked by each getUpdates of the main bot, in order. */
  readonly offsets: number[] = [];
  #server: Server | null = null;
  #updates = new Map<string, { update_id: number }[]>();
  #nextUpdate = 1000;
  #nextMessage = 1;
  #waiters: Waiter[] = [];
  #failures = new Map<string, ('error500' | 'drop' | 'unauthorized' | 'conflict' | 'flood')[]>();
  #sendFailures: ('error500' | 'drop' | 'flood' | 'forbidden')[] = [];
  #editFailures: string[] = [];
  /** Groups that became supergroups: old id → new id. */
  readonly #upgraded = new Map<number, number>();
  /** The `retry_after` (seconds) of a `flood` failure. */
  floodRetryAfterS = 1;
  /** While set, getMe answers only once it resolves (a token check that takes its time). */
  holdGetMe: Promise<unknown> | null = null;
  readonly #bots = new Map<string, typeof FAKE_BOT>();
  #listeners = new Set<() => void>();
  url = '';

  constructor(token = FAKE_TOKEN) {
    this.token = token;
    this.#bots.set(token, FAKE_BOT);
  }

  /** Another bot on the same server (a new token pasted in the UI). */
  addBot(token: string, bot: typeof FAKE_BOT): void {
    this.#bots.set(token, bot);
  }

  async start(): Promise<this> {
    this.#server = createServer((req, res) => void this.#serve(req, res));
    await new Promise<void>((resolve) => this.#server!.listen(0, '127.0.0.1', () => resolve()));
    this.url = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
    return this;
  }

  async close(): Promise<void> {
    for (const w of this.#waiters.splice(0)) w.resolve([]);
    const server = this.#server;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** The next `n` getUpdates of a bot fail (500, a dropped connection, 401, or 409). */
  failGetUpdates(
    n: number,
    mode: 'error500' | 'drop' | 'unauthorized' | 'conflict' | 'flood' = 'drop',
    token = this.token,
  ): void {
    const list = this.#failures.get(token) ?? [];
    for (let i = 0; i < n; i++) list.push(mode);
    this.#failures.set(token, list);
  }

  /**
   * The next `n` sendMessage fail (500, a dropped connection, 429 `flood`, or
   * 403 `forbidden`: the user blocked the bot); 0 clears them.
   */
  failSends(n: number, mode: 'error500' | 'drop' | 'flood' | 'forbidden' = 'drop'): void {
    if (n === 0) this.#sendFailures = [];
    for (let i = 0; i < n; i++) this.#sendFailures.push(mode);
  }

  /**
   * The group `from` became the supergroup `to`: a send to the old id fails
   * with the 400 of the real API (`migrate_to_chat_id` in `parameters`).
   */
  upgradeGroup(from: number, to: number): void {
    this.#upgraded.set(from, to);
  }

  /** The service messages of an upgrade: one in the old chat, one in the new. */
  migratedGroup(
    token: string,
    from: Record<string, unknown>,
    to: Record<string, unknown>,
    by: FakeUser,
  ): void {
    const base = () => ({
      message_id: this.#nextMessage++,
      date: Math.floor(Date.now() / 1000),
      from: { is_bot: false, ...by },
    });
    this.push({ message: { ...base(), chat: from, migrate_to_chat_id: to['id'] } }, token);
    this.push({ message: { ...base(), chat: to, migrate_from_chat_id: from['id'] } }, token);
    this.upgradeGroup(from['id'] as number, to['id'] as number);
  }

  /** The next editMessageText fails with this 400 description. */
  failEdit(description: string): void {
    this.#editFailures.push(description);
  }

  /** Pending long polls of a bot (to know it is listening). */
  pollingOf(token: string): number {
    return this.#waiters.filter((w) => w.token === token).length;
  }

  /** Pending long polls of the main bot. */
  get polling(): number {
    return this.pollingOf(this.token);
  }

  /** Offsets asked by the getUpdates of a bot. */
  offsetsOf(token: string): number[] {
    return this.calls
      .filter((c) => c.method === 'getUpdates' && c.token === token)
      .map((c) => Number(c.payload['offset'] ?? 0));
  }

  push(update: Record<string, unknown>, token = this.token): number {
    const id = this.#nextUpdate++;
    const list = this.#updates.get(token) ?? [];
    list.push({ update_id: id, ...update });
    this.#updates.set(token, list);
    this.#flush();
    return id;
  }

  /** A text message from `from` in their private chat (or `chat`), to the main bot or `token`. */
  text(
    from: FakeUser,
    text: string,
    extra: {
      chat?: Record<string, unknown>;
      replyTo?: number;
      /** Who wrote the message replied to (a bot's id). */
      replyToFrom?: number;
      forwarded?: boolean;
      token?: string;
      /** No text: a voice message. */
      voice?: boolean;
    } = {},
  ): number {
    const chat = extra.chat ?? { id: from.id, type: 'private', first_name: from.first_name };
    return this.push(
      {
        message: {
          message_id: this.#nextMessage++,
          date: Math.floor(Date.now() / 1000),
          from: { is_bot: false, ...from },
          chat,
          ...(extra.voice
            ? { voice: { file_id: 'v1', file_unique_id: 'v1', duration: 2 } }
            : { text }),
          ...(text.startsWith('/') && !extra.voice
            ? {
                entities: [{ type: 'bot_command', offset: 0, length: text.split(/\s/)[0]!.length }],
              }
            : {}),
          ...(extra.replyTo !== undefined
            ? {
                reply_to_message: {
                  message_id: extra.replyTo,
                  date: 0,
                  chat,
                  ...(extra.replyToFrom !== undefined
                    ? { from: { id: extra.replyToFrom, is_bot: true, first_name: 'Bot' } }
                    : {}),
                },
              }
            : {}),
          ...(extra.forwarded
            ? {
                forward_origin: {
                  type: 'user',
                  date: 0,
                  sender_user: { id: 42, is_bot: false, first_name: 'Altro' },
                },
              }
            : {}),
        },
      },
      extra.token,
    );
  }

  /** The bot of `token` was added to a group by `by`. */
  addedToGroup(token: string, chat: Record<string, unknown>, by: FakeUser): number {
    const bot = this.#bots.get(token)!;
    return this.push(
      {
        my_chat_member: {
          chat,
          from: { is_bot: false, ...by },
          date: 0,
          old_chat_member: { status: 'left', user: bot },
          new_chat_member: { status: 'member', user: bot },
        },
      },
      token,
    );
  }

  /** The bot of `token` was removed from a group (or it left): `left` or `kicked`. */
  removedFromGroup(
    token: string,
    chat: Record<string, unknown>,
    by: FakeUser,
    status: 'left' | 'kicked' = 'kicked',
  ): number {
    const bot = this.#bots.get(token)!;
    return this.push(
      {
        my_chat_member: {
          chat,
          from: { is_bot: false, ...by },
          date: 0,
          old_chat_member: { status: 'member', user: bot },
          new_chat_member: { status, user: bot },
        },
      },
      token,
    );
  }

  /** `from` presses a button of a message the bot sent. */
  press(from: FakeUser, message: SentMessage, data: string): number {
    return this.push(
      {
        callback_query: {
          id: `cb${this.#nextUpdate}`,
          from: { is_bot: false, ...from },
          chat_instance: 'x',
          data,
          message: {
            message_id: message.message_id,
            date: 0,
            chat: { id: message.chat_id, type: message.chat_id > 0 ? 'private' : 'supergroup' },
            text: message.text,
          },
        },
      },
      message.token,
    );
  }

  sentTo(chatId: number): SentMessage[] {
    return this.messages.filter((m) => m.chat_id === chatId);
  }

  /** Resolves with the first message (past or future) matching `match`. */
  waitMessage(match: (m: SentMessage) => boolean, timeoutMs = WAIT_MS): Promise<SentMessage> {
    return this.#waitFor(() => this.messages.find(match), timeoutMs, 'message');
  }

  waitCall(match: (c: ApiCall) => boolean, timeoutMs = WAIT_MS): Promise<ApiCall> {
    return this.#waitFor(() => this.calls.find(match), timeoutMs, 'call');
  }

  #waitFor<T>(find: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = find();
        if (found === undefined) return false;
        this.#listeners.delete(check);
        clearTimeout(timer);
        resolve(found);
        return true;
      };
      const timer = setTimeout(() => {
        this.#listeners.delete(check);
        reject(
          new Error(
            `fake Telegram: no ${what} within ${timeoutMs} ms; sent: ${JSON.stringify(this.messages.map((m) => m.text.slice(0, 80)))}`,
          ),
        );
      }, timeoutMs);
      if (!check()) this.#listeners.add(check);
    });
  }

  #changed(): void {
    for (const l of [...this.#listeners]) l();
  }

  #flush(): void {
    for (const w of [...this.#waiters]) {
      const ready = (this.#updates.get(w.token) ?? []).filter((u) => u.update_id >= w.offset);
      if (ready.length === 0) continue;
      this.#waiters.splice(this.#waiters.indexOf(w), 1);
      w.resolve(ready);
    }
  }

  async #serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const payload = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');
    const send = (status: number, body: unknown) => {
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!m) return send(404, { ok: false, error_code: 404, description: 'Not Found' });
    const [, token, method] = m;
    this.calls.push({ method: method!, token: token!, payload, at: Date.now() });
    this.#changed();
    const bot = this.#bots.get(token!);
    if (!bot) {
      return send(401, { ok: false, error_code: 401, description: 'Unauthorized' });
    }
    const ok = (result: unknown) => send(200, { ok: true, result });
    switch (method) {
      case 'getMe':
        if (this.holdGetMe) await this.holdGetMe;
        return ok(bot);
      case 'setMyCommands':
      case 'sendChatAction':
      case 'answerCallbackQuery':
      case 'leaveChat':
        return ok(true);
      case 'getUpdates': {
        const offset = Number(payload['offset'] ?? 0);
        if (token === this.token) this.offsets.push(offset);
        const failure = this.#failures.get(token!)?.shift();
        if (failure === 'drop') {
          req.socket.destroy();
          return;
        }
        if (failure === 'error500') {
          return send(500, { ok: false, error_code: 500, description: 'Internal Server Error' });
        }
        if (failure === 'flood') {
          return send(429, {
            ok: false,
            error_code: 429,
            description: 'Too Many Requests: retry after ' + this.floodRetryAfterS,
            parameters: { retry_after: this.floodRetryAfterS },
          });
        }
        if (failure === 'unauthorized') {
          return send(401, { ok: false, error_code: 401, description: 'Unauthorized' });
        }
        if (failure === 'conflict') {
          return send(409, {
            ok: false,
            error_code: 409,
            description: 'Conflict: terminated by other getUpdates request',
          });
        }
        // Confirmed updates are gone, like on Telegram.
        const pending = (this.#updates.get(token!) ?? []).filter((u) => u.update_id >= offset);
        this.#updates.set(token!, pending);
        if (pending.length > 0) return ok(pending);
        const timeout = Number(payload['timeout'] ?? 0) * 1000;
        const updates = await new Promise<unknown[]>((resolve) => {
          const waiter: Waiter = { token: token!, offset, resolve };
          this.#waiters.push(waiter);
          const timer = setTimeout(() => {
            const i = this.#waiters.indexOf(waiter);
            if (i >= 0) this.#waiters.splice(i, 1);
            resolve([]);
          }, timeout);
          res.once('close', () => {
            clearTimeout(timer);
            const i = this.#waiters.indexOf(waiter);
            if (i >= 0) this.#waiters.splice(i, 1);
            resolve([]);
          });
          this.#changed();
        });
        return ok(updates);
      }
      case 'sendMessage': {
        const failure = this.#sendFailures.shift();
        if (failure === 'drop') {
          req.socket.destroy();
          return;
        }
        if (failure === 'error500') {
          return send(500, { ok: false, error_code: 500, description: 'Internal Server Error' });
        }
        if (failure === 'flood') {
          return send(429, {
            ok: false,
            error_code: 429,
            description: 'Too Many Requests: retry after ' + this.floodRetryAfterS,
            parameters: { retry_after: this.floodRetryAfterS },
          });
        }
        if (failure === 'forbidden') {
          return send(403, {
            ok: false,
            error_code: 403,
            description: 'Forbidden: bot was blocked by the user',
          });
        }
        const upgraded = this.#upgraded.get(Number(payload['chat_id']));
        if (upgraded !== undefined) {
          return send(400, {
            ok: false,
            error_code: 400,
            description: 'Bad Request: group chat was upgraded to a supergroup chat',
            parameters: { migrate_to_chat_id: upgraded },
          });
        }
        const refused = invalid(payload);
        if (refused) return send(400, { ok: false, error_code: 400, description: refused });
        const replyTo = (payload['reply_parameters'] as { message_id?: number } | undefined)
          ?.message_id;
        const message: SentMessage = {
          message_id: this.#nextMessage++,
          chat_id: Number(payload['chat_id']),
          token: token!,
          ...(replyTo !== undefined ? { reply_to: replyTo } : {}),
          text: typeof payload['text'] === 'string' ? payload['text'] : '',
          ...(typeof payload['parse_mode'] === 'string'
            ? { parse_mode: payload['parse_mode'] }
            : {}),
          ...(payload['reply_markup'] ? { reply_markup: payload['reply_markup'] } : {}),
          ...(payload['disable_notification'] ? { disable_notification: true } : {}),
          edits: [],
        };
        this.messages.push(message);
        this.#changed();
        return ok({
          message_id: message.message_id,
          date: Math.floor(Date.now() / 1000),
          chat: { id: message.chat_id, type: 'private' },
          text: message.text,
        });
      }
      case 'editMessageText': {
        const editFailure = this.#editFailures.shift();
        if (editFailure) {
          return send(400, { ok: false, error_code: 400, description: editFailure });
        }
        const refused = invalid(payload);
        if (refused) return send(400, { ok: false, error_code: 400, description: refused });
        const target = this.messages.find(
          (x) =>
            x.token === token &&
            x.chat_id === Number(payload['chat_id']) &&
            x.message_id === Number(payload['message_id']),
        );
        if (!target)
          return send(400, {
            ok: false,
            error_code: 400,
            description: 'Bad Request: message to edit not found',
          });
        target.text = typeof payload['text'] === 'string' ? payload['text'] : '';
        target.edits.push(target.text);
        const markup = payload['reply_markup'] as SentMessage['reply_markup'] | undefined;
        if (markup) target.reply_markup = markup;
        this.#changed();
        return ok({
          message_id: target.message_id,
          date: 0,
          chat: { id: target.chat_id, type: 'private' },
          text: target.text,
        });
      }
      case 'editMessageReplyMarkup': {
        const target = this.messages.find(
          (x) =>
            x.token === token &&
            x.chat_id === Number(payload['chat_id']) &&
            x.message_id === Number(payload['message_id']),
        );
        if (!target)
          return send(400, {
            ok: false,
            error_code: 400,
            description: 'Bad Request: message to edit not found',
          });
        const markup = payload['reply_markup'] as SentMessage['reply_markup'] | undefined;
        if (JSON.stringify(markup ?? {}) === JSON.stringify(target.reply_markup ?? {})) {
          return send(400, {
            ok: false,
            error_code: 400,
            description: 'Bad Request: message is not modified',
          });
        }
        if (markup) target.reply_markup = markup;
        this.#changed();
        return ok({
          message_id: target.message_id,
          date: 0,
          chat: { id: target.chat_id, type: 'private' },
          text: target.text,
        });
      }
      default:
        return send(404, {
          ok: false,
          error_code: 404,
          description: `Not Found: method ${method}`,
        });
    }
  }
}
