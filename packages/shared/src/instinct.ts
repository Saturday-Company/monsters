import { z } from 'zod';
import { DecisionEngineSchema } from './decisions.ts';
import { EffortSchema } from './providers.ts';
import { TOOL_FAILURE_CAUSES } from './tools.ts';

/*
 * The team's "Istinto" (System 1, D-067): the quick decisions taken while the
 * monsters work, each one a "use" with its own mode. Same rules as the rest of
 * the API (JSON body, anti-CSRF header, session or bearer).
 *
 *   GET  /api/settings/instinct            → InstinctView
 *   PUT  /api/settings/instinct            InstinctUpdate → InstinctView
 *   GET  /api/instinct/scorecard           → ScorecardView (pagella dei mostri)
 *   GET  /api/runs/:runId/receipts         → Receipt[] (one per turn, newest last)
 *   POST /api/runs/:runId/undo             → UndoRunResult ("Annulla tutto il lavoro")
 *
 * Errors: 409 `no_key` (Jev chosen without a TypeSafe key), 400 `mode_not_available`
 * (a mode the use does not have, e.g. the shortcut is only in trial), 404 `not_found`.
 * The TypeSafe key itself is set with `PUT /api/settings/typesafe-key` (decisions.ts).
 */

/**
 * - `gate`: ask or proceed (ask_user);
 * - `done_check`: is a delegated job really finished?
 * - `stuck`: is a monster going round in circles?
 * - `final_question`: a question left in the text becomes a card;
 * - `route_hint`: which monster fits the request (a hint in the prompt);
 * - `tools`: rare tools and the web only when the request needs them;
 * - `tier`: cheap model for simple turns, strong one for hard ones;
 * - `shortcut`: straight to one monster without the orchestrator (trial: shadow only);
 * - `outbound`: actions that leave the computer wait for the user;
 * - `injection`: orders to the agents hidden in external text;
 * - `memory`: is a line worth remembering for the next jobs?
 * - `scorecard`: the chain of a monster reordered on verified results.
 */
export const INSTINCT_USES = [
  'gate',
  'done_check',
  'stuck',
  'final_question',
  'route_hint',
  'tools',
  'tier',
  'shortcut',
  'outbound',
  'injection',
  'memory',
  'scorecard',
] as const;
export const InstinctUseSchema = z.enum(INSTINCT_USES);
export type InstinctUse = z.infer<typeof InstinctUseSchema>;

/** `off`: today's behaviour; `shadow`: asked and logged, nothing changes; `on`: acts. */
export const InstinctModeSchema = z.enum(['off', 'shadow', 'on']);
export type InstinctMode = z.infer<typeof InstinctModeSchema>;

export const InstinctUseViewSchema = z.object({
  id: InstinctUseSchema,
  mode: InstinctModeSchema,
  /** Mode when the user did not choose one. */
  defaultMode: InstinctModeSchema,
  /** Modes this use offers (the shortcut has no `on` yet). */
  modes: z.array(InstinctModeSchema),
  /** Row title, in the user's words ("Controlla che i lavori siano finiti davvero"). */
  label: z.string(),
  description: z.string(),
  /**
   * Engines with which the use does something: `rules` = it works (in a simpler
   * way) even with "Solo regole"; a use without `rules` waits for a model.
   */
  engines: z.array(DecisionEngineSchema),
  /** The use acts with the current engine (false: it falls back to today's behaviour). */
  active: z.boolean(),
  /** What leaves the computer for this use with Jev (privacy, shown in the details). */
  sends: z.string(),
});
export type InstinctUseView = z.infer<typeof InstinctUseViewSchema>;

export const InstinctEngineViewSchema = z.object({
  id: DecisionEngineSchema,
  label: z.string(),
  description: z.string(),
});

export const InstinctViewSchema = z.object({
  /** Module title ("Istinto") and the line under it. */
  title: z.string(),
  description: z.string(),
  engine: DecisionEngineSchema,
  /** `user`: chosen in the settings; `default`: Jev with a key, the rules without. */
  engineSource: z.enum(['user', 'default']),
  engines: z.array(InstinctEngineViewSchema),
  uses: z.array(InstinctUseViewSchema),
  jev: z.object({
    keySet: z.boolean(),
    keySource: z.enum(['file', 'env']).optional(),
    /** Pinned version (thresholds are measured on it). */
    model: z.string(),
    /** The gate proceeds on Jev's word only with p("the user decides") ≤ maxP. */
    maxP: z.number(),
  }),
});
export type InstinctView = z.infer<typeof InstinctViewSchema>;

export const InstinctUpdateSchema = z
  .object({
    engine: DecisionEngineSchema.optional(),
    uses: z.partialRecord(InstinctUseSchema, InstinctModeSchema).optional(),
  })
  .refine((u) => u.engine !== undefined || u.uses !== undefined, 'nothing to change');
export type InstinctUpdate = z.infer<typeof InstinctUpdateSchema>;

/** What a use is, for the settings (research 08 §7) and for the code that runs it. */
export interface InstinctUseInfo {
  id: InstinctUse;
  /** Mode when the user did not choose one. */
  defaultMode: InstinctMode;
  /** Modes the use has (the shortcut is a trial: no `on`). */
  modes: readonly InstinctMode[];
  /** It does something with the rules alone (code checks, regexes). */
  rules: boolean;
  /** The small LLM may answer for it (`Modello piccolo`): only off the critical path. */
  llm: boolean;
  /** Jev answers for it. */
  jev: boolean;
  /** Row of the settings. */
  label: string;
  description: string;
  /** What leaves the computer with Jev (shown in the technical details, D-067). */
  sends: string;
}

/** Title of the module in Settings → Squadra, and the line under it (glossary: "istinto"). */
export const INSTINCT_TITLE = 'Decisioni dei mostri';
export const INSTINCT_DESCRIPTION =
  'Le decisioni al volo della squadra: a chi passare un lavoro, se serve chiederti, se un risultato è finito davvero, se un mostro gira a vuoto. Pubblicare, scrivere ad altri, spendere e cancellare te li chiedono sempre.';

/** The "Chi decide" row. */
export const INSTINCT_ENGINE_TEXTS: Readonly<
  Record<'rules' | 'llm' | 'jev', { label: string; description: string }>
> = {
  rules: {
    label: 'Solo regole',
    description: 'Le cose non chiare te le chiedono sempre; niente controlli in più.',
  },
  llm: {
    label: 'Modello piccolo',
    description:
      'Usa uno dei tuoi modelli: è gratis, ma più lento e a volte sbaglia. Solo per le decisioni che possono aspettare qualche secondo.',
  },
  jev: {
    label: 'Un modello esperto (TypeSafe)',
    description:
      'Un modello fatto apposta per decidere in un attimo. Costa pochissimo (circa 1 € ogni 2.000 lavori) e serve una chiave di TypeSafe. Riceve la richiesta, i riassunti dei lavori e le pagine web che i mostri leggono, mai le tue note.',
  },
};

export const INSTINCT_USE_INFO: Readonly<Record<InstinctUse, InstinctUseInfo>> = {
  gate: {
    id: 'gate',
    defaultMode: 'on',
    modes: ['off', 'shadow', 'on'],
    rules: true,
    llm: true,
    jev: true,
    label: 'Ti chiede solo quando serve',
    description:
      'Le scelte che si possono annullare le decide la squadra; gusto, fatti che sai solo tu e le cose in «Chiedi sempre» le chiede a te.',
    sends: 'La domanda del mostro, le opzioni e la richiesta a cui sta lavorando.',
  },
  done_check: {
    id: 'done_check',
    defaultMode: 'on',
    modes: ['off', 'shadow', 'on'],
    rules: true,
    llm: true,
    jev: true,
    label: 'Controlla che i lavori siano finiti davvero',
    description:
      'Dopo ogni lavoro confronta quello che il mostro dice con le note che ha salvato davvero: se manca qualcosa gli chiede di completarlo.',
    sends:
      'Il compito, «finito quando» e i vincoli, il rapporto del mostro e i nomi delle note toccate (non il loro contenuto).',
  },
  stuck: {
    id: 'stuck',
    defaultMode: 'on',
    modes: ['off', 'shadow', 'on'],
    rules: true,
    llm: false,
    jev: true,
    label: 'Ferma chi gira a vuoto',
    description:
      'Se un mostro ripete le stesse azioni senza andare avanti gli chiede di cambiare strada, e se insiste passa a un altro modello. Non lo ferma mai da solo.',
    sends:
      'Il compito e gli ultimi passi in una riga ciascuno (strumento, argomenti brevi, esito).',
  },
  final_question: {
    id: 'final_question',
    defaultMode: 'on',
    modes: ['off', 'shadow', 'on'],
    rules: true,
    llm: false,
    jev: true,
    label: 'Le domande diventano schede',
    description:
      'Se il tuo capo chiude una risposta chiedendoti qualcosa, te lo manda come scheda con le opzioni da toccare.',
    sends: 'Le ultime frasi della risposta del tuo capo.',
  },
  route_hint: {
    id: 'route_hint',
    defaultMode: 'on',
    modes: ['off', 'shadow', 'on'],
    rules: false,
    llm: false,
    jev: true,
    label: 'Passa il lavoro al mostro giusto',
    description:
      'Suggerisce al tuo capo a chi affidare la richiesta, o di rispondere da solo quando non serve delegare.',
    sends: 'La tua richiesta, gli ultimi messaggi e i nomi e ruoli dei mostri.',
  },
  tools: {
    id: 'tools',
    defaultMode: 'on',
    modes: ['off', 'shadow', 'on'],
    rules: true,
    llm: false,
    jev: true,
    label: 'Dà a ogni mostro solo gli strumenti che servono',
    description:
      'Gli strumenti rari (annullare, spostare, cancellare note) e il web arrivano solo quando la richiesta li chiede: i modelli gratuiti si confondono meno.',
    sends: 'La tua richiesta (nella stessa domanda di «Passa il lavoro al mostro giusto»).',
  },
  tier: {
    id: 'tier',
    defaultMode: 'on',
    modes: ['off', 'shadow', 'on'],
    rules: false,
    llm: false,
    jev: true,
    label: 'Usa il modello più economico per le cose semplici',
    description:
      'Se un mostro ha un modello leggero e uno potente, le richieste semplici vanno al leggero e quelle difficili al potente; ogni incarico che il capo passa a un mostro ha il suo livello. Non usa mai modelli a pagamento se li hai spenti.',
    sends:
      'La tua richiesta (nella stessa domanda di «Passa il lavoro al mostro giusto») e, per ogni incarico, il testo che il capo scrive al mostro.',
  },
  shortcut: {
    id: 'shortcut',
    defaultMode: 'shadow',
    modes: ['off', 'shadow'],
    rules: false,
    llm: false,
    jev: true,
    label: 'Scorciatoia verso il mostro giusto (in prova)',
    description:
      'In prova: annota quando avrebbe mandato la richiesta direttamente a un mostro, senza passare dal tuo capo. Per ora non cambia nulla.',
    sends: 'La tua richiesta (nella stessa domanda di «Passa il lavoro al mostro giusto»).',
  },
  outbound: {
    id: 'outbound',
    defaultMode: 'on',
    modes: ['off', 'shadow', 'on'],
    rules: true,
    llm: false,
    jev: true,
    label: 'Ti chiede prima delle azioni che escono dal computer',
    description:
      'Prima di pubblicare, scrivere ad altri, spendere o cancellare per sempre con altri programmi, il browser o il terminale, e prima di mandare pezzi delle tue note a un sito mai visto, il mostro si ferma e te lo chiede (solo per le cose in «Chiedi sempre»). Queste regole valgono sempre; se le decisioni dei mostri sono accese, guardano anche i casi dubbi.',
    sends:
      'Il nome dello strumento, la sua descrizione e gli argomenti della chiamata (accorciati).',
  },
  injection: {
    id: 'injection',
    defaultMode: 'on',
    modes: ['off', 'shadow', 'on'],
    rules: false,
    llm: false,
    jev: true,
    label: 'Segnala i testi che danno ordini ai mostri',
    description:
      'Nelle pagine web e nei testi di altri programmi cerca frasi rivolte ai mostri: le segnala, o le toglie quando è sicuro. Le tue note non le controlla.',
    sends:
      'Il testo delle pagine web e dei risultati di altri programmi che i mostri leggono. Mai le tue note.',
  },
  memory: {
    id: 'memory',
    defaultMode: 'on',
    modes: ['off', 'shadow', 'on'],
    rules: false,
    llm: true,
    jev: true,
    label: 'Ricorda solo quello che serve',
    description:
      'Prima di aggiungere un ricordo alla memoria di un mostro controlla che serva anche nei lavori dopo.',
    sends: 'Le righe «Da ricordare» scritte dal mostro, con il suo nome e ruolo.',
  },
  scorecard: {
    id: 'scorecard',
    defaultMode: 'on',
    modes: ['off', 'on'],
    rules: true,
    llm: true,
    jev: true,
    label: 'Impara quale modello lavora meglio',
    description:
      'Tiene la pagella dei mostri: dopo almeno 20 lavori controllati per modello mette per primo, tra i modelli che hai già, quello che finisce di più al costo più basso.',
    sends: 'Niente: la pagella resta su questo computer.',
  },
};

// --- mostro confuso (stuck) ---------------------------------------------------------

/**
 * Instinct actions of the `stuck` use that make a monster at work look
 * confused ("sta cambiando strada", D-068); the core keeps it in the state of
 * the agent (`AgentSummary.confusedSince`, D-072), the UI shows it.
 */
export const STUCK_ACTIONS: ReadonlySet<string> = new Set([
  'stuck_notice',
  'stuck_nudge',
  'stuck_demote',
]);

/** A confused monster keeps its face at least this long, then the next action (a tool, words) ends it. */
export const CONFUSED_MIN_MS = 4000;

// --- pagella dei mostri (scorecard) -----------------------------------------------

/** Outcome of a delegation checked by "finito davvero?". */
export const DelegationVerdictSchema = z.enum([
  /** Every criterion met (the model said so above the high band, or the code checked it). */
  'verified',
  /** Some criterion uncertain: the report carries `check: "dubbio"`. */
  'doubt',
  /** Something missing even after the reminder. */
  'incomplete',
  /** The delegation failed or stopped without a report. */
  'failed',
  /** Not checked (no `done_when`, use off, no engine answer). */
  'unchecked',
]);
export type DelegationVerdict = z.infer<typeof DelegationVerdictSchema>;

export const ScorecardRowSchema = z.object({
  agent: z.string(),
  agentName: z.string(),
  /** `provider:model` that served the delegation. */
  model: z.string(),
  /** Model tier of the turn (`light`, `strong`, or `any` when not decided). */
  tier: z.enum(['light', 'strong', 'any']),
  delegations: z.number().int().nonnegative(),
  /** Delegations with a verdict other than `unchecked`. */
  checked: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
  doubt: z.number().int().nonnegative(),
  incomplete: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** verified / checked (null with no checked delegation). */
  successRate: z.number().nullable(),
  avgSteps: z.number().nullable(),
  avgCostUsd: z.number().nullable(),
  /** Total cost / verified delegations (null with none verified). */
  costPerVerifiedUsd: z.number().nullable(),
});
export type ScorecardRow = z.infer<typeof ScorecardRowSchema>;

export const ScorecardViewSchema = z.object({
  /** The automatic reordering is on (use `scorecard`). */
  enabled: z.boolean(),
  /** Checked delegations a model needs before it can be moved. */
  minDelegations: z.number().int(),
  rows: z.array(ScorecardRowSchema),
  /** Chains reordered by the scorecard, by agent id: `provider:model` in the order used. */
  reordered: z.record(z.string(), z.array(z.string())),
});
export type ScorecardView = z.infer<typeof ScorecardViewSchema>;

// --- ricevuta del lavoro (receipt) ------------------------------------------------

export const ReceiptCriterionSchema = z.object({
  /** The criterion as the brief says it (`done_when`, or one of the `constraints`). */
  text: z.string(),
  kind: z.enum(['done_when', 'constraint', 'notes']),
  /** true ✓, false ✗, null not checked. */
  ok: z.boolean().nullable(),
  /** Who checked: the code (log of the vault, counts) or the engine. */
  by: z.enum(['rules', 'model', 'none']),
  /** Why ✗ or uncertain, in plain Italian. */
  reason: z.string().optional(),
  /** p("met") when a model checked it. */
  p: z.number().min(0).max(1).optional(),
});
export type ReceiptCriterion = z.infer<typeof ReceiptCriterionSchema>;

export const ReceiptDataSchema = z.object({
  /** The user's request of this turn. */
  request: z.string(),
  /** Its `message` event. */
  requestEventId: z.string().optional(),
  /** Agent that received the request. */
  agent: z.string(),
  status: z.enum(['completed', 'failed', 'aborted']),
  delegations: z.array(
    z.object({
      agent: z.string(),
      agentName: z.string(),
      goal: z.string(),
      status: z.enum(['completed', 'failed', 'aborted', 'max_steps', 'token_limit', 'run_limit']),
      verdict: DelegationVerdictSchema,
      criteria: z.array(ReceiptCriterionSchema),
      /** The reminder was sent and the monster got more steps. */
      retried: z.boolean().optional(),
      model: z.string().optional(),
      /** The level that chose its model (D-109), when the monster has one per level. */
      level: z.enum(['simple', 'medium', 'hard']).optional(),
      /** The effort it worked at, only in "Automatica" (D-110). */
      effort: EffortSchema.optional(),
      steps: z.number().int().nonnegative().optional(),
      costUsd: z.number().nonnegative().optional(),
    }),
  ),
  /** Notes created, changed, moved or deleted in this turn, with what "Annulla tutto" undoes. */
  notes: z.array(
    z.object({
      path: z.string(),
      action: z.string(),
      agent: z.string(),
      commit: z.string().optional(),
      actionId: z.string().optional(),
    }),
  ),
  /** Tools that leave the vault (web, other programs, terminal, files), with the number of calls. */
  externalTools: z.array(
    z.object({
      tool: z.string(),
      calls: z.number().int().positive(),
      failed: z.number().int(),
      /** Why some calls failed when it was the run's setup, never the user (D-127). */
      why: z.string().optional(),
      /** The causes of the failed calls, as the core wrote them (D-132). */
      causes: z.array(z.enum(TOOL_FAILURE_CAUSES)).optional(),
    }),
  ),
  /** Actions towards the outside the brake looked at (asked, approved, refused, or only marked). */
  outbound: z.array(
    z.object({
      agent: z.string(),
      tool: z.string(),
      category: z.string(),
      outcome: z.enum(['approved', 'refused', 'marked', 'expired']),
      summary: z.string(),
    }),
  ),
  /** Monsters stopped for going round in circles, injected texts removed (counts). */
  alerts: z.object({ stuck: z.number().int(), injections: z.number().int() }),
  /**
   * The model that served each monster and why (D-093): the level the
   * radiografia gave the request ("Difficile → Opus"), the model that reached
   * the plan's limit before it.
   */
  models: z
    .array(
      z.object({
        agent: z.string(),
        /** `provider:model` of the last request served. */
        model: z.string(),
        level: z.enum(['simple', 'medium', 'hard']).optional(),
        /** Effort of the model that served it, only in "Automatica" (D-110). */
        effort: EffortSchema.optional(),
        /** `provider:model` that reached the plan's limit (the request moved on). */
        limited: z.string().optional(),
      }),
    )
    .optional(),
  usage: z.object({
    costUsd: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    /** Model calls of the agents. */
    modelCalls: z.number().int().nonnegative(),
    /** What the instinct cost (TypeSafe), part of `costUsd`. */
    instinctCostUsd: z.number().nonnegative(),
    instinctCalls: z.number().int().nonnegative(),
    /** Paid web searches (D-071) and what they cost, part of `costUsd`. */
    searchCalls: z.number().int().nonnegative().optional(),
    searchCostUsd: z.number().nonnegative().optional(),
    /** Summaries of the older turns of the conversation (C.3, D-082), part of `costUsd`. */
    compactionCalls: z.number().int().nonnegative().optional(),
    compactionCostUsd: z.number().nonnegative().optional(),
  }),
  startedAt: z.number(),
  durationMs: z.number().nonnegative(),
  /** Some note change of this turn can be undone. */
  undoable: z.boolean(),
});
export type ReceiptData = z.infer<typeof ReceiptDataSchema>;

export const UndoRunResultSchema = z.object({
  undone: z.array(
    z.object({ actionId: z.string(), commit: z.string().optional(), files: z.array(z.string()) }),
  ),
  failed: z.array(z.object({ actionId: z.string(), error: z.string(), message: z.string() })),
});
export type UndoRunResult = z.infer<typeof UndoRunResultSchema>;

/** A receipt as `GET /api/runs/:runId/receipts` returns it: the `receipt` event's data with its id. */
export const ReceiptSchema = ReceiptDataSchema.extend({
  /** Id of the `receipt` event. */
  id: z.string(),
  ts: z.number(),
  runId: z.string(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;
