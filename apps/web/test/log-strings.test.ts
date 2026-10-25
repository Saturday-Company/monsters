import { appLang, setAppLang, ulid, type LogEvent } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { describeError, ApiError } from '../src/lib/api.ts';
import { detailsOf } from '../src/components/log/details.ts';
import { mainTypes, otherTypes, typeLabel } from '../src/components/log/activity.ts';
import { NetworkError } from '../src/lib/transport.ts';
import {
  applyLive,
  ASKED_ACTIVITY,
  CONFUSED_TEXT,
  buildChat,
  delegationGroupLabel,
  describeEvent,
  describeTool,
  errorSentence,
  formatDuration,
  haltedResumeText,
  isStopText,
  listText,
  lowerFirst,
  makeNameOf,
  modelLabel,
  previewText,
  reportSentence,
  retryOf,
  toolAction,
  toolLabel,
  toolShort,
  undoConflictText,
  type LiveState,
} from '../src/store/derive.ts';
import {
  instinctSentence,
  NOTE_ACTION,
  receiptSummary,
  VERDICT,
  LEVEL_WORD,
} from '../src/store/instinct.ts';
import { moodText, statusText, waitsForUser } from '../src/store/hooks.ts';

/*
 * The sentences of the store and of Attività in both languages (D-153): English
 * is the default, Italian is exactly the copy the app had. Each case says the
 * same thing twice, so a missing agreement or plural shows up here.
 */

afterEach(() => setAppLang('en'));

/** Runs `fn` in each language: `[english, italian]`. */
function both<T>(fn: () => T): [T, T] {
  setAppLang('en');
  const en = fn();
  setAppLang('it');
  const it = fn();
  setAppLang('en');
  return [en, it];
}

let clock = 1_760_000_000_000;
function ev(input: { agent: string; type: string; data: unknown; runId?: string }): LogEvent {
  clock += 1000;
  return {
    id: ulid(clock),
    ts: clock,
    agent: input.agent,
    runId: input.runId ?? null,
    parentId: null,
    type: input.type,
    data: input.data,
  } as LogEvent;
}

const names = makeNameOf({});

describe('events in words, in both languages', () => {
  const say = (agent: string, type: string, data: unknown) =>
    both(() => describeEvent(ev({ agent, type, data }), names));

  it('messages and conversations', () => {
    expect(say('user', 'message', { role: 'user', text: 'x', to: 'atlas' })).toEqual([
      'You wrote to Atlas',
      'Hai scritto ad Atlas',
    ]);
    expect(say('user', 'message', { role: 'user', text: 'x', to: 'rhea' })).toEqual([
      'You wrote to Rhea',
      'Hai scritto a Rhea',
    ]);
    expect(say('rhea', 'message', { role: 'agent', text: 'x' })).toEqual([
      'Rhea replied',
      'Rhea ha risposto',
    ]);
    expect(say('rhea', 'message', { role: 'agent', text: '', status: 'aborted' })).toEqual([
      'Rhea stopped while writing',
      'Rhea si è fermato mentre scriveva',
    ]);
    expect(say('user', 'new_conversation', { channel: 'ui' })).toEqual([
      'You started a new conversation',
      'Hai iniziato una nuova conversazione',
    ]);
  });

  it('notes: the verb agrees with who did it, and the participle with the file', () => {
    const note = (agent: string, action: string, path = 'Idee.md') =>
      say(agent, 'vault_change', { action, path });
    expect(note('rhea', 'create')).toEqual([
      'Rhea created the note Idee',
      'Rhea ha creato la nota Idee',
    ]);
    expect(note('user', 'delete')).toEqual([
      'You trashed the note Idee',
      'Hai cestinato la nota Idee',
    ]);
    expect(note('user', 'undo')).toEqual([
      'You undid a change to Idee',
      'Hai annullato una modifica a Idee',
    ]);
    expect(note('rhea', 'edit', 'Agenti/Rhea/MEMORY.md')).toEqual([
      'Rhea updated their notes',
      'Rhea ha aggiornato i suoi appunti',
    ]);
    expect(note('system', 'delete', 'Agenti/Rhea/MEMORY.md')).toEqual([
      'Rhea’s notes in the trash',
      'Appunti di Rhea nel cestino',
    ]);
    expect(note('system', 'move', 'Agenti/Rhea/STATO.md')).toEqual([
      'State of Rhea’s jobs: note moved',
      'Stato dei lavori di Rhea: nota spostata',
    ]);
    expect(note('titan', 'restore', 'Agenti/Rhea/Piano.md')).toEqual([
      'Work note of Rhea (Piano) restored (Titan)',
      'Nota di lavoro di Rhea (Piano) ripristinata (Titan)',
    ]);
  });

  it('tasks, tools and stops', () => {
    expect(
      say('titan', 'delegation', { from: 'titan', to: 'atlas', status: 'started', goal: 'Cerca' }),
    ).toEqual([
      'Titan handed Atlas a task: “Cerca”',
      'Titan ha passato un incarico ad Atlas: “Cerca”',
    ]);
    expect(say('titan', 'tool_result', { callId: 'c', tool: 'web_search', ok: true })).toEqual([
      'Titan finished searching the web',
      'Titan ha finito la ricerca sul web',
    ]);
    expect(
      say('titan', 'tool_result', {
        callId: 'c',
        tool: 'vault_write',
        ok: false,
        error: 'stopped',
      }),
    ).toEqual([
      'Titan stopped halfway through writing a note',
      'Titan ha lasciato a metà la scrittura di una nota',
    ]);
    expect(
      say('titan', 'tool_result', { callId: 'c', tool: 'shell', ok: false, error: 'boom' }),
    ).toEqual(['Titan couldn’t finish running the command', 'Titan non ha completato il comando']);
    expect(say('titan', 'run', { status: 'aborted', reason: 'restart' })).toEqual([
      'Titan’s job stopped when Monsters restarted',
      'Il lavoro di Titan si è fermato al riavvio di Monsters',
    ]);
    expect(say('titan', 'kill', { scope: 'global', by: 'ui' })).toEqual([
      'All the monsters were stopped',
      'Tutti i mostri sono stati fermati',
    ]);
  });

  it('memory: one thing or many', () => {
    const memory = (n: number, action = 'saved') =>
      say('rhea', 'memory', { action, path: 'Agenti/Rhea/MEMORY.md', lines: Array(n).fill('x') });
    expect(memory(1)).toEqual(['Rhea remembers one new thing', 'Rhea si ricorda una cosa nuova']);
    expect(memory(3)).toEqual(['Rhea remembers 3 new things', 'Rhea si ricorda 3 cose nuove']);
    expect(memory(2, 'proposed')).toEqual([
      'Rhea wants to remember 2 new things: waiting for you',
      'Rhea vuole ricordare 2 cose nuove: aspetta te',
    ]);
  });

  it('team, projects, automations and the log archive', () => {
    expect(say('user', 'team_change', { action: 'rename', from: 'atlas', name: 'Titan' })).toEqual([
      'You renamed atlas: now Titan',
      'Hai cambiato nome ad atlas: ora è Titan',
    ]);
    expect(
      say('system', 'project_change', { action: 'member_added', name: 'Sito', agent: 'rhea' }),
    ).toEqual([
      'Project “Sito”: Rhea joined the project',
      'Progetto «Sito»: Rhea è entrato nel progetto',
    ]);
    expect(
      say('system', 'automation_change', { action: 'paused', name: 'Rassegna', automationId: 'a' }),
    ).toEqual(['Automation “Rassegna”: paused', 'Automazione «Rassegna»: in pausa']);
    expect(say('system', 'log_archive', { events: 1, days: 30, dir: 'log/archive' })).toEqual([
      'Monsters archived 1 old event (usage, tool results, streamed text) in log/archive',
      'Monsters ha archiviato 1 evento vecchio (consumi, risultati degli strumenti, testo in arrivo) in log/archive',
    ]);
  });

  it('Telegram', () => {
    const channel = (data: Record<string, unknown>) =>
      say('system', 'channel', { channel: 'telegram', ...data });
    expect(
      channel({ action: 'disconnected', reason: 'conflict', bot: true, name: 'Mario' }),
    ).toEqual([
      'The bot Mario is in use by another app (or has a webhook): Monsters will retry',
      'Il bot Mario è usato da un’altra app (o ha un webhook): Monsters riprova',
    ]);
    expect(channel({ action: 'disconnected' })).toEqual([
      'Telegram isn’t responding: Monsters will retry',
      'Telegram non risponde: Monsters riprova',
    ]);
    expect(channel({ action: 'ignored', userId: '42', reason: 'not_text' })).toEqual([
      'Telegram message ignored: account 42 (not text)',
      'Messaggio su Telegram ignorato: l’account 42 (non è testo)',
    ]);
    expect(channel({ action: 'paired' })).toEqual([
      'someone can now control the monsters from Telegram',
      'qualcuno ora può comandare i mostri da Telegram',
    ]);
  });

  it('errors keep the core’s words after the colon, in lower case only for common openers', () => {
    const [en, it] = both(() =>
      errorSentence(
        { agent: 'rhea', data: { code: 'x', message: 'The sheet is missing.' } },
        names,
      ),
    );
    expect(en).toBe('Rhea ran into a problem: the sheet is missing.');
    expect(it).toBe('Rhea ha avuto un problema: The sheet is missing.');
    expect(
      both(() =>
        errorSentence({ agent: 'rhea', data: { code: 'x', message: 'Il foglio non c’è.' } }, names),
      ),
    ).toEqual([
      'Rhea ran into a problem: il foglio non c’è.',
      'Rhea ha avuto un problema: il foglio non c’è.',
    ]);
    // The English pronoun keeps its capital; the Italian article does not.
    setAppLang('en');
    expect(lowerFirst('I couldn’t open it')).toBe('I couldn’t open it');
    setAppLang('it');
    expect(lowerFirst('I file sono troppi')).toBe('i file sono troppi');
    expect(lowerFirst('Telegram non risponde')).toBe('Telegram non risponde');
  });
});

describe('the live activity follows the language', () => {
  it('says what a tool call does, in each language', () => {
    expect(both(() => describeTool('web_search', { query: 'Lisbona' }))).toEqual([
      'Searching “Lisbona”',
      'Cerco “Lisbona”',
    ]);
    expect(both(() => describeTool('delegate', { to: 'atlas' }))).toEqual([
      'Handing the work to Atlas',
      'Passo il lavoro ad Atlas',
    ]);
    expect(
      both(() => describeTool('mcp__browser__browser_navigate', { url: 'https://www.x.it/a' })),
    ).toEqual(['Opening x.it in the browser', 'Apro x.it nel browser']);
    expect(both(() => describeTool('vault_read', {}))).toEqual([
      'Reading a note',
      'Leggo una nota',
    ]);
  });

  it('keeps ASKED_ACTIVITY and CONFUSED_TEXT in the language in use', () => {
    setAppLang('en');
    expect(ASKED_ACTIVITY).toBe('I asked you a question');
    expect(CONFUSED_TEXT).toBe('is changing course');
    setAppLang('it');
    expect(ASKED_ACTIVITY).toBe('Ti ho fatto una domanda');
    expect(CONFUSED_TEXT).toBe('sta cambiando strada');
  });

  it('a monster waiting for the user is recognised in either language', () => {
    for (const lang of ['en', 'it'] as const) {
      setAppLang(lang);
      const live = applyLive(
        {},
        ev({
          agent: 'rhea',
          type: 'question',
          data: { questionId: 'q', question: '?', options: [], blocking: true },
        }),
        ['rhea'],
      );
      const state: LiveState = live['rhea']!;
      expect(state.activity).toBe(ASKED_ACTIVITY);
      expect(statusText(state)).toBe(
        lang === 'en' ? 'waiting for your answer' : 'aspetta una tua risposta',
      );
    }
  });

  it('a waiting monster is still recognised after the language changes (W-39)', () => {
    setAppLang('en');
    const live = applyLive(
      {},
      ev({
        agent: 'rhea',
        type: 'question',
        data: { questionId: 'q', question: '?', options: [], blocking: true },
      }),
      ['rhea'],
    );
    const state: LiveState = live['rhea']!;
    expect(waitsForUser(state)).toBe(true);
    // The text was written in English; the app is now in Italian and has not heard again.
    setAppLang('it');
    expect(state.activity).not.toBe(ASKED_ACTIVITY);
    expect(waitsForUser(state)).toBe(true);
    expect(statusText(state)).toBe('aspetta una tua risposta');
  });

  it('says the mood in neutral words', () => {
    expect(both(() => moodText('working'))).toEqual(['working', 'al lavoro']);
    expect(both(() => moodText('stopped'))).toEqual(['stopped', 'fermo']);
  });
});

describe('tool names', () => {
  it('has a phrase, a label and a short name for each tool in both languages', () => {
    const tools = [
      'web_search',
      'vault_write',
      'vault_delete',
      'delegate',
      'fs_delete',
      'mcp__browser__x',
      'mcp__github__x',
      'unknown_tool',
    ];
    for (const t of tools) {
      for (const lang of ['en', 'it'] as const) {
        setAppLang(lang);
        expect(toolAction(t)).toBeTruthy();
        expect(toolLabel(t)).toBeTruthy();
        expect(toolShort(t)).toBeTruthy();
      }
    }
  });

  it('the Italian label is the Italian phrase without its article, capitalised', () => {
    setAppLang('it');
    const tools = [
      'web_search',
      'vault_list',
      'vault_undo',
      'team_propose_monster',
      'automation_propose',
      'fs_delete',
      'mcp__browser__x',
      'mcp__github__x',
      'unknown_tool',
    ];
    for (const t of tools) {
      const phrase = toolAction(t).replace(/^(la |il |lo |l’|un’)/, '');
      expect(toolLabel(t)).toBe(phrase.charAt(0).toUpperCase() + phrase.slice(1));
    }
  });

  it('names models', () => {
    expect(both(() => modelLabel('meta/llama:free'))).toEqual(['llama (free)', 'llama (gratis)']);
    expect(both(() => modelLabel('openrouter/free'))).toEqual([
      'free one picked by OpenRouter',
      'gratuito scelto da OpenRouter',
    ]);
  });
});

describe('the chat in both languages', () => {
  it('groups tasks with plurals and lists', () => {
    const task = (status: 'started' | 'completed' | 'failed') =>
      ({ kind: 'delegation', id: status, ts: 1, from: 'a', to: 'b', goal: 'g', status }) as never;
    const done = [task('completed'), task('completed'), task('completed')];
    expect(both(() => delegationGroupLabel(done))).toEqual([
      '3 tasks completed',
      '3 incarichi completati',
    ]);
    const mixed = [task('completed'), task('started'), task('failed'), task('failed')];
    expect(both(() => delegationGroupLabel(mixed))).toEqual([
      '4 tasks: 1 completed, 1 in progress, and 2 stopped',
      '4 incarichi: 1 completato, 1 in corso e 2 fermati',
    ]);
  });

  it('lists names with the right "and"', () => {
    expect(both(() => listText(['Bruno', 'Rhea', 'Dione']))).toEqual([
      'Bruno, Rhea, and Dione',
      'Bruno, Rhea e Dione',
    ]);
    expect(both(() => listText(['Bruno', 'Rhea']))).toEqual(['Bruno and Rhea', 'Bruno e Rhea']);
  });

  it('writes the lines of a stop and a resume', () => {
    const events = [
      ev({ agent: 'user', type: 'kill', data: { scope: 'global', by: 'ui' } }),
      ev({ agent: 'user', type: 'resume', data: { by: 'ui' } }),
    ];
    expect(
      both(() => buildChat(events, []).map((i) => (i.kind === 'system' ? i.text : ''))).map((l) =>
        l.join('|'),
      ),
    ).toEqual([
      'You stopped all the monsters|Back to work: the monsters are free again',
      'Hai fermato tutti i mostri|Si riparte: i mostri sono di nuovo liberi',
    ]);
  });

  it('says where a Telegram message came from', () => {
    const events = [
      ev({
        agent: 'user',
        runId: 'r1',
        type: 'message',
        data: {
          role: 'user',
          text: 'ciao',
          to: 'rhea',
          telegram: {
            sender: { id: 1, name: 'Ada' },
            owner: false,
            chatType: 'group',
            chatTitle: 'Saturday Team',
          },
        },
      }),
      ev({ agent: 'rhea', runId: 'r1', type: 'message', data: { role: 'agent', text: 'Eccomi' } }),
    ];
    const via = () => buildChat(events, []).map((i) => (i.kind === 'agent' ? i.via : undefined));
    expect(both(via)).toEqual([
      [undefined, 'on Telegram · Saturday Team'],
      [undefined, 'su Telegram · Saturday Team'],
    ]);
  });

  it('previews', () => {
    const q = { kind: 'question', id: 'q', ts: 1, questionId: 'q', agent: 'rhea' } as never;
    expect(both(() => previewText(q, names))).toEqual([
      'Rhea asked you a question',
      'Rhea ti ha fatto una domanda',
    ]);
    const report = { lead: 'rhea', project: 'Social', status: 'completed' } as const;
    expect(both(() => reportSentence(report, names))).toEqual([
      'Social: Rhea finished',
      'Social: Rhea ha finito',
    ]);
    expect(both(() => names('user'))).toEqual(['You', 'Tu']);
  });

  it('what is left halfway when the monsters are stopped', () => {
    const work = {
      agents: [],
      questions: [],
      requests: [
        { runId: 'a', agent: 'rhea', text: 'x' },
        { runId: 'b', agent: 'titan', text: 'y' },
      ],
    };
    expect(both(() => haltedResumeText(work as never, names))).toEqual([
      'the messages for Rhea and Titan',
      'i messaggi per Rhea e Titan',
    ]);
  });

  it('the text sent again is written in the language in use', () => {
    const events = [
      ev({
        agent: 'rhea',
        runId: 'r',
        type: 'run',
        data: { status: 'started', goal: 'Cerca tutto' },
      }),
    ];
    expect(both(() => retryOf(events, 'r')?.text)).toEqual([
      'Try again: “Cerca tutto”',
      'Riprova: «Cerca tutto»',
    ]);
  });

  it('undo conflicts name the files', () => {
    expect(both(() => undoConflictText(['A/Idee.md', 'B/Piano.md']))).toEqual([
      '“Idee” and “Piano” changed after this edit: undoing it also loses those changes.',
      '“Idee”, “Piano” sono cambiate dopo questa modifica: annullandola perdi anche quei cambiamenti.',
    ]);
    expect(both(() => undoConflictText(['A/Idee.md']))[1]).toBe(
      '“Idee” è cambiata dopo questa modifica: annullandola perdi anche quei cambiamenti.',
    );
  });
});

describe('stop texts the core writes', () => {
  it('matches the Italian ones of the old events and the English ones of the new', () => {
    for (const t of [
      'stopped (global)',
      'Run aborted',
      'ABORTED',
      'Lavoro interrotto',
      'Il lavoro si è fermato',
      'The work was interrupted',
      'The job was stopped by you',
    ])
      expect(isStopText(t), t).toBe(true);
    for (const t of ['The sheet is missing', 'Il foglio non esiste', '', undefined])
      expect(isStopText(t), String(t)).toBe(false);
  });
});

describe('numbers follow the language', () => {
  it('formats durations', () => {
    expect(both(() => formatDuration(4100))).toEqual(['4.1 s', '4,1 s']);
    expect(both(() => formatDuration(125_000))).toEqual(['2 min 05 s', '2 min 05 s']);
  });
});

describe('the instinct and the receipt in both languages', () => {
  const instinct = (action: string, details: Record<string, unknown> = {}, message = 'x') =>
    both(() =>
      instinctSentence({ action, subject: 'rhea', message, details, use: 'x' } as never, names),
    );

  it('sentences', () => {
    expect(instinct('retry')).toEqual([
      'Rhea hadn’t finished the job: I asked for it to be completed',
      'Rhea non aveva finito il lavoro: ho chiesto di completarlo',
    ]);
    expect(instinct('route_hint', { route: 'capo' })).toEqual([
      'Rhea can answer without help',
      'Rhea può rispondere da solo',
    ]);
    expect(instinct('tier', { level: 'hard', model: 'claude-opus-5-5', from: 'subtask' })[0]).toBe(
      'Rhea: hard task → claude opus 5.5',
    );
    expect(instinct('tier', { level: 'hard' })).toEqual([
      'Hard request: Rhea uses the thorough model',
      'Richiesta difficile: Rhea usa il modello accurato',
    ]);
    expect(
      instinct('outbound_refused', {
        outcome: 'expired',
        unseen: '2 min',
        summary: 'post the page',
      }),
    ).toEqual([
      'No answer (2 min): Rhea didn’t post the page',
      'Nessuna risposta (2 min): Rhea non ha fatto post the page',
    ]);
  });

  it('words of the receipt are tables that follow the language', () => {
    expect(both(() => VERDICT.verified.word)).toEqual(['really finished', 'finito davvero']);
    expect(both(() => NOTE_ACTION['create'])).toEqual(['created', 'creata']);
    expect(both(() => LEVEL_WORD.hard)).toEqual(['Hard', 'Difficile']);
    expect(Object.keys(VERDICT)).toEqual([
      'verified',
      'doubt',
      'incomplete',
      'failed',
      'unchecked',
    ]);
    expect(VERDICT.failed.mark).toBe('✗');
  });

  it('counts tasks and notes with their plurals', () => {
    const r = (d: number, notes: number) =>
      ({
        delegations: Array.from({ length: d }, () => ({ verdict: 'verified' })),
        notes: Array.from({ length: notes }, (_, i) => ({ path: `N${i}.md`, action: 'create' })),
        usage: { costUsd: 0 },
      }) as never;
    expect(both(() => receiptSummary(r(1, 1)))).toEqual([
      '1 task ✓ · 1 note · free',
      '1 incarico ✓ · 1 nota · gratis',
    ]);
    expect(both(() => receiptSummary(r(2, 3)))).toEqual([
      '2 tasks ✓ · 3 notes · free',
      '2 incarichi ✓ · 3 note · gratis',
    ]);
  });
});

describe('Attività and the errors of the core', () => {
  it('names the filters and the types', () => {
    expect(both(() => mainTypes().map((t) => t.label))).toEqual([
      ['Note changes', 'Questions', 'Errors'],
      ['Modifiche alle note', 'Domande', 'Errori'],
    ]);
    expect(both(() => otherTypes().length)).toEqual([6, 6]);
    expect(both(() => typeLabel('instinct'))).toEqual([
      'Monsters’ decisions',
      'Decisioni dei mostri',
    ]);
  });

  it('shows the details of an event as labelled fields', () => {
    const tool = ev({
      agent: 'rhea',
      type: 'tool_result',
      data: { callId: 'c', tool: 'web_search', ok: false, durationMs: 1500 },
    });
    expect(both(() => detailsOf(tool).map((f) => `${f.label}: ${f.value}`))).toEqual([
      ['Tool: Web search (web_search)', 'Outcome: failed', 'Duration: 1.5 s'],
      ['Strumento: Ricerca sul web (web_search)', 'Esito: non riuscito', 'Durata: 1,5 s'],
    ]);
    const usage = ev({
      agent: 'rhea',
      type: 'provider_usage',
      data: {
        provider: 'openrouter',
        model: 'a/b',
        inputTokens: 1234,
        cachedInputTokens: 1000,
        outputTokens: 5,
      },
    });
    expect(
      both(() => detailsOf(usage).find((f) => f.label === 'Tokens' || f.label === 'Token')?.value),
    ).toEqual([
      '1,234 read (1,000 from the cache), 5 written',
      '1234 letti (1000 dalla cache), 5 scritti',
    ]);
  });

  it('describes the errors in the language in use', () => {
    const e = (code: string, message?: string) => new ApiError(400, code, message);
    expect(both(() => describeError(new NetworkError(new Error('offline'))))).toEqual([
      'I can’t reach Monsters. Is it running?',
      'Non riesco a raggiungere Monsters. È acceso?',
    ]);
    expect(both(() => describeError(e('halted')))).toEqual([
      'The monsters are stopped. Press “Resume” to get them going again.',
      'I mostri sono fermi. Premi “Riprendi” per farli ripartire.',
    ]);
    // The core's own words win when it gives some.
    expect(both(() => describeError(e('busy', 'Rhea is working')))).toEqual([
      'Rhea is working',
      'Rhea is working',
    ]);
    expect(both(() => describeError(e('busy')))[0]).toBe(
      'A monster is still working: wait for it to finish or stop it, then try again.',
    );
    expect(both(() => describeError(e('invalid_schedule', 'when: every blue moon')))).toEqual([
      'I don’t understand when: every blue moon',
      'Non capisco quando: every blue moon',
    ]);
    expect(both(() => describeError(e('invalid_schedule', 'quando: ogni luna blu')))[1]).toBe(
      'Non capisco quando: ogni luna blu',
    );
    expect(both(() => describeError(new Error('x')))).toEqual([
      'Something went wrong. Try again in a moment.',
      'Qualcosa è andato storto. Riprova tra poco.',
    ]);
  });

  it('says a text past its limit with the limit, and keeps the core’s words for unknown codes (W-22, W-23)', () => {
    const e = (code: string, message?: string) => new ApiError(400, code, message);
    expect(
      both(() =>
        describeError(
          e('invalid_request', 'text: Too big: expected string to have <=20000 characters'),
        ),
      ),
    ).toEqual([
      'This text is too long: 20,000 characters at most. Shorten it or split it in two.',
      'Il testo è troppo lungo: al massimo 20.000 caratteri. Accorcialo o dividilo in due.',
    ]);
    // Another invalid request keeps the validator's message.
    expect(both(() => describeError(e('invalid_request', 'name: Required')))[0]).toBe(
      'Something’s wrong with the data: name: Required',
    );
    expect(both(() => describeError(e('payload_too_large')))[0]).toBe(
      'That is too much to send at once. Send less, or split it in parts.',
    );
    // A code without a sentence of ours: the core's own message, else the generic one.
    expect(both(() => describeError(e('internal_error', 'The disk is full')))).toEqual([
      'The disk is full',
      'The disk is full',
    ]);
    expect(both(() => describeError(e('internal_error')))[0]).toBe(
      'Something went wrong. Try again in a moment.',
    );
  });

  it('is in English unless the language says otherwise', () => {
    expect(appLang()).toBe('en');
  });
});
