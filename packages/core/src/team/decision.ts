import { errorMessage, type ModelRef, type ProviderRegistry } from '@monsters/providers';
import type { InstinctMode } from '@monsters/shared';
import { streamText } from 'ai';
import { z } from 'zod';
import { stepUsage } from '../agents/usage.ts';
import type { EventLog } from '../log/event-log.ts';
import { BANDS, gateRequest } from './instinct/questions.ts';
import { unicodeWords, wordRegex } from './word-boundary.ts';

/*
 * DecisionGate and System 1 (ARCHITECTURE §5.5, DECISIONS D-008, research 03 §4).
 *
 * `DecisionPort` speaks the `/v1/systemone` contract (state + typed questions →
 * answers with confidence), so Jev, Laya or an LLM are interchangeable. Phase 1:
 * rules first, then a small LLM with structured output for the gray zone. Every
 * decision is a `decision` event: the dataset to train Laya in phase 2.
 */

// --- /v1/systemone contract --------------------------------------------------

/** An option of a `choice`: its label, with a description of what it means (D-067). */
export const SystemOneOptionSchema = z.union([
  z.string().min(1),
  z.object({ label: z.string().min(1), description: z.string().min(1).optional() }),
]);
export type SystemOneOption = z.infer<typeof SystemOneOptionSchema>;

export const SystemOneQuestionSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('choice'),
    prompt: z.string().min(1),
    /** Labels, or labels with a description (Jev's `criteria`): the answer is a label. */
    options: z.array(SystemOneOptionSchema).min(2).max(255),
  }),
  /** Yes/no: the answer value is the probability of "yes". */
  z.object({
    id: z.string().min(1),
    type: z.literal('noul'),
    prompt: z.string().min(1),
    /** What "yes" and "no" mean, when the line between them is thin (Jev's `criteria`). */
    criteria: z.object({ true: z.string().min(1), false: z.string().min(1) }).optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('score'),
    prompt: z.string().min(1),
    min: z.number().default(0),
    max: z.number().default(1),
    /**
     * 2-10 ordered levels described in words (lowest first): the answer is then
     * the level index, 0…n−1, weighted by probability (`min`/`max` ignored).
     */
    levels: z.array(z.string().min(1)).min(2).max(10).optional(),
  }),
]);
export type SystemOneQuestion = z.input<typeof SystemOneQuestionSchema>;

/** The label of an option (the value a `choice` answer carries). */
export function optionLabel(option: SystemOneOption): string {
  return typeof option === 'string' ? option : option.label;
}

/** Range of a score answer: the levels' indexes when they are given. */
export function scoreRange(q: { min: number; max: number; levels?: string[] | undefined }): {
  min: number;
  max: number;
} {
  return q.levels ? { min: 0, max: q.levels.length - 1 } : { min: q.min, max: q.max };
}

export interface SystemOneRequest {
  /** Free text or JSON describing the situation. */
  state: string | Record<string, unknown>;
  questions: SystemOneQuestion[];
}

export const SystemOneAnswerSchema = z.object({
  id: z.string(),
  /** choice → option text; noul → probability of yes (0-1); score → number. */
  value: z.union([z.string(), z.number()]),
  confidence: z.number().min(0).max(1),
});
export type SystemOneAnswer = z.infer<typeof SystemOneAnswerSchema>;

export const SystemOneResponseSchema = z.object({
  answers: z.array(SystemOneAnswerSchema),
  model: z.string().optional(),
  /** Model calls made to answer (an LLM port reports them; the gate logs `provider_usage`). */
  usage: z
    .array(
      z.object({
        provider: z.string(),
        model: z.string(),
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
        /** Declared by the provider or computed from its published price. */
        costUsd: z.number().optional(),
        durationMs: z.number().optional(),
        requestedModel: z.string().optional(),
        queuedMs: z.number().optional(),
      }),
    )
    .optional(),
  /** Ports that failed before this one answered, as codes (`jev: no_credit`, `FallbackDecisionPort`). */
  fallbackFrom: z.array(z.string()).optional(),
  /** The same failures in words: provider text, for the log only. */
  fallbackDetail: z.array(z.string()).optional(),
});
export type SystemOneResponse = z.infer<typeof SystemOneResponseSchema>;

/**
 * A port that failed after spending model calls (logged anyway). `code` is a
 * short id (`no_credit`, `timeout`…) safe to show to an agent; `message` may
 * carry provider text and goes only to the log.
 */
export class DecisionPortError extends Error {
  readonly usage: NonNullable<SystemOneResponse['usage']>;
  readonly code: string;
  constructor(message: string, usage: NonNullable<SystemOneResponse['usage']>, code = 'error') {
    super(message);
    this.name = 'DecisionPortError';
    this.usage = usage;
    this.code = code;
  }
}

/** One failure code, optionally after the port id: `no_credit`, `jev: no_credit`. */
const FAILURE_CODE = /^(?:[a-z0-9_.>-]{1,40}: )?[a-z][a-z0-9_]{0,39}$/;

/**
 * The code of a port failure, never its text: codes made of anything else
 * (an untrusted message in the wrong field) become `error`.
 */
export function decisionErrorCode(err: unknown): string {
  return err instanceof DecisionPortError ? safeFailureCodes(err.code.split('; ')) : 'error';
}

function safeFailureCodes(codes: readonly string[]): string {
  return codes.map((c) => (FAILURE_CODE.test(c) ? c : 'error')).join('; ');
}

/** A System 1 model: rules-free, answers every question in one pass. */
export interface DecisionPort {
  readonly id: string;
  decide(request: SystemOneRequest, signal?: AbortSignal): Promise<SystemOneResponse>;
}

/** Checks a response against its request: every question answered with a valid value. */
export function validateSystemOne(
  request: SystemOneRequest,
  response: SystemOneResponse,
): Map<string, SystemOneAnswer> {
  const byId = new Map(response.answers.map((a) => [a.id, a]));
  for (const raw of request.questions) {
    const q = SystemOneQuestionSchema.parse(raw);
    const a = byId.get(q.id);
    if (!a) throw new Error(`no answer for question ${q.id}`);
    if (q.type === 'choice') {
      if (typeof a.value !== 'string' || !q.options.map(optionLabel).includes(a.value)) {
        throw new Error(`answer to ${q.id} is not one of the options`);
      }
    } else if (q.type === 'noul') {
      if (typeof a.value !== 'number' || a.value < 0 || a.value > 1) {
        throw new Error(`answer to ${q.id} must be a probability`);
      }
    } else {
      const { min, max } = scoreRange(q);
      if (typeof a.value !== 'number' || a.value < min || a.value > max) {
        throw new Error(`answer to ${q.id} must be a number in [${min}, ${max}]`);
      }
    }
  }
  return byId;
}

/** Extracts the first JSON object from a model answer (tolerates fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in the answer');
  return JSON.parse(body.slice(start, end + 1));
}

const LLM_SYSTEM = `Sei un modulo decisionale (System 1). Non spieghi e non usi strumenti.
Ricevi uno stato e delle domande tipizzate e rispondi SOLO con un oggetto JSON:
{"answers":[{"id":"<id domanda>","value":<valore>,"confidence":<0-1>}]}
- choice: value è il testo esatto di una delle opzioni (la "label" se l'opzione ha una descrizione);
- noul: value è la probabilità (0-1) che la risposta sia sì; criteria dice cosa vuol dire sì e no;
- score: value è un numero tra min e max; con levels è l'indice del livello (0 = il primo).
confidence è quanto sei sicuro (0-1): sii prudente.`;

/**
 * Phase 1 System 1: a small model with JSON output. Uses `streamText` (every
 * provider streams) and validates the answer with zod; any failure throws, and
 * the gate falls back to asking the user.
 */
export class LlmDecisionPort implements DecisionPort {
  readonly id = 'llm';
  readonly #providers: ProviderRegistry;
  readonly #models: () => ModelRef[];
  readonly #timeoutMs: number;

  constructor(options: {
    providers: ProviderRegistry;
    models: ModelRef[] | (() => ModelRef[]);
    /** Whole answer, every link included: then the gate asks the user (D-064). Default 15 s. */
    timeoutMs?: number;
  }) {
    this.#providers = options.providers;
    const models = options.models;
    this.#models = typeof models === 'function' ? models : () => models;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  async decide(request: SystemOneRequest, signal?: AbortSignal): Promise<SystemOneResponse> {
    const session = this.#providers.session(this.#models(), { pin: false });
    const questions = request.questions.map((q) => SystemOneQuestionSchema.parse(q));
    const prompt = JSON.stringify({ state: request.state, questions }, null, 2);
    const result = streamText({
      model: session,
      system: LLM_SYSTEM,
      prompt,
      maxRetries: 0,
      maxOutputTokens: 400,
      temperature: 0,
      ...(signal ? { abortSignal: signal } : {}),
      // A model that never answers must not hold the question (the user waits).
      timeout: { totalMs: this.#timeoutMs },
      onError: () => {},
    });
    let text = '';
    let failure: unknown;
    let stopped = false;
    const usage: NonNullable<SystemOneResponse['usage']> = [];
    let started = Date.now();
    try {
      for await (const part of result.stream) {
        if (part.type === 'start-step') started = Date.now();
        else if (part.type === 'text-delta') text += part.text;
        else if (part.type === 'error') failure ??= part.error;
        else if (part.type === 'abort') stopped = true;
        else if (part.type === 'finish-step')
          usage.push(stepUsage(session, part, Date.now() - started));
      }
    } catch (err) {
      failure ??= err;
    }
    if (stopped && failure === undefined && !signal?.aborted) {
      failure = new Error(`nessuna risposta entro ${Math.round(this.#timeoutMs / 1000)} s`);
    }
    if (failure !== undefined) {
      throw new DecisionPortError(errorMessage(failure), usage, 'provider_error');
    }
    let parsed: SystemOneResponse;
    try {
      parsed = SystemOneResponseSchema.parse(extractJson(text));
      validateSystemOne(request, parsed);
    } catch (err) {
      throw new DecisionPortError(errorMessage(err), usage, 'bad_response');
    }
    const served = session.lastServed?.ref.model;
    // Only the answers and the model come from the model's text: never a fallback list.
    return {
      answers: parsed.answers,
      ...(parsed.model !== undefined ? { model: parsed.model } : {}),
      ...(served ? { model: served } : {}),
      usage,
    };
  }
}

// --- rules -------------------------------------------------------------------

/** What kind of action a choice leads to; the caller may declare it. */
export const ActionKindSchema = z.enum([
  'publish',
  'contact',
  'spend',
  'delete',
  'goal_change',
  'taste',
  'local',
  'other',
]);
export type ActionKind = z.infer<typeof ActionKindSchema>;

export const DecisionRuleSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  effect: z.enum(['ask', 'proceed']),
  /** Matches when the declared kind is one of these. */
  kinds: z.array(ActionKindSchema).default([]),
  /** Case-insensitive regular expressions matched on the question and its options. */
  patterns: z
    .array(
      z.string().refine((p) => {
        try {
          new RegExp(p, 'iu');
          return true;
        } catch {
          return false;
        }
      }, 'invalid regular expression'),
    )
    .default([]),
  description: z.string().default(''),
});
export type DecisionRule = z.infer<typeof DecisionRuleSchema>;
export type DecisionRuleInput = z.input<typeof DecisionRuleSchema>;

/** Words for the length of a text, Italian: two of them in a choice make it a matter of taste. */
const LENGTH_WORD =
  '(lung[oa]|lunghi|lunghe|cort[oaie]|brev[ei]|estes[oaie]|sintetic[oa]|sintetici|sintetiche|stringat[oaie])';

/**
 * Defaults (ARCHITECTURE §5.5): always ask before publishing, writing to third
 * parties, spending, deleting irreversibly, changing the goal, or matters of
 * taste; proceed with local, reversible work. "Ask" rules win over "proceed".
 * An explicit preference of the user (from the profile, via the onboarding or
 * `settings.json`) turns a rule into "proceed" or disables it.
 */
export const DEFAULT_DECISION_RULES: DecisionRule[] = (
  [
    {
      id: 'publish',
      effect: 'ask',
      kinds: ['publish'],
      patterns: ['\\bpubblic', '\\bpublish', '\\bpost(are|o)?\\s+(su|sul|on)\\b', '\\btwee?t'],
      description: 'pubblicare qualcosa',
    },
    {
      id: 'contact',
      effect: 'ask',
      kinds: ['contact'],
      patterns: [
        '\\b(invi|mand|spedi)\\w*\\b.{0,40}\\b(e-?mail|mail|messaggi|dm|whatsapp|sms)',
        '\\b(scriv|rispond)\\w*\\s+(a|al|alla|ai|alle|agli)\\s+(client|fornitor|collegh|capo|terzi)',
        '\\b(a|ai|con)\\s+terzi\\b',
        '\\bsend\\b.{0,30}\\b(e-?mail|message)',
      ],
      description: 'scrivere a terzi',
    },
    {
      id: 'spend',
      effect: 'ask',
      kinds: ['spend'],
      patterns: [
        '\\b(pagar\\w*|pagament\\w*|pago|paghi\\w*|acquist\\w*|compr[aoi]\\w*|abbonament\\w*|abbonar\\w*|ricaric\\w*|spend\\w*|spes[ae])\\b',
        '\\b(buy|purchase|pay|subscribe)\\b',
        '(€|\\$|eur)\\s?\\d',
        '\\d\\s?(€|\\$|euro)',
      ],
      description: 'spendere soldi',
    },
    {
      id: 'delete',
      effect: 'ask',
      kinds: ['delete'],
      patterns: ['definitiv', 'irreversibil', 'permanent', '\\b(svuot|distrugg)', '\\brm\\s+-rf'],
      description: 'cancellare in modo irreversibile',
    },
    {
      id: 'goal',
      effect: 'ask',
      kinds: ['goal_change'],
      patterns: ["\\bcambi\\w*\\s+(l'|di\\s+)?obiettiv", '\\bchange\\s+(the\\s+)?goal'],
      description: "cambiare l'obiettivo",
    },
    {
      id: 'taste',
      effect: 'ask',
      kinds: ['taste'],
      // Matters of taste win over "local": choosing among drafts is the user's call.
      patterns: [
        '\\bton[oi]\\b',
        '\\bvariant[ei]?\\b',
        '\\b(design|stil[ei]|estetic\\w*|grafic\\w*|layout|palette|font|color[ei])\\b',
        '\\bprefer(isci|ite|iresti|ireste)\\b',
        '\\b(ti|vi)\\s+piace\\b',
        '\\bquale\\s+(bozza|versione|variante|proposta|titolo|immagine|logo)\\b',
        '\\bquale\\s+(delle|dei|degli|tra|fra)\\b.{0,40}\\b(bozz|version|propost|titol|immagin|logo)',
        '\\b(tone|variant|style|look and feel)\\b',
        '\\bwhich\\b.{0,40}\\b(prefer|like)\\b',
        // Length of a text ("il riassunto lo vuoi lungo o corto?"): taste, even when the
        // thing is a summary or a note (D-037: "riassunto" alone made it pass as local).
        `\\b${LENGTH_WORD}\\b.{0,40}\\b${LENGTH_WORD}\\b`,
        '\\b(long|short)(er)?\\s+or\\s+(long|short)(er)?\\b',
      ],
      description:
        'scelte di gusto (tono, variante, lunghezza, design, quale bozza), salvo preferenza esplicita nel profilo',
    },
    {
      // Facts only the user knows (D-025): when something happens, who takes part,
      // personal data. Asked even with options and even when the agent calls it local.
      id: 'facts',
      effect: 'ask',
      kinds: [],
      patterns: [
        '\\bin\\s+che\\s+(giorno|giorni|data|ora|orario|mese|settimana|periodo)\\b',
        '\\b(che|quale|quali)\\s+(giorno|giorni|data|date|ora|orario|mese)\\b',
        '\\bquando\\b',
        '\\bchi\\b',
        '\\ba\\s+che\\s+ora\\b',
        '\\b(luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)\\b',
        '\\b(il\\s+tuo|la\\s+tua|i\\s+tuoi|le\\s+tue)\\s+(indirizz\\w*|telefon\\w*|numer\\w*|compleann\\w*|e-?mail|codice\\s+fiscale|iban|password)\\b',
        '\\b(what|which)\\s+(day|date|time)\\b',
        '\\b(when|who)\\b',
      ],
      description: 'fatti che solo l’utente conosce (date, giorni, orari, persone, dati personali)',
    },
    {
      id: 'local',
      effect: 'proceed',
      kinds: ['local'],
      patterns: [
        '\\b(bozz|appunt|riassun|sintes|ricerc|cerc|legg|salv|archivi|rinomin|sposta|organizz|tagg)',
        '\\bnot[ae]\\b',
        '\\b(draft|summar|research|search|read|save|rename|note)',
      ],
      description: 'azioni locali e reversibili (note, bozze, ricerche)',
    },
  ] satisfies DecisionRuleInput[]
).map((r) => DecisionRuleSchema.parse(r));

/** Defaults with user overrides: same id replaces, new ids are added, `disabled` removes. */
export function resolveDecisionRules(
  overrides: DecisionRuleInput[] = [],
  disabled: string[] = [],
): DecisionRule[] {
  const byId = new Map(DEFAULT_DECISION_RULES.map((r) => [r.id, r]));
  for (const o of overrides) {
    const rule = DecisionRuleSchema.parse(o);
    const base = byId.get(rule.id);
    // A short override ({id, effect}) keeps the default kinds and patterns.
    byId.set(
      rule.id,
      base && rule.kinds.length === 0 && rule.patterns.length === 0
        ? { ...base, effect: rule.effect, description: rule.description || base.description }
        : rule,
    );
  }
  for (const id of disabled) byId.delete(id);
  return [...byId.values()];
}

/*
 * Kind of a choice asked without `kind` (research 03 §4: the gate must not pick
 * among options of taste in the user's place). Keyword rules, Italian and
 * English; what they cannot tell goes to the System 1 model.
 */
const VARIANT_WORDS =
  '(bozz[ae]|variant[ei]|version[ei]|propost[ae]|ton[oi]|stil[ei]|taglio|registro|draft|variant|version|tone|style)';
const TASTE_CHOICE: RegExp[] = [
  // "quale bozza / which version", "quale delle due bozze", "which of the drafts"
  new RegExp(`\\b(quale|quali|which)\\s+(\\S+\\s+){0,2}${VARIANT_WORDS}`, 'iu'),
  // "la prima bozza", "the second version", "bozza A", "variante 2"
  new RegExp(`\\b(prima|seconda|terza|quarta|first|second|third)\\s+${VARIANT_WORDS}`, 'iu'),
  new RegExp(`\\b${VARIANT_WORDS}\\s+([a-d]|[1-4])\\b`, 'iu'),
  // "vado con / uso / scegliamo la bozza…", "go with / pick the draft…"
  new RegExp(
    `\\b(vad[oa]|andiamo|us[oa]|usiamo|ten(go|iamo)|scegl\\w*|go\\s+with|pick|choose|use)\\b.{0,40}\\b${VARIANT_WORDS}`,
    'iu',
  ),
].map(unicodeWords);
/** Words that describe a tone or a style: options made of them are matters of taste. */
const TONE_WORDS = unicodeWords(
  /\b(ironic\w*|formal\w*|informal\w*|seri[oa]|scherzos\w*|emozional\w*|emotiv\w*|poetic\w*|dirett[oa]|minimal\w*|elegant\w*|giocos\w*|legger[oa]|cald[oa]|amichevol\w*|professional\w*|narrativ\w*|playful|casual|friendly|funny|witty|warm|bold|sobri[oa]|divertent\w*)\b/iu,
);
/** Options that are lengths of a text ("Breve" / "Estesa"). */
const LENGTH_OPTION = wordRegex(`\\b${LENGTH_WORD}\\b`);
/** Draft or variant mentioned without a clear choice among them. */
const DRAFT_MENTION = wordRegex(`\\b${VARIANT_WORDS}`);

/**
 * Kind of a choice from its words when the agent did not declare one: `taste`
 * for choices among drafts, variants, tones, styles; otherwise undefined.
 */
export function classifyKind(question: string, options: readonly string[]): ActionKind | undefined {
  const text = [question, ...options].join('\n');
  if (TASTE_CHOICE.some((r) => r.test(text))) return 'taste';
  if (options.length >= 2 && options.filter((o) => TONE_WORDS.test(o)).length >= 2) return 'taste';
  if (options.length >= 2 && options.filter((o) => LENGTH_OPTION.test(o)).length >= 2) {
    return 'taste';
  }
  if (options.length >= 2 && options.filter((o) => DRAFT_MENTION.test(o)).length >= 2) {
    return 'taste';
  }
  return undefined;
}

/** The question talks about drafts or variants: too close to taste to pass on keywords alone. */
export function mentionsVariants(question: string, options: readonly string[]): boolean {
  return DRAFT_MENTION.test([question, ...options].join('\n'));
}

export function matchRule(
  rule: DecisionRule,
  input: { kind?: ActionKind | undefined; text: string },
): boolean {
  if (input.kind && rule.kinds.includes(input.kind)) return true;
  // Compiled once, with Unicode word boundaries: `\b` alone misses "lunedì" (AG-02).
  return rule.patterns.some((p) => wordRegex(p).test(input.text));
}

// --- gate --------------------------------------------------------------------

export interface GateRequest {
  /** Agent that wants to decide. */
  agent: string;
  runId?: string | null;
  parentId?: string | null;
  /** The choice, as the agent would ask it to the user. */
  question: string;
  options: string[];
  /** One of `options`. */
  recommended?: string | undefined;
  kind?: ActionKind | undefined;
  /** What the agent is working on (the run goal). */
  context?: string | undefined;
}

export interface GateDecision {
  outcome: 'ask' | 'proceed';
  /** Option chosen when the gate proceeds. */
  choice?: string;
  decidedBy: 'rules' | 'model';
  confidence?: number;
  reason: string;
  rule?: string;
}

/**
 * Inside the gate: `detail` is untrusted provider text, logged and never
 * returned; `model` is what the engine said, for the `decision` event.
 */
type GateDecisionWithDetail = GateDecision & {
  detail?: string;
  model?: {
    mode: 'on' | 'shadow';
    engine: string;
    model?: string | undefined;
    p: number;
    maxP: number;
    state: unknown;
    latencyMs: number;
    /** In shadow: what the engine would have done. */
    wouldProceed?: boolean;
  };
};

/** "Notify now or later?" (use 3 of §5.5, Telegram). */
export interface NotifyRequest {
  /** `done`: work finished; `question`: an agent waits for the user; `error`: work failed. */
  kind: 'done' | 'question' | 'error';
  agent: string;
  runId?: string | null;
  /** A blocking question stops the work until the user answers. */
  blocking?: boolean;
  /** The user wrote on this channel a few minutes ago: they are there. */
  userActive: boolean;
  /** The user wants this kind of notification. */
  enabled: boolean;
  quietHours: { enabled: boolean; from: string; to: string };
  at?: Date;
}

export interface NotifyDecision {
  /** `silent`: now without sound; `later`: when the quiet hours end; `never`: not at all. */
  when: 'now' | 'silent' | 'later' | 'never';
  reason: string;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** True when `at` (local time) falls between `from` and `to`, across midnight too. */
export function inQuietHours(quiet: { from: string; to: string }, at: Date): boolean {
  const now = at.getHours() * 60 + at.getMinutes();
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** Milliseconds from `at` to the end of the quiet hours (0 outside them). */
export function msUntilQuietEnds(quiet: { from: string; to: string }, at: Date): number {
  if (!inQuietHours(quiet, at)) return 0;
  const end = new Date(at);
  end.setHours(Math.floor(minutesOf(quiet.to) / 60), minutesOf(quiet.to) % 60, 0, 0);
  if (end.getTime() <= at.getTime()) end.setDate(end.getDate() + 1);
  return end.getTime() - at.getTime();
}

export interface DecisionGateOptions {
  /** Where decisions and model calls go (only `append` is used: the eval passes a recorder). */
  log: Pick<EventLog, 'append'>;
  rules?: DecisionRule[];
  /** System 1 model for the gray zone; without it, gray-zone choices are asked. */
  port?: DecisionPort | undefined;
  /** Minimum confidence to proceed on the word of the small LLM. Default 0.8. */
  threshold?: number;
  /**
   * Jev proceeds only with p("the user decides") ≤ this (D-067, research 08
   * §4.2: 36/37 on the labelled set, 0 "proceeds when it had to ask"). Default 0.45.
   */
  jevMaxP?: number | (() => number);
  /** Mode of the `gate` use of the instinct (`shadow`: asked and logged, the rules decide). */
  mode?: () => InstinctMode;
}

/** A port answered by Jev itself (not by the LLM after Jev failed). */
function answeredByJev(port: DecisionPort, response: SystemOneResponse): boolean {
  if (port.id === 'jev') return true;
  return port.id.startsWith('jev>') && !response.fallbackFrom?.length;
}

/**
 * "Ask or proceed?" (use 1 of §5.5). Rules first: an "ask" rule always wins,
 * a "proceed" rule lets local reversible work go on with the recommended
 * option. Otherwise the System 1 model decides (P0 of D-067: one condition
 * with its criteria, no `recommended` in the state, options shuffled and asked
 * twice in reverse order); below its threshold, or on any error, the choice
 * goes to the user.
 */
export class DecisionGate {
  readonly #log: Pick<EventLog, 'append'>;
  #rules: DecisionRule[];
  #port: DecisionPort | undefined;
  readonly threshold: number;
  readonly #jevMaxP: () => number;
  readonly #mode: () => InstinctMode;

  constructor(options: DecisionGateOptions) {
    this.#log = options.log;
    this.#rules = options.rules ?? DEFAULT_DECISION_RULES;
    this.#port = options.port;
    this.threshold = options.threshold ?? 0.8;
    const maxP = options.jevMaxP ?? BANDS.gateJevMaxP;
    this.#jevMaxP = typeof maxP === 'function' ? maxP : () => maxP;
    this.#mode = options.mode ?? (() => 'on');
  }

  /** Jev's maximum p("the user decides") to proceed. */
  get jevMaxP(): number {
    return this.#jevMaxP();
  }

  get rules(): readonly DecisionRule[] {
    return this.#rules;
  }

  /** System 1 model of the gray zone (none: gray-zone choices are asked). */
  get port(): DecisionPort | undefined {
    return this.#port;
  }

  /** Changes the System 1 model (engine chosen in the settings, Jev key saved). */
  setPort(port: DecisionPort | undefined): void {
    this.#port = port;
  }

  /** Replaces the rules (the onboarding sets the "always ask" ones). */
  setRules(rules: DecisionRule[]): void {
    this.#rules = rules;
  }

  /**
   * "Notify now or later?" (use 3 of §5.5), rules only: kinds the user turned
   * off are never sent; someone using the channel right now gets everything at
   * once; in the quiet hours a blocking question arrives without sound (the
   * work waits for it) and the rest waits for the morning. Logged as a
   * `decision` like every other choice of the gate.
   */
  notify(request: NotifyRequest): NotifyDecision {
    const decision = ((): NotifyDecision => {
      if (!request.enabled) return { when: 'never', reason: 'notifiche di questo tipo spente' };
      if (request.userActive) return { when: 'now', reason: 'l’utente sta usando il canale' };
      const quiet =
        request.quietHours.enabled && inQuietHours(request.quietHours, request.at ?? new Date());
      if (!quiet) return { when: 'now', reason: 'fuori dalle ore di silenzio' };
      if (request.kind === 'question' && request.blocking) {
        return { when: 'silent', reason: 'ore di silenzio, ma il lavoro aspetta la risposta' };
      }
      return { when: 'later', reason: 'ore di silenzio: arriva al risveglio' };
    })();
    this.#log.append({
      agent: request.agent,
      runId: request.runId ?? null,
      type: 'decision',
      data: {
        kind: 'notify',
        question: `Notifico ora o dopo? (${request.kind})`,
        options: ['now', 'silent', 'later', 'never'],
        choice: decision.when,
        decidedBy: 'rules',
        reason: decision.reason,
      },
    });
    return decision;
  }

  async decide(request: GateRequest, signal?: AbortSignal): Promise<GateDecision> {
    // `detail` (provider text of a failed engine) goes to the log, never to the agent.
    const { detail, model, ...decision } = await this.#decide(request, signal);
    const reason = decision.rule ? `${decision.rule}: ${decision.reason}` : decision.reason;
    this.#log.append({
      agent: request.agent,
      runId: request.runId ?? null,
      parentId: request.parentId ?? null,
      type: 'decision',
      data: {
        kind: 'ask_or_proceed',
        question: request.question,
        options: request.options,
        choice: decision.outcome === 'ask' ? 'ask_user' : (decision.choice ?? ''),
        decidedBy: decision.decidedBy,
        ...(decision.confidence !== undefined ? { confidence: decision.confidence } : {}),
        reason: detail ? `${reason} — ${detail}` : reason,
        ...(model
          ? {
              use: 'gate' as const,
              mode: model.mode,
              engine: model.engine,
              ...(model.model ? { model: model.model } : {}),
              value: model.p,
              band: model.p <= model.maxP ? ('low' as const) : ('high' as const),
              state: model.state,
              latencyMs: model.latencyMs,
              ...(model.wouldProceed !== undefined
                ? { action: model.wouldProceed ? 'would_proceed' : 'would_ask' }
                : {}),
            }
          : {}),
      },
    });
    return decision;
  }

  async #decide(request: GateRequest, signal?: AbortSignal): Promise<GateDecisionWithDetail> {
    if (request.options.length === 0) {
      // Nothing to pick: only the user knows the answer.
      return { outcome: 'ask', decidedBy: 'rules', reason: 'domanda aperta: risponde l’utente' };
    }
    const text = [request.question, ...request.options].join('\n');
    // A kind declared "local" or "other" is the agent's word, not a fact: the words
    // of the choice still count (a choice among drafts is taste whatever it says).
    const weakKind =
      request.kind === undefined || request.kind === 'local' || request.kind === 'other';
    const inferred = weakKind ? classifyKind(request.question, request.options) : undefined;
    const input = { kind: inferred ?? request.kind, text };
    const ask = this.#rules.find((r) => r.effect === 'ask' && matchRule(r, input));
    if (ask) {
      return {
        outcome: 'ask',
        decidedBy: 'rules',
        reason: `chiedere sempre: ${ask.description || ask.id}${inferred ? ` (tipo dedotto: ${inferred})` : ''}`,
        rule: ask.id,
      };
    }
    // Without a declared kind, drafts and variants are not "local" on keywords alone:
    // the System 1 model tells taste from housekeeping.
    const undeclaredVariants =
      !request.kind && !inferred && mentionsVariants(request.question, request.options);
    // Going on alone needs the rules' own words: "local" (or "other") declared by
    // the agent is not enough, it may be wrong (the demo: "In che giorno facciamo
    // la cena?" marked local). Other declared kinds only make the agent ask more,
    // or meet a preference of the user (`{ id: 'taste', effect: 'proceed' }`).
    const proceedInput = weakKind ? { kind: inferred, text } : input;
    const proceed = undeclaredVariants
      ? undefined
      : this.#rules.find((r) => r.effect === 'proceed' && matchRule(r, proceedInput));
    if (proceed && request.recommended !== undefined) {
      return {
        outcome: 'proceed',
        choice: request.recommended,
        decidedBy: 'rules',
        reason: `si procede: ${proceed.description || proceed.id}`,
        rule: proceed.id,
      };
    }
    if (!this.#port) {
      return { outcome: 'ask', decidedBy: 'rules', reason: 'zona grigia senza modello: si chiede' };
    }
    try {
      return await this.#askModel(request, signal, undeclaredVariants);
    } catch (err) {
      if (err instanceof DecisionPortError) this.#logUsage(request, err.usage);
      if (signal?.aborted) throw err;
      // Only the code reaches the agent: the error text may come from the provider.
      return {
        outcome: 'ask',
        decidedBy: 'rules',
        reason: `il modello non ha risposto (${decisionErrorCode(err)}): si chiede`,
        detail: errorMessage(err),
      };
    }
  }

  /** Model calls of the System 1 are `provider_usage` events like the agents' ones. */
  #logUsage(request: GateRequest, usage: NonNullable<SystemOneResponse['usage']>): void {
    for (const u of usage) {
      this.#log.append({
        agent: request.agent,
        runId: request.runId ?? null,
        parentId: request.parentId ?? null,
        type: 'provider_usage',
        data: u,
      });
    }
  }

  async #askModel(
    request: GateRequest,
    signal: AbortSignal | undefined,
    /** Drafts or variants without a declared kind: the model also says what kind of choice it is. */
    classify: boolean,
  ): Promise<GateDecisionWithDetail> {
    const port = this.#port!;
    const mode = this.#mode();
    const { request: built } = gateRequest({
      goal: request.context ?? null,
      question: request.question,
      options: request.options,
      seed: request.parentId ?? request.runId ?? request.agent,
      classify,
    });
    // The option asked in reverse order is there for Jev's first-option bias, and
    // counts only when the gate has to pick the option itself (no recommendation).
    const jevFirst = port.id === 'jev' || port.id.startsWith('jev>');
    const questions =
      jevFirst && request.recommended === undefined
        ? built.questions
        : built.questions.filter((q) => q.id !== 'option_rev');
    const started = Date.now();
    const response = await port.decide({ state: built.state, questions }, signal);
    this.#logUsage(request, response.usage ?? []);
    const answers = validateSystemOne({ state: '', questions }, response);
    const byJev = answeredByJev(port, response);
    const decision = this.#fromAnswers(request, answers, byJev);
    const p = answers.get('needs_user')!.value as number;
    const maxP = byJev ? this.jevMaxP : 1 - this.threshold;
    const model: NonNullable<GateDecisionWithDetail['model']> = {
      mode: mode === 'shadow' ? 'shadow' : 'on',
      engine: byJev ? 'jev' : response.fallbackFrom?.length ? 'llm' : port.id,
      model: response.model,
      p,
      maxP,
      state: built.state,
      latencyMs: Date.now() - started,
    };
    // In shadow the engine's answer is only logged: the gray zone is asked, as without it.
    const out: GateDecisionWithDetail =
      mode === 'shadow'
        ? {
            outcome: 'ask',
            decidedBy: 'rules',
            reason: 'zona grigia: si chiede (istinto in prova)',
            model: { ...model, wouldProceed: decision.outcome === 'proceed' },
          }
        : { ...decision, model };
    // The first engine failed (Jev without credit, timeout…) and the next one answered:
    // the agent reads only the codes, the provider's words go to the log.
    if (!response.fallbackFrom?.length) return out;
    const codes = safeFailureCodes(response.fallbackFrom);
    const detail = response.fallbackDetail?.join('; ');
    return {
      ...out,
      reason: `${out.reason} (ripiego: ${codes})`,
      ...(detail ? { detail } : {}),
    };
  }

  #fromAnswers(
    request: GateRequest,
    answers: Map<string, SystemOneAnswer>,
    byJev: boolean,
  ): GateDecision {
    const askKinds = new Set(this.#rules.filter((r) => r.effect === 'ask').flatMap((r) => r.kinds));
    const kind = answers.get('kind')?.value as ActionKind | undefined;
    if (kind && askKinds.has(kind)) {
      // A kind the user always decides: the rules apply as if it had been declared.
      return {
        outcome: 'ask',
        decidedBy: 'model',
        confidence: answers.get('kind')!.confidence,
        reason: `il modello la classifica come ${kind}`,
      };
    }
    const needsUser = answers.get('needs_user')!;
    const pYes = needsUser.value as number;
    if (byJev) return this.#fromJev(request, answers, pYes);
    const confidence = Math.min(needsUser.confidence, 1 - pYes);
    if (pYes >= 0.5 || confidence < this.threshold) {
      return {
        outcome: 'ask',
        decidedBy: 'model',
        confidence,
        reason:
          pYes >= 0.5
            ? 'il modello ritiene che serva l’utente'
            : `confidenza ${confidence.toFixed(2)} sotto la soglia ${this.threshold}`,
      };
    }
    let choice = request.recommended;
    let choiceConfidence = confidence;
    if (choice === undefined) {
      const option = answers.get('option');
      if (!option || option.confidence < this.threshold) {
        return {
          outcome: 'ask',
          decidedBy: 'model',
          confidence: option?.confidence ?? 0,
          reason: 'nessuna opzione consigliata e il modello non è abbastanza sicuro',
        };
      }
      choice = option.value as string;
      choiceConfidence = Math.min(confidence, option.confidence);
    }
    return {
      outcome: 'proceed',
      choice,
      decidedBy: 'model',
      confidence: choiceConfidence,
      reason: 'scelta reversibile, il modello è sicuro',
    };
  }

  /**
   * Jev's own threshold on p (D-067): it proceeds only with p ≤ maxP, with the
   * recommended option, or without one when the option asked in both orders is
   * the same (otherwise the order moved the answer: the user chooses).
   */
  #fromJev(request: GateRequest, answers: Map<string, SystemOneAnswer>, p: number): GateDecision {
    const maxP = this.jevMaxP;
    const confidence = Math.round((1 - p) * 1000) / 1000;
    if (p > maxP) {
      return {
        outcome: 'ask',
        decidedBy: 'model',
        confidence,
        reason:
          p >= 0.5
            ? 'il modello ritiene che serva l’utente'
            : `p ${p.toFixed(2)} sopra la soglia di Jev ${maxP}`,
      };
    }
    if (request.recommended !== undefined) {
      return {
        outcome: 'proceed',
        choice: request.recommended,
        decidedBy: 'model',
        confidence,
        reason: 'scelta reversibile, il modello è sicuro',
      };
    }
    const option = answers.get('option');
    const reversed = answers.get('option_rev');
    if (!option || (reversed && reversed.value !== option.value)) {
      return {
        outcome: 'ask',
        decidedBy: 'model',
        confidence: option?.confidence ?? 0,
        reason: 'nessuna opzione consigliata e il modello cambia scelta con l’ordine delle opzioni',
      };
    }
    return {
      outcome: 'proceed',
      choice: option.value as string,
      decidedBy: 'model',
      confidence: Math.min(confidence, option.confidence),
      reason: 'scelta reversibile, il modello sceglie la stessa opzione in entrambi gli ordini',
    };
  }
}
