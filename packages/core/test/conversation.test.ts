import { fake } from '@monsters/providers/testing';
import type { EventInput, LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  EventLog,
  conversationStart,
  coreMigrations,
  migrate,
  openDb,
  recentConversation,
} from '../src/index.ts';
import { BROWSER_HEADERS, browserSession, setupUser } from './helpers.ts';
import { deferred, promptText, startTestHub } from './hub-helpers.ts';

/* "Nuova conversazione": the boundary in the log and the API that writes it. */

function memoryLog() {
  const db = openDb(':memory:');
  migrate(db, 'core', coreMigrations);
  return new EventLog(db);
}

const user = (text: string, to?: string): EventInput<'message'> => ({
  agent: 'user',
  type: 'message',
  data: { role: 'user', text, ...(to ? { to } : {}) },
});
const reply = (agent: string, text: string): EventInput<'message'> => ({
  agent,
  type: 'message',
  data: { role: 'agent', text },
});
const reset = (to?: string): EventInput<'new_conversation'> => ({
  agent: 'user',
  type: 'new_conversation',
  data: { ...(to ? { to } : {}), channel: 'ui' },
});

const titan = { agentId: 'titan', isOrchestrator: true, turns: 20 };
const rhea = { agentId: 'rhea', isOrchestrator: false, turns: 20 };
const texts = (log: EventLog, opts: Parameters<typeof recentConversation>[2]) =>
  recentConversation(log, undefined, opts).map((m) => `${m.role}:${m.content as string}`);

describe('recentConversation with a new conversation', () => {
  it('a general boundary starts over the orchestrator and every agent', () => {
    const log = memoryLog();
    log.append(user('vecchio per Titan'));
    log.append(reply('titan', 'risposta vecchia'));
    log.append(user('vecchio per Rhea', 'rhea'));
    log.append(reply('rhea', 'Rhea vecchia'));
    expect(texts(log, titan)).toEqual(['user:vecchio per Titan', 'assistant:risposta vecchia']);

    log.append(reset());
    expect(texts(log, titan)).toEqual([]);
    expect(texts(log, rhea)).toEqual([]);

    log.append(user('nuovo'));
    log.append(reply('titan', 'risposta nuova'));
    expect(texts(log, titan)).toEqual(['user:nuovo', 'assistant:risposta nuova']);
    // The old turns are still in the log: nothing is deleted.
    expect(log.query({ type: 'message' })).toHaveLength(6);
  });

  it('a boundary for one agent leaves the other conversations alone', () => {
    const log = memoryLog();
    log.append(user('per Titan'));
    log.append(reply('titan', 'Titan risponde'));
    log.append(user('per Rhea', 'rhea'));
    log.append(reply('rhea', 'Rhea risponde'));

    log.append(reset('rhea'));
    expect(texts(log, rhea)).toEqual([]);
    expect(texts(log, titan)).toEqual(['user:per Titan', 'assistant:Titan risponde']);

    log.append(reset('titan'));
    log.append(user('ancora per Rhea', 'rhea'));
    expect(texts(log, titan)).toEqual([]);
    expect(texts(log, rhea)).toEqual(['user:ancora per Rhea']);
  });

  it('drops an answer of the old conversation that lands after the boundary', () => {
    const log = memoryLog();
    log.append(user('lavoro lungo'));
    log.append(reset());
    // The run started before the boundary finishes after it.
    log.append(reply('titan', 'ecco il lavoro lungo'));
    log.append(user('ciao'));
    expect(texts(log, titan)).toEqual(['user:ciao']);
  });

  it('looks for the boundary before `before`, past many boundaries of other agents', () => {
    const log = memoryLog();
    log.append(user('primo'));
    const general = log.append(reset());
    log.append(user('secondo'));
    for (let i = 0; i < 520; i++) log.append(reset('rhea'));
    const later = log.append(reset());
    log.append(user('terzo'));

    expect(conversationStart(log, 'titan')).toBe(later.id);
    expect(conversationStart(log, 'titan', later.id)).toBe(general.id);
    expect(conversationStart(log, 'titan', general.id)).toBeNull();
    expect(texts(log, { ...titan, before: later.id })).toEqual(['user:secondo']);
    expect(texts(log, titan)).toEqual(['user:terzo']);
  });
});

describe('recentConversation: notes of the past runs (AG-19)', () => {
  const inRun = <T extends EventInput>(runId: string, e: T): T => ({ ...e, runId });
  const change = (
    agent: string,
    action: 'create' | 'edit' | 'delete',
    path: string,
  ): EventInput<'vault_change'> => ({ agent, type: 'vault_change', data: { action, path } });

  it('each answer says which notes its run created or changed, by any agent of the run', () => {
    const log = memoryLog();
    log.append(inRun('r1', user('Preparami 3 post sul menu')));
    log.append(inRun('r1', change('rhea', 'create', 'Risorse/Ricerche/Menu autunnale.md')));
    log.append(inRun('r1', change('dione', 'create', 'Inbox/Bozze/Post menu.md')));
    log.append(inRun('r1', change('dione', 'edit', 'Inbox/Bozze/Post menu.md')));
    log.append(inRun('r1', change('dione', 'edit', 'Agenti/Dione/MEMORY.md')));
    log.append(inRun('r1', change('rhea', 'create', 'Inbox/scarto.md')));
    log.append(inRun('r1', change('rhea', 'delete', 'Inbox/scarto.md')));
    log.append(inRun('r1', reply('titan', 'Ecco i 3 post.')));
    // A second turn of the same run lists only its own notes.
    log.append(inRun('r1', user('Accorcia il secondo')));
    log.append(inRun('r1', change('titan', 'edit', 'Inbox/Bozze/Post menu.md')));
    log.append(inRun('r1', reply('titan', 'Accorciato.')));
    log.append(inRun('r2', user('Grazie')));
    log.append(inRun('r2', reply('titan', 'Prego!')));

    expect(texts(log, titan)).toEqual([
      'user:Preparami 3 post sul menu',
      'assistant:Ecco i 3 post.\n\n[Note di questo lavoro: Risorse/Ricerche/Menu autunnale.md, Inbox/Bozze/Post menu.md]',
      'user:Accorcia il secondo',
      'assistant:Accorciato.\n\n[Note di questo lavoro: Inbox/Bozze/Post menu.md]',
      'user:Grazie',
      'assistant:Prego!',
    ]);
  });

  it('lists at most 8 paths', () => {
    const log = memoryLog();
    log.append(inRun('r1', user('Dieci note')));
    for (let i = 0; i < 10; i++)
      log.append(inRun('r1', change('titan', 'create', `Inbox/n${i}.md`)));
    log.append(inRun('r1', reply('titan', 'Fatte.')));
    const last = texts(log, titan).at(-1)!;
    expect(last).toContain('Inbox/n7.md e altre 2]');
    expect(last).not.toContain('Inbox/n8.md');
  });
});

type Sent = { runId: string };

describe('POST /api/conversations', () => {
  it('the next run of the orchestrator no longer sees the old turns', async () => {
    const t = await startTestHub({
      titan: [fake.text('Ciao Giulio!'), fake.text('Nuovo inizio.')],
    });
    const first = await t.json<Sent>('POST', '/api/messages', { text: 'parliamo di Lisbona' });
    await t.runEnded(first.runId);

    const res = await t.api('POST', '/api/conversations', {});
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; ts: number; to?: string };
    expect(body.to).toBeUndefined();
    const event = t.core.log.get(body.id);
    expect(event).toMatchObject({
      type: 'new_conversation',
      agent: 'user',
      data: { channel: 'cli' },
    });

    const second = await t.json<Sent>('POST', '/api/messages', { text: 'parliamo di Roma' });
    await t.runEnded(second.runId);
    const seen = promptText(t.provider.calls[1]!.options.prompt);
    expect(seen).toContain('parliamo di Roma');
    expect(seen).not.toContain('Lisbona');
    expect(seen).not.toContain('Ciao Giulio!');
  });

  it('starts over one agent by name; unknown agents are refused', async () => {
    const t = await startTestHub({});
    const res = await t.api('POST', '/api/conversations', { to: 'Rhea' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ to: 'rhea' });
    const unknown = await t.api('POST', '/api/conversations', { to: 'nessuno' });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: 'unknown_agent' });
    const invalid = await t.api('POST', '/api/conversations', { to: 3 });
    expect(invalid.status).toBe(400);
  });

  it('refuses a `to` made of spaces instead of starting over everyone', async () => {
    const t = await startTestHub({});
    const res = await t.api('POST', '/api/conversations', { to: '   ' });
    expect(res.status).toBe(400);
    expect(t.core.log.query({ type: 'new_conversation' })).toHaveLength(0);
    const padded = await t.api('POST', '/api/conversations', { to: ' Rhea ' });
    expect(await padded.json()).toMatchObject({ to: 'rhea' });
  });

  it('is refused while an agent it applies to is working', async () => {
    const release = deferred();
    const t = await startTestHub({
      rhea: [fake.text('Fatto', { gate: release.promise })],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@rhea cerca' });

    const busy = await t.api('POST', '/api/conversations', {});
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ error: 'busy', message: /Rhea sta ancora/ });
    expect((await t.api('POST', '/api/conversations', { to: 'rhea' })).status).toBe(409);
    // Another agent's conversation can start over meanwhile.
    expect((await t.api('POST', '/api/conversations', { to: 'titan' })).status).toBe(201);

    release.resolve();
    await t.runEnded(sent.runId);
    expect((await t.api('POST', '/api/conversations', {})).status).toBe(201);
  });

  it('is allowed while the kill switch is engaged (it starts no work)', async () => {
    const t = await startTestHub({});
    expect((await t.api('POST', '/api/kill', {})).status).toBe(200);
    expect((await t.api('POST', '/api/messages', { text: 'ciao' })).status).toBe(409);
    expect((await t.api('POST', '/api/conversations', {})).status).toBe(201);
    expect(t.core.runs.halted).toBe(true);
  });

  it('needs auth, and the anti-CSRF header with the session cookie', async () => {
    const t = await startTestHub({});
    const anonymous = await fetch(`${t.core.url}/api/conversations`, {
      method: 'POST',
      headers: BROWSER_HEADERS,
      body: '{}',
    });
    expect(anonymous.status).toBe(401);

    const auth = await browserSession(await setupUser(t.core));
    const noHeader = await fetch(`${t.core.url}/api/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: '{}',
    });
    expect(noHeader.status).toBe(403);
    expect(t.core.log.query({ type: 'new_conversation' })).toHaveLength(0);

    const ok = await fetch(`${t.core.url}/api/conversations`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, ...auth },
      body: '{}',
    });
    expect(ok.status).toBe(201);
    expect(t.core.log.query({ type: 'new_conversation' })[0]?.data).toEqual({ channel: 'ui' });
  });

  it('a late answer after the boundary reaches the asker together with its question', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('ask_user', {
          question: 'Pubblico il post su Lisbona?',
          options: ['Sì', 'No'],
          blocking: false,
          kind: 'publish',
        }),
        fake.text('Ti ho chiesto, intanto ho finito.'),
        fake.text('Pubblicato.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'prepara il post' });
    await t.runEnded(sent.runId);
    const question = t.core.log.query({ runId: sent.runId, type: 'question' })[0]!;
    expect((await t.api('POST', '/api/conversations', {})).status).toBe(201);

    const questionId = (question.data as { questionId: string }).questionId;
    const res = await t.api('POST', `/api/questions/${questionId}/answer`, { optionId: '1' });
    expect(res.status).toBe(200);
    const next = await t.waitEvent(
      (e): e is LogEvent<'run'> =>
        e.type === 'run' && e.data.status === 'started' && e.runId !== sent.runId,
    );
    expect(next.agent).toBe('titan');
    await t.runEnded(next.runId!);
    const seen = promptText(t.provider.calls[2]!.options.prompt);
    // The old turns are gone, but the agent knows what the answer is about.
    expect(seen).toContain('Pubblico il post su Lisbona?');
    expect(seen).toContain('Sì');
    expect(seen).not.toContain('prepara il post');
  });

  it('waits for the first start like the messages', async () => {
    const t = await startTestHub({}, { withoutTeam: true });
    const res = await t.api('POST', '/api/conversations', {});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'onboarding_pending' });
  });
});
