import { existsSync } from 'node:fs';
import {
  archiveDir,
  archiveFile,
  archiveLogOffline,
  archiveMonths,
  HomeLockedError,
  loadHubSettings,
  readArchiveMonth,
} from '@monsters/core';
import { ArchiveMonthSchema, type LogArchiveResult, type LogEvent } from '@monsters/shared';
import { cliStrings } from './cli.strings.ts';
import type { Io } from './main.ts';

/*
 * `monsters log [status|archive|read]`: the archive of the event log (log/archive.ts of the
 * core). `archive` asks the running core, or works on the database itself when the core is
 * stopped; `read` and `status` only read the monthly files.
 */

type Request = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>;

export interface LogCommandOptions {
  home: string;
  /** The running core (the CLI token): used when the data directory is locked by it. */
  request: Request;
  month?: string | undefined;
  type?: string | undefined;
  dryRun?: boolean;
  json?: boolean;
}

function mb(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function printResult(io: Io, r: LogArchiveResult, dir: string): void {
  const t = cliStrings();
  if (r.events === 0) {
    io.out(t.nothingToArchive(day(r.before)));
  } else {
    io.out(t.eventsOlder(r.dryRun, r.events, mb(r.bytes), day(r.before), r.dryRun ? null : dir));
    for (const m of r.months) io.out(t.monthLine(m.month, m.events, mb(m.bytes)));
    const types = Object.entries(r.types)
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .map(([type, v]) => `${type} ${v.events} (${mb(v.bytes)})`);
    io.out(t.byType(types.join(', ')));
  }
  if (r.vacuum === 'done') io.out(t.vacuumDone);
  if (r.vacuum === 'skipped') io.out(t.vacuumSkipped);
  if (r.vacuum === 'failed') io.out(t.vacuumFailed);
  if (r.backup) io.out(t.backup(r.backup));
}

/** One line of an archived event: when, who, what. */
function describe(e: LogEvent): string {
  const d = e.data as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  let what: string;
  switch (e.type) {
    case 'provider_usage':
      what = `${s(d['provider'])}:${s(d['model'])}${
        typeof d['costUsd'] === 'number' ? ` $${d['costUsd'].toFixed(4)}` : ''
      }`;
      break;
    case 'tool_call':
      what = s(d['tool']);
      break;
    case 'tool_result':
      what = `${s(d['tool'])} ${d['ok'] === true ? cliStrings().toolOk : cliStrings().toolError(s(d['error']))}`;
      break;
    case 'message':
      what = s(d['text']).replace(/\s+/g, ' ').slice(0, 100);
      break;
    default:
      what = JSON.stringify(d).slice(0, 100);
  }
  const when = new Date(e.ts).toISOString().replace('T', ' ').slice(0, 19);
  return `${when}  ${e.agent}  ${e.type}  ${what}`;
}

export async function cmdLog(args: string[], o: LogCommandOptions, io: Io): Promise<number> {
  const [sub = 'status'] = args;
  const dir = archiveDir(o.home);

  if (sub === 'status') {
    const settings = loadHubSettings(o.home).logArchive;
    const months = archiveMonths(o.home);
    if (o.json) {
      io.out(JSON.stringify({ ...settings, dir, months: months.map(({ path: _p, ...m }) => m) }));
      return 0;
    }
    const t = cliStrings();
    io.out(settings.enabled ? t.autoArchiveOn(settings.days) : t.autoArchiveOff);
    if (months.length === 0) {
      io.out(t.noArchives(dir));
      return 0;
    }
    io.out(t.archivesIn(dir));
    for (const m of months) io.out(`  ${m.month}  ${mb(m.bytes)}`);
    io.out(t.readOne);
    return 0;
  }

  if (sub === 'archive') {
    let result: LogArchiveResult | null;
    try {
      result = await archiveLogOffline(o.home, {
        ...(o.dryRun ? { dryRun: true } : {}),
        vacuum: true,
      });
    } catch (err) {
      if (!(err instanceof HomeLockedError)) throw err;
      // The core runs: it does the pass (and the VACUUM only when no monster works).
      result = (await o.request('POST', '/api/log/archive', {
        ...(o.dryRun ? { dryRun: true } : {}),
        vacuum: true,
      })) as LogArchiveResult;
    }
    if (!result) {
      io.err(cliStrings().noDatabase(o.home));
      return 1;
    }
    if (o.json) io.out(JSON.stringify(result));
    else printResult(io, result, dir);
    return 0;
  }

  if (sub === 'read') {
    const month = ArchiveMonthSchema.safeParse(o.month ?? args[1]);
    if (!month.success) {
      io.err(cliStrings().whichMonth);
      return 2;
    }
    const file = archiveFile(o.home, month.data);
    if (!existsSync(file)) {
      const have = archiveMonths(o.home).map((m) => m.month);
      io.err(cliStrings().noArchiveFor(month.data, dir, have));
      return 1;
    }
    const types = o.type ? new Set(o.type.split(',').map((t) => t.trim())) : null;
    for (const e of await readArchiveMonth(o.home, month.data)) {
      if (types && !types.has(e.type)) continue;
      io.out(o.json ? JSON.stringify(e) : describe(e));
    }
    return 0;
  }

  io.err(cliStrings().unknownLog(sub));
  return 2;
}
