import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DecisionPort, SystemOneRequest, SystemOneResponse } from '../../src/team/decision.ts';
import type { MonstersTool } from '@monsters/shared';
import { z } from 'zod';
import { resolveDecisionRules } from '../../src/team/decision.ts';
import { endsWithQuestion } from '../../src/team/final-question.ts';
import { classifyOutbound } from '../../src/team/instinct/outbound.ts';
import { claimsNotesWithout, countShortfalls } from '../../src/team/instinct/done-check.ts';
import {
  BANDS,
  doneCheckRequest,
  injectionRequest,
  memoryRequest,
  outboundRequest,
  pendingRequest,
  stuckRequest,
  tierOf,
  triageRequest,
} from '../../src/team/instinct/questions.ts';
import {
  CachingPort,
  loadLabeledCases,
  replayCases,
  summarize,
  type CaseResult,
} from '../decisions/replay.ts';

/*
 * Offline measure of the instinct (D-067), use by use, on the hand-labelled
 * cases of the measure of 15/10/2026 (research 08 §4, `casi.json`) and the new
 * ones of 16/10 (`casi-nuovi.json`). The requests are built by the core's own
 * builders (`instinct/questions.ts`): what is measured is what Monsters sends.
 * The thresholds are the core's (`BANDS`). `run.ts` is the CLI.
 */

const DIR = import.meta.dirname;

/** The team of the measure: option labels and descriptions of the route (cases.mjs). */
export const EVAL_TEAM = [
  {
    name: 'Rhea',
    description:
      'Rhea, ricercatrice: cercare sul web, confrontare fonti, fare una sintesi con le fonti',
  },
  {
    name: 'Dione',
    description:
      'Dione, scrittrice: testi pronti da usare (post, mail, newsletter, riassunti, piani)',
  },
  {
    name: 'Teti',
    description: 'Teti, segreteria: agenda, appuntamenti, promemoria, leggere e ordinare la posta',
  },
  {
    name: 'Proteo',
    description:
      'Proteo, tecnico: file e programmi sul computer, terminale, codice, fogli di calcolo',
  },
];

interface Base {
  id: string;
  set: 'normali' | 'difficili';
}
export interface InstinctCases {
  routing: (Base & { text: string; route: string; tier: 0 | 1 | 2; web: boolean })[];
  /** Briefs of real delegations with the level by hand (D-109): the tier of a subtask. */
  subtasks: { id: string; text: string; tier: 0 | 1 | 2; from: string }[];
  done: (Base & {
    goal: string;
    doneWhen: string;
    summary: string;
    notes: string[];
    expected: boolean;
  })[];
  loop: (Base & { goal: string; steps: string[]; expected: boolean })[];
  injection: (Base & { source: string; text: string; expected: boolean })[];
  finalq: (Base & { text: string; expected: boolean })[];
  outbound: {
    id: string;
    tool: string;
    description: string;
    args: string;
    expected: boolean;
    kind: string;
  }[];
  memory: { id: string; agent: string; role: string; line: string; expected: boolean }[];
}

export function loadInstinctCases(): InstinctCases {
  const measured = JSON.parse(readFileSync(join(DIR, 'casi.json'), 'utf8')) as InstinctCases;
  const fresh = JSON.parse(readFileSync(join(DIR, 'casi-nuovi.json'), 'utf8')) as Pick<
    InstinctCases,
    'outbound' | 'memory'
  > & {
    finalq?: InstinctCases['finalq'];
    routing?: InstinctCases['routing'];
    subtasks?: InstinctCases['subtasks'];
  };
  return {
    ...measured,
    // 20 requests of 15/10 and 10 of 17/10: the 30 of the tier measure (D-093).
    routing: [...measured.routing, ...(fresh.routing ?? [])],
    finalq: [...measured.finalq, ...(fresh.finalq ?? [])],
    outbound: fresh.outbound,
    memory: fresh.memory,
    subtasks: fresh.subtasks ?? [],
  };
}

/** AUC of scores for positives against negatives (higher = positive). */
export function auc(pos: readonly number[], neg: readonly number[]): number | null {
  if (pos.length === 0 || neg.length === 0) return null;
  let w = 0;
  for (const p of pos) for (const n of neg) w += p > n ? 1 : p === n ? 0.5 : 0;
  return w / (pos.length * neg.length);
}

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : null;
};
const p95 = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]! : null;
};

/** A port that records cost, tokens and latency, and refuses past a spending cap. */
export class MeteredPort implements DecisionPort {
  readonly id: string;
  readonly #inner: DecisionPort;
  readonly #capUsd: number;
  calls = 0;
  inputTokens = 0;
  costUsd = 0;
  readonly latencies: number[] = [];

  constructor(inner: DecisionPort, capUsd: number) {
    this.#inner = inner;
    this.id = inner.id;
    this.#capUsd = capUsd;
  }

  async decide(request: SystemOneRequest, signal?: AbortSignal): Promise<SystemOneResponse> {
    if (this.costUsd >= this.#capUsd)
      throw new Error(`tetto di spesa raggiunto (${this.#capUsd} $)`);
    const started = performance.now();
    const res = await this.#inner.decide(request, signal);
    this.latencies.push(performance.now() - started);
    this.calls++;
    for (const u of res.usage ?? []) {
      this.inputTokens += u.inputTokens ?? 0;
      this.costUsd += u.costUsd ?? 0;
    }
    return res;
  }
}

const num = (res: SystemOneResponse, id: string) => {
  const v = res.answers.find((a) => a.id === id)?.value;
  return typeof v === 'number' ? v : NaN;
};
const choice = (res: SystemOneResponse, id: string) => {
  const a = res.answers.find((x) => x.id === id);
  return a && typeof a.value === 'string'
    ? { value: a.value, confidence: a.confidence }
    : undefined;
};

export interface NoulRow {
  id: string;
  set: string;
  p: number;
  expected: boolean;
}

/** Accuracy at 0.5, AUC, and how the two bands of the use split the cases. */
export function noulStats(rows: readonly NoulRow[], bands: { low: number; high: number }) {
  const ok = (r: NoulRow) => r.p >= 0.5 === r.expected;
  const by = (set: string) => rows.filter((r) => r.set === set);
  const high = rows.filter((r) => r.p >= bands.high);
  const low = rows.filter((r) => r.p <= bands.low);
  const mid = rows.filter((r) => r.p > bands.low && r.p < bands.high);
  return {
    n: rows.length,
    at05: rows.filter(ok).length,
    normali: `${by('normali').filter(ok).length}/${by('normali').length}`,
    difficili: `${by('difficili').filter(ok).length}/${by('difficili').length}`,
    auc: auc(
      rows.filter((r) => r.expected).map((r) => r.p),
      rows.filter((r) => !r.expected).map((r) => r.p),
    ),
    /** Above the high band: right when expected yes. */
    high: `${high.filter((r) => r.expected).length}/${high.length}`,
    /** Below the low band: right when expected no. */
    low: `${low.filter((r) => !r.expected).length}/${low.length}`,
    mid: mid.length,
    errors: rows.filter((r) => !ok(r)).map((r) => `${r.id}:${r.p.toFixed(2)}`),
  };
}

export interface InstinctReport {
  gate: ReturnType<typeof gateStats>;
  routing: ReturnType<typeof routingStats>;
  done: ReturnType<typeof noulStats> & { verdicts: Record<string, string> };
  loop: ReturnType<typeof noulStats>;
  injection: ReturnType<typeof noulStats> & { externalOnly: ReturnType<typeof noulStats> };
  finalq: ReturnType<typeof noulStats> & { regexAlone: string; combined: string };
  outbound: ReturnType<typeof noulStats> & { kind: string; core: OutboundCoreStats };
  memory: ReturnType<typeof noulStats> & { dropped: string };
  cost: {
    calls: number;
    inputTokens: number;
    costUsd: number;
    p50Ms: number | null;
    p95Ms: number | null;
  };
  rows: Record<string, unknown[]>;
}

function gateStats(gateRun: CaseResult[], portRun: CaseResult[]) {
  const s = summarize(gateRun);
  const gray = gateRun.filter((r) => r.modelAsked);
  const pOf = new Map(portRun.map((r) => [r.id, r.pYes]));
  const grayPos = gray.filter((r) => r.expected === 'ask').map((r) => pOf.get(r.id) ?? NaN);
  const grayNeg = gray.filter((r) => r.expected === 'proceed').map((r) => pOf.get(r.id) ?? NaN);
  const allPos = portRun.filter((r) => r.expected === 'ask').map((r) => r.pYes ?? NaN);
  const allNeg = portRun.filter((r) => r.expected === 'proceed').map((r) => r.pYes ?? NaN);
  return {
    cases: s.cases,
    correct: `${s.expected.correct}/${s.expected.n}`,
    wrongProceed: s.expected.wrongProceed,
    needlessAsk: s.expected.needlessAsk,
    gray: gray.length,
    modelProceeded: gray.filter((r) => r.outcome === 'proceed').length,
    aucAll: auc(allPos, allNeg),
    aucGray: auc(grayPos, grayNeg),
    grayAsk: grayPos.map((p) => +p.toFixed(2)).sort(),
    grayProceed: grayNeg.map((p) => +p.toFixed(2)).sort(),
    optionMatchesUser: `${s.userChoice.optionAgree}/${s.userChoice.optionN}`,
    failures: s.failures,
  };
}

function routingStats(
  rows: {
    id: string;
    set: string;
    route: string;
    expected: string;
    conf: number;
    stable: boolean;
    tier: number;
    tierExpected: number;
    web: number;
    webExpected: boolean;
  }[],
) {
  const ok = (r: (typeof rows)[number]) => r.route === r.expected;
  const by = (set: string) => rows.filter((r) => r.set === set);
  const sure = rows.filter((r) => r.conf >= BANDS.route.hint && r.stable);
  const shortcut = rows.filter(
    (r) => r.conf >= BANDS.route.shortcut && r.stable && !['capo', 'squadra'].includes(r.route),
  );
  const level = (score: number) => ({ simple: 0, medium: 1, hard: 2 })[tierOf(score)];
  return {
    route: `${rows.filter(ok).length}/${rows.length}`,
    normali: `${by('normali').filter(ok).length}/${by('normali').length}`,
    difficili: `${by('difficili').filter(ok).length}/${by('difficili').length}`,
    /** What the hint uses: confidence ≥ 0.7 and the same answer in both orders. */
    hint: `${sure.filter(ok).length}/${sure.length}`,
    /** What the shortcut (shadow) would take: one monster, ≥ 0.85, stable. */
    shortcut: `${shortcut.filter(ok).length}/${shortcut.length}`,
    stable: `${rows.filter((r) => r.stable).length}/${rows.length}`,
    tier: `${rows.filter((r) => level(r.tier) === r.tierExpected).length}/${rows.length}`,
    web: `${rows.filter((r) => r.web >= 0.5 === r.webExpected).length}/${rows.length}`,
    /** The web tools taken away (p < 0.2) when the request needed them: the costly error. */
    webDroppedWrongly: rows.filter((r) => r.web < BANDS.web.drop && r.webExpected).map((r) => r.id),
    errors: rows
      .filter((r) => !ok(r))
      .map((r) => `${r.id}:${r.route}(${r.conf.toFixed(2)})≠${r.expected}`),
  };
}

/** Agreement of the tier with the labels (D-093): what "Automatica" acts on. */
export interface TierReport {
  n: number;
  /** Same level as the label. */
  agree: number;
  agreement: number;
  /** Rows: label, columns: what Jev said (0 simple, 1 medium, 2 hard). */
  confusion: number[][];
  /** Hard requests sent to the light model: the costly error (quality). */
  hardAsSimple: string[];
  /** Simple ones sent to the strong model: the cheap error (quota). */
  simpleAsHard: string[];
  errors: string[];
  cost: InstinctReport['cost'];
  rows: { id: string; score: number; level: number; expected: number }[];
}

/**
 * The tier alone, on the 30 labelled requests, with the same request the core
 * sends to an orchestrator on a plan (route and tier, no web: the chain is not
 * free). One call each, ~0,00002 $. With `subtask`, the request the core sends
 * for a delegation (D-109): the brief alone, the tier alone.
 */
export async function measureTier(
  cases: readonly { id: string; text: string; tier: 0 | 1 | 2 }[],
  port: MeteredPort,
  opts: { subtask?: boolean } = {},
): Promise<TierReport> {
  const level = (score: number) => ({ simple: 0, medium: 1, hard: 2 })[tierOf(score)];
  const rows: TierReport['rows'] = [];
  for (const c of cases) {
    const res = await port.decide(
      triageRequest({
        request: c.text,
        history: [],
        members: opts.subtask ? [] : EVAL_TEAM,
        ask: { route: !opts.subtask, tier: true, web: false, rare: false },
      }),
    );
    const score = num(res, 'tier');
    rows.push({ id: c.id, score, level: level(score), expected: c.tier });
  }
  const confusion = [0, 1, 2].map((e) =>
    [0, 1, 2].map((l) => rows.filter((r) => r.expected === e && r.level === l).length),
  );
  const agree = rows.filter((r) => r.level === r.expected).length;
  return {
    n: rows.length,
    agree,
    agreement: rows.length ? agree / rows.length : 0,
    confusion,
    hardAsSimple: rows.filter((r) => r.expected === 2 && r.level === 0).map((r) => r.id),
    simpleAsHard: rows.filter((r) => r.expected === 0 && r.level === 2).map((r) => r.id),
    errors: rows
      .filter((r) => r.level !== r.expected)
      .map((r) => `${r.id}:${r.score.toFixed(2)}→${r.level}≠${r.expected}`),
    cost: {
      calls: port.calls,
      inputTokens: port.inputTokens,
      costUsd: port.costUsd,
      p50Ms: median(port.latencies),
      p95Ms: p95(port.latencies),
    },
    rows,
  };
}

/** The categories "Chiedi sempre" by default: a certain action of these waits for the card. */
const ASK_KINDS = new Set(
  resolveDecisionRules([])
    .filter((r) => r.effect === 'ask')
    .flatMap((r) => r.kinds as string[]),
);

/** A tool as the brake sees it in the measure (MCP of a gallery or reached through Claude). */
function caseTool(name: string, description: string): MonstersTool {
  return {
    name,
    description,
    inputSchema: z.object({}).passthrough(),
    execute: () => Promise.resolve(null),
  };
}

function caseInput(tool: string, args: string): unknown {
  if (tool === 'shell') return { command: args };
  if (tool === 'web_fetch') return { url: args };
  try {
    return JSON.parse(args) as unknown;
  } catch {
    return args;
  }
}

/** What the core does with an action: rules first, then the instinct on the candidates (guard.ts). */
export type OutboundOutcome = 'scheda' | 'segno' | 'passa';

export interface OutboundCoreStats {
  /** Expected yes: a card / a mark only / nothing. */
  cards: string;
  marked: number;
  missed: string[];
  /** Expected no: passed (a mark counts as passed) / a card for nothing. */
  passed: string;
  needlessCards: string[];
  /** How many cases the rules decided without asking the instinct. */
  byRules: number;
}

/** Every use on its cases, one call per case (the same request the core would send). */
export async function measureInstinct(
  cases: InstinctCases,
  port: MeteredPort,
  options: { onProgress?: (use: string) => void } = {},
): Promise<InstinctReport> {
  const rows: Record<string, unknown[]> = {};
  const progress = options.onProgress ?? (() => {});

  // Gate (P0): the labelled set of eval:decisions, rules first then the engine.
  progress('gate');
  const labelled = loadLabeledCases();
  const cache = new CachingPort(port);
  const portRun = await replayCases(labelled, cache, { mode: 'port' });
  const gateRun = await replayCases(labelled, cache, { mode: 'gate' });
  rows['gate'] = gateRun;

  progress('routing');
  const routing = [];
  for (const c of cases.routing) {
    const res = await port.decide(
      triageRequest({
        request: c.text,
        history: [],
        members: EVAL_TEAM,
        ask: { route: true, tier: true, web: true, rare: false },
      }),
    );
    const route = choice(res, 'route')!;
    const reversed = choice(res, 'route_rev')!;
    routing.push({
      id: c.id,
      set: c.set,
      route: route.value,
      expected: c.route,
      conf: route.confidence,
      stable: route.value === reversed.value,
      tier: num(res, 'tier'),
      tierExpected: c.tier,
      web: num(res, 'needs_web'),
      webExpected: c.web,
    });
  }
  rows['routing'] = routing;

  progress('done');
  const done: (NoulRow & { verdict: string })[] = [];
  for (const c of cases.done) {
    const res = await port.decide(
      doneCheckRequest({
        goal: c.goal,
        doneWhen: c.doneWhen,
        constraints: [],
        summary: c.summary,
        notesCreated: c.notes,
        notesChanged: [],
        tools: [],
      }),
    );
    const p = num(res, 'done');
    // What the core does: the code checks first, then the two bands.
    const code =
      claimsNotesWithout(c.summary, { created: c.notes, changed: [] }) ||
      countShortfalls(c.doneWhen, c.summary, c.goal).length > 0;
    const verdict =
      code || p < BANDS.done.low ? 'promemoria' : p < BANDS.done.high ? 'dubbio' : 'ok';
    done.push({ id: c.id, set: c.set, p, expected: c.expected, verdict });
  }
  rows['done'] = done;

  progress('loop');
  const loop: NoulRow[] = [];
  for (const c of cases.loop) {
    const res = await port.decide(stuckRequest({ goal: c.goal, steps: c.steps }));
    loop.push({ id: c.id, set: c.set, p: num(res, 'stuck'), expected: c.expected });
  }
  rows['loop'] = loop;

  progress('injection');
  const injection: (NoulRow & { source: string })[] = [];
  for (const c of cases.injection) {
    const { request, ids } = injectionRequest({ source: c.source, blocks: [c.text] });
    const res = await port.decide(request);
    injection.push({
      id: c.id,
      set: c.set,
      p: num(res, ids[0]!),
      expected: c.expected,
      source: c.source,
    });
  }
  rows['injection'] = injection;

  progress('finalq');
  const finalq: (NoulRow & { regex: boolean })[] = [];
  for (const c of cases.finalq) {
    const res = await port.decide(pendingRequest(c.text));
    finalq.push({
      id: c.id,
      set: c.set,
      p: num(res, 'pending'),
      expected: c.expected,
      regex: endsWithQuestion(c.text),
    });
  }
  rows['finalq'] = finalq;

  progress('outbound');
  const outbound: (NoulRow & {
    kind: string;
    kindExpected: string;
    rule: string;
    outcome: OutboundOutcome;
  })[] = [];
  for (const c of cases.outbound) {
    // Jev on every case (the classifier alone), then what the core does: the rules first.
    const res = await port.decide(
      outboundRequest({ tool: c.tool, description: c.description, args: c.args, seed: c.id }),
    );
    const p = num(res, 'outbound');
    const kind = choice(res, 'outbound_kind')?.value ?? '';
    const found = classifyOutbound(caseTool(c.tool, c.description), caseInput(c.tool, c.args));
    let outcome: OutboundOutcome;
    let rule: string;
    if (!found) {
      outcome = 'passa';
      rule = 'nessuna uscita';
    } else if (found.markOnly) {
      outcome = 'segno';
      rule = 'solo segno';
    } else if (found.certain) {
      outcome = found.category && ASK_KINDS.has(found.category) ? 'scheda' : 'segno';
      rule = `certa: ${found.category}`;
    } else {
      rule = 'candidata';
      const category = found.category ?? (kind && kind !== 'none' ? kind : undefined);
      const band = p >= BANDS.outbound.high ? 'high' : p <= BANDS.outbound.low ? 'low' : 'mid';
      outcome =
        band === 'high' && category
          ? 'scheda'
          : band === 'low' && !found.markAlways
            ? 'passa'
            : 'segno';
    }
    outbound.push({
      id: c.id,
      set: 'nuovi',
      p,
      expected: c.expected,
      kind,
      kindExpected: c.kind,
      rule,
      outcome,
    });
  }
  rows['outbound'] = outbound;

  progress('memory');
  const memory: NoulRow[] = [];
  const byAgent = Object.groupBy(cases.memory, (m) => `${m.agent}|${m.role}`);
  for (const group of Object.values(byAgent)) {
    if (!group?.length) continue;
    const { request, ids } = memoryRequest({
      agent: group[0]!.agent,
      role: group[0]!.role,
      lines: group.map((m) => m.line),
    });
    const res = await port.decide(request);
    group.forEach((m, i) =>
      memory.push({ id: m.id, set: 'nuovi', p: num(res, ids[i]!), expected: m.expected }),
    );
  }
  rows['memory'] = memory;

  const verdicts = Object.fromEntries(
    ['ok', 'dubbio', 'promemoria'].map((v) => {
      const these = done.filter((d) => d.verdict === v);
      const right = these.filter((d) =>
        v === 'ok' ? d.expected : v === 'promemoria' ? !d.expected : true,
      );
      return [v, `${right.length}/${these.length}`];
    }),
  );
  const combined = finalq.filter(
    (r) =>
      ((r.regex && r.p >= BANDS.finalQuestion.low) || r.p >= BANDS.finalQuestion.high) ===
      r.expected,
  );
  const dropped = memory.filter((m) => m.p <= BANDS.memory.drop);
  return {
    gate: gateStats(gateRun, portRun),
    routing: routingStats(routing),
    done: { ...noulStats(done, BANDS.done), verdicts },
    loop: noulStats(loop, BANDS.stuck),
    injection: {
      ...noulStats(injection, BANDS.injection),
      externalOnly: noulStats(
        injection.filter((r) => !/nota del vault/i.test(r.source)),
        BANDS.injection,
      ),
    },
    finalq: {
      ...noulStats(finalq, BANDS.finalQuestion),
      regexAlone: `${finalq.filter((r) => r.regex === r.expected).length}/${finalq.length}`,
      combined: `${combined.length}/${finalq.length}`,
    },
    outbound: {
      ...noulStats(outbound, BANDS.outbound),
      kind: `${outbound.filter((o) => o.expected && o.kind === o.kindExpected).length}/${outbound.filter((o) => o.expected).length}`,
      core: outboundCore(outbound),
    },
    memory: {
      ...noulStats(memory, { low: BANDS.memory.drop, high: 0.85 }),
      dropped: `${dropped.filter((m) => !m.expected).length}/${dropped.length}`,
    },
    cost: {
      calls: port.calls,
      inputTokens: port.inputTokens,
      costUsd: port.costUsd,
      p50Ms: median(port.latencies),
      p95Ms: p95(port.latencies),
    },
    rows,
  };
}

function outboundCore(
  rows: readonly { id: string; expected: boolean; rule: string; outcome: OutboundOutcome }[],
): OutboundCoreStats {
  const yes = rows.filter((r) => r.expected);
  const no = rows.filter((r) => !r.expected);
  return {
    cards: `${yes.filter((r) => r.outcome === 'scheda').length}/${yes.length}`,
    marked: yes.filter((r) => r.outcome === 'segno').length,
    missed: yes.filter((r) => r.outcome === 'passa').map((r) => r.id),
    passed: `${no.filter((r) => r.outcome !== 'scheda').length}/${no.length}`,
    needlessCards: no.filter((r) => r.outcome === 'scheda').map((r) => r.id),
    byRules: rows.filter((r) => r.rule !== 'candidata').length,
  };
}
