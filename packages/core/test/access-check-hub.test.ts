import { fake } from '@monsters/providers/testing';
import type { LogEvent } from '@monsters/shared';
import { setAppLang } from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promptText, startTestHub as startHub } from './hub-helpers.ts';

// The texts the models read are tested in Italian (the family of the app language, byte for byte
// what they were); the English ones are checked in the blocks that switch the language.
beforeEach(() => setAppLang('it'));
afterEach(() => setAppLang('en'));

// Starting a core picks the language of the system: the test says which one it wants.
const startTestHub: typeof startHub = async (...args) => {
  const hub = await startHub(...args);
  setAppLang('it');
  return hub;
};

/*
 * D-140 and D-141 on a real core with the fake provider: the check of the end of the turn
 * (orchestrator, a monster in direct chat, a delegated one), the true no of the user that
 * does not trigger it, «Da ricordare:» and MEMORY.md without lines about accesses, and the
 * note of the first run after the accesses changed.
 */

type Sent = { runId: string };

const of = <T extends LogEvent['type']>(events: LogEvent[], type: T) =>
  events.filter((e) => e.type === type) as LogEvent<T>[];
const systemMessages = (events: LogEvent[], agent: string) =>
  of(events, 'message').filter((e) => e.agent === agent && e.data.role === 'system');
const finals = (events: LogEvent[], agent: string) =>
  of(events, 'message')
    .filter((e) => e.agent === agent && e.data.role === 'agent' && !e.data.partial)
    .map((e) => e.data.text);
const claims = (events: LogEvent[]) =>
  of(events, 'instinct').filter((e) => e.data.action === 'access_claim');

describe('the check of the end of the turn (D-140)', () => {
  it('the orchestrator says the web was denied: it gets the true cause once and rewrites', async () => {
    const t = await startTestHub({
      titan: [
        fake.text('Il web mi è stato negato in questa sessione, quindi non ho cercato.'),
        fake.text('Il web non è tra i miei strumenti: la ricerca la fa Rhea.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Cerca i prezzi' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const events = t.events(sent.runId);
    const [reminder] = systemMessages(events, 'titan');
    expect(reminder?.data.text).toContain('[Controllo del sistema]');
    expect(reminder?.data.text).toContain('Il web mi è stato negato in questa sessione');
    // The cause of now: not one of its tools, Rhea has it; never a no of the user.
    expect(reminder?.data.text).toContain('Rhea');
    expect(finals(events, 'titan')).toEqual([
      'Il web non è tra i miei strumenti: la ricerca la fa Rhea.',
    ]);
    expect(claims(events)).toHaveLength(1);
    expect(promptText(t.provider.calls[1]!.options.prompt)).toContain('[Controllo del sistema]');
  });

  it('a delegated monster with the web says it was denied: the report is rewritten', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('delegate', { agent: 'Rhea', goal: 'I prezzi dei biglietti del museo' }),
        fake.text('Ecco i prezzi.'),
      ],
      rhea: [
        fake.text('Non ho trovato niente: la ricerca web è stata rifiutata dai permessi.'),
        fake.text('Biglietto intero 12 €, ridotto 8 € (sito del museo).'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Prezzi del museo' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const events = t.events(sent.runId);
    expect(systemMessages(events, 'rhea')[0]?.data.text).toContain('il web: ce l’hai');
    const done = of(events, 'delegation').find((e) => e.data.status === 'completed')!;
    expect(done.data.summary).toBe('Biglietto intero 12 €, ridotto 8 € (sito del museo).');
    expect(claims(events).map((e) => e.data.subject)).toEqual(['rhea']);
  });

  it('a true no of the user and a service really not connected: no reminder', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('ask_user', {
          question: 'Mando la mail a Marco?',
          options: ['Sì', 'No'],
          recommended: 'No',
          kind: 'publish',
        }),
        fake.text(
          'Hai detto no: la mail a Marco non è partita. Notion non è collegato, quindi la bozza è nelle note.',
        ),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'La mail a Marco' });
    const q = await t.waitEvent(
      (e): e is LogEvent<'question'> => e.type === 'question' && e.runId === sent.runId,
    );
    await t.json('POST', `/api/questions/${q.data.questionId}/answer`, { optionId: '2' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const events = t.events(sent.runId);
    expect(claims(events)).toEqual([]);
    expect(systemMessages(events, 'titan')).toEqual([]);
  });

  it('"hai detto no" without any no of the user: flagged', async () => {
    const t = await startTestHub({
      dione: [
        fake.text('Hai rifiutato l’accesso al web, quindi ho scritto senza fonti.'),
        fake.text('Ho scritto il testo con quello che c’era nelle note.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Dione scrivi il post' });
    await t.runEnded(sent.runId);
    const events = t.events(sent.runId);
    expect(systemMessages(events, 'dione')[0]?.data.text).toContain('nessun no dell’utente');
    expect(finals(events, 'dione')).toEqual([
      'Ho scritto il testo con quello che c’era nelle note.',
    ]);
  });
});

describe('memory and accesses (D-141)', () => {
  it('«Da ricordare:» keeps the lines about the work, not those about the accesses', async () => {
    const answer =
      'Fatto.\n\nDa ricordare:\n- La ricerca web è negata in modalità «don’t ask».\n- Giulio preferisce i post brevi.';
    const t = await startTestHub({ dione: [fake.text(answer), fake.text(answer)] });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Dione il post' });
    await t.runEnded(sent.runId);
    await t.waitEvent(
      (e): e is LogEvent<'instinct'> =>
        e.type === 'instinct' && e.data.action === 'memory_skipped' && e.runId === sent.runId,
    );
    const memory = await t.core.hub.team.memory('dione');
    expect(memory).toContain('Giulio preferisce i post brevi');
    expect(memory).not.toContain('negata');
  });

  it('MEMORY.md written with the vault tools refuses a line about accesses', async () => {
    const t = await startTestHub({
      rhea: [
        fake.toolCall('vault_edit', {
          path: 'Agenti/Rhea/MEMORY.md',
          base_hash: '0123456789abcdef',
          ops: [{ append: { text: '- Canva non è collegato: non provarci più.' } }],
        }),
        fake.text('Ok.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Rhea ricordatelo' });
    await t.runEnded(sent.runId);
    const result = of(t.events(sent.runId), 'tool_result').find(
      (e) => e.data.tool === 'vault_edit',
    );
    expect(result?.data.ok).toBe(false);
    expect(result?.data.error).toContain('do not go in a memory');
  });

  it('the first run after the accesses changed gets a note, the next one does not', async () => {
    const t = await startTestHub({
      rhea: [fake.text('Ciao.'), fake.text('Ciao di nuovo.'), fake.text('Ancora ciao.')],
    });
    const first = await t.json<Sent>('POST', '/api/messages', { text: '@Rhea ciao' });
    await t.runEnded(first.runId);
    expect(promptText(t.provider.calls[0]!.options.prompt)).not.toContain('[Accessi cambiati]');
    await t.json('PUT', '/api/permissions', { agents: { rhea: { vault: true, web: false } } });
    const second = await t.json<Sent>('POST', '/api/messages', { text: '@Rhea ciao' });
    await t.runEnded(second.runId);
    const seen = promptText(t.provider.calls[1]!.options.prompt);
    expect(seen).toContain('[Accessi cambiati]');
    expect(seen).toContain('non hai più comandi e file e il web');
    const third = await t.json<Sent>('POST', '/api/messages', { text: '@Rhea ciao' });
    await t.runEnded(third.runId);
    expect(promptText(t.provider.calls[2]!.options.prompt)).not.toContain('[Accessi cambiati]');
  });

  it('the system prompt ends with the accesses of now, after the memory', async () => {
    const t = await startTestHub({ rhea: [fake.text('Ciao.')] });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Rhea ciao' });
    await t.runEnded(sent.runId);
    const seen = promptText(t.provider.calls[0]!.options.prompt);
    expect(seen.indexOf('## Accessi di adesso')).toBeGreaterThan(seen.indexOf('## La tua memoria'));
  });
});
