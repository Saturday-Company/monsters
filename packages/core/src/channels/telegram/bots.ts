import { setTimeout as sleep } from 'node:timers/promises';
import {
  extractTelegramToken,
  onAppLang,
  settingsPath,
  telegramTokenShapeMessage,
  type Channel,
  type LogEvent,
  type Question,
  type TelegramBotPerson,
  type TelegramBotView,
  type TelegramChatType,
  type TelegramOrigin,
  type TelegramStatus,
  type TelegramUser,
  spendCapPath,
} from '@monsters/shared';
import { Api, GrammyError, HttpError } from 'grammy';
import type { CallbackQuery, InlineKeyboardMarkup, Message, Update } from 'grammy/types';
import { assertRecent, type RecentProof } from '../../auth/recent.ts';
import { migrate } from '../../db/migrations.ts';
import type { Db } from '../../db/sqlite.ts';
import type { StateStore } from '../../db/state-store.ts';
import { HaltedError, type RunController } from '../../kill/run-controller.ts';
import type { EventLog } from '../../log/event-log.ts';
import { readProviderKey, removeProviderKey, saveProviderKey } from '../../providers/keys.ts';
import { draftOfEvent } from '../../projects/drafts.ts';
import { DispatchError, type SendResult } from '../../team/dispatcher.ts';
import { QuestionError, type QuestionAnswer, type QuestionStore } from '../../team/questions.ts';
import type { TeamService } from '../../team/team-service.ts';
import { TelegramBotStore, type BotRow, type RequestSource } from './bot-store.ts';
import { clip, escapeHtml, plainName } from './format.ts';
import { telegramClient, tokenCheckFailure, tokenRefused } from './net.ts';
import { Outbox, type ChatGapMs } from './outbox.ts';
import { botsStrings } from './bots.strings.ts';
import { COMMAND_ALIASES, telegramStrings } from './telegram.strings.ts';
import { telegramMigrations } from './store.ts';

/*
 * Bots dedicated to one monster (D-107): each with its own token (a secret,
 * `tgbot-<bot id>`), its own long-poll loop and its own monster. Put in a
 * group, everyone the user allowed can talk to the monster there.
 *
 * Who may talk: the accounts paired with the main bot (the user, always) and
 * the people the user approved for this bot (asked with `/join`, or added by
 * id). Where: private chats with them, and the groups the user approved (the
 * bot reports a group when it is added, or at its first message). In a group
 * the bot answers only when it is mentioned, replied to or given a command.
 * Everything else is ignored (a `channel` log line, at most once every 10 s).
 *
 * A message reaches the monster in the conversation of that chat (`thread`,
 * see the dispatcher), with who wrote it; the monster's answer, its ordinary
 * questions and their answers stay in the chat. What only the user decides
 * (the cards of the brake, the drafts, the spending cap) is never answered
 * there: it goes to the user (the main bot in private and the app), and the
 * chat gets one line. One bot failing never stops the others or the main bot;
 * the kill switch stops the work, the loops keep answering "fermi".
 */

const KEY_PREFIX = 'tgbot-';
const OFFSET_PREFIX = 'telegram_bot_offset:';
const COUNT_PREFIX = 'telegram_bot_day:';
/**
 * Requests waiting for the user at most, per bot (groups and people each). Past it the oldest
 * request makes room for the new one, a stranger's first: strangers who flood the bot push out
 * their own old requests, never a real one (review of 18/10, item 8).
 */
export const PENDING_MAX = 20;
/**
 * Requests waiting at most from one source: the groups one person added the bot to, the people
 * asking from one group. Past it that source's own oldest request makes room.
 */
export const PENDING_PER_SOURCE = 5;
/** A request nobody approved for this long is dropped (the person or the group can ask again). */
export const PENDING_TTL_MS = 14 * 24 * 3_600_000;
/**
 * The same for a stranger never seen (a group added by someone the user does not know, a
 * `/join` in private): two days.
 */
export const PENDING_STRANGER_TTL_MS = 2 * 24 * 3_600_000;
/**
 * Messages a day that reach a dedicated bot's monster when the user set no
 * limit: the cap in euro does not apply to a subscription, so without this the
 * people allowed in a group could use up the user's plan.
 */
export const DEFAULT_DAILY_LIMIT = 100;
/** Messages an hour that reach the monster from one person other than the user. */
export const PERSON_HOURLY_LIMIT = 20;
/** Notices an hour to the user about one bot (groups, requests); past that, one line and silence. */
export const OWNER_NOTICES_PER_HOUR = 10;
const HOUR_MS = 3_600_000;
/** Added once to a request's notice when the oldest one had to go to make room for it. */
const fullNote = (max: number) => botsStrings().fullNote(max);

/**
 * Why `replyCheck` holds a reply with a key: «Send anyway» is never offered for it. It is a
 * marker the hub returns and `#onEvent` compares; it is shown as `replyKeyReason` (in the
 * language of the moment), never as it is.
 */
export const REPLY_KEY_REASON = 'contiene una chiave o un codice segreto'; // i18n-ignore: marker, shown translated

/** What `replyCheck` answered, in words the user reads. */
const whyText = (why: string): string =>
  why === REPLY_KEY_REASON ? botsStrings().replyKeyReason : why;

export type TelegramBotsErrorCode =
  | 'invalid_token'
  | 'verification_failed'
  | 'bot_in_use'
  | 'other_bot'
  | 'invalid_agent'
  | 'owner'
  | 'not_found'
  | 'already_sent';

export class TelegramBotsError extends Error {
  readonly code: TelegramBotsErrorCode;
  constructor(code: TelegramBotsErrorCode, message: string) {
    super(message);
    this.name = 'TelegramBotsError';
    this.code = code;
  }
}

export interface TelegramBotsOptions {
  db: Db;
  log: EventLog;
  state: StateStore;
  runs: RunController;
  questions: QuestionStore;
  team: TeamService;
  secretsDir: string;
  /** The accounts paired with the main bot: the user. */
  owners: () => TelegramUser[];
  /** How the monsters call the user ("Giulio"). */
  ownerName: () => string;
  /** The main bot's id and token, never usable here (one long poll per token). */
  mainBot: () => { id?: number | undefined; token?: string | undefined };
  send: (params: {
    text: string;
    to: string;
    channel: Channel;
    telegram: TelegramOrigin;
  }) => SendResult;
  /** `by` is who answered in the chat (several people share a bot): it goes in the log. */
  answer: (id: string, answer: QuestionAnswer, channel: Channel, by?: string) => Question;
  /** False until the first start is completed in the UI. */
  ready: () => boolean;
  /** Why the monster may not spend now (its cap, its project's, the team's), or null. */
  spendStop: (agentId: string) => string | null;
  /**
   * A notice to the user in private (the main bot), quiet hours respected; `held` adds the
   * button «Manda comunque» for a reply that did not go (`sendHeld`).
   */
  tellOwner: (
    text: string,
    meta: { agent: string; runId: string | null },
    held?: { id: string },
  ) => void;
  /**
   * A reply of the monster to a chat where not only the user reads (a group, a private chat
   * with someone else), checked as an action that sends data out (D-114): why it must not go
   * (a key, a private note, a long piece of the notes or of the memory), or null. `agent` is
   * the bot's monster (its project's notes are the group's own). The questions of the monster
   * to the chat pass the same check.
   */
  replyCheck?: (runId: string, text: string, agent: string) => string | null;
  apiRoot?: string | undefined;
  pollTimeoutS?: number | undefined;
  retryBaseMs?: number | undefined;
  retryMaxMs?: number | undefined;
  sendGiveUpMs?: number | undefined;
  sendQueueMax?: number | undefined;
  chatGapMs?: ChatGapMs | undefined;
  typingIntervalMs?: number | undefined;
  /** Messages an hour from one person other than the user. Default `PERSON_HOURLY_LIMIT`. */
  personHourlyLimit?: number | undefined;
  /** Notices an hour to the user about one bot. Default `OWNER_NOTICES_PER_HOUR`. */
  ownerNoticesPerHour?: number | undefined;
  /** Requests waiting at most, groups and people each. Default `PENDING_MAX`. */
  pendingMax?: number | undefined;
  now?: () => number;
}

interface Track {
  chatId: number;
  /** The person whose request the run works on: they answer its questions. */
  requester?: number;
  /** Their message: the answer replies to it (in a group, the thread is clear). */
  replyTo?: number;
  typing: NodeJS.Timeout | null;
}

type GrammySignal = Parameters<Api['getMe']>[0];
const grammySignal = (signal: AbortSignal) => signal as unknown as GrammySignal;

function displayName(u: { first_name: string; last_name?: string | undefined }): string {
  return [u.first_name, u.last_name].filter(Boolean).join(' ').slice(0, 80) || 'Telegram';
}

/** " (@name)" when the username has only the characters Telegram allows, else nothing. */
function safeUsername(username: string | undefined): string {
  return username && /^\w{1,64}$/.test(username) ? ` (@${username})` : '';
}

function chatTitle(chat: Message['chat']): string {
  return 'title' in chat && chat.title ? chat.title.slice(0, 200) : botsStrings().group;
}

/** Local day, for the daily limit. */
function dayOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** One dedicated bot: its loop, its queue, what it is working on. */
class DedicatedBot {
  readonly id: string;
  readonly #m: TelegramBots;
  readonly #o: TelegramBotsOptions;
  readonly outbox: Outbox;
  status: TelegramStatus = 'connecting';
  error: string | undefined;
  #api: Api | null = null;
  #me: { id: number; username: string } | null = null;
  #abort: AbortController | null = null;
  #loop: Promise<void> | null = null;
  /** Stopped for good (removed, or the core closing): no restart starts it again. */
  #closed = false;
  /** `restart` and `stop` one at a time: two of them never leave two loops (review of 19/10). */
  #serial: Promise<void> = Promise.resolve();
  readonly tracks = new Map<string, Track>();
  readonly #ignoredAt = new Map<string, number>();

  constructor(id: string, manager: TelegramBots, options: TelegramBotsOptions) {
    this.id = id;
    this.#m = manager;
    this.#o = options;
    this.outbox = new Outbox({
      allowed: (chatId) => this.#mayReceive(chatId),
      failed: (message) =>
        this.#m.append({
          agent: 'system',
          type: 'error',
          data: { code: 'telegram_send_failed', message: `bot ${this.id}: ${message}` },
        }),
      refused: (chatId, err) => this.#refused(chatId, err.description),
      migrated: (from, to) => this.migrate(from, to),
      retryBaseMs: options.retryBaseMs,
      retryMaxMs: options.retryMaxMs,
      sendGiveUpMs: options.sendGiveUpMs,
      sendQueueMax: options.sendQueueMax,
      chatGapMs: options.chatGapMs,
    });
    for (const [from, to] of manager.store.moves(id)) this.outbox.moved(from, to);
  }

  get row(): BotRow | undefined {
    return this.#m.store.bot(this.id);
  }

  start(token: string): void {
    this.#api = new Api(token, telegramClient(this.#o.apiRoot, (this.#o.pollTimeoutS ?? 30) + 15));
    this.outbox.open(this.#api);
    this.status = 'connecting';
    this.error = undefined;
    const abort = new AbortController();
    this.#abort = abort;
    this.#loop = this.#supervise(this.#api, abort.signal);
  }

  /**
   * Keeps the polling alive: an unexpected error in `#run` is logged, shown as
   * `retrying`, and the loop starts again with backoff (it used to stop for
   * good, and the only cure was removing the bot). One bot failing never
   * stops another.
   */
  async #supervise(api: Api, signal: AbortSignal): Promise<void> {
    for (let crashes = 0; !signal.aborted; crashes++) {
      try {
        await this.#run(api, signal);
        return;
      } catch (err) {
        this.status = 'retrying';
        this.error = botsStrings().crashed;
        try {
          this.#m.append({
            agent: 'system',
            type: 'error',
            data: {
              code: 'telegram_failed',
              message: `bot ${this.id}: ${err instanceof Error ? err.message : String(err)}`,
            },
          });
        } catch {
          // The log failed too (closing core): the loop still backs off and goes on, or ends with the signal.
          // Nobody awaits this promise until the stop: a throw here would be an unhandled rejection.
        }
        const base = this.#o.retryBaseMs ?? 1000;
        const max = this.#o.retryMaxMs ?? 60_000;
        await sleep(Math.min(max, base * 2 ** Math.min(crashes, 16)), undefined, { signal }).catch(
          () => {},
        );
      }
    }
  }

  #queue(job: () => Promise<void>): Promise<void> {
    const run = this.#serial.then(job);
    this.#serial = run.catch(() => {});
    return run;
  }

  /** Stops the polling (and the typing), not the queue of messages. */
  async #halt(): Promise<void> {
    this.#abort?.abort();
    await this.#loop;
    for (const t of this.tracks.values()) this.stopTyping(t);
  }

  /** Stops for good: the polling, then the messages still on their way. */
  async stop(): Promise<void> {
    this.#closed = true;
    await this.#queue(async () => {
      await this.#halt();
      await this.outbox.close();
      this.#api = null;
      this.status = 'off';
    });
  }

  /**
   * The loop starts again with another token of the same bot: groups, people and work stay,
   * and so do the messages waiting to be sent (they leave with the new token).
   */
  async restart(token: string): Promise<void> {
    await this.#queue(async () => {
      if (this.#closed) return;
      await this.#halt();
      if (this.#closed) return;
      this.#me = null;
      this.start(token);
      for (const runId of this.tracks.keys()) this.startTyping(runId);
    });
  }

  // --- polling -------------------------------------------------------------------

  async #run(api: Api, signal: AbortSignal): Promise<void> {
    let failures = 0;
    // What Telegram asked for with a 429: nothing sooner.
    let floodMs = 0;
    const backoff = async () => {
      failures++;
      const base = this.#o.retryBaseMs ?? 1000;
      const max = this.#o.retryMaxMs ?? 60_000;
      const wait =
        floodMs > 0
          ? floodMs
          : Math.min(max, base * 2 ** Math.min(failures - 1, 16)) * (0.8 + Math.random() * 0.4);
      floodMs = 0;
      await sleep(wait, undefined, { signal }).catch(() => {});
    };
    const fail = (err: unknown): 'stop' | 'retry' => {
      if (signal.aborted) return 'stop';
      if (err instanceof GrammyError && err.error_code === 429) {
        floodMs = (err.parameters.retry_after ?? 1) * 1000;
        this.#down('retrying', telegramStrings().slowDown, err);
        return 'retry';
      }
      if (tokenRefused(err)) {
        this.#down('error', botsStrings().tokenRefused, err);
        return 'stop';
      }
      if (err instanceof GrammyError && err.error_code === 409) {
        this.#down('conflict', botsStrings().tokenInUse, err);
        return 'retry';
      }
      this.#down('retrying', telegramStrings().notResponding, err);
      return 'retry';
    };

    while (!signal.aborted && !this.#me) {
      try {
        const me = await api.getMe(grammySignal(signal));
        if (String(me.id) !== this.id) {
          this.#down('error', botsStrings().tokenOfAnotherBot, null);
          return;
        }
        this.#me = { id: me.id, username: me.username };
      } catch (err) {
        if (fail(err) === 'stop') return;
        await backoff();
      }
    }
    if (signal.aborted || !this.#me) return;
    void api.setMyCommands(botsStrings().commands, undefined, grammySignal(signal)).catch(() => {});

    const key = `${OFFSET_PREFIX}${this.id}`;
    let offset = this.#o.state.get<number>(key) ?? 0;
    let quick = true;
    while (!signal.aborted) {
      let updates: Update[];
      try {
        updates = await api.getUpdates(
          {
            offset,
            timeout: quick ? 0 : (this.#o.pollTimeoutS ?? 30),
            allowed_updates: ['message', 'callback_query', 'my_chat_member'],
          },
          grammySignal(signal),
        );
      } catch (err) {
        if (fail(err) === 'stop') return;
        quick = true;
        await backoff();
        continue;
      }
      failures = 0;
      quick = false;
      this.#online();
      for (const u of updates) {
        offset = u.update_id + 1;
        // Before handling it: at most once. A crash in the middle never runs a command twice.
        this.#o.state.set(key, offset);
        try {
          this.#handle(u);
        } catch (err) {
          this.#m.append({
            agent: 'system',
            type: 'error',
            data: {
              code: 'telegram_update_failed',
              message: `bot ${this.id}: ${err instanceof Error ? err.message : String(err)}`,
            },
          });
        }
      }
    }
  }

  #online(): void {
    if (this.status === 'online') return;
    this.status = 'online';
    this.error = undefined;
    this.#m.channelEvent({ action: 'connected', bot: this.id, name: this.#at() });
  }

  #down(status: TelegramStatus, text: string, err: unknown): void {
    const was = this.status;
    const wasUp = was === 'online' || was === 'connecting';
    this.status = status;
    this.error = text;
    // A conflict lasts as long as the other program: one event when it starts, not one per try.
    if (status === 'conflict' ? was === 'conflict' : !wasUp && status !== 'error') return;
    const detail =
      err instanceof GrammyError
        ? `${err.error_code} ${err.description}`
        : err instanceof HttpError || err instanceof Error
          ? err.message
          : '';
    this.#m.channelEvent({
      action: 'disconnected',
      bot: this.id,
      name: this.#at(),
      reason: status,
      ...(detail ? { message: detail.slice(0, 300) } : {}),
    });
  }

  #at(): string {
    return `@${this.#me?.username ?? this.row?.username ?? this.id}`;
  }

  // --- who and where ----------------------------------------------------------------

  isOwner(userId: number): boolean {
    return this.#o.owners().some((u) => u.id === userId);
  }

  #allowedPerson(userId: number): boolean {
    return this.isOwner(userId) || this.#m.store.person(this.id, userId)?.status === 'approved';
  }

  /** A chat that may get messages now: an approved group, or a private chat with an allowed person. */
  #mayReceive(chatId: number): boolean {
    if (chatId > 0) return this.#allowedPerson(chatId);
    return this.#m.store.chat(this.id, chatId)?.status === 'approved';
  }

  #ignore(
    from: { id: number; first_name?: string; username?: string | undefined } | undefined,
    reason: string,
    chatId?: number,
  ): void {
    const key = `${from?.id ?? 0}:${chatId ?? 0}:${reason}`;
    const now = this.#m.now();
    const last = this.#ignoredAt.get(key);
    if (last !== undefined && now - last < 10_000) return;
    if (this.#ignoredAt.size > 1000) this.#ignoredAt.clear();
    this.#ignoredAt.set(key, now);
    // Never the text: who, where, why.
    this.#m.channelEvent({
      action: 'ignored',
      bot: this.id,
      ...(from ? { userId: String(from.id) } : {}),
      ...(from?.username
        ? { name: `@${from.username}` }
        : from?.first_name
          ? { name: from.first_name }
          : {}),
      ...(chatId !== undefined && chatId < 0 ? { chatId: String(chatId) } : {}),
      reason,
    });
  }

  /**
   * The bot is out of a group (removed, or it left), or a person blocked it:
   * the chat's queue stops and it shows (Attività, and the user is told).
   * A group is forgotten: if the bot comes back it is to approve again.
   */
  #gone(chatId: number, reason: 'left' | 'kicked' | 'forbidden', detail?: string): void {
    const group = chatId < 0;
    // Not gone: it became a supergroup and the bot is in the new one.
    if (group && this.outbox.current(chatId) !== chatId) return;
    const chat = group ? this.#m.store.chat(this.id, chatId) : undefined;
    if (group && !chat) return;
    const person = group ? undefined : this.#m.store.person(this.id, chatId);
    if (chat) this.#m.store.removeChat(this.id, chatId);
    this.outbox.drop(chatId);
    const name = chat?.title ?? person?.name;
    this.#m.channelEvent({
      action: 'chat_left',
      bot: this.id,
      ...(group ? { chatId: String(chatId) } : { userId: String(chatId) }),
      ...(name ? { name: clip(name, 200) } : {}),
      reason,
      ...(detail ? { message: detail.slice(0, 200) } : {}),
    });
    const agent = this.row?.agent ?? '';
    const t = botsStrings();
    this.#m.tell(
      this.id,
      group
        ? t.botLeftGroup(this.#at(), this.#m.agentName(agent), plainName(name ?? t.noName))
        : t.botBlocked(plainName(name ?? t.someone), this.#at(), this.#m.agentName(agent)),
      { agent, runId: null },
    );
  }

  /**
   * A group became a supergroup (new id): the group keeps its approval, the
   * work in progress replies to the new chat, the old id leads to the new one.
   */
  migrate(from: number, to: number): void {
    if (from === to) return;
    this.outbox.moved(from, to);
    this.#m.store.noteMove(this.id, from, to);
    for (const t of this.tracks.values()) if (t.chatId === from) t.chatId = to;
    const chat = this.#m.store.chat(this.id, from);
    if (!chat || !this.#m.store.migrateChat(this.id, from, to)) return;
    this.#m.channelEvent({
      action: 'chat_migrated',
      bot: this.id,
      chatId: String(to),
      name: chat.title,
    });
  }

  /** A 403 on a send: the bot cannot write there any more. */
  #refused(chatId: number, description: string): void {
    this.#gone(chatId, 'forbidden', description);
  }

  /**
   * Room for one more request of this kind, from `from` (residual of the review of 18/10,
   * item 8). Expired requests are dropped (a stranger's after `PENDING_STRANGER_TTL_MS`, the
   * others after `PENDING_TTL_MS`); one source (the person adding the bot to groups, the group
   * people ask from) keeps at most `PENDING_PER_SOURCE`, its own oldest making room; at the
   * cap a stranger's request goes first, and a new stranger never pushes out a vouched one
   * (`store: false`: the new request is not kept). `full`: true the first time a request still
   * waiting had to go for the cap (the notice says it once, until they are under it again).
   */
  #makeRoom(kind: 'chats' | 'people', from: RequestSource): { store: boolean; full: boolean } {
    const now = this.#m.now();
    const max = this.#m.pendingMax();
    const drop = (id: number) =>
      kind === 'chats'
        ? this.#m.store.removeChat(this.id, id)
        : this.#m.store.removePerson(this.id, id);
    // Oldest first (the store lists them by `added_at`).
    let pending = this.#m.store.pendingRequests(this.id, kind).filter((r) => {
      const ttl = r.vouched ? PENDING_TTL_MS : PENDING_STRANGER_TTL_MS;
      if (now - r.addedAt <= ttl) return true;
      drop(r.id);
      return false;
    });
    if (from.source !== undefined) {
      const mine = pending.filter((r) => r.source === from.source);
      const over = new Set(
        mine.slice(0, Math.max(0, mine.length - PENDING_PER_SOURCE + 1)).map((r) => r.id),
      );
      for (const id of over) drop(id);
      pending = pending.filter((r) => !over.has(r.id));
    }
    if (pending.length < max) {
      this.#toldFull.delete(kind);
      return { store: true, full: false };
    }
    const strangers = pending.filter((r) => !r.vouched);
    if (!from.vouched && strangers.length <= pending.length - max) {
      // Only vouched requests would have to go: the stranger waits outside.
      return { store: false, full: false };
    }
    const order = [...strangers, ...(from.vouched ? pending.filter((r) => r.vouched) : [])];
    let left = pending.length;
    for (const r of order) {
      if (left < max) break;
      drop(r.id);
      left--;
    }
    if (this.#toldFull.has(kind)) return { store: true, full: false };
    this.#toldFull.add(kind);
    return { store: true, full: true };
  }

  /** A request from someone the user knows: the owner or a person allowed on this bot. */
  #vouches(userId: number | undefined): boolean {
    return userId !== undefined && this.#allowedPerson(userId);
  }
  readonly #toldFull = new Set<'chats' | 'people'>();

  /** A group the bot is in for the first time: pending until the user approves it. */
  #noteGroup(chat: Message['chat'], by?: { id: number; first_name: string }): void {
    if (chat.type !== 'group' && chat.type !== 'supergroup') return;
    const known = this.#m.store.chat(this.id, chat.id);
    if (known) return;
    // Who added the bot (or wrote first in the group): their groups share one cap.
    const from: RequestSource = {
      ...(by ? { source: by.id } : {}),
      vouched: this.#vouches(by?.id),
    };
    const { store, full } = this.#makeRoom('chats', from);
    if (!store) return this.#ignore(by, 'pending_full', chat.id);
    const title = chatTitle(chat);
    this.#m.store.noteChat(this.id, { id: chat.id, title, type: chat.type }, this.#m.now(), from);
    this.#m.channelEvent({
      action: 'chat_pending',
      bot: this.id,
      chatId: String(chat.id),
      name: title,
    });
    const agent = this.row?.agent ?? '';
    this.#m.tell(
      this.id,
      botsStrings().botInGroup(
        this.#at(),
        this.#m.agentName(agent),
        plainName(title, 60),
        full ? fullNote(this.#m.pendingMax()) : '',
        settingsPath('telegram'),
      ),
      { agent, runId: null },
    );
  }

  // --- incoming -------------------------------------------------------------------------

  #handle(u: Update): void {
    if (u.my_chat_member) {
      const m = u.my_chat_member;
      const now = m.new_chat_member.status;
      if (now === 'member' || now === 'administrator') {
        this.outbox.unblock(m.chat.id);
        this.#noteGroup(m.chat, m.from);
      } else if (now === 'left' || now === 'kicked') {
        if (m.chat.type === 'private') this.#gone(m.chat.id, 'forbidden', 'blocked');
        else this.#gone(m.chat.id, now);
      }
      return;
    }
    if (u.message) return this.#onMessage(u.message);
    if (u.callback_query) this.#onCallback(u.callback_query);
  }

  #onMessage(m: Message): void {
    const from = m.from;
    const chat = m.chat;
    // A group became a supergroup: service message of the old chat, then of the new one.
    if (m.migrate_to_chat_id !== undefined) return this.migrate(chat.id, m.migrate_to_chat_id);
    if (m.migrate_from_chat_id !== undefined) return this.migrate(m.migrate_from_chat_id, chat.id);
    this.outbox.unblock(chat.id);
    if (!from || from.is_bot) return this.#ignore(from, 'bot_or_anonymous', chat.id);
    if (chat.type === 'channel') return this.#ignore(from, 'channel', chat.id);
    const group = chat.type === 'group' || chat.type === 'supergroup';
    if (group) {
      this.#noteGroup(chat, from);
      if (this.#m.store.chat(this.id, chat.id)?.status !== 'approved') {
        return this.#ignore(from, 'chat_not_approved', chat.id);
      }
    }
    if (m.forward_origin || m.is_automatic_forward) return this.#ignore(from, 'forwarded', chat.id);
    const text = (m.text ?? '').trim();
    const command = /^\/([A-Za-z_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/.exec(text);
    const username = this.#me?.username ?? this.row?.username ?? '';
    if (command?.[2] && command[2].toLowerCase() !== username.toLowerCase()) return;
    const name = command?.[1]?.toLowerCase();
    // Anyone in an approved group (or in private) may ask to be let in.
    if (name === 'join') return this.#join(m);
    if (!this.#allowedPerson(from.id)) return this.#ignore(from, 'not_allowed', chat.id);
    // In a group: only a mention, a reply to the bot, or a command (privacy mode does the same).
    const mention = username !== '' && new RegExp(`@${username}\\b`, 'i').test(text);
    const reply = m.reply_to_message?.from?.id === this.#me?.id;
    if (group && !command && !mention && !reply) return;
    if (name) return this.#onCommand(chat.id, name, m);
    if (m.text === undefined) {
      this.#ignore(from, 'not_text', chat.id);
      this.outbox.send(chat.id, telegramStrings().textOnly, { replyTo: m.message_id });
      return;
    }
    // A reply to a question of the monster answers it.
    const asked =
      m.reply_to_message !== undefined
        ? this.#m.store.question(this.id, chat.id, m.reply_to_message.message_id)
        : undefined;
    if (asked) {
      this.#answerFrom(chat.id, from, asked.questionId, asked.askedTo, { text });
      return;
    }
    const plain = (mention ? text.replace(new RegExp(`@${username}\\b`, 'gi'), '') : text).trim();
    if (plain === '') {
      this.outbox.send(chat.id, botsStrings().goAhead, { replyTo: m.message_id });
      return;
    }
    this.#toMonster(m, plain);
  }

  #join(m: Message): void {
    const from = m.from!;
    const chatId = m.chat.id;
    if (this.#allowedPerson(from.id)) {
      this.outbox.send(chatId, botsStrings().alreadyAllowed, { replyTo: m.message_id });
      return;
    }
    const known = this.#m.store.person(this.id, from.id);
    if (known) return this.#ignore(from, 'join_pending', chatId);
    // Asked from an approved group: the group shares one cap and vouches for them; in
    // private they are a stranger never seen.
    const fromGroup = m.chat.type === 'group' || m.chat.type === 'supergroup';
    const request: RequestSource = fromGroup
      ? { source: chatId, vouched: this.#m.store.chat(this.id, chatId)?.status === 'approved' }
      : { vouched: false };
    const { store, full } = this.#makeRoom('people', request);
    if (!store) return this.#ignore(from, 'pending_full', chatId);
    const name = displayName(from);
    this.#m.store.putPerson(
      this.id,
      { id: from.id, name, username: from.username },
      'pending',
      this.#m.now(),
      request,
    );
    this.#m.channelEvent({
      action: 'person_pending',
      bot: this.id,
      userId: String(from.id),
      name: from.username ? `@${from.username}` : name,
    });
    const agent = this.row?.agent ?? '';
    const owner = this.#o.ownerName();
    this.#m.tell(
      this.id,
      botsStrings().personAsks(
        `${plainName(name)}${safeUsername(from.username)}`,
        this.#m.agentName(agent),
        this.#at(),
        full ? fullNote(this.#m.pendingMax()) : '',
        settingsPath('telegram'),
      ),
      { agent, runId: null },
    );
    // Sent even though the person is not allowed yet: the one answer of a request.
    this.outbox.enqueue(
      chatId,
      (api, chat) =>
        api.sendMessage(chat, escapeHtml(botsStrings().askedOwner(owner)), {
          parse_mode: 'HTML',
          reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true },
        }),
      { anyone: true },
    );
  }

  #onCommand(chatId: number, name: string, m: Message): void {
    // Both languages' names work (`/status` and `/stato`), whatever the app speaks now.
    switch (COMMAND_ALIASES[name]) {
      case 'status':
        this.outbox.send(chatId, this.#statusText(chatId), { html: true, replyTo: m.message_id });
        return;
      default:
        this.outbox.send(chatId, this.#help(), { html: true, replyTo: m.message_id });
    }
  }

  #help(): string {
    const agent = this.#m.agentName(this.row?.agent ?? '');
    return botsStrings().help(escapeHtml(agent), escapeHtml(this.#at()));
  }

  /**
   * Only this bot's monster. What it is doing is told only for the work of
   * this chat: the rest (the app, another chat, an automation) is private,
   * so it only says it is working.
   */
  #statusText(chatId: number): string {
    const agentId = this.row?.agent ?? '';
    const who = escapeHtml(this.#m.agentName(agentId));
    const t = botsStrings();
    if (this.#o.runs.halted) return t.statusHalted(who);
    const st = this.#o.team.state(agentId);
    const ofThisChat = [...this.tracks.entries()].some(
      ([runId, tr]) => tr.chatId === chatId && this.#o.runs.getRun(runId) !== undefined,
    );
    const lines = [
      st.state === 'working'
        ? t.statusWorking(
            who,
            st.activity && ofThisChat ? escapeHtml(clip(st.activity, 120)) : null,
          )
        : st.state === 'waiting'
          ? t.statusWaiting(who)
          : t.statusFree(who),
    ];
    const open = this.#o.questions.list({ status: 'open', agent: agentId }).length;
    if (open > 0) lines.push(telegramStrings().statusQuestions(open));
    const row = this.row;
    if (row) lines.push(t.statusToday(this.#m.today(this.id), this.#m.limitOf(row)));
    return lines.join('\n');
  }

  #toMonster(m: Message, text: string): void {
    const from = m.from!;
    const chat = m.chat;
    const row = this.row;
    if (!row) return;
    const owner = this.#o.ownerName();
    if (!this.#o.ready()) {
      this.outbox.send(chat.id, botsStrings().notReady, { replyTo: m.message_id });
      return;
    }
    if (this.#o.runs.halted) {
      this.outbox.send(chat.id, botsStrings().halted(owner), { replyTo: m.message_id });
      return;
    }
    const person = this.isOwner(from.id) ? 'ok' : this.#m.personCheck(this.id, from.id);
    if (person !== 'ok') {
      if (person === 'warn') {
        this.#ignore(from, 'rate_limited', chat.id);
        this.outbox.send(chat.id, botsStrings().writingALot, { replyTo: m.message_id });
      }
      return;
    }
    if (this.#m.today(this.id) >= this.#m.limitOf(row)) {
      if (this.#m.warnLimit(this.id)) {
        this.#m.channelEvent({ action: 'limit_reached', bot: this.id, name: this.#at() });
      }
      this.outbox.send(chat.id, botsStrings().dayLimit, { replyTo: m.message_id });
      return;
    }
    const stop = this.#o.spendStop(row.agent);
    if (stop) {
      this.outbox.send(chat.id, botsStrings().needsOk(owner), { replyTo: m.message_id });
      // The cap of a project is raised on the project's page (the hub's text names the project).
      const project = / del progetto |\bproject\b/i.test(stop);
      this.#m.tell(
        this.id,
        botsStrings().raiseCap(
          plainName(displayName(from)),
          this.#m.agentName(row.agent),
          this.#at(),
          stop,
          telegramStrings().capPath(project ? spendCapPath(true) : spendCapPath(), project),
        ),
        { agent: row.agent, runId: null },
      );
      return;
    }
    const origin: TelegramOrigin = {
      bot: this.id,
      chat: chat.id,
      chatType: chat.type as TelegramChatType,
      // The title the user approved, not the one of the message: a renamed group reads as itself.
      ...(chat.type !== 'private'
        ? { chatTitle: this.#m.store.chat(this.id, chat.id)?.title ?? chatTitle(chat) }
        : {}),
      sender: {
        id: from.id,
        name: displayName(from),
        ...(from.username ? { username: from.username.slice(0, 64) } : {}),
      },
      owner: this.isOwner(from.id),
    };
    try {
      const sent = this.#o.send({ text, to: row.agent, channel: 'telegram', telegram: origin });
      this.#m.count(this.id);
      if (!this.isOwner(from.id)) this.#m.personCount(this.id, from.id);
      const t = this.track(sent.runId, chat.id);
      t.requester = from.id;
      t.replyTo = m.message_id;
      // Waiting for the monster to finish something else (the app's chat, another chat).
      if (sent.queued && !this.#o.runs.getRun(sent.runId)) {
        this.outbox.send(chat.id, botsStrings().finishingOther, { replyTo: m.message_id });
      } else this.startTyping(sent.runId);
    } catch (err) {
      if (err instanceof HaltedError) {
        this.outbox.send(chat.id, botsStrings().halted(owner), { replyTo: m.message_id });
      } else if (err instanceof DispatchError) {
        this.outbox.send(chat.id, err.message, { replyTo: m.message_id });
      } else throw err;
    }
  }

  #onCallback(q: CallbackQuery): void {
    const api = this.#api;
    const ack = (text?: string) =>
      void api?.answerCallbackQuery(q.id, text ? { text } : undefined).catch(() => {});
    const chatId = q.message?.chat.id;
    if (chatId === undefined || !this.#mayReceive(chatId) || !this.#allowedPerson(q.from.id)) {
      ack();
      this.#ignore(q.from, 'not_allowed', chatId);
      return;
    }
    const answer = /^q:([0-9A-Z]{26}):(.{1,32})$/.exec(q.data ?? '');
    if (!answer || !q.message) return ack();
    const asked = this.#m.store.question(this.id, chatId, q.message.message_id);
    if (!asked) return ack(telegramStrings().answerNotOpen);
    // The button's data is the client's to write: the question is the one the message stored.
    if (answer[1] !== asked.questionId) {
      this.#ignore(q.from, 'forged_button', chatId);
      return ack(botsStrings().invalidButton);
    }
    const reply = this.#answerFrom(
      chatId,
      q.from,
      asked.questionId,
      asked.askedTo,
      {
        optionId: answer[2]!,
      },
      true,
    );
    ack(reply ?? telegramStrings().answerPopup);
  }

  /**
   * An answer from the chat: only the person the question is for (or the
   * user). Returns the text for a button's popup when it was refused.
   */
  #answerFrom(
    chatId: number,
    from: { id: number; first_name: string; last_name?: string | undefined },
    questionId: string,
    askedTo: number | undefined,
    answer: QuestionAnswer,
    button = false,
  ): string | undefined {
    const userId = from.id;
    // The brake's cards, the requests of an access (D-130) and other monsters' questions are
    // never answered from a chat.
    const asked = this.#o.questions.get(questionId);
    if (asked && (this.#o.questions.ownerOnly(questionId) || asked.from !== this.row?.agent)) {
      const text = botsStrings().ownerOnly(this.#o.ownerName());
      if (!button) this.outbox.send(chatId, text);
      return text;
    }
    if (!this.isOwner(userId) && askedTo !== undefined && askedTo !== userId) {
      const text = botsStrings().askerOnly(this.#o.ownerName());
      if (!button) this.outbox.send(chatId, text);
      return text;
    }
    try {
      // Who answered goes in the log: the answer is the user's by channel, not by person.
      this.#o.answer(questionId, answer, 'telegram', `${plainName(displayName(from))} (${userId})`);
      return undefined;
    } catch (err) {
      if (!(err instanceof QuestionError)) throw err;
      const t = telegramStrings();
      const text =
        err.code === 'not_open'
          ? t.answerNotOpen
          : err.code === 'not_found'
            ? t.answerNotFound
            : err.code === 'closing'
              ? t.answerClosing
              : t.answerNotValid;
      if (!button) this.outbox.send(chatId, text);
      if (err.code === 'not_open') this.closeQuestion(questionId, t.noAnswerNeeded);
      return text;
    }
  }

  // --- outgoing ---------------------------------------------------------------------------

  track(runId: string, chatId: number): Track {
    let t = this.tracks.get(runId);
    if (!t) {
      t = { chatId, typing: null };
      this.tracks.set(runId, t);
    }
    return t;
  }

  startTyping(runId: string): void {
    const t = this.tracks.get(runId);
    if (!t || t.typing) return;
    const ping = () => void this.#api?.sendChatAction(t.chatId, 'typing').catch(() => {});
    ping();
    t.typing = setInterval(ping, this.#o.typingIntervalMs ?? 4500);
    t.typing.unref();
  }

  stopTyping(t: Track): void {
    if (t.typing) clearInterval(t.typing);
    t.typing = null;
  }

  /**
   * A reply that must not reach this chat (D-114): the chat gets one line, the user is told
   * (Attività and the main bot), the reply stays in the log.
   */
  heldReply(
    runId: string,
    agent: string,
    why: string,
    reply?: { messageId: string; key: boolean },
  ): void {
    const t = this.tracks.get(runId);
    if (!t) return;
    const owner = this.#o.ownerName();
    const who = this.#m.agentName(agent);
    const group = t.chatId < 0;
    const title = group ? this.#m.store.chat(this.id, t.chatId)?.title : undefined;
    const person = group ? undefined : this.#m.store.person(this.id, t.chatId)?.name;
    const w = botsStrings();
    const reason = whyText(why);
    const where = group
      ? w.inGroup(plainName(title ?? w.noName, 60))
      : w.toPerson(plainName(person ?? w.somePerson, 60));
    this.outbox.send(t.chatId, w.heldInChat(reason, owner), { replyTo: t.replyTo });
    // «Manda comunque» (review of the waves 3 and 4): the user reads it and sends it. Never a
    // reply with a key: the log keeps it redacted, and a key does not go to a chat.
    const held =
      reply && !reply.key
        ? {
            bot: this.id,
            chatId: t.chatId,
            messageId: reply.messageId,
            ...(t.replyTo !== undefined ? { replyTo: t.replyTo } : {}),
          }
        : undefined;
    const refused = this.#m.append({
      agent: 'system',
      runId,
      type: 'instinct',
      data: {
        use: 'outbound',
        action: 'outbound_refused',
        message: w.heldLog(who, where, this.#at(), reason),
        subject: agent,
        details: {
          tool: 'telegram_reply',
          category: 'contact',
          summary: w.heldSummary(where),
          outcome: 'refused',
          why: reason,
          ...(held ? { held } : {}),
        },
      },
    });
    this.#m.tell(
      this.id,
      held
        ? w.heldTellCanSend(who, where, this.#at(), reason)
        : w.heldTell(who, where, this.#at(), reason),
      { agent, runId },
      held && refused ? { id: refused.id } : undefined,
    );
  }

  /**
   * A question of the monster that must not reach this chat (it repeats the notes, D-114): the
   * chat gets the line of the user's call, the user is told; the question waits in the app.
   */
  heldQuestion(runId: string, agent: string, why: string): void {
    const t = this.tracks.get(runId);
    if (!t) return;
    this.ownerLine(runId);
    const who = this.#m.agentName(agent);
    const group = t.chatId < 0;
    const title = group ? this.#m.store.chat(this.id, t.chatId)?.title : undefined;
    const w = botsStrings();
    const where = group ? w.inGroup(plainName(title ?? w.noName, 60)) : w.inThatChat;
    this.#m.tell(this.id, w.heldQuestion(who, where, this.#at(), whyText(why)), { agent, runId });
  }

  /** The line in the chat when only the user may decide (D-107). */
  ownerLine(runId: string): void {
    const t = this.tracks.get(runId);
    if (!t) return;
    this.outbox.send(t.chatId, botsStrings().needsOk(this.#o.ownerName()), {
      replyTo: t.replyTo,
    });
  }

  /** An ordinary question of the monster: in the chat, answered there by whoever asked. */
  ask(runId: string, e: LogEvent<'question'>): void {
    const t = this.tracks.get(runId);
    if (!t) return;
    const d = e.data;
    if (d.blocking) this.stopTyping(t);
    const who = this.#m.agentName(e.agent);
    const w = telegramStrings();
    const lines = [w.asksHtml(escapeHtml(who), escapeHtml(clip(d.question, 1500)))];
    for (const [i, o] of d.options.entries()) {
      const rec = o.id === d.recommended ? ` <i>${w.recommended.trim()}</i>` : '';
      const desc = o.description ? ` · ${escapeHtml(clip(o.description, 200))}` : '';
      lines.push(`${i + 1}. <b>${escapeHtml(clip(o.label, 200))}</b>${rec}${desc}`);
    }
    lines.push(
      `<i>${d.options.length > 0 ? botsStrings().chooseButton : botsStrings().replyHere}</i>`,
    );
    const html = lines.join('\n');
    const markup: InlineKeyboardMarkup | undefined =
      d.options.length > 0
        ? {
            inline_keyboard: d.options.map((o, i) => [
              {
                text: clip(`${i + 1}. ${o.label}`, 60),
                callback_data: `q:${d.questionId}:${o.id}`,
              },
            ]),
          }
        : undefined;
    const chatId = t.chatId;
    const askedTo = t.requester;
    this.outbox.enqueue(chatId, async (api, chat) => {
      const msg = await api.sendMessage(chat, html, {
        parse_mode: 'HTML',
        ...(markup ? { reply_markup: markup } : {}),
        ...(t.replyTo !== undefined
          ? { reply_parameters: { message_id: t.replyTo, allow_sending_without_reply: true } }
          : {}),
      });
      this.#m.store.addQuestion(
        this.id,
        {
          chatId: chat,
          messageId: msg.message_id,
          questionId: d.questionId,
          ...(askedTo !== undefined ? { askedTo } : {}),
          html,
        },
        this.#m.now(),
      );
    });
  }

  closeQuestion(questionId: string, outcome: string): void {
    const open = this.#m.store.openQuestions(this.id, questionId);
    for (const s of open) {
      this.outbox.edit(s.chatId, s.messageId, `${s.html}\n\n${escapeHtml(outcome)}`);
      this.#m.store.closeQuestion(this.id, s.chatId, s.messageId);
    }
  }

  /** The app's language changed: the commands' names and descriptions follow it. */
  refreshCommands(): void {
    if (this.#api && this.#me) {
      void this.#api.setMyCommands(botsStrings().commands).catch(() => {});
    }
  }

  async leave(chatId: number): Promise<void> {
    await this.#api?.leaveChat(chatId).catch(() => {});
  }
}

export class TelegramBots {
  readonly store: TelegramBotStore;
  readonly #o: TelegramBotsOptions;
  readonly #bots = new Map<string, DedicatedBot>();
  #offLog: (() => void) | null = null;
  #offLang: (() => void) | null = null;
  #stopped = false;
  /** Bots being removed: a "Cambia il token" that ends meanwhile writes and starts nothing. */
  readonly #removing = new Set<string>();

  constructor(options: TelegramBotsOptions) {
    this.#o = options;
    migrate(options.db, 'telegram', telegramMigrations);
    this.store = new TelegramBotStore(options.db);
  }

  now(): number {
    return (this.#o.now ?? Date.now)();
  }

  pendingMax(): number {
    return Math.max(1, this.#o.pendingMax ?? PENDING_MAX);
  }

  agentName(id: string): string {
    return this.#o.team.get(id)?.config.name ?? id;
  }

  // --- lifecycle -------------------------------------------------------------------

  /** Starts every bot with its token. Never throws: problems show in the view. */
  start(): void {
    this.#stopped = false;
    this.#offLog ??= this.#o.log.subscribe((e) => this.#onEvent(e));
    this.#offLang ??= onAppLang(() => {
      for (const bot of this.#bots.values()) bot.refreshCommands();
    });
    for (const row of this.store.bots()) this.#startBot(row.id);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#offLog?.();
    this.#offLog = null;
    this.#offLang?.();
    this.#offLang = null;
    await Promise.allSettled([...this.#bots.values()].map((b) => b.stop()));
    this.#bots.clear();
  }

  #startBot(id: string): void {
    const bot = new DedicatedBot(id, this, this.#o);
    this.#bots.set(id, bot);
    const token = readProviderKey(this.#o.secretsDir, `${KEY_PREFIX}${id}`, [])?.key;
    if (!token) {
      bot.status = 'error';
      bot.error = botsStrings().tokenMissing;
      return;
    }
    this.#o.log.redactor.addSecret(token);
    bot.start(token);
  }

  // --- settings (API) ---------------------------------------------------------------

  views(): TelegramBotView[] {
    const owners = this.#o.owners();
    return this.store.bots().map((row) => {
      const bot = this.#bots.get(row.id);
      const people: TelegramBotPerson[] = [
        ...owners.map((u) => ({
          id: u.id,
          name: u.name,
          ...(u.username ? { username: u.username } : {}),
          status: 'approved' as const,
          owner: true,
          addedAt: u.addedAt,
        })),
        ...this.store
          .people(row.id)
          .filter((p) => !owners.some((u) => u.id === p.id))
          .map((p) => ({ ...p, owner: false })),
      ];
      return {
        id: row.id,
        agent: row.agent,
        bot: { id: Number(row.id), username: row.username, name: row.name },
        status: bot?.status ?? 'off',
        ...(bot?.error ? { error: bot.error } : {}),
        dailyLimit: this.limitOf(row),
        today: this.today(row.id),
        chats: this.store.chats(row.id),
        people,
        fullTools: row.fullTools === true,
        addedAt: row.addedAt,
      };
    });
  }

  /**
   * The bot of a chat's thread gives the people there the monster's whole toolset (D-114):
   * off by default, and for a bot that is gone.
   */
  fullTools(thread: string): boolean {
    const m = /^telegram:(\d+):-?\d+$/.exec(thread);
    return m ? this.store.bot(m[1]!)?.fullTools === true : false;
  }

  /** True when this Telegram bot id is one of the dedicated bots (the main bot refuses it). */
  has(botId: number): boolean {
    return this.store.bot(String(botId)) !== undefined;
  }

  #agentFor(id: string): string {
    const agent = this.#o.team.get(id);
    if (!agent) throw new TelegramBotsError('invalid_agent', botsStrings().noMonsterNamed);
    if (agent.config.kind === 'orchestrator') {
      throw new TelegramBotsError('invalid_agent', botsStrings().talksOnMainBot(agent.config.name));
    }
    return agent.config.id;
  }

  /** Verifies the token with `getMe`, saves it as a secret and starts the bot's loop. */
  async add(params: { token: string; agent: string; dailyLimit?: number | undefined }) {
    // What the user pasted: the token alone or BotFather's whole message.
    const token = extractTelegramToken(params.token);
    if (!token) throw new TelegramBotsError('invalid_token', telegramTokenShapeMessage());
    this.#o.log.redactor.addSecret(token);
    const agent = this.#agentFor(params.agent);
    const main = this.#o.mainBot();
    if (main.token && main.token === token) {
      throw new TelegramBotsError('bot_in_use', botsStrings().mainBotToken);
    }
    const api = new Api(token, telegramClient(this.#o.apiRoot, 15));
    let me;
    try {
      me = await api.getMe();
    } catch (err) {
      throw this.#checkFailed(err, 'new');
    }
    const id = String(me.id);
    if (main.id === me.id) {
      throw new TelegramBotsError('bot_in_use', botsStrings().mainBot);
    }
    if (this.store.bot(id)) {
      throw new TelegramBotsError('bot_in_use', botsStrings().alreadyAMonstersBot(me.username));
    }
    saveProviderKey(this.#o.secretsDir, `${KEY_PREFIX}${id}`, token);
    this.store.addBot({
      id,
      agent,
      username: me.username,
      name: me.first_name,
      ...(params.dailyLimit !== undefined ? { dailyLimit: params.dailyLimit } : {}),
      addedAt: this.now(),
    });
    this.channelEvent({
      action: 'bot_added',
      bot: id,
      name: `@${me.username}`,
      message: botsStrings().forMonster(this.agentName(agent)),
    });
    if (!this.#stopped && this.#offLog) this.#startBot(id);
    return this.views();
  }

  /** A `getMe` that could not confirm a token: the real cause to the log, its words to the user. */
  #checkFailed(err: unknown, bot: string): TelegramBotsError {
    const failure = tokenCheckFailure(err, this.#o.apiRoot);
    // The bot URL in the chain carries the token: the log redacts it (added as a secret above).
    this.channelEvent({
      action: 'token_check_failed',
      bot,
      reason: failure.kind,
      message: failure.detail,
    });
    return new TelegramBotsError(failure.code, failure.message);
  }

  /**
   * "Cambia il token": the same bot with a token BotFather issued again (after
   * `/revoke`). `getMe` must answer with the same id; the secret is replaced
   * and the loop restarts, so the groups and people already approved stay.
   */
  async changeToken(id: string, tokenText: string) {
    const row = this.#bot(id);
    const token = extractTelegramToken(tokenText);
    if (!token) throw new TelegramBotsError('invalid_token', telegramTokenShapeMessage());
    this.#o.log.redactor.addSecret(token);
    const main = this.#o.mainBot();
    if (main.token && main.token === token) {
      throw new TelegramBotsError('bot_in_use', botsStrings().mainBotTokenHere(row.username));
    }
    const api = new Api(token, telegramClient(this.#o.apiRoot, 15));
    let me;
    try {
      me = await api.getMe();
    } catch (err) {
      throw this.#checkFailed(err, id);
    }
    if (String(me.id) !== id) {
      throw new TelegramBotsError('other_bot', botsStrings().otherBot(me.username, row.username));
    }
    // Removed while Telegram answered: its token is not written back, no loop starts (review of
    // 19/10, item 4: a loop nobody sees would take its updates until the core closes).
    if (!this.store.bot(id) || this.#removing.has(id)) {
      throw new TelegramBotsError('not_found', botsStrings().botGone);
    }
    saveProviderKey(this.#o.secretsDir, `${KEY_PREFIX}${id}`, token);
    this.store.updateBot(id, { username: me.username, name: me.first_name });
    this.channelEvent({
      action: 'bot_changed',
      bot: id,
      name: `@${me.username}`,
      message: botsStrings().tokenChanged,
    });
    const bot = this.#bots.get(id);
    if (this.#stopped) return this.views();
    if (bot) await bot.restart(token);
    else if (this.#offLog) this.#startBot(id);
    return this.views();
  }

  #bot(id: string): BotRow {
    const row = this.store.bot(id);
    if (!row) throw new TelegramBotsError('not_found', botsStrings().noSuchBot);
    return row;
  }

  /**
   * "Strumenti per gli altri" (D-114): the people of the bot act with the monster's whole toolset,
   * the Terminal included. Whatever gives that to someone wants a recent confirmation (`proof`,
   * auth/recent.ts): turning it on, pointing a bot that has it at another monster (it would
   * hand strangers that monster's toolset), and, in the approvals below, letting one more chat
   * or person in.
   */
  update(
    id: string,
    patch: {
      agent?: string | undefined;
      dailyLimit?: number | null | undefined;
      fullTools?: boolean | undefined;
    },
    proof: RecentProof | undefined,
  ) {
    if (patch.fullTools === true) assertRecent(proof);
    const row = this.#bot(id);
    const agent = patch.agent !== undefined ? this.#agentFor(patch.agent) : undefined;
    if (agent && agent !== row.agent && (patch.fullTools ?? row.fullTools === true)) {
      assertRecent(proof);
    }
    this.store.updateBot(id, {
      ...(agent ? { agent } : {}),
      ...(patch.dailyLimit !== undefined ? { dailyLimit: patch.dailyLimit } : {}),
      ...(patch.fullTools !== undefined ? { fullTools: patch.fullTools } : {}),
    });
    const tools =
      patch.fullTools === undefined || patch.fullTools === (row.fullTools === true)
        ? undefined
        : patch.fullTools
          ? botsStrings().fullTools
          : botsStrings().reducedTools;
    const message = [agent ? botsStrings().forMonster(this.agentName(agent)) : undefined, tools]
      .filter(Boolean)
      .join(' · ');
    this.channelEvent({
      action: 'bot_changed',
      bot: id,
      name: `@${row.username}`,
      ...(message ? { message } : {}),
    });
    return this.views();
  }

  async remove(id: string) {
    const row = this.#bot(id);
    const bot = this.#bots.get(id);
    this.#bots.delete(id);
    this.#removing.add(id);
    try {
      await bot?.stop();
      removeProviderKey(this.#o.secretsDir, `${KEY_PREFIX}${id}`);
      this.store.removeBot(id);
    } finally {
      this.#removing.delete(id);
    }
    this.#o.state.delete(`${OFFSET_PREFIX}${id}`);
    this.#o.state.delete(`${COUNT_PREFIX}${id}`);
    this.channelEvent({ action: 'bot_removed', bot: id, name: `@${row.username}` });
    return this.views();
  }

  approveChat(id: string, chatId: number, proof: RecentProof | undefined) {
    this.#bot(id);
    this.#assertCanLetIn(id, proof);
    const chat = this.store.chat(id, chatId);
    if (!chat || !this.store.approveChat(id, chatId)) {
      throw new TelegramBotsError('not_found', botsStrings().noSuchGroup);
    }
    this.channelEvent({
      action: 'chat_approved',
      bot: id,
      chatId: String(chatId),
      name: chat.title,
    });
    return this.views();
  }

  /** Refuses a pending group or removes an approved one; the bot leaves it. */
  async removeChat(id: string, chatId: number) {
    this.#bot(id);
    const chat = this.store.chat(id, chatId);
    if (!chat || !this.store.removeChat(id, chatId)) {
      throw new TelegramBotsError('not_found', botsStrings().noSuchGroup);
    }
    this.channelEvent({
      action: 'chat_removed',
      bot: id,
      chatId: String(chatId),
      name: chat.title,
    });
    await this.#bots.get(id)?.leave(chatId);
    return this.views();
  }

  addPerson(
    id: string,
    person: { id: number; name?: string | undefined },
    proof: RecentProof | undefined,
  ) {
    this.#bot(id);
    this.#assertCanLetIn(id, proof);
    const name = person.name?.trim() || botsStrings().user(person.id);
    this.store.putPerson(id, { id: person.id, name }, 'approved', this.now());
    this.store.approvePerson(id, person.id);
    this.#approved(id, person.id, name);
    return this.views();
  }

  approvePerson(id: string, userId: number, proof: RecentProof | undefined) {
    this.#bot(id);
    this.#assertCanLetIn(id, proof);
    const p = this.store.person(id, userId);
    if (!p) throw new TelegramBotsError('not_found', botsStrings().noSuchPerson);
    this.store.approvePerson(id, userId);
    this.#approved(id, userId, p.username ? `@${p.username}` : p.name);
    return this.views();
  }

  /** On a bot with the whole toolset for others, one more chat or person is one more who can use it. */
  #assertCanLetIn(id: string, proof: RecentProof | undefined): void {
    if (this.store.bot(id)?.fullTools === true) assertRecent(proof);
  }

  #approved(id: string, userId: number, name: string): void {
    this.channelEvent({ action: 'person_approved', bot: id, userId: String(userId), name });
  }

  removePerson(id: string, userId: number) {
    this.#bot(id);
    if (this.#o.owners().some((u) => u.id === userId)) {
      throw new TelegramBotsError('owner', botsStrings().youAreOwner);
    }
    const p = this.store.person(id, userId);
    if (!p || !this.store.removePerson(id, userId)) {
      throw new TelegramBotsError('not_found', botsStrings().noSuchPerson);
    }
    // Work they started goes on, but its replies no longer reach their private chat.
    this.channelEvent({ action: 'person_removed', bot: id, userId: String(userId), name: p.name });
    return this.views();
  }

  // --- limits ----------------------------------------------------------------------------

  /** The messages a day the bot lets through: the user's, or the default. */
  limitOf(row: BotRow): number {
    return row.dailyLimit ?? DEFAULT_DAILY_LIMIT;
  }

  readonly #personHits = new Map<string, { at: number[]; warned: boolean }>();

  /**
   * One person (not the user) at most `personHourlyLimit` messages an hour:
   * `ok`, `warn` (the first one over, answer once) or `silent`.
   */
  personCheck(bot: string, userId: number): 'ok' | 'warn' | 'silent' {
    const key = `${bot}:${userId}`;
    const hits = this.#personHits.get(key);
    if (!hits) return 'ok';
    const from = this.now() - HOUR_MS;
    hits.at = hits.at.filter((t) => t > from);
    if (hits.at.length < (this.#o.personHourlyLimit ?? PERSON_HOURLY_LIMIT)) {
      hits.warned = false;
      return 'ok';
    }
    if (hits.warned) return 'silent';
    hits.warned = true;
    return 'warn';
  }

  personCount(bot: string, userId: number): void {
    if (this.#personHits.size > 5000) this.#personHits.clear();
    const key = `${bot}:${userId}`;
    const hits = this.#personHits.get(key) ?? { at: [], warned: false };
    hits.at.push(this.now());
    this.#personHits.set(key, hits);
  }

  readonly #notices = new Map<string, { at: number[]; told: boolean }>();

  /**
   * A notice to the user about a bot (a group, a request): at most
   * `ownerNoticesPerHour` an hour per bot. Strangers can add the bot to
   * groups or send `/join` as often as they like; past the limit the user
   * gets one line saying so, and the rest waits in Collegamenti.
   */
  tell(
    bot: string,
    text: string,
    meta: { agent: string; runId: string | null },
    held?: { id: string },
  ): void {
    const n = this.#notices.get(bot) ?? { at: [], told: false };
    const from = this.now() - HOUR_MS;
    n.at = n.at.filter((t) => t > from);
    this.#notices.set(bot, n);
    if (n.at.length >= (this.#o.ownerNoticesPerHour ?? OWNER_NOTICES_PER_HOUR)) {
      if (n.told) return;
      n.told = true;
      this.#o.tellOwner(
        botsStrings().tooManyRequests(this.pendingMax(), settingsPath('telegram')),
        meta,
      );
      return;
    }
    n.told = false;
    n.at.push(this.now());
    this.#o.tellOwner(text, meta, held);
  }

  /**
   * «Manda comunque» (review of the waves 3 and 4): the user sends a reply the check held,
   * from the app or from the main bot. Once: a second tap says it went already.
   */
  sendHeld(refusedId: string, by: Channel): { chat: string } {
    const e = this.#o.log.get(refusedId);
    const held =
      e?.type === 'instinct' &&
      e.data.action === 'outbound_refused' &&
      e.data.details?.['tool'] === 'telegram_reply'
        ? (e.data.details['held'] as
            { bot?: unknown; chatId?: unknown; messageId?: unknown; replyTo?: unknown } | undefined)
        : undefined;
    if (
      !e ||
      !held ||
      typeof held.bot !== 'string' ||
      typeof held.chatId !== 'number' ||
      typeof held.messageId !== 'string'
    ) {
      throw new TelegramBotsError('not_found', botsStrings().noSuchReply);
    }
    const sent = this.#o.log
      .query({ type: 'instinct', after: refusedId, limit: 5000 })
      .some(
        (x) =>
          x.type === 'instinct' &&
          x.data.action === 'outbound_approved' &&
          x.data.details?.['heldId'] === refusedId,
      );
    if (sent) throw new TelegramBotsError('already_sent', botsStrings().alreadySent);
    const message = this.#o.log.get(held.messageId);
    const bot = this.#bots.get(held.bot);
    if (message?.type !== 'message' || !bot) {
      throw new TelegramBotsError('not_found', botsStrings().botOrReplyGone);
    }
    if (held.chatId < 0 && this.store.chat(held.bot, held.chatId)?.status !== 'approved') {
      throw new TelegramBotsError('not_found', botsStrings().botNotInChat);
    }
    bot.outbox.send(held.chatId, message.data.text, {
      ...(typeof held.replyTo === 'number' ? { replyTo: held.replyTo } : {}),
    });
    const w = botsStrings();
    const where = held.chatId < 0 ? w.sentToGroup : w.sentToChat;
    this.append({
      agent: 'system',
      runId: e.runId,
      type: 'instinct',
      data: {
        use: 'outbound',
        action: 'outbound_approved',
        message: w.sentAnyway(this.agentName(message.agent), where),
        subject: message.agent,
        details: { tool: 'telegram_reply', heldId: refusedId, by },
      },
    });
    return { chat: String(held.chatId) };
  }

  // --- daily limit ---------------------------------------------------------------------

  today(id: string): number {
    const c = this.#o.state.get<{ day: string; n: number }>(`${COUNT_PREFIX}${id}`);
    return c && c.day === dayOf(this.now()) ? c.n : 0;
  }

  count(id: string): void {
    const day = dayOf(this.now());
    const c = this.#o.state.get<{ day: string; n: number; warned?: boolean }>(
      `${COUNT_PREFIX}${id}`,
    );
    const n = c && c.day === day ? c.n + 1 : 1;
    this.#o.state.set(`${COUNT_PREFIX}${id}`, {
      day,
      n,
      ...(c?.day === day && c.warned ? { warned: true } : {}),
    });
  }

  /** True the first time today the limit is hit (logged once). */
  warnLimit(id: string): boolean {
    const key = `${COUNT_PREFIX}${id}`;
    const c = this.#o.state.get<{ day: string; n: number; warned?: boolean }>(key);
    if (!c || c.warned) return false;
    this.#o.state.set(key, { ...c, warned: true });
    return true;
  }

  // --- log → chats ------------------------------------------------------------------------

  /** The bot and chat of a run of a dedicated bot, from its thread. */
  #threadBot(thread: string | undefined): { bot: DedicatedBot; chatId: number } | null {
    const m = thread ? /^telegram:(\d+):(-?\d+)$/.exec(thread) : null;
    const bot = m ? this.#bots.get(m[1]!) : undefined;
    // The thread keeps the id the group had when the run began: follow a migration.
    return bot && m ? { bot, chatId: bot.outbox.current(Number(m[2])) } : null;
  }

  #botOfRun(runId: string | null): { bot: DedicatedBot; runId: string } | null {
    if (!runId) return null;
    for (const bot of this.#bots.values()) if (bot.tracks.has(runId)) return { bot, runId };
    return null;
  }

  #onEvent(e: LogEvent): void {
    switch (e.type) {
      case 'run': {
        if (!e.runId) return;
        if (e.data.status === 'started') {
          // A run of a chat started by an answer (or after waiting): it replies there.
          const t = this.#threadBot(e.data.thread);
          if (t) {
            t.bot.track(e.runId, t.chatId);
            t.bot.startTyping(e.runId);
          }
          return;
        }
        const hit = this.#botOfRun(e.runId);
        if (!hit) return;
        const t = hit.bot.tracks.get(e.runId)!;
        hit.bot.tracks.delete(e.runId);
        hit.bot.stopTyping(t);
        const owner = this.#o.ownerName();
        if (e.data.status === 'failed') {
          const w = botsStrings();
          if (this.#o.spendStop(e.agent)) {
            hit.bot.outbox.send(t.chatId, w.needsOk(owner), { replyTo: t.replyTo });
          } else {
            hit.bot.outbox.send(
              t.chatId,
              w.failed(clip(e.data.error ?? telegramStrings().errorDefault, 300)),
              { replyTo: t.replyTo },
            );
          }
        } else if (e.data.status === 'aborted') {
          hit.bot.outbox.send(
            t.chatId,
            this.#o.runs.halted ? botsStrings().stoppedBy(owner) : botsStrings().stopped,
            { replyTo: t.replyTo },
          );
        }
        return;
      }
      case 'message': {
        if (e.data.role !== 'agent' || e.data.partial || e.parentId !== null) return;
        const hit = this.#botOfRun(e.runId);
        if (!hit || !e.data.text.trim()) return;
        const t = hit.bot.tracks.get(hit.runId)!;
        if (e.agent !== hit.bot.row?.agent) return;
        // Where not only the user reads, the reply leaves like data sent out (D-114).
        const ownerOnly = t.chatId > 0 && hit.bot.isOwner(t.chatId);
        const why = ownerOnly
          ? null
          : (this.#o.replyCheck?.(hit.runId, e.data.text, e.agent) ?? null);
        if (why) {
          hit.bot.heldReply(hit.runId, e.agent, why, {
            messageId: e.id,
            key: why === REPLY_KEY_REASON,
          });
          return;
        }
        hit.bot.outbox.send(t.chatId, e.data.text, { replyTo: t.replyTo });
        return;
      }
      case 'kill':
        // Runs that waited for their monster are gone with the kill switch.
        for (const bot of this.#bots.values()) {
          for (const [runId, t] of bot.tracks) {
            if (this.#o.runs.getRun(runId)) continue;
            bot.stopTyping(t);
            bot.tracks.delete(runId);
          }
        }
        return;
      case 'question': {
        const hit = this.#botOfRun(e.runId);
        if (!hit) return;
        const t = hit.bot.tracks.get(hit.runId)!;
        if (e.data.blocking) hit.bot.stopTyping(t);
        // The brake's cards and the requests of an access (D-130) are the user's: on the main
        // bot in private and in the app.
        if (e.data.kind !== undefined) {
          hit.bot.ownerLine(hit.runId);
          return;
        }
        // A question goes where the reply would: through the same check (review of the waves 3
        // and 4), its text and its options.
        const t2 = hit.bot.tracks.get(hit.runId)!;
        const ownerOnly = t2.chatId > 0 && hit.bot.isOwner(t2.chatId);
        const asked = [
          e.data.question,
          ...e.data.options.flatMap((o) => [o.label, o.description ?? '']),
        ].join('\n');
        const why = ownerOnly ? null : (this.#o.replyCheck?.(hit.runId, asked, e.agent) ?? null);
        if (why) hit.bot.heldQuestion(hit.runId, e.agent, why);
        else hit.bot.ask(hit.runId, e);
        return;
      }
      case 'answer': {
        const q = this.#o.questions.get(e.data.questionId);
        if (!q) return;
        const label = q.options.find((o) => o.id === e.data.optionId)?.label;
        const what = clip(label ?? e.data.text ?? '', 300);
        for (const bot of this.#bots.values()) {
          bot.closeQuestion(q.id, telegramStrings().answered('', what));
          // The work goes on.
          if (q.blocking && bot.tracks.has(q.runId)) bot.startTyping(q.runId);
        }
        return;
      }
      case 'question_expired':
        for (const bot of this.#bots.values()) {
          bot.closeQuestion(e.data.questionId, telegramStrings().noAnswerNeeded);
        }
        return;
      default: {
        // A draft proposed from a chat's run (D-098): only the user confirms it.
        const d = draftOfEvent(e);
        if (!d?.open) return;
        const hit = this.#botOfRun(e.runId);
        if (hit) hit.bot.ownerLine(hit.runId);
      }
    }
  }

  // --- log ---------------------------------------------------------------------------------

  append(event: Parameters<EventLog['append']>[0]): LogEvent | undefined {
    if (this.#stopped) return undefined;
    return this.#o.log.append(event);
  }

  channelEvent(data: {
    action:
      | 'connected'
      | 'disconnected'
      | 'ignored'
      | 'bot_added'
      | 'bot_removed'
      | 'bot_changed'
      | 'chat_pending'
      | 'chat_approved'
      | 'chat_removed'
      | 'person_pending'
      | 'person_approved'
      | 'person_removed'
      | 'limit_reached'
      | 'chat_left'
      | 'chat_migrated'
      | 'token_check_failed';
    bot: string;
    chatId?: string;
    userId?: string;
    name?: string;
    reason?: string;
    message?: string;
  }): void {
    this.append({ agent: 'system', type: 'channel', data: { channel: 'telegram', ...data } });
  }
}

/** For the routes: a bot id of the API path. */
export function botIdOf(raw: string): string | null {
  return /^\d{1,20}$/.test(raw) ? raw : null;
}
