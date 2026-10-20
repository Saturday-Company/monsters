import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ulid,
  type EventInput,
  type LogArchiveResult,
  type LogArchiveStatus,
  type LogEvent,
} from '@monsters/shared';
import { automationRunOf, runsOfGiro } from '../src/automations/run-index.ts';
import {
  ARCHIVED_TYPES,
  ArchivePostponed,
  ArchiveRefused,
  archiveCutoff,
  archiveDir,
  archiveFile,
  archiveMonthOf,
  appendOnlyTriggers,
  coreMigrations,
  deleteArchivedEvents,
  EventLog,
  LogArchiver,
  migrate,
  openDb,
  readArchiveLines,
  readArchiveMonth,
  StateStore,
  type ArchiveHooks,
  type Db,
} from '../src/index.ts';
import { runsTainted } from '../src/team/compaction.ts';
import { conversationTurns } from '../src/team/conversation.ts';
import { haltedRequests } from '../src/team/resume-work.ts';
import { tempHome } from './helpers.ts';
import { startTestHub } from './hub-helpers.ts';

const DAY = 86_400_000;
/** 19/10/2026, noon UTC. */
const NOW = Date.UTC(2026, 9, 19, 12);
const POSIX = process.platform !== 'win32';

interface Setup {
  home: string;
  db: Db;
  log: EventLog;
  state: StateStore;
  clock: { now: number };
  at: <T extends EventInput>(ts: number, input: T) => LogEvent;
  archiver: (opts?: {
    hooks?: ArchiveHooks;
    days?: number;
    enabled?: boolean;
    idle?: () => boolean;
    diskFree?: (dir: string) => number | null;
    vacuum?: (db: Db) => void;
  }) => LogArchiver;
}

/** Databases opened by `setup`, closed after each test (on Windows an open one keeps its folder). */
const opened: Db[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) {
    try {
      db.close();
    } catch {
      // closed by the test
    }
  }
});

function setup(): Setup {
  const home = tempHome();
  mkdirSync(home, { recursive: true });
  const db = openDb(`${home}/monsters.db`);
  opened.push(db);
  migrate(db, 'core', coreMigrations);
  const clock = { now: NOW };
  const log = new EventLog(db, { now: () => clock.now });
  const state = new StateStore(db);
  return {
    home,
    db,
    log,
    state,
    clock,
    at: (ts, input) => {
      clock.now = ts;
      const e = log.append(input);
      clock.now = NOW;
      return e;
    },
    archiver: (opts = {}) =>
      new LogArchiver({
        db,
        log,
        state,
        home,
        settings: () => ({ enabled: opts.enabled ?? true, days: opts.days ?? 90 }),
        now: () => clock.now,
        ...(opts.idle ? { idle: opts.idle } : {}),
        ...(opts.hooks ? { hooks: opts.hooks } : {}),
        ...(opts.diskFree ? { diskFree: opts.diskFree } : {}),
        ...(opts.vacuum ? { vacuum: opts.vacuum } : {}),
      }),
  };
}

const big = (n: number) => 'x'.repeat(n);

/**
 * A history like a real one, chronological: a chat run of Titan 120 days ago (read a note,
 * read a web page, streamed its answer: a log before D-103, the run's end says nothing of the
 * taint), a giro of an automation that is over and one that waits for an answer, a stop of
 * Monsters with a run cut, then spending in the previous and in this month.
 */
function history(s: Setup) {
  const t0 = NOW - 120 * DAY;
  let t = t0;
  const next = (input: EventInput) => s.at((t += 1000), input);
  const ids: Record<string, string> = {};

  // A chat run of Titan.
  ids['userMsg'] = next({
    agent: 'user',
    runId: 'r1',
    type: 'message',
    data: { role: 'user', text: 'Cercami le novità su Encelado', to: 'titan', channel: 'ui' },
  }).id;
  next({ agent: 'titan', runId: 'r1', type: 'run', data: { status: 'started', goal: 'Encelado' } });
  next({
    agent: 'titan',
    runId: 'r1',
    type: 'provider_usage',
    data: {
      provider: 'openrouter',
      model: 'm1',
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0.01,
    },
  });
  next({
    agent: 'titan',
    runId: 'r1',
    type: 'tool_call',
    data: { callId: 'c1', tool: 'vault_read', input: { path: 'Encelado.md' } },
  });
  next({
    agent: 'titan',
    runId: 'r1',
    type: 'tool_result',
    data: { callId: 'c1', tool: 'vault_read', ok: true, output: big(4000) },
  });
  ids['webCall'] = next({
    agent: 'titan',
    runId: 'r1',
    type: 'tool_call',
    data: { callId: 'c2', tool: 'web_fetch', input: { url: 'https://science.nasa.gov/x' } },
  }).id;
  next({
    agent: 'titan',
    runId: 'r1',
    type: 'tool_result',
    data: { callId: 'c2', tool: 'web_fetch', ok: true, output: big(8000) },
  });
  next({
    agent: 'titan',
    runId: 'r1',
    type: 'message',
    data: { role: 'agent', text: 'Ecco le ', partial: true },
  });
  next({
    agent: 'titan',
    runId: 'r1',
    type: 'message',
    data: { role: 'agent', text: 'novità', partial: true },
  });
  ids['final'] = next({
    agent: 'titan',
    runId: 'r1',
    type: 'message',
    data: { role: 'agent', text: 'Ecco le novità' },
  }).id;
  next({
    agent: 'titan',
    runId: 'r1',
    type: 'decision',
    data: {
      kind: 'ask_or_proceed',
      question: 'Procedo?',
      options: ['sì', 'no'],
      choice: 'sì',
      decidedBy: 'rules',
    },
  });
  next({
    agent: 'titan',
    runId: 'r1',
    type: 'question',
    data: { questionId: 'q1', question: 'Salvo la nota?', options: [], blocking: true },
  });
  next({ agent: 'user', runId: 'r1', type: 'answer', data: { questionId: 'q1', text: 'sì' } });
  next({
    agent: 'titan',
    runId: 'r1',
    type: 'security',
    data: {
      action: 'injection_removed',
      source: 'web_fetch https://x',
      tool: 'web_fetch',
      message: 'tolto',
    },
  });
  next({
    agent: 'titan',
    runId: 'r1',
    type: 'memory',
    data: { action: 'proposed', path: 'Agenti/Titan/MEMORY.md', lines: ['Giulio ama Encelado'] },
  });
  next({ agent: 'titan', runId: 'r1', type: 'run', data: { status: 'completed' } });

  // A giro that is over: the capo delegated to Rhea, whose own message is internal.
  next({
    agent: 'titan',
    runId: 'g1',
    type: 'automation_run_started',
    data: { automationId: 'rassegna', name: 'Rassegna', giro: 'g1', trigger: 'schedule' },
  });
  next({ agent: 'titan', runId: 'g1', type: 'run', data: { status: 'started' } });
  const deleg = next({
    agent: 'titan',
    runId: 'g1',
    type: 'delegation',
    data: { from: 'titan', to: 'rhea', status: 'started', goal: 'cerca' },
  });
  ids['giroInner'] = next({
    agent: 'rhea',
    runId: 'g1',
    parentId: deleg.id,
    type: 'message',
    data: { role: 'agent', text: big(2000) },
  }).id;
  ids['giroLead'] = next({
    agent: 'titan',
    runId: 'g1',
    type: 'message',
    data: { role: 'agent', text: 'Rassegna pronta' },
  }).id;
  next({ agent: 'titan', runId: 'g1', type: 'run', data: { status: 'completed' } });
  next({
    agent: 'titan',
    runId: 'g1',
    type: 'automation_run_finished',
    data: { automationId: 'rassegna', name: 'Rassegna', giro: 'g1', status: 'completed' },
  });

  // A giro that waits for an answer: everything of it stays.
  next({
    agent: 'titan',
    runId: 'g2',
    type: 'automation_run_started',
    data: { automationId: 'rassegna', name: 'Rassegna', giro: 'g2', trigger: 'schedule' },
  });
  next({ agent: 'titan', runId: 'g2', type: 'run', data: { status: 'started' } });
  const deleg2 = next({
    agent: 'titan',
    runId: 'g2',
    type: 'delegation',
    data: { from: 'titan', to: 'rhea', status: 'started', goal: 'cerca' },
  });
  ids['openGiroInner'] = next({
    agent: 'rhea',
    runId: 'g2',
    parentId: deleg2.id,
    type: 'message',
    data: { role: 'agent', text: 'trovato' },
  }).id;
  next({ agent: 'titan', runId: 'g2', type: 'run', data: { status: 'waiting_user' } });
  next({
    agent: 'titan',
    runId: 'g2',
    type: 'automation_run_finished',
    data: { automationId: 'rassegna', name: 'Rassegna', giro: 'g2', status: 'waiting_user' },
  });

  // A stop of Monsters cuts a run (Riprendi e continua reads it back).
  next({
    agent: 'user',
    runId: 'r2',
    type: 'message',
    data: { role: 'user', text: 'Scrivi il post', to: 'dione', channel: 'ui' },
  });
  next({ agent: 'dione', runId: 'r2', type: 'run', data: { status: 'started', goal: 'post' } });
  next({
    agent: 'dione',
    runId: 'r2',
    type: 'message',
    data: { role: 'agent', text: 'Sto scr', partial: true },
  });
  next({ agent: 'user', type: 'kill', data: { scope: 'global', by: 'cli' } });
  next({ agent: 'dione', runId: 'r2', type: 'run', data: { status: 'aborted' } });

  // 100 days ago, another month: a bare usage.
  t = NOW - 100 * DAY;
  next({
    agent: 'rhea',
    runId: 'r3',
    type: 'provider_usage',
    data: { provider: 'openrouter', model: 'm2', costUsd: 0.02 },
  });

  // The previous month and this one: spending, never moved.
  t = NOW - 35 * DAY;
  next({
    agent: 'titan',
    runId: 'r4',
    type: 'provider_usage',
    data: { provider: 'openrouter', model: 'm1', costUsd: 0.5, project: null },
  });
  t = NOW - 2 * DAY;
  next({
    agent: 'titan',
    runId: 'r5',
    type: 'provider_usage',
    data: { provider: 'openrouter', model: 'm1', costUsd: 0.25 },
  });
  next({
    agent: 'titan',
    runId: 'r5',
    type: 'tool_result',
    data: { callId: 'c9', tool: 'vault_read', ok: true, output: 'recente' },
  });
  return { ids, t0 };
}

/** Everything the core rebuilds at start, read from the log as it is now. */
function rebuilds(db: Db) {
  const log = new EventLog(db);
  const keptTypes = db
    .all<{ id: string; type: string; data: string }>(
      `SELECT id, type, data FROM events WHERE type NOT IN (${ARCHIVED_TYPES.map(() => '?').join(', ')}) ORDER BY id`,
      ...ARCHIVED_TYPES,
    )
    .filter((r) => r.type !== 'log_archive');
  const prevMonth = new Date(NOW);
  prevMonth.setHours(0, 0, 0, 0);
  prevMonth.setDate(1);
  prevMonth.setMonth(prevMonth.getMonth() - 1);
  return {
    keptTypes,
    taint: { r1: runsTainted(log, ['r1']), g1: runsTainted(log, ['g1']) },
    halted: haltedRequests(log, NOW),
    giro: { run: automationRunOf(log, 'g1'), runs: runsOfGiro(log, 'g2') },
    spend: log.usageTotals(prevMonth.getTime()),
    projects: log.projectUsageTotals(prevMonth.getTime()),
    openRuns: log.openRuns(),
    chat: conversationTurns(log, undefined, { agentId: 'titan', isOrchestrator: true, turns: 50 }),
    lead: log
      .query({ runId: 'g1', type: 'message', agent: 'titan' })
      .filter((e) => e.type === 'message' && !e.data.partial && e.parentId === null)
      .map((e) => e.id),
  };
}

function typesLeft(db: Db): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of db.all<{ type: string; n: number }>(
    'SELECT type, COUNT(*) AS n FROM events GROUP BY type',
  )) {
    out[r.type] = r.n;
  }
  return out;
}

function fileLines(path: string): { id: string; type: string; data: Record<string, unknown> }[] {
  return gunzipSync(readFileSync(path))
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { id: string; type: string; data: Record<string, unknown> });
}

describe('archive cutoff', () => {
  it('is `days` ago at the start of the UTC day, never after the start of the previous month', () => {
    expect(archiveCutoff(NOW, 90)).toBe(Date.UTC(2026, 6, 21));
    const prev = new Date(NOW);
    prev.setHours(0, 0, 0, 0);
    prev.setDate(1);
    prev.setMonth(prev.getMonth() - 1);
    expect(archiveCutoff(NOW, 30)).toBe(prev.getTime());
    expect(archiveMonthOf(Date.UTC(2026, 5, 30, 23, 59))).toBe('2026-06');
  });
});

describe('LogArchiver', () => {
  it('moves only the bulky types, to a readable monthly file, and keeps every rebuild identical', async () => {
    const s = setup();
    const { ids } = history(s);
    const before = rebuilds(s.db);
    const archiver = s.archiver();

    const dry = await archiver.run({ dryRun: true });
    expect(dry.events).toBeGreaterThan(0);
    expect(typesLeft(s.db)['tool_result']).toBe(3);

    const r = await archiver.run({ by: 'cli' });
    expect(r.events).toBe(dry.events);
    expect(r.types).toEqual(dry.types);
    expect(r.months.map((m) => m.month)).toEqual(['2026-06', '2026-07']);
    // Moved: usage, results, the tool call that read a note, the chunks of the answer that
    // was given whole, the giro's inner message.
    expect(Object.fromEntries(Object.entries(r.types).map(([k, v]) => [k, v.events]))).toEqual({
      provider_usage: 2,
      tool_result: 2,
      tool_call: 1,
      message: 3,
    });

    // Still in the log: the web read (taint), the final answers, the open giro, the recent ones.
    for (const id of [ids['webCall'], ids['final'], ids['userMsg'], ids['giroLead']]) {
      expect(s.log.get(id!)).toBeDefined();
    }
    expect(s.log.get(ids['openGiroInner']!)).toBeDefined();
    expect(s.log.get(ids['giroInner']!)).toBeUndefined();
    expect(typesLeft(s.db)).toMatchObject({ tool_result: 1, provider_usage: 2, tool_call: 1 });

    // The file: one event per line, as the API gives it, mode 600, and read back in id order.
    const june = archiveFile(s.home, '2026-06');
    const lines = fileLines(june);
    expect(lines).toHaveLength(7);
    expect(lines.find((l) => l.id === ids['giroInner'])?.data['text']).toBe(big(2000));
    const read = await readArchiveMonth(s.home, '2026-06');
    expect(read.map((e) => e.id)).toEqual(lines.map((l) => l.id).sort());
    expect(read[0]).toMatchObject({ agent: 'titan', runId: 'r1', parentId: null });
    if (POSIX) {
      expect(statSync(june).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(june)).mode & 0o777).toBe(0o700);
    }

    // The triggers are back: the log is append-only again.
    expect(appendOnlyTriggers(s.db)).toBe(true);
    expect(() => s.db.run('DELETE FROM events')).toThrow(/append-only/);
    expect(() => s.db.run("UPDATE events SET agent = 'x'")).toThrow(/append-only/);

    // Every rebuild of the start reads the same.
    expect(rebuilds(s.db)).toEqual(before);
    expect(before.taint).toEqual({ r1: true, g1: false });
    expect(before.halted.length).toBeGreaterThan(0);
    expect(before.chat.length).toBeGreaterThan(0);

    // The log says what left it; the status lists the files.
    const note = s.log.query({ type: 'log_archive' });
    expect(note).toHaveLength(1);
    expect(note[0]).toMatchObject({
      agent: 'system',
      data: { events: r.events, by: 'cli', dir: archiver.dir },
    });
    const status = archiver.status();
    expect(status.months.map((m) => m.month)).toEqual(['2026-06', '2026-07']);
    expect(status.lastRunAt).toBe(NOW);
    expect(status.lastError).toBeNull();
  });

  it('is idempotent and appends to the month file without duplicates', async () => {
    const s = setup();
    history(s);
    const archiver = s.archiver();
    await archiver.run();
    const june = archiveFile(s.home, '2026-06');
    const bytes = readFileSync(june);

    const again = await s.archiver().run();
    expect(again.events).toBe(0);
    expect(readFileSync(june).equals(bytes)).toBe(true);
    expect(s.log.query({ type: 'log_archive' })).toHaveLength(1);

    // Ten days later the cut moved: more of June leaves the log, into the same file.
    s.at(NOW - 121 * DAY, {
      agent: 'titan',
      runId: 'r9',
      type: 'tool_result',
      data: { callId: 'z', tool: 'vault_list', ok: true, output: 'late' },
    });
    const later = await s.archiver().run();
    expect(later.events).toBe(1);
    const lines = fileLines(june);
    expect(lines).toHaveLength(8);
    expect(new Set(lines.map((l) => l.id)).size).toBe(8);
  });

  it('deletes nothing when the file does not read back, and recovers a pass cut before the delete', async () => {
    const s = setup();
    history(s);
    const total = typesLeft(s.db);
    const june = archiveFile(s.home, '2026-06');

    // The file is damaged after writing: the pass fails, the log is whole, no file is left.
    const damaged = s.archiver({
      hooks: {
        afterWrite: (_m, tmp) => {
          const bytes = readFileSync(tmp);
          writeFileSync(tmp, bytes.subarray(0, Math.floor(bytes.length / 2)));
        },
      },
    });
    await expect(damaged.run()).rejects.toThrow();
    expect(typesLeft(s.db)).toEqual(total);
    expect(existsSync(june)).toBe(false);
    expect(existsSync(`${june}.tmp`)).toBe(false);
    expect(appendOnlyTriggers(s.db)).toBe(true);
    expect(damaged.status().lastError).toBeTruthy();

    // Cut after the file is in place, before the delete (a crash): the events are still there.
    const cut = s.archiver({
      hooks: {
        beforeDelete: () => {
          throw new Error('power cut');
        },
      },
    });
    await expect(cut.run()).rejects.toThrow('power cut');
    expect(typesLeft(s.db)).toEqual(total);
    const inFile = fileLines(june).length;
    expect(inFile).toBe(7);

    // The next pass finds them in the file and only deletes them: nothing twice, nothing lost.
    const r = await s.archiver().run();
    expect(r.events).toBeGreaterThan(0);
    expect(fileLines(june)).toHaveLength(inFile);
    expect(typesLeft(s.db)['tool_result']).toBe(1);
    expect(s.archiver().status().lastError).toBeNull();
  });

  it('a delete that fails rolls back with the trigger in place', () => {
    const s = setup();
    const e1 = s.at(NOW - 200 * DAY, {
      agent: 'titan',
      type: 'tool_result',
      data: { callId: 'a', tool: 'vault_read', ok: true },
    });
    const e2 = s.at(NOW - 199 * DAY, {
      agent: 'titan',
      type: 'tool_result',
      data: { callId: 'b', tool: 'vault_read', ok: true },
    });
    let calls = 0;
    const failing: Db = {
      ...s.db,
      path: s.db.path,
      prepare: (sql) => s.db.prepare(sql),
      exec: (sql) => s.db.exec(sql),
      get: (sql, ...p) => s.db.get(sql, ...p),
      all: (sql, ...p) => s.db.all(sql, ...p),
      transaction: (fn) => s.db.transaction(fn),
      close: () => s.db.close(),
      run: (sql, ...p) => {
        if (sql.startsWith('DELETE') && ++calls === 2) throw new Error('disk full');
        return s.db.run(sql, ...p);
      },
    };
    expect(() => deleteArchivedEvents(failing, [e1.id, e2.id])).toThrow('disk full');
    expect(s.log.get(e1.id)).toBeDefined();
    expect(appendOnlyTriggers(s.db)).toBe(true);
    expect(() => s.db.run('DELETE FROM events WHERE id = ?', e1.id)).toThrow(/append-only/);
  });

  it('copies the database before the first archive and drops the copy after a later one works', async () => {
    const s = setup();
    history(s);
    const archiver = s.archiver();
    const first = await archiver.run();
    const copy = archiver.backupPath;
    expect(first.backup).toBe(copy);
    expect(existsSync(copy)).toBe(true);
    if (POSIX) expect(statSync(copy).mode & 0o777).toBe(0o600);
    // The copy has the log as it was before the first archive.
    const old = openDb(copy);
    expect(
      old.get<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE type = 'tool_result'")?.n,
    ).toBe(3);
    old.close();

    // A pass with nothing to move keeps it…
    await s.archiver().run();
    expect(existsSync(copy)).toBe(true);
    // …one that moves events again drops it.
    s.at(NOW - 150 * DAY, {
      agent: 'titan',
      type: 'tool_result',
      data: { callId: 'late', tool: 'vault_read', ok: true },
    });
    const later = await s.archiver().run();
    expect(later.events).toBe(1);
    expect(later.backup).toBeUndefined();
    expect(existsSync(copy)).toBe(false);
  });

  it('the automatic pass: on by default, once a day, waits for a quiet core before the first copy', async () => {
    const s = setup();
    history(s);
    expect(s.archiver({ enabled: false }).due()).toBe(false);
    let busy = true;
    const archiver = s.archiver({ idle: () => !busy });
    expect(archiver.due()).toBe(true);
    await expect(archiver.run({ automatic: true, vacuum: 'auto' })).rejects.toThrow(/working/);
    expect(existsSync(archiver.backupPath)).toBe(false);
    expect(archiver.status().lastError).toBeNull();
    busy = false;
    const r = await archiver.run({ automatic: true, vacuum: 'auto' });
    expect(r.events).toBeGreaterThan(0);
    // Little freed space: no VACUUM in the automatic pass.
    expect(r.vacuum).toBe('skipped');
    expect(archiver.due()).toBe(false);
    s.clock.now = NOW + DAY;
    expect(archiver.due()).toBe(true);
  });

  it('VACUUM on request gives the space back', async () => {
    const s = setup();
    for (let i = 0; i < 300; i++) {
      s.at(NOW - 200 * DAY + i, {
        agent: 'titan',
        type: 'tool_result',
        data: { callId: `c${i}`, tool: 'vault_read', ok: true, output: big(5000) },
      });
    }
    const size = () => statSync(s.db.path).size;
    s.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const before = size();
    const r = await s.archiver().run({ vacuum: true });
    expect(r.events).toBe(300);
    expect(r.vacuum).toBe('done');
    expect(size()).toBeLessThan(before / 2);
    expect(appendOnlyTriggers(s.db)).toBe(true);
  });
});

/** Files under `dir` this process holds open (Linux, from /proc/self/fd); null elsewhere. */
function openFilesUnder(dir: string): string[] | null {
  if (!existsSync('/proc/self/fd')) return null;
  const out: string[] = [];
  for (const fd of readdirSync('/proc/self/fd')) {
    try {
      const target = readlinkSync(`/proc/self/fd/${fd}`);
      if (target.startsWith(dir)) out.push(target);
    } catch {
      // closed meanwhile
    }
  }
  return out;
}

describe('LogArchiver, review of 19/10', () => {
  it('keeps the streamed text of an answer that was stopped or failed (n. 7)', async () => {
    const s = setup();
    const t = NOW - 200 * DAY;
    const chunk = (ts: number, runId: string, text: string) =>
      s.at(ts, {
        agent: 'titan',
        runId,
        type: 'message',
        data: { role: 'agent', text, partial: true },
      }).id;
    // Stopped mid-answer: the closing message is empty, the chunks are the only text.
    const stopped = chunk(t, 'stop', 'Sto scrivendo il po');
    s.at(t + 1, {
      agent: 'titan',
      runId: 'stop',
      type: 'message',
      data: { role: 'agent', text: '', status: 'aborted' },
    });
    // A message with words, then more chunks of a failed step: those stay too.
    const given = chunk(t + 2, 'mixed', 'Prima parte');
    s.at(t + 3, {
      agent: 'titan',
      runId: 'mixed',
      type: 'message',
      data: { role: 'agent', text: 'Prima parte' },
    });
    const lost = chunk(t + 4, 'mixed', 'Seconda parte interr');
    // Another monster's answer in the same run does not count for Titan's chunks.
    const other = chunk(t + 5, 'shared', 'Mia risposta');
    s.at(t + 6, {
      agent: 'rhea',
      runId: 'shared',
      type: 'message',
      data: { role: 'agent', text: 'Risposta di Rhea' },
    });

    const r = await s.archiver().run();
    expect(r.types['message']?.events).toBe(1);
    expect(s.log.get(given)).toBeUndefined();
    for (const id of [stopped, lost, other]) expect(s.log.get(id)).toBeDefined();
  });

  it('a VACUUM that fails leaves the archive done, is said once and backs off (n. 3)', async () => {
    const s = setup();
    for (let i = 0; i < 50; i++) {
      s.at(NOW - 200 * DAY + i, {
        agent: 'titan',
        type: 'tool_result',
        data: { callId: `c${i}`, tool: 'vault_read', ok: true, output: big(20_000) },
      });
    }
    let tries = 0;
    const archiver = s.archiver({
      vacuum: () => {
        tries++;
        throw new Error('database or disk is full');
      },
    });
    const r = await archiver.run({ vacuum: true });
    expect(r.events).toBe(50);
    expect(r.vacuum).toBe('failed');
    expect(archiver.status()).toMatchObject({
      lastRunAt: NOW,
      lastError: null,
      vacuumError: 'database or disk is full',
    });
    expect(archiver.due()).toBe(false);
    const said = () =>
      s.log
        .query({ type: 'error' })
        .filter((e) => e.type === 'error' && e.data.code === 'log_vacuum_failed');
    expect(said()).toHaveLength(1);
    expect(s.log.query({ type: 'log_archive' })).toHaveLength(1);

    // The next automatic VACUUM waits a day after the first failure, then two, …
    s.clock.now = NOW + 3_600_000;
    s.at(NOW - 190 * DAY, {
      agent: 'titan',
      type: 'tool_result',
      data: { callId: 'x', tool: 'vault_read', ok: true, output: big(5000) },
    });
    s.clock.now = NOW + 3_600_000;
    expect((await archiver.run({ automatic: true, vacuum: true })).vacuum).toBe('skipped');
    expect(tries).toBe(1);
    s.clock.now = NOW + DAY;
    expect((await archiver.run({ automatic: true, vacuum: true })).vacuum).toBe('failed');
    expect(tries).toBe(2);
    expect(said()).toHaveLength(1);
    s.clock.now = NOW + 2 * DAY;
    expect((await archiver.run({ automatic: true, vacuum: true })).vacuum).toBe('skipped');
    expect(tries).toBe(2);
  });

  it('the first copy waits for room on the disk and for a quiet core, by hand too (n. 5)', async () => {
    const s = setup();
    history(s);
    const total = typesLeft(s.db);
    const full = s.archiver({ diskFree: () => 1024 });
    await expect(full.run()).rejects.toBeInstanceOf(ArchivePostponed);
    await expect(full.run()).rejects.toThrow(/disk space/);
    expect(existsSync(full.backupPath)).toBe(false);
    expect(existsSync(`${full.backupPath}.tmp`)).toBe(false);
    expect(typesLeft(s.db)).toEqual(total);
    const busy = s.archiver({ idle: () => false });
    await expect(busy.run()).rejects.toThrow(/working/);
    expect(typesLeft(s.db)).toEqual(total);
    // With room and no monster at work it goes.
    const r = await s.archiver({ diskFree: () => 10 * 1024 ** 3, idle: () => true }).run();
    expect(r.backup).toBeDefined();
  });

  it('a monthly file that does not read back is set aside, said, and the archive goes on (n. 8)', async () => {
    const s = setup();
    history(s);
    const june = archiveFile(s.home, '2026-06');
    mkdirSync(dirname(june), { recursive: true });
    writeFileSync(june, 'not a gzip file');
    const r = await s.archiver().run();
    expect(r.months.map((m) => m.month)).toEqual(['2026-06', '2026-07']);
    expect(fileLines(june)).toHaveLength(7);
    const aside = readdirSync(dirname(june)).filter((f) => f.includes('.damaged-'));
    expect(aside).toEqual([`events-2026-06.jsonl.gz.damaged-${NOW}`]);
    expect(readFileSync(join(dirname(june), aside[0]!), 'utf8')).toBe('not a gzip file');
    const said = s.log
      .query({ type: 'error' })
      .filter((e) => e.type === 'error' && e.data.code === 'log_archive_damaged');
    expect(said).toHaveLength(1);
    expect(
      s
        .archiver()
        .status()
        .months.map((m) => m.month),
    ).toEqual(['2026-06', '2026-07']);
  });

  it('one pass by hand an hour, none after stop (n. 9)', async () => {
    const s = setup();
    history(s);
    const archiver = s.archiver();
    await archiver.run();
    await expect(archiver.run()).rejects.toBeInstanceOf(ArchiveRefused);
    // Dry runs and the automatic pass are not passes by hand.
    await archiver.run({ dryRun: true });
    await archiver.run({ automatic: true });
    // Asked together: one pass, the other refused.
    s.clock.now = NOW + 3_600_000;
    const both = await Promise.allSettled([archiver.run(), archiver.run()]);
    expect(both.map((b) => b.status).sort()).toEqual(['fulfilled', 'rejected']);
    await archiver.stop();
    s.clock.now = NOW + 3 * 3_600_000;
    await expect(archiver.run({ automatic: true })).rejects.toThrow(/stopping/);
  });

  it('leaves no file of the archive open after a pass (Windows could not rename or delete it)', async () => {
    const s = setup();
    history(s);
    await s.archiver().run();
    // Again on the same month, reading the file back, and once more over a damaged one.
    s.at(NOW - 121 * DAY, {
      agent: 'titan',
      type: 'tool_result',
      data: { callId: 'z', tool: 'vault_list', ok: true, output: 'late' },
    });
    await s.archiver().run();
    writeFileSync(archiveFile(s.home, '2026-07'), 'broken');
    s.at(NOW - 95 * DAY, {
      agent: 'titan',
      type: 'tool_result',
      data: { callId: 'y', tool: 'vault_list', ok: true, output: 'later' },
    });
    await s.archiver().run();
    await readArchiveMonth(s.home, '2026-06');
    // The reader closes its file before it ends, read whole or left half-way.
    const june = archiveFile(s.home, '2026-06');
    for await (const line of readArchiveLines(june)) expect(line).toBeTruthy();
    expect(openFilesUnder(archiveDir(s.home)) ?? []).toEqual([]);
    for await (const line of readArchiveLines(june)) if (line) break;
    expect(openFilesUnder(archiveDir(s.home)) ?? []).toEqual([]);
    const open = openFilesUnder(s.home);
    if (open) {
      expect(open.filter((f) => !/monsters\.db(-wal|-shm)?$/.test(f))).toEqual([]);
    }
    // Every file of the archive and the copy can be renamed and deleted.
    for (const f of readdirSync(archiveDir(s.home))) {
      const path = join(archiveDir(s.home), f);
      renameSync(path, `${path}.moved`);
      rmSync(`${path}.moved`);
    }
  });
});

describe('the archive in the core', () => {
  it('GET and POST /api/log/archive: status, a dry run and a pass from the terminal', async () => {
    const hub = await startTestHub({}, { withoutTeam: true });
    const old = Date.now() - 200 * DAY;
    for (let i = 0; i < 3; i++) {
      hub.core.db.run(
        'INSERT INTO events (id, ts, agent, run_id, parent_id, type, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ulid(old + i),
        old + i,
        'titan',
        'r-old',
        null,
        'tool_result',
        // Big enough to free whole pages: the VACUUM has something to give back.
        JSON.stringify({ callId: `c${i}`, tool: 'vault_read', ok: true, output: big(20_000) }),
      );
    }
    const empty = await hub.json<LogArchiveStatus>('GET', '/api/log/archive');
    expect(empty).toMatchObject({ enabled: true, days: 90, months: [], lastRunAt: null });
    expect(empty.dir).toBe(join(hub.core.config.home, 'archive'));

    const dry = await hub.json<LogArchiveResult>('POST', '/api/log/archive', { dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, events: 3 });
    const done = await hub.json<LogArchiveResult>('POST', '/api/log/archive', { vacuum: true });
    expect(done).toMatchObject({ dryRun: false, events: 3 });
    // With the terminal's token, no VACUUM (review of 19/10, n. 9): the automatic pass does it.
    expect(done.vacuum).toBe('skipped');
    // One pass by hand an hour, whoever asks; a dry run is not one.
    const again = await hub.api('POST', '/api/log/archive', {});
    expect(again.status).toBe(429);
    expect(((await again.json()) as { message: string }).message).toContain('ogni ora');
    expect((await hub.api('POST', '/api/log/archive', { dryRun: true })).status).toBe(200);

    const status = await hub.json<LogArchiveStatus>('GET', '/api/log/archive');
    expect(status.months.map((m) => m.month)).toEqual([archiveMonthOf(old)]);
    expect(hub.core.log.query({ type: 'log_archive' })[0]?.data).toMatchObject({
      events: 3,
      by: 'cli',
    });
    expect(appendOnlyTriggers(hub.core.db)).toBe(true);
  });
});
