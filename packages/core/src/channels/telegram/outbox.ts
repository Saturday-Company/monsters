import { setTimeout as sleep } from 'node:timers/promises';
import { GrammyError, HttpError, type Api } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';
import { forTelegram, splitHtml, splitMarkdown, toTelegramHtml } from './format.ts';

/*
 * What a dedicated bot sends (D-107): one ordered queue per chat, sent again
 * while the failure is transient (network, Telegram 5xx, 429) with backoff,
 * up to a limit; a chat that is no longer allowed when its turn comes gets
 * nothing. The same rules as the main bot's queue (D-036), for one bot.
 */

/** Errors worth sending again: the network, Telegram itself, too many messages. */
export function transient(err: unknown): boolean {
  return (
    err instanceof HttpError ||
    (err instanceof GrammyError && (err.error_code === 429 || err.error_code >= 500))
  );
}

/** Telegram said no for good: the bot was blocked, kicked or left the chat. */
export function forbidden(err: unknown): err is GrammyError {
  return err instanceof GrammyError && err.error_code === 403;
}

/**
 * How long to wait before sending again. A 429 says exactly how long
 * (`retry_after`, all of it: coming back earlier extends the flood control);
 * the rest backs off.
 */
export function retryWaitMs(err: unknown, failures: number, base: number, max: number): number {
  if (err instanceof GrammyError && err.error_code === 429) {
    return (err.parameters.retry_after ?? 1) * 1000;
  }
  return Math.min(max, base * 2 ** Math.min(failures, 16)) * (0.8 + Math.random() * 0.4);
}

/**
 * Telegram refused because the group became a supergroup: the new chat id is
 * in the error's `parameters` (400 "group chat was upgraded to a supergroup chat").
 */
export function migratedTo(err: unknown): number | undefined {
  if (err instanceof GrammyError && err.error_code === 400) {
    return err.parameters.migrate_to_chat_id;
  }
  return undefined;
}

/** An edit that fails for a reason that leaves nothing to do: already like that, gone, too old. */
export function editMoot(err: unknown): boolean {
  return (
    err instanceof GrammyError &&
    err.error_code === 400 &&
    /not modified|message to edit not found|can't be edited|message_id_invalid/i.test(
      err.description,
    )
  );
}

/** Minimum gap between two sends to the same chat (Telegram: ~1/s in private, ~20/min in groups). */
export interface ChatGapMs {
  private?: number;
  group?: number;
}

export const DEFAULT_CHAT_GAP: Required<ChatGapMs> = { private: 1000, group: 3000 };

/**
 * A rhythm per chat: `wait` holds a send until the gap since the previous
 * one has passed, `sent` starts the gap. Telegram's flood control starts
 * well before a 429 would slow us down, so we do not wait for it.
 */
export class ChatPacer {
  readonly #gap: Required<ChatGapMs>;
  readonly #next = new Map<number, number>();

  constructor(gap: ChatGapMs = {}) {
    this.#gap = { ...DEFAULT_CHAT_GAP, ...gap };
  }

  async wait(chatId: number, signal: AbortSignal): Promise<void> {
    const delay = (this.#next.get(chatId) ?? 0) - Date.now();
    if (delay > 0) await sleep(delay, undefined, { signal }).catch(() => {});
  }

  /** The gap of a chat (a group is slower than a private chat). */
  gapOf(chatId: number): number {
    return chatId < 0 ? this.#gap.group : this.#gap.private;
  }

  sent(chatId: number): void {
    const now = Date.now();
    if (this.#next.size > 200) {
      for (const [id, at] of this.#next) if (at <= now) this.#next.delete(id);
    }
    this.#next.set(chatId, now + this.gapOf(chatId));
  }
}

export interface OutboxOptions {
  /** Still allowed to receive when its message leaves (an approved group, an allowed person). */
  allowed: (chatId: number) => boolean;
  /**
   * Telegram refused with a 403 (bot blocked, kicked, or left): the chat's
   * queue stops until `unblock`. Called once, with the chat.
   */
  refused?: (chatId: number, err: GrammyError) => void;
  /** A message dropped after its retries (logged by the caller, never its text). */
  failed: (message: string) => void;
  /** The group became a supergroup (found in a 400): the caller moves its own state. */
  migrated?: (from: number, to: number) => void;
  retryBaseMs?: number | undefined;
  retryMaxMs?: number | undefined;
  sendGiveUpMs?: number | undefined;
  sendQueueMax?: number | undefined;
  chatGapMs?: ChatGapMs | undefined;
}

export interface SendOptions {
  /** Already Telegram HTML; otherwise Markdown, split into messages. */
  html?: boolean;
  markup?: InlineKeyboardMarkup;
  /** The message it answers (in a group: the request of that person). */
  replyTo?: number | undefined;
  silent?: boolean;
  /** Called with the id of the last message sent. */
  sent?: (messageId: number) => void;
}

/** Longest wait for the queue when the bot stops. */
const CLOSE_MAX_MS = 20_000;
/** Time for the last message of each chat to get its answer. */
const CLOSE_MARGIN_MS = 3_000;

export class Outbox {
  readonly #o: OutboxOptions;
  readonly #pacer: ChatPacer;
  #api: Api | null = null;
  #abort: AbortController | null = null;
  readonly #chains = new Map<number, Promise<unknown>>();
  readonly #queued = new Map<number, number>();
  readonly #overflowed = new Set<number>();
  /** Chats that answered 403: nothing more is sent there until they write again. */
  readonly #blocked = new Set<number>();
  /** Groups that became supergroups: the old id leads to the new one. */
  readonly #moved = new Map<number, number>();

  constructor(options: OutboxOptions) {
    this.#o = options;
    this.#pacer = new ChatPacer(options.chatGapMs);
  }

  /**
   * Starts sending with `api`. Open already (a new token of the same bot): the messages
   * waiting keep their place and leave with the new one (review of 19/10, item 11).
   */
  open(api: Api): void {
    this.#api = api;
    this.#abort ??= new AbortController();
  }

  /**
   * Waits for what is on its way as long as its queue needs at the chats' pace (with a
   * ceiling: Telegram down must not hold the closing), then stops retrying.
   */
  async close(maxMs = CLOSE_MAX_MS): Promise<void> {
    let needed = 0;
    for (const [chatId, n] of this.#queued) {
      needed = Math.max(needed, n * this.#pacer.gapOf(chatId));
    }
    const wait = Math.min(maxMs, needed + CLOSE_MARGIN_MS);
    await Promise.race([Promise.allSettled([...this.#chains.values()]), sleep(wait)]);
    this.#abort?.abort();
    this.#abort = null;
    this.#api = null;
  }

  /** The chat can be written to again (the person wrote, the bot was added back). */
  unblock(chatId: number): void {
    this.#blocked.delete(chatId);
  }

  /** Nothing more is sent to this chat (the bot is out of it) until `unblock`. */
  drop(chatId: number): void {
    this.#blocked.add(chatId);
  }

  /** The chat is now another one (a group that became a supergroup). */
  moved(from: number, to: number): void {
    if (from === to) return;
    this.#moved.set(from, to);
    if (this.#blocked.delete(from)) this.#blocked.add(to);
  }

  /** The id to write to now: the chat's own, or the supergroup it became. */
  current(chatId: number): number {
    let id = chatId;
    for (let i = 0; i < 5 && this.#moved.has(id); i++) id = this.#moved.get(id)!;
    return id;
  }

  /**
   * Runs `job` after the earlier messages of the same chat. `job` gets the
   * chat to write to, which may change while it waits (migration to a supergroup).
   */
  enqueue(startChatId: number, job: (api: Api, chatId: number) => Promise<unknown>): void {
    const chatId = this.current(startChatId);
    const signal = this.#abort?.signal;
    if (!this.#api || !signal || this.#blocked.has(chatId)) return;
    const queued = this.#queued.get(chatId) ?? 0;
    if (queued >= (this.#o.sendQueueMax ?? 100)) {
      if (!this.#overflowed.has(chatId)) {
        this.#overflowed.add(chatId);
        this.#o.failed(`chat ${chatId}: too many messages waiting, the newest are dropped`);
      }
      return;
    }
    this.#queued.set(chatId, queued + 1);
    const prev = this.#chains.get(chatId) ?? Promise.resolve();
    const next = prev
      .then(() => {
        const target = this.current(chatId);
        if (signal.aborted || this.#blocked.has(target) || !this.#o.allowed(target)) return;
        return this.#pacer
          .wait(target, signal)
          .then(() => {
            // The Api of now: a new token of the bot since the message was queued.
            const api = this.#api;
            return signal.aborted || !api ? undefined : this.#attempt(api, target, job, signal);
          })
          .finally(() => this.#pacer.sent(this.current(target)));
      })
      .catch((err: unknown) => {
        if (forbidden(err)) {
          // Once per chat: the rest of its queue is skipped above.
          if (!this.#blocked.has(chatId)) {
            this.#blocked.add(chatId);
            this.#o.refused?.(chatId, err);
          }
          return;
        }
        this.#o.failed(
          err instanceof GrammyError
            ? `${err.method}: ${err.error_code} ${err.description}`
            : err instanceof Error
              ? err.message
              : String(err),
        );
      })
      .finally(() => {
        const left = (this.#queued.get(chatId) ?? 1) - 1;
        if (left > 0) this.#queued.set(chatId, left);
        else {
          this.#queued.delete(chatId);
          this.#overflowed.delete(chatId);
        }
      });
    this.#chains.set(chatId, next);
    // `finally` makes a promise of its own: a rejection there must not reach the process.
    next
      .finally(() => {
        if (this.#chains.get(chatId) === next) this.#chains.delete(chatId);
      })
      .catch(() => {});
  }

  /** One job, and one more try at the supergroup when Telegram says the group moved. */
  async #attempt(
    api: Api,
    chatId: number,
    job: (api: Api, chatId: number) => Promise<unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    try {
      return await this.#withRetry(() => job(api, chatId), signal);
    } catch (err) {
      const to = migratedTo(err);
      if (to === undefined || to === chatId) throw err;
      this.moved(chatId, to);
      this.#o.migrated?.(chatId, to);
      return this.#withRetry(() => job(api, to), signal);
    }
  }

  /** Text (Markdown by default) split into messages; HTML refused → plain text. */
  send(chatId: number, text: string, options: SendOptions = {}): void {
    const pieces = options.html ? splitHtml(text) : splitMarkdown(forTelegram(text));
    pieces.forEach((piece, i) => {
      const last = i === pieces.length - 1;
      const html = options.html ? piece : toTelegramHtml(piece);
      this.enqueue(chatId, async (api, chat) => {
        const extra = {
          ...(last && options.markup ? { reply_markup: options.markup } : {}),
          ...(options.silent ? { disable_notification: true } : {}),
          ...(i === 0 && options.replyTo !== undefined
            ? {
                reply_parameters: {
                  message_id: options.replyTo,
                  allow_sending_without_reply: true,
                },
              }
            : {}),
          link_preview_options: { is_disabled: true },
        };
        let id: number;
        try {
          id = (await api.sendMessage(chat, html, { parse_mode: 'HTML', ...extra })).message_id;
        } catch (err) {
          if (
            err instanceof GrammyError &&
            err.error_code === 400 &&
            /parse|entit/i.test(err.description)
          ) {
            id = (await api.sendMessage(chat, piece, extra)).message_id;
          } else throw err;
        }
        if (last) options.sent?.(id);
      });
    });
  }

  edit(chatId: number, messageId: number, html: string): void {
    this.enqueue(chatId, async (api, chat) => {
      try {
        await api.editMessageText(chat, messageId, html, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] },
          link_preview_options: { is_disabled: true },
        });
      } catch (err) {
        // Already like that, or gone: nothing to do. Any other refusal is logged.
        if (editMoot(err)) return;
        throw err;
      }
    });
  }

  async #withRetry<T>(call: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const giveUpAt = Date.now() + (this.#o.sendGiveUpMs ?? 30 * 60_000);
    const base = this.#o.retryBaseMs ?? 1000;
    const max = this.#o.retryMaxMs ?? 60_000;
    for (let failures = 0; ; failures++) {
      try {
        return await call();
      } catch (err) {
        if (!transient(err) || signal.aborted) throw err;
        const wait = retryWaitMs(err, failures, base, max);
        if (Date.now() + wait > giveUpAt) throw err;
        await sleep(wait, undefined, { signal }).catch(() => {});
        if (signal.aborted) throw err;
      }
    }
  }
}
