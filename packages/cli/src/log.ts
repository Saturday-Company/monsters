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
  const verb = r.dryRun ? 'Da archiviare' : 'Archiviati';
  if (r.events === 0) {
    io.out(`Niente da archiviare: nessun evento voluminoso più vecchio del ${day(r.before)}.`);
  } else {
    io.out(
      `${verb} ${r.events} eventi (${mb(r.bytes)} di dati) più vecchi del ${day(r.before)}${
        r.dryRun ? '' : ` in ${dir}`
      }:`,
    );
    for (const m of r.months) io.out(`  ${m.month}  ${m.events} eventi  ${mb(m.bytes)}`);
    const types = Object.entries(r.types)
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .map(([t, v]) => `${t} ${v.events} (${mb(v.bytes)})`);
    io.out(`Per tipo: ${types.join(', ')}`);
  }
  if (r.vacuum === 'done')
    io.out('Database compattato (VACUUM): lo spazio libero è tornato al disco.');
  if (r.vacuum === 'skipped')
    io.out(
      'VACUUM non fatto: poco spazio da recuperare, un mostro sta lavorando, o il core è acceso (lo fa lui, a mostri fermi).',
    );
  if (r.vacuum === 'failed')
    io.out(
      'Archivio fatto, ma il VACUUM non è riuscito (spazio su disco, database occupato): si riprova più avanti.',
    );
  if (r.backup)
    io.out(
      `Copia del database prima del primo archivio: ${r.backup} (tolta al prossimo archivio riuscito).`,
    );
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
      what = `${s(d['tool'])} ${d['ok'] === true ? 'ok' : `errore ${s(d['error'])}`}`;
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
    io.out(
      settings.enabled
        ? `Archivio automatico: acceso, eventi voluminosi più vecchi di ${settings.days} giorni (una volta al giorno).`
        : 'Archivio automatico: spento (settings.json → logArchive.enabled); "monsters log archive" lo fa a mano.',
    );
    if (months.length === 0) {
      io.out(`Nessun archivio in ${dir}.`);
      return 0;
    }
    io.out(`Archivi in ${dir}:`);
    for (const m of months) io.out(`  ${m.month}  ${mb(m.bytes)}`);
    io.out('Per leggerne uno: monsters log read --month AAAA-MM');
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
      io.err(`Nessun database in ${o.home}: niente da archiviare.`);
      return 1;
    }
    if (o.json) io.out(JSON.stringify(result));
    else printResult(io, result, dir);
    return 0;
  }

  if (sub === 'read') {
    const month = ArchiveMonthSchema.safeParse(o.month ?? args[1]);
    if (!month.success) {
      io.err('Quale mese? monsters log read --month AAAA-MM');
      return 2;
    }
    const file = archiveFile(o.home, month.data);
    if (!existsSync(file)) {
      const have = archiveMonths(o.home).map((m) => m.month);
      io.err(
        `Nessun archivio per ${month.data} in ${dir}${have.length ? ` (ci sono: ${have.join(', ')})` : ''}.`,
      );
      return 1;
    }
    const types = o.type ? new Set(o.type.split(',').map((t) => t.trim())) : null;
    for (const e of await readArchiveMonth(o.home, month.data)) {
      if (types && !types.has(e.type)) continue;
      io.out(o.json ? JSON.stringify(e) : describe(e));
    }
    return 0;
  }

  io.err(`comando sconosciuto: log ${sub} (status, archive, read)`);
  return 2;
}
