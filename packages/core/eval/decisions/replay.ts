import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  ActionKindSchema,
  DecisionGate,
  DEFAULT_DECISION_RULES,
  type DecisionPort,
  type GateDecision,
  type SystemOneRequest,
  type SystemOneResponse,
} from '../../src/team/decision.ts';

/*
 * Offline measure of a System 1 backend (M2.9, D-037): the decisions recorded
 * in the log (`user_choice` events are the user's truth) or a hand-labelled
 * set are replayed through the DecisionGate with a given `DecisionPort`, in
 * two modes:
 * - `gate`: the default rules first, the port only for the gray zone (what
 *   Monsters does);
 * - `port`: no rules, every choice goes to the port (the model alone).
 * Both modes send the port the same request for the same case, so a cache
 * means the second mode makes no new calls. Not part of CI: `run.ts` is the CLI.
 */

export const DecisionCaseSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['labeled', 'log', 'file']).default('file'),
  agent: z.string().default('titan'),
  question: z.string().min(1),
  options: z.array(z.string().min(1)),
  recommended: z.string().optional(),
  kind: ActionKindSchema.optional(),
  /** What the agent was working on. */
  context: z.string().optional(),
  /** What should have happened: ask the user, or go on alone. */
  expected: z.enum(['ask', 'proceed']).optional(),
  /** The option the user chose (log: `user_choice`). */
  userChoice: z.string().optional(),
  note: z.string().optional(),
});
export type DecisionCase = z.infer<typeof DecisionCaseSchema>;
export type DecisionCaseInput = z.input<typeof DecisionCaseSchema>;

const LABELED_FILE = join(import.meta.dirname, 'etichettate.json');

/** The hand-labelled set (`etichettate.json`). */
export function loadLabeledCases(path = LABELED_FILE): DecisionCase[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { cases: unknown[] };
  return raw.cases.map((c) => DecisionCaseSchema.parse({ source: 'labeled', ...(c as object) }));
}

interface RawEvent {
  id: string;
  ts?: number;
  agent?: string;
  runId?: string | null;
  parentId?: string | null;
  type: string;
  data: Record<string, unknown>;
}

/**
 * Cases from log events: every `user_choice` among 2+ options, with the
 * question's recommended option and the run goal. When the user chose
 * something other than the recommended option, asking was needed
 * (`expected: ask`); otherwise there is no label for ask/proceed.
 */
export function casesFromEvents(events: readonly RawEvent[], prefix = 'log'): DecisionCase[] {
  const questions = new Map<string, RawEvent>();
  const answers = new Map<string, RawEvent>();
  const goals = new Map<string, string>();
  for (const e of events) {
    if (e.type === 'question' && typeof e.data['questionId'] === 'string') {
      questions.set(e.data['questionId'], e);
    } else if (e.type === 'answer') {
      answers.set(e.id, e);
    } else if (e.type === 'run' && e.runId && typeof e.data['goal'] === 'string') {
      if (!goals.has(e.runId)) goals.set(e.runId, e.data['goal']);
    }
  }
  const cases: DecisionCase[] = [];
  for (const e of events) {
    if (e.type !== 'decision' || e.data['kind'] !== 'user_choice') continue;
    const options = e.data['options'];
    const choice = e.data['choice'];
    if (!Array.isArray(options) || options.length < 2 || typeof choice !== 'string') continue;
    if (!options.includes(choice)) continue; // free text: nothing to compare with
    const answer = e.parentId ? answers.get(e.parentId) : undefined;
    const qid = answer?.data['questionId'];
    const question = typeof qid === 'string' ? questions.get(qid) : undefined;
    const qOptions = (question?.data['options'] ?? []) as { id: string; label: string }[];
    const recId = question?.data['recommended'];
    const recommended = qOptions.find((o) => o.id === recId)?.label;
    const runId = e.runId ?? question?.runId ?? null;
    const context = runId ? goals.get(runId) : undefined;
    cases.push(
      DecisionCaseSchema.parse({
        id: `${prefix}:${typeof qid === 'string' ? qid : e.id}`,
        source: 'log',
        agent: question?.agent ?? 'titan',
        question: typeof e.data['question'] === 'string' ? e.data['question'] : '',
        options: options as string[],
        ...(recommended !== undefined ? { recommended } : {}),
        ...(context ? { context } : {}),
        ...(recommended !== undefined && recommended !== choice ? { expected: 'ask' } : {}),
        userChoice: choice,
      }),
    );
  }
  return cases;
}

/** Cases from the log of a `MONSTERS_HOME` (read-only: works while the core runs). */
export function loadCasesFromHome(home: string): DecisionCase[] {
  const path = join(resolve(home), 'monsters.db');
  if (!existsSync(path)) throw new Error(`no monsters.db in ${home}`);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, ts, agent, run_id, parent_id, type, data FROM events
         WHERE type IN ('question', 'answer', 'decision', 'run') ORDER BY id`,
      )
      .all() as {
      id: string;
      ts: number;
      agent: string;
      run_id: string | null;
      parent_id: string | null;
      type: string;
      data: string;
    }[];
    const events = rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      agent: r.agent,
      runId: r.run_id,
      parentId: r.parent_id,
      type: r.type,
      data: JSON.parse(r.data) as Record<string, unknown>,
    }));
    return casesFromEvents(events, basename(resolve(home)));
  } finally {
    db.close();
  }
}

/** A JSON file: a list of cases, `{ cases: [...] }`, or a list of log events. */
export function loadCasesFromFile(path: string): DecisionCase[] {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { cases?: unknown }).cases)
      ? (raw as { cases: unknown[] }).cases
      : null;
  if (!list) throw new Error(`${path}: expected a list of cases or of log events`);
  const looksLikeEvents = list.every(
    (x) => x && typeof x === 'object' && 'type' in x && 'data' in x,
  );
  if (looksLikeEvents && list.length > 0) {
    return casesFromEvents(list as RawEvent[], basename(path));
  }
  return list.map((c) => DecisionCaseSchema.parse({ source: 'file', ...(c as object) }));
}

// --- replay --------------------------------------------------------------------

type Usage = NonNullable<SystemOneResponse['usage']>[number];

/**
 * Remembers each answer by request, so the second mode makes no new calls. A
 * cached answer keeps its usage: each mode reports what it would spend.
 */
export class CachingPort implements DecisionPort {
  readonly id: string;
  readonly #inner: DecisionPort;
  readonly #cache = new Map<string, Promise<SystemOneResponse>>();
  /** Calls that reached the inner port. */
  calls = 0;
  last: { response?: SystemOneResponse; error?: string; cached: boolean } | null = null;

  constructor(inner: DecisionPort) {
    this.#inner = inner;
    this.id = inner.id;
  }

  async decide(request: SystemOneRequest, signal?: AbortSignal): Promise<SystemOneResponse> {
    const key = JSON.stringify(request);
    let pending = this.#cache.get(key);
    const cached = pending !== undefined;
    if (!pending) {
      this.calls++;
      pending = this.#inner.decide(request, signal);
      this.#cache.set(key, pending);
    }
    try {
      const response = await pending;
      this.last = { response, cached };
      return response;
    } catch (err) {
      this.last = { error: (err as Error).message, cached };
      if (cached) throw new Error((err as Error).message, { cause: err });
      throw err;
    }
  }
}

/**
 * The answers an earlier run got from a port (`eval/results/decisions-*.json`,
 * `port` mode, where every case reached the model), replayed without calls: the
 * gate can be scored again after a change of the rules (`--rescore`). A case
 * the recording does not have, or a question it did not ask (`kind`), fails, and
 * the gate asks, as with a port that does not answer.
 */
export class RecordedPort implements DecisionPort {
  readonly id: string;
  readonly #byQuestion = new Map<string, CaseResult>();

  constructor(results: readonly CaseResult[], id = 'recorded') {
    this.id = id;
    const labeled = new Map(loadLabeledCases().map((c) => [c.id, c.question]));
    for (const r of results) {
      const question = labeled.get(r.id);
      if (question && r.pYes !== undefined) this.#byQuestion.set(question, r);
    }
  }

  /** Port-mode results of `engine` in a results file of `run.ts`. */
  static fromFile(path: string, engine = 'jev'): RecordedPort {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      reports?: { engine: string; mode: string; results: CaseResult[] }[];
    };
    const report = raw.reports?.find((r) => r.engine === engine && r.mode === 'port');
    if (!report) throw new Error(`${path}: no "port" results of ${engine}`);
    return new RecordedPort(report.results, `${engine} (registrato)`);
  }

  decide(request: SystemOneRequest): Promise<SystemOneResponse> {
    const state = request.state as { question?: string };
    const hit = state.question ? this.#byQuestion.get(state.question) : undefined;
    if (!hit) return Promise.reject(new Error('not in the recording'));
    const answers: SystemOneResponse['answers'] = [];
    for (const q of request.questions) {
      if (q.type === 'noul' && hit.pYes !== undefined) {
        answers.push({ id: q.id, value: hit.pYes, confidence: Math.abs(2 * hit.pYes - 1) });
      } else if (q.type === 'choice' && q.id === 'option' && hit.option) {
        answers.push({ id: q.id, value: hit.option.value, confidence: hit.option.confidence });
      } else {
        return Promise.reject(new Error(`question ${q.id} not in the recording`));
      }
    }
    return Promise.resolve({ answers, usage: hit.usage });
  }
}

export interface CaseResult {
  id: string;
  source: DecisionCase['source'];
  outcome: GateDecision['outcome'];
  choice?: string;
  decidedBy: GateDecision['decidedBy'];
  rule?: string;
  confidence?: number;
  reason: string;
  /** The port was asked. */
  modelAsked: boolean;
  /** The port failed (error, timeout, invalid answer). */
  failed: boolean;
  /** Probability that the user is needed, from the port. */
  pYes?: number;
  option?: { value: string; confidence: number };
  expected?: DecisionCase['expected'];
  userChoice?: string;
  usage: Usage[];
}

export type ReplayMode = 'gate' | 'port';

/** Replays the cases one at a time through a gate with (`gate`) or without (`port`) the rules. */
export async function replayCases(
  cases: readonly DecisionCase[],
  port: CachingPort,
  options: { mode: ReplayMode; threshold?: number; onCase?: (r: CaseResult) => void },
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const usage: Usage[] = [];
    const gate = new DecisionGate({
      log: {
        append: ((e: { type: string; data: unknown }) => {
          if (e.type === 'provider_usage') usage.push(e.data as Usage);
          return e;
        }) as never,
      },
      rules: options.mode === 'gate' ? DEFAULT_DECISION_RULES : [],
      port,
      ...(options.threshold !== undefined ? { threshold: options.threshold } : {}),
    });
    port.last = null;
    const d = await gate.decide({
      agent: c.agent,
      // The seed of the shuffled options (D-067): the case, like an event in the core.
      parentId: c.id,
      question: c.question,
      options: c.options,
      recommended: c.recommended,
      kind: c.kind,
      context: c.context,
    });
    const last = port.last as CachingPort['last'];
    const answers = new Map((last?.response?.answers ?? []).map((a) => [a.id, a]));
    const needs = answers.get('needs_user');
    const option = answers.get('option');
    const result: CaseResult = {
      id: c.id,
      source: c.source,
      outcome: d.outcome,
      ...(d.choice !== undefined ? { choice: d.choice } : {}),
      decidedBy: d.decidedBy,
      ...(d.rule ? { rule: d.rule } : {}),
      ...(d.confidence !== undefined ? { confidence: d.confidence } : {}),
      reason: d.reason,
      modelAsked: last !== null,
      failed: last?.error !== undefined,
      ...(typeof needs?.value === 'number' ? { pYes: needs.value } : {}),
      ...(option && typeof option.value === 'string'
        ? { option: { value: option.value, confidence: option.confidence } }
        : {}),
      ...(c.expected ? { expected: c.expected } : {}),
      ...(c.userChoice !== undefined ? { userChoice: c.userChoice } : {}),
      usage,
    };
    results.push(result);
    options.onCase?.(result);
  }
  return results;
}

// --- metrics -------------------------------------------------------------------

export interface Calibration {
  n: number;
  /** Mean squared error of the probabilities (0 perfect, 0.25 = always 0.5). */
  brier: number | null;
  /** Expected calibration error over 5 equal bins. */
  ece: number | null;
}

/** Brier and ECE of predicted probabilities against 0/1 outcomes. */
export function calibration(pairs: readonly { p: number; y: 0 | 1 }[], bins = 5): Calibration {
  if (pairs.length === 0) return { n: 0, brier: null, ece: null };
  const brier = pairs.reduce((s, { p, y }) => s + (p - y) ** 2, 0) / pairs.length;
  let ece = 0;
  for (let b = 0; b < bins; b++) {
    const inBin = pairs.filter(({ p }) =>
      b === bins - 1 ? p >= b / bins : p >= b / bins && p < (b + 1) / bins,
    );
    if (inBin.length === 0) continue;
    const meanP = inBin.reduce((s, x) => s + x.p, 0) / inBin.length;
    const meanY = inBin.reduce((s, x) => s + x.y, 0) / inBin.length;
    ece += (inBin.length / pairs.length) * Math.abs(meanP - meanY);
  }
  return { n: pairs.length, brier, ece };
}

function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

export interface ReplayReport {
  cases: number;
  asked: number;
  proceeded: number;
  /** Cases that reached the port, and how many of them failed. */
  modelAsked: number;
  failures: number;
  /** Against `expected` (hand labels, or "the user changed the recommended option"). */
  expected: {
    n: number;
    correct: number;
    accuracy: number | null;
    /** Went on alone when the user had to be asked: the costly mistake. */
    wrongProceed: number;
    /** Asked when it could go on: a question too many. */
    needlessAsk: number;
  };
  /** Against the option the user chose. */
  userChoice: {
    n: number;
    /** The gate went on with the user's option. */
    proceededRight: number;
    /** The gate went on with another option. */
    proceededWrong: number;
    /** The port's `option` answer matches the user's (when asked). */
    optionAgree: number;
    optionN: number;
  };
  calibration: {
    /** `needs_user` (probability of yes) against `expected === 'ask'`. */
    needsUser: Calibration;
    /** Confidence of the `option` answer against "it is the user's option". */
    option: Calibration;
  };
  cost: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  latencyMs: { p50: number | null; p95: number | null; mean: number | null };
}

export function summarize(results: readonly CaseResult[]): ReplayReport {
  const withExpected = results.filter((r) => r.expected !== undefined);
  const correct = withExpected.filter((r) => r.outcome === r.expected).length;
  const withChoice = results.filter((r) => r.userChoice !== undefined);
  const withOption = withChoice.filter((r) => r.option !== undefined);
  const usage = results.flatMap((r) => r.usage);
  const durations = usage
    .map((u) => u.durationMs)
    .filter((d): d is number => d !== undefined)
    .sort((a, b) => a - b);
  return {
    cases: results.length,
    asked: results.filter((r) => r.outcome === 'ask').length,
    proceeded: results.filter((r) => r.outcome === 'proceed').length,
    modelAsked: results.filter((r) => r.modelAsked).length,
    failures: results.filter((r) => r.failed).length,
    expected: {
      n: withExpected.length,
      correct,
      accuracy: withExpected.length ? correct / withExpected.length : null,
      wrongProceed: withExpected.filter((r) => r.expected === 'ask' && r.outcome === 'proceed')
        .length,
      needlessAsk: withExpected.filter((r) => r.expected === 'proceed' && r.outcome === 'ask')
        .length,
    },
    userChoice: {
      n: withChoice.length,
      proceededRight: withChoice.filter((r) => r.outcome === 'proceed' && r.choice === r.userChoice)
        .length,
      proceededWrong: withChoice.filter((r) => r.outcome === 'proceed' && r.choice !== r.userChoice)
        .length,
      optionAgree: withOption.filter((r) => r.option!.value === r.userChoice).length,
      optionN: withOption.length,
    },
    calibration: {
      needsUser: calibration(
        withExpected
          .filter((r) => r.pYes !== undefined)
          .map((r) => ({ p: r.pYes!, y: r.expected === 'ask' ? 1 : 0 })),
      ),
      option: calibration(
        withOption.map((r) => ({
          p: r.option!.confidence,
          y: r.option!.value === r.userChoice ? 1 : 0,
        })),
      ),
    },
    cost: {
      calls: usage.length,
      inputTokens: usage.reduce((s, u) => s + (u.inputTokens ?? 0), 0),
      outputTokens: usage.reduce((s, u) => s + (u.outputTokens ?? 0), 0),
      costUsd: usage.reduce((s, u) => s + (u.costUsd ?? 0), 0),
    },
    latencyMs: {
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      mean: durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : null,
    },
  };
}
