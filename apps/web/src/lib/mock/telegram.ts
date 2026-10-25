import {
  DEFAULT_TELEGRAM_PREFS,
  extractTelegramToken,
  telegramTokenShapeMessage,
  TelegramBotCreateRequestSchema,
  TelegramBotPersonRequestSchema,
  TelegramBotUpdateRequestSchema,
  TelegramPrefsUpdateSchema,
  TelegramTokenRequestSchema,
  type AgentSummary,
  type EventInput,
  type TelegramBotChat,
  type TelegramBotPerson,
  type TelegramBotView,
  type TelegramPrefs,
  type TelegramUser,
  type TelegramView,
} from '@monsters/shared';
import type { RawResponse } from '../transport.ts';
import { tr } from './lang.ts';

/*
 * `/api/telegram` of the mock core (M2.6). A token containing `000000` is
 * refused like Telegram would; any other well-formed one is "@MonstersDemoBot".
 * A pairing code is used by "Giulio" (@giulio) a moment after it is shown, as
 * if he had sent `/start <code>` from his phone.
 *
 * Bots dedicated to one monster (D-107): a token is a new bot named after its
 * monster ("@CalypsoSaturdayBot"); the main bot's token, or one already added,
 * is `bot_in_use`; the God is `invalid_agent`. A moment after a bot is added,
 * it reports the group "Saturday Team" and Livio's `/join`, both waiting for
 * the user. The paired accounts are its owners: always there, never removed.
 */

const fail = (status: number, error: string, message?: string): RawResponse => ({
  status,
  body: { error, ...(message ? { message } : {}) },
});
const ok = (body: unknown, status = 200): RawResponse => ({ status, body });

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const BOT = { id: 7000000001, username: 'MonstersDemoBot', name: 'Monsters' };

/** The group every new dedicated bot of the mock is added to. */
export const MOCK_GROUP = { id: -1001234567890, title: 'Saturday Team' };
/** Who writes `/join` in it. */
export const MOCK_LIVIO = { id: 5550001, name: 'Livio', username: 'livio_sat' };

interface StoredBot {
  id: string;
  agent: string;
  token: string;
  bot: TelegramBotView['bot'];
  dailyLimit?: number;
  fullTools?: boolean;
  today: number;
  chats: TelegramBotChat[];
  /** Everyone but the owners (they come from the paired accounts). */
  people: TelegramBotPerson[];
  addedAt: number;
}

export class MockTelegram {
  private token: string | null = null;
  /** When the long poll of a token just saved is up: "connecting" before, as in the core. */
  private onlineAt = 0;
  private users: TelegramUser[] = [];
  private pairing: { code: string; expiresAt: number; attemptsLeft: number } | null = null;
  private prefs: TelegramPrefs = structuredClone(DEFAULT_TELEGRAM_PREFS);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly bots = new Map<string, StoredBot>();
  /** What the demo's monsters can do beyond notes and web (D-114): the settings warn. */
  private readonly risks: NonNullable<TelegramView['toolRisks']> = {};
  private readonly log: (event: EventInput) => void;
  private readonly agents: () => readonly AgentSummary[];
  private readonly pairDelayMs: number;

  constructor(options: {
    log: (event: EventInput) => void;
    agents?: () => readonly AgentSummary[];
    speed?: number;
  }) {
    this.log = options.log;
    this.agents = options.agents ?? (() => []);
    this.pairDelayMs = 3000 * (options.speed ?? 1);
  }

  private botView(b: StoredBot): TelegramBotView {
    const owners: TelegramBotPerson[] = this.users.map((u) => ({
      id: u.id,
      name: u.name,
      ...(u.username ? { username: u.username } : {}),
      status: 'approved',
      owner: true,
      addedAt: u.addedAt,
    }));
    return {
      id: b.id,
      agent: b.agent,
      bot: b.bot,
      status: 'online',
      dailyLimit: b.dailyLimit ?? 100,
      today: b.today,
      chats: b.chats,
      people: [...owners, ...b.people.filter((p) => !owners.some((o) => o.id === p.id))],
      fullTools: b.fullTools === true,
      addedAt: b.addedAt,
    };
  }

  private view(): TelegramView {
    const pairing =
      this.pairing && this.pairing.expiresAt > Date.now()
        ? { expiresAt: this.pairing.expiresAt, attemptsLeft: this.pairing.attemptsLeft }
        : null;
    return {
      token: { set: this.token !== null, ...(this.token ? { source: 'file' as const } : {}) },
      ...(this.token ? { bot: BOT } : {}),
      status: !this.token ? 'off' : Date.now() < this.onlineAt ? 'connecting' : 'online',
      users: this.users,
      pairing,
      prefs: this.prefs,
      bots: [...this.bots.values()].map((b) => this.botView(b)),
      toolRisks: this.risks,
    };
  }

  private event(data: Extract<EventInput, { type: 'channel' }>['data']): void {
    this.log({ agent: 'system', type: 'channel', data });
  }

  /** The main bot already connected, with its paired account (the demo, like Calypso's bot). */
  seedMain(at = Date.now()): void {
    this.token = `${BOT.id}:AAHseededMainBotTokenForTheMock_abcdefgh`;
    this.users = [{ id: 1001, name: 'Giulio', username: 'giulio', addedAt: at }];
  }

  /** A dedicated bot already there (the demo: Calypso in the group of Saturday). */
  seedBot(agent: string, at = Date.now()): void {
    const name = this.agents().find((a) => a.id === agent)?.name ?? agent;
    // The demo's social monster publishes with another program.
    this.risks[agent] = { terminal: false, programs: true };
    const id = '7100000042';
    this.bots.set(id, {
      id,
      agent,
      token: `${id}:AAHseededDemoBotTokenForTheMock_abcdef`,
      bot: { id: Number(id), username: usernameFor(name), name },
      dailyLimit: 200,
      today: 3,
      chats: [{ ...MOCK_GROUP, type: 'supergroup', status: 'approved', addedAt: at }],
      people: [
        {
          id: MOCK_LIVIO.id,
          name: MOCK_LIVIO.name,
          username: MOCK_LIVIO.username,
          status: 'approved',
          owner: false,
          addedAt: at,
        },
        {
          id: 5550002,
          name: 'Ettore',
          status: 'approved',
          owner: false,
          addedAt: at,
        },
      ],
      addedAt: at,
    });
  }

  handle(method: string, path: string, body: unknown): RawResponse | null {
    if (!path.startsWith('/api/telegram')) return null;
    if (path.startsWith('/api/telegram/bots')) return this.handleBots(method, path, body);
    const route = `${method} ${path.replace(/\/users\/\d+$/, '/users/:id')}`;
    switch (route) {
      case 'GET /api/telegram':
        return ok(this.view());
      case 'PUT /api/telegram/token': {
        const p = TelegramTokenRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request', 'not a bot token');
        // Like the core: the token taken out of what was pasted.
        const pasted = extractTelegramToken(p.data.token);
        if (!pasted) return fail(400, 'invalid_token', telegramTokenShapeMessage());
        p.data.token = pasted;
        if (p.data.token.includes('000000')) {
          return fail(400, 'invalid_token', unknownToken());
        }
        if ([...this.bots.values()].some((b) => b.token === p.data.token)) {
          return fail(
            409,
            'bot_in_use',
            tr(
              'This token belongs to a bot dedicated to a monster: create another one for the main bot.',
              'Questo token è di un bot dedicato a un mostro: per il bot principale creane un altro.',
            ),
          );
        }
        this.token = p.data.token;
        this.onlineAt = Date.now() + 1200;
        this.event({ channel: 'telegram', action: 'token_set', name: `@${BOT.username}` });
        this.event({ channel: 'telegram', action: 'connected', name: `@${BOT.username}` });
        return ok(this.view());
      }
      case 'DELETE /api/telegram/token':
        if (this.token) this.event({ channel: 'telegram', action: 'token_removed' });
        this.token = null;
        this.pairing = null;
        return ok(this.view());
      case 'POST /api/telegram/pairing': {
        if (!this.token) {
          return fail(
            409,
            'no_token',
            tr('Connect the bot with its code first.', 'Collega prima il bot con il suo codice.'),
          );
        }
        let code = '';
        for (let i = 0; i < 8; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
        this.pairing = { code, expiresAt: Date.now() + 10 * 60_000, attemptsLeft: 5 };
        this.event({ channel: 'telegram', action: 'pairing_started' });
        if (this.timer) clearTimeout(this.timer);
        // Giulio sends `/start <code>` from his phone.
        this.timer = setTimeout(() => {
          if (!this.pairing || this.pairing.code !== code) return;
          this.pairing = null;
          if (!this.users.some((u) => u.id === 1001)) {
            this.users = [
              ...this.users,
              { id: 1001, name: 'Giulio', username: 'giulio', addedAt: Date.now() },
            ];
          }
          this.event({ channel: 'telegram', action: 'paired', userId: '1001', name: '@giulio' });
        }, this.pairDelayMs);
        return ok(
          {
            ...this.pairing,
            link: `https://t.me/${BOT.username}?start=${code}`,
          },
          201,
        );
      }
      case 'DELETE /api/telegram/pairing':
        this.pairing = null;
        return ok(this.view());
      case 'DELETE /api/telegram/users/:id': {
        const id = Number(path.split('/').at(-1));
        const user = this.users.find((u) => u.id === id);
        if (!user) {
          return fail(
            404,
            'not_found',
            tr(
              'This account isn’t among the connected ones.',
              'Questo account non è tra quelli collegati.',
            ),
          );
        }
        this.users = this.users.filter((u) => u.id !== id);
        this.event({
          channel: 'telegram',
          action: 'user_removed',
          userId: String(id),
          name: user.name,
        });
        return ok(this.view());
      }
      case 'PUT /api/telegram/prefs': {
        const p = TelegramPrefsUpdateSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
        this.prefs = {
          quietHours: { ...this.prefs.quietHours, ...p.data.quietHours },
          notify: { ...this.prefs.notify, ...p.data.notify },
        };
        return ok(this.view());
      }
      default:
        return fail(404, 'not_found');
    }
  }

  private checkAgent(agent: string): RawResponse | null {
    const a = this.agents().find((x) => x.id === agent);
    if (!a) {
      return fail(
        400,
        'invalid_agent',
        tr('There’s no monster with this name.', 'Non c’è nessun mostro con questo nome.'),
      );
    }
    if (a.isOrchestrator) {
      return fail(
        400,
        'invalid_agent',
        tr(
          `${a.name} already talks through the main bot: pick another monster.`,
          `${a.name} parla già con il bot principale: scegli un altro mostro.`,
        ),
      );
    }
    return null;
  }

  private handleBots(method: string, path: string, body: unknown): RawResponse {
    const parts = path.split('/').slice(4); // ['', 'api', 'telegram', 'bots', ...]
    if (parts.length === 0) {
      if (method !== 'POST') return fail(404, 'not_found');
      const p = TelegramBotCreateRequestSchema.safeParse(body);
      if (!p.success) return fail(400, 'invalid_request', 'not a bot token');
      // Like the core: the token taken out of what was pasted.
      const pasted = extractTelegramToken(p.data.token);
      if (!pasted) return fail(400, 'invalid_token', telegramTokenShapeMessage());
      p.data.token = pasted;
      if (p.data.token.includes('000000')) {
        return fail(400, 'invalid_token', unknownToken());
      }
      const id = p.data.token.split(':')[0]!;
      if (p.data.token === this.token) {
        return fail(
          409,
          'bot_in_use',
          tr(
            'This is the main bot’s token: for a monster, create a new bot with @BotFather.',
            'Questo è il token del bot principale: per un mostro crea un bot nuovo con @BotFather.',
          ),
        );
      }
      if (this.bots.has(id)) {
        return fail(
          409,
          'bot_in_use',
          tr(
            'This bot is already connected to a monster.',
            'Questo bot è già collegato a un mostro.',
          ),
        );
      }
      const wrong = this.checkAgent(p.data.agent);
      if (wrong) return wrong;
      const name = this.agents().find((a) => a.id === p.data.agent)!.name;
      const username = usernameFor(
        name,
        [...this.bots.values()].map((b) => b.bot.username),
      );
      const stored: StoredBot = {
        id,
        agent: p.data.agent,
        token: p.data.token,
        bot: { id: Number(id), username, name },
        ...(p.data.dailyLimit !== undefined ? { dailyLimit: p.data.dailyLimit } : {}),
        today: 0,
        chats: [],
        people: [],
        addedAt: Date.now(),
      };
      this.bots.set(id, stored);
      this.event({ channel: 'telegram', action: 'bot_added', bot: id, name: `@${username}` });
      this.event({ channel: 'telegram', action: 'connected', bot: id, name: `@${username}` });
      // Added to the group of Saturday, then Livio writes /join there.
      setTimeout(() => {
        if (this.bots.get(id) !== stored) return;
        stored.chats = [
          ...stored.chats,
          { ...MOCK_GROUP, type: 'supergroup', status: 'pending', addedAt: Date.now() },
        ];
        this.event({
          channel: 'telegram',
          action: 'chat_pending',
          bot: id,
          chatId: String(MOCK_GROUP.id),
          name: MOCK_GROUP.title,
        });
        stored.people = [
          ...stored.people,
          {
            id: MOCK_LIVIO.id,
            name: MOCK_LIVIO.name,
            username: MOCK_LIVIO.username,
            status: 'pending',
            owner: false,
            addedAt: Date.now(),
          },
        ];
        this.event({
          channel: 'telegram',
          action: 'person_pending',
          bot: id,
          userId: String(MOCK_LIVIO.id),
          name: `@${MOCK_LIVIO.username}`,
        });
      }, this.pairDelayMs);
      return ok(this.view(), 201);
    }
    const b = this.bots.get(decodeURIComponent(parts[0]!));
    if (!b) {
      return fail(404, 'not_found', tr('This bot is gone.', 'Questo bot non c’è più.'));
    }
    const rest = parts.slice(1);
    const route = `${method} ${rest
      .map((x, i) => (i === 1 && /^-?\d+$/.test(x) ? ':n' : x))
      .join('/')}`;
    const n = rest[1] !== undefined ? Number(rest[1]) : NaN;
    switch (route) {
      case 'PATCH ': {
        const p = TelegramBotUpdateRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
        if (p.data.agent !== undefined) {
          const wrong = this.checkAgent(p.data.agent);
          if (wrong) return wrong;
          b.agent = p.data.agent;
        }
        if (p.data.dailyLimit === null) delete b.dailyLimit;
        else if (p.data.dailyLimit !== undefined) b.dailyLimit = p.data.dailyLimit;
        if (p.data.fullTools !== undefined) b.fullTools = p.data.fullTools;
        this.event({ channel: 'telegram', action: 'bot_changed', bot: b.id });
        return ok(this.view());
      }
      case 'PUT token': {
        const p = TelegramTokenRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request', 'not a bot token');
        // Like the core: the token taken out of what was pasted.
        const pasted = extractTelegramToken(p.data.token);
        if (!pasted) return fail(400, 'invalid_token', telegramTokenShapeMessage());
        p.data.token = pasted;
        if (p.data.token.includes('000000')) {
          return fail(400, 'invalid_token', unknownToken());
        }
        if (p.data.token.split(':')[0] !== b.id) {
          return fail(
            409,
            'other_bot',
            tr(
              `This token belongs to another bot: you need the one for @${b.bot.username}.`,
              `Questo token è di un altro bot: serve quello di @${b.bot.username}.`,
            ),
          );
        }
        b.token = p.data.token;
        this.event({
          channel: 'telegram',
          action: 'bot_changed',
          bot: b.id,
          name: `@${b.bot.username}`,
        });
        return ok(this.view());
      }
      case 'DELETE ':
        this.bots.delete(b.id);
        this.event({
          channel: 'telegram',
          action: 'bot_removed',
          bot: b.id,
          name: `@${b.bot.username}`,
        });
        return ok(this.view());
      case 'POST chats/:n/approve': {
        const chat = b.chats.find((c) => c.id === n);
        if (!chat) return fail(404, 'not_found', groupGone());
        b.chats = b.chats.map((c) => (c.id === n ? { ...c, status: 'approved' } : c));
        this.event({
          channel: 'telegram',
          action: 'chat_approved',
          bot: b.id,
          chatId: String(n),
          name: chat.title,
        });
        return ok(this.view());
      }
      case 'DELETE chats/:n': {
        const chat = b.chats.find((c) => c.id === n);
        if (!chat) return fail(404, 'not_found', groupGone());
        b.chats = b.chats.filter((c) => c.id !== n);
        this.event({
          channel: 'telegram',
          action: 'chat_removed',
          bot: b.id,
          chatId: String(n),
          name: chat.title,
        });
        return ok(this.view());
      }
      case 'POST people': {
        const p = TelegramBotPersonRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
        if (!this.users.some((u) => u.id === p.data.id)) {
          const name = p.data.name ?? `Account ${p.data.id}`;
          b.people = [
            ...b.people.filter((x) => x.id !== p.data.id),
            { id: p.data.id, name, status: 'approved', owner: false, addedAt: Date.now() },
          ];
          this.event({
            channel: 'telegram',
            action: 'person_approved',
            bot: b.id,
            userId: String(p.data.id),
            name,
          });
        }
        return ok(this.view());
      }
      case 'POST people/:n/approve': {
        const person = b.people.find((x) => x.id === n);
        if (!person) return fail(404, 'not_found', personGone());
        b.people = b.people.map((x) => (x.id === n ? { ...x, status: 'approved' } : x));
        this.event({
          channel: 'telegram',
          action: 'person_approved',
          bot: b.id,
          userId: String(n),
          name: person.name,
        });
        return ok(this.view());
      }
      case 'DELETE people/:n': {
        if (this.users.some((u) => u.id === n)) {
          return fail(
            409,
            'owner',
            tr(
              'Your account always stays: it’s the one that approves.',
              'Il tuo account resta sempre: è quello che approva.',
            ),
          );
        }
        const person = b.people.find((x) => x.id === n);
        if (!person) return fail(404, 'not_found', personGone());
        b.people = b.people.filter((x) => x.id !== n);
        this.event({
          channel: 'telegram',
          action: 'person_removed',
          bot: b.id,
          userId: String(n),
          name: person.name,
        });
        return ok(this.view());
      }
      default:
        return fail(404, 'not_found');
    }
  }
}

const unknownToken = () =>
  tr('Telegram doesn’t recognize this token.', 'Telegram non riconosce questo token.');
const groupGone = () => tr('This group is gone.', 'Questo gruppo non c’è più.');
const personGone = () => tr('This person is gone.', 'Questa persona non c’è più.');

/** "@CalypsoSaturdayBot": the monster's name, letters and digits only, unique. */
function usernameFor(name: string, taken: readonly string[] = []): string {
  const base = `${name.normalize('NFKD').replace(/[^A-Za-z0-9]/g, '') || 'Monster'}SaturdayBot`;
  let out = base;
  for (let i = 2; taken.includes(out); i++) out = base.replace(/Bot$/, `${i}Bot`);
  return out;
}
