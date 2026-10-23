import {
  INSTINCT_USE_INFO,
  INSTINCT_USES,
  type InstinctUse,
  type InstinctUseInfo,
} from '@monsters/shared';
import type { SystemOneOption, SystemOneQuestion, SystemOneRequest } from '../decision.ts';
import { questionPrompts, ROUTE_LEADS, ROUTE_TEAMS } from './questions.prompts.ts';

/*
 * The questions of the instinct in one place (D-067, research 08 §5.0): for
 * every use what is asked, with which criteria, which thresholds, how long it
 * may take, and the builder of the request from the facts of the moment. The
 * texts and the thresholds marked "misurato" come from the measure of
 * 15/10/2026 (research 08 §4, `eval:instinct`): change one and measure again.
 *
 * Rules that hold for every question (TypeSafe's jaggedness of jev-1.13):
 * one condition per `noul`, "yes" is the high value, facts in the state and
 * questions in the instructions, options shuffled (Jev prefers the first one),
 * counts and dates in code, never asked.
 */

/** Version of this registry: it goes in the `decision` events with the answers. */
export const INSTINCT_QUESTIONS_VERSION = '2026-10-23.1';

/** The Jev version the thresholds were measured on. */
export const INSTINCT_JEV_MODEL = 'jev-1.13.0';

/** On the critical path (the user or the loop waits): beyond this the use goes on without. */
export const CRITICAL_TIMEOUT_MS = 1_500;
/** After the work (end of a delegation, memory): the user is not waiting on it. */
export const BACKGROUND_TIMEOUT_MS = 8_000;

export interface UseSpec extends InstinctUseInfo {
  timeoutMs: number;
}

/** Timeout of each use: the critical path waits 1.5 s at most. */
const TIMEOUTS: Readonly<Record<InstinctUse, number>> = {
  gate: CRITICAL_TIMEOUT_MS,
  done_check: BACKGROUND_TIMEOUT_MS,
  stuck: CRITICAL_TIMEOUT_MS,
  final_question: CRITICAL_TIMEOUT_MS,
  route_hint: CRITICAL_TIMEOUT_MS,
  tools: CRITICAL_TIMEOUT_MS,
  ui: CRITICAL_TIMEOUT_MS,
  tier: CRITICAL_TIMEOUT_MS,
  shortcut: CRITICAL_TIMEOUT_MS,
  outbound: CRITICAL_TIMEOUT_MS,
  injection: CRITICAL_TIMEOUT_MS,
  memory: BACKGROUND_TIMEOUT_MS,
  scorecard: 0,
};

export const INSTINCT_SPECS: Readonly<Record<InstinctUse, UseSpec>> = Object.fromEntries(
  // The texts of a use are getters that follow the app's language: copy the descriptors, not the values.
  INSTINCT_USES.map((u) => [
    u,
    Object.defineProperties(
      { timeoutMs: TIMEOUTS[u] },
      Object.getOwnPropertyDescriptors(INSTINCT_USE_INFO[u]),
    ),
  ]),
) as Record<InstinctUse, UseSpec>;

// --- thresholds ---------------------------------------------------------------------

/**
 * Two bands per use (research 08 §4.3: with p ≥ 0.85 or ≤ 0.15 Jev was right 51
 * times out of 52, in between 23 out of 29): above `high` the core acts alone,
 * between `low` and `high` only a soft action (a warning, a hint, a line in
 * the Activity).
 */
export const BANDS = {
  /** Gate: the engine may proceed only with p("the user decides") ≤ 0.45 (misurato, §4.2). */
  gateJevMaxP: 0.45,
  /** "Finito davvero?" (misurato): < 0.35 reminder and more steps, < 0.6 "dubbio". */
  done: { low: 0.35, high: 0.6 },
  /** "Gira a vuoto?" (misurato): ≥ 0.85 a nudge, ≥ 0.5 only the event. */
  stuck: { low: 0.5, high: 0.85 },
  /** Question in the text (misurato): ≥ 0.7 adds a reminder, < 0.2 vetoes the regex. */
  finalQuestion: { low: 0.2, high: 0.7 },
  /** Routing (misurato): a hint from 0.7 (14/15 right), the shortcut only from 0.85. */
  route: { hint: 0.7, shortcut: 0.85 },
  /**
   * Model tier on the score 0-2 (misurato, cuts): < 0.3 simple, ≥ 1.3 hard. 1.0 until D-110: with
   * the definition of "Difficile" of 17/10 the 40 labelled cases (30 requests, 10 subtask briefs)
   * have every ordinary job at ≤ 1.24 and every hard one at ≥ 1.44, so 1.3 sits between them
   * (1.0 → 34/40, 1.2 → 39/40, 1.25-1.4 → 40/40). Tuned on those 40 cases: the `decision`
   * events of use `tier` in the log are the real dataset to measure it again.
   */
  tier: { simple: 0.3, hard: 1.3 },
  /** Web needed (misurato 18/20): below 0.2 a free chain gets no web tools this turn. */
  web: { drop: 0.2 },
  /** Rare tools: from 0.5 they are added (in OR with the words of the request). */
  rare: { add: 0.5 },
  /**
   * Drawn blocks (misurato 23/10, 38 hand-labelled requests: Jev 33/38, the words 29/38): from 0.5 the
   * manual of the `ui` blocks joins the turn (in OR with the words). Jev errs toward drawing when
   * it is not needed, a cheap error: a monster that has the manual may still write prose.
   */
  ui: { attach: 0.5 },
  /** Outbound action: ≥ 0.85 it waits for the user, ≥ 0.5 it is marked on the receipt. */
  outbound: { low: 0.5, high: 0.85 },
  /** Injection (misurato 18/20): ≥ 0.85 the block is removed, ≥ 0.5 a warning. */
  injection: { low: 0.5, high: 0.85 },
  /** Memory: a line is dropped only when the engine is sure it is not useful. */
  memory: { drop: 0.15 },
} as const;

/** Where a probability falls between two thresholds. */
export function bandOf(p: number, low: number, high: number): 'high' | 'mid' | 'low' {
  return p >= high ? 'high' : p <= low ? 'low' : 'mid';
}

// --- shuffling ----------------------------------------------------------------------

/** FNV-1a of a text: the seed of the shuffles. */
function hash(seed: string): number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/**
 * The same items in an order fixed by `seed` (the id of the event the decision
 * is about): Jev prefers the first option, and the same case must always get
 * the same order (research 08 §5.0). Same algorithm as the measure.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  let h = hash(seed);
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1597334677) >>> 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** A text cut to `max` characters, on a word when possible. */
export function clipText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.8 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// --- gate (P0, research 08 §5.1) ------------------------------------------------------

const GATE_KIND_LABELS = [
  'publish',
  'contact',
  'spend',
  'delete',
  'goal_change',
  'taste',
  'local',
  'other',
] as const;

/** Kinds of a choice, described (the `kind` question had names only before P0). */
export const gateKinds = (): { label: string; description: string }[] =>
  GATE_KIND_LABELS.map((label) => ({ label, description: questionPrompts().gateKinds[label] }));

export function gateRequest(input: {
  goal: string | null;
  question: string;
  options: readonly string[];
  /** Id of the event the choice belongs to: the order of the options. */
  seed: string;
  /** The model also says what kind of choice it is. */
  classify: boolean;
}): { request: SystemOneRequest; order: string[] } {
  const order = seededShuffle(input.options, `${input.seed}:${input.question}`);
  const q = questionPrompts();
  const questions: SystemOneQuestion[] = [{ id: 'needs_user', type: 'noul', ...q.needsUser }];
  if (order.length >= 2) {
    questions.push(
      { id: 'option', type: 'choice', prompt: q.optionPrompt, options: order },
      {
        id: 'option_rev',
        type: 'choice',
        prompt: q.optionPrompt,
        options: [...order].reverse(),
      },
    );
  }
  if (input.classify) {
    questions.push({
      id: 'kind',
      type: 'choice',
      prompt: q.kindPrompt,
      options: seededShuffle(gateKinds(), input.seed),
    });
  }
  // `recommended` stays in the code: in the state Jev echoed it (37 times out of 37).
  return {
    request: { state: { goal: input.goal, question: input.question, options: order }, questions },
    order,
  };
}

// --- "finito davvero?" (research 08 §5.2) ---------------------------------------------

/** Characters of the sub-agent's report in the state (~1,500 tokens). */
export const DONE_SUMMARY_CHARS = 6_000;

export function constraintQuestion(index: number): SystemOneQuestion {
  return {
    id: `constraint_${index + 1}`,
    type: 'noul',
    ...questionPrompts().constraint(index),
  };
}

export function doneCheckRequest(input: {
  goal: string;
  doneWhen: string;
  constraints: readonly string[];
  summary: string;
  notesCreated: readonly string[];
  notesChanged: readonly string[];
  tools: readonly string[];
}): SystemOneRequest {
  const constraints = input.constraints.slice(0, 10);
  const q = questionPrompts();
  const k = q.keys;
  return {
    state: {
      [k.task]: clipText(input.goal, 1_000),
      [k.doneWhen]: input.doneWhen,
      ...(constraints.length ? { [k.constraints]: constraints } : {}),
      [k.monsterSummary]: clipText(input.summary, DONE_SUMMARY_CHARS),
      [k.notesCreated]: [...input.notesCreated],
      ...(input.notesChanged.length ? { [k.notesChanged]: [...input.notesChanged] } : {}),
      ...(input.tools.length ? { [k.toolsUsed]: [...input.tools] } : {}),
    },
    questions: [
      { id: 'done', type: 'noul', ...q.done },
      ...constraints.map((_, i) => constraintQuestion(i)),
    ],
  };
}

// --- "gira a vuoto?" (research 08 §5.3) -----------------------------------------------

/** The first check at this step of an agent, then every `STUCK_EVERY` steps. */
export const STUCK_FIRST_STEP = 6;
export const STUCK_EVERY = 4;
/** Steps in the state. */
export const STUCK_STEPS = 8;

export function stuckRequest(input: { goal: string; steps: readonly string[] }): SystemOneRequest {
  return {
    state: {
      [questionPrompts().keys.task]: clipText(input.goal, 600),
      [questionPrompts().keys.lastSteps]: input.steps.slice(-STUCK_STEPS),
    },
    questions: [{ id: 'stuck', type: 'noul', ...questionPrompts().stuck }],
  };
}

// --- question left in the text (research 08 §5.6) ------------------------------------

/** The last sentences of a text (at most `n`), for the state. */
export function lastSentences(text: string, n = 3): string {
  const sentences = text
    .replace(/\s+/g, ' ')
    .match(/[^.!?…]+[.!?…]*/gu)
    ?.map((s) => s.trim())
    .filter(Boolean);
  return clipText((sentences ?? [text]).slice(-n).join(' '), 1_200);
}

export function pendingRequest(text: string): SystemOneRequest {
  return {
    state: { [questionPrompts().keys.squadLeadReply]: lastSentences(text) },
    questions: [{ id: 'pending', type: 'noul', ...questionPrompts().pending }],
  };
}

// --- radiografia della richiesta (research 08 §5.4) ------------------------------------

/** Is a route answer "the lead answers alone" / "the squad" (the label of either family)? */
export const isRouteLead = (label: string): boolean => ROUTE_LEADS.includes(label);
export const isRouteTeam = (label: string): boolean => ROUTE_TEAMS.includes(label);

export interface TriageMember {
  /** Option label: the monster's name. */
  name: string;
  /** "Rhea, ricercatrice: cercare sul web…" */
  description: string;
}

export interface TriageQuestions {
  route: boolean;
  tier: boolean;
  web: boolean;
  rare: boolean;
  /** Does the answer read better drawn (D-162)? */
  ui?: boolean;
}

export function triageRequest(input: {
  request: string;
  history: readonly string[];
  members: readonly TriageMember[];
  ask: TriageQuestions;
}): SystemOneRequest {
  const questions: SystemOneQuestion[] = [];
  const q = questionPrompts();
  if (input.ask.route && input.members.length > 0) {
    const options: SystemOneOption[] = [
      { label: q.routeLead, description: q.routeLeadDescription },
      ...input.members.map((m) => ({ label: m.name, description: m.description })),
      ...(input.members.length >= 2
        ? [{ label: q.routeTeam, description: q.routeTeamDescription }]
        : []),
    ];
    // The same choice with the options reversed, in the same call: a disagreement
    // counts as low confidence (Jev prefers the first option).
    questions.push(
      { id: 'route', type: 'choice', prompt: q.routePrompt, options },
      { id: 'route_rev', type: 'choice', prompt: q.routePrompt, options: [...options].reverse() },
    );
  }
  if (input.ask.tier) questions.push({ id: 'tier', type: 'score', min: 0, max: 2, ...q.tier });
  if (input.ask.web) questions.push({ id: 'needs_web', type: 'noul', ...q.web });
  if (input.ask.rare) questions.push({ id: 'rare_tools', type: 'noul', ...q.rare });
  if (input.ask.ui) questions.push({ id: 'needs_ui', type: 'noul', ...q.ui });
  return {
    state: {
      [q.keys.request]: clipText(input.request, 2_000),
      [q.keys.lastMessages]: input.history.slice(-3).map((m) => clipText(m, 300)),
    },
    questions,
  };
}

/** Tier of a turn from the score, with the measured cuts (Jev underestimates difficulty). */
export function tierOf(score: number): 'simple' | 'medium' | 'hard' {
  return score >= BANDS.tier.hard ? 'hard' : score < BANDS.tier.simple ? 'simple' : 'medium';
}

// --- actions that leave the computer (research 07, killer feature 1) ---------------------

const OUTBOUND_KIND_LABELS = ['publish', 'contact', 'spend', 'delete', 'none'] as const;

export const outboundKinds = (): { label: string; description: string }[] =>
  OUTBOUND_KIND_LABELS.map((label) => ({
    label,
    description: questionPrompts().outboundKinds[label],
  }));

export function outboundRequest(input: {
  tool: string;
  description: string;
  args: string;
  seed: string;
}): SystemOneRequest {
  const q = questionPrompts();
  return {
    state: {
      [q.keys.tool]: input.tool,
      [q.keys.toolDescription]: clipText(input.description, 400),
      [q.keys.arguments]: clipText(input.args, 1_200),
    },
    questions: [
      { id: 'outbound', type: 'noul', ...q.outbound },
      {
        id: 'outbound_kind',
        type: 'choice',
        prompt: q.outboundKindPrompt,
        options: seededShuffle(outboundKinds(), input.seed),
      },
    ],
  };
}

// --- injection in external data (research 08 §5.5) -------------------------------------

/** One block per ~1,500 tokens; at most this many blocks per result (the rest is not checked). */
export const INJECTION_BLOCK_CHARS = 6_000;
export const INJECTION_MAX_BLOCKS = 8;

/** The text in blocks, cut on a line or a sentence near the block size. */
export function injectionBlocks(text: string): { blocks: string[]; unchecked: number } {
  const blocks: string[] = [];
  let rest = text;
  while (rest.length > 0 && blocks.length < INJECTION_MAX_BLOCKS) {
    if (rest.length <= INJECTION_BLOCK_CHARS) {
      blocks.push(rest);
      rest = '';
      break;
    }
    const window = rest.slice(0, INJECTION_BLOCK_CHARS);
    const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '));
    const at = cut > INJECTION_BLOCK_CHARS * 0.6 ? cut + 1 : INJECTION_BLOCK_CHARS;
    blocks.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  return { blocks, unchecked: rest.length };
}

export function injectionRequest(input: { source: string; blocks: readonly string[] }): {
  request: SystemOneRequest;
  ids: string[];
} {
  const single = input.blocks.length === 1;
  const q = questionPrompts();
  const field = (i: number) => (single ? q.keys.text : q.keys.textN(i + 1));
  const state: Record<string, unknown> = { [q.keys.source]: clipText(input.source, 200) };
  // Spaces squeezed: the same text costs fewer tokens.
  input.blocks.forEach((b, i) => (state[field(i)] = b.replace(/[ \t]+/g, ' ')));
  const ids = input.blocks.map((_, i) => `injected_${i + 1}`);
  return {
    request: {
      state,
      questions: ids.map((id, i) => ({
        id,
        type: 'noul' as const,
        prompt: q.injection.prompt(field(i)),
        criteria: q.injection.criteria,
      })),
    },
    ids,
  };
}

// --- memory (review §3 point 7) -------------------------------------------------------------

export function memoryRequest(input: { agent: string; role: string; lines: readonly string[] }): {
  request: SystemOneRequest;
  ids: string[];
} {
  const lines = input.lines.slice(0, 10);
  const q = questionPrompts();
  const ids = lines.map((_, i) => `remember_${i + 1}`);
  return {
    request: {
      state: {
        [q.keys.monster]: input.agent,
        [q.keys.role]: clipText(input.role, 200),
        [q.keys.lines]: Object.fromEntries(
          lines.map((l, i) => [q.keys.lineN(i + 1), clipText(l, 300)]),
        ),
      },
      questions: ids.map((id, i) => ({
        id,
        type: 'noul' as const,
        prompt: q.remember.prompt(i + 1),
        criteria: q.remember.criteria,
      })),
    },
    ids,
  };
}
