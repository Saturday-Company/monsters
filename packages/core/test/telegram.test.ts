import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fake, type FakeScript } from '@monsters/providers/testing';
import {
  setAppLang,
  type LogEvent,
  type TelegramPairing,
  type TelegramView,
} from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DecisionGate,
  EventLog,
  inQuietHours,
  msUntilQuietEnds,
  clip,
  openDb,
  Pairing,
  PAIRING_MAX_TOTAL_ATTEMPTS,
  StateStore,
  TelegramChannel,
  TelegramUsers,
  splitMarkdown,
  toTelegramHtml,
  migrate,
  coreMigrations,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { deferred, never, startTestHub, type TestHub } from './hub-helpers.ts';
import {
  FAKE_BOT,
  FAKE_TOKEN,
  FakeTelegram,
  type FakeUser,
  type SentMessage,
} from './telegram-fake.ts';

const GIULIO: FakeUser = { id: 1001, first_name: 'Giulio', username: 'giulio' };
const STRANGER: FakeUser = { id: 6666, first_name: 'Mallory', username: 'mallory' };
const ANNA: FakeUser = { id: 2002, first_name: 'Anna', username: 'anna' };

const fakes: FakeTelegram[] = [];
afterEach(async () => {
  setAppLang('en');
  for (const f of fakes.splice(0)) await f.close();
});

const isChannel =
  (action: string, extra: (e: LogEvent<'channel'>) => boolean = () => true) =>
  (e: LogEvent): e is LogEvent<'channel'> =>
    e.type === 'channel' && e.data.action === action && extra(e);

interface Bot {
  t: TestHub;
  tg: FakeTelegram;
  clock: { now: number };
}

/** A hub with the default team on the fake provider and a bot on the fake Telegram. */
async function startBot(
  scripts: Record<string, FakeScript> = {},
  options: {
    pair?: boolean;
    pollTimeoutS?: number;
    home?: string;
    tg?: FakeTelegram;
    telegram?: { sendGiveUpMs?: number; sendQueueMax?: number; typingIntervalMs?: number };
  } = {},
): Promise<Bot> {
  const tg = options.tg ?? (await new FakeTelegram().start());
  if (!options.tg) fakes.push(tg);
  const clock = { now: Date.now() };
  const t = await startTestHub(scripts, {
    ...(options.home ? { home: options.home } : {}),
    hub: {
      telegram: {
        apiRoot: tg.url,
        pollTimeoutS: options.pollTimeoutS ?? 1,
        retryBaseMs: 20,
        retryMaxMs: 80,
        chatGapMs: { private: 0, group: 0 },
        now: () => clock.now,
        ...options.telegram,
      },
    },
  });
  if (!options.home) {
    const view = await t.json<TelegramView>('PUT', '/api/telegram/token', { token: FAKE_TOKEN });
    expect(view.bot?.username).toBe('monsters_test_bot');
  }
  await t.waitEvent(isChannel('connected'));
  if (options.pair !== false) await pair(t, tg, GIULIO);
  return { t, tg, clock };
}

async function pair(t: TestHub, tg: FakeTelegram, user: FakeUser): Promise<void> {
  const code = await t.json<TelegramPairing>('POST', '/api/telegram/pairing');
  await pairWith(tg, user, code.code);
}

async function pairWith(tg: FakeTelegram, user: FakeUser, code: string): Promise<void> {
  tg.text(user, `/start ${code}`);
  await tg.waitMessage((m) => m.chat_id === user.id && m.text.includes('you can now command'));
}

describe('telegram: token and connection', () => {
  it('verifies the token with getMe, keeps it in a 600 file, never in the log or an answer', async () => {
    const tg = await new FakeTelegram().start();
    fakes.push(tg);
    const t = await startTestHub({}, { hub: { telegram: { apiRoot: tg.url, pollTimeoutS: 1 } } });
    const off = await t.json<TelegramView>('GET', '/api/telegram');
    expect(off).toMatchObject({ token: { set: false }, status: 'off', users: [] });

    const bad = await t.api('PUT', '/api/telegram/token', {
      token: '999999:AAwrongwrongwrongwrongwrongwrongwrong',
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('invalid_token');
    const malformed = await t.api('PUT', '/api/telegram/token', { token: 'ciao' });
    expect(malformed.status).toBe(400);

    const res = await t.api('PUT', '/api/telegram/token', { token: FAKE_TOKEN });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(FAKE_TOKEN);
    await t.waitEvent(isChannel('connected'));
    const view = await t.json<TelegramView>('GET', '/api/telegram');
    expect(view).toMatchObject({ token: { set: true, source: 'file' }, status: 'online' });
    expect(JSON.stringify(view)).not.toContain(FAKE_TOKEN.split(':')[1]);
    if (process.platform !== 'win32') {
      expect(statSync(join(t.home, 'secrets', 'telegram.key')).mode & 0o777).toBe(0o600);
    }

    // A network error on the way: its text reaches the log, the token does not.
    tg.failGetUpdates(1, 'drop');
    await t.waitEvent(isChannel('disconnected'));
    await t.waitEvent(
      isChannel('connected', (e) => e.id > t.events().find(isChannel('disconnected'))!.id),
    );
    const everything = JSON.stringify(t.core.log.query({ limit: 1000 }));
    expect(everything).not.toContain(FAKE_TOKEN);
    expect(everything).not.toContain(FAKE_TOKEN.split(':')[1]);

    // Removed: the bot stops, the file is gone.
    const removed = await t.json<TelegramView>('DELETE', '/api/telegram/token');
    expect(removed).toMatchObject({ token: { set: false }, status: 'off' });
  });

  it('takes the token out of BotFather’s whole message; without one, says what a token is', async () => {
    const tg = await new FakeTelegram().start();
    fakes.push(tg);
    const t = await startTestHub({}, { hub: { telegram: { apiRoot: tg.url, pollTimeoutS: 1 } } });
    const none = await t.api('PUT', '/api/telegram/token', {
      token: 'Use this token to access the HTTP API:\n123:short\nKeep your token secure',
    });
    expect(none.status).toBe(400);
    const shape = (await none.json()) as { error: string; message: string };
    expect(shape.error).toBe('invalid_token');
    expect(shape.message).toContain('Questo non sembra un token di Telegram');
    expect(tg.calls.some((c) => c.method === 'getMe')).toBe(false);

    const view = await t.json<TelegramView>('PUT', '/api/telegram/token', {
      token: `Done! Congratulations on your new bot.\nUse this token to access the HTTP API:\n${FAKE_TOKEN}\nKeep your token secure and store it safely.`,
    });
    expect(view.bot?.username).toBe(FAKE_BOT.username);
    await tg.waitCall((c) => c.method === 'getUpdates' && c.token === FAKE_TOKEN);
  });

  it('Telegram out of reach: the real cause in words, and in the log without the token', async () => {
    // A port nobody listens on: the connection is refused.
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((r) => closed.close(r));
    const t = await startTestHub(
      {},
      { hub: { telegram: { apiRoot: `http://127.0.0.1:${port}`, pollTimeoutS: 1 } } },
    );
    const res = await t.api('PUT', '/api/telegram/token', { token: FAKE_TOKEN });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('verification_failed');
    expect(body.message).toBe(
      `La connessione a 127.0.0.1:${port} è stata rifiutata o interrotta. Se sei in VPN o dietro un proxy aziendale, prova senza o chiedi di consentire 127.0.0.1:${port}.`,
    );
    const logged = t.events().find(isChannel('token_check_failed'));
    expect(logged?.data).toMatchObject({ reason: 'refused' });
    expect(logged?.data.message).toContain('ECONNREFUSED');
    const everything = JSON.stringify(t.core.log.query({ limit: 1000 }));
    expect(everything).not.toContain(FAKE_TOKEN.split(':')[1]);
  });

  it('reconnects with backoff after network errors and keeps working', async () => {
    const { t, tg } = await startBot({ titan: [fake.text('Ci sono.')] });
    tg.failGetUpdates(3, 'error500');
    await t.waitEvent(isChannel('disconnected'));
    const down = t.events().filter(isChannel('disconnected'));
    // One event per outage, not one per failed attempt.
    expect(down).toHaveLength(1);
    const back = await t.waitEvent(isChannel('connected', (e) => e.id > down[0]!.id));
    expect(back).toBeDefined();
    tg.text(GIULIO, 'ci sei?');
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text.includes('Ci sono.'));
  });

  it('stops cleanly with the core, confirming what it handled', async () => {
    const tg = await new FakeTelegram().start();
    fakes.push(tg);
    const first = await startBot({ titan: [fake.text('Uno.')] }, { tg, pollTimeoutS: 30 });
    tg.text(GIULIO, 'primo');
    await tg.waitMessage((m) => m.text.includes('Uno.'));
    // A long poll is pending: closing does not wait for its 30 s.
    while (tg.polling === 0) await new Promise((r) => setTimeout(r, 10));
    const telegram = first.t.core.hub.telegram;
    const stop = telegram.stop.bind(telegram);
    let stoppedAt = 0;
    telegram.stop = async () => {
      await stop();
      stoppedAt = Date.now();
    };
    const started = Date.now();
    await first.t.core.close();
    // The bot is off in less than 2 s from the start of the shutdown. The rest
    // of the close (git, database) only has to stay far from the 30 s poll:
    // on a busy Windows runner it alone took seconds.
    expect(stoppedAt).toBeGreaterThan(0);
    expect(stoppedAt - started).toBeLessThan(2000);
    expect(Date.now() - started).toBeLessThan(15_000);
    const handled = tg.offsets.at(-1)!;

    // Same data folder: the bot starts from the saved token and the next offset.
    const again = await startBot(
      { titan: [fake.text('Due.')] },
      { tg, home: first.t.home, pair: false },
    );
    expect(tg.offsets.at(-1)).toBeGreaterThanOrEqual(handled);
    tg.text(GIULIO, 'secondo');
    await tg.waitMessage((m) => m.text.includes('Due.'));
    // "primo" was not handled twice.
    expect(tg.messages.filter((m) => m.text.includes('Uno.'))).toHaveLength(1);
    expect(again.t.provider.calls).toHaveLength(1);
  });
});

describe('telegram: pairing and whitelist', () => {
  it('pairs with the right code, refuses a wrong, expired or exhausted one', async () => {
    const { t, tg, clock } = await startBot({}, { pair: false });
    // Failures of one account are logged once every 10 s.
    const tick = () => (clock.now += 11_000);

    // No code yet: logged, never answered.
    tg.text(GIULIO, '/start ABCDEFGH');
    await t.waitEvent(isChannel('pairing_failed', (e) => e.data.reason === 'no_code'));

    // Wrong code, then the right one.
    let code = await t.json<TelegramPairing>('POST', '/api/telegram/pairing');
    expect(code.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(code.link).toBe(`https://t.me/monsters_test_bot?start=${code.code}`);
    tick();
    tg.text(GIULIO, '/start ZZZZZZZZ');
    await t.waitEvent(isChannel('pairing_failed', (e) => e.data.reason === 'wrong_code'));
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text === 'That code isn’t valid.');
    expect(tg.sentTo(GIULIO.id)).toHaveLength(1);
    expect((await t.json<TelegramView>('GET', '/api/telegram')).pairing?.attemptsLeft).toBe(
      PAIRING_MAX_TOTAL_ATTEMPTS - 1,
    );
    tg.text(GIULIO, `/start ${code.code.toLowerCase()}`);
    await t.waitEvent(isChannel('paired', (e) => e.data.userId === String(GIULIO.id)));
    let view = await t.json<TelegramView>('GET', '/api/telegram');
    expect(view.users).toMatchObject([{ id: GIULIO.id, name: 'Giulio', username: 'giulio' }]);
    expect(view.pairing).toBeNull();
    // The code is never in the log.
    expect(JSON.stringify(t.events())).not.toContain(code.code);

    // Used once: a second account cannot reuse it.
    tg.text(STRANGER, `/start ${code.code}`);
    await t.waitEvent(
      isChannel(
        'pairing_failed',
        (e) => e.data.userId === String(STRANGER.id) && e.data.reason === 'no_code',
      ),
    );

    // Expired.
    code = await t.json<TelegramPairing>('POST', '/api/telegram/pairing');
    clock.now += 11 * 60_000;
    tg.text(STRANGER, `/start ${code.code}`);
    await t.waitEvent(isChannel('pairing_failed', (e) => e.data.reason === 'expired'));

    // Too many attempts: this account is locked out, even with the right code,
    // but the code still works for the others.
    code = await t.json<TelegramPairing>('POST', '/api/telegram/pairing');
    tick();
    for (let i = 0; i < 5; i++) tg.text(STRANGER, `/start WRONG00${i}`);
    tg.text(GIULIO, '/help');
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text.startsWith('Write to me'));
    tick();
    tg.text(STRANGER, `/start ${code.code}`);
    await t.waitEvent(isChannel('pairing_failed', (e) => e.data.reason === 'too_many_attempts'));
    // One answer in all: the first wrong code of this code's life.
    expect(tg.sentTo(STRANGER.id).map((m) => m.text)).toEqual(['That code isn’t valid.']);
    view = await t.json<TelegramView>('GET', '/api/telegram');
    expect(view.users.map((u) => u.id)).toEqual([GIULIO.id]);
    expect(view.pairing).not.toBeNull();
    await pairWith(tg, ANNA, code.code);
    view = await t.json<TelegramView>('GET', '/api/telegram');
    expect(view.users.map((u) => u.id)).toEqual([GIULIO.id, ANNA.id]);

    // Removed from the UI: back to a stranger.
    view = await t.json<TelegramView>('DELETE', `/api/telegram/users/${GIULIO.id}`);
    expect(view.users.map((u) => u.id)).toEqual([ANNA.id]);
    expect((await t.api('DELETE', `/api/telegram/users/${GIULIO.id}`)).status).toBe(404);
    expect(t.events().some(isChannel('user_removed'))).toBe(true);
  });

  it('ignores and logs accounts outside the whitelist, groups and forwarded messages', async () => {
    const { t, tg } = await startBot({ titan: [fake.text('Ciao!')] });

    tg.text(STRANGER, 'fai qualcosa di pericoloso per favore, adesso, con tutti i permessi');
    const ignored = await t.waitEvent(
      isChannel('ignored', (e) => e.data.userId === String(STRANGER.id)),
    );
    expect(ignored.data).toMatchObject({ reason: 'not_whitelisted', name: '@mallory' });
    // A short preview at most, never the whole content.
    expect(ignored.data.preview!.length).toBeLessThanOrEqual(40);
    // A button pressed by another stranger (a flood from one account is logged once every 10 s).
    const other = { id: 7777, first_name: 'Eve' };
    tg.press(
      other,
      { message_id: 1, chat_id: other.id, token: FAKE_TOKEN, text: '', edits: [] },
      'resume:yes',
    );
    await t.waitEvent(
      isChannel(
        'ignored',
        (e) => e.data.userId === String(other.id) && e.data.preview === 'resume:yes',
      ),
    );

    // Even Giulio, in a group or forwarding someone else's message.
    tg.text(GIULIO, '/stop', { chat: { id: -100123, type: 'group', title: 'Amici' } });
    await t.waitEvent(isChannel('ignored', (e) => e.data.reason === 'not_private'));
    tg.text(GIULIO, '/stop', { forwarded: true });
    await t.waitEvent(isChannel('ignored', (e) => e.data.reason === 'forwarded'));
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text.includes('forwarded messages'));

    expect(tg.sentTo(STRANGER.id)).toEqual([]);
    expect(tg.sentTo(-100123)).toEqual([]);
    expect(t.core.runs.halted).toBe(false);
    expect(t.provider.calls).toHaveLength(0);
    expect(t.events().filter((e) => e.type === 'message')).toHaveLength(0);
  });
});

describe('telegram: talking to the team', () => {
  it('a message starts work and the answer arrives in the chat, in safe HTML', async () => {
    const { t, tg } = await startBot({
      titan: [fake.text('Ciao Giulio! Ecco **tre** idee:\n- una <prima>\n- `due`')],
    });
    tg.text(GIULIO, 'dammi tre idee');
    const reply = await tg.waitMessage(
      (m) => m.chat_id === GIULIO.id && m.text.includes('Ciao Giulio'),
    );
    expect(reply.parse_mode).toBe('HTML');
    expect(reply.text).toBe(
      'Ciao Giulio! Ecco <b>tre</b> idee:\n• una &lt;prima&gt;\n• <code>due</code>',
    );
    const msg = t
      .events()
      .find((e): e is LogEvent<'message'> => e.type === 'message' && e.data.role === 'user');
    expect(msg?.data).toMatchObject({ text: 'dammi tre idee', channel: 'telegram', to: 'titan' });
    await t.runEnded(msg!.runId!);
    expect(tg.calls.some((c) => c.method === 'sendChatAction')).toBe(true);
  });

  it('long answers are split under the Telegram limit', async () => {
    const long = Array.from(
      { length: 300 },
      (_, i) => `Riga ${i} con un po' di testo per allungare.`,
    ).join('\n');
    const { tg } = await startBot({ titan: [fake.text(long)] });
    tg.text(GIULIO, 'scrivi tanto');
    await tg.waitMessage((m) => m.text.includes('Riga 299'));
    const parts = tg.sentTo(GIULIO.id).filter((m) => m.text.includes('Riga'));
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.text.length).toBeLessThanOrEqual(4096);
  });

  it('a question with buttons: the answer is recorded and the message updated', async () => {
    const { t, tg } = await startBot({
      titan: [
        fake.toolCall('ask_user', {
          question: 'Quale tono per il post?',
          options: [
            { label: 'Ironico', description: 'battute leggere' },
            { label: 'Serio', description: 'solo fatti' },
          ],
          recommended: 'Serio',
        }),
        fake.text('Va bene, tono ironico.'),
      ],
    });
    tg.text(GIULIO, 'scrivi un post');
    const question = await tg.waitMessage((m) => m.text.includes('Quale tono per il post?'));
    expect(question.text).toContain('<b>Ironico</b> · battute leggere');
    expect(question.text).toContain('<i>(recommended)</i>');
    const buttons = question.reply_markup!.inline_keyboard!.flat();
    expect(buttons.map((b) => b.text)).toEqual(['1. Ironico', '2. Serio']);

    tg.press(GIULIO, question, buttons[0]!.callback_data);
    const answer = await t.waitEvent(
      (e): e is LogEvent<'answer'> => e.type === 'answer' && e.data.channel === 'telegram',
    );
    expect(answer.data.optionId).toBe('1');
    await tg.waitMessage(
      (m) =>
        m.message_id === question.message_id &&
        m.text.includes('✅ Answer (from Telegram): Ironico'),
    );
    expect(question.reply_markup?.inline_keyboard).toEqual([]);
    await tg.waitMessage((m) => m.text.includes('Va bene, tono ironico.'));
    // A late press on the same question changes nothing.
    tg.press(GIULIO, question, buttons[1]!.callback_data);
    await tg.waitCall(
      (c) =>
        c.method === 'answerCallbackQuery' &&
        typeof c.payload['text'] === 'string' &&
        c.payload['text'].includes('no longer waiting'),
    );
  });

  it('a question answered in the UI updates Telegram; an open question takes a text reply', async () => {
    const { t, tg } = await startBot({
      titan: [
        fake.toolCall('ask_user', {
          question: 'Pubblico il post?',
          options: ['Sì', 'No'],
          recommended: 'No',
          kind: 'publish',
        }),
        fake.toolCall('ask_user', { question: 'Come si chiama tua sorella?', options: [] }),
        fake.text('Grazie, tutto chiaro.'),
      ],
    });
    tg.text(GIULIO, 'pubblica');
    const first = await tg.waitMessage((m) => m.text.includes('Pubblico il post?'));
    const open = await t.json<{ id: string }[]>('GET', '/api/questions?status=open');
    await t.json('POST', `/api/questions/${open[0]!.id}/answer`, { optionId: '2' });
    await tg.waitMessage(
      (m) => m.message_id === first.message_id && m.text.includes('✅ Answer (from the app): No'),
    );

    const second = await tg.waitMessage((m) => m.text.includes('Come si chiama tua sorella?'));
    expect(second.reply_markup).toMatchObject({ force_reply: true });
    tg.text(GIULIO, 'Marta', { replyTo: second.message_id });
    const answer = await t.waitEvent(
      (e): e is LogEvent<'answer'> => e.type === 'answer' && e.data.text === 'Marta',
    );
    expect(answer.data.channel).toBe('telegram');
    await tg.waitMessage((m) => m.text.includes('Grazie, tutto chiaro.'));
  });

  it('/stop stops a running job in less than 2 s; /riprendi asks before resuming', async () => {
    const { t, tg } = await startBot({ titan: [fake.text('mai', { gate: never })] });
    tg.text(GIULIO, 'lavora a lungo');
    const run = await t.waitEvent(
      (e): e is LogEvent<'run'> => e.type === 'run' && e.data.status === 'started',
    );
    const sent = Date.now();
    tg.text(GIULIO, '/stop');
    const aborted = await t.waitEvent(
      (e): e is LogEvent<'run'> =>
        e.type === 'run' && e.runId === run.runId && e.data.status === 'aborted',
    );
    expect(aborted.ts - sent).toBeLessThan(2000);
    const kill = t.events().find((e): e is LogEvent<'kill'> => e.type === 'kill');
    expect(kill?.data).toMatchObject({ scope: 'global', by: 'telegram', runsAborted: 1 });
    await tg.waitMessage((m) => m.text.includes('Everything stopped. Work interrupted: 1'));
    expect(Date.now() - sent).toBeLessThan(2000);
    expect(t.core.runs.halted).toBe(true);

    tg.text(GIULIO, 'riparti');
    await tg.waitMessage((m) => m.text.includes('The monsters are stopped'));

    tg.text(GIULIO, '/status');
    await tg.waitMessage((m) => m.text.includes('<b>Stopped</b>'));

    tg.text(GIULIO, '/resume');
    const confirm = await tg.waitMessage((m) => m.text.includes('Start the monsters again?'));
    expect(t.core.runs.halted).toBe(true);
    tg.press(GIULIO, confirm, 'resume:yes');
    await tg.waitMessage((m) => m.message_id === confirm.message_id && m.text.includes('Back on'));
    expect(t.core.runs.halted).toBe(false);
    expect(t.events().find((e) => e.type === 'resume')?.data).toEqual({ by: 'telegram' });
  });

  it('/stato lists the projects with what their lead is doing (D-097)', async () => {
    const { t, tg } = await startBot({});
    await t.json('POST', '/api/projects', { name: 'Saturday', lead: { name: 'Leda' } });
    tg.text(GIULIO, '/status');
    const status = await tg.waitMessage((m) => m.text.includes('<b>Projects</b>'));
    expect(status.text).toContain('• Saturday — Leda is free');
  });

  it('/nuova starts a new conversation, also with one agent', async () => {
    const { t, tg } = await startBot({});
    tg.text(GIULIO, '/new');
    await tg.waitMessage((m) => m.text.startsWith('New conversation:'));
    tg.text(GIULIO, '/new @Rhea');
    await tg.waitMessage((m) => m.text.startsWith('New conversation with Rhea'));
    tg.text(GIULIO, '/new @Nessuno');
    await tg.waitMessage((m) => m.text.includes('no monster with that name'));
    const fresh = t
      .events()
      .filter((e): e is LogEvent<'new_conversation'> => e.type === 'new_conversation');
    expect(fresh.map((e) => e.data)).toEqual([
      { channel: 'telegram' },
      { to: 'rhea', channel: 'telegram' },
    ]);
  });
});

describe('telegram: notifications (DecisionGate, use 3)', () => {
  it('work started elsewhere: done now, or after the quiet hours', async () => {
    const { t, tg, clock } = await startBot(
      { titan: [fake.text('Fatto dal browser.'), fake.text('Fatto di notte.')] },
      {},
    );
    // Giulio wrote to pair a moment ago: make him "away".
    clock.now += 60 * 60_000;
    const first = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'dal browser' });
    await t.runEnded(first.runId);
    const done = await tg.waitMessage((m) => m.text.includes('Titan is done.'));
    expect(done.text).toContain('Fatto dal browser.');
    const decision = t
      .events()
      .find((e): e is LogEvent<'decision'> => e.type === 'decision' && e.data.kind === 'notify');
    expect(decision?.data).toMatchObject({ choice: 'now', decidedBy: 'rules' });

    // Quiet hours around "now": the notification waits.
    const at = new Date(clock.now);
    const hh = (h: number) => `${String((h + 24) % 24).padStart(2, '0')}:00`;
    await t.json('PUT', '/api/telegram/prefs', {
      quietHours: { enabled: true, from: hh(at.getHours() - 1), to: hh(at.getHours() + 2) },
    });
    const second = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'di notte' });
    await t.runEnded(second.runId);
    const later = await t.waitEvent(
      (e): e is LogEvent<'decision'> =>
        e.type === 'decision' && e.data.kind === 'notify' && e.data.choice === 'later',
    );
    expect(later.data.reason).toContain('silenzio');
    expect(tg.messages.some((m) => m.text.includes('Fatto di notte.'))).toBe(false);
    // Quiet hours turned off: what waited leaves.
    await t.json('PUT', '/api/telegram/prefs', { quietHours: { enabled: false } });
    await tg.waitMessage((m) => m.text.includes('Fatto di notte.'));
    const view = await t.json<TelegramView>('GET', '/api/telegram');
    expect(view.prefs.quietHours.enabled).toBe(false);
  });

  it('notification rules: off, active user, quiet hours', () => {
    const db = openDb(':memory:');
    migrate(db, 'core', coreMigrations);
    const gate = new DecisionGate({ log: new EventLog(db) });
    const night = new Date(2026, 9, 14, 23, 30);
    const base = {
      agent: 'titan',
      userActive: false,
      enabled: true,
      quietHours: { enabled: true, from: '22:00', to: '08:00' },
      at: night,
    };
    expect(gate.notify({ ...base, kind: 'done', enabled: false }).when).toBe('never');
    expect(gate.notify({ ...base, kind: 'done', userActive: true }).when).toBe('now');
    expect(gate.notify({ ...base, kind: 'done' }).when).toBe('later');
    expect(gate.notify({ ...base, kind: 'question', blocking: true }).when).toBe('silent');
    expect(gate.notify({ ...base, kind: 'error', at: new Date(2026, 9, 14, 12, 0) }).when).toBe(
      'now',
    );
    expect(inQuietHours({ from: '22:00', to: '08:00' }, new Date(2026, 9, 14, 7, 59))).toBe(true);
    expect(inQuietHours({ from: '22:00', to: '08:00' }, new Date(2026, 9, 14, 8, 0))).toBe(false);
    expect(inQuietHours({ from: '13:00', to: '15:00' }, new Date(2026, 9, 14, 14, 0))).toBe(true);
    expect(msUntilQuietEnds({ from: '22:00', to: '08:00' }, night)).toBe(8.5 * 3600_000);
    db.close();
  });
});

describe('telegram: formatting and pairing codes', () => {
  it('turns Markdown into safe Telegram HTML', () => {
    expect(
      toTelegramHtml(
        '# Titolo\nTesto con <tag> & **grassetto** e [link](https://x.it/a?b=1&c="2")',
      ),
    ).toBe(
      '<b>Titolo</b>\nTesto con &lt;tag&gt; &amp; <b>grassetto</b> e <a href="https://x.it/a?b=1&amp;c=&quot;2&quot;">link</a>',
    );
    expect(toTelegramHtml('[no](javascript:alert(1))')).toBe('[no](javascript:alert(1))');
    expect(toTelegramHtml('```ts\nconst a = 1 < 2;\n```')).toBe(
      '<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>',
    );
    expect(toTelegramHtml('snake_case_name e `**non** grassetto`')).toBe(
      'snake_case_name e <code>**non** grassetto</code>',
    );
  });

  it('splits long text on lines and reopens a code block cut in two', () => {
    const code = ['```js', ...Array.from({ length: 50 }, (_, i) => `line(${i});`), '```'].join(
      '\n',
    );
    const parts = splitMarkdown(`Intro\n${code}\nFine`, 200);
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(200);
      expect((p.match(/```/g) ?? []).length % 2).toBe(0);
    }
    expect(parts.join('\n')).toContain('line(49);');
    expect(splitMarkdown('x'.repeat(450), 200).every((p) => p.length <= 200)).toBe(true);
  });

  it('pairing codes: once, short-lived, few attempts', () => {
    let now = 0;
    const p = new Pairing({ now: () => now, ttlMs: 1000, maxAttempts: 2, maxTotalAttempts: 3 });
    expect(p.attempt('X', 1)).toBe('no_code');
    const { code } = p.create();
    expect(p.attempt('nope', 1)).toBe('wrong_code');
    expect(p.failures(1)).toBe(1);
    expect(p.attempt(code, 1)).toBe('ok');
    expect(p.attempt(code, 1)).toBe('no_code');
    p.create();
    now = 1000;
    expect(p.view()).toBeNull();
    // Attempts are per account: a stranger is locked out, the code lives on.
    const again = p.create();
    expect(p.attempt('a', 6)).toBe('wrong_code');
    expect(p.attempt('b', 6)).toBe('too_many_attempts');
    expect(p.attempt(again.code, 6)).toBe('too_many_attempts');
    expect(p.view()?.attemptsLeft).toBe(1);
    expect(p.attempt(again.code, 1)).toBe('ok');
    // Only a crowd of accounts burns it.
    const third = p.create();
    expect(p.attempt('a', 7)).toBe('wrong_code');
    expect(p.attempt('b', 8)).toBe('wrong_code');
    expect(p.attempt('c', 9)).toBe('too_many_attempts');
    expect(p.attempt(third.code, 1)).toBe('no_code');
  });
});

const isError =
  (code: string) =>
  (e: LogEvent): e is LogEvent<'error'> =>
    e.type === 'error' && e.data.code === code;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Quiet hours around the clock's "now". */
const quietNow = (clock: { now: number }) => {
  const at = new Date(clock.now);
  const hh = (h: number) => `${String((h + 24) % 24).padStart(2, '0')}:00`;
  return { enabled: true, from: hh(at.getHours() - 1), to: hh(at.getHours() + 2) };
};

describe('telegram: delivery', () => {
  it('a system reminder (D-025) never reaches the chat; the answer arrives once', async () => {
    const { t, tg } = await startBot({
      titan: [fake.text('Ho finito la bozza. Vuoi che la pubblichi?'), fake.text('ok')],
    });
    tg.text(GIULIO, 'scrivi la bozza');
    const run = await t.waitEvent(
      (e): e is LogEvent<'run'> => e.type === 'run' && e.data.status === 'started',
    );
    await t.runEnded(run.runId!);
    await tg.waitMessage((m) => m.text.includes('Vuoi che la pubblichi?'));
    const reminder = t
      .events()
      .find((e): e is LogEvent<'message'> => e.type === 'message' && e.data.role === 'system');
    expect(reminder).toBeDefined();
    await pause(100);
    const texts = tg.sentTo(GIULIO.id).map((m) => m.text);
    expect(texts.filter((x) => x.includes('Vuoi che la pubblichi?'))).toHaveLength(1);
    expect(texts.some((x) => x.includes(reminder!.data.text.slice(0, 30)))).toBe(false);
  });

  it('messages are sent again, in order, when the network or Telegram fail', async () => {
    const { t, tg } = await startBot({});
    tg.failSends(2, 'drop');
    tg.failSends(2, 'error500');
    tg.text(GIULIO, '/status');
    tg.text(GIULIO, '/help');
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text.startsWith('Write to me'));
    const texts = tg.sentTo(GIULIO.id).map((m) => m.text);
    // Pairing reply, then /status, then /help: nothing lost, nothing reordered.
    expect(texts).toHaveLength(3);
    expect(texts[1]).toContain('<b>Running.</b>');
    expect(texts[2]).toMatch(/^Write to me/);
    expect(t.events().some(isError('telegram_send_failed'))).toBe(false);
  });

  it('gives up after a while, with a bounded queue, and logs it', async () => {
    const { t, tg } = await startBot({}, { telegram: { sendGiveUpMs: 300, sendQueueMax: 2 } });
    tg.failSends(10_000, 'error500');
    for (let i = 0; i < 4; i++) tg.text(GIULIO, '/status');
    const full = await t.waitEvent(isError('telegram_send_failed'));
    expect(full.data.message).toContain('too many messages waiting');
    await t.waitEvent(
      (e): e is LogEvent<'error'> =>
        isError('telegram_send_failed')(e) && e.data.message.includes('500'),
    );
    tg.failSends(0);
    tg.text(GIULIO, '/help');
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text.startsWith('Write to me'));
  });

  it('no "typing…" while a blocking question waits for the answer', async () => {
    const { t, tg } = await startBot(
      {
        titan: [
          fake.toolCall('ask_user', { question: 'Quale tono?', options: ['Ironico', 'Serio'] }),
          fake.text('Va bene.', { delayMs: 200 }),
        ],
      },
      { telegram: { typingIntervalMs: 20 } },
    );
    tg.text(GIULIO, 'scrivi un post');
    const question = await tg.waitMessage((m) => m.text.includes('Quale tono?'));
    const asked = Date.now();
    await pause(300);
    const typing = (after: number) =>
      tg.calls.filter((c) => c.method === 'sendChatAction' && c.at > after);
    expect(typing(asked + 60)).toEqual([]);
    const pressed = Date.now();
    tg.press(GIULIO, question, question.reply_markup!.inline_keyboard![0]![0]!.callback_data);
    await t.waitEvent((e): e is LogEvent<'answer'> => e.type === 'answer');
    // The work goes on: typing again.
    await tg.waitCall((c) => c.method === 'sendChatAction' && c.at >= pressed);
    await tg.waitMessage((m) => m.text.includes('Va bene.'));
  });

  it('the spending cap reaches the phone: the 80% warning and the stop (D-070)', async () => {
    const { t, tg } = await startBot({});
    const spend = (costUsd: number) =>
      t.core.log.append({
        agent: 'titan',
        type: 'provider_usage',
        data: { provider: 'fake', model: 'titan', costUsd },
      });
    spend(10); // 8,60 € of 10 €
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text.includes('è l’86% del tetto'));
    spend(2);
    const stop = await tg.waitMessage(
      (m) => m.chat_id === GIULIO.id && m.text.includes('Raggiunto il tetto della squadra di oggi'),
    );
    expect(stop.text).toContain('Impostazioni → Modelli → Tetto di spesa');
  });

  it('a service whose sign-in died reaches the phone (connettori 1)', async () => {
    const { t, tg } = await startBot({});
    t.core.log.append({
      agent: 'system',
      type: 'mcp_server',
      data: {
        server: 'notion',
        action: 'needs_signin',
        transport: 'http',
        message:
          'Notion chiede di nuovo l’accesso: premi «Collega» in Impostazioni → Collegamenti.',
      },
    });
    const told = await tg.waitMessage(
      (m) => m.chat_id === GIULIO.id && m.text.includes('Notion chiede di nuovo l’accesso'),
    );
    expect(told.text).toContain('Impostazioni → Collegamenti');
  });

  it('notifications held by the quiet hours survive a restart', async () => {
    const tg = await new FakeTelegram().start();
    fakes.push(tg);
    const first = await startBot({ titan: [fake.text('Fatto di notte.')] }, { tg });
    first.clock.now += 60 * 60_000;
    await first.t.json('PUT', '/api/telegram/prefs', { quietHours: quietNow(first.clock) });
    const sent = await first.t.json<{ runId: string }>('POST', '/api/messages', { text: 'notte' });
    await first.t.runEnded(sent.runId);
    await first.t.waitEvent(
      (e): e is LogEvent<'decision'> =>
        e.type === 'decision' && e.data.kind === 'notify' && e.data.choice === 'later',
    );
    await first.t.core.close();
    expect(tg.messages.some((m) => m.text.includes('Fatto di notte.'))).toBe(false);

    const again = await startBot({}, { tg, home: first.t.home, pair: false });
    await again.t.json('PUT', '/api/telegram/prefs', { quietHours: { enabled: false } });
    const late = await tg.waitMessage((m) => m.text.includes('Fatto di notte.'));
    expect(late.chat_id).toBe(GIULIO.id);
  });
});

describe('telegram: whitelist and accounts', () => {
  it('an account removed from the whitelist gets no reply of the work it started', async () => {
    const gate = deferred();
    const { t, tg } = await startBot({
      titan: [fake.text('SEGRETO del lavoro.', { gate: gate.promise })],
    });
    await pair(t, tg, ANNA);
    tg.text(ANNA, 'lavora');
    await t.waitEvent((e): e is LogEvent<'run'> => e.type === 'run' && e.data.status === 'started');
    await t.json('DELETE', `/api/telegram/users/${ANNA.id}`);
    const before = tg.sentTo(ANNA.id).length;
    gate.resolve();
    // Her work goes on: its end is a notification for the accounts still there.
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text.includes('SEGRETO del lavoro.'));
    await pause(100);
    expect(tg.sentTo(ANNA.id)).toHaveLength(before);
  });

  it('a notification held for the night skips an account removed meanwhile', async () => {
    const { t, tg, clock } = await startBot({ titan: [fake.text('SEGRETO di notte.')] });
    await pair(t, tg, ANNA);
    clock.now += 60 * 60_000;
    await t.json('PUT', '/api/telegram/prefs', { quietHours: quietNow(clock) });
    const night = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'notte' });
    await t.runEnded(night.runId);
    await t.waitEvent(
      (e): e is LogEvent<'decision'> =>
        e.type === 'decision' && e.data.kind === 'notify' && e.data.choice === 'later',
    );
    await t.json('DELETE', `/api/telegram/users/${ANNA.id}`);
    await t.json('PUT', '/api/telegram/prefs', { quietHours: { enabled: false } });
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text.includes('SEGRETO'));
    await pause(100);
    expect(tg.sentTo(ANNA.id).some((m) => m.text.includes('SEGRETO'))).toBe(false);
  });

  it('a flood of pairing codes from a stranger: one event, one answer, the code survives', async () => {
    const { t, tg } = await startBot({}, { pair: false });
    // Without an active code: logged, never answered.
    tg.text(STRANGER, '/start NOCODE00');
    await t.waitEvent(isChannel('pairing_failed', (e) => e.data.reason === 'no_code'));
    const code = await t.json<TelegramPairing>('POST', '/api/telegram/pairing');
    for (let i = 0; i < 50; i++) tg.text(STRANGER, `/start WRONG${String(i).padStart(3, '0')}`);
    await pairWith(tg, GIULIO, code.code);
    expect(t.events().filter(isChannel('pairing_failed'))).toHaveLength(1);
    // The clock never moved: within 10 s an account is logged once, and answered once.
    expect(tg.sentTo(STRANGER.id).map((m) => m.text)).toEqual(['That code isn’t valid.']);
    const view = await t.json<TelegramView>('GET', '/api/telegram');
    expect(view.users.map((u) => u.id)).toEqual([GIULIO.id]);
  });

  it('with two accounts, the replies of a job go to whoever started it', async () => {
    const gate = deferred();
    const { t, tg } = await startBot({
      titan: [fake.text('Ecco per Giulio.', { gate: gate.promise }), fake.text('Ecco per Anna.')],
    });
    await pair(t, tg, ANNA);
    tg.text(GIULIO, 'lavora');
    await t.waitEvent((e): e is LogEvent<'run'> => e.type === 'run' && e.data.status === 'started');
    tg.text(ANNA, 'aggiungi questo');
    await tg.waitMessage((m) => m.chat_id === ANNA.id && m.text.includes('Added to'));
    gate.resolve();
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text.includes('Ecco per Giulio.'));
    await pause(200);
    expect(tg.sentTo(ANNA.id).some((m) => m.text.includes('Ecco per'))).toBe(false);
  });

  it('a new token: the old polling loop never saves its offset for the new bot', async () => {
    const tg = await new FakeTelegram().start();
    fakes.push(tg);
    const OTHER_TOKEN = '987654321:AAOtherFakeTokenForTestsOnly_abcdefg';
    const OTHER_BOT = { ...FAKE_BOT, id: 987654321, username: 'other_test_bot' };
    tg.addBot(OTHER_TOKEN, OTHER_BOT);
    const db = openDb(':memory:');
    migrate(db, 'core', coreMigrations);
    const log = new EventLog(db);
    const state = new StateStore(db);
    const killing = deferred();
    let killed = false;
    const runs = {
      halted: false,
      kill: async () => {
        killed = true;
        await killing.promise;
        return { runsAborted: 0, processesKilled: 0 };
      },
    };
    const channel = new TelegramChannel({
      db,
      log,
      state,
      runs: runs as never,
      questions: { get: () => undefined, list: () => [] } as never,
      gate: new DecisionGate({ log }),
      team: { get: () => undefined } as never,
      secretsDir: join(tempHome(), 'secrets'),
      env: { TELEGRAM_BOT_TOKEN: FAKE_TOKEN },
      prefs: () => ({
        quietHours: { enabled: false, from: '22:00', to: '08:00' },
        notify: { done: true, questions: true, errors: true },
      }),
      savePrefs: () => {},
      send: () => {
        throw new Error('unused');
      },
      answer: () => {
        throw new Error('unused');
      },
      newConversation: () => {
        throw new Error('unused');
      },
      ready: () => true,
      apiRoot: tg.url,
      pollTimeoutS: 1,
      retryBaseMs: 20,
      retryMaxMs: 80,
      chatGapMs: { private: 0, group: 0 },
    });
    new TelegramUsers(db).add({ id: GIULIO.id, name: 'Giulio' }, Date.now());
    channel.start();
    const online = async () => {
      while (channel.view().status !== 'online') await pause(10);
    };
    await online();
    // The old loop is busy with /stop when the new token arrives.
    tg.text(GIULIO, '/stop');
    while (!killed) await pause(10);
    const switching = channel.setToken(OTHER_TOKEN);
    await tg.waitCall((c) => c.method === 'getMe' && c.token === OTHER_TOKEN);
    await pause(50);
    killing.resolve();
    await switching;
    expect(state.get<{ bot: number }>('telegram_offset')?.bot).toBe(FAKE_BOT.id);
    const firstPoll = await tg.waitCall(
      (c) => c.method === 'getUpdates' && c.token === OTHER_TOKEN,
    );
    expect(firstPoll.payload['offset']).toBe(0);
    await channel.stop();
    db.close();
  });
});

describe('telegram: questions', () => {
  it('a question with four long options stays under 4096 characters, whole emoji in buttons', async () => {
    const long = (c: string, n: number) => c.repeat(n);
    const { t, tg } = await startBot({
      titan: [
        fake.toolCall('ask_user', {
          // The longest ask_user accepts.
          question: long('Q', 1000),
          options: [1, 2, 3, 4].map((i) => ({
            label: `${long('x', 55)}😀😀${long(String(i), 141)}`,
            description: long('&', 500),
          })),
        }),
        fake.text('Ok.'),
      ],
    });
    tg.text(GIULIO, 'chiedimi');
    const question = await tg.waitMessage((m) => m.text.includes('QQQQ'));
    const buttons = question.reply_markup!.inline_keyboard!.flat();
    expect(buttons).toHaveLength(4);
    expect(buttons[0]!.text.endsWith('…')).toBe(true);
    tg.press(GIULIO, question, buttons[1]!.callback_data);
    // The edit with the outcome fits as well.
    await tg.waitMessage((m) => m.message_id === question.message_id && m.text.includes('✅'));
    await t.waitEvent((e): e is LogEvent<'answer'> => e.type === 'answer');
    expect(t.events().some(isError('telegram_send_failed'))).toBe(false);
  });

  it('after a restart a question still waits (D-078): buttons kept, the reply starts the work again', async () => {
    const tg = await new FakeTelegram().start();
    fakes.push(tg);
    const first = await startBot(
      { titan: [fake.toolCall('ask_user', { question: 'Pubblico?', options: ['Sì', 'No'] })] },
      { tg },
    );
    tg.text(GIULIO, 'pubblica');
    const question = await tg.waitMessage((m) => m.text.includes('Pubblico?'));
    await first.t.core.close();

    const again = await startBot(
      { titan: [fake.text('Pubblicato, come chiedi.')] },
      { tg, home: first.t.home, pair: false },
    );
    tg.text(GIULIO, 'Sì, pubblica', { replyTo: question.message_id });
    // The run the answer starts replies in this chat.
    await tg.waitMessage((m) => m.text.includes('Pubblicato, come chiedi.'));
    expect(question.text).not.toContain('No answer needed');
    expect(again.t.provider.calls).toHaveLength(1);
    expect(JSON.stringify(again.t.provider.calls[0]!.options.prompt)).toContain(
      'Risposta alla tua domanda \\"Pubblico?\\": Sì, pubblica',
    );
    // Answered once: a second reply is told the question is over, nothing new starts.
    tg.text(GIULIO, 'No', { replyTo: question.message_id });
    await tg.waitMessage((m) => m.text.includes('no longer waiting for an answer'));
    expect(again.t.provider.calls).toHaveLength(1);
  });
});

describe('telegram: drafts of the monsters (D-098)', () => {
  it('a proposed project arrives with Conferma and Scarta; Conferma creates it, the message closes', async () => {
    const { t, tg } = await startBot({
      titan: [
        fake.toolCall('tools_search', { query: 'progetto' }),
        fake.toolCall('project_propose', {
          name: 'Social',
          goal: 'i post della pagina',
          monsters: [{ name: 'Sofia', role: 'testi dei post', mission: 'scrivi i testi dei post' }],
        }),
        fake.text('Bozza pronta.'),
        fake.toolCall('tools_search', { query: 'automazione' }),
        fake.toolCall('automation_propose', {
          name: 'Rassegna',
          cron: '0 8 * * 1-5',
          objective: 'La rassegna stampa del giorno.',
        }),
        fake.text('Proposta.'),
      ],
    });
    tg.text(GIULIO, 'apri un progetto per i social');
    const card = await tg.waitMessage((m) => m.text.includes('progetto «Social»'));
    // Every field that becomes real (D-103): the monster's rules, tools and model, folder, web, cap.
    for (const field of [
      '🧩 <b>Sofia</b>',
      'Role: testi dei post',
      '1. scrivi i testi dei post',
      'Tools: notes, no terminal or files',
      'Model: like Tethys',
      'Connections: none',
      'Web search: yes',
      'Spending cap: the squad’s',
    ])
      expect(card.text).toContain(field);
    const buttons = card.reply_markup!.inline_keyboard!.flat();
    expect(buttons.map((b) => b.text)).toEqual(['✅ Confirm', 'Discard']);
    expect(buttons[0]!.callback_data).toBe('d:y:p:social');
    // A reply in words does not confirm anything.
    tg.text(GIULIO, 'sì', { replyTo: card.message_id });
    await tg.waitMessage((m) => m.text.includes('use the Confirm or Discard buttons'));
    tg.press(GIULIO, card, buttons[0]!.callback_data);
    await tg.waitMessage(
      (m) => m.message_id === card.message_id && m.text.includes('✅ Confirmed (from Telegram)'),
    );
    expect(t.core.hub.team.project('social')?.status).toBe('active');
    expect(t.core.hub.team.byId('sofia')?.config.project).toBe('social');

    tg.text(GIULIO, 'ogni mattina feriale alle 8 la rassegna');
    const auto = await tg.waitMessage((m) => m.text.includes('«Rassegna»'));
    expect(auto.text).toContain('dal lunedì al venerdì alle 8:00');
    const [conferma, scarta] = auto.reply_markup!.inline_keyboard!.flat();
    tg.press(GIULIO, auto, scarta!.callback_data);
    await tg.waitMessage((m) => m.message_id === auto.message_id && m.text.includes('■ Discarded'));
    expect(await t.json('GET', '/api/automations')).toEqual([]);
    // A late press: the draft is gone.
    tg.press(GIULIO, auto, conferma!.callback_data);
    await tg.waitCall(
      (c) =>
        c.method === 'answerCallbackQuery' &&
        typeof c.payload['text'] === 'string' &&
        /draft|bozza/i.test(c.payload['text']),
    );
  });

  it('a project in an existing folder outside Monsters Progetti is confirmed in the app (review of 18/10, M2)', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'monsters-tg-repo-'));
    try {
      const { t, tg } = await startBot({
        titan: [
          fake.toolCall('tools_search', { query: 'progetto' }),
          fake.toolCall('project_propose', {
            name: 'Sito',
            goal: 'il sito di un cliente',
            folder,
            monsters: [{ name: 'Sofia', role: 'testi del sito', mission: 'scrivi i testi' }],
          }),
          fake.text('Bozza pronta.'),
        ],
      });
      tg.text(GIULIO, 'apri un progetto per il sito');
      const card = await tg.waitMessage((m) => m.text.includes('progetto «Sito»'));
      expect(card.text).toContain('All the project’s monsters will be able to read and write');
      expect(card.text).toContain('outside Monsters Progetti');
      const buttons = card.reply_markup!.inline_keyboard!.flat();
      expect(buttons.map((b) => b.text)).toEqual(['Open in the app', 'Discard']);
      expect(buttons[0]!.callback_data).toMatch(/^d:o:/);
      // A Conferma forged by a client does not confirm it either.
      tg.press(GIULIO, card, buttons[0]!.callback_data.replace('d:o:', 'd:y:'));
      await tg.waitCall(
        (c) =>
          c.method === 'answerCallbackQuery' &&
          typeof c.payload['text'] === 'string' &&
          c.payload['text'].includes('Confirm it in the app'),
      );
      expect(t.core.hub.team.project('sito')?.status).toBe('draft');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('telegram: the draft card shows what becomes real (D-103)', () => {
  it('an automation with its participants, notices and whole objective; too long: no Conferma', async () => {
    const objective = 'Prepara la rassegna stampa del giorno sui temi del ristorante. ';
    const { tg } = await startBot({
      titan: [
        fake.toolCall('tools_search', { query: 'automazione' }),
        fake.toolCall('automation_propose', {
          name: 'Rassegna',
          cron: '0 8 * * 1-5',
          objective: `${objective}Alla fine scrivi tre righe.`,
          participants: ['Rhea'],
          telegram: true,
        }),
        fake.text('Proposta.'),
        fake.toolCall('tools_search', { query: 'automazione' }),
        fake.toolCall('automation_propose', {
          name: 'Lunga',
          cron: '0 9 * * 1',
          objective: objective.repeat(60).slice(0, 3990),
        }),
        fake.text('Proposta.'),
      ],
    });
    tg.text(GIULIO, 'una rassegna ogni mattina');
    const card = await tg.waitMessage((m) => m.text.includes('«Rassegna»'));
    for (const field of [
      'Participants: Rhea',
      'Notices: app yes, Telegram yes',
      'Alla fine scrivi tre righe.',
      'Squad lead: Titan',
      'Limits per run: each job’s own',
    ])
      expect(card.text).toContain(field);
    expect(card.reply_markup!.inline_keyboard!.flat().map((b) => b.text)).toEqual([
      '✅ Confirm',
      'Discard',
    ]);

    tg.text(GIULIO, 'e una lunga il lunedì');
    const long = await tg.waitMessage((m) => m.text.includes('«Lunga»'));
    expect(long.text).toContain('too long for a message');
    const buttons = long.reply_markup!.inline_keyboard!.flat();
    expect(buttons.map((b) => b.text)).toEqual(['Open in the app', 'Discard']);
    tg.press(GIULIO, long, buttons[0]!.callback_data);
    await tg.waitCall(
      (c) =>
        c.method === 'answerCallbackQuery' &&
        typeof c.payload['text'] === 'string' &&
        c.payload['text'].includes('To review'),
    );
    // A Conferma forged by a client does not confirm what the card could not show (item 12).
    tg.press(GIULIO, long, buttons[0]!.callback_data.replace('d:o:', 'd:y:'));
    await tg.waitCall(
      (c) =>
        c.method === 'answerCallbackQuery' &&
        typeof c.payload['text'] === 'string' &&
        c.payload['text'].includes('Confirm it in the app'),
    );
    expect(
      tg.calls.some(
        (c) =>
          c.method === 'answerCallbackQuery' &&
          typeof c.payload['text'] === 'string' &&
          c.payload['text'].includes('Done: confirmed'),
      ),
    ).toBe(false);
  });
});

describe('telegram: a proposal for CLAUDE.md or AGENTS.md (D-113)', () => {
  const CLAUDE = '# Saturday\nIl sito è in site/.\n';
  it('a short diff in the message; Applica and Lascia stare, always, also when the diff is long', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'monsters-tg-docs-'));
    try {
      writeFileSync(join(folder, 'CLAUDE.md'), CLAUDE);
      const long = Array.from({ length: 80 }, (_, i) => `- regola numero ${i} del progetto`).join(
        '\n',
      );
      const { t, tg } = await startBot({
        titan: [
          fake.toolCall('tools_search', { query: 'istruzioni CLAUDE.md' }),
          fake.toolCall('project_docs_propose', {
            file: 'CLAUDE.md',
            content: `${CLAUDE}I test: pnpm test <ok> & basta.\n`,
            reason: 'Scrivo come si lanciano i test',
          }),
          fake.text('Proposto.'),
          fake.toolCall('tools_search', { query: 'istruzioni CLAUDE.md' }),
          fake.toolCall('project_docs_propose', {
            file: 'AGENTS.md',
            content: `# Regole\n${long}\n`,
            reason: 'Le regole della squadra',
          }),
          fake.text('Proposto.'),
        ],
      });
      await t.json('POST', '/api/projects', {
        name: 'Saturday',
        lead: { name: 'Leda' },
        folder: { path: folder },
      });
      tg.text(GIULIO, 'scrivi come si lanciano i test');
      const card = await tg.waitMessage((m) =>
        m.text.includes('le istruzioni di «Saturday» (CLAUDE.md)'),
      );
      expect(card.text).toContain('📄 File: <b>CLAUDE.md</b> · project Saturday');
      expect(card.text).toContain('<pre>');
      // Escaped in the HTML of the message.
      expect(card.text).toContain('+I test: pnpm test &lt;ok&gt; &amp; basta.');
      const buttons = card.reply_markup!.inline_keyboard!.flat();
      expect(buttons.map((b) => b.text)).toEqual(['✅ Apply', 'Leave it']);
      expect(buttons[0]!.callback_data).toMatch(/^d:y:i:/);
      tg.press(GIULIO, card, buttons[0]!.callback_data);
      await tg.waitMessage(
        (m) => m.message_id === card.message_id && m.text.includes('✅ Applied (from Telegram)'),
      );
      expect(readFileSync(join(folder, 'CLAUDE.md'), 'utf8')).toBe(
        `${CLAUDE}I test: pnpm test <ok> & basta.\n`,
      );

      tg.text(GIULIO, 'e le regole');
      const other = await tg.waitMessage((m) =>
        m.text.includes('le istruzioni di «Saturday» (AGENTS.md)'),
      );
      expect(other.text).toContain('(new)');
      expect(other.text).toContain('The diff is long: you’ll find it in the app too.');
      expect(other.text).not.toContain('<pre>');
      const more = other.reply_markup!.inline_keyboard!.flat();
      expect(more.map((b) => b.text)).toEqual(['✅ Apply', 'Leave it']);
      tg.press(GIULIO, other, more[1]!.callback_data);
      await tg.waitMessage(
        (m) => m.message_id === other.message_id && m.text.includes('■ Left alone'),
      );
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('telegram: text helpers', () => {
  it('clip never cuts a character in two', () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (let max = 2; max < 30; max++) {
      const out = clip('😀'.repeat(40), max);
      expect(out.length).toBeLessThanOrEqual(max);
      expect(lone.test(out)).toBe(false);
    }
    const family = '👨‍👩‍👧‍👦';
    expect(clip(`ab${family}cd`, 6)).toBe('ab…');
    expect(clip('ciao', 10)).toBe('ciao');
  });

  it('links: only https and mailto', () => {
    expect(toTelegramHtml('[t](tg://proxy?server=evil&port=1&secret=ab)')).toBe(
      '[t](tg://proxy?server=evil&amp;port=1&amp;secret=ab)',
    );
    expect(toTelegramHtml('[t](http://x.it)')).toBe('[t](http://x.it)');
    expect(toTelegramHtml('[t](https://x.it)')).toBe('<a href="https://x.it">t</a>');
    expect(toTelegramHtml('[t](mailto:a@b.it)')).toBe('<a href="mailto:a@b.it">t</a>');
  });
});

describe('telegram: what Telegram refuses', () => {
  it('a 429 is waited out in full: polling working again does not wake the message early', async () => {
    const { tg } = await startBot({});
    tg.floodRetryAfterS = 2;
    tg.failSends(1, 'flood');
    tg.text(GIULIO, '/help');
    await tg.waitMessage((m) => m.text.startsWith('Write to me'), 8000);
    const tries = tg.calls.filter(
      (c) => c.method === 'sendMessage' && String(c.payload['text']).startsWith('Write to me'),
    );
    expect(tries).toHaveLength(2);
    // Polling answers every second: the retry still waits the 2 s Telegram asked for.
    expect(tries[1]!.at - tries[0]!.at).toBeGreaterThanOrEqual(1900);
  });

  it('a user who blocks the bot: the queue of that chat stops, it shows, and resumes when they write', async () => {
    const { t, tg } = await startBot({ titan: [fake.text(`${'riga lunga '.repeat(900)}`)] });
    const before = tg.sentTo(GIULIO.id).length;
    tg.failSends(1, 'forbidden');
    tg.text(GIULIO, 'ciao');
    const left = await t.waitEvent(isChannel('chat_left'));
    expect(left.data).toMatchObject({ userId: String(GIULIO.id), reason: 'forbidden' });
    await pause(300);
    // The other pieces of the long answer never left; nothing was logged as a lost message.
    expect(tg.sentTo(GIULIO.id)).toHaveLength(before);
    expect(t.events().some(isError('telegram_send_failed'))).toBe(false);
    tg.text(GIULIO, '/help');
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text.startsWith('Write to me'));
  });

  it('an edit that fails for a reason other than "not modified" is logged', async () => {
    const { t, tg } = await startBot({
      titan: [
        fake.toolCall('ask_user', {
          question: 'Quale tono?',
          options: [{ label: 'Ironico' }, { label: 'Serio' }],
        }),
        fake.text('Fatto.'),
      ],
    });
    tg.text(GIULIO, 'scrivi un post');
    const question = await tg.waitMessage((m) => m.text.includes('Quale tono?'));
    tg.failEdit("Bad Request: can't parse entities");
    tg.press(GIULIO, question, question.reply_markup!.inline_keyboard!.flat()[0]!.callback_data);
    const failed = await t.waitEvent(isError('telegram_send_failed'));
    expect(failed.data.message).toContain('editMessageText');
  });

  it('/stato over 4096 characters is split instead of refused', async () => {
    const { t, tg } = await startBot({});
    for (let i = 0; i < 100; i++) {
      await t.json('POST', '/api/projects', {
        name: `Progetto numero ${i} con nome lungo`,
        lead: {
          name: `Capo${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`,
        },
      });
    }
    tg.text(GIULIO, '/status');
    await tg.waitMessage((m) => m.text.includes('Progetto numero 99'));
    const pieces = tg.sentTo(GIULIO.id).filter((m) => m.text.includes('Progetto numero'));
    expect(pieces.length).toBeGreaterThan(1);
    expect(t.events().some(isError('telegram_send_failed'))).toBe(false);
  }, 90_000);
});

/** A channel on its own (no hub), on the fake Bot API, with the token in the environment. */
function standalone(
  tg: FakeTelegram,
  options: {
    state?: (db: ReturnType<typeof openDb>) => StateStore;
    runs?: unknown;
    env?: Record<string, string>;
  } = {},
) {
  const db = openDb(':memory:');
  migrate(db, 'core', coreMigrations);
  const log = new EventLog(db);
  const state = options.state ? options.state(db) : new StateStore(db);
  const channel = new TelegramChannel({
    db,
    log,
    state,
    runs: (options.runs ?? { halted: false }) as never,
    questions: { get: () => undefined, list: () => [] } as never,
    gate: new DecisionGate({ log }),
    team: { get: () => undefined } as never,
    secretsDir: join(tempHome(), 'secrets'),
    env: options.env ?? { TELEGRAM_BOT_TOKEN: FAKE_TOKEN },
    prefs: () => ({
      quietHours: { enabled: false, from: '22:00', to: '08:00' },
      notify: { done: true, questions: true, errors: true },
    }),
    savePrefs: () => {},
    send: () => {
      throw new Error('unused');
    },
    answer: () => {
      throw new Error('unused');
    },
    newConversation: () => {
      throw new Error('unused');
    },
    ready: () => true,
    apiRoot: tg.url,
    pollTimeoutS: 1,
    retryBaseMs: 20,
    retryMaxMs: 80,
    chatGapMs: { private: 0, group: 0 },
  });
  new TelegramUsers(db).add({ id: GIULIO.id, name: 'Giulio' }, Date.now());
  const online = async () => {
    while (channel.view().status !== 'online') await pause(10);
  };
  return { db, log, state, channel, online };
}

describe('telegram: polling that holds', () => {
  it('a 429 on getUpdates is waited out and says so, not "isn’t responding"', async () => {
    const { t, tg } = await startBot({});
    tg.floodRetryAfterS = 1;
    tg.failGetUpdates(1, 'flood');
    const down = await t.waitEvent(isChannel('disconnected'));
    const at = Date.now();
    expect(down.data.message).toContain('429');
    const view = await t.json<TelegramView>('GET', '/api/telegram');
    expect(view.status).toBe('retrying');
    expect(view.error).toContain('slow down');
    const next = await tg.waitCall((c) => c.method === 'getUpdates' && c.at > at);
    // Not the 20 ms of the ordinary backoff: the second Telegram asked for.
    expect(next.at - at).toBeGreaterThanOrEqual(800);
  });

  it('the offset is saved before an update is handled, not at the end of the batch', async () => {
    const tg = await new FakeTelegram().start();
    fakes.push(tg);
    const killing = deferred();
    let killed = false;
    const { channel, state, online, db } = standalone(tg, {
      runs: {
        halted: false,
        kill: async () => {
          killed = true;
          await killing.promise;
          return { runsAborted: 0, processesKilled: 0 };
        },
      },
    });
    channel.start();
    await online();
    const id = tg.text(GIULIO, '/stop');
    while (!killed) await pause(10);
    // The handler is still busy (a crash now would lose the batch): the offset is already there.
    expect(state.get<{ offset: number }>('telegram_offset')?.offset).toBe(id + 1);
    killing.resolve();
    await channel.stop();
    db.close();
  });

  it('an error that ends the loop is logged, shown, and the polling starts again by itself', async () => {
    const tg = await new FakeTelegram().start();
    fakes.push(tg);
    let broken = 1;
    class Flaky extends StateStore {
      override set(key: string, value: unknown): void {
        if (key === 'telegram_offset' && broken-- > 0) throw new Error('disk full');
        super.set(key, value);
      }
    }
    const { channel, log, online, db } = standalone(tg, { state: (d) => new Flaky(d) });
    channel.start();
    await online();
    tg.text(GIULIO, '/help');
    while (!log.query({ limit: 100 }).some((e) => e.type === 'error')) await pause(10);
    const crash = log.query({ limit: 100 }).find((e) => e.type === 'error');
    expect(crash?.data).toMatchObject({ code: 'telegram_failed', message: 'disk full' });
    // It starts again on its own, and the update that was lost with the crash is handled.
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text.startsWith('Write to me'));
    // And it keeps working afterwards: a second message is answered too.
    tg.text(GIULIO, '/help');
    await pause(1500);
    expect(tg.sentTo(GIULIO.id).filter((m) => m.text.startsWith('Write to me'))).toHaveLength(2);
    await online();
    await channel.stop();
    db.close();
  });
});

describe('telegram: token saved twice, or while stopping', () => {
  it('two tokens saved together leave one polling loop', async () => {
    const tg = await new FakeTelegram().start();
    fakes.push(tg);
    const killing = deferred();
    let killed = false;
    const { channel, online, db } = standalone(tg, {
      runs: {
        halted: false,
        kill: async () => {
          killed = true;
          await killing.promise;
          return { runsAborted: 0, processesKilled: 0 };
        },
      },
    });
    channel.start();
    await online();
    // The old loop is busy with /stop when the token is saved twice.
    tg.text(GIULIO, '/stop');
    while (!killed) await pause(10);
    const both = Promise.all([channel.setToken(FAKE_TOKEN), channel.setToken(FAKE_TOKEN)]);
    await pause(100);
    killing.resolve();
    await both;
    let most = 0;
    for (let i = 0; i < 25; i++) {
      most = Math.max(most, tg.polling);
      await pause(30);
    }
    expect(most).toBe(1);
    await channel.stop();
    db.close();
  });

  it('a token that arrives while the core is stopping does not restart the bot', async () => {
    const tg = await new FakeTelegram().start();
    fakes.push(tg);
    const { channel, online, db } = standalone(tg);
    channel.start();
    await online();
    const stopping = channel.stop();
    const late = channel.setToken(FAKE_TOKEN);
    await Promise.all([stopping, late]);
    const polls = () => tg.calls.filter((c) => c.method === 'getUpdates').length;
    const after = polls();
    await pause(400);
    expect(polls()).toBe(after);
    expect(channel.view().status).toBe('off');
    db.close();
  });

  it('a stop while a new token waits for the old loop leaves no loop and no log listener', async () => {
    const tg = await new FakeTelegram().start();
    fakes.push(tg);
    const killing = deferred();
    let killed = false;
    const { channel, online, db, log } = standalone(tg, {
      runs: {
        halted: false,
        kill: async () => {
          killed = true;
          await killing.promise;
          return { runsAborted: 0, processesKilled: 0 };
        },
      },
    });
    let listening = 0;
    const subscribe = log.subscribe.bind(log);
    log.subscribe = (listener) => {
      listening++;
      const off = subscribe(listener);
      return () => {
        listening--;
        off();
      };
    };
    channel.start();
    await online();
    expect(listening).toBe(1);
    // The old loop is busy with /stop: the new token waits for it inside the queue.
    tg.text(GIULIO, '/stop');
    while (!killed) await pause(10);
    const switching = channel.setToken(FAKE_TOKEN);
    while (!tg.calls.some((c) => c.method === 'getMe')) await pause(10);
    await pause(50);
    const stopping = channel.stop();
    killing.resolve();
    await Promise.all([switching, stopping]);
    expect(listening).toBe(0);
    expect(channel.view().status).toBe('off');
    db.close();
  });

  it('"Rimuovi" while a token is being checked: the token is not saved afterwards', async () => {
    const tg = await new FakeTelegram().start();
    fakes.push(tg);
    const { channel, db } = standalone(tg, { env: {} });
    channel.start();
    const checking = deferred();
    tg.holdGetMe = checking.promise;
    const saving = channel.setToken(FAKE_TOKEN);
    while (!tg.calls.some((c) => c.method === 'getMe')) await pause(10);
    await channel.removeToken();
    checking.resolve();
    tg.holdGetMe = null;
    const view = await saving;
    expect(view.token.set).toBe(false);
    expect(channel.view()).toMatchObject({ token: { set: false }, status: 'off' });
    await pause(100);
    expect(tg.calls.some((c) => c.method === 'getUpdates')).toBe(false);
    await channel.stop();
    db.close();
  });
});

// Keep the helper types used.
export type { SentMessage };

describe('telegram: the app’s language (D-153)', () => {
  const commandNames = (tg: FakeTelegram, nth: number): string[] => {
    const calls = tg.calls.filter((c) => c.method === 'setMyCommands');
    const commands = calls[nth]?.payload['commands'] as { command: string }[] | undefined;
    return (commands ?? []).map((c) => c.command);
  };

  it('registers the commands in the language, answers to both names, and follows a change of language', async () => {
    const { tg } = await startBot({});
    await tg.waitCall((c) => c.method === 'setMyCommands');
    expect(commandNames(tg, 0)).toEqual(['stop', 'resume', 'new', 'status', 'help']);

    // The Italian names still work in English...
    tg.text(GIULIO, '/stato');
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text.includes('<b>Running.</b>'));
    tg.text(GIULIO, '/aiuto');
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text.startsWith('Write to me'));

    // ...the language changes: the commands are registered again, with their descriptions.
    setAppLang('it');
    await tg.waitCall(
      (c) =>
        c.method === 'setMyCommands' &&
        tg.calls.filter((x) => x.method === 'setMyCommands').length > 1,
    );
    expect(commandNames(tg, 1)).toEqual(['stop', 'riprendi', 'nuova', 'stato', 'aiuto']);
    const second = tg.calls.filter((c) => c.method === 'setMyCommands')[1]!;
    expect(JSON.stringify(second.payload['commands'])).toContain('Ferma subito tutti i mostri');

    // ...and the English names work in Italian.
    tg.text(GIULIO, '/status');
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text.includes('<b>Attivi.</b>'));
    tg.text(GIULIO, '/resume');
    await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text === 'I mostri non sono fermi.');
    tg.text(GIULIO, '/nuova @Nessuno');
    await tg.waitMessage(
      (m) => m.chat_id === GIULIO.id && m.text === 'Non c’è nessun mostro con questo nome.',
    );
  });

  it('the card of a draft and its buttons follow the language', async () => {
    const { tg } = await startBot({
      titan: [
        fake.toolCall('tools_search', { query: 'automazione' }),
        fake.toolCall('automation_propose', {
          name: 'Rassegna',
          cron: '0 8 * * 1-5',
          objective: 'La rassegna stampa del giorno.',
          participants: ['Rhea'],
          telegram: true,
        }),
        fake.text('Proposta.'),
      ],
    });
    setAppLang('it');
    tg.text(GIULIO, 'una rassegna ogni mattina');
    const card = await tg.waitMessage((m) => m.text.includes('«Rassegna»'));
    for (const field of [
      'Partecipano: Rhea',
      'Avvisi: app sì, Telegram sì',
      'Capo: Titan',
      'Limiti per giro: quelli di ogni lavoro',
      'Conferma la crea così com’è',
    ])
      expect(card.text).toContain(field);
    expect(card.reply_markup!.inline_keyboard!.flat().map((b) => b.text)).toEqual([
      '✅ Conferma',
      'Scarta',
    ]);
  });

  it('the stop reason and the answer to a stop follow the language', async () => {
    const { t, tg } = await startBot({});
    setAppLang('it');
    tg.text(GIULIO, '/stop');
    await tg.waitMessage((m) => m.text.includes('Fermato tutto.'));
    const kill = t.events().find((e): e is LogEvent<'kill'> => e.type === 'kill');
    expect(kill?.data.reason).toBe('/stop da Telegram');
  });
});
