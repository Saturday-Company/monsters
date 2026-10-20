import type { DelegationVerdict, ReceiptCriterion } from '@monsters/shared';
import { withUnicodeBoundaries, wordRegex } from '../word-boundary.ts';
import { BANDS, bandOf, doneCheckRequest } from './questions.ts';
import { pOf, type System1 } from './system1.ts';

/*
 * "Finito davvero?" after every delegation (D-067, research 08 §5.2,
 * research 07 §5.4): the facts of the log (notes created and changed, tools
 * used) against the brief, never the monster's word alone.
 * - First the code: a report that says it saved something when the vault log
 *   has no note, and the numbers of `done_when` ("3 fornitori", "due
 *   varianti") against the numbers the report declares (Jev cannot count);
 * - then the instinct, one call: `done` against `done_when` and one question
 *   per constraint (fan-out), only for the criteria the orchestrator wrote.
 * Below the low band (or a failure of the code checks) the sub-agent gets a
 * reminder and a few more steps, once per delegation; in the middle the
 * report carries `check: "dubbio"`.
 */

export interface DoneCheckInput {
  goal: string;
  /** `done_when` of the brief (the orchestrator's or the blueprint's default). */
  doneWhen?: string | undefined;
  constraints?: readonly string[] | undefined;
  /** Fields the orchestrator wrote itself (`done_when`, `constraints`…): only those go to the engine. */
  filled: readonly string[];
  /** The sub-agent's report. */
  summary: string;
  notesCreated: readonly string[];
  notesChanged: readonly string[];
  /** Tools the sub-agent called (names), from the log. */
  tools: readonly string[];
}

export interface DoneCheckContext {
  /** The delegating agent (owner of the events). */
  agent: string;
  runId: string;
  /** The `delegation` event. */
  parentId: string;
  signal?: AbortSignal;
}

export interface DoneCheckResult {
  verdict: DelegationVerdict;
  criteria: ReceiptCriterion[];
  /** Below the low band, or a code check failed: what the sub-agent reads. */
  reminder?: string;
  /** In the middle band: why the result is doubtful (for the orchestrator). */
  doubt?: string;
  /** What is missing, in plain Italian (for the orchestrator and the Activity). */
  missing: string[];
  /** The engine answered. */
  byModel: boolean;
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1,
  uno: 1,
  una: 1,
  due: 2,
  tre: 3,
  quattro: 4,
  cinque: 5,
  sei: 6,
  sette: 7,
  otto: 8,
  nove: 9,
  dieci: 10,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};
const NUMBER = '(\\d{1,2}|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|two|three|four|five)';
const COUNT = new RegExp(
  withUnicodeBoundaries(`\\b(?:almeno\\s+|at\\s+least\\s+)?${NUMBER}\\s+(\\p{L}{3,})`),
  'giu',
);

const toNumber = (s: string) => NUMBER_WORDS[s.toLowerCase()] ?? Number(s);
/** A noun compared by its start: "fornitori" and "fornitore", "varianti" and "variante". */
const stem = (noun: string) => noun.toLowerCase().slice(0, Math.max(4, noun.length - 2));

/** "massimo 10 righe", "non più di 3": an upper bound, not a number to reach. */
const UPPER_BOUND = wordRegex(
  '\\b(massimo|al\\s+massimo|max|non\\s+più\\s+di|fino\\s+a|entro|meno\\s+di|at\\s+most|up\\s+to|no\\s+more\\s+than)\\s*$',
);

/** "almeno 3 fornitori con prezzo" → [{ n: 3, noun: 'fornitori' }] (numbers ≥ 2, no upper bounds). */
export function expectedCounts(text: string): { n: number; noun: string }[] {
  const out: { n: number; noun: string }[] = [];
  for (const m of text.matchAll(COUNT)) {
    const n = toNumber(m[1]!);
    if (UPPER_BOUND.test(text.slice(Math.max(0, m.index - 20), m.index))) continue;
    if (Number.isFinite(n) && n >= 2 && n <= 50) out.push({ n, noun: m[2]! });
  }
  return out;
}

/** "un tema per settimana" for a month: four weeks (the count Jev got wrong, research 08 §4.3). */
const PER_WEEK = wordRegex('\\b(un|uno|una)\\s+(\\p{L}{3,})\\s+(per|a|ogni)\\s+settimana\\b');
const MONTH = wordRegex(
  '\\b(mese|mensile|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\\b',
);
const WEEK_N = new RegExp(
  withUnicodeBoundaries('\\bsettimana\\s+(\\d|uno|due|tre|quattro|cinque)\\b'),
  'giu',
);

/** Weeks named in a report ("settimana 1 …, settimana 2 …"). */
function weeksNamed(summary: string): number {
  return new Set([...summary.matchAll(WEEK_N)].map((m) => m[1]!.toLowerCase())).size;
}

/**
 * The numbers of `done_when` the report declares as smaller ("Ho trovato 2
 * fornitori" for "almeno 3 fornitori"; three weeks for "un tema per
 * settimana" of a month): a check in code, the report's own words against
 * the brief.
 */
export function countShortfalls(doneWhen: string, summary: string, goal = ''): string[] {
  const perWeek = PER_WEEK.exec(doneWhen);
  const weeks = perWeek && MONTH.test(`${goal}\n${doneWhen}`) ? weeksNamed(summary) : 0;
  const monthly =
    weeks > 0 && weeks < 4
      ? [`serve un ${perWeek![2]} per ognuna delle 4 settimane, il rapporto ne elenca ${weeks}`]
      : [];
  return [...countsBelow(doneWhen, summary), ...monthly];
}

function countsBelow(doneWhen: string, summary: string): string[] {
  const declared = [...summary.matchAll(COUNT)].map((m) => ({
    n: toNumber(m[1]!),
    stem: stem(m[2]!),
  }));
  const out: string[] = [];
  for (const want of expectedCounts(doneWhen)) {
    const s = stem(want.noun);
    const said = declared.filter((d) => d.stem === s && Number.isFinite(d.n));
    if (said.length > 0 && Math.max(...said.map((d) => d.n)) < want.n) {
      out.push(
        `servono ${want.n} ${want.noun}, il rapporto ne dichiara ${Math.max(...said.map((d) => d.n))}`,
      );
    }
  }
  return out;
}

/** The report says it saved or wrote a note. */
const SAVE_CLAIM = new RegExp(
  withUnicodeBoundaries(
    "\\b(salvat\\w*|salvo|ho\\s+creato|creat[ao]|ho\\s+scritto|scritt[ao]\\s+(in|nella)|aggiornat[ao]|nella\\s+nota|in\\s+una\\s+nota|l'ho\\s+messa|saved|created|wrote\\s+(it\\s+)?(in|to))\\b",
  ),
  'giu',
);
/** "non ho salvato", "senza salvare", "not saved": not a claim. */
const NEGATION = wordRegex('\\b(non|senza|not|nessun\\w*|niente)\\b[^.!?\\n]{0,20}$');

/** A report that claims saved notes while the vault log has none (hd1, d04 of the measure). */
export function claimsNotesWithout(
  summary: string,
  notes: { created: readonly string[]; changed: readonly string[] },
): boolean {
  if (notes.created.length > 0 || notes.changed.length > 0) return false;
  for (const m of summary.matchAll(SAVE_CLAIM)) {
    const before = summary.slice(Math.max(0, m.index - 30), m.index);
    if (!NEGATION.test(before)) return true;
  }
  return false;
}

const DOUBT = 'Il controllo non è sicuro che il lavoro sia completo';

export class DoneChecker {
  readonly #s1: System1;

  constructor(system1: System1) {
    this.#s1 = system1;
  }

  /** The use is not off: there is something to check (code checks included). */
  get enabled(): boolean {
    return this.#s1.mode('done_check') !== 'off';
  }

  async check(input: DoneCheckInput, ctx: DoneCheckContext): Promise<DoneCheckResult> {
    const mode = this.#s1.mode('done_check');
    const unchecked: DoneCheckResult = {
      verdict: 'unchecked',
      criteria: [],
      missing: [],
      byModel: false,
    };
    if (mode === 'off') return unchecked;

    // 1. The code: what the vault log and the numbers say.
    const criteria: ReceiptCriterion[] = [];
    const missing: string[] = [];
    if (
      claimsNotesWithout(input.summary, {
        created: input.notesCreated,
        changed: input.notesChanged,
      })
    ) {
      const reason =
        'il rapporto dice di aver salvato una nota, ma il registro del vault non ne ha';
      missing.push(reason);
      criteria.push({ text: 'Note salvate', kind: 'notes', ok: false, by: 'rules', reason });
    } else if (input.notesCreated.length + input.notesChanged.length > 0) {
      criteria.push({ text: 'Note salvate', kind: 'notes', ok: true, by: 'rules' });
    }
    const shortfalls = input.doneWhen
      ? countShortfalls(input.doneWhen, input.summary, input.goal)
      : [];
    missing.push(...shortfalls);

    // 2. The instinct, only on the criteria the orchestrator wrote (the default one
    // of the blueprint is checked by the code above).
    const doneWhen = input.filled.includes('done_when') ? input.doneWhen?.trim() : undefined;
    const constraints = input.filled.includes('constraints') ? [...(input.constraints ?? [])] : [];
    let byModel = false;
    let doubtful = false;
    if (doneWhen || constraints.length > 0) {
      const request = doneCheckRequest({
        goal: input.goal,
        doneWhen: doneWhen ?? 'il compito è fatto e il rapporto è pronto',
        constraints,
        summary: input.summary,
        notesCreated: input.notesCreated,
        notesChanged: input.notesChanged,
        tools: input.tools,
      });
      const bands = { low: BANDS.done.low, high: BANDS.done.high };
      const answer = await this.#s1.ask({
        use: 'done_check',
        agent: ctx.agent,
        runId: ctx.runId,
        parentId: ctx.parentId,
        request,
        logAs: Object.fromEntries(
          request.questions.map((q) => [
            q.id,
            { kind: q.id === 'done' ? 'done_check' : 'constraint', bands },
          ]),
        ),
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      const asked: { id: string; text: string; kind: 'done_when' | 'constraint' }[] = [
        ...(doneWhen ? [{ id: 'done', text: doneWhen, kind: 'done_when' as const }] : []),
        ...constraints.map((c, i) => ({
          id: `constraint_${i + 1}`,
          text: c,
          kind: 'constraint' as const,
        })),
      ];
      for (const q of asked) {
        const p = answer?.mode === 'on' ? pOf(answer, q.id) : undefined;
        if (p === undefined) {
          criteria.push({ text: q.text, kind: q.kind, ok: null, by: 'none' });
          continue;
        }
        byModel = true;
        const band = bandOf(p, bands.low, bands.high);
        const shortfall = q.kind === 'done_when' ? shortfalls[0] : undefined;
        if (band === 'low' || shortfall) {
          const reason = shortfall ?? `non risulta: «${q.text}»`;
          if (!shortfall) missing.push(reason);
          criteria.push({
            text: q.text,
            kind: q.kind,
            ok: false,
            by: shortfall ? 'rules' : 'model',
            reason,
            p,
          });
        } else if (band === 'mid') {
          doubtful = true;
          criteria.push({
            text: q.text,
            kind: q.kind,
            ok: null,
            by: 'model',
            reason: 'non è chiaro dal rapporto e dalle note',
            p,
          });
        } else {
          criteria.push({ text: q.text, kind: q.kind, ok: true, by: 'model', p });
        }
      }
      // The numbers fail on their own when the engine did not answer.
      if (!byModel && shortfalls.length > 0 && doneWhen) {
        const at = criteria.findIndex((c) => c.kind === 'done_when');
        if (at >= 0)
          criteria[at] = {
            text: doneWhen,
            kind: 'done_when',
            ok: false,
            by: 'rules',
            reason: shortfalls[0]!,
          };
      }
    } else if (shortfalls.length > 0 && input.doneWhen) {
      criteria.push({
        text: input.doneWhen,
        kind: 'done_when',
        ok: false,
        by: 'rules',
        reason: shortfalls[0]!,
      });
    }

    // In shadow nothing changes: the answers are in the log, the code's checks too.
    if (mode === 'shadow') return unchecked;
    if (missing.length > 0) {
      return {
        verdict: 'incomplete',
        criteria,
        missing,
        byModel,
        reminder:
          `[Controllo del sistema] Il lavoro non sembra finito: ${missing.join('; ')}. ` +
          'Completa quello che manca con gli strumenti; se non puoi, scrivi chiaramente nel rapporto ' +
          'cosa manca e la causa come te l’ha data il sistema, senza dedurla (un rifiuto è dell’utente ' +
          'solo se l’utente ha detto no). Non dire che è fatto se non lo è.',
      };
    }
    if (doubtful) {
      const unsure = criteria.filter((c) => c.ok === null && c.by === 'model').map((c) => c.text);
      return {
        verdict: 'doubt',
        criteria,
        missing,
        byModel,
        doubt: `${DOUBT}: ${unsure.map((t) => `«${t}»`).join(', ')}`,
      };
    }
    const allModel = criteria.some((c) => c.by === 'model') && criteria.every((c) => c.ok === true);
    return { verdict: allModel ? 'verified' : 'unchecked', criteria, missing, byModel };
  }
}
