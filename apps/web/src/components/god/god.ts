import { dotPalette, type MonsterGenome } from '@monsters/monster-kit';
import { ASKED_ACTIVITY, CONFUSED_TEXT, capitalize, type LiveState } from '../../store/derive.ts';
import { godStrings } from './god.strings.ts';

/*
 * The bar of the god of the monsters (docs/design.md, "La barra del Dio",
 * D-101): pure logic, no DOM. What state the whole house is in, how fast the
 * colours of the monsters run across the screen, what the god says on its
 * line, and which dots light up. The canvas (marquee.ts) only paints these.
 */

/** The state of every squad together, from the most urgent. */
export type GodKind = 'halted' | 'offline' | 'working' | 'asking' | 'idle' | 'quiet';

/** After this long without a change of any monster the bar comes to rest. */
export const IDLE_MS = 90_000;

/** Columns per second (one column = one step of the dots, never a glide). */
export const SPEED = {
  /** Something just happened, or a question waits: the colours drift. */
  idle: 1.5,
  /** One monster at work. */
  work: 6,
  /** Each monster more at work. */
  perMonster: 2,
  /** The ceiling: also the frame rate cap of the canvas (a display at 20 fps). */
  max: 20,
} as const;

/** A monster at work: a run, words coming, or waiting for another monster (not for the user). */
export function isBusy(l: LiveState | undefined): boolean {
  if (!l) return false;
  if (l.mood === 'waiting' && l.activity === ASKED_ACTIVITY) return false;
  return l.mood === 'working' || l.mood === 'talking' || l.mood === 'waiting';
}

const waitsForUser = (l: LiveState | undefined) =>
  l?.mood === 'waiting' && l.activity === ASKED_ACTIVITY;

export interface GodStateInput {
  halted: boolean;
  /** The stream: `closed` is offline; `reconnecting` keeps the last state. */
  connection: string;
  live: Readonly<Record<string, LiveState>>;
  /** Every monster of every squad, the god included. */
  agentIds: readonly string[];
  /** Monsters with a question open for the user. */
  askers: readonly string[];
  now: number;
}

export interface GodState {
  kind: GodKind;
  /** Monsters at work, in the order of `agentIds`. */
  working: string[];
  /** When the bar goes from `idle` to `quiet` (ms), or null when it will not by itself. */
  restsAt: number | null;
}

/** The state of the house: stopped, offline, at work, a question for you, just moved, quiet. */
export function godState(i: GodStateInput): GodState {
  const working = i.agentIds.filter((id) => isBusy(i.live[id]));
  if (i.halted) return { kind: 'halted', working: [], restsAt: null };
  if (i.connection === 'closed') return { kind: 'offline', working: [], restsAt: null };
  if (working.length > 0) return { kind: 'working', working, restsAt: null };
  const asking = i.askers.length > 0 || i.agentIds.some((id) => waitsForUser(i.live[id]));
  if (asking) return { kind: 'asking', working, restsAt: null };
  let last = 0;
  for (const id of i.agentIds) {
    const l = i.live[id];
    if (l && l.mood !== 'stopped' && l.since > last) last = l.since;
  }
  const restsAt = last + IDLE_MS;
  if (last > 0 && i.now < restsAt) return { kind: 'idle', working, restsAt };
  return { kind: 'quiet', working, restsAt: null };
}

/** How fast the colours run: still when quiet or stopped, a drift at rest, faster with more at work. */
export function marqueeSpeed(kind: GodKind, working = 0): number {
  switch (kind) {
    case 'working':
      return Math.min(SPEED.max, SPEED.work + SPEED.perMonster * Math.max(0, working - 1));
    case 'asking':
    case 'idle':
      return SPEED.idle;
    default:
      return 0;
  }
}

/** "Rhea", "Rhea and Dione", "Rhea, Dione and 2 others". */
export function namesText(names: readonly string[]): string {
  return godStrings().names(names);
}

/**
 * The god's line: what it is doing itself, else what the squads are doing,
 * else a calm line. One line, the screen cuts it with an ellipsis.
 */
export function godLine(input: {
  state: GodState;
  god: LiveState | undefined;
  nameOf: (id: string) => string;
  askers: readonly string[];
  godId: string;
  squads: number;
}): string {
  const { state, god, nameOf, askers, godId, squads } = input;
  const s = godStrings();
  if (state.kind === 'halted') return s.halted;
  if (state.kind === 'offline') return s.offline;
  if (waitsForUser(god) || askers.includes(godId)) return s.waitingAnswer;
  if (god && isBusy(god)) {
    if (god.confused) return capitalize(CONFUSED_TEXT);
    return god.activity ?? (god.mood === 'talking' ? s.writing : s.atWork);
  }
  if (god?.mood === 'error') return god.activity ?? s.problem;
  if (state.kind === 'working') {
    const others = state.working.filter((id) => id !== godId).map(nameOf);
    return s.atWorkWith(namesText(others));
  }
  if (state.kind === 'asking' && askers.length > 0) {
    const who = [...new Set(askers)].map(nameOf);
    return who.length === 1 ? s.oneAsks(who[0]!) : s.manyAsk(namesText(who));
  }
  // At rest the line says who the god is for the user (D-114): the one above every squad.
  return squads > 1 ? s.leadsAll : s.leadsSquad;
}

export interface GodLabel {
  text: string;
  tone: 'stop' | 'signal' | 'ok' | 'off';
  blink: boolean;
}

/** The short label on the right of the name, with its light. */
export function godLabel(
  state: GodState,
  monsters: number,
  questions: number,
  godName?: string,
): GodLabel {
  const s = godStrings().label;
  switch (state.kind) {
    case 'halted':
      return { text: s.halted, tone: 'stop', blink: false };
    case 'offline':
      return { text: s.offline, tone: 'stop', blink: false };
    case 'working':
      return { text: s.working(state.working.length), tone: 'ok', blink: false };
    case 'asking':
      return { text: s.questions(Math.max(1, questions)), tone: 'signal', blink: true };
    default:
      return {
        // It says what it counts: every monster, the god included (D-114).
        text: godName ? s.withGod(monsters, godName) : s.monsters(monsters),
        tone: 'off',
        blink: false,
      };
  }
}

/* ------------------------------------------------------------- colours */

/** One monster on the marquee: its lights, and whether it is at work. */
export interface Band {
  id: string;
  /** The squad: '' for the Squadra personale, else the project id. */
  squad: string;
  lit: string;
  dim: string;
  accent: string;
  accentDim: string;
  working: boolean;
}

export interface BandSource {
  id: string;
  genome: MonsterGenome;
  project?: string | undefined;
}

/**
 * The colours of every monster of every squad, from their genomes: the god
 * first, then the Squadra personale, then each project in the order its
 * monsters come (D-097). A monster at work shines at full light.
 */
export function collectBands(
  agents: readonly BandSource[],
  godId: string | null,
  working: ReadonlySet<string>,
): Band[] {
  const squads = new Map<string, BandSource[]>();
  const god = agents.find((a) => a.id === godId);
  for (const a of agents) {
    if (a === god) continue;
    const key = a.project ?? '';
    if (!squads.has(key)) squads.set(key, []);
    squads.get(key)!.push(a);
  }
  const personal = squads.get('') ?? [];
  squads.delete('');
  const ordered = [...(god ? [god] : []), ...personal, ...[...squads.values()].flat()];
  return ordered.map((a) => {
    const p = dotPalette(a.genome);
    return {
      id: a.id,
      squad: a === god ? '' : (a.project ?? ''),
      lit: p.lit,
      dim: p.dim,
      accent: p.accent,
      accentDim: p.accentDim,
      working: working.has(a.id),
    };
  });
}

/** How many squads: the Squadra personale and each project with monsters. */
export function squadCount(agents: readonly { project?: string | undefined }[]): number {
  const set = new Set(agents.map((a) => a.project ?? ''));
  set.add('');
  return set.size;
}

/** Rows of dots of the marquee. */
export const MARQUEE_ROWS = 4;
/** Columns of one monster's band, and the off columns between monsters and between squads. */
export const BAND_COLS = 6;
export const GAP_COLS = 1;
export const SQUAD_GAP_COLS = 3;

/** A column of the marquee, top to bottom: a colour, or null for an LED that is off. */
export type Column = (string | null)[];

/**
 * The columns of one turn of the marquee (it repeats across the screen): each
 * monster a rounded band of its light crossed by diagonal stripes of its
 * second colour, so the movement reads even on one colour; the dim lights for
 * a monster at rest, full for one at work; a wider gap between squads.
 */
export function marqueeColumns(bands: readonly Band[], rows = MARQUEE_ROWS): Column[] {
  const cols: Column[] = [];
  const off = (): Column => Array.from({ length: rows }, () => null);
  bands.forEach((b, i) => {
    if (i > 0) {
      const gap = b.squad !== bands[i - 1]!.squad ? SQUAD_GAP_COLS : GAP_COLS;
      for (let g = 0; g < gap; g++) cols.push(off());
    }
    const body = b.working ? b.lit : b.dim;
    const stripe = b.working ? b.accent : b.accentDim;
    for (let c = 0; c < BAND_COLS; c++) {
      const col: Column = [];
      for (let r = 0; r < rows; r++) {
        const corner = (c === 0 || c === BAND_COLS - 1) && (r === 0 || r === rows - 1);
        col.push(corner ? null : (c + r) % 4 === 0 ? stripe : body);
      }
      cols.push(col);
    }
  });
  // The turn closes with a gap, so the last band does not touch the first one.
  if (bands.length > 0) {
    const gap =
      bands.length > 1 && bands[0]!.squad !== bands.at(-1)!.squad ? SQUAD_GAP_COLS : GAP_COLS;
    for (let g = 0; g < gap; g++) cols.push(off());
  }
  return cols;
}
