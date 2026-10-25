import { dotPalette } from '@monsters/monster-kit';
import { setAppLang } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BAND_COLS,
  GAP_COLS,
  IDLE_MS,
  SPEED,
  SQUAD_GAP_COLS,
  collectBands,
  godLabel,
  godLine,
  godState,
  marqueeColumns,
  marqueeSpeed,
  namesText,
  squadCount,
  type GodStateInput,
} from '../src/components/god/god.ts';
import { godStrings } from '../src/components/god/god.strings.ts';
import { monsterFor } from '../src/lib/monsters.ts';
import { ASKED_ACTIVITY, CONFUSED_TEXT, capitalize, type LiveState } from '../src/store/derive.ts';

const NOW = 1_800_000_000_000;
const ids = ['titan', 'rhea', 'dione', 'mimas'];

const input = (over: Partial<GodStateInput> = {}): GodStateInput => ({
  halted: false,
  connection: 'open',
  live: {},
  agentIds: ids,
  askers: [],
  now: NOW,
  ...over,
});

const at = (mood: LiveState['mood'], since = NOW - 1000, activity?: string): LiveState => ({
  mood,
  since,
  activity,
});

describe('god bar: the state of the house', () => {
  it('is quiet with nothing live, and when the last change is old', () => {
    expect(godState(input()).kind).toBe('quiet');
    const old = { rhea: at('done', NOW - IDLE_MS - 1) };
    expect(godState(input({ live: old }))).toEqual({ kind: 'quiet', working: [], restsAt: null });
  });

  it('is idle for a while after a change, and says when it comes to rest', () => {
    const live = { rhea: at('done', NOW - 10_000), dione: at('idle', NOW - 50_000) };
    expect(godState(input({ live }))).toEqual({
      kind: 'idle',
      working: [],
      restsAt: NOW - 10_000 + IDLE_MS,
    });
  });

  it('counts a run, words and waiting for another monster as work, not waiting for the user', () => {
    const live = {
      titan: at('waiting', NOW, 'Aspetto Rhea'),
      rhea: at('working', NOW, 'Cerco “Lisbona”'),
      dione: at('talking'),
      mimas: at('waiting', NOW, ASKED_ACTIVITY),
    };
    const s = godState(input({ live }));
    expect(s.kind).toBe('working');
    expect(s.working).toEqual(['titan', 'rhea', 'dione']);
  });

  it('asks when a question waits and nobody works', () => {
    expect(godState(input({ askers: ['rhea'] })).kind).toBe('asking');
    const live = { mimas: at('waiting', NOW, ASKED_ACTIVITY) };
    expect(godState(input({ live })).kind).toBe('asking');
  });

  it('stopped and offline come before everything', () => {
    const live = { rhea: at('working') };
    expect(godState(input({ live, halted: true }))).toEqual({
      kind: 'halted',
      working: [],
      restsAt: null,
    });
    expect(godState(input({ live, connection: 'closed' })).kind).toBe('offline');
    // Reconnecting keeps the last state (the display says it).
    expect(godState(input({ live, connection: 'reconnecting' })).kind).toBe('working');
  });

  it('ignores monsters of other squads that are not known any more', () => {
    const live = { ghost: at('working') };
    expect(godState(input({ live })).kind).toBe('quiet');
  });
});

describe('god bar: speed', () => {
  it('is still when quiet, stopped or offline; drifts at rest; faster with more at work', () => {
    expect(marqueeSpeed('quiet')).toBe(0);
    expect(marqueeSpeed('halted', 3)).toBe(0);
    expect(marqueeSpeed('offline')).toBe(0);
    expect(marqueeSpeed('idle')).toBe(SPEED.idle);
    expect(marqueeSpeed('asking')).toBe(SPEED.idle);
    const one = marqueeSpeed('working', 1);
    const three = marqueeSpeed('working', 3);
    expect(one).toBe(SPEED.work);
    expect(three).toBeGreaterThan(one);
    expect(one).toBeGreaterThan(SPEED.idle);
  });

  it('never runs over the frame cap (one step = one frame)', () => {
    expect(marqueeSpeed('working', 50)).toBe(SPEED.max);
    expect(SPEED.max).toBeLessThanOrEqual(25);
  });
});

describe('god bar: words', () => {
  afterEach(() => setAppLang('en'));
  const nameOf = (id: string) => id[0]!.toUpperCase() + id.slice(1);
  const line = (live: Record<string, LiveState>, over: Partial<GodStateInput> = {}, squads = 1) => {
    const i = input({ live, ...over });
    return godLine({
      state: godState(i),
      god: live['titan'],
      nameOf,
      askers: i.askers,
      godId: 'titan',
      squads,
    });
  };

  it('says what the god itself is doing first', () => {
    expect(line({ titan: at('waiting', NOW, 'Aspetto Rhea'), rhea: at('working') })).toBe(
      'Aspetto Rhea',
    );
    expect(line({ titan: at('working') })).toBe('At work…');
    expect(line({ titan: { ...at('working', NOW, 'Cerco'), confused: true } })).toBe(
      capitalize(CONFUSED_TEXT),
    );
    expect(line({ titan: at('waiting', NOW, ASKED_ACTIVITY), rhea: at('working') })).toBe(
      'Waiting for you',
    );
  });

  it('else who is at work, or who waits for an answer', () => {
    expect(line({ rhea: at('working') })).toBe('At work: Rhea');
    expect(line({ rhea: at('working'), dione: at('working') })).toBe('At work: Rhea and Dione');
    expect(line({ rhea: at('working'), dione: at('working'), mimas: at('talking') })).toBe(
      'At work: Rhea, Dione and one other',
    );
    expect(line({}, { askers: ['rhea'] })).toBe('Rhea has a question');
    expect(line({}, { askers: ['rhea', 'dione', 'rhea'] })).toBe('Rhea and Dione have questions');
  });

  it('a calm line at rest, the stop and the lost connection in words', () => {
    expect(line({})).toBe('Leading the squad');
    expect(line({}, {}, 3)).toBe('Leading all the squads');
    expect(line({ rhea: at('working') }, { halted: true })).toBe('The monsters are stopped');
    expect(line({}, { connection: 'closed' })).toBe('Not connected to the computer');
  });

  it('names the monsters', () => {
    expect(namesText([])).toBe('');
    expect(namesText(['A', 'B'])).toBe('A and B');
    expect(namesText(['A', 'B', 'C', 'D'])).toBe('A, B and 2 others');
  });

  it('says the same in Italian', () => {
    setAppLang('it');
    expect(line({ titan: at('working') })).toBe('Al lavoro…');
    expect(line({ rhea: at('working'), dione: at('working') })).toBe('Al lavoro: Rhea e Dione');
    expect(line({ rhea: at('working'), dione: at('working'), mimas: at('talking') })).toBe(
      'Al lavoro: Rhea, Dione e un altro',
    );
    expect(line({}, { askers: ['rhea'] })).toBe('Rhea aspetta una tua risposta');
    expect(line({}, { askers: ['rhea', 'dione', 'rhea'] })).toBe(
      'Rhea e Dione aspettano una tua risposta',
    );
    expect(line({})).toBe('A capo della squadra');
    expect(line({}, {}, 3)).toBe('A capo di tutte le squadre');
    expect(line({ rhea: at('working') }, { halted: true })).toBe('I mostri sono fermi');
    expect(line({}, { connection: 'closed' })).toBe('Non collegato al computer');
    expect(namesText(['A', 'B', 'C', 'D'])).toBe('A, B e altri 2');
  });

  it('the label: a word or a number with its light', () => {
    const s = (kind: Parameters<typeof marqueeSpeed>[0], working: string[] = []) => ({
      kind,
      working,
      restsAt: null,
    });
    expect(godLabel(s('halted'), 5, 0)).toEqual({ text: 'Stopped', tone: 'stop', blink: false });
    expect(godLabel(s('working', ['a', 'b']), 5, 0).text).toBe('2 at work');
    expect(godLabel(s('asking'), 5, 2)).toEqual({
      text: '2 questions',
      tone: 'signal',
      blink: true,
    });
    expect(godLabel(s('quiet'), 5, 0)).toEqual({ text: '5 monsters', tone: 'off', blink: false });
    expect(godLabel(s('quiet'), 5, 0, 'Titan').text).toBe('5 with Titan');
    setAppLang('it');
    expect(godLabel(s('halted'), 5, 0)).toEqual({ text: 'Fermi', tone: 'stop', blink: false });
    expect(godLabel(s('working', ['a', 'b']), 5, 0).text).toBe('2 al lavoro');
    expect(godLabel(s('asking'), 5, 2)).toEqual({ text: '2 domande', tone: 'signal', blink: true });
    expect(godLabel(s('quiet'), 5, 0)).toEqual({ text: '5 mostri', tone: 'off', blink: false });
    expect(godLabel(s('quiet'), 5, 0, 'Titan').text).toBe('5 con Titan');
  });
});

describe('god bar: colours of every squad', () => {
  const agent = (id: string, project?: string) => ({
    id,
    genome: monsterFor(id),
    ...(project ? { project } : {}),
  });
  const team = [
    agent('rhea'),
    agent('lyra', 'social'),
    agent('titan'),
    agent('dione'),
    agent('vega', 'social'),
    agent('orion', 'sito'),
  ];

  it('takes every monster once: the god first, the Squadra personale, then each project', () => {
    const bands = collectBands(team, 'titan', new Set());
    expect(bands.map((b) => b.id)).toEqual(['titan', 'rhea', 'dione', 'lyra', 'vega', 'orion']);
    expect(bands.map((b) => b.squad)).toEqual(['', '', '', 'social', 'social', 'sito']);
    expect(squadCount(team)).toBe(3);
    expect(squadCount([agent('rhea')])).toBe(1);
  });

  it('uses the LED colours of the genome: dim at rest, full light at work', () => {
    const bands = collectBands(team, 'titan', new Set(['dione']));
    const dione = bands.find((b) => b.id === 'dione')!;
    expect(dione.lit).toBe(dotPalette(monsterFor('dione')).lit);
    expect(dione.working).toBe(true);
    expect(bands.find((b) => b.id === 'rhea')!.working).toBe(false);
    // Different monsters, different lights.
    expect(new Set(bands.map((b) => b.lit)).size).toBe(bands.length);

    const cols = marqueeColumns(bands);
    const colours = new Set(cols.flat().filter(Boolean));
    expect(colours.has(dione.lit)).toBe(true);
    expect(colours.has(bands[1]!.dim)).toBe(true);
    expect(colours.has(bands[1]!.lit)).toBe(false);
  });

  it('a band per monster, a wider gap between squads, and a gap that closes the turn', () => {
    const bands = collectBands(team, 'titan', new Set());
    const cols = marqueeColumns(bands, 4);
    // 6 bands; gaps: 2 inside the Squadra personale, 1 between social, 2 squad changes, the close.
    const expected = 6 * BAND_COLS + 3 * GAP_COLS + 2 * SQUAD_GAP_COLS + SQUAD_GAP_COLS;
    expect(cols).toHaveLength(expected);
    for (const c of cols) expect(c).toHaveLength(4);
    // The band is rounded: its corners are off, its middle is lit.
    expect(cols[0]![0]).toBeNull();
    expect(cols[0]![1]).not.toBeNull();
    expect(cols[BAND_COLS]!.every((c) => c === null)).toBe(true);
    expect(marqueeColumns([])).toEqual([]);
  });
});

describe('the accessible name of the bar', () => {
  afterEach(() => setAppLang('en'));

  it('says the role once when the line only repeats it (V-5)', () => {
    const s = godStrings();
    expect(s.aria('Titan', 1, '', '4 monsters with Titan')).toBe(
      'Titan. Leading the squad. 4 monsters with Titan',
    );
    expect(s.aria('Titan', 2, '', 'x')).toBe('Titan. Leading the 2 squads. x');
    // A line that says something else still follows.
    expect(s.aria('Titan', 1, 'Waiting for you', '1 question')).toBe(
      'Titan. Leading the squad: Waiting for you. 1 question',
    );
    setAppLang('it');
    expect(godStrings().aria('Titan', 1, '', 'x')).toBe('Titan. A capo della squadra. x');
  });
});
