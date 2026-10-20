import { z } from 'zod';

/*
 * Archive of the event log: the bulky events older than `days` (90 by default) move out of the
 * database into one compressed file per month, `MONSTERS_HOME/archive/events-YYYY-MM.jsonl.gz`
 * (one event per line, as `GET /api/events` gives it; the month is the UTC month of `ts`).
 * What the core rebuilds at start, the spending of this month and the previous one, the user's
 * words, the final answers, questions, decisions, drafts and the security events never move.
 *
 *   GET  /api/log/archive   → LogArchiveStatus
 *   POST /api/log/archive   LogArchiveRequest → LogArchiveResult (`monsters log archive`)
 */

/** Days an event stays in the log before it may move to the archive. */
export const LOG_ARCHIVE_DEFAULT_DAYS = 90;
/** Fewest days allowed: below this the spending of the previous month would be at stake. */
export const LOG_ARCHIVE_MIN_DAYS = 30;

/** `YYYY-MM` of an archive file. */
export const ArchiveMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mese AAAA-MM');

export const LogArchiveStatusSchema = z.object({
  /** The automatic pass (at most once a day) is on. */
  enabled: z.boolean(),
  days: z.number().int().positive(),
  /** Folder of the monthly files. */
  dir: z.string(),
  /** End of the latest pass that worked, or null. */
  lastRunAt: z.number().int().nullable(),
  /** Why the latest pass failed, when it did (nothing was removed from the log). */
  lastError: z.string().nullable(),
  /** Why the latest VACUUM failed, until one works (the archive itself was done). */
  vacuumError: z.string().optional(),
  /** The monthly files, oldest first. */
  months: z.array(z.object({ month: ArchiveMonthSchema, bytes: z.number().int().nonnegative() })),
});
export type LogArchiveStatus = z.infer<typeof LogArchiveStatusSchema>;

export const LogArchiveRequestSchema = z.object({
  /** Only count what would move. */
  dryRun: z.boolean().optional(),
  /** Give the freed space back to the disk afterwards (VACUUM; skipped while a monster works). */
  vacuum: z.boolean().optional(),
});
export type LogArchiveRequest = z.infer<typeof LogArchiveRequestSchema>;

export const LogArchiveMonthResultSchema = z.object({
  month: ArchiveMonthSchema,
  /** Events moved out of the log into the file of the month. */
  events: z.number().int().nonnegative(),
  /** Bytes of their `data` in the log. */
  bytes: z.number().int().nonnegative(),
});

export const LogArchiveResultSchema = z.object({
  dryRun: z.boolean(),
  /** Events older than this (epoch ms) were looked at. */
  before: z.number().int(),
  events: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  months: z.array(LogArchiveMonthResultSchema),
  /** By type: events and bytes of `data` moved (or that would move). */
  types: z.record(
    z.string(),
    z.object({ events: z.number().int().nonnegative(), bytes: z.number().int().nonnegative() }),
  ),
  /**
   * `done`, `skipped` (a monster was working, little to give back, asked with the terminal's
   * token, or waiting after a failure), `failed` (the archive is done all the same; said once
   * in the log); absent when not asked.
   */
  vacuum: z.enum(['done', 'skipped', 'failed']).optional(),
  /** Copy of the database made before the first archive ever (kept until a later one works). */
  backup: z.string().optional(),
});
export type LogArchiveResult = z.infer<typeof LogArchiveResultSchema>;
