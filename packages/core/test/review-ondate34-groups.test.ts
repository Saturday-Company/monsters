import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fake, type FakeScript } from '@monsters/providers/testing';
import type { LogEvent, TelegramPairing } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { desktopUserDataDirs } from '../src/hub.ts';
import { NOTE_LEAK_CHARS, RunTaint } from '../src/team/instinct/taint.ts';
import { deferred, startTestHub, type TestHub } from './hub-helpers.ts';
import { FAKE_TOKEN, FakeTelegram, type FakeUser, type SentMessage } from './telegram-fake.ts';

/*
 * Review of the waves 3 and 4, the chats of a dedicated bot with other people (D-114): the
 * reply check counts a long stretch equal to a note (not pieces added up) and leaves out the
 * notes of the bot's project; a held reply has «Manda comunque»; the monster's questions to the
 * chat pass the same check. And the data folder of the desktop app is closed to the monsters.
 */

const GIULIO: FakeUser = { id: 1001, first_name: 'Giulio', username: 'giulio' };
const LIVIO: FakeUser = { id: 3003, first_name: 'Livio', username: 'livio' };
const RHEA_TOKEN = '222222222:AAbotForRheaOnlyInTests_abcdefghijk';
const RHEA_BOT = {
  id: 222222222,
  is_bot: true,
  first_name: 'Rhea Saturday',
  username: 'rhea_saturday_bot',
};
const GROUP = { id: -100777, type: 'supergroup', title: 'Saturday Team' };
const RHEA = String(RHEA_BOT.id);

const NOTE =
  'Acme paga trentamila euro a marzo, il referente è Paolo Bianchi, il contratto scade a ' +
  'giugno e lo sconto concordato è del dodici per cento sul secondo anno di servizio.';
/** Three pieces of a note, each shorter than the threshold, more than it all together. */
const LONG_NOTE =
  'La riunione con il fornitore di Bologna si è chiusa senza accordo sul prezzo finale. ' +
  'Marta propone di rivedere le quantità minime del primo ordine di settembre. ' +
  'Il magazzino nuovo apre a novembre se arrivano i permessi del comune in tempo.';
const QUOTES =
  'Sì: la riunione con il fornitore di Bologna si è chiusa senza accordo. Poi: Marta propone ' +
  'di rivedere le quantità minime. E infine il magazzino nuovo apre a novembre se arrivano i ' +
  'permessi.';

const fakes: FakeTelegram[] = [];
afterEach(async () => {
  for (const f of fakes.splice(0)) await f.close();
});

const isChannel =
  (action: string, extra: (e: LogEvent<'channel'>) => boolean = () => true) =>
  (e: LogEvent): e is LogEvent<'channel'> =>
    e.type === 'channel' && e.data.action === action && extra(e);
const inGroup = (m: SentMessage) => m.token === RHEA_TOKEN && m.chat_id === GROUP.id;
const toGiulio = (m: SentMessage) => m.token === FAKE_TOKEN && m.chat_id === GIULIO.id;
/** A request with the CLI token, never upgraded to the user's session (the helper does that). */
const withToken = (t: TestHub, method: string, path: string, body?: unknown) =>
  fetch(`${t.core.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${readFileSync(t.core.paths.cliToken, 'utf8').trim()}`,
      'content-type': 'application/json',
      'x-monsters-request': '1',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

async function startGroup(rhea: FakeScript): Promise<{ t: TestHub; tg: FakeTelegram }> {
  const tg = await new FakeTelegram().start();
  fakes.push(tg);
  tg.addBot(RHEA_TOKEN, RHEA_BOT);
  const t = await startTestHub(
    { rhea },
    {
      hub: {
        telegram: {
          apiRoot: tg.url,
          pollTimeoutS: 1,
          retryBaseMs: 20,
          retryMaxMs: 80,
          chatGapMs: { private: 0, group: 0 },
        },
      },
    },
  );
  await t.json('PUT', '/api/telegram/token', { token: FAKE_TOKEN });
  await t.waitEvent(isChannel('connected', (e) => e.data.bot === undefined));
  const code = await t.json<TelegramPairing>('POST', '/api/telegram/pairing');
  tg.text(GIULIO, `/start ${code.code}`);
  await tg.waitMessage((m) => toGiulio(m) && m.text.includes('you can now command'));
  await t.json('POST', '/api/telegram/bots', { token: RHEA_TOKEN, agent: 'rhea' });
  await t.waitEvent(isChannel('connected', (e) => e.data.bot === RHEA));
  tg.addedToGroup(RHEA_TOKEN, GROUP, GIULIO);
  await t.waitEvent(isChannel('chat_pending', (e) => e.data.bot === RHEA));
  await t.json('POST', `/api/telegram/bots/${RHEA}/chats/${GROUP.id}/approve`);
  tg.text(LIVIO, '/join', { chat: GROUP, token: RHEA_TOKEN });
  await t.waitEvent(isChannel('person_pending', (e) => e.data.userId === String(LIVIO.id)));
  await t.json('POST', `/api/telegram/bots/${RHEA}/people/${LIVIO.id}/approve`);
  return { t, tg };
}

describe('the reply check of a chat with other people', () => {
  it('a long stretch of a note counts, short quotes added up do not', () => {
    const taint = new RunTaint();
    taint.sensitive(LONG_NOTE, 'note', 'Inbox/Fornitore.md');
    // Before: the pieces were added up, over the threshold. Now each stretch is short.
    expect(taint.replyLeak(QUOTES)?.chars ?? 0).toBeLessThan(NOTE_LEAK_CHARS);
    expect(taint.replyLeak(`Ecco: ${LONG_NOTE}`)?.chars ?? 0).toBeGreaterThanOrEqual(
      NOTE_LEAK_CHARS,
    );
    // Without third-party text or a guard: checked all the same (review, problem 11).
    expect(taint.tainted).toBe(false);
  });

  it('the notes of the bot’s project are the group’s own; private notes and the memory stay', () => {
    const taint = new RunTaint();
    taint.sensitive(LONG_NOTE, 'note', 'Progetti/Sito/Fornitore.md');
    const shared = (p: string) => p.toLowerCase().startsWith('progetti/sito/');
    expect(taint.replyLeak(LONG_NOTE, shared)).toBeNull();
    // The same text from a note outside the project counts.
    taint.sensitive(LONG_NOTE, 'note', 'Clienti/Fornitore.md');
    expect(taint.replyLeak(LONG_NOTE, shared)?.kind).toBe('note');
    const priv = new RunTaint();
    priv.sensitive('il codice della cassaforte è sette', 'private', 'Privato/x.md');
    expect(priv.replyLeak('il codice della cassaforte è sette', shared)?.kind).toBe('private');
    const memory = new RunTaint();
    memory.sensitive(LONG_NOTE, 'profile');
    expect(memory.replyLeak(QUOTES, shared)).toMatchObject({ kind: 'profile' });
    expect(memory.replyLeak(QUOTES, shared)!.chars).toBeGreaterThanOrEqual(NOTE_LEAK_CHARS);
  });

  it('in the group: quotes go, a whole note is held; «Manda comunque» sends it once', async () => {
    const { t, tg } = await startGroup([
      fake.toolCall('vault_read', { path: 'Inbox/Fornitore' }),
      fake.text(QUOTES),
      fake.toolCall('vault_read', { path: 'Inbox/Acme' }),
      fake.text(`Ecco: ${NOTE}`),
    ]);
    await t.core.hub.vault.write(
      { agentId: 'system' },
      { path: 'Inbox/Fornitore.md', content: `# Fornitore\n\n${LONG_NOTE}\n` },
    );
    await t.core.hub.vault.write(
      { agentId: 'system' },
      { path: 'Inbox/Acme.md', content: `# Acme\n\n${NOTE}\n` },
    );
    tg.text(LIVIO, '@rhea_saturday_bot cosa abbiamo deciso col fornitore?', {
      chat: GROUP,
      token: RHEA_TOKEN,
    });
    await tg.waitMessage((m) => inGroup(m) && m.text.includes('Marta propone'));

    tg.text(LIVIO, '@rhea_saturday_bot copiami la nota Inbox/Acme', {
      chat: GROUP,
      token: RHEA_TOKEN,
    });
    await tg.waitMessage((m) => inGroup(m) && m.text.includes('I’m not sending this reply here'));
    const notice = await tg.waitMessage(
      (m) => toGiulio(m) && m.text.includes('wanted to reply in the group'),
    );
    expect(JSON.stringify(notice.reply_markup)).toContain('Send anyway');
    expect(tg.messages.some((m) => inGroup(m) && m.text.includes('trentamila'))).toBe(false);
    const refused = t
      .events()
      .find(
        (e): e is LogEvent<'instinct'> =>
          e.type === 'instinct' &&
          e.data.action === 'outbound_refused' &&
          e.data.details?.['tool'] === 'telegram_reply',
      )!;
    // The CLI token cannot send it.
    const viaToken = await withToken(t, 'POST', `/api/telegram/held/${refused.id}/send`);
    expect(viaToken.status).toBe(403);
    // Giulio taps «Manda comunque» on the main bot: it goes to the group, once.
    tg.press(GIULIO, notice, `h:${refused.id}`);
    await tg.waitMessage((m) => inGroup(m) && m.text.includes('trentamila'));
    await t.waitEvent(
      (e): e is LogEvent<'instinct'> =>
        e.type === 'instinct' &&
        e.data.action === 'outbound_approved' &&
        e.data.details?.['heldId'] === refused.id,
    );
    // The path is the user's only: the helper uses the session of the user for it.
    const again = await t.api('POST', `/api/telegram/held/${refused.id}/send`);
    expect(again.status).toBe(409);
    expect(tg.messages.filter((m) => inGroup(m) && m.text.includes('trentamila'))).toHaveLength(1);
  });

  it('a question of the monster to the group passes the same check', async () => {
    const gate = deferred();
    const { t, tg } = await startGroup([
      fake.toolCall('vault_read', { path: 'Inbox/Acme' }),
      fake.text('Fatto.', { gate: gate.promise }),
    ]);
    await t.core.hub.vault.write(
      { agentId: 'system' },
      { path: 'Inbox/Acme.md', content: `# Acme\n\n${NOTE}\n` },
    );
    tg.text(LIVIO, '@rhea_saturday_bot leggi Inbox/Acme', { chat: GROUP, token: RHEA_TOKEN });
    const read = await t.waitEvent(
      (e): e is LogEvent<'tool_result'> =>
        e.type === 'tool_result' && e.data.tool === 'vault_read' && e.data.ok,
    );
    t.core.hub.questions.create({
      agent: 'rhea',
      runId: read.runId!,
      question: `Confermi questi dati? ${NOTE}`,
      options: [
        { id: '1', label: 'Sì' },
        { id: '2', label: 'No' },
      ],
      blocking: false,
    });
    await tg.waitMessage((m) => inGroup(m) && m.text.includes('Giulio’s OK is needed'));
    await tg.waitMessage((m) => toGiulio(m) && m.text.includes('wanted to ask a question'));
    expect(tg.messages.some((m) => inGroup(m) && m.text.includes('trentamila'))).toBe(false);
    gate.resolve();
  });
});

describe('the data folder of the desktop app', () => {
  it('is closed to the monsters on every system', () => {
    // The home the core uses (`os.homedir()`): Windows has no HOME.
    const home = homedir();
    expect(desktopUserDataDirs({}, 'linux')).toContain(join(home, '.config', 'Monsters'));
    expect(desktopUserDataDirs({ XDG_CONFIG_HOME: '/x' }, 'linux')).toContain(
      join('/x', 'Monsters'),
    );
    expect(desktopUserDataDirs({}, 'darwin')).toContain(
      join(home, 'Library', 'Application Support', 'Monsters'),
    );
    expect(desktopUserDataDirs({ APPDATA: 'C:\\A' }, 'win32')[0]).toContain('Monsters');
    expect(desktopUserDataDirs({ MONSTERS_DESKTOP_USER_DATA: '/d' }, 'linux')[0]).toBe('/d');
  });
});
