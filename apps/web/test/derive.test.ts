import { originalRequest, ulid, type EventInput, type LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { newConversationCommand } from '../src/components/chat/Composer.tsx';
import { buildTerminal } from '../src/components/terminal/entries.ts';
import {
  applyLive,
  buildChat,
  chatSummary,
  chatThread,
  countMessages,
  delegationGroupLabel,
  describeEvent,
  doneSummary,
  groupDelegations,
  haltedWork,
  haltedResumeText,
  haltedWorkText,
  isUndoable,
  isUserNoteChange,
  makeNameOf,
  noteIndex,
  previewText,
  questionHome,
  recentMemoryOwners,
  reportOutcome,
  reportSentence,
  questionsClosedAt,
  resumeText,
  retryOf,
  runOwners,
  splitConversation,
  telegramWhere,
  threadsOf,
  withoutRepeatedStops,
  type ChatItem,
  type ChatScope,
  type LiveState,
} from '../src/store/derive.ts';

let clock = 1_760_000_000_000;
function ev<T extends EventInput>(input: T): LogEvent {
  clock += 1000;
  return {
    id: ulid(clock),
    ts: clock,
    agent: input.agent,
    runId: input.runId ?? null,
    parentId: input.parentId ?? null,
    type: input.type,
    data: input.data,
  } as LogEvent;
}

describe('new conversation in the chat', () => {
  const say = (text: string, to?: string) =>
    ev({ agent: 'user', type: 'message', data: { role: 'user', text, ...(to ? { to } : {}) } });
  const reply = (agent: string, text: string) =>
    ev({ agent, type: 'message', data: { role: 'agent', text } });
  const reset = (to?: string) =>
    ev({ agent: 'user', type: 'new_conversation', data: { ...(to ? { to } : {}), channel: 'ui' } });
  const question = (questionId: string) =>
    ev({
      agent: 'titan',
      runId: 'r1',
      type: 'question',
      data: { questionId, question: 'Che tono?', options: [], blocking: false },
    });

  it('starts over after the latest general boundary and carries the open questions', () => {
    const events = [
      say('vecchio'),
      reply('titan', 'risposta vecchia'),
      question('q-open'),
      question('q-done'),
      reset(),
      say('di mezzo'),
      reset('rhea'),
      reset(),
      say('nuovo'),
    ];
    const items = buildChat(events, []);
    const view = splitConversation(items, (id, boundary) => {
      expect(boundary).toBe(events[7]!.id);
      return id === 'q-open';
    });
    expect(view.boundary).toMatchObject({ kind: 'reset', id: events[7]!.id });
    expect(view.current.map((i) => i.kind)).toEqual(['user']);
    expect(view.earlier.map((i) => i.kind)).toEqual([
      'user',
      'agent',
      'question',
      'question',
      'reset',
      'user',
      'reset',
    ]);
    expect(view.carried.map((q) => q.questionId)).toEqual(['q-open']);
  });

  it('knows when each question was closed', () => {
    const events = [
      question('q1'),
      ev({ agent: 'user', type: 'answer', data: { questionId: 'q1', optionId: 'a' } }),
      question('q2'),
      ev({ agent: 'titan', type: 'question_expired', data: { questionId: 'q2', reason: 'kill' } }),
    ];
    const closed = questionsClosedAt(events);
    expect(closed.get('q1')).toBe(events[1]!.id);
    expect(closed.get('q2')).toBe(events[3]!.id);
    expect(closed.has('q3')).toBe(false);
  });

  it('a new conversation with one monster starts over its chat only', () => {
    const events = [say('ciao'), say('a te', 'rhea'), reset('rhea'), say('ancora')];
    const items = buildChat(events, []);
    const scope = { orchestrator: 'titan', owners: runOwners(events) };
    const titan = chatThread(items, 'titan', scope);
    expect(titan.map((i) => i.kind)).toEqual(['user', 'user']);
    expect(splitConversation(titan, () => true).boundary).toBeUndefined();
    const rhea = chatThread(items, 'rhea', scope);
    const view = splitConversation(rhea, () => true);
    expect(view.boundary).toMatchObject({ kind: 'reset', to: 'rhea' });
    expect(view.earlier.map((i) => (i.kind === 'user' ? i.text : i.kind))).toEqual(['a te']);
    expect(view.current).toEqual([]);
  });

  it('describes the event and recognises /nuova in the composer', () => {
    const nameOf = makeNameOf({});
    expect(describeEvent(reset(), nameOf)).toBe('Hai iniziato una nuova conversazione');
    expect(describeEvent(reset('rhea'), nameOf)).toBe(
      'Hai iniziato una nuova conversazione con Rhea',
    );
    expect(newConversationCommand('/nuova')).toEqual({ to: undefined });
    expect(newConversationCommand('/new @Rhea')).toEqual({ to: 'Rhea' });
    expect(newConversationCommand('/nuova idea per il post')).toBeNull();
    expect(newConversationCommand('scrivi /nuova')).toBeNull();
    // A recipient picked with @ before the command: only that conversation starts over.
    expect(newConversationCommand('@Rhea /nuova')).toEqual({ to: 'Rhea' });
    expect(newConversationCommand('@Rhea  /new ')).toEqual({ to: 'Rhea' });
    expect(newConversationCommand('@Rhea /nuova @Dione')).toBeNull();
    expect(newConversationCommand('@Rhea scrivi /nuova')).toBeNull();
  });
});

describe('one chat per monster', () => {
  const events = [
    // Titan's run: a request without addressee, a delegation to Rhea, Rhea asks.
    ev({ agent: 'user', runId: 'r1', type: 'message', data: { role: 'user', text: 'Post?' } }),
    ev({ agent: 'titan', runId: 'r1', type: 'run', data: { status: 'started', goal: 'Post' } }),
    ev({
      agent: 'titan',
      runId: 'r1',
      type: 'delegation',
      data: { from: 'titan', to: 'rhea', status: 'started', goal: 'Cerca spunti' },
    }),
    ev({
      agent: 'rhea',
      runId: 'r1',
      type: 'question',
      data: { questionId: 'q1', question: 'Quante fonti?', options: [], blocking: true },
    }),
    // A direct chat with Dione, logged by the core with `to` (D-027).
    ev({
      agent: 'user',
      runId: 'r2',
      type: 'message',
      data: { role: 'user', text: 'Una bio?', to: 'dione' },
    }),
    ev({ agent: 'dione', runId: 'r2', type: 'message', data: { role: 'agent', text: 'Eccola' } }),
    ev({ agent: 'user', type: 'kill', data: { scope: 'global', by: 'ui' } }),
    ev({
      agent: 'mimas',
      runId: 'r3',
      type: 'error',
      data: { code: 'agent_failed', message: 'Foglio bloccato' },
    }),
  ];
  const items = buildChat(events, []);
  const scope: ChatScope = { orchestrator: 'titan', owners: runOwners(events) };
  const kinds = (id: string) => chatThread(items, id, scope).map((i) => i.kind);

  it('knows who owns each run', () => {
    expect(scope.owners.get('r1')).toBe('titan');
    expect(scope.owners.get('r2')).toBe('dione');
    expect(scope.owners.has('r3')).toBe(false);
  });

  it('splits the timeline as the core splits the conversations', () => {
    expect(kinds('titan')).toEqual(['user', 'delegation', 'question', 'system']);
    // Rhea sees the task she got and her own question; the stop is everybody's.
    expect(kinds('rhea')).toEqual(['delegation', 'question', 'system']);
    expect(kinds('dione')).toEqual(['user', 'agent', 'system']);
    expect(kinds('mimas')).toEqual(['system', 'error']);
    const q = items.find(
      (i): i is Extract<ChatItem, { kind: 'question' }> => i.kind === 'question',
    )!;
    expect(threadsOf(q, scope)).toEqual(['titan', 'rhea']);
    expect(questionHome(q, scope)).toBe('titan');
  });

  it('summarises a chat for the list: last item, unread since the last one seen', () => {
    const dione = chatThread(items, 'dione', scope);
    const all = chatSummary(dione, '');
    expect(all.unread).toBe(1);
    // A stop is not a preview when there is something else.
    expect(all.last).toMatchObject({ kind: 'agent', text: 'Eccola' });
    expect(chatSummary(dione, events[5]!.id).unread).toBe(0);
    const nameOf = makeNameOf({});
    expect(previewText(dione[0]!, nameOf)).toBe('Tu: Una bio?');
    expect(previewText(chatThread(items, 'rhea', scope)[0]!, nameOf)).toBe(
      'Compito per Rhea: Cerca spunti',
    );
  });
});

describe('buildChat', () => {
  it('assembles streamed deltas and replaces the draft with the final message', () => {
    const events = [
      ev({ agent: 'user', runId: 'r', type: 'message', data: { role: 'user', text: 'ciao' } }),
      ev({
        agent: 'titan',
        runId: 'r',
        type: 'message',
        data: { role: 'agent', text: 'Ci', partial: true },
      }),
      ev({
        agent: 'titan',
        runId: 'r',
        type: 'message',
        data: { role: 'agent', text: 'ao!', partial: true },
      }),
    ];
    let chat = buildChat(events, []);
    expect(chat.map((c) => c.kind)).toEqual(['user', 'agent']);
    expect(chat[1]).toMatchObject({ text: 'Ciao!', streaming: true });

    events.push(
      ev({
        agent: 'titan',
        runId: 'r',
        type: 'message',
        data: { role: 'agent', text: 'Ciao! Come va?' },
      }),
    );
    chat = buildChat(events, []);
    expect(chat).toHaveLength(2);
    expect(chat[1]).toMatchObject({ text: 'Ciao! Come va?', streaming: false });
  });

  it('keeps text said before a tool call and does not repeat it', () => {
    const events = [
      ev({
        agent: 'titan',
        runId: 'r',
        type: 'message',
        data: { role: 'agent', text: 'Chiedo a Rhea.', partial: true },
      }),
      ev({
        agent: 'titan',
        runId: 'r',
        type: 'tool_call',
        data: { callId: '1', tool: 'delegate', input: {} },
      }),
      ev({
        agent: 'titan',
        runId: 'r',
        type: 'message',
        data: { role: 'agent', text: 'Chiedo a Rhea.' },
      }),
    ];
    const chat = buildChat(events, []);
    expect(chat.filter((c) => c.kind === 'agent')).toHaveLength(1);
    expect(chat[0]).toMatchObject({ text: 'Chiedo a Rhea.', streaming: false });
  });

  it('a final answer made of several steps shows each part once (Phase 2 demo)', () => {
    const msg = (text: string, partial?: boolean) =>
      ev({
        agent: 'rhea',
        runId: 'r',
        type: 'message',
        data: { role: 'agent', text, ...(partial ? { partial } : {}) },
      });
    const call = () =>
      ev({
        agent: 'rhea',
        runId: 'r',
        type: 'tool_call',
        data: { callId: 'x', tool: 'shell', input: {} },
      });
    // Two steps without a tool call in between: one draft, the final has both parts.
    let chat = buildChat(
      [
        msg('Il titolo è "Example Domain".', true),
        msg('Non posso usare il terminale.', true),
        msg('Il titolo è "Example Domain".\n\nNon posso usare il terminale.'),
      ],
      [],
    );
    expect(chat.map((c) => (c.kind === 'agent' ? c.text : c.kind))).toEqual([
      'Il titolo è "Example Domain".\n\nNon posso usare il terminale.',
    ]);
    // A tool call in between: the first part stays in its bubble, the second is not repeated.
    chat = buildChat(
      [
        msg('Il titolo è "Example Domain".', true),
        call(),
        msg('La versione installata è la 2.53.', true),
        msg('Il titolo è "Example Domain".\n\nLa versione installata è la 2.53.'),
      ],
      [],
    );
    expect(chat.map((c) => (c.kind === 'agent' ? c.text : c.kind))).toEqual([
      'Il titolo è "Example Domain".',
      'La versione installata è la 2.53.',
    ]);
  });

  it('hides delegated work and merges delegation start and end', () => {
    const start = ev({
      agent: 'titan',
      runId: 'r',
      type: 'delegation',
      data: { from: 'titan', to: 'rhea', status: 'started', goal: 'cerca' },
    });
    const events = [
      start,
      ev({
        agent: 'rhea',
        runId: 'r',
        parentId: start.id,
        type: 'message',
        data: { role: 'agent', text: 'fatto' },
      }),
      ev({
        agent: 'titan',
        runId: 'r',
        type: 'delegation',
        data: {
          from: 'titan',
          to: 'rhea',
          status: 'completed',
          goal: 'cerca',
          summary: '5 spunti',
        },
      }),
    ];
    const chat = buildChat(events, []);
    expect(chat).toHaveLength(1);
    expect(chat[0]).toMatchObject({ kind: 'delegation', status: 'completed', summary: '5 spunti' });
  });

  it('shows pending sends until the core echoes them', () => {
    const pending = [{ tempId: 'p1', text: 'ehi', ts: clock }];
    expect(buildChat([], pending)[0]).toMatchObject({ kind: 'user', pending: true });
    const echoed = [ev({ agent: 'user', type: 'message', data: { role: 'user', text: 'ehi' } })];
    expect(buildChat(echoed, pending)).toHaveLength(1);
    expect(buildChat(echoed, pending)[0]).not.toHaveProperty('pending');
  });
});

describe('applyLive', () => {
  const ids = ['titan', 'rhea'];
  it('a turn that ends on a parked question waits for the user (D-078)', () => {
    let live: Record<string, LiveState> = {};
    const step = (e: Parameters<typeof ev>[0]) => (live = applyLive(live, ev(e), ids));
    step({ agent: 'titan', type: 'run', data: { status: 'started', goal: 'post' } });
    step({
      agent: 'titan',
      type: 'message',
      data: { role: 'agent', text: 'Aspetto la risposta.' },
    });
    expect(live['titan']?.mood).toBe('done');
    step({
      agent: 'titan',
      type: 'question_parked',
      data: { questionId: 'q1', reason: 'harness' },
    });
    step({ agent: 'titan', type: 'run', data: { status: 'waiting_user' } });
    expect(live['titan']).toMatchObject({ mood: 'waiting', activity: 'Ti ho fatto una domanda' });
    // After a restart: the run was cut, the question waits again.
    step({ agent: 'titan', type: 'run', data: { status: 'aborted', reason: 'restart' } });
    expect(live['titan']?.mood).toBe('stopped');
    step({
      agent: 'titan',
      type: 'question_parked',
      data: { questionId: 'q1', reason: 'restart' },
    });
    expect(live['titan']?.mood).toBe('waiting');
    step({ agent: 'user', type: 'answer', data: { questionId: 'q1', optionId: '1' } });
    expect(live['titan']).toMatchObject({ mood: 'working' });
  });

  it('follows a delegation and a kill', () => {
    let live: Record<string, LiveState> = {};
    live = applyLive(
      live,
      ev({
        agent: 'titan',
        type: 'delegation',
        data: { from: 'titan', to: 'rhea', status: 'started', goal: 'Cerca voli' },
      }),
      ids,
    );
    expect(live['rhea']).toMatchObject({ mood: 'working', activity: 'Cerca voli' });
    expect(live['titan']?.mood).toBe('waiting');
    live = applyLive(
      live,
      ev({
        agent: 'rhea',
        type: 'tool_call',
        data: { callId: 'x', tool: 'web_search', input: { query: 'voli' } },
      }),
      ids,
    );
    expect(live['rhea']?.activity).toBe('Cerco “voli”');
    live = applyLive(
      live,
      ev({ agent: 'system', type: 'kill', data: { scope: 'global', by: 'ui' } }),
      ids,
    );
    expect(live['rhea']?.mood).toBe('stopped');
    expect(live['titan']?.mood).toBe('stopped');
  });

  it('returns the same object when nothing changes', () => {
    const live = {};
    expect(
      applyLive(live, ev({ agent: 'system', type: 'auth', data: { action: 'login' } }), ids),
    ).toBe(live);
  });
});

describe('describeEvent and undo', () => {
  const nameOf = (id: string) => id[0]!.toUpperCase() + id.slice(1);
  it('starts the reason of an error in lower case after the colon, keeping names', () => {
    const err = (message: string) =>
      ev({ agent: 'mimas', type: 'error', data: { code: 'tool_failed', message } });
    expect(describeEvent(err('Il foglio non esiste.'), nameOf)).toBe(
      'Mimas ha avuto un problema: il foglio non esiste.',
    );
    expect(describeEvent(err('Telegram non risponde.'), nameOf)).toBe(
      'Mimas ha avuto un problema: Telegram non risponde.',
    );
  });
  it('speaks plain Italian', () => {
    const e = ev({
      agent: 'rhea',
      type: 'vault_change',
      data: { action: 'create', path: 'Risorse/Idee.md', actionId: 'a1' },
    });
    expect(describeEvent(e, nameOf)).toBe('Rhea ha creato la nota Idee');
    expect(isUndoable(e)).toBe(true);
    const undo = ev({
      agent: 'user',
      type: 'vault_change',
      data: { action: 'undo', path: 'Risorse/Idee.md' },
    });
    expect(isUndoable(undo)).toBe(false);
    expect(describeEvent(undo, makeNameOf({}))).toBe('Hai annullato una modifica a Idee');
  });

  const names = makeNameOf({});
  const say = (input: EventInput) => describeEvent(ev(input), names);

  it('needs no gender for agents and says what a stop is', () => {
    const texts = [
      say({
        agent: 'rhea',
        type: 'error',
        data: { code: 'aborted', message: 'Rhea interrotto: stopped (global)' },
      }),
      say({ agent: 'bruno', type: 'run', data: { status: 'failed' } }),
      say({ agent: 'bruno', type: 'run', data: { status: 'aborted' } }),
      say({
        agent: 'bruno',
        type: 'delegation',
        data: { from: 'bruno', to: 'rhea', status: 'failed', goal: 'x' },
      }),
      say({
        agent: 'bruno',
        type: 'tool_result',
        data: { callId: 'c', tool: 'delegate', ok: false, error: 'stopped (global)' },
      }),
    ];
    expect(texts).toEqual([
      'Il lavoro di Rhea si è fermato',
      'Il lavoro di Bruno non è andato a buon fine',
      'Il lavoro di Bruno si è fermato',
      'Il compito di Rhea per Bruno non è andato a buon fine',
      'Bruno ha lasciato a metà la delega',
    ]);
    for (const t of texts) expect(t).not.toMatch(/stopped|global|interrott[oa]\b|riuscit[oa]/);
  });

  it('says a stop once per agent', () => {
    const events = [
      ev({ agent: 'bruno', runId: 'r', type: 'error', data: { code: 'aborted', message: 'x' } }),
      ev({ agent: 'rhea', runId: 'r', type: 'error', data: { code: 'aborted', message: 'x' } }),
      ev({ agent: 'bruno', runId: 'r', type: 'run', data: { status: 'aborted' } }),
    ];
    expect(withoutRepeatedStops(events).map((e) => describeEvent(e, names))).toEqual([
      'Il lavoro di Rhea si è fermato',
      'Il lavoro di Bruno si è fermato',
    ]);
  });

  it('never shows the closing of a stopped turn as an answer', () => {
    // A kill: the run closes first, then the agent closes its draft with an empty message.
    const events = [
      ev({
        agent: 'dione',
        runId: 'r',
        type: 'message',
        data: { role: 'agent', text: 'Sto scri', partial: true },
      }),
      ev({
        agent: 'system',
        runId: 'r',
        type: 'kill',
        data: { scope: 'run', target: 'r', by: 'ui' },
      }),
      ev({ agent: 'dione', runId: 'r', type: 'run', data: { status: 'aborted' } }),
      ev({ agent: 'dione', runId: 'r', type: 'error', data: { code: 'aborted', message: 'x' } }),
      ev({
        agent: 'dione',
        runId: 'r',
        type: 'message',
        data: { role: 'agent', text: '', status: 'aborted' },
      }),
    ];
    const texts = withoutRepeatedStops(events)
      .filter((e) => !(e.type === 'message' && e.data.partial))
      .map((e) => describeEvent(e, names));
    expect(texts).toEqual(['Un lavoro è stato fermato', 'Il lavoro di Dione si è fermato']);
    for (const t of texts) expect(t).not.toMatch(/ha risposto/);
    expect(describeEvent(events[4]!, names)).toBe('Dione si è fermato mentre scriveva');
    // In the chat the draft just stops: no second, empty bubble.
    const chat = buildChat(events, []).filter((it) => it.kind === 'agent');
    expect(chat).toHaveLength(1);
    expect(chat[0]).toMatchObject({ text: 'Sto scri', streaming: false });
  });

  it('never shows tool names, codes or model ids raw', () => {
    expect(
      say({
        agent: 'rhea',
        type: 'tool_result',
        data: { callId: 'c', tool: 'web_search', ok: true },
      }),
    ).toBe('Rhea ha finito la ricerca sul web');
    expect(
      say({
        agent: 'bruno',
        type: 'decision',
        data: {
          kind: 'ask_or_proceed',
          question: 'Che tono?',
          options: ['a', 'b'],
          choice: 'ask_user',
          decidedBy: 'rules',
        },
      }),
    ).toBe('Bruno ha deciso di chiedere a te');
    expect(
      say({
        agent: 'rhea',
        type: 'provider_usage',
        data: { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
      }),
    ).toBe('Rhea ha usato il modello nemotron-3-super-120b-a12b (gratis)');
    expect(
      say({
        agent: 'rhea',
        type: 'error',
        data: { code: 'search_fallback', message: 'web_search: duckduckgo: CAPTCHA → wikipedia' },
      }),
    ).toBe('La ricerca sul web non rispondeva: Rhea cerca su Wikipedia');
  });

  it('describes the agents’ own files as their notes to self, not as notes', () => {
    expect(
      say({
        agent: 'rhea',
        type: 'vault_change',
        data: { action: 'edit', path: 'Agenti/Rhea/MEMORY.md', actionId: 'm1' },
      }),
    ).toBe('Rhea ha aggiornato i suoi appunti');
    expect(
      say({
        agent: 'system',
        type: 'vault_change',
        data: { action: 'delete', path: 'Agenti/Titan/MEMORY.md', actionId: 'm2' },
      }),
    ).toBe('Appunti di Titan nel cestino');
  });

  it('keeps memories and housekeeping out of the recent notes', () => {
    const events = [
      ev({
        agent: 'system',
        type: 'vault_change',
        data: { action: 'delete', path: 'Agenti/Titan/MEMORY.md', actionId: 'a' },
      }),
      ev({
        agent: 'bruno',
        type: 'vault_change',
        data: { action: 'create', path: 'Agenti/Bruno/MEMORY.md', actionId: 'b' },
      }),
      ev({
        agent: 'rhea',
        type: 'vault_change',
        data: { action: 'edit', path: 'Agenti/Rhea/MEMORY.md', actionId: 'c' },
      }),
      ev({
        agent: 'rhea',
        type: 'vault_change',
        data: { action: 'create', path: 'Risorse/Menu.md', actionId: 'd' },
      }),
    ];
    expect(events.filter(isUserNoteChange).map((e) => e.id)).toEqual([events[3]!.id]);
    expect(recentMemoryOwners(events)).toEqual(['Rhea', 'Bruno']);
  });
});

describe('buildTerminal', () => {
  it('pairs tool calls with results and turns the last thought into the message', () => {
    const events = [
      ev({
        agent: 'rhea',
        runId: 'r',
        type: 'message',
        data: { role: 'agent', text: 'Cerco… ', partial: true },
      }),
      ev({
        agent: 'rhea',
        runId: 'r',
        type: 'tool_call',
        data: { callId: 'c', tool: 'web_search', input: { query: 'x' } },
      }),
      ev({
        agent: 'rhea',
        runId: 'r',
        type: 'tool_result',
        data: { callId: 'c', tool: 'web_search', ok: false, error: 'boom' },
      }),
      ev({
        agent: 'rhea',
        runId: 'r',
        type: 'message',
        data: { role: 'agent', text: 'Fatto', partial: true },
      }),
      ev({ agent: 'rhea', runId: 'r', type: 'message', data: { role: 'agent', text: 'Fatto.' } }),
      ev({ agent: 'titan', runId: 'r', type: 'message', data: { role: 'agent', text: 'altro' } }),
    ];
    const t = buildTerminal(events, 'rhea');
    expect(t.map((e) => e.kind)).toEqual(['thought', 'tool', 'message']);
    expect(t[1]).toMatchObject({ tool: 'web_search', result: { ok: false, error: 'boom' } });
    expect(t[2]).toMatchObject({ text: 'Fatto.' });
  });

  it('stops the live thought of a run that was stopped (even without a closing message)', () => {
    const events = [
      ev({
        agent: 'rhea',
        runId: 'r',
        type: 'message',
        data: { role: 'agent', text: 'Sto pens', partial: true },
      }),
      ev({ agent: 'titan', runId: 'r', type: 'run', data: { status: 'aborted' } }),
    ];
    const t = buildTerminal(events, 'rhea');
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: 'thought', text: 'Sto pens', live: false });
  });
});

describe('drafts of a turn that did not finish', () => {
  const draft = (runId: string) =>
    ev({
      agent: 'titan',
      runId,
      type: 'message',
      data: { role: 'agent', text: 'Sto pens', partial: true },
    });

  it('are closed by the run aborted or failed event, also after a reload', () => {
    for (const status of ['aborted', 'failed'] as const) {
      const events = [
        ev({ agent: 'titan', runId: status, type: 'run', data: { status: 'started' } }),
        draft(status),
        ev({ agent: 'titan', runId: status, type: 'run', data: { status } }),
      ];
      const agentItems = buildChat(events, []).filter((i) => i.kind === 'agent');
      expect(agentItems).toEqual([expect.objectContaining({ text: 'Sto pens', streaming: false })]);
    }
  });

  it('are closed by the final message with a status, keeping their text and the mood', () => {
    const events = [
      draft('r'),
      ev({
        agent: 'titan',
        runId: 'r',
        type: 'message',
        data: { role: 'agent', text: '', status: 'aborted' },
      }),
    ];
    const chat = buildChat(events, []);
    expect(chat).toEqual([expect.objectContaining({ text: 'Sto pens', streaming: false })]);
    const terminal = buildTerminal(events, 'titan');
    expect(terminal).toEqual([expect.objectContaining({ kind: 'message', text: 'Sto pens' })]);

    let live: Record<string, LiveState> = {};
    for (const e of [
      ...events.slice(0, 1),
      ev({ agent: 'titan', runId: 'r', type: 'run', data: { status: 'aborted' } }),
      ...events.slice(1),
    ])
      live = applyLive(live, e, ['titan']);
    expect(live['titan']?.mood).toBe('stopped');
  });
});

describe('events among monsters in the chat', () => {
  const goal = 'Scrivi la bozza del primo post';

  it('keeps the task in a finished line and the summary only when it says something', () => {
    expect(doneSummary(goal, 'Fatto')).toBeNull();
    expect(doneSummary(goal, 'Done.')).toBeNull();
    expect(doneSummary(goal, ' ok! ')).toBeNull();
    expect(doneSummary(goal, undefined)).toBeNull();
    expect(doneSummary(goal, 'Scrivi la bozza del primo post.')).toBeNull();
    expect(doneSummary(goal, 'Fatto: 3 bozze in [[Bozze dei post]]')).toBe(
      '3 bozze in Bozze dei post',
    );
    expect(doneSummary(goal, '3 bozze pronte')).toBe('3 bozze pronte');
    const names = makeNameOf({});
    const item: ChatItem = {
      kind: 'delegation',
      id: '1',
      ts: 1,
      from: 'titan',
      to: 'dione',
      goal,
      status: 'completed',
      summary: 'Fatto',
    };
    expect(previewText(item, names)).toBe('Dione ha finito «Scrivi la bozza del primo post»');
  });

  it('folds three or more events in a row into one line, and says what they are', () => {
    const d = (id: string, status: 'started' | 'completed' | 'failed'): ChatItem => ({
      kind: 'delegation',
      id,
      ts: 1,
      from: 'titan',
      to: 'rhea',
      goal: 'cerca',
      status,
    });
    const msg = (id: string): ChatItem => ({ kind: 'user', id, ts: 1, text: 'ciao' });
    const rows = [
      msg('a'),
      d('b', 'completed'),
      d('c', 'completed'),
      msg('d'),
      d('e', 'completed'),
      d('f', 'completed'),
      d('g', 'started'),
      d('h', 'completed'),
    ];
    const out = groupDelegations(rows, (r) => r);
    expect(
      out.map((r) => (r.kind === 'one' ? r.row.id : `[${r.rows.map((x) => x.id).join('')}]`)),
    ).toEqual(['a', 'b', 'c', 'd', '[efgh]']);
    expect(
      delegationGroupLabel([
        d('1', 'completed'),
        d('2', 'completed'),
        d('3', 'completed'),
        d('4', 'completed'),
      ]),
    ).toBe('4 compiti completati');
    expect(delegationGroupLabel([d('1', 'started'), d('2', 'started'), d('3', 'started')])).toBe(
      '3 compiti passati alla squadra',
    );
    expect(
      delegationGroupLabel([
        d('1', 'completed'),
        d('2', 'started'),
        d('3', 'started'),
        d('4', 'failed'),
      ]),
    ).toBe('4 compiti: 1 completato, 2 in corso e 1 fermato');
  });

  it('folds the lines of the instinct among the tasks into the same line', () => {
    const d = (id: string): ChatItem => ({
      kind: 'delegation',
      id,
      ts: 1,
      from: 'titan',
      to: 'rhea',
      goal: 'cerca',
      status: 'completed',
    });
    const i = (id: string): ChatItem => ({
      kind: 'instinct',
      id,
      ts: 1,
      agent: 'rhea',
      text: 'Ci pensa Rhea',
      tone: null,
    });
    const rows = [d('a'), i('b'), d('c')];
    const out = groupDelegations(rows, (r) => r);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'group' });
    expect(delegationGroupLabel(rows)).toBe('3 eventi tra i mostri');
    // A chat can keep some rows in sight: they break the run.
    const kept = groupDelegations(
      rows,
      (r) => r,
      3,
      (item) => item.id !== 'b',
    );
    expect(kept.map((r) => r.kind)).toEqual(['one', 'one', 'one']);
  });

  it('collects the notes the delegated monster wrote for its task', () => {
    const start = ev({
      agent: 'titan',
      runId: 'r',
      type: 'delegation',
      data: { from: 'titan', to: 'dione', status: 'started', goal },
    });
    const write = (agent: string, path: string) =>
      ev({ agent, runId: 'r', type: 'vault_change', data: { action: 'create', path } });
    const chat = buildChat(
      [
        start,
        write('dione', 'Progetti/Bozze dei post.md'),
        write('dione', 'Agenti/Dione/MEMORY.md'),
        write('titan', 'Altro.md'),
        write('dione', 'Progetti/Bozze dei post.md'),
        ev({
          agent: 'titan',
          runId: 'r',
          type: 'delegation',
          data: { from: 'titan', to: 'dione', status: 'completed', goal, summary: '3 bozze' },
        }),
        write('dione', 'Dopo.md'),
      ],
      [],
    );
    expect(chat).toHaveLength(1);
    expect(chat[0]).toMatchObject({ kind: 'delegation', notes: ['Progetti/Bozze dei post.md'] });
  });

  it('shows a message held while the monsters are stopped', () => {
    const pending = [{ tempId: 'p1', text: 'dopo', ts: clock, held: true }];
    expect(buildChat([], pending)[0]).toMatchObject({ kind: 'user', pending: true, held: true });
    expect(buildChat([], [{ tempId: 'p2', text: 'ora', ts: clock }])[0]).not.toHaveProperty('held');
  });

  it('knows where each note is and which are in the trash', () => {
    const change = (
      action: 'create' | 'move' | 'delete' | 'restore',
      path: string,
      fromPath?: string,
    ) =>
      ev({
        agent: 'rhea',
        type: 'vault_change',
        data: { action, path, ...(fromPath ? { fromPath } : {}) },
      });
    const events = [
      change('create', 'Risorse/Lisbona.md'),
      change('move', 'Viaggi/Lisbona.md', 'Risorse/Lisbona.md'),
      change('create', 'Bozze.md'),
      change('delete', 'Bozze.md'),
      change('create', 'Idee.md'),
      change('delete', 'Idee.md'),
      change('restore', 'Idee.md'),
    ];
    const idx = noteIndex(events);
    expect(idx.pathOf.get('lisbona')).toBe('Viaggi/Lisbona.md');
    expect(idx.trashed.has('bozze')).toBe(true);
    expect(idx.trashed.has('idee')).toBe(false);
    expect(noteIndex(events)).toBe(idx);
  });
});

describe('work stopped by Ferma (D-066)', () => {
  const names: Record<string, string> = { titan: 'Titan', rhea: 'Rhea', dione: 'Dione' };
  const nameOf = (id: string) => names[id] ?? id;
  const ask = (runId: string) =>
    ev({
      agent: 'user',
      runId,
      type: 'message',
      data: { role: 'user', text: 'Tre post su Lisbona' },
    });
  const started = (agent: string, runId: string, goal = 'Tre post su Lisbona') =>
    ev({ agent, runId, type: 'run', data: { status: 'started', goal } });
  const question = (agent: string, runId: string, id: string) =>
    ev({
      agent,
      runId,
      type: 'question',
      data: { questionId: id, question: 'Che tono?', options: [], blocking: true },
    });
  const kill = () =>
    ev({ agent: 'system', type: 'kill', data: { scope: 'global', by: 'ui', runsAborted: 2 } });
  const expired = (agent: string, runId: string, id: string) =>
    ev({ agent, runId, type: 'question_expired', data: { questionId: id, reason: 'kill' } });
  const aborted = (agent: string, runId: string) =>
    ev({ agent, runId, type: 'run', data: { status: 'aborted' } });

  it('lists the questions closed and the monsters stopped, with the request behind them', () => {
    const events = [
      ask('r1'),
      started('titan', 'r1'),
      question('titan', 'r1', 'q1'),
      kill(),
      expired('titan', 'r1', 'q1'),
      aborted('titan', 'r1'),
      aborted('rhea', 'r1'),
    ];
    const w = haltedWork(events);
    expect(w.questions).toEqual([{ id: 'q1', from: 'titan', runId: 'r1' }]);
    expect(w.agents).toEqual(['titan', 'rhea']);
    expect(w.requests).toEqual([{ runId: 'r1', agent: 'titan', text: 'Tre post su Lisbona' }]);
    // Who asked waits for the answer: its work is the question.
    expect(haltedWorkText(w, nameOf)).toBe('la domanda di Titan e il lavoro di Rhea');
    expect(haltedResumeText(w, nameOf)).toBe('il messaggio per Titan');
    expect(haltedResumeText({ ...w, requests: [] }, nameOf)).toBeNull();
    const two = [...w.requests, { runId: 'r2', agent: 'rhea', text: 'x' }];
    expect(haltedResumeText({ ...w, requests: two }, nameOf)).toBe('i messaggi per Titan e Rhea');
    expect(resumeText('Tre post su Lisbona')).toBe(
      'Riprendi il lavoro che avevo fermato: «Tre post su Lisbona»',
    );
    // A long request goes back whole, lines included (review of 16/10): only the UI shortens it.
    const long = `Tre post su Lisbona.\n${'Con i tram, i pasteis e il fado. '.repeat(40)}Fine.`;
    expect(originalRequest(resumeText(long))).toBe(long);
    expect(originalRequest(resumeText(resumeText(long)))).toBe(long);
  });

  it('a request started again is a status line in its chat, not a bubble (D-072)', () => {
    const again = ev({
      agent: 'user',
      runId: 'r9',
      type: 'message',
      data: {
        role: 'user',
        text: resumeText('Tre post su Lisbona'),
        to: 'rhea',
        resumeOf: 'r1',
      },
    });
    const events = [ask('r1'), started('rhea', 'r1'), again];
    const items = buildChat(events, []);
    expect(items.filter((i) => i.kind === 'user')).toHaveLength(1);
    const row = items.at(-1)!;
    expect(row).toMatchObject({
      kind: 'system',
      tone: 'go',
      text: 'Ripreso il lavoro fermato: «Tre post su Lisbona»',
    });
    const scope: ChatScope = { orchestrator: 'titan', owners: runOwners(events) };
    expect(threadsOf(row, scope)).toEqual(['rhea']);
    // Stopped again: the request is the original one, never "Riprendi… «Riprendi…»".
    const twice = haltedWork([...events, started('rhea', 'r9'), kill(), aborted('rhea', 'r9')]);
    expect(twice.requests).toEqual([{ runId: 'r9', agent: 'rhea', text: 'Tre post su Lisbona' }]);
  });

  it('a message that waited for a busy monster is a request the stop left (M8)', () => {
    const waiting = (runId: string, text: string) =>
      ev({ agent: 'user', runId, type: 'message', data: { role: 'user', text, to: 'titan' } });
    const events = [
      ask('r1'),
      started('titan', 'r1'),
      waiting('w1', 'Prima cosa'),
      waiting('w1', 'Seconda cosa'),
      kill(),
      aborted('titan', 'r1'),
    ];
    expect(haltedWork(events).requests).toEqual([
      { runId: 'r1', agent: 'titan', text: 'Tre post su Lisbona' },
      { runId: 'w1', agent: 'titan', text: 'Prima cosa\n\nSeconda cosa' },
    ]);
  });

  it('is empty without a stop, and once the monsters are resumed', () => {
    expect(haltedWork([ask('r2'), started('titan', 'r2')]).requests).toEqual([]);
    const resumed = [
      ask('r3'),
      started('titan', 'r3'),
      kill(),
      aborted('titan', 'r3'),
      ev({ agent: 'user', type: 'resume', data: { by: 'ui' } }),
    ];
    const w = haltedWork(resumed);
    expect(w.agents).toEqual([]);
    expect(haltedWorkText(w, nameOf)).toBeNull();
  });

  it('"Riprova" sends the request of a failed run, else the goal it started with', () => {
    const withRequest = [ask('r4'), started('titan', 'r4'), aborted('titan', 'r4')];
    expect(retryOf(withRequest, 'r4')).toEqual({
      agent: 'titan',
      text: 'Riprova: «Tre post su Lisbona»',
    });
    const goalOnly = [started('dione', 'r5', 'Aggiorna il foglio delle spese')];
    expect(retryOf(goalOnly, 'r5')).toEqual({
      agent: 'dione',
      text: 'Riprova: «Aggiorna il foglio delle spese»',
    });
    expect(retryOf([], 'r6')).toBeNull();
  });
});

describe('a new monster proposed by the capo squadra (D-075)', () => {
  const draft = {
    name: 'Lyra',
    title: 'l’archivista',
    role: 'tiene in ordine le idee',
    mission: 'raccogli le idee sparse',
    context: 'Giulio guida Saturday.',
    duties: ['Una nota per idea.'],
    area: 'Idee',
    web: false,
    color: '#88cc44',
    genome: {},
    archetype: null,
    source: 'proposal' as const,
  };
  const proposed = ev({
    agent: 'titan',
    runId: 'r1',
    type: 'monster_proposal',
    data: { action: 'proposed', from: 'titan', draft },
  });
  const scope: ChatScope = { orchestrator: 'titan', owners: new Map([['r1', 'titan']]) };

  it('is a card in the chat of the capo, open until the user answers', () => {
    const [item] = buildChat([proposed], []);
    expect(item).toMatchObject({ kind: 'proposal', id: proposed.id, status: 'proposed' });
    expect(threadsOf(item!, scope)).toEqual(['titan']);
    expect(previewText(item!, makeNameOf({}))).toBe('Titan propone un nuovo mostro: Lyra');
    expect(chatSummary([item!], '').unread).toBe(1);
  });

  it('becomes "created" with the new monster, or "discarded"', () => {
    const created = ev({
      agent: 'user',
      type: 'monster_proposal',
      data: {
        action: 'created',
        from: 'titan',
        proposalId: proposed.id,
        agent: 'vega',
        name: 'Vega',
        by: 'ui',
      },
    });
    expect(buildChat([proposed, created], [])).toEqual([
      expect.objectContaining({ status: 'created', created: { agent: 'vega', name: 'Vega' } }),
    ]);
    const discarded = ev({
      agent: 'user',
      type: 'monster_proposal',
      data: { action: 'discarded', from: 'titan', proposalId: proposed.id, by: 'ui' },
    });
    expect(buildChat([proposed, discarded], [])[0]).toMatchObject({ status: 'discarded' });
    expect(describeEvent(discarded, makeNameOf({}))).toBe(
      'Hai lasciato stare la proposta di Titan (un mostro)',
    );
  });
});

describe('the loop of the projects in the chats (D-102)', () => {
  const scope: ChatScope = { orchestrator: 'titan', owners: new Map() };
  const names = (id: string) => ({ titan: 'Titan', iapetus: 'Iapetus' })[id] ?? id;
  const sent = ev({
    agent: 'user',
    runId: 'r-lead',
    type: 'message',
    data: {
      role: 'user',
      text: 'Prepara il post di sabato',
      to: 'iapetus',
      channel: 'system',
      from: 'titan',
      fromRun: 'r-god',
    },
  });
  const report = (status: 'completed' | 'aborted', reason?: 'restart' | 'stopped') =>
    ev({
      agent: 'system',
      runId: 'r-lead',
      type: 'project_report',
      data: {
        project: 'social',
        lead: 'iapetus',
        to: 'titan',
        request: sent.id,
        status,
        summary: reason ? 'Monsters si è chiuso mentre ci lavorava…' : 'Il post è pronto.',
        ...(reason ? { reason } : {}),
      },
    });

  it('shows a message of project_send as the words of who wrote it, in the lead’s chat', () => {
    const items = buildChat([sent], []);
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'relayed',
        from: 'titan',
        to: 'iapetus',
        text: 'Prepara il post di sabato',
      }),
    ]);
    expect(threadsOf(items[0]!, scope)).toEqual(['iapetus']);
    expect(chatThread(items, 'titan', scope)).toEqual([]);
    expect(previewText(items[0]!, names)).toBe('Titan: Prepara il post di sabato');
    // Not the user's: no "Tu:", but news in the chat.
    expect(chatSummary(items, '').unread).toBe(1);
  });

  it('puts the lead’s report in the chat of who sent the work, with its outcome', () => {
    const items = buildChat([sent, report('completed')], []);
    const r = items[1]!;
    expect(r).toMatchObject({ kind: 'report', lead: 'iapetus', to: 'titan', project: 'social' });
    expect(threadsOf(r, scope)).toEqual(['titan']);
    expect(chatThread(items, 'titan', scope).map((i) => i.kind)).toEqual(['report']);
    expect(chatThread(items, 'iapetus', scope).map((i) => i.kind)).toEqual(['relayed']);
    expect(reportOutcome({ status: 'completed' })).toEqual({ text: 'ha finito', tone: 'ok' });
    expect(reportSentence(r as Extract<ChatItem, { kind: 'report' }>, names, 'Social')).toBe(
      'Social: Iapetus ha finito',
    );
  });

  it('says why a report came without an answer', () => {
    expect(reportOutcome({ status: 'aborted', reason: 'restart' })).toEqual({
      text: 'si è interrotto: Monsters si è chiuso mentre ci lavorava',
      tone: 'stop',
    });
    expect(reportOutcome({ status: 'aborted', reason: 'stopped' }).text).toBe(
      'fermato prima di cominciare',
    );
    expect(reportOutcome({ status: 'aborted' }).text).toBe('si è fermato');
    expect(reportOutcome({ status: 'failed' }).tone).toBe('stop');
    expect(reportOutcome({ status: 'waiting_user' }).tone).toBe('signal');
    const [, r] = buildChat([sent, report('aborted', 'restart')], []);
    expect(r).toMatchObject({ kind: 'report', status: 'aborted', reason: 'restart' });
  });
});

describe('messages written to a monster’s own bot on Telegram (D-107)', () => {
  const scope: ChatScope = { orchestrator: 'titan', owners: new Map() };
  const origin = {
    bot: '7100000042',
    chat: -1001234567890,
    chatType: 'supergroup' as const,
    chatTitle: 'Saturday Team',
    sender: { id: 5550001, name: 'Livio', username: 'livio_sat' },
    owner: false,
  };
  const asked = ev({
    agent: 'user',
    runId: 'r-tg',
    type: 'message',
    data: {
      role: 'user',
      text: 'Tre idee per il post di lunedì?',
      to: 'calypso',
      channel: 'telegram',
      telegram: origin,
    },
  });
  const started = ev({
    agent: 'calypso',
    runId: 'r-tg',
    type: 'run',
    data: { status: 'started', thread: `telegram:${origin.bot}:${origin.chat}` },
  });
  const answer = ev({
    agent: 'calypso',
    runId: 'r-tg',
    type: 'message',
    data: { role: 'agent', text: 'Eccole, Livio.' },
  });

  it('is an item of its own in the monster’s chat, with the sender and the group', () => {
    const items = buildChat([asked, started, answer], []);
    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: 'telegram',
        to: 'calypso',
        text: 'Tre idee per il post di lunedì?',
        sender: { id: 5550001, name: 'Livio', username: 'livio_sat' },
        owner: false,
        chatTitle: 'Saturday Team',
      }),
    );
    expect(telegramWhere(items[0] as Extract<ChatItem, { kind: 'telegram' }>)).toBe(
      'da Telegram · Saturday Team',
    );
    expect(threadsOf(items[0]!, scope)).toEqual(['calypso']);
    // Never the orchestrator's chat, never the user's bubble.
    expect(chatThread(items, 'titan', scope)).toEqual([]);
    expect(items.some((i) => i.kind === 'user')).toBe(false);
    expect(previewText(items[0]!, (id) => id)).toBe('Livio: Tre idee per il post di lunedì?');
    // News in the chat: the message and the answer.
    expect(chatSummary(items, '').unread).toBe(2);
    expect(countMessages(items)).toBe(2);
    // The monster's answer went back to the group.
    expect(items[1]).toMatchObject({ kind: 'agent', via: 'su Telegram · Saturday Team' });
  });

  it('says "in privato" for a private chat, and marks the user when he wrote it', () => {
    const own = ev({
      agent: 'user',
      runId: 'r-tg2',
      type: 'message',
      data: {
        role: 'user',
        text: 'Segna la riunione',
        to: 'calypso',
        channel: 'telegram',
        telegram: {
          bot: origin.bot,
          chat: 1001,
          chatType: 'private',
          sender: { id: 1001, name: 'Giulio' },
          owner: true,
        },
      },
    });
    const [item] = buildChat([own], []);
    expect(item).toMatchObject({ kind: 'telegram', owner: true, chatType: 'private' });
    expect(telegramWhere(item as Extract<ChatItem, { kind: 'telegram' }>)).toBe(
      'da Telegram · in privato',
    );
    // A message of the app in the same chat stays the user's.
    const mine = ev({
      agent: 'user',
      runId: 'r-app',
      type: 'message',
      data: { role: 'user', text: 'Ciao', to: 'calypso', channel: 'ui' },
    });
    const items = buildChat([own, mine], []);
    expect(items.map((i) => i.kind)).toEqual(['telegram', 'user']);
    expect(previewText(items[1]!, (id) => id)).toBe('Tu: Ciao');
  });
});

describe('Telegram events in words', () => {
  const nameOf = (id: string) => id;
  const channel = (data: Record<string, unknown>) =>
    describeEvent(
      ev({ agent: 'system', type: 'channel', data: { channel: 'telegram', ...data } } as never),
      nameOf,
    );

  it('a dedicated bot in conflict names the bot, not "Telegram"', () => {
    const text = channel({
      action: 'disconnected',
      bot: '222',
      name: '@rhea_saturday_bot',
      reason: 'conflict',
    });
    expect(text).toContain('@rhea_saturday_bot');
    expect(text).toContain('un altro programma');
    expect(text).not.toContain('serve il tuo intervento');
    expect(channel({ action: 'disconnected', reason: 'error' })).toBe(
      'Telegram si è fermato: serve il tuo intervento',
    );
  });

  it('a bot out of a group, or blocked', () => {
    expect(channel({ action: 'chat_left', bot: '2', chatId: '-5', name: 'Team' })).toContain(
      'non è più nel gruppo Team',
    );
    expect(channel({ action: 'chat_left', bot: '2', userId: '7', name: 'Anna' })).toContain(
      'Anna ha bloccato il bot',
    );
  });
});

describe('preview of a chat after "Riprendi"', () => {
  const go = {
    kind: 'system',
    id: '3',
    ts: 3,
    text: 'Si riparte: i mostri sono di nuovo liberi',
    tone: 'go',
  } as const;
  const stop = {
    kind: 'system',
    id: '2',
    ts: 2,
    text: 'Hai fermato tutti i mostri',
    tone: 'stop',
  } as const;

  it('does not say "Si riparte" in a chat that resumed nothing', () => {
    expect(chatSummary([stop, go], '').last).toBe(stop);
    expect(chatSummary([go], '').last).toBeUndefined();
  });

  it('keeps the line of a chat that took a job up again', () => {
    const resumed = { ...go, id: '4', text: 'Ripreso il lavoro fermato: «x»', to: 'rhea' } as const;
    expect(chatSummary([stop, resumed], '').last).toBe(resumed);
  });
});
