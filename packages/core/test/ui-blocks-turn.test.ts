import { fake } from '@monsters/providers/testing';
import {
  INSTINCT_USE_INFO,
  INSTINCT_USES,
  setAppLang,
  type InstinctMode,
  type LogEvent,
} from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { DecisionPort, SystemOneAnswer } from '../src/index.ts';
import { BANDS, INSTINCT_SPECS, triageRequest } from '../src/team/instinct/questions.ts';
import { questionPrompts } from '../src/team/instinct/questions.prompts.ts';
import { needsDrawnBlock } from '../src/team/toolsets.ts';
import { promptText, startTestHub } from './hub-helpers.ts';
import { inLang } from './prompt-lang.ts';

/*
 * Drawn blocks, the turn side (D-162): the `ui` use of the instinct asks "does the answer read
 * better drawn?" in the same call as the route and the tier; with Jev's p ≥ 0.5, or a word of
 * the request, the manual joins THAT turn's message (never the system prompt, never the chat),
 * with the use on; in shadow it is only asked and logged.
 */

afterEach(() => setAppLang('en'));

// --- the question, the band, the rule ---------------------------------------------------------

describe('the needs_ui question', () => {
  const ask = { route: false, tier: false, web: false, rare: false };

  it('is a noul with the measured English words, in the same call as the others', () => {
    const all = triageRequest({
      request: 'Compare three plans',
      history: [],
      members: [{ name: 'Rhea', description: 'Rhea, research' }],
      ask: { route: true, tier: true, web: true, rare: true, ui: true },
    });
    expect(all.questions.map((q) => q.id)).toEqual([
      'route',
      'route_rev',
      'tier',
      'needs_web',
      'rare_tools',
      'needs_ui',
    ]);
    const q = all.questions.at(-1);
    expect(q).toEqual({
      id: 'needs_ui',
      type: 'noul',
      prompt:
        'The answer to `request` is easier to read drawn (a chart, key numbers, a side-by-side comparison, steps or a table) than written as prose.',
      criteria: {
        true: 'Data to compare, numbers or trends, several options with the same features, steps to follow, a status of many items',
        false:
          'A chat, a text to write or send, one fact, an explanation, a translation, a small action on notes or the calendar',
      },
    });
  });

  it('is not asked unless the caller asks it', () => {
    const none = triageRequest({ request: 'x', history: [], members: [], ask });
    expect(none.questions).toEqual([]);
    const off = triageRequest({
      request: 'x',
      history: [],
      members: [],
      ask: { ...ask, ui: false },
    });
    expect(off.questions).toEqual([]);
  });

  it('has an Italian family that reads its own state key', () => {
    inLang('it');
    const q = questionPrompts().ui;
    expect(q.prompt).toContain('`richiesta`');
    expect(q.prompt).toContain('si legge meglio disegnata');
    const asked = triageRequest({
      request: 'x',
      history: [],
      members: [],
      ask: { ...ask, ui: true },
    });
    expect(Object.keys(asked.state)).toContain('richiesta');
    expect(asked.questions[0]).toMatchObject({ id: 'needs_ui', type: 'noul' });
  });

  it('attaches from 0.5, as measured', () => {
    expect(BANDS.ui.attach).toBe(0.5);
  });
});

describe('the ui use of the instinct', () => {
  it('is on by default, in every mode, with the rules and Jev, never the small model', () => {
    expect(INSTINCT_USES).toContain('ui');
    expect(INSTINCT_USE_INFO.ui).toMatchObject({
      id: 'ui',
      defaultMode: 'on',
      modes: ['off', 'shadow', 'on'],
      rules: true,
      llm: false,
      jev: true,
    });
    expect(INSTINCT_SPECS.ui.timeoutMs).toBe(1_500);
    expect(INSTINCT_USE_INFO.ui.label.length).toBeGreaterThan(5);
    inLang('it');
    expect(INSTINCT_USE_INFO.ui.label).toBe('Disegna tabelle e grafici nella chat');
  });
});

describe('the rule on the words of the request', () => {
  it.each([
    'Confronta i piani di Notion, Obsidian e Craft',
    'Compare the three hosting offers',
    'Come sono andate le vendite? Fammi un grafico',
    'Give me a checklist to prepare the launch',
    'Quali sono i passi per aprire una partita IVA?',
    'Mostrami quanto ho speso per categoria',
  ])('matches %s', (request) => expect(needsDrawnBlock(request)).toBe(true));

  it.each([
    'Ciao! Come va oggi?',
    'Scrivimi un post per LinkedIn sul lancio',
    'Rispondi alla mail di Marco dicendo che ci vediamo giovedì',
    'Traduci in inglese questo paragrafo',
    'What time is it in Tokyo now?',
  ])('does not match %s', (request) => expect(needsDrawnBlock(request)).toBe(false));
});

// --- the turn ---------------------------------------------------------------------------------

/** A fake Jev: `needs_ui` as given, the other questions neutral; remembers what it was asked. */
function jev(p: number): DecisionPort & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    id: 'jev',
    asked,
    decide: (request) => {
      asked.push(request.questions.map((q) => q.id));
      const answers: SystemOneAnswer[] = request.questions.map((q) => {
        const value =
          q.id === 'needs_ui'
            ? p
            : q.type === 'choice'
              ? typeof q.options[0] === 'string'
                ? q.options[0]
                : q.options[0]!.label
              : 0.5;
        return { id: q.id, value, confidence: 0.9 };
      });
      return Promise.resolve({ answers, model: 'jev-1.13.0' });
    },
  };
}

/** What the first call of the model saw, and the log of the run. */
async function turn(
  text: string,
  options: { engine?: DecisionPort | null; ui?: InstinctMode } = {},
) {
  const engine = options.engine === undefined ? null : options.engine;
  const t = await startTestHub(
    { titan: [fake.text('Fatto.')] },
    {
      hub: {
        decisionPort: engine,
        settings: {
          instinct: {
            ...(engine ? { engine: 'jev' as const } : {}),
            ...(options.ui ? { uses: { ui: options.ui } } : {}),
          },
        },
      },
    },
  );
  const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text });
  await t.runEnded(sent.runId);
  const call = t.provider.calls[0]!;
  return {
    t,
    seen: promptText(call.options.prompt),
    tools: (call.options.tools ?? []).map((tool) => tool.name),
    events: t.events(sent.runId),
    decisions: t
      .events(sent.runId)
      .filter(
        (e): e is LogEvent<'decision'> => e.type === 'decision' && e.data.kind === 'needs_ui',
      ),
  };
}

const MANUAL = 'Manual of the `ui` blocks:';

describe('the manual joins the turn', () => {
  it('Jev says it reads better drawn: attached to the message, and ui_guide is there', async () => {
    const engine = jev(0.9);
    const r = await turn('Thanks, perfect', { engine });
    expect(r.seen).toContain(MANUAL);
    expect(r.seen).toContain('root = Block([...])');
    expect(r.tools).toContain('ui_guide');
    expect(engine.asked[0]).toContain('needs_ui');
    // The decision is logged as the other uses do, with the use and the band.
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]!.data).toMatchObject({
      use: 'ui',
      mode: 'on',
      engine: 'jev',
      choice: 'yes',
      value: 0.9,
      band: 'high',
    });
  });

  it('it is the turn’s message, never the system prompt and never a message of the chat', async () => {
    const r = await turn('Thanks, perfect', { engine: jev(0.9) });
    const call = r.t.provider.calls[0]!;
    const prompt = call.options.prompt as { role: string; content: unknown }[];
    const system = prompt.filter((m) => m.role === 'system').map((m) => JSON.stringify(m));
    // The system prompt only has the card's line, not the manual.
    expect(system.join('')).toContain('ui_guide');
    expect(system.join('')).not.toContain(MANUAL);
    expect(
      prompt
        .filter((m) => m.role === 'user')
        .map((m) => JSON.stringify(m))
        .join(''),
    ).toContain(MANUAL);
    // Nothing in the log carries it as a message.
    for (const e of r.events) {
      if (e.type === 'message') expect(e.data.text).not.toContain(MANUAL);
    }
  });

  it('a word of the request attaches it without asking Jev about it', async () => {
    const engine = jev(0.1);
    const r = await turn('Confronta i piani di Notion e Obsidian', { engine });
    expect(r.seen).toContain(MANUAL);
    expect(engine.asked[0]).not.toContain('needs_ui');
  });

  it('the words alone work with the rules engine (no key, no Jev)', async () => {
    const r = await turn('Compare three hosting plans');
    expect(r.seen).toContain(MANUAL);
    expect(r.decisions).toEqual([]);
  });

  it('neither Jev nor a word: nothing attached, the tool still there', async () => {
    const r = await turn('Thanks, perfect', { engine: jev(0.1) });
    expect(r.seen).not.toContain(MANUAL);
    expect(r.tools).toContain('ui_guide');
    expect(r.decisions[0]!.data).toMatchObject({ use: 'ui', choice: 'no', band: 'low' });
  });

  it('without an engine and without a word nothing is attached', async () => {
    const r = await turn('Thanks, perfect');
    expect(r.seen).not.toContain(MANUAL);
  });

  it('in shadow it is asked and logged, nothing attached (not even for a word)', async () => {
    const engine = jev(0.95);
    const r = await turn('Thanks, perfect', { engine, ui: 'shadow' });
    expect(engine.asked[0]).toContain('needs_ui');
    expect(r.decisions[0]!.data).toMatchObject({ use: 'ui', mode: 'shadow', choice: 'yes' });
    expect(r.seen).not.toContain(MANUAL);
    const words = await turn('Compare three hosting plans', { ui: 'shadow' });
    expect(words.seen).not.toContain(MANUAL);
  });

  it('off: not asked, not attached', async () => {
    const engine = jev(0.95);
    const r = await turn('Compare three hosting plans', { engine, ui: 'off' });
    expect(engine.asked[0] ?? []).not.toContain('needs_ui');
    expect(r.seen).not.toContain(MANUAL);
    expect(r.decisions).toEqual([]);
  });

  it('in an Italian app the manual is the Italian one', async () => {
    inLang('it');
    const r = await turn('Grazie, perfetto', { engine: jev(0.9) });
    expect(r.seen).toContain('Manuale dei blocchi `ui`:');
    expect(r.seen).toContain('Non disegnare');
  });
});

describe('OpenUI telemetry', () => {
  it('the core turns it off at its start, whatever the environment says', async () => {
    const before = {
      enabled: process.env['OPENUI_RUNTIME_TELEMETRY_ENABLED'],
      disabled: process.env['OPENUI_TELEMETRY_DISABLED'],
    };
    process.env['OPENUI_RUNTIME_TELEMETRY_ENABLED'] = '1';
    delete process.env['OPENUI_TELEMETRY_DISABLED'];
    try {
      await startTestHub({});
      expect(process.env['OPENUI_TELEMETRY_DISABLED']).toBe('1');
      expect(process.env['OPENUI_RUNTIME_TELEMETRY_ENABLED']).toBeUndefined();
    } finally {
      for (const [name, value] of [
        ['OPENUI_RUNTIME_TELEMETRY_ENABLED', before.enabled],
        ['OPENUI_TELEMETRY_DISABLED', before.disabled],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
