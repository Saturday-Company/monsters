import {
  INSTINCT_USE_INFO,
  ulid,
  type EventInput,
  type InstinctUseView,
  type LogEvent,
  type ReceiptData,
} from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { hasEffect } from '../src/components/log/activity.ts';
import { buildTerminal } from '../src/components/terminal/entries.ts';
import { mockReceipt } from '../src/lib/mock/instinct.ts';
import {
  applyLive,
  buildChat,
  categoryOf,
  chatSummary,
  CONFUSED_MS,
  describeEvent,
  makeNameOf,
  runStatsIndex,
  type LiveState,
} from '../src/store/derive.ts';
import {
  chainModelName,
  instinctSentence,
  receiptInChat,
  receiptSummary,
  reorderedLines,
  scoreLines,
  securitySentence,
  sourceText,
  needsOf,
} from '../src/store/instinct.ts';

/* The instinct in the UI (D-068): its sentences, the receipt, the confused face. */

let clock = 1_760_000_000_000;
function ev<T extends EventInput>(input: T, at?: number): LogEvent {
  clock = at ?? clock + 1000;
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

const names = makeNameOf({});
const NO_JARGON = /system 1|gate|shadow|soglia|\bp\b|done_check|route_hint/i;

const instinct = (
  action: Extract<EventInput, { type: 'instinct' }>['data']['action'],
  extra: Partial<Extract<EventInput, { type: 'instinct' }>['data']> = {},
) =>
  ev({
    agent: 'system',
    runId: 'r1',
    type: 'instinct',
    data: { use: 'stuck', action, message: 'gli ho chiesto…', subject: 'rhea', ...extra },
  }) as LogEvent<'instinct'>;

describe('sentences of the instinct', () => {
  it('speaks plain, neutral Italian from the fields, never jargon', () => {
    const say = (e: LogEvent<'instinct'>) => instinctSentence(e.data, names);
    expect(
      say(
        instinct('route_hint', { use: 'route_hint', subject: 'titan', details: { route: 'Rhea' } }),
      ),
    ).toBe('Ci pensa Rhea');
    expect(say(instinct('retry', { use: 'done_check', subject: 'titan' }))).toBe(
      'Titan non aveva finito il lavoro: ho chiesto di completarlo',
    );
    expect(say(instinct('stuck_nudge'))).toBe('Rhea girava a vuoto: ho chiesto di cambiare strada');
    expect(
      say(
        instinct('outbound_refused', {
          use: 'outbound',
          details: { summary: 'pubblicare il post', outcome: 'refused' },
        }),
      ),
    ).toBe('Hai detto no: Rhea non farà pubblicare il post');
    // A card nobody could see says why (D-142).
    expect(
      say(
        instinct('outbound_refused', {
          use: 'outbound',
          details: {
            summary: 'pubblicare il post',
            outcome: 'expired',
            unseen: 'era un’automazione: l’utente non la stava seguendo',
          },
        }),
      ),
    ).toBe(
      'Nessuna risposta (era un’automazione: l’utente non la stava seguendo): Rhea non ha fatto pubblicare il post',
    );
    // What a monster said about its accesses and the log did not back (D-140).
    expect(say(instinct('access_claim', { use: 'done_check', details: { mode: 'rewrite' } }))).toBe(
      'Rhea diceva che un accesso mancava o era negato, e non era così: l’ho fatto correggere',
    );
    expect(
      say(
        instinct('access_claim', {
          use: 'done_check',
          details: { mode: 'note', truth: ['il web: ce l’hai in questo lavoro'] },
        }),
      ),
    ).toBe(
      'Rhea ha scritto che un accesso mancava o era negato, e non è così: il web: ce l’hai in questo lavoro',
    );
    expect(
      say(
        instinct('chain_reordered', {
          use: 'scorecard',
          details: {
            chain: [
              'openrouter:meta-llama/llama-3.3-70b-instruct:free',
              'openrouter:openrouter/free',
            ],
          },
        }),
      ),
    ).toBe('Ora Rhea usa prima llama 3.3 70b: finisce più lavori e costa meno');
    for (const action of ['stuck_notice', 'stuck_demote', 'tools', 'final_question'] as const)
      expect(say(instinct(action))).not.toMatch(NO_JARGON);
  });

  it('says where an order to the monsters came from', () => {
    expect(sourceText('web_fetch https://www.visitlisboa.com/it', 'web_fetch')).toBe(
      'una pagina web (visitlisboa.com)',
    );
    expect(sourceText('mcp:browser https://x.org/a', 'mcp__browser__browser_navigate')).toBe(
      'una pagina aperta nel browser (x.org)',
    );
    expect(sourceText('mcp:github', 'mcp__github__get_issue')).toBe('i risultati di github');
    expect(
      securitySentence({
        action: 'injection_removed',
        source: 'web_fetch https://www.visitlisboa.com/it',
        tool: 'web_fetch',
        p: 0.9,
        message: '',
      }),
    ).toBe('Ho tolto da una pagina web (visitlisboa.com) un testo che dava ordini ai mostri');
    expect(chainModelName('openrouter:openrouter/free')).toBe('il modello gratuito di OpenRouter');
  });

  it('puts the removed orders and the brake among the important things, the rest under Tutto', () => {
    const removed = ev({
      agent: 'system',
      type: 'security',
      data: {
        action: 'injection_removed',
        source: 'web_fetch https://a.b',
        tool: 'web_fetch',
        p: 0.9,
        message: '',
      },
    });
    const warned = ev({
      agent: 'system',
      type: 'security',
      data: {
        action: 'injection_warned',
        source: 'web_fetch https://a.b',
        tool: 'web_fetch',
        p: 0.6,
        message: '',
      },
    });
    expect(hasEffect(removed)).toBe(true);
    expect(hasEffect(warned)).toBe(false);
    expect(hasEffect(instinct('outbound_approved', { use: 'outbound' }))).toBe(true);
    expect(hasEffect(instinct('outbound_hold', { use: 'outbound' }))).toBe(false);
    expect(hasEffect(instinct('route_hint', { use: 'route_hint' }))).toBe(false);
    const answer = ev({
      agent: 'rhea',
      type: 'decision',
      data: {
        kind: 'done_check',
        question: 'q',
        options: [],
        choice: 'yes',
        decidedBy: 'model',
        use: 'done_check',
        mode: 'shadow',
      },
    });
    expect(categoryOf(answer)).toBe('instinct');
    expect(hasEffect(answer)).toBe(false);
    expect(describeEvent(answer, names)).toBe(
      'Decisione per Rhea: controlla che i lavori siano finiti davvero (solo annotato)',
    );
  });
});

describe('the confused monster', () => {
  it('looks confused on a stuck event and goes back to work once it moves on', () => {
    const ids = ['rhea'];
    let live: Record<string, LiveState> = {};
    const start = 1_760_100_000_000;
    live = applyLive(
      live,
      ev(
        {
          agent: 'rhea',
          runId: 'r1',
          type: 'tool_call',
          data: { callId: 'a', tool: 'vault_list', input: {} },
        },
        start,
      ),
      ids,
    );
    live = applyLive(live, instinct('stuck_nudge'), ids);
    expect(live['rhea']).toMatchObject({ mood: 'working', confused: true });
    // A call right away does not undo the face…
    live = applyLive(
      live,
      ev(
        {
          agent: 'rhea',
          runId: 'r1',
          type: 'tool_call',
          data: { callId: 'b', tool: 'vault_list', input: {} },
        },
        clock + 500,
      ),
      ids,
    );
    expect(live['rhea']?.confused).toBe(true);
    // …one after a moment does.
    live = applyLive(
      live,
      ev(
        {
          agent: 'rhea',
          runId: 'r1',
          type: 'tool_call',
          data: { callId: 'c', tool: 'web_search', input: {} },
        },
        clock + CONFUSED_MS,
      ),
      ids,
    );
    expect(live['rhea']?.confused).toBeUndefined();
    expect(live['rhea']?.mood).toBe('working');
    // A monster at rest is never confused.
    expect(
      applyLive({ rhea: { mood: 'idle', since: 0 } }, instinct('stuck_notice'), ids)['rhea']
        ?.confused,
    ).toBeUndefined();
  });
});

describe('the receipt and the lines of the instinct in the chat', () => {
  const events: LogEvent[] = [];
  const add = (input: EventInput) => {
    const e = ev(input);
    events.push(e);
    return e;
  };
  add({
    agent: 'user',
    runId: 'r9',
    type: 'message',
    data: { role: 'user', text: 'Riassumi la riunione' },
  });
  add({ agent: 'titan', runId: 'r9', type: 'run', data: { status: 'started' } });
  add({
    agent: 'system',
    runId: 'r9',
    type: 'instinct',
    data: {
      use: 'route_hint',
      action: 'route_hint',
      message: '',
      subject: 'titan',
      details: { route: 'Dione' },
    },
  });
  const start = add({
    agent: 'titan',
    runId: 'r9',
    type: 'delegation',
    data: { from: 'titan', to: 'dione', status: 'started', goal: 'Riassumi', doneWhen: 'Una nota' },
  });
  const call = add({
    agent: 'dione',
    runId: 'r9',
    type: 'tool_call',
    data: { callId: 'w', tool: 'web_fetch', input: {} },
  });
  add({
    agent: 'system',
    runId: 'r9',
    parentId: call.id,
    type: 'security',
    data: {
      action: 'injection_removed',
      source: 'web_fetch https://a.example/x',
      tool: 'web_fetch',
      p: 0.95,
      message: '',
    },
  });
  add({
    agent: 'dione',
    runId: 'r9',
    type: 'vault_change',
    data: { action: 'create', path: 'Riunioni/R.md', actionId: 'a1' },
  });
  add({
    agent: 'dione',
    runId: 'r9',
    type: 'vault_change',
    data: { action: 'edit', path: 'Agenti/Dione/MEMORY.md', actionId: 'a2' },
  });
  add({
    agent: 'system',
    runId: 'r9',
    parentId: start.id,
    type: 'instinct',
    data: { use: 'done_check', action: 'retry', message: '', subject: 'dione' },
  });
  add({
    agent: 'titan',
    runId: 'r9',
    type: 'delegation',
    data: {
      from: 'titan',
      to: 'dione',
      status: 'completed',
      goal: 'Riassumi',
      check: {
        verdict: 'doubt',
        criteria: [
          { text: 'Una nota', kind: 'done_when', ok: false, by: 'model', reason: 'manca chi' },
        ],
      },
    },
  });
  add({
    agent: 'system',
    runId: 'r9',
    type: 'provider_usage',
    data: { provider: 'typesafe', model: 'jev-1.13.0', costUsd: 0.00002 },
  });
  add({
    agent: 'titan',
    runId: 'r9',
    type: 'provider_usage',
    data: { provider: 'openrouter', model: 'x/y:free', costUsd: 0 },
  });
  const receipt: ReceiptData = mockReceipt(
    'r9',
    events,
    'completed',
    (id) => names(id),
    clock + 1000,
  );
  add({ agent: 'system', runId: 'r9', type: 'receipt', data: receipt });

  it('builds the receipt from the log like the core', () => {
    expect(receipt.agent).toBe('titan');
    expect(receipt.delegations[0]).toMatchObject({ verdict: 'doubt', agentName: 'Dione' });
    expect(receipt.alerts.injections).toBe(1);
    expect(receiptSummary(receipt)).toBe('1 incarico · 1 in dubbio · 1 nota · 0,00002 $');
    expect(receiptInChat(receipt)).toBe(true);
    expect(receiptInChat({ ...receipt, request: '' })).toBe(false);
  });

  it('shows the hint, the removed text, the receipt; the check of a task goes with the task', () => {
    const items = buildChat(events, [], names);
    const lines = items
      .filter((i) => i.kind === 'instinct')
      .map((i) => (i as { text: string }).text);
    expect(lines).toEqual([
      'Ci pensa Dione',
      'Ho tolto da una pagina web (a.example) un testo che dava ordini ai mostri',
    ]);
    const removed = items.find((i) => i.kind === 'instinct' && i.text.startsWith('Ho tolto'));
    expect(removed).toMatchObject({ agent: 'dione', tone: 'stop' });
    const task = items.find((i) => i.kind === 'delegation');
    expect(task).toMatchObject({
      checks: [{ text: 'Dione non aveva finito il lavoro: ho chiesto di completarlo' }],
    });
    expect(items.at(-1)).toMatchObject({ kind: 'receipt', agent: 'titan', runId: 'r9' });
    // The preview of the chat is still what the monsters said, not the receipt.
    expect(chatSummary(items, '').last?.kind).toBe('delegation');
  });

  it('counts the cost of the instinct, not its model, in the instrumentation', () => {
    const stats = runStatsIndex(events).get('r9');
    expect(stats?.lastModel).toBe('x/y:free');
    expect(stats?.costUsd).toBeCloseTo(0.00002);
  });

  it('puts its lines in the terminal of the monster they are about', () => {
    const dione = buildTerminal(events, 'dione').map((e) => e.kind);
    expect(dione).toContain('instinct');
    expect(dione).toContain('security');
    expect(buildTerminal(events, 'titan').map((e) => e.kind)).toContain('receipt');
  });
});

describe('settings: uses and pagella', () => {
  const use = (
    id: keyof typeof INSTINCT_USE_INFO,
    mode: 'on' | 'off' | 'shadow',
    active: boolean,
  ): InstinctUseView => {
    const info = INSTINCT_USE_INFO[id];
    return {
      id,
      mode,
      defaultMode: info.defaultMode,
      modes: [...info.modes],
      label: info.label,
      description: info.description,
      engines: [
        ...(info.rules ? (['rules'] as const) : []),
        ...(info.llm ? (['llm'] as const) : []),
        ...(info.jev ? (['jev'] as const) : []),
      ],
      active,
      sends: info.sends,
    };
  };
  const jev = (keySet: boolean) => ({ keySet, model: 'jev-1.13.0', maxP: 0.45 });

  it('says what a use waits for, in words', () => {
    expect(needsOf(use('route_hint', 'on', false), { engine: 'rules', jev: jev(false) })).toBe(
      'Serve il modello esperto',
    );
    expect(needsOf(use('memory', 'on', false), { engine: 'rules', jev: jev(false) })).toBe(
      'Serve il modello esperto o il modello piccolo',
    );
    expect(needsOf(use('route_hint', 'on', false), { engine: 'jev', jev: jev(false) })).toBe(
      'Serve la chiave di TypeSafe',
    );
    expect(needsOf(use('gate', 'on', true), { engine: 'rules', jev: jev(false) })).toBeNull();
    expect(
      needsOf(use('route_hint', 'off', false), { engine: 'rules', jev: jev(false) }),
    ).toBeNull();
  });

  it('reads the pagella and says when a chain was reordered', () => {
    const view = {
      enabled: true,
      minDelegations: 20,
      rows: [
        {
          agent: 'rhea',
          agentName: 'Rhea',
          model: 'openrouter:openrouter/free',
          tier: 'any' as const,
          delegations: 24,
          checked: 22,
          verified: 20,
          doubt: 1,
          incomplete: 1,
          failed: 0,
          successRate: 20 / 22,
          avgSteps: 5,
          avgCostUsd: 0,
          costPerVerifiedUsd: 0,
        },
      ],
      reordered: { rhea: ['openrouter:meta-llama/llama-3.3-70b-instruct:free'] },
    };
    expect(scoreLines(view)[0]).toMatchObject({
      model: 'il modello gratuito di OpenRouter',
      costPerJob: 'gratis',
      missing: 0,
    });
    expect(reorderedLines(view, names)).toEqual([
      'Ora Rhea usa prima llama 3.3 70b: finisce più lavori e costa meno.',
    ]);
  });
});
