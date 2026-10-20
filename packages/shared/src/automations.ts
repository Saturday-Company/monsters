import { z } from 'zod';
import { AgentIdSchema } from './ids.ts';

/*
 * Automations (plan of 17/10 §3 B3, D-094): work that a capo squadra does on
 * a schedule. The definition is a file in the data folder
 * (`automations/<id>.yaml`); every run ("giro") is in the event log. Kept
 * apart from `api.ts` so the event schemas can use these without a cycle.
 *
 *   GET    /api/automations                    → AutomationView[]
 *   POST   /api/automations                    AutomationCreate → AutomationView (201)
 *   GET    /api/automations/:id                → AutomationView
 *   PATCH  /api/automations/:id                AutomationUpdate → AutomationView
 *   DELETE /api/automations/:id                → { ok: true }
 *   POST   /api/automations/:id/pause          → AutomationView
 *   POST   /api/automations/:id/resume         → AutomationView
 *   POST   /api/automations/:id/run            → AutomationRunNowResponse (202)
 *   GET    /api/automations/:id/runs           → AutomationRunSummary[] (newest first)
 *   GET    /api/automations/:id/runs/:runId    → AutomationRunDetail
 *
 * Errors: 404 `unknown_automation`, `unknown_run`; 400 `invalid_request`,
 * `invalid_schedule`, `unknown_agent`; 409 `halted`, `already_running`, `draft`.
 */

/** Id of an automation: a slug of its name when it was created (it stays across renames). */
export const AutomationIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'automation id must be a lowercase slug (a-z, 0-9 and -)');

/**
 * `draft`: proposed (by a monster, `automation_propose`, or saved by the user
 * to finish later), never runs until confirmed; `active`: runs on its
 * schedule; `paused`: kept, never runs on its own ("Esegui ora" still works).
 */
export const AutomationStatusSchema = z.enum(['draft', 'active', 'paused']);
export type AutomationStatus = z.infer<typeof AutomationStatusSchema>;

/** True when `tz` is an IANA time zone this runtime knows (`Europe/Rome`). */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The time zone of this computer (the user's, for the core that runs on it). */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * When: a cron expression of five fields (minute hour day-of-month month
 * day-of-week; Sunday 0 or 7) in an IANA time zone. The core checks the
 * expression with its cron library; here only the shape.
 */
export const AutomationScheduleSchema = z.object({
  cron: z
    .string()
    .trim()
    .min(9)
    .max(120)
    .refine((c) => c.split(/\s+/).length === 5, 'cron needs five fields: m h dom mon dow'),
  timezone: z.string().min(1).max(64).refine(isTimeZone, 'unknown time zone'),
});
export type AutomationSchedule = z.infer<typeof AutomationScheduleSchema>;

/**
 * Limits of one run. `maxSteps` and `maxTotalTokens` count on every model
 * (subscriptions too); `maxEur` only on the models paid per use: a run on a
 * subscription (Claude, ChatGPT through a harness) costs nothing per call.
 * Unset → the limits of every run (`settings.json`, `limits`).
 */
export const AutomationLimitsSchema = z.object({
  maxSteps: z.number().int().min(1).max(2000).optional(),
  maxTotalTokens: z.number().int().min(1000).max(50_000_000).optional(),
  maxEur: z.number().min(0.01).max(1000).optional(),
});
export type AutomationLimits = z.infer<typeof AutomationLimitsSchema>;

export const AutomationNotifySchema = z.object({
  /** An `automation_run_finished` the app shows as a notice. */
  app: z.boolean().default(true),
  /** A message on Telegram (when the bot is set up). */
  telegram: z.boolean().default(false),
});
export type AutomationNotify = z.infer<typeof AutomationNotifySchema>;

/** A folder of the vault, relative, without `..` (where the results go). */
export const VaultFolderSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !p.startsWith('\\') &&
      !/^[A-Za-z]:/.test(p) &&
      !p.split(/[\\/]/).some((s) => s === '..' || s === '.'),
    'a folder of the vault, relative, without ..',
  );

/** Fields the user (or a monster's proposal) writes. */
const AutomationFields = {
  name: z.string().trim().min(1).max(80),
  /** The capo squadra who receives the objective: the orchestrator, a project's lead or any monster. */
  lead: AgentIdSchema,
  /**
   * The project the automation belongs to (D-097): its lead receives the
   * objective when `lead` is not given, and the participants are its monsters.
   */
  project: z.string().min(1).max(64).optional(),
  /** Monsters that take part: named to the capo in the objective (it delegates to them). */
  participants: z.array(AgentIdSchema).max(20).default([]),
  schedule: AutomationScheduleSchema,
  /** What the capo receives at every run. */
  objective: z.string().trim().min(1).max(8000),
  /** Folder of the vault where the results go (told to the capo). */
  resultsFolder: VaultFolderSchema.optional(),
  limits: AutomationLimitsSchema.default({}),
  notify: AutomationNotifySchema.default({ app: true, telegram: false }),
};

/** The file `automations/<id>.yaml`. */
export const AutomationSchema = z.object({
  id: AutomationIdSchema,
  ...AutomationFields,
  status: AutomationStatusSchema,
  /** Who wrote it: the user, or the monster that proposed it. */
  createdBy: z.string().min(1).max(64).default('user'),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /**
   * When it last became `active` (created, confirmed, resumed): the slots
   * before this are not "missed" at the next start.
   */
  activeSince: z.number().int().nonnegative().optional(),
  /**
   * The objective is a monster's text (`automation_propose`, a project's
   * proposal), not rewritten by the user since (D-103): a giro never takes it
   * for the user's own words, and starts tainted when the run that proposed it
   * had read third-party text. Gone once the user changes the objective.
   */
  objectiveFrom: z
    .object({
      agent: z.string().min(1).max(64),
      tainted: z.literal(true).optional(),
      source: z.string().max(200).optional(),
    })
    .optional(),
});
export type Automation = z.infer<typeof AutomationSchema>;

export const AutomationCreateSchema = z.object({
  ...AutomationFields,
  /** Default: the lead of `project`, or the orchestrator (D-097). */
  lead: AgentIdSchema.optional(),
  schedule: AutomationScheduleSchema.partial({ timezone: true }),
  /** Default `active`; `draft` waits for a confirmation (a PATCH to `active`). */
  status: AutomationStatusSchema.default('active'),
});
export type AutomationCreate = z.input<typeof AutomationCreateSchema>;

export const AutomationUpdateSchema = z
  .object({
    name: AutomationFields.name,
    lead: AutomationFields.lead,
    project: AutomationFields.project.nullable(),
    participants: z.array(AgentIdSchema).max(20),
    schedule: AutomationScheduleSchema.partial({ timezone: true }),
    objective: AutomationFields.objective,
    resultsFolder: VaultFolderSchema.nullable(),
    limits: AutomationLimitsSchema,
    notify: AutomationNotifySchema.partial(),
    status: AutomationStatusSchema,
  })
  .partial()
  .refine((u) => Object.values(u).some((v) => v !== undefined), 'nothing to change');
export type AutomationUpdate = z.input<typeof AutomationUpdateSchema>;

/** What started a run: its slot, a slot missed while the core was off, "Esegui ora", an answer. */
export const AutomationTriggerSchema = z.enum(['schedule', 'catchup', 'manual', 'answer']);
export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>;

/** How a run ended. `waiting_user` is not the end: an answer goes on with it. */
export const AutomationRunEndSchema = z.enum(['completed', 'failed', 'aborted', 'waiting_user']);

/**
 * Why a slot did not run: `busy` the capo was working on something else for
 * too long, `halted` Monsters was stopped, `running` the previous
 * run had not ended, `waiting_user` it still waits for an answer, `no_lead`
 * the capo is not in the team, `no_provider` it has no model, `missed` the
 * computer was off past half the interval, `error`.
 */
export const AutomationSkipReasonSchema = z.enum([
  'busy',
  'halted',
  'running',
  'waiting_user',
  'no_lead',
  'no_provider',
  'missed',
  'error',
]);
export type AutomationSkipReason = z.infer<typeof AutomationSkipReasonSchema>;

/**
 * State of a run in the menu: `waiting_lead` it waits for the capo to finish
 * its current work, `running`, `waiting_user` ("aspetta una risposta"),
 * the end states, or `skipped`.
 */
export const AutomationRunStateSchema = z.enum([
  'waiting_lead',
  'running',
  'waiting_user',
  'completed',
  'failed',
  'aborted',
  'skipped',
]);
export type AutomationRunState = z.infer<typeof AutomationRunStateSchema>;

/** One run of an automation (one or more runs of the core: an answer continues it). */
export const AutomationRunSummarySchema = z.object({
  /** The first run's id (for a skipped slot: the id of its event). */
  id: z.string(),
  automationId: AutomationIdSchema,
  state: AutomationRunStateSchema,
  trigger: AutomationTriggerSchema,
  /** The slot it was for (absent for "Esegui ora"). */
  slot: z.number().optional(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  /** The runs of the core it took, oldest first. */
  runIds: z.array(z.string()),
  error: z.string().optional(),
  /** Why it did not run (`skipped`). */
  reason: AutomationSkipReasonSchema.optional(),
  message: z.string().optional(),
  /** What the providers reported (paid models; 0 on subscriptions and free models). */
  costUsd: z.number().nonnegative().default(0),
  steps: z.number().int().nonnegative().default(0),
  tokens: z.number().int().nonnegative().default(0),
});
export type AutomationRunSummary = z.infer<typeof AutomationRunSummarySchema>;

export const AutomationRunMessageSchema = z.object({
  id: z.string(),
  ts: z.number(),
  runId: z.string(),
  /** `user` for the objective and the answers, else the monster. */
  agent: z.string(),
  role: z.enum(['user', 'agent']),
  text: z.string(),
  /** A message of a delegated monster (inside a delegation). */
  delegated: z.boolean().optional(),
});

export const AutomationRunDetailSchema = z.object({
  run: AutomationRunSummarySchema,
  messages: z.array(AutomationRunMessageSchema),
  /** The capo's last answer. */
  finalAnswer: z.string().optional(),
  /** Notes created or changed in the run (paths of the vault). */
  notes: z.array(z.string()),
  /** Files made in the run (`File/`). */
  files: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Questions still waiting for the user. */
  questions: z.array(z.object({ id: z.string(), question: z.string() })),
});
export type AutomationRunDetail = z.infer<typeof AutomationRunDetailSchema>;

export const AutomationViewSchema = AutomationSchema.extend({
  /** The schedule in Italian ("ogni domenica alle 23:00"), or the cron expression. */
  scheduleText: z.string(),
  /** Next slot (epoch ms), null when it does not run on its own (draft, paused). */
  nextRunAt: z.number().nullable(),
  /** The run in progress, if any. */
  current: AutomationRunSummarySchema.nullable(),
  last: AutomationRunSummarySchema.nullable(),
});
export type AutomationView = z.infer<typeof AutomationViewSchema>;

export const AutomationRunNowResponseSchema = z.object({
  /** `running`: started; `waiting_lead`: it starts as soon as the capo is free. */
  state: z.enum(['running', 'waiting_lead']),
  runId: z.string().optional(),
});
export type AutomationRunNowResponse = z.infer<typeof AutomationRunNowResponseSchema>;

// --- the schedule in Italian ------------------------------------------------------------------

const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MONTHS = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
];

const isInt = (s: string) => /^\d{1,2}$/.test(s);

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1)!}`;
}

/** "alle 23:00", "all'1:30", "a mezzanotte". */
function at(h: number, m: number): string {
  if (h === 0 && m === 0) return 'a mezzanotte';
  const time = `${h}:${String(m).padStart(2, '0')}`;
  return h === 1 ? `all'${time}` : `alle ${time}`;
}

/** Hours and minute of a daily pattern ("8", "8,20"); null when it is something else. */
function times(min: string, hour: string): string | null {
  if (!isInt(min) || !/^\d{1,2}(,\d{1,2})*$/.test(hour)) return null;
  const m = Number(min);
  const hours = hour.split(',').map(Number);
  if (m > 59 || hours.some((h) => h > 23)) return null;
  return list(hours.map((h) => at(h, m)));
}

function weekday(d: string): number | null {
  if (!/^\d$/.test(d)) return null;
  const n = Number(d);
  return n <= 7 ? n % 7 : null;
}

/** "ogni lunedì", "ogni lunedì e venerdì", "dal lunedì al venerdì"; null when not plain. */
function weekdays(dow: string): string | null {
  const range = /^(\d)-(\d)$/.exec(dow);
  if (range) {
    const a = weekday(range[1]!);
    const b = weekday(range[2]!);
    if (a === null || b === null) return null;
    if (dow === '0-6' || dow === '1-7') return 'ogni giorno';
    return `${a === 0 ? 'dalla' : 'dal'} ${WEEKDAYS[a]!} ${b === 0 ? 'alla' : 'al'} ${WEEKDAYS[b]!}`;
  }
  const days = dow.split(',').map(weekday);
  if (days.some((d) => d === null)) return null;
  const unique = [...new Set(days as number[])];
  // Monday first, Sunday last: the Italian week.
  unique.sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7));
  return `ogni ${list(unique.map((d) => WEEKDAYS[d]!))}`;
}

function dayOfMonth(d: string): string {
  return d === '1' ? '1°' : d;
}

/**
 * The schedule in Italian for the common patterns ("ogni domenica alle 23:00",
 * "ogni giorno alle 8:00", "il 1° di ogni mese alle 9:00", "ogni 15 minuti");
 * otherwise the cron expression as it is. With `timezone` different from
 * `userTimezone`, the zone is said in brackets.
 */
export function describeSchedule(
  cron: string,
  options: { timezone?: string; userTimezone?: string } = {},
): string {
  const text = describeCron(cron);
  const tz = options.timezone;
  if (tz && options.userTimezone && tz !== options.userTimezone) return `${text} (ora di ${tz})`;
  return text;
}

function describeCron(cron: string): string {
  const raw = cron.trim();
  const fields = raw.split(/\s+/);
  const fallback = `cron: ${raw}`;
  if (fields.length !== 5) return fallback;
  const [min, hour, dom, mon, dow] = fields as [string, string, string, string, string];
  const everyMinutes = /^\*\/(\d{1,2})$/.exec(min);
  if (everyMinutes && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = Number(everyMinutes[1]);
    return n === 1 ? 'ogni minuto' : `ogni ${n} minuti`;
  }
  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*')
    return 'ogni minuto';
  if (isInt(min) && Number(min) <= 59 && dom === '*' && mon === '*' && dow === '*') {
    const m = Number(min);
    const suffix = m === 0 ? '' : ` al minuto ${m}`;
    if (hour === '*') return `ogni ora${suffix}`;
    const everyHours = /^\*\/(\d{1,2})$/.exec(hour);
    if (everyHours) {
      const n = Number(everyHours[1]);
      return n === 1 ? `ogni ora${suffix}` : `ogni ${n} ore${suffix}`;
    }
  }
  const when = times(min, hour);
  if (!when) return fallback;
  if (dom === '*' && mon === '*') {
    if (dow === '*') return `ogni giorno ${when}`;
    const days = weekdays(dow);
    return days ? `${days} ${when}` : fallback;
  }
  if (dow !== '*' || !/^\d{1,2}$/.test(dom) || Number(dom) < 1 || Number(dom) > 31) {
    return fallback;
  }
  if (mon === '*') return `il ${dayOfMonth(dom)} di ogni mese ${when}`;
  if (isInt(mon) && Number(mon) >= 1 && Number(mon) <= 12) {
    return `ogni anno il ${dayOfMonth(dom)} ${MONTHS[Number(mon) - 1]!} ${when}`;
  }
  return fallback;
}
