import { createHash } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  type ReadStream,
} from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import {
  LOG_ARCHIVE_DEFAULT_DAYS,
  type Channel,
  type LogArchiveResult,
  type LogArchiveStatus,
  type LogEvent,
} from '@monsters/shared';
import { chmodSafe, DIR_MODE, FILE_MODE } from '../config.ts';
import type { Db } from '../db/sqlite.ts';
import type { StateStore } from '../db/state-store.ts';
import { readsThirdParty } from '../team/compaction.ts';
import type { EventLog } from './event-log.ts';
import { coreStrings } from '../core.strings.ts';

/*
 * Archive of the event log (approved by the maintainer on 19/10). The log is append-only and grows
 * without limit; most of its weight is in a few kinds of events nobody reads back once they
 * are old: the usage of each model request, the results of the tools, the text streamed while
 * a monster writes, the tool calls, the inner messages of the giri of an automation that are
 * over. Past `days` (90) they move to one gzip file per month (UTC month of `ts`),
 * `MONSTERS_HOME/archive/events-YYYY-MM.jsonl.gz`, one event per line as the API gives it.
 *
 * Never moved, whatever their age: kill and resume, the start and end of runs, the user's
 * messages and the final answers, questions and answers, decisions, drafts and their outcome,
 * the security events, the summaries of the conversations, the automations' own events (their
 * run index and `#rebuild`), the projects', the spending caps' and every event of a type not
 * listed in `ARCHIVED_TYPES`. Among the listed ones, the tool calls that read third-party text
 * stay too: before D-103 they were the only mark that a run was tainted (`runsTainted`).
 * The cut is never later than the start of the previous month (local time, like the spending
 * meter): the spending of this month and the previous one is always counted in full.
 *
 * Order of a month, so a pass cut anywhere loses nothing:
 *   1. the month's file is written whole to `<file>.tmp` (the old file's events, then the new
 *      ones), flushed to disk, read back and compared (count and SHA-256 of the lines);
 *   2. renamed over the old file, and the folder flushed;
 *   3. only then the events are deleted, in transactions that drop the `events_no_delete`
 *      trigger and create it again with the same SQL: a failure rolls the trigger back too.
 * A pass cut after 2 finds the events again next time: they are already in the file (by id)
 * and are only deleted. Nothing in the file that does not read back is ever deleted.
 *
 * Before the first archive ever, a copy of the database (`VACUUM INTO`) next to it, kept until
 * a later pass moves events again without errors. It needs a quiet core (no monster at work)
 * and free disk space for the whole database plus a margin: otherwise the pass waits.
 *
 * The VACUUM after a pass comes once the pass is saved: when it fails (disk full, a busy
 * database) the archive is done all the same, the failure is said once (an `error` event) and
 * the automatic VACUUM waits longer and longer before trying again (review of 19/10, n. 3).
 * A monthly file that does not read back is set aside as `<file>.damaged-<ts>`, said in the
 * log, and the month starts a new file (n. 8): one bad file never stops the archive.
 */

export const LOG_ARCHIVE_DIR = 'archive';
/** Suffix of the copy of the database made before the first archive. */
export const ARCHIVE_BACKUP_SUFFIX = '.before-archive';
/** The automatic pass at most once a day… */
export const ARCHIVE_EVERY_MS = 24 * 3_600_000;
/** …or sooner when the database grew this much since the latest pass. */
export const ARCHIVE_GROWTH_BYTES = 256 * 1024 * 1024;
/** VACUUM in the automatic pass only past this much free space (and with no monster at work). */
export const AUTO_VACUUM_MIN_BYTES = 64 * 1024 * 1024;
/** Free disk space the first copy of the database wants beyond its size: this, or a tenth of it. */
export const BACKUP_MARGIN_BYTES = 64 * 1024 * 1024;
/** A pass asked by hand at most this often (each one may block the core for a while). */
export const MANUAL_EVERY_MS = 3_600_000;
/** After a failed VACUUM the automatic one waits a day, doubling up to a week. */
export const VACUUM_RETRY_MS = 24 * 3_600_000;
const VACUUM_RETRY_MAX_MS = 7 * 24 * 3_600_000;
/** The types that may move: each one has its own rule in `archivable`. */
export const ARCHIVED_TYPES = ['provider_usage', 'tool_result', 'tool_call', 'message'] as const;

const DAY_MS = 86_400_000;
const STATE_KEY = 'log_archive';
const PAGE = 2000;
const DELETE_CHUNK = 5000;
const FILE_RE = /^events-(\d{4}-\d{2})\.jsonl\.gz$/;
/** The trigger of migration 1, when the database lost it (it is recreated as it was read). */
const NO_DELETE_TRIGGER = `CREATE TRIGGER events_no_delete BEFORE DELETE ON events
        BEGIN SELECT RAISE(ABORT, 'events are append-only'); END`;

interface ArchiveState {
  lastRunAt?: number;
  /** Size of the database after the latest pass (growth trigger). */
  lastDbBytes?: number;
  /** The first pass that moved events. */
  firstAt?: number;
  /** The copy made before the first archive, until a later pass works. */
  backup?: string;
  lastError?: string;
  /** The latest pass that failed: the automatic one waits a day before trying again. */
  lastFailedAt?: number;
  /** Failed VACUUMs in a row, the latest one and why (the automatic one backs off). */
  vacuumFailures?: number;
  vacuumFailedAt?: number;
  vacuumError?: string;
}

interface CandidateRow {
  rowid: number;
  id: string;
  ts: number;
  agent: string;
  run_id: string | null;
  parent_id: string | null;
  type: string;
  data: string;
  partial: number | null;
  role: string | null;
  tool: string | null;
}

export interface ArchiveContext {
  /** Runs of the giri of an automation that are over (none of them waits for an answer). */
  closedGiroRuns: ReadonlySet<string>;
  /**
   * A message with words of the same monster, run and parent comes after this streamed chunk:
   * the chunk is a copy. Without it (a run stopped or failed mid-answer: its closing message
   * is empty) the chunks are the only text of the answer and stay (review of 19/10, n. 7).
   */
  finalAfter: (row: Pick<CandidateRow, 'id' | 'agent' | 'run_id' | 'parent_id'>) => boolean;
}

/** Whether an event of `ARCHIVED_TYPES` may leave the log (its age is checked by the query). */
export function archivable(
  row: Pick<
    CandidateRow,
    'id' | 'agent' | 'type' | 'run_id' | 'parent_id' | 'partial' | 'role' | 'tool'
  >,
  ctx: ArchiveContext,
): boolean {
  switch (row.type) {
    case 'provider_usage':
    case 'tool_result':
      return true;
    case 'tool_call':
      // The mark of a tainted run in logs older than D-103 (`runsTainted`): kept.
      return typeof row.tool === 'string' && !readsThirdParty(row.tool);
    case 'message':
      // Streamed chunks: the final message carries the whole text, when there is one with words.
      if (row.partial === 1) return ctx.finalAfter(row);
      // A sub-agent's message inside a giro that is over: its report is in the delegation.
      return (
        row.role === 'agent' &&
        row.parent_id !== null &&
        row.run_id !== null &&
        ctx.closedGiroRuns.has(row.run_id)
      );
    default:
      return false;
  }
}

/** UTC `YYYY-MM` of a timestamp. */
export function archiveMonthOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(month: string): { from: number; to: number } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { from: Date.UTC(y, m - 1, 1), to: Date.UTC(y, m, 1) };
}

/**
 * Events older than this may move: `days` ago (at the start of that UTC day), and never later
 * than the start of the previous month (local time, as `SpendMeter` counts it).
 */
export function archiveCutoff(now: number, days: number): number {
  const ago = now - days * DAY_MS;
  const day = ago - (((ago % DAY_MS) + DAY_MS) % DAY_MS);
  const prev = new Date(now);
  prev.setHours(0, 0, 0, 0);
  prev.setDate(1);
  prev.setMonth(prev.getMonth() - 1);
  return Math.min(day, prev.getTime());
}

export function archiveDir(home: string): string {
  return join(home, LOG_ARCHIVE_DIR);
}

export function archiveFile(home: string, month: string): string {
  return join(archiveDir(home), `events-${month}.jsonl.gz`);
}

/** The monthly files, oldest first. */
export function archiveMonths(home: string): { month: string; bytes: number; path: string }[] {
  const dir = archiveDir(home);
  if (!existsSync(dir)) return [];
  const out: { month: string; bytes: number; path: string }[] = [];
  for (const name of readdirSync(dir)) {
    const m = FILE_RE.exec(name);
    if (!m) continue;
    const path = join(dir, name);
    out.push({ month: m[1]!, bytes: statSync(path).size, path });
  }
  return out.sort((a, b) => (a.month < b.month ? -1 : 1));
}

/**
 * Destroys a read stream and waits for its file to be closed (on Windows a file still open
 * cannot be renamed or deleted).
 */
async function closeStream(stream: ReadStream): Promise<void> {
  if (stream.closed) return;
  const closed = new Promise<void>((resolve) => stream.once('close', () => resolve()));
  stream.destroy();
  await closed;
}

/**
 * The lines of a gzip file of the archive; rejects on a damaged or cut file. The file is
 * closed before the generator ends, read whole or not.
 */
export async function* readArchiveLines(path: string): AsyncGenerator<string> {
  const gunzip = createGunzip();
  const source = createReadStream(path);
  source.on('error', (err) => gunzip.destroy(err));
  source.pipe(gunzip);
  gunzip.setEncoding('utf8');
  let rest = '';
  try {
    for await (const chunk of gunzip as AsyncIterable<string>) {
      const parts = (rest + chunk).split('\n');
      rest = parts.pop() ?? '';
      for (const line of parts) if (line) yield line;
    }
  } finally {
    await closeStream(source);
  }
  if (rest) yield rest;
}

/** Every event of a month's file, in id order (`monsters log read`). */
export async function readArchiveMonth(home: string, month: string): Promise<LogEvent[]> {
  const events: LogEvent[] = [];
  for await (const line of readArchiveLines(archiveFile(home, month))) {
    events.push(JSON.parse(line) as LogEvent);
  }
  return events.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function lineOf(r: CandidateRow): string {
  const s = JSON.stringify;
  // `data` is stored as JSON already: written as it is.
  return `{"id":${s(r.id)},"ts":${r.ts},"agent":${s(r.agent)},"runId":${s(r.run_id)},"parentId":${s(r.parent_id)},"type":${s(r.type)},"data":${r.data}}`;
}

/** Count and SHA-256 of a file's lines, each parsed (a line that is not JSON fails). */
async function digestOf(path: string): Promise<{ count: number; digest: string }> {
  const hash = createHash('sha256');
  let count = 0;
  for await (const line of readArchiveLines(path)) {
    JSON.parse(line);
    hash.update(line);
    hash.update('\n');
    count++;
  }
  return { count, digest: hash.digest('hex') };
}

/** Writes the lines gzipped to `path` (mode 600) and flushes it to disk. */
async function writeGz(
  path: string,
  lines: AsyncIterable<string>,
): Promise<{ count: number; digest: string }> {
  const hash = createHash('sha256');
  let count = 0;
  async function* chunks(): AsyncGenerator<string> {
    let buf = '';
    for await (const line of lines) {
      hash.update(line);
      hash.update('\n');
      count++;
      buf += `${line}\n`;
      if (buf.length >= 1 << 16) {
        yield buf;
        buf = '';
      }
    }
    if (buf) yield buf;
  }
  // `flush`: fsync before the file is closed; the pipeline ends when it is.
  await pipeline(
    Readable.from(chunks()),
    createGzip(),
    createWriteStream(path, { flags: 'w', mode: FILE_MODE, flush: true }),
  );
  chmodSafe(path, FILE_MODE);
  return { count, digest: hash.digest('hex') };
}

/** fsync of a folder, so a rename in it survives a power cut (not possible on Windows). */
async function syncDir(dir: string): Promise<void> {
  if (process.platform === 'win32') return;
  const fh = await open(dir, 'r');
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** Runs of the giri that are over: the latest `automation_run_finished` of the giro does not wait. */
export function closedGiroRuns(db: Db): Set<string> {
  const runs = new Map<string, string[]>();
  for (const r of db.all<{ run_id: string; giro: string | null }>(
    `SELECT run_id, json_extract(data, '$.giro') AS giro FROM events
     WHERE type = 'automation_run_started' AND run_id IS NOT NULL`,
  )) {
    if (typeof r.giro !== 'string') continue;
    const list = runs.get(r.giro) ?? [];
    list.push(r.run_id);
    runs.set(r.giro, list);
  }
  const last = new Map<string, string>();
  for (const r of db.all<{ giro: string | null; status: string | null }>(
    `SELECT json_extract(data, '$.giro') AS giro, json_extract(data, '$.status') AS status
     FROM events WHERE type = 'automation_run_finished' ORDER BY id`,
  )) {
    if (typeof r.giro === 'string' && typeof r.status === 'string') last.set(r.giro, r.status);
  }
  const out = new Set<string>();
  for (const [giro, status] of last) {
    if (status === 'waiting_user') continue;
    for (const run of runs.get(giro) ?? []) out.add(run);
  }
  return out;
}

/**
 * `ArchiveContext.finalAfter` on the log: the newest message with words of each monster and
 * parent in a run, read once per run (index on run_id) and kept for the pass.
 */
export function finalAfterOf(db: Db): ArchiveContext['finalAfter'] {
  const newest = new Map<string, Map<string, string>>();
  const key = (agent: string, parent: string | null) => `${agent}\u0000${parent ?? ''}`;
  return (row) => {
    if (row.run_id === null) return false;
    let byAuthor = newest.get(row.run_id);
    if (!byAuthor) {
      byAuthor = new Map();
      for (const r of db.all<{ agent: string; parent_id: string | null; id: string }>(
        `SELECT agent, parent_id, MAX(id) AS id FROM events
         WHERE run_id = ? AND type = 'message'
           AND json_extract(data, '$.partial') IS NOT 1
           AND json_extract(data, '$.role') = 'agent'
           AND trim(coalesce(json_extract(data, '$.text'), '')) <> ''
         GROUP BY agent, parent_id`,
        row.run_id,
      )) {
        byAuthor.set(key(r.agent, r.parent_id), r.id);
      }
      newest.set(row.run_id, byAuthor);
    }
    const last = byAuthor.get(key(row.agent, row.parent_id));
    return last !== undefined && last > row.id;
  };
}

/** Archivable events of `[from, to)`, type by type, in (ts, rowid) order. */
function* candidates(
  db: Db,
  from: number,
  to: number,
  ctx: ArchiveContext,
): Generator<CandidateRow> {
  for (const type of ARCHIVED_TYPES) {
    let ts = from - 1;
    let rowid = 0;
    for (;;) {
      const page = db.all<CandidateRow>(
        `SELECT rowid, id, ts, agent, run_id, parent_id, type, data,
                json_extract(data, '$.partial') AS partial,
                json_extract(data, '$.role') AS role,
                json_extract(data, '$.tool') AS tool
         FROM events INDEXED BY events_type_ts
         WHERE type = ? AND ts >= ? AND ts < ? AND (ts > ? OR (ts = ? AND rowid > ?))
         ORDER BY ts, rowid LIMIT ?`,
        type,
        from,
        to,
        ts,
        ts,
        rowid,
        PAGE,
      );
      for (const r of page) if (archivable(r, ctx)) yield r;
      if (page.length < PAGE) break;
      const lastRow = page.at(-1)!;
      ts = lastRow.ts;
      rowid = lastRow.rowid;
    }
  }
}

/**
 * Deletes the events, `DELETE_CHUNK` at a time: each transaction drops the append-only trigger
 * and creates it again with the SQL it had; a throw rolls both back. Returns the rows deleted.
 */
export function deleteArchivedEvents(db: Db, ids: readonly string[]): number {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    const chunk = ids.slice(i, i + DELETE_CHUNK);
    deleted += db.transaction(() => {
      const sql =
        db.get<{ sql: string }>(
          "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'events_no_delete'",
        )?.sql ?? NO_DELETE_TRIGGER;
      db.exec('DROP TRIGGER IF EXISTS events_no_delete');
      let n = 0;
      for (const id of chunk) n += db.run('DELETE FROM events WHERE id = ?', id).changes;
      db.exec(sql);
      return n;
    });
  }
  return deleted;
}

/** The append-only triggers are both in place. */
export function appendOnlyTriggers(db: Db): boolean {
  const rows = db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'events'",
  );
  const names = new Set(rows.map((r) => r.name));
  return names.has('events_no_delete') && names.has('events_no_update');
}

function freeBytes(db: Db): number {
  const pages = db.get<{ freelist_count: number }>('PRAGMA freelist_count')?.freelist_count ?? 0;
  const size = db.get<{ page_size: number }>('PRAGMA page_size')?.page_size ?? 4096;
  return pages * size;
}

/** Free bytes for this user on the disk of `dir`, or null when the system does not say. */
function diskFree(dir: string): number | null {
  try {
    const s = statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

const mib = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

function dbBytes(path: string): number {
  let n = 0;
  for (const p of [path, `${path}-wal`]) {
    try {
      n += statSync(p).size;
    } catch {
      // not there
    }
  }
  return n;
}

export interface ArchiveSettings {
  enabled: boolean;
  days: number;
}

export interface ArchiveHooks {
  /** After the month's file is written to `tmp`, before it is read back (tests: damage it). */
  afterWrite?: (month: string, tmp: string) => void | Promise<void>;
  /** After the file is in place, before the events are deleted (tests: a pass cut there). */
  beforeDelete?: (month: string) => void | Promise<void>;
}

export interface LogArchiverOptions {
  db: Db;
  log: EventLog;
  state: StateStore;
  home: string;
  settings: () => ArchiveSettings;
  /** No monster at work: the automatic pass may block the core for a VACUUM or the first copy. */
  idle?: () => boolean;
  now?: () => number;
  hooks?: ArchiveHooks;
  /** A failure of the automatic pass (it is also logged as an `error` event). */
  onError?: (err: unknown) => void;
  /** Free bytes on the disk of a folder, null when unknown (tests). */
  diskFree?: (dir: string) => number | null;
  /** Runs the VACUUM (tests: make it fail). */
  vacuum?: (db: Db) => void;
}

export interface ArchiveRunOptions {
  dryRun?: boolean;
  /** `true`: VACUUM afterwards when there is free space and no monster works; `auto`: only past `AUTO_VACUUM_MIN_BYTES`. */
  vacuum?: boolean | 'auto';
  by?: Channel;
  /** The automatic pass: it waits for a quiet core before the first copy of the database. */
  automatic?: boolean;
}

/** Where a monthly file that did not read back is set aside. */
export function damagedName(file: string, ts: number): string {
  return `${file}.damaged-${ts}`;
}

/** The pass waits: the copy before the first archive needs a quiet core and room on the disk. */
export class ArchivePostponed extends Error {}

/** A pass by hand too soon after the previous one (`MANUAL_EVERY_MS`), or after `stop()`. */
export class ArchiveRefused extends Error {
  readonly code: 'too_soon' | 'closed';
  readonly retryAfterMs: number;
  constructor(message: string, code: 'too_soon' | 'closed', retryAfterMs = 0) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export class LogArchiver {
  readonly #o: LogArchiverOptions;
  #running: Promise<LogArchiveResult> | null = null;
  #timers: NodeJS.Timeout[] = [];
  #closed = false;
  /** Start of the latest pass asked by hand (not a dry run), for `MANUAL_EVERY_MS`. */
  #manualAt: number | null = null;

  constructor(options: LogArchiverOptions) {
    this.#o = options;
  }

  get dir(): string {
    return archiveDir(this.#o.home);
  }

  get backupPath(): string {
    return `${this.#o.db.path}${ARCHIVE_BACKUP_SUFFIX}`;
  }

  #now(): number {
    return (this.#o.now ?? Date.now)();
  }

  #state(): ArchiveState {
    return this.#o.state.get<ArchiveState>(STATE_KEY) ?? {};
  }

  #save(patch: Partial<ArchiveState>, drop: (keyof ArchiveState)[] = []): void {
    const next: ArchiveState = { ...this.#state(), ...patch };
    for (const k of drop) delete next[k];
    this.#o.state.set(STATE_KEY, next);
  }

  status(): LogArchiveStatus {
    const s = this.#state();
    const settings = this.#o.settings();
    return {
      enabled: settings.enabled,
      days: settings.days,
      dir: this.dir,
      lastRunAt: s.lastRunAt ?? null,
      lastError: s.lastError ?? null,
      ...(s.vacuumError ? { vacuumError: s.vacuumError } : {}),
      months: archiveMonths(this.#o.home).map(({ month, bytes }) => ({ month, bytes })),
    };
  }

  /** The automatic pass is due: on, and a day since the latest one (or the database grew a lot). */
  due(): boolean {
    if (!this.#o.settings().enabled) return false;
    const s = this.#state();
    const last = Math.max(s.lastRunAt ?? -Infinity, s.lastFailedAt ?? -Infinity);
    if (last === -Infinity) return true;
    if (this.#now() - last >= ARCHIVE_EVERY_MS) return true;
    return dbBytes(this.#o.db.path) >= (s.lastDbBytes ?? 0) + ARCHIVE_GROWTH_BYTES;
  }

  /** Checks after `firstDelayMs`, then every `everyMs`; never keeps the process alive. */
  start(opts: { firstDelayMs?: number; everyMs?: number } = {}): void {
    const tick = () => {
      if (this.#closed || this.#running || !this.due()) return;
      this.run({ automatic: true, vacuum: 'auto', by: 'system' }).catch((err: unknown) => {
        if (err instanceof ArchivePostponed) return;
        this.#o.onError?.(err);
      });
    };
    const first = setTimeout(tick, opts.firstDelayMs ?? 60_000);
    const every = setInterval(tick, opts.everyMs ?? 3_600_000);
    first.unref();
    every.unref();
    this.#timers.push(first, every);
  }

  /** Stops the timers and waits for a pass at work. */
  async stop(): Promise<void> {
    this.#closed = true;
    for (const t of this.#timers) clearTimeout(t);
    this.#timers = [];
    await this.#running?.catch(() => {});
  }

  /**
   * One pass, after the one at work if any. Refused after `stop()` (the database is closing);
   * a pass by hand (not automatic, not a dry run) at most once per `MANUAL_EVERY_MS`.
   */
  async run(opts: ArchiveRunOptions = {}): Promise<LogArchiveResult> {
    const manual = !opts.automatic && !opts.dryRun;
    const refuseIfClosed = () => {
      if (this.#closed) throw new ArchiveRefused('Monsters is stopping', 'closed');
    };
    const refuseIfTooSoon = () => {
      if (!manual || this.#manualAt === null) return;
      const wait = this.#manualAt + MANUAL_EVERY_MS - this.#now();
      if (wait > 0) {
        throw new ArchiveRefused(
          `one archive pass by hand an hour: try again in ${Math.ceil(wait / 60_000)} min`,
          'too_soon',
          wait,
        );
      }
    };
    refuseIfClosed();
    refuseIfTooSoon();
    while (this.#running) await this.#running.catch(() => {});
    // Again after the wait: requests queued together get one pass, not one each.
    refuseIfClosed();
    refuseIfTooSoon();
    const started = this.#now();
    const pass = this.#pass(opts);
    this.#running = pass;
    try {
      const result = await pass;
      if (manual) this.#manualAt = started;
      return result;
    } catch (err) {
      // A pass that only waited (a monster at work, no room for the copy) does not count.
      if (manual && !(err instanceof ArchivePostponed)) this.#manualAt = started;
      throw err;
    } finally {
      if (this.#running === pass) this.#running = null;
    }
  }

  async #pass(opts: ArchiveRunOptions): Promise<LogArchiveResult> {
    const { db } = this.#o;
    const now = this.#now();
    const days = this.#o.settings().days || LOG_ARCHIVE_DEFAULT_DAYS;
    const before = archiveCutoff(now, days);
    const ctx: ArchiveContext = {
      closedGiroRuns: closedGiroRuns(db),
      finalAfter: finalAfterOf(db),
    };
    const result: LogArchiveResult = {
      dryRun: opts.dryRun === true,
      before,
      events: 0,
      bytes: 0,
      months: [],
      types: {},
    };
    const months = db
      .all<{ m: string }>(
        `SELECT DISTINCT strftime('%Y-%m', ts / 1000, 'unixepoch') AS m FROM events
         WHERE type IN (${ARCHIVED_TYPES.map(() => '?').join(', ')}) AND ts < ? ORDER BY m`,
        ...ARCHIVED_TYPES,
        before,
      )
      .map((r) => r.m);

    if (opts.dryRun) {
      for (const month of months) {
        const { from, to } = monthBounds(month);
        const m = { month, events: 0, bytes: 0 };
        for (const row of candidates(db, from, Math.min(to, before), ctx)) {
          count(result, m, moved(row));
        }
        if (m.events > 0) result.months.push(m);
      }
      return result;
    }

    const state = this.#state();
    const hadArchived = state.firstAt !== undefined;
    try {
      if (months.length > 0 && !hadArchived && !existsSync(this.backupPath)) {
        // The copy blocks the core while it is made: by hand too, only with no monster at work.
        if (this.#o.idle && !this.#o.idle()) {
          throw new ArchivePostponed('a monster is working: the copy of the database waits');
        }
        this.#backup();
        this.#save({ backup: this.backupPath });
      }
      await mkdir(this.dir, { recursive: true, mode: DIR_MODE });
      chmodSafe(this.dir, DIR_MODE);
      for (const month of months) {
        const { from, to } = monthBounds(month);
        const m = await this.#month(month, from, Math.min(to, before), ctx, result);
        if (m.events > 0) result.months.push(m);
      }
    } catch (err) {
      if (!(err instanceof ArchivePostponed)) {
        this.#save({
          lastError: err instanceof Error ? err.message : String(err),
          lastFailedAt: this.#now(),
        });
        if (result.events > 0) this.#note(result, opts.by ?? 'system');
      }
      throw err;
    }
    if (!appendOnlyTriggers(db)) throw new Error('the append-only triggers of the log are missing');
    if (result.events > 0) this.#note(result, opts.by ?? 'system');

    const backup = this.#state().backup;
    if (result.events > 0 && hadArchived && backup) {
      rmSync(backup, { force: true });
      this.#save({}, ['backup']);
    } else if (backup && existsSync(backup)) {
      result.backup = backup;
    }
    // Saved before the VACUUM: the archive is done whatever happens to it.
    this.#save(
      {
        lastRunAt: this.#now(),
        lastDbBytes: dbBytes(db.path),
        ...(result.events > 0 && !hadArchived ? { firstAt: now } : {}),
      },
      ['lastError', 'lastFailedAt'],
    );
    if (opts.vacuum) {
      result.vacuum = this.#vacuum(opts.vacuum, opts.automatic === true);
      if (result.vacuum === 'done') this.#save({ lastDbBytes: dbBytes(db.path) });
    }
    return result;
  }

  /** The note in the log of what left it. */
  #note(result: LogArchiveResult, by: Channel): void {
    this.#o.log.append({
      agent: 'system',
      type: 'log_archive',
      data: {
        events: result.events,
        before: result.before,
        months: result.months.map(({ month, events }) => ({ month, events })),
        dir: this.dir,
        by,
      },
    });
  }

  /** Copy of the database next to it (mode 600), made by SQLite from a consistent snapshot. */
  #backup(): void {
    const path = this.backupPath;
    const tmp = `${path}.tmp`;
    rmSync(tmp, { force: true });
    // Room for the whole database and a margin: a copy that fills the disk would make the
    // appends of the log fail too.
    const size = dbBytes(this.#o.db.path);
    const want = size + Math.max(BACKUP_MARGIN_BYTES, Math.ceil(size / 10));
    const free = (this.#o.diskFree ?? diskFree)(dirname(path));
    if (free !== null && free < want) {
      throw new ArchivePostponed(
        `not enough free disk space for the copy of the database (${mib(free)} free, ${mib(want)} needed)`,
      );
    }
    try {
      // VACUUM INTO wants a new or empty file: an empty one first, never readable by others.
      closeSync(openSync(tmp, 'wx', FILE_MODE));
      this.#o.db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
      chmodSafe(tmp, FILE_MODE);
      renameSync(tmp, path);
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  /** `automatic`: after a failure it waits (a day, doubling up to a week); by hand it tries. */
  #vacuum(mode: true | 'auto', automatic: boolean): 'done' | 'skipped' | 'failed' {
    const s = this.#state();
    const failures = s.vacuumFailures ?? 0;
    if (automatic && failures > 0 && s.vacuumFailedAt !== undefined) {
      const wait = Math.min(VACUUM_RETRY_MS * 2 ** (failures - 1), VACUUM_RETRY_MAX_MS);
      if (this.#now() - s.vacuumFailedAt < wait) return 'skipped';
    }
    const free = freeBytes(this.#o.db);
    const min = mode === 'auto' ? AUTO_VACUUM_MIN_BYTES : 1;
    if (free < min || (this.#o.idle && !this.#o.idle())) return 'skipped';
    try {
      (this.#o.vacuum ?? ((db: Db) => db.exec('VACUUM')))(this.#o.db);
      this.#o.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#save({
        vacuumFailures: failures + 1,
        vacuumFailedAt: this.#now(),
        vacuumError: message,
      });
      // Said once: the next failures in a row only back off.
      if (failures === 0) {
        this.#o.log.append({
          agent: 'system',
          type: 'error',
          data: {
            code: 'log_vacuum_failed',
            message: coreStrings().vacuumFailed(message),
          },
        });
      }
      return 'failed';
    }
    if (failures > 0) this.#save({}, ['vacuumFailures', 'vacuumFailedAt', 'vacuumError']);
    return 'done';
  }

  /** The ids in a month's file; a file that does not read back is set aside and said. */
  async #existing(month: string, file: string): Promise<Set<string>> {
    const existing = new Set<string>();
    if (!existsSync(file)) return existing;
    try {
      for await (const line of readArchiveLines(file)) {
        existing.add((JSON.parse(line) as { id: string }).id);
      }
      return existing;
    } catch (err) {
      const aside = damagedName(file, this.#now());
      await rename(file, aside);
      this.#o.log.append({
        agent: 'system',
        type: 'error',
        data: {
          code: 'log_archive_damaged',
          message: coreStrings().archiveDamaged(
            month,
            err instanceof Error ? err.message : String(err),
            aside,
          ),
        },
      });
      return new Set();
    }
  }

  async #month(
    month: string,
    from: number,
    to: number,
    ctx: ArchiveContext,
    result: LogArchiveResult,
  ): Promise<{ month: string; events: number; bytes: number }> {
    const { db, hooks } = this.#o;
    const file = archiveFile(this.#o.home, month);
    const existing = await this.#existing(month, file);
    let fresh = false;
    for (const row of candidates(db, from, to, ctx)) {
      if (!existing.has(row.id)) {
        fresh = true;
        break;
      }
    }
    const m = { month, events: 0, bytes: 0 };
    const ids: string[] = [];
    const rows: Moved[] = [];
    if (fresh) {
      const tmp = `${file}.tmp`;
      await rm(tmp, { force: true });
      async function* lines(): AsyncGenerator<string> {
        if (existing.size > 0) yield* readArchiveLines(file);
        for (const row of candidates(db, from, to, ctx)) {
          ids.push(row.id);
          rows.push(moved(row));
          if (!existing.has(row.id)) yield lineOf(row);
        }
      }
      try {
        const written = await writeGz(tmp, lines());
        await hooks?.afterWrite?.(month, tmp);
        const back = await digestOf(tmp);
        if (back.count !== written.count || back.digest !== written.digest) {
          throw new Error(`archive ${month}: the file does not read back as written`);
        }
        await rename(tmp, file);
        await syncDir(this.dir);
      } catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
    } else {
      // All already in the file: a pass was cut before deleting them.
      for (const row of candidates(db, from, to, ctx)) {
        ids.push(row.id);
        rows.push(moved(row));
      }
    }
    if (ids.length === 0) return m;
    await hooks?.beforeDelete?.(month);
    deleteArchivedEvents(db, ids);
    for (const row of rows) count(result, m, row);
    return m;
  }
}

/** What the counts keep of a row moved: its type and the size of its data. */
interface Moved {
  type: string;
  bytes: number;
}

function moved(row: CandidateRow): Moved {
  return { type: row.type, bytes: Buffer.byteLength(row.data) };
}

function count(result: LogArchiveResult, m: { events: number; bytes: number }, row: Moved): void {
  m.events++;
  m.bytes += row.bytes;
  result.events++;
  result.bytes += row.bytes;
  const t = (result.types[row.type] ??= { events: 0, bytes: 0 });
  t.events++;
  t.bytes += row.bytes;
}
