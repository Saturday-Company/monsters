import { z } from 'zod';
import { formatNumber } from './i18n.ts';
import { spendStrings } from './spend.strings.ts';

/*
 * Tetto di spesa (D-070, research 07 §5.5): euros the monsters may spend per
 * day and per month, for the whole team and for one monster, counted from the
 * cost the providers report (`provider_usage.costUsd`). At 80% a warning (in
 * the app, and on Telegram if configured); at 100% the work that costs money
 * stops cleanly, with a sentence and "Alza il tetto". Subscriptions and free
 * models never count: they are shown apart.
 *
 *   GET /api/settings/spend   → SpendView
 *   PUT /api/settings/spend   SpendUpdate → SpendView
 *
 * Errors: 404 `unknown_agent` (a cap for a monster that is not in the team).
 */

/**
 * Dollars → euros. A fixed rate, documented and editable in the settings
 * (`spend.usdToEur`): the providers bill in dollars, the cap is in euros, and a
 * cap that moves with the market every day would be harder to read than a cap
 * a few cents off. ECB reference rate rounded, October 2026.
 */
export const USD_TO_EUR_DEFAULT = 0.86;
/** Warning threshold: 80% of a cap. */
export const SPEND_WARN_AT = 0.8;
/**
 * Default caps (D-070): 10 € a day and 100 € a month for the team, none per
 * monster. With the defaults (`freeOnly`, free models) the team spends 0 €;
 * with a paid key one run stops at 0,50 $ (D-064), so 10 € a day is more than
 * twenty runs at their own limit and a few hundred typical ones.
 */
export const SPEND_DEFAULT_DAILY_EUR = 10;
export const SPEND_DEFAULT_MONTHLY_EUR = 100;

/** A cap in euros; `null` = no cap. */
export const SpendCapEurSchema = z.number().min(0.5).max(100_000).nullable();

export const SpendAgentCapsSchema = z.object({
  dailyEur: SpendCapEurSchema.optional(),
  monthlyEur: SpendCapEurSchema.optional(),
});
export type SpendAgentCaps = z.infer<typeof SpendAgentCapsSchema>;

export const SpendUpdateSchema = z
  .object({
    dailyEur: SpendCapEurSchema.optional(),
    monthlyEur: SpendCapEurSchema.optional(),
    usdToEur: z.number().min(0.1).max(10).optional(),
    /** Caps of single monsters; `null` removes the monster's own caps. */
    agents: z.record(z.string(), SpendAgentCapsSchema.nullable()).optional(),
  })
  .refine((u) => Object.values(u).some((v) => v !== undefined), 'nothing to change');
export type SpendUpdate = z.infer<typeof SpendUpdateSchema>;

export const SpendPeriodSchema = z.enum(['day', 'month']);
export type SpendPeriod = z.infer<typeof SpendPeriodSchema>;

export const SpendMeterViewSchema = z.object({
  spentEur: z.number().nonnegative(),
  capEur: z.number().nullable(),
  /** spent / cap (null without a cap). */
  ratio: z.number().nullable(),
});
export type SpendMeterView = z.infer<typeof SpendMeterViewSchema>;

export const SpendStatusSchema = z.enum(['ok', 'warning', 'stopped']);
export type SpendStatus = z.infer<typeof SpendStatusSchema>;

export const SpendViewSchema = z.object({
  usdToEur: z.number(),
  warnAt: z.number(),
  /** Start of today and of this month (local time of the computer), ms. */
  dayFrom: z.number(),
  monthFrom: z.number(),
  day: SpendMeterViewSchema,
  month: SpendMeterViewSchema,
  status: SpendStatusSchema,
  agents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      /** Its models cost money (a key with paid models, not a subscription nor free models). */
      paid: z.boolean(),
      /** Its own caps, when set (otherwise only the team's hold). */
      caps: SpendAgentCapsSchema,
      day: SpendMeterViewSchema,
      month: SpendMeterViewSchema,
      status: SpendStatusSchema,
      /**
       * Providers of its chain whose models have no price (D-114): what it
       * spends there is not counted and the caps do not stop it.
       */
      unpriced: z.array(z.string()).optional(),
      /** Providers of its chain priced by OpenRouter's list: counted at an estimated cost. */
      estimated: z.array(z.string()).optional(),
    }),
  ),
  /** The projects (D-097, third level): their own caps and what their monsters spent. */
  projects: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        caps: SpendAgentCapsSchema,
        day: SpendMeterViewSchema,
        month: SpendMeterViewSchema,
        status: SpendStatusSchema,
      }),
    )
    .optional(),
  /** Not counted in the caps, this month: free models (requests). */
  free: z.object({ requests: z.number().int().nonnegative() }),
  /** Not counted in the caps, this month: subscriptions (requests and tokens). */
  subscriptions: z.array(
    z.object({
      provider: z.string(),
      label: z.string(),
      requests: z.number().int().nonnegative(),
      tokens: z.number().int().nonnegative(),
    }),
  ),
  /**
   * Paid models whose cost is unknown: the provider reports none and its model
   * list has no price (an Anthropic or OpenAI key). Their tokens are shown,
   * not counted; the caps do not stop them (D-114). Listed as soon as a
   * monster's chain uses them, before the first request.
   */
  unpriced: z.array(
    z.object({
      provider: z.string(),
      label: z.string(),
      requests: z.number().int().nonnegative(),
      tokens: z.number().int().nonnegative(),
    }),
  ),
  /**
   * Direct keys (Anthropic, OpenAI, Google) whose models are priced by OpenRouter's public
   * list: their cost is estimated from the tokens, counted, and the caps stop them (D-114).
   */
  estimated: z.array(z.object({ provider: z.string(), label: z.string() })).optional(),
});
export type SpendView = z.infer<typeof SpendViewSchema>;

/** A cap reached 80% (`warning`) or 100% (`stopped`): event `spend`. */
export const SpendDataSchema = z.object({
  action: z.enum(['warning', 'stopped']),
  /** `team`, `project:<id>` (D-097), or the id of the monster with its own cap. */
  scope: z.string(),
  period: SpendPeriodSchema,
  spentEur: z.number().nonnegative(),
  capEur: z.number().nonnegative(),
  /** The monster whose work was stopped, when there is one. */
  subject: z.string().optional(),
  message: z.string(),
});
export type SpendData = z.infer<typeof SpendDataSchema>;

/** "€10", "€0.43", "€12,500" (Italian: "10 €", "0,43 €", "12.500 €"). */
export function formatEur(eur: number): string {
  const digits = eur > 0 && eur < 10 && !Number.isInteger(eur) ? 2 : 0;
  const n = formatNumber(eur, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return spendStrings().eur(n);
}

/** "for today", "for this month" (Italian: "di oggi", "di questo mese"): follows the language when read. */
export const SPEND_PERIOD_WORDS: Record<SpendPeriod, string> = {
  get day() {
    return spendStrings().periodDay;
  },
  get month() {
    return spendStrings().periodMonth;
  },
};

/** The sentence of a `spend` event, for the log, the app and Telegram. */
export function spendSentence(d: {
  action: 'warning' | 'stopped';
  scopeName: string | null;
  period: SpendPeriod;
  spentEur: number;
  capEur: number;
}): string {
  const t = spendStrings();
  const whose = d.scopeName ? t.whose(d.scopeName) : t.squad;
  const cap = t.capOf(whose, SPEND_PERIOD_WORDS[d.period], formatEur(d.capEur));
  return d.action === 'warning'
    ? t.warning(formatEur(d.spentEur), Math.round((d.spentEur / d.capEur) * 100), cap)
    : t.stopped(cap);
}
