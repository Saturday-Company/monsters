import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  draftTaint,
  extractTelegramToken,
  telegramTokenShapeMessage,
  type Channel,
  type DraftKind,
  type DraftView,
  type LogEvent,
  type Question,
  type TelegramPairing,
  type TelegramBotView,
  type TelegramPrefs,
  type TelegramPrefsUpdate,
  type TelegramStatus,
  type TelegramUser,
  type TelegramView,
  spendCapPath,
} from '@monsters/shared';
import { isInside } from '@monsters/tools';
import { Api, GrammyError, HttpError } from 'grammy';
import type {
  CallbackQuery,
  ForceReply,
  InlineKeyboardMarkup,
  Message,
  Update,
} from 'grammy/types';
import { migrate } from '../../db/migrations.ts';
import type { Db } from '../../db/sqlite.ts';
import type { StateStore } from '../../db/state-store.ts';
import { HaltedError, type RunController } from '../../kill/run-controller.ts';
import type { EventLog } from '../../log/event-log.ts';
import { readProviderKey, removeProviderKey, saveProviderKey } from '../../providers/keys.ts';
import { DraftError, draftKey, draftOfEvent } from '../../projects/drafts.ts';
import type { DecisionGate } from '../../team/decision.ts';
import { msUntilQuietEnds } from '../../team/decision.ts';
import { DispatchError, type SendResult } from '../../team/dispatcher.ts';
import { QuestionError, type QuestionAnswer, type QuestionStore } from '../../team/questions.ts';
import type { TeamService } from '../../team/team-service.ts';
import {
  clipHtmlLines,
  DRAFT_CARD_BUDGET,
  docsDiffShown,
  draftCardLines,
  visibleLength,
} from './draft-card.ts';
import { clip, escapeHtml, splitHtml, splitMarkdown, toTelegramHtml } from './format.ts';
import { telegramClient, tokenCheckFailure, tokenRefused } from './net.ts';
import { ChatPacer, editMoot, forbidden, retryWaitMs, type ChatGapMs } from './outbox.ts';
import { Pairing } from './pairing.ts';
import { TelegramQuestionMessages, TelegramUsers, telegramMigrations } from './store.ts';

/*
 * Telegram channel (M2.6, ARCHITECTURE §1 and §5.8). A module of the core
 * process, a client of the hub like the HTTP routes: messages go through
 * `send`, answers through `answer`, `/stop` through the same kill switch, and
 * everything it hears comes from the event log. Long polling only (no webhook:
 * no open port, D-013), with backoff when Telegram is not reachable.
 *
 * Only private chats of the accounts in the whitelist reach the agents; every
 * other update is ignored and logged (`channel` event, never the content).
 */

export const TELEGRAM_KEY_ID = 'telegram';
export const TELEGRAM_ENV = 'TELEGRAM_BOT_TOKEN';
const OFFSET_KEY = 'telegram_offset';
/** Notifications waiting for the end of the quiet hours (they survive a restart). */
const LATER_KEY = 'telegram_later';
const LATER_MAX = 200;
/** Telegram's limit is 4096 visible characters: a question leaves room for its outcome. */
const QUESTION_BUDGET = 3600;

export type TelegramErrorCode =
  | 'invalid_token'
  | 'verification_failed'
  | 'token_from_env'
  | 'no_token'
  | 'not_found'
  | 'bot_in_use';

export class TelegramError extends Error {
  readonly code: TelegramErrorCode;
  constructor(code: TelegramErrorCode, message: string) {
    super(message);
    this.name = 'TelegramError';
    this.code = code;
  }
}

export interface TelegramChannelOptions {
  db: Db;
  log: EventLog;
  state: StateStore;
  runs: RunController;
  questions: QuestionStore;
  gate: DecisionGate;
  team: TeamService;
  secretsDir: string;
  env: NodeJS.ProcessEnv;
  /** Current preferences (from `settings.json`) and how to save new ones. */
  prefs: () => TelegramPrefs;
  savePrefs: (prefs: TelegramPrefs) => void;
  send: (params: { text: string; to?: string | undefined; channel: Channel }) => SendResult;
  answer: (id: string, answer: QuestionAnswer, channel: Channel) => Question;
  newConversation: (params: {
    to?: string | undefined;
    channel: Channel;
  }) => LogEvent<'new_conversation'>;
  /** False until the first start is completed in the UI. */
  ready: () => boolean;
  /**
   * Runs whose end is announced by someone else (an automation, D-094): no
   * "ha finito" for them; their questions still come here.
   */
  quietRun?: ((runId: string) => boolean) | undefined;
  /**
   * Runs of the Telegram chat of a dedicated bot (D-107): their ordinary
   * questions are asked there; only the brake's cards come here, to the user.
   */
  groupRun?: ((runId: string) => boolean) | undefined;
  /** The bots dedicated to one monster, for the view (D-107). */
  bots?: (() => TelegramBotView[]) | undefined;
  /**
   * «Manda comunque» on the notice of a reply a dedicated bot held (review of the waves 3 and
   * 4): sends it; throws with the reason it cannot (already sent, the bot is gone).
   */
  sendHeld?: ((id: string) => unknown) | undefined;
  /** What the monsters a bot may be dedicated to can do beyond notes and web (D-114). */
  toolRisks?: (() => TelegramView['toolRisks']) | undefined;
  /** A bot id that is one of the dedicated bots: its token cannot be the main bot's. */
  dedicatedBot?: ((botId: number) => boolean) | undefined;
  /** The projects in use and what their lead is doing (`/stato`, D-097). */
  projects?:
    | (() => {
        name: string;
        lead?: { name: string; state: string; activity?: string };
        pending: number;
      }[])
    | undefined;
  /**
   * What the monsters proposed (D-098): a message with Conferma and Scarta for
   * each draft of a monster; confirming creates it as proposed.
   */
  drafts?:
    | {
        get(kind: DraftKind, id: string): DraftView | undefined;
        confirm(kind: DraftKind, id: string, by: Channel): Promise<unknown>;
        discard(kind: DraftKind, id: string, by: Channel): Promise<unknown>;
      }
    | undefined;
  /**
   * The folder where the projects' new folders go (`~/Monsters Progetti`): a proposal for a
   * project in an existing folder outside it is confirmed in the app, not here (review of
   * 18/10, M2). Without it, no project draft is confirmed from here.
   */
  projectsDir?: (() => string) | undefined;
  /** Bot API root (tests: a fake server). Default Telegram's. */
  apiRoot?: string | undefined;
  /** Seconds of a long poll. Default 30. */
  pollTimeoutS?: number | undefined;
  /** First wait after a failure, doubled up to `retryMaxMs`. Default 1 s → 60 s. */
  retryBaseMs?: number | undefined;
  retryMaxMs?: number | undefined;
  /** How long after their last message the user counts as present. Default 10 min. */
  activeWindowMs?: number | undefined;
  /**
   * A message that cannot leave (network, Telegram down) is retried with
   * backoff (`retryBaseMs` → `retryMaxMs`) for this long, then dropped with a
   * `telegram_send_failed` error. Default 30 min.
   */
  sendGiveUpMs?: number | undefined;
  /** Messages waiting for one chat at most; more are dropped (once logged). Default 100. */
  sendQueueMax?: number | undefined;
  /** Minimum gap between two sends to one chat. Default 1 s in private, 3 s in groups. */
  chatGapMs?: ChatGapMs | undefined;
  /** How often "typing…" is renewed. Default 4.5 s (Telegram shows it for 5 s). */
  typingIntervalMs?: number | undefined;
  now?: () => number;
}

interface RunTrack {
  agent: string;
  /**
   * Private chat that started the work (or the first to join work started
   * elsewhere): replies go there, and only there.
   */
  chatId: number | null;
  lastText: string;
  notes: Set<string>;
  typing: NodeJS.Timeout | null;
}

/** What a notification sends: plain data, so it can wait in the database. */
type Outgoing =
  | { kind: 'text'; text: string }
  | {
      kind: 'question';
      questionId: string;
      html: string;
      markup: InlineKeyboardMarkup | ForceReply;
    };

interface Later {
  chats: number[];
  out: Outgoing;
}

/** The kinds of draft in a button's data (64 bytes at most). */
const DRAFT_CODES: Record<DraftKind, string> = {
  monster: 'm',
  project: 'p',
  automation: 'a',
  docs: 'i',
  memory: 'r',
};
const DRAFT_KINDS: Record<string, DraftKind> = {
  m: 'monster',
  p: 'project',
  a: 'automation',
  i: 'docs',
  r: 'memory',
};

/** `draft:<kind>:<id>` → its kind and id. */
function parseDraftKey(key: string): { kind: DraftKind; id: string } | null {
  const m = /^draft:(monster|project|automation|docs|memory):(.+)$/.exec(key);
  return m ? { kind: m[1] as DraftKind, id: m[2]! } : null;
}

const CHANNEL_WORDS: Partial<Record<Channel, string>> = {
  telegram: 'da Telegram',
  ui: 'dall’interfaccia',
  cli: 'dal terminale',
  ssh: 'dal terminale',
  api: 'da un altro programma',
};

const HELP = [
  'Scrivimi e passo il messaggio alla squadra; con <code>@Nome</code> all’inizio parli con un mostro preciso.',
  '',
  '/stop: ferma subito tutti i mostri',
  '/riprendi: li fa ripartire',
  '/nuova: nuova conversazione (anche <code>/nuova @Nome</code>)',
  '/stato: cosa stanno facendo',
  '',
  'Alle domande rispondi con i pulsanti, oppure rispondendo al messaggio della domanda.',
].join('\n');

const COMMANDS = [
  { command: 'stop', description: 'Ferma subito tutti i mostri' },
  { command: 'riprendi', description: 'Fa ripartire i mostri' },
  { command: 'nuova', description: 'Nuova conversazione' },
  { command: 'stato', description: 'Cosa stanno facendo' },
  { command: 'aiuto', description: 'Come si usa' },
];

/** Errors worth sending again: the network, Telegram itself, too many messages. */
function transient(err: unknown): boolean {
  return (
    err instanceof HttpError ||
    (err instanceof GrammyError && (err.error_code === 429 || err.error_code >= 500))
  );
}

/** grammY types its signals with the `abort-controller` polyfill; a native one works the same. */
type GrammySignal = Parameters<Api['getMe']>[0];
const grammySignal = (signal: AbortSignal) => signal as unknown as GrammySignal;

function displayName(u: { first_name: string; last_name?: string | undefined }): string {
  return [u.first_name, u.last_name].filter(Boolean).join(' ').slice(0, 80) || 'Telegram';
}

export class TelegramChannel {
  readonly #o: TelegramChannelOptions;
  readonly #users: TelegramUsers;
  readonly #pairing: Pairing;
  readonly #now: () => number;
  #api: Api | null = null;
  #bot: { id: number; username: string; name: string } | null = null;
  #status: TelegramStatus = 'off';
  #error: string | undefined;
  #abort: AbortController | null = null;
  #loop: Promise<void> | null = null;
  readonly #tracks = new Map<string, RunTrack>();
  /**
   * The chat that answered a question of a monster with no run (parked,
   * D-078): the run its answer starts replies there.
   */
  readonly #answeredFrom = new Map<string, number>();
  readonly #questionMessages: TelegramQuestionMessages;
  readonly #active = new Map<number, number>();
  readonly #chains = new Map<number, Promise<unknown>>();
  readonly #pacer: ChatPacer;
  /** Messages waiting to leave, per chat. */
  readonly #queued = new Map<number, number>();
  /** Chats whose full queue was already logged (until it empties). */
  readonly #overflowed = new Set<number>();
  /** Chats that answered 403 (the user blocked the bot): nothing is sent until they write again. */
  readonly #blocked = new Set<number>();
  /** Sends waiting to retry after a network error: woken as soon as polling works again. */
  readonly #wakeSends = new Set<() => void>();
  /** Aborted when the connection closes: queued messages stop retrying. */
  #sendAbort: AbortController | null = null;
  readonly #ignoredAt = new Map<string, number>();
  #later: Later[];
  #laterTimer: NodeJS.Timeout | null = null;
  #offLog: (() => void) | null = null;
  /** Stopped with the core: late failures are not logged (the database is closing). */
  #stopped = false;
  /** Connect and disconnect one at a time: two tokens saved together never leave two loops. */
  #lifecycle: Promise<unknown> = Promise.resolve();
  /**
   * Bumped by every `setToken` and `removeToken` when called: a token whose check ends after a
   * later save or removal is not saved (review of 18/10, item 7: "Rimuovi" during `getMe`).
   */
  #tokenGeneration = 0;

  constructor(options: TelegramChannelOptions) {
    this.#o = options;
    this.#pacer = new ChatPacer(options.chatGapMs);
    this.#now = options.now ?? Date.now;
    migrate(options.db, 'telegram', telegramMigrations);
    this.#users = new TelegramUsers(options.db);
    this.#questionMessages = new TelegramQuestionMessages(options.db);
    this.#questionMessages.prune(this.#now() - 30 * 24 * 3600_000);
    this.#pairing = new Pairing({ now: this.#now });
    this.#later = options.state.get<Later[]>(LATER_KEY) ?? [];
  }

  // --- lifecycle ---------------------------------------------------------------

  /** Starts the bot when a token is configured. Never throws: problems show in `view()`. */
  start(): void {
    this.#stopped = false;
    const stored = this.#stored();
    if (!stored) {
      this.#status = 'off';
      return;
    }
    this.#o.log.redactor.addSecret(stored.key);
    this.#connect(stored.key);
  }

  /** Stops polling and waits for the messages already on their way. */
  async stop(): Promise<void> {
    // At once, before the queue: a token saved meanwhile sees it and does not restart the bot.
    this.#stopped = true;
    this.#offLog?.();
    this.#offLog = null;
    await this.#serial(() => this.#disconnect());
    // What waits for the quiet hours stays in the database for the next start.
    if (this.#laterTimer) clearTimeout(this.#laterTimer);
    this.#laterTimer = null;
  }

  #serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.#lifecycle.then(job, job);
    this.#lifecycle = run.catch(() => {});
    return run;
  }

  #stored() {
    return readProviderKey(this.#o.secretsDir, TELEGRAM_KEY_ID, [TELEGRAM_ENV], this.#o.env);
  }

  #connect(token: string): void {
    // What the bot says comes from the log (also when the token arrives from the UI later).
    this.#offLog ??= this.#o.log.subscribe((e) => this.#onEvent(e));
    this.#api = new Api(token, telegramClient(this.#o.apiRoot, (this.#o.pollTimeoutS ?? 30) + 15));
    this.#status = 'connecting';
    this.#error = undefined;
    this.#sendAbort = new AbortController();
    const abort = new AbortController();
    this.#abort = abort;
    this.#loop = this.#supervise(this.#api, abort.signal);
    // Questions closed while the bot was off (a restart expires them) lose their buttons.
    this.#closeStaleQuestions();
    // Notifications that waited for the quiet hours (maybe across a restart).
    this.#scheduleLater();
  }

  /**
   * Keeps the polling alive: an unexpected error in `#run` (a database write,
   * the log) is logged, shown as `retrying`, and the loop starts again with
   * backoff. It ends only when the connection closes or the token is refused.
   */
  async #supervise(api: Api, signal: AbortSignal): Promise<void> {
    for (let crashes = 0; !signal.aborted; crashes++) {
      try {
        await this.#run(api, signal);
        return;
      } catch (err) {
        this.#append({
          agent: 'system',
          type: 'error',
          data: {
            code: 'telegram_failed',
            message: err instanceof Error ? err.message : String(err),
          },
        });
        this.#status = 'retrying';
        this.#error = 'Telegram si è fermato per un errore: riparto da solo.';
        const base = this.#o.retryBaseMs ?? 1000;
        const max = this.#o.retryMaxMs ?? 60_000;
        const wait = Math.min(max, base * 2 ** Math.min(crashes, 16));
        await sleep(wait, undefined, { signal }).catch(() => {});
      }
    }
  }

  async #disconnect(): Promise<void> {
    this.#abort?.abort();
    await this.#loop;
    this.#abort = null;
    this.#loop = null;
    for (const t of this.#tracks.values()) this.#stopTyping(t);
    // Messages already queued (a confirmation, a last answer) still leave.
    await Promise.race([Promise.allSettled([...this.#chains.values()]), sleep(3000)]);
    // The rest stops retrying.
    this.#sendAbort?.abort();
    this.#sendAbort = null;
    this.#api = null;
    this.#status = 'off';
  }

  // --- settings (API) ------------------------------------------------------------

  view(): TelegramView {
    const stored = this.#stored();
    return {
      token: { set: stored !== null, ...(stored ? { source: stored.source } : {}) },
      ...(this.#bot ? { bot: this.#bot } : {}),
      status: stored ? this.#status : 'off',
      ...(this.#error ? { error: this.#error } : {}),
      users: this.#users.list(),
      pairing: this.#pairing.view(),
      prefs: this.#o.prefs(),
      bots: this.#o.bots?.() ?? [],
      ...(this.#o.toolRisks ? { toolRisks: this.#o.toolRisks() } : {}),
    };
  }

  /** The main bot's id (when known) and token: a dedicated bot may never use them (D-107). */
  identity(): { id?: number; token?: string } {
    const stored = this.#stored();
    return {
      ...(this.#bot ? { id: this.#bot.id } : {}),
      ...(stored ? { token: stored.key } : {}),
    };
  }

  /** The accounts paired with the bot: the user (D-107). */
  users(): TelegramUser[] {
    return this.#users.list();
  }

  /**
   * Verifies the token with `getMe`, saves it (mode 600) and (re)starts the bot. `pasted` is
   * what the user pasted: the token alone or BotFather's whole message.
   */
  async setToken(pasted: string): Promise<TelegramView> {
    const trimmed = extractTelegramToken(pasted);
    if (!trimmed) throw new TelegramError('invalid_token', telegramTokenShapeMessage());
    const generation = ++this.#tokenGeneration;
    this.#o.log.redactor.addSecret(trimmed);
    const api = new Api(trimmed, telegramClient(this.#o.apiRoot, 15));
    let me;
    try {
      me = await api.getMe();
    } catch (err) {
      const failure = tokenCheckFailure(err, this.#o.apiRoot);
      // The real cause stays in the log (the bot URL in it carries the token: the log redacts it).
      this.#channelEvent({
        action: 'token_check_failed',
        reason: failure.kind,
        message: failure.detail,
      });
      throw new TelegramError(failure.code, failure.message);
    }
    // One long poll per token: a bot of a monster stays its own (D-107).
    if (this.#o.dedicatedBot?.(me.id)) {
      throw new TelegramError(
        'bot_in_use',
        `@${me.username} è già il bot di un mostro: crea un bot nuovo con BotFather per te.`,
      );
    }
    return this.#serial(async () => {
      // The core stopped while the token was being checked: it stays stopped. A token saved
      // or removed after this one was asked for wins.
      if (this.#stopped || generation !== this.#tokenGeneration) return this.view();
      saveProviderKey(this.#o.secretsDir, TELEGRAM_KEY_ID, trimmed);
      this.#channelEvent({ action: 'token_set', name: `@${me.username}` });
      // The old loop ends first: it must never see (and save its offset for) the new bot.
      await this.#disconnect();
      // Stopped while the old loop was ending (review of 18/10, item 6): no new loop.
      if (this.#stopped) return this.view();
      this.#bot = { id: me.id, username: me.username, name: me.first_name };
      this.#connect(trimmed);
      return this.view();
    });
  }

  /** Forgets the saved token and stops the bot (a token in the environment takes over). */
  async removeToken(): Promise<TelegramView> {
    const stored = this.#stored();
    if (stored?.source === 'env') {
      throw new TelegramError(
        'token_from_env',
        `Il token arriva dalla variabile ${TELEGRAM_ENV}: toglila da lì e riavvia Monsters.`,
      );
    }
    // A token still being checked is not saved after this (see `#tokenGeneration`); one already
    // queued is saved first and removed here, in the same queue.
    this.#tokenGeneration++;
    return this.#serial(async () => {
      removeProviderKey(this.#o.secretsDir, TELEGRAM_KEY_ID);
      this.#pairing.cancel();
      await this.#disconnect();
      this.#bot = null;
      this.#error = undefined;
      if (stored) this.#channelEvent({ action: 'token_removed' });
      const fromEnv = this.#stored();
      if (fromEnv && !this.#stopped) this.#connect(fromEnv.key);
      return this.view();
    });
  }

  /** A new pairing code (the previous one stops working). */
  startPairing(): TelegramPairing {
    if (!this.#stored()) {
      throw new TelegramError('no_token', 'Collega prima il bot con il suo token.');
    }
    const code = this.#pairing.create();
    // The code is a secret for as long as it lives: never in the log.
    this.#o.log.redactor.addSecret(code.code);
    this.#channelEvent({ action: 'pairing_started' });
    return {
      ...code,
      ...(this.#bot ? { link: `https://t.me/${this.#bot.username}?start=${code.code}` } : {}),
    };
  }

  cancelPairing(): TelegramView {
    this.#pairing.cancel();
    return this.view();
  }

  removeUser(id: number): TelegramView {
    const user = this.#users.list().find((u) => u.id === id);
    if (!user || !this.#users.remove(id)) {
      throw new TelegramError('not_found', 'Questo account non è tra quelli collegati.');
    }
    this.#active.delete(id);
    // Work they started goes on, but its replies no longer reach them.
    for (const t of this.#tracks.values()) {
      if (t.chatId !== id) continue;
      this.#stopTyping(t);
      t.chatId = null;
    }
    this.#channelEvent({ action: 'user_removed', userId: String(id), name: user.name });
    return this.view();
  }

  updatePrefs(update: TelegramPrefsUpdate): TelegramView {
    const current = this.#o.prefs();
    const next: TelegramPrefs = {
      quietHours: { ...current.quietHours, ...update.quietHours },
      notify: { ...current.notify, ...update.notify },
    };
    this.#o.savePrefs(next);
    // Out of the quiet hours now: what was waiting leaves.
    this.#scheduleLater();
    return this.view();
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
        this.#setDown(
          'retrying',
          'Telegram chiede di rallentare: riprovo appena me lo permette.',
          err,
        );
        return 'retry';
      }
      if (tokenRefused(err)) {
        this.#setDown('error', 'Telegram ha rifiutato il token: incollane uno nuovo.', err);
        return 'stop';
      }
      if (err instanceof GrammyError && err.error_code === 409) {
        this.#setDown(
          'retrying',
          'Un altro programma sta usando questo bot (o ha un webhook): Monsters riprova.',
          err,
        );
        return 'retry';
      }
      this.#setDown('retrying', 'Telegram non risponde: riprovo da solo.', err);
      return 'retry';
    };

    // Who the bot is.
    while (!signal.aborted && !this.#bot) {
      try {
        const me = await api.getMe(grammySignal(signal));
        this.#bot = { id: me.id, username: me.username, name: me.first_name };
      } catch (err) {
        if (fail(err) === 'stop') return;
        await backoff();
      }
    }
    if (signal.aborted || !this.#bot) return;
    // This loop's bot, fixed: a new token later never gets this loop's offset.
    const botId = this.#bot.id;
    void api.setMyCommands(COMMANDS, undefined, grammySignal(signal)).catch(() => {});

    const saved = this.#o.state.get<{ bot: number; offset: number }>(OFFSET_KEY);
    let offset = saved && saved.bot === botId ? saved.offset : 0;
    // After (re)connecting, a poll that answers at once: "online" means it works now.
    let quick = true;
    while (!signal.aborted) {
      let updates: Update[];
      try {
        updates = await api.getUpdates(
          {
            offset,
            timeout: quick ? 0 : (this.#o.pollTimeoutS ?? 30),
            allowed_updates: ['message', 'callback_query'],
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
      this.#setOnline();
      for (const u of updates) {
        offset = u.update_id + 1;
        // Before handling it: at most once. A crash in the middle never runs a command twice.
        this.#o.state.set(OFFSET_KEY, { bot: botId, offset });
        try {
          await this.#handle(u);
        } catch (err) {
          this.#append({
            agent: 'system',
            type: 'error',
            data: {
              code: 'telegram_update_failed',
              message: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }
    }
  }

  #setOnline(): void {
    // Messages waiting to retry leave now.
    for (const wake of [...this.#wakeSends]) wake();
    if (this.#status === 'online') return;
    this.#status = 'online';
    this.#error = undefined;
    this.#channelEvent({
      action: 'connected',
      ...(this.#bot ? { name: `@${this.#bot.username}` } : {}),
    });
  }

  #setDown(status: TelegramStatus, text: string, err: unknown): void {
    const wasUp = this.#status === 'online' || this.#status === 'connecting';
    this.#status = status;
    this.#error = text;
    if (wasUp || status === 'error') {
      const detail =
        err instanceof GrammyError
          ? `${err.error_code} ${err.description}`
          : err instanceof HttpError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
      this.#channelEvent({ action: 'disconnected', reason: status, message: detail.slice(0, 300) });
    }
  }

  // --- incoming --------------------------------------------------------------------

  async #handle(u: Update): Promise<void> {
    // Someone who writes again can be answered again (they unblocked the bot).
    const writer = u.message?.chat.id ?? u.callback_query?.from.id;
    if (writer !== undefined) this.#blocked.delete(writer);
    if (u.message) return this.#onMessage(u.message);
    if (u.callback_query) this.#onCallback(u.callback_query);
  }

  #ignore(
    from: { id: number; first_name?: string; username?: string | undefined } | undefined,
    reason: string,
    text?: string,
  ): void {
    if (this.#throttled(`${from?.id ?? 0}:${reason}`)) return;
    this.#channelEvent({
      action: 'ignored',
      ...(from ? { userId: String(from.id) } : {}),
      ...(from?.username
        ? { name: `@${from.username}` }
        : from?.first_name
          ? { name: from.first_name }
          : {}),
      reason,
      ...(text ? { preview: clip(text.replace(/\s+/g, ' '), 40) } : {}),
    });
  }

  /** A flood from the same account and reason is logged once every 10 s. */
  #throttled(key: string): boolean {
    const last = this.#ignoredAt.get(key);
    if (last !== undefined && this.#now() - last < 10_000) return true;
    if (this.#ignoredAt.size > 1000) this.#ignoredAt.clear();
    this.#ignoredAt.set(key, this.#now());
    return false;
  }

  async #onMessage(m: Message): Promise<void> {
    const from = m.from;
    if (!from || from.is_bot) return this.#ignore(from, 'bot_or_anonymous', m.text);
    if (m.chat.type !== 'private') return this.#ignore(from, 'not_private', m.text);
    const known = this.#users.has(from.id);
    if (m.forward_origin || m.is_automatic_forward) {
      this.#ignore(from, 'forwarded', m.text);
      if (known) this.#reply(m.chat.id, 'Non eseguo i messaggi inoltrati: scrivimi direttamente.');
      return;
    }
    const text = m.text;
    if (!known) {
      const start = text ? /^\/start(?:@\w+)?\s+(\S{4,64})\s*$/i.exec(text) : null;
      if (!start) return this.#ignore(from, 'not_whitelisted', text);
      return this.#pair(m, start[1]!);
    }
    if (text === undefined) {
      this.#ignore(from, 'not_text');
      this.#reply(m.chat.id, 'Per ora capisco solo i messaggi di testo.');
      return;
    }
    this.#active.set(m.chat.id, this.#now());
    const command = /^\/([A-Za-z_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (command) {
      const [, name, bot, args] = command;
      if (bot && this.#bot && bot.toLowerCase() !== this.#bot.username.toLowerCase()) return;
      return this.#onCommand(m.chat.id, name!.toLowerCase(), (args ?? '').trim());
    }
    const repliedTo = m.reply_to_message?.message_id;
    // A reply to a question message answers it (or says it is closed), even after a restart.
    const asked =
      repliedTo !== undefined ? this.#questionMessages.find(m.chat.id, repliedTo) : undefined;
    const askedDraft = asked ? parseDraftKey(asked.questionId) : null;
    if (askedDraft) {
      this.#reply(
        m.chat.id,
        askedDraft.kind === 'docs'
          ? 'Per questa proposta usa i pulsanti Applica o Lascia stare; per cambiarla, chiedilo al mostro.'
          : 'Per questa bozza usa i pulsanti Conferma o Scarta; per cambiarla, aprila nell’app (Da rivedere).',
      );
      return;
    }
    if (asked) {
      try {
        this.#answerFrom(m.chat.id, asked.questionId, { text });
      } catch (err) {
        this.#reply(m.chat.id, this.#answerError(err));
      }
      return;
    }
    this.#sendToTeam(m.chat.id, text);
  }

  #pair(m: Message, code: string): void {
    const from = m.from!;
    const result = this.#pairing.attempt(code, from.id);
    const name = displayName(from);
    if (result !== 'ok') {
      // Logged once every 10 s per account; answered once, and only while a code
      // is active: a stranger gets nothing to play with.
      if (!this.#throttled(`${from.id}:pairing`)) {
        this.#channelEvent({
          action: 'pairing_failed',
          userId: String(from.id),
          name: from.username ? `@${from.username}` : name,
          reason: result,
        });
      }
      if (result === 'wrong_code' && this.#pairing.failures(from.id) === 1) {
        this.#reply(m.chat.id, 'Codice non valido.', { anyone: true });
      }
      return;
    }
    this.#users.add({ id: from.id, name, username: from.username }, this.#now());
    this.#active.set(m.chat.id, this.#now());
    this.#channelEvent({
      action: 'paired',
      userId: String(from.id),
      name: from.username ? `@${from.username}` : name,
    });
    this.#reply(
      m.chat.id,
      `Fatto, ${escapeHtml(from.first_name)}: ora puoi comandare i mostri da qui.\n\n${HELP}`,
      {
        html: true,
      },
    );
  }

  #sendToTeam(chatId: number, text: string): void {
    if (!this.#o.ready()) {
      this.#reply(
        chatId,
        'Completa prima il primo avvio di Monsters nel browser: poi ci sentiamo qui.',
      );
      return;
    }
    try {
      const sent = this.#o.send({ text, channel: 'telegram' });
      const track = this.#track(sent.runId, sent.agent);
      // Replies go to whoever started the work, not to whoever joined it later.
      track.chatId ??= chatId;
      if (sent.answered) {
        this.#reply(chatId, 'Risposta inviata.');
      } else if (sent.queued) {
        this.#reply(chatId, `Aggiunto al lavoro in corso di ${this.#name(sent.agent)}.`);
      }
      this.#startTyping(sent.runId);
    } catch (err) {
      if (err instanceof HaltedError) {
        this.#reply(chatId, 'I mostri sono fermi. Scrivi /riprendi per farli ripartire.');
      } else if (err instanceof DispatchError) {
        this.#reply(
          chatId,
          err.code === 'unknown_agent' ? 'Non c’è nessun mostro con questo nome.' : err.message,
        );
      } else {
        throw err;
      }
    }
  }

  async #onCommand(chatId: number, name: string, args: string): Promise<void> {
    switch (name) {
      case 'stop':
      case 'ferma': {
        const report = await this.#o.runs.kill({ by: 'telegram', reason: '/stop da Telegram' });
        this.#reply(
          chatId,
          `■ Fermato tutto. Lavori interrotti: ${report.runsAborted}, programmi chiusi: ${report.processesKilled}.\nNiente riparte finché non scrivi /riprendi.`,
        );
        return;
      }
      case 'riprendi':
      case 'resume': {
        if (!this.#o.runs.halted) {
          this.#reply(chatId, 'I mostri non sono fermi.');
          return;
        }
        this.#reply(chatId, 'Faccio ripartire i mostri?', {
          markup: {
            inline_keyboard: [
              [
                { text: 'Sì, riprendi', callback_data: 'resume:yes' },
                { text: 'No', callback_data: 'resume:no' },
              ],
            ],
          },
        });
        return;
      }
      case 'nuova':
      case 'new': {
        if (!this.#o.ready()) {
          this.#reply(chatId, 'Completa prima il primo avvio di Monsters nel browser.');
          return;
        }
        const to = args.replace(/^@/, '').trim() || undefined;
        try {
          const e = this.#o.newConversation({ to, channel: 'telegram' });
          const who = e.data.to ? ` con ${this.#name(e.data.to)}` : '';
          this.#reply(
            chatId,
            `Nuova conversazione${who}: i messaggi di prima restano nel log, ma i mostri non li vedono più.`,
          );
        } catch (err) {
          if (!(err instanceof DispatchError)) throw err;
          this.#reply(
            chatId,
            err.code === 'unknown_agent' ? 'Non c’è nessun mostro con questo nome.' : err.message,
          );
        }
        return;
      }
      case 'stato':
      case 'status':
        this.#reply(chatId, this.#statusText(), { html: true });
        return;
      case 'start':
      case 'aiuto':
      case 'help':
        this.#reply(chatId, HELP, { html: true });
        return;
      default:
        this.#reply(chatId, `Non conosco /${escapeHtml(name)}.\n\n${HELP}`, { html: true });
    }
  }

  #statusText(): string {
    const runs = this.#o.runs;
    const lines: string[] = [];
    const halt = runs.haltState;
    lines.push(
      halt ? '<b>Fermi</b> (kill switch): /riprendi per farli ripartire.' : '<b>Attivi.</b>',
    );
    const active = runs.activeRuns();
    if (active.length === 0) lines.push('Nessun lavoro in corso.');
    for (const r of active) {
      const minutes = Math.max(0, Math.round((this.#now() - r.startedAt) / 60_000));
      lines.push(
        `• ${escapeHtml(this.#name(r.agent))}: ${escapeHtml(clip(r.goal ?? 'lavoro', 80))} (${minutes} min)`,
      );
    }
    const open = this.#o.questions.list({ status: 'open' });
    if (open.length > 0) lines.push(`Domande in attesa: ${open.length}.`);
    // The projects (D-097): what each lead is doing.
    const projects = this.#o.projects?.() ?? [];
    if (projects.length > 0) {
      lines.push('', '<b>Progetti</b>');
      for (const p of projects) {
        const busy = p.lead && (p.lead.state === 'working' || p.lead.state === 'waiting');
        const doing = !p.lead
          ? 'senza capo'
          : busy
            ? `${escapeHtml(p.lead.name)}: ${escapeHtml(clip(p.lead.activity ?? 'al lavoro', 80))}`
            : `${escapeHtml(p.lead.name)} è libero`;
        const waiting = p.pending > 0 ? ` (${p.pending} da riferire)` : '';
        lines.push(`• ${escapeHtml(p.name)} — ${doing}${waiting}`);
      }
    }
    return lines.join('\n');
  }

  #onCallback(q: CallbackQuery): void {
    const api = this.#api;
    const ack = (text?: string) =>
      void api?.answerCallbackQuery(q.id, text ? { text } : undefined).catch(() => {});
    const chat = q.message?.chat;
    if (!this.#users.has(q.from.id) || (chat && chat.type !== 'private')) {
      ack();
      this.#ignore(q.from, this.#users.has(q.from.id) ? 'not_private' : 'not_whitelisted', q.data);
      return;
    }
    this.#active.set(q.from.id, this.#now());
    const data = q.data ?? '';
    if (data === 'resume:yes' || data === 'resume:no') {
      const resumed = data === 'resume:yes' && this.#o.runs.resume({ by: 'telegram' });
      ack();
      if (q.message) {
        const text =
          data === 'resume:no'
            ? 'Va bene: restano fermi.'
            : resumed
              ? '▶ Ripartiti: i mostri possono lavorare di nuovo.'
              : 'I mostri non erano fermi.';
        this.#edit(q.message.chat.id, q.message.message_id, escapeHtml(text));
      }
      return;
    }
    const draft = /^d:([yno]):([mpair]):(.{1,60})$/.exec(data);
    if (draft?.[1] === 'o') {
      ack('Apri Monsters: la trovi in Da rivedere, con tutti i campi.');
      return;
    }
    if (draft) {
      this.#onDraftButton(draft[1] === 'y', DRAFT_KINDS[draft[2]!]!, draft[3]!, ack);
      return;
    }
    const held = /^h:([0-9A-Z]{26})$/.exec(data);
    if (held) {
      try {
        this.#o.sendHeld?.(held[1]!);
        ack('Mandata');
        this.#closeQuestion(`held:${held[1]!}`, '📤 Mandata comunque.');
      } catch (err) {
        ack(clip(err instanceof Error ? err.message : 'Non riesco', 190));
      }
      return;
    }
    const answer = /^q:([0-9A-Z]{26}):(.{1,32})$/.exec(data);
    if (!answer) {
      ack();
      return;
    }
    try {
      // A private chat has the id of its user.
      this.#answerFrom(chat?.id ?? q.from.id, answer[1]!, { optionId: answer[2]! });
      ack('Risposta inviata');
    } catch (err) {
      ack(clip(this.#answerError(err), 190));
      if (err instanceof QuestionError && err.code === 'not_open') {
        const question = this.#o.questions.get(answer[1]!);
        if (question) this.#closeQuestion(question.id, this.#outcome(question));
      }
    }
  }

  /** Conferma or Scarta on a draft: the outcome closes its messages (from the log). */
  #onDraftButton(yes: boolean, kind: DraftKind, id: string, ack: (text?: string) => void): void {
    const drafts = this.#o.drafts;
    if (!drafts) return ack();
    // The card had no Applica or Conferma (review 18/10, M5, and item 12): a button forged by a
    // client does not confirm what was not shown whole.
    const d = yes ? drafts.get(kind, id) : undefined;
    if (d && kind === 'docs' && !this.#docsHere(d)) {
      return ack('Applicala nell’app: la trovi in Da rivedere, con la differenza intera.');
    }
    if (d && kind !== 'docs' && !this.#draftCard(d).fits) {
      return ack('Confermala nell’app: la trovi in Da rivedere, tutta intera.');
    }
    if (d && this.#folderOutside(d)) {
      return ack('Confermala nell’app: la cartella è fuori da Monsters Progetti.');
    }
    const work = yes ? drafts.confirm(kind, id, 'telegram') : drafts.discard(kind, id, 'telegram');
    work.then(
      () =>
        ack(yes ? (kind === 'docs' ? 'Fatto: applicata' : 'Fatto: confermata') : 'Lasciata stare'),
      (err: unknown) => {
        ack(clip(err instanceof Error ? err.message : 'Non riesco', 190));
        if (err instanceof DraftError && err.code !== 'unknown_draft') {
          this.#closeQuestion(draftKey(kind, id), '■ Non serve più una risposta.');
        } else if (err instanceof DraftError) {
          this.#closeQuestion(draftKey(kind, id), '■ Questa bozza non c’è più.');
        }
      },
    );
  }

  /**
   * A project in a folder that already exists outside `~/Monsters Progetti` gives all its
   * monsters that folder: the tap is in the app (review of 18/10, M2).
   */
  #folderOutside(d: DraftView): boolean {
    if (d.kind !== 'project' || !d.projectDraft.folder) return false;
    if (d.projectDraft.plan?.createFolder) return false;
    const base = this.#o.projectsDir?.();
    return !base || !isInside(resolve(base), resolve(d.projectDraft.folder));
  }

  /** The card of a draft, and whether all of it fits in one message. */
  #draftCard(d: DraftView): { card: string[]; fits: boolean } {
    // Every field that "Conferma" makes real (D-103): a card that does not fit is confirmed
    // in the app, never here half seen.
    const card = draftCardLines(
      d,
      (x) => this.#name(x),
      (x) => this.#o.team.project(x)?.name ?? x,
      this.#folderOutside(d),
    );
    return { card, fits: visibleLength(card.join('\n')) + 120 <= DRAFT_CARD_BUDGET };
  }

  /**
   * A proposal for CLAUDE.md or AGENTS.md is applied from Telegram (D-113), unless it is not
   * only the user's request (third-party text, a person of a group) and its diff is not all in
   * the card: then in the app only (review 18/10, M5).
   */
  #docsHere(d: DraftView): boolean {
    return draftTaint(d) === null || (this.#draftCard(d).fits && docsDiffShown(d));
  }

  /** A draft proposed by a monster: on Telegram with its two buttons, like a question. */
  #draftProposed(kind: DraftKind, id: string, e: LogEvent): void {
    const d = this.#o.drafts?.get(kind, id);
    if (!d || d.from === 'user') return;
    const { card, fits } = this.#draftCard(d);
    const code = DRAFT_CODES[kind];
    const lines = fits ? card : [clipHtmlLines(card, DRAFT_CARD_BUDGET - 300)];
    // A proposal for CLAUDE.md or AGENTS.md (D-113): its card is short (the diff only when
    // short), a long diff is in the app too.
    const docs = kind === 'docs';
    const docsHere = docs && this.#docsHere(d);
    const outside = this.#folderOutside(d);
    lines.push(
      docsHere
        ? '<i>Applica scrive il file così com’è nella proposta; la differenza intera è anche nell’app (Da rivedere).</i>'
        : docs
          ? '<i>Non viene solo da te e la differenza qui non si vede tutta: leggila e applicala nell’app (Da rivedere).</i>'
          : outside
            ? '<i>La cartella è fuori da Monsters Progetti: guardala e confermala nell’app (Da rivedere).</i>'
            : fits && kind === 'memory'
              ? '<i>Conferma le aggiunge alla sua memoria così come sono.</i>'
              : fits
                ? '<i>Conferma la crea così com’è; per cambiarla aprila nell’app (Da rivedere).</i>'
                : '<i>È troppo lunga per un messaggio: leggila tutta e confermala nell’app (Da rivedere).</i>',
    );
    const markup: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          docsHere
            ? { text: '✅ Applica', callback_data: `d:y:${code}:${id}` }
            : fits && !docs && !outside
              ? { text: '✅ Conferma', callback_data: `d:y:${code}:${id}` }
              : { text: 'Apri nell’app', callback_data: `d:o:${code}:${id}` },
          { text: docs ? 'Lascia stare' : 'Scarta', callback_data: `d:n:${code}:${id}` },
        ],
      ],
    };
    this.#notify('question', { agent: d.from, runId: e.runId, blocking: false }, this.#everyone(), {
      kind: 'question',
      questionId: draftKey(kind, id),
      html: lines.join('\n'),
      markup,
    });
  }

  /** Answers from a chat: the run the answer may start (a parked question) replies in it. */
  #answerFrom(chatId: number, questionId: string, answer: QuestionAnswer): void {
    const from = this.#o.questions.get(questionId)?.from;
    if (from) this.#answeredFrom.set(from, chatId);
    try {
      this.#o.answer(questionId, answer, 'telegram');
    } finally {
      if (from) this.#answeredFrom.delete(from);
    }
  }

  #answerError(err: unknown): string {
    if (err instanceof QuestionError) {
      return err.code === 'not_open'
        ? 'Questa domanda non aspetta più una risposta.'
        : err.code === 'not_found'
          ? 'Non trovo questa domanda.'
          : 'Questa risposta non va bene per la domanda.';
    }
    throw err;
  }

  // --- outgoing ------------------------------------------------------------------------

  #track(runId: string, agent: string): RunTrack {
    let t = this.#tracks.get(runId);
    if (!t) {
      t = { agent, chatId: null, lastText: '', notes: new Set(), typing: null };
      this.#tracks.set(runId, t);
    }
    return t;
  }

  #name(id: string): string {
    return this.#o.team.get(id)?.config.name ?? id;
  }

  #startTyping(runId: string): void {
    const t = this.#tracks.get(runId);
    if (!t || t.chatId === null || t.typing) return;
    const chatId = t.chatId;
    const ping = () => void this.#api?.sendChatAction(chatId, 'typing').catch(() => {});
    ping();
    t.typing = setInterval(ping, this.#o.typingIntervalMs ?? 4500);
    t.typing.unref();
  }

  #stopTyping(t: RunTrack): void {
    if (t.typing) clearInterval(t.typing);
    t.typing = null;
  }

  /**
   * Runs `job` after the previous messages of the same chat: order is kept.
   * Only accounts still in the whitelist when the job runs get it, unless
   * `anyone` (the answer to a pairing attempt).
   */
  #enqueue(
    chatId: number,
    job: (api: Api) => Promise<unknown>,
    options: { anyone?: boolean | undefined } = {},
  ): void {
    const api = this.#api;
    const signal = this.#sendAbort?.signal;
    if (!api || !signal || this.#blocked.has(chatId)) return;
    const queued = this.#queued.get(chatId) ?? 0;
    if (queued >= (this.#o.sendQueueMax ?? 100)) {
      if (!this.#overflowed.has(chatId)) {
        this.#overflowed.add(chatId);
        this.#sendFailed(`chat ${chatId}: too many messages waiting, the newest are dropped`);
      }
      return;
    }
    this.#queued.set(chatId, queued + 1);
    const prev: Promise<unknown> = this.#chains.get(chatId) ?? Promise.resolve();
    const next = prev
      .then(() => {
        if (signal.aborted || this.#blocked.has(chatId)) return;
        if (!options.anyone && !this.#users.has(chatId)) return;
        return this.#pacer
          .wait(chatId, signal)
          .then(() => (signal.aborted ? undefined : this.#withRetry(() => job(api), signal)))
          .finally(() => this.#pacer.sent(chatId));
      })
      .catch((err: unknown) => {
        if (forbidden(err)) {
          // The user blocked the bot: the rest of this chat's queue is skipped, and it shows.
          if (!this.#blocked.has(chatId)) {
            this.#blocked.add(chatId);
            const user = this.#users.list().find((u) => u.id === chatId);
            this.#channelEvent({
              action: 'chat_left',
              userId: String(chatId),
              ...(user ? { name: user.name } : {}),
              reason: 'forbidden',
              message: err.description.slice(0, 200),
            });
          }
          return;
        }
        this.#sendFailed(
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

  #sendFailed(message: string): void {
    this.#append({
      agent: 'system',
      type: 'error',
      data: { code: 'telegram_send_failed', message },
    });
  }

  /**
   * Sends again while the failure is transient (network, Telegram 5xx, 429):
   * with backoff, waking up as soon as polling works again, until
   * `sendGiveUpMs` or the connection closes. Then the last error is thrown.
   */
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
        if (err instanceof GrammyError && err.error_code === 429) {
          // Telegram said how long: coming back earlier only extends the flood control.
          await sleep(wait, undefined, { signal }).catch(() => {});
        } else {
          // A network error: send again as soon as polling works.
          let wake = () => {};
          const online = new Promise<void>((resolve) => (wake = resolve));
          this.#wakeSends.add(wake);
          await Promise.race([sleep(wait, undefined, { signal }).catch(() => {}), online]);
          this.#wakeSends.delete(wake);
        }
        if (signal.aborted) throw err;
      }
    }
  }

  /** Sends text (Markdown by default) split into messages; HTML refused → plain text. */
  #reply(
    chatId: number,
    text: string,
    options: {
      html?: boolean;
      markup?: InlineKeyboardMarkup;
      silent?: boolean;
      anyone?: boolean;
    } = {},
  ): void {
    const pieces = options.html ? splitHtml(text) : splitMarkdown(text);
    pieces.forEach((piece, i) => {
      const last = i === pieces.length - 1;
      const html = options.html ? piece : toTelegramHtml(piece);
      this.#enqueue(
        chatId,
        async (api) => {
          const extra = {
            ...(last && options.markup ? { reply_markup: options.markup } : {}),
            ...(options.silent ? { disable_notification: true } : {}),
            link_preview_options: { is_disabled: true },
          };
          try {
            await api.sendMessage(chatId, html, { parse_mode: 'HTML', ...extra });
          } catch (err) {
            if (
              err instanceof GrammyError &&
              err.error_code === 400 &&
              /parse|entit/i.test(err.description)
            ) {
              await api.sendMessage(chatId, piece, extra);
              return;
            }
            throw err;
          }
        },
        { anyone: options.anyone },
      );
    });
  }

  #edit(chatId: number, messageId: number, html: string): void {
    this.#enqueue(chatId, async (api) => {
      try {
        await api.editMessageText(chatId, messageId, html, {
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

  /** Recipients of a notification: every account in the whitelist. */
  #everyone(): number[] {
    return this.#users.list().map((u) => u.id);
  }

  #isActive(chatId: number): boolean {
    const at = this.#active.get(chatId);
    return at !== undefined && this.#now() - at < (this.#o.activeWindowMs ?? 10 * 60_000);
  }

  /**
   * A notice of the core to every paired account (the end of a run of an
   * automation that asked for Telegram, D-094): the quiet hours still hold.
   */
  announce(
    kind: 'done' | 'error',
    text: string,
    meta: { agent: string; runId: string | null },
    held?: { id: string },
  ): void {
    if (held && this.#o.sendHeld) {
      // A reply a dedicated bot held: the notice has «Manda comunque».
      this.#notify(
        kind,
        meta,
        this.#everyone(),
        {
          kind: 'question',
          questionId: `held:${held.id}`,
          html: escapeHtml(text),
          markup: {
            inline_keyboard: [[{ text: '📤 Manda comunque', callback_data: `h:${held.id}` }]],
          },
        },
        true,
      );
      return;
    }
    this.#notify(kind, meta, this.#everyone(), { kind: 'text', text }, true);
  }

  /** Asks the DecisionGate when to notify, then sends now, silently, or later. */
  #notify(
    kind: 'done' | 'question' | 'error',
    meta: { agent: string; runId: string | null; blocking?: boolean },
    chats: number[],
    out: Outgoing,
    asked = false,
  ): void {
    if (chats.length === 0 || !this.#api) return;
    const prefs = this.#o.prefs();
    const enabled =
      asked ||
      (kind === 'done'
        ? prefs.notify.done
        : kind === 'question'
          ? prefs.notify.questions
          : prefs.notify.errors);
    const decision = this.#o.gate.notify({
      kind,
      agent: meta.agent,
      runId: meta.runId,
      ...(meta.blocking !== undefined ? { blocking: meta.blocking } : {}),
      userActive: chats.some((c) => this.#isActive(c)),
      enabled,
      quietHours: prefs.quietHours,
      at: new Date(this.#now()),
    });
    if (decision.when === 'never') return;
    if (decision.when === 'later') {
      this.#later.push({ chats, out });
      if (this.#later.length > LATER_MAX) this.#later.splice(0, this.#later.length - LATER_MAX);
      this.#o.state.set(LATER_KEY, this.#later);
      this.#scheduleLater();
      return;
    }
    for (const c of chats) this.#deliver(c, out, decision.when === 'silent');
  }

  #deliver(chatId: number, out: Outgoing, silent: boolean): void {
    if (out.kind === 'text') {
      this.#reply(chatId, out.text, { silent });
      return;
    }
    // Sent later (quiet hours, a restart): only if nobody answered meanwhile.
    // (The row is written right after the event: missing means just asked.)
    const now = this.#o.questions.get(out.questionId);
    if (now && now.status !== 'open') return;
    const draft = parseDraftKey(out.questionId);
    if (draft && !this.#o.drafts?.get(draft.kind, draft.id)) return;
    this.#enqueue(chatId, async (api) => {
      const msg = await api.sendMessage(chatId, out.html, {
        parse_mode: 'HTML',
        reply_markup: out.markup,
        ...(silent ? { disable_notification: true } : {}),
      });
      this.#questionMessages.add(
        { chatId, messageId: msg.message_id, questionId: out.questionId, html: out.html },
        this.#now(),
      );
    });
  }

  #scheduleLater(): void {
    if (this.#later.length === 0) return;
    if (this.#laterTimer) clearTimeout(this.#laterTimer);
    this.#laterTimer = null;
    const prefs = this.#o.prefs();
    const wait = prefs.quietHours.enabled
      ? msUntilQuietEnds(prefs.quietHours, new Date(this.#now()))
      : 0;
    const flush = () => {
      this.#laterTimer = null;
      // Bot off: they keep waiting, in the database, for the next connection.
      if (!this.#api || this.#stopped) return;
      const waiting = this.#later;
      this.#later = [];
      this.#o.state.set(LATER_KEY, []);
      // Recipients are checked when each message leaves (still in the whitelist).
      for (const { chats, out } of waiting) for (const c of chats) this.#deliver(c, out, false);
    };
    if (wait <= 0) {
      flush();
      return;
    }
    this.#laterTimer = setTimeout(flush, Math.min(wait, 2 ** 31 - 1));
    this.#laterTimer.unref();
  }

  // --- log → chat -------------------------------------------------------------------------

  #onEvent(e: LogEvent): void {
    switch (e.type) {
      case 'run':
        if (e.runId === null) return;
        if (e.data.status === 'started') {
          const t = this.#track(e.runId, e.agent);
          // Started by an answer given here (a parked question): it replies here.
          const chat = this.#answeredFrom.get(e.agent);
          if (chat !== undefined && t.chatId === null) {
            t.chatId = chat;
            this.#startTyping(e.runId);
          }
        } else this.#runEnded(e.runId, e.agent, e.data.status, e.data.error);
        return;
      case 'message': {
        if (e.data.role !== 'agent' || e.data.partial || e.runId === null || e.parentId !== null)
          return;
        const t = this.#tracks.get(e.runId);
        if (!t || t.agent !== e.agent || !e.data.text.trim()) return;
        if (t.chatId !== null) this.#reply(t.chatId, e.data.text);
        else t.lastText = e.data.text;
        return;
      }
      case 'vault_change':
        if (e.runId && e.data.action !== 'propose')
          this.#tracks.get(e.runId)?.notes.add(e.data.path);
        return;
      case 'question':
        this.#questionAsked(e);
        return;
      case 'answer': {
        const q = this.#o.questions.get(e.data.questionId);
        if (!q) return;
        const label = q.options.find((o) => o.id === e.data.optionId)?.label;
        const what = label ?? e.data.text ?? '';
        const where = e.data.channel ? ` (${CHANNEL_WORDS[e.data.channel] ?? e.data.channel})` : '';
        this.#closeQuestion(q.id, `✅ Risposta${where}: ${clip(what, 300)}`);
        // The work goes on: "typing…" again.
        if (q.blocking) this.#startTyping(q.runId);
        return;
      }
      case 'spend': {
        // The spending cap (D-070): 80% and 100% reach the phone like an error.
        const icon = e.data.action === 'stopped' ? '⛔' : '⚠️';
        const tail =
          e.data.action === 'stopped'
            ? `\nPer alzarlo: ${e.data.scope.startsWith('project:') ? `la ${spendCapPath(true)}` : spendCapPath()}.`
            : '';
        this.#notify(
          'error',
          { agent: e.data.subject ?? 'system', runId: e.runId },
          this.#everyone(),
          { kind: 'text', text: `${icon} ${e.data.message}${tail}` },
        );
        return;
      }
      case 'mcp_server':
        // A service whose sign-in died (connettori 1): an automation at night would fail in silence.
        if (e.data.action === 'needs_signin') {
          this.#notify('error', { agent: 'system', runId: e.runId }, this.#everyone(), {
            kind: 'text',
            text: `🔑 ${e.data.message ?? `${e.data.server} chiede di nuovo l’accesso.`}`,
          });
        }
        return;
      case 'question_expired':
        this.#closeQuestion(
          e.data.questionId,
          e.data.reason === 'kill'
            ? '■ Scaduta: hai fermato i mostri.'
            : '■ Non serve più una risposta.',
        );
        return;
      default: {
        // Drafts of the monsters (D-098): proposed → a message, answered → closed.
        const d = this.#o.drafts ? draftOfEvent(e) : null;
        if (!d) return;
        if (d.open) {
          this.#draftProposed(d.kind, d.id, e);
          return;
        }
        const by = (e.data as { by?: Channel }).by;
        const where = by ? ` (${CHANNEL_WORDS[by] ?? by})` : '';
        this.#closeQuestion(
          draftKey(d.kind, d.id),
          d.outcome === 'confirmed'
            ? `✅ ${d.kind === 'docs' ? 'Applicata' : 'Confermata'}${where}`
            : d.outcome === 'superseded'
              ? '■ Sostituita da una proposta nuova'
              : `■ Lasciata stare${where}`,
        );
      }
    }
  }

  #runEnded(runId: string, agent: string, status: string, error: string | undefined): void {
    const t = this.#tracks.get(runId);
    this.#tracks.delete(runId);
    if (!t) return;
    this.#stopTyping(t);
    const who = this.#name(agent);
    const notes = [...t.notes].slice(0, 10).map((p) => `• ${p}`);
    // Ended on a question for the user (D-078): the question went out on its own.
    if (t.chatId !== null) {
      if ((status === 'completed' || status === 'waiting_user') && notes.length > 0) {
        this.#reply(t.chatId, `📝 Note toccate:\n${notes.join('\n')}`);
      } else if (status === 'failed') {
        this.#reply(
          t.chatId,
          `⚠️ Il lavoro di ${who} non è andato a buon fine: ${clip(error ?? 'errore', 500)}`,
        );
      } else if (status === 'aborted' && !this.#o.runs.halted) {
        this.#reply(t.chatId, `■ Il lavoro di ${who} si è fermato.`);
      }
      return;
    }
    // Work started elsewhere (UI, terminal): a notification, if the gate says so.
    // An automation announces its own end (`announce`).
    if (this.#o.quietRun?.(runId)) return;
    if (status === 'completed') {
      const body = t.lastText ? `\n\n${clip(t.lastText, 1500)}` : '';
      const text = `✅ ${who} ha finito.${body}${notes.length ? `\n\n📝 Note toccate:\n${notes.join('\n')}` : ''}`;
      this.#notify('done', { agent, runId }, this.#everyone(), { kind: 'text', text });
    } else if (status === 'failed') {
      const text = `⚠️ Il lavoro di ${who} non è andato a buon fine: ${clip(error ?? 'errore', 500)}`;
      this.#notify('error', { agent, runId }, this.#everyone(), { kind: 'text', text });
    }
  }

  #questionAsked(e: LogEvent<'question'>): void {
    const d = e.data;
    // A question of a chat of a dedicated bot is asked there; the brake's cards and the
    // requests of an access (D-130) are the user's.
    if (e.runId && d.kind === undefined && this.#o.groupRun?.(e.runId)) return;
    const t = e.runId ? this.#tracks.get(e.runId) : undefined;
    // The work waits for the user: no "typing…" until the answer.
    if (t && d.blocking) this.#stopTyping(t);
    const chats = t?.chatId != null ? [t.chatId] : this.#everyone();
    const who = this.#name(e.agent);
    // Clipped before escaping (the limit counts visible characters, not tags):
    // the question, the labels, then descriptions in what is left, so the
    // message and its outcome stay under Telegram's 4096 characters.
    const head = `❓ ${who} chiede: ${clip(d.question, 1500)}`;
    const labels = d.options.map((o, i) => {
      const rec = o.id === d.recommended ? ' (consigliata)' : '';
      return { n: `${i + 1}. `, label: clip(o.label, 200), rec };
    });
    const footer = [
      d.options.length > 0
        ? 'Scegli un pulsante, oppure rispondi a questo messaggio con un testo.'
        : 'Rispondi a questo messaggio con la tua risposta.',
      ...(d.blocking ? [] : ['Intanto il lavoro va avanti.']),
    ];
    const used =
      head.length +
      labels.reduce((sum, l) => sum + l.n.length + l.label.length + l.rec.length + 1, 0) +
      footer.reduce((sum, f) => sum + f.length + 1, 0);
    const described = d.options.filter((o) => o.description).length;
    const room = described > 0 ? Math.floor((QUESTION_BUDGET - used) / described) - 3 : 0;
    const descMax = Math.min(400, room);
    const lines = [`❓ <b>${escapeHtml(who)}</b> chiede: ${escapeHtml(clip(d.question, 1500))}`];
    for (const [i, o] of d.options.entries()) {
      const l = labels[i]!;
      const rec = l.rec ? ' <i>(consigliata)</i>' : '';
      const desc =
        o.description && descMax >= 10 ? ` · ${escapeHtml(clip(o.description, descMax))}` : '';
      lines.push(`${l.n}<b>${escapeHtml(l.label)}</b>${rec}${desc}`);
    }
    for (const f of footer) lines.push(`<i>${f}</i>`);
    const html = lines.join('\n');
    const markup: InlineKeyboardMarkup | ForceReply =
      d.options.length > 0
        ? {
            inline_keyboard: d.options.map((o, i) => [
              {
                text: clip(`${i + 1}. ${o.label}`, 60),
                callback_data: `q:${d.questionId}:${o.id}`,
              },
            ]),
          }
        : { force_reply: true, input_field_placeholder: 'La tua risposta' };
    this.#notify('question', { agent: e.agent, runId: e.runId, blocking: d.blocking }, chats, {
      kind: 'question',
      questionId: d.questionId,
      html,
      markup,
    });
  }

  /** The line added under a question that no longer waits for an answer. */
  #outcome(q: Question): string {
    if (q.status === 'answered' && q.answer) {
      const label = q.options.find((o) => o.id === q.answer?.optionId)?.label;
      return `✅ Risposta: ${clip(label ?? q.answer.text ?? '', 300)}`;
    }
    return '■ Non serve più una risposta.';
  }

  /** Messages of questions closed while the bot was off: no more buttons. */
  #closeStaleQuestions(): void {
    const seen = new Set<string>();
    for (const m of this.#questionMessages.open()) {
      if (seen.has(m.questionId)) continue;
      seen.add(m.questionId);
      const draft = parseDraftKey(m.questionId);
      if (draft) {
        if (!this.#o.drafts?.get(draft.kind, draft.id)) {
          this.#closeQuestion(m.questionId, '■ Non serve più una risposta.');
        }
        continue;
      }
      const q = this.#o.questions.get(m.questionId);
      if (q?.status === 'open') continue;
      this.#closeQuestion(m.questionId, q ? this.#outcome(q) : '■ Non serve più una risposta.');
    }
  }

  /** Updates every Telegram message of a question: no more buttons, the outcome below. */
  #closeQuestion(questionId: string, outcome: string): void {
    const chats = new Set(this.#questionMessages.open(questionId).map((s) => s.chatId));
    // Wait for the questions still on their way to each chat, then edit them.
    const targets = chats.size > 0 ? [...chats] : [...this.#chains.keys()];
    for (const chatId of targets) {
      this.#enqueue(chatId, () => {
        for (const s of this.#questionMessages.open(questionId)) {
          if (s.chatId !== chatId) continue;
          this.#edit(s.chatId, s.messageId, `${s.html}\n\n${escapeHtml(outcome)}`);
          // Kept, closed: a later reply to it is told the question is over.
          this.#questionMessages.close(s.chatId, s.messageId);
        }
        return Promise.resolve();
      });
    }
  }

  #append(event: Parameters<EventLog['append']>[0]): void {
    if (this.#stopped) return;
    this.#o.log.append(event);
  }

  #channelEvent(data: {
    action:
      | 'connected'
      | 'disconnected'
      | 'ignored'
      | 'paired'
      | 'pairing_failed'
      | 'pairing_started'
      | 'user_removed'
      | 'token_set'
      | 'token_removed'
      | 'token_check_failed'
      | 'chat_left';
    userId?: string;
    name?: string;
    reason?: string;
    preview?: string;
    message?: string;
  }): void {
    this.#append({ agent: 'system', type: 'channel', data: { channel: 'telegram', ...data } });
  }
}
