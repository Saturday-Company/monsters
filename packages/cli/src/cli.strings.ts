import { pick } from '@monsters/shared';

/*
 * The CLI's own texts that depend on the app's language (D-153): the log archive and the
 * automations. `run` (main.ts) reads the language from the data folder's settings.json.
 */

const en = {
  // monsters log
  nothingToArchive: (day: string) => `Nothing to archive: no bulky event older than ${day}.`,
  eventsOlder: (dry: boolean, n: number, size: string, day: string, dir: string | null) =>
    `${dry ? 'To archive' : 'Archived'} ${n} ${n === 1 ? 'event' : 'events'} (${size} of data) older than ${day}${
      dir ? ` in ${dir}` : ''
    }:`,
  monthLine: (month: string, n: number, size: string) =>
    `  ${month}  ${n} ${n === 1 ? 'event' : 'events'}  ${size}`,
  byType: (types: string) => `By type: ${types}`,
  vacuumDone: 'Database compacted (VACUUM): the free space went back to the disk.',
  vacuumSkipped:
    'VACUUM not done: little space to recover, a monster is working, or Monsters is running (it does it itself, when the monsters are stopped).',
  vacuumFailed:
    'Archive done, but the VACUUM failed (disk space, database busy): it will be tried again later.',
  backup: (path: string) =>
    `Copy of the database before the first archive: ${path} (removed at the next successful archive).`,
  toolOk: 'ok',
  toolError: (error: string) => `error ${error}`,
  autoArchiveOn: (days: number) =>
    `Automatic archive: on, bulky events older than ${days} days (once a day).`,
  autoArchiveOff:
    'Automatic archive: off (settings.json → logArchive.enabled); "monsters log archive" does it by hand.',
  noArchives: (dir: string) => `No archives in ${dir}.`,
  archivesIn: (dir: string) => `Archives in ${dir}:`,
  readOne: 'To read one: monsters log read --month YYYY-MM',
  noDatabase: (home: string) => `No database in ${home}: nothing to archive.`,
  whichMonth: 'Which month? monsters log read --month YYYY-MM',
  noArchiveFor: (month: string, dir: string, have: string[]) =>
    `No archive for ${month} in ${dir}${have.length ? ` (there are: ${have.join(', ')})` : ''}.`,
  unknownLog: (sub: string) => `unknown command: log ${sub} (status, archive, read)`,
  // monsters automations
  runStates: {
    waiting_lead: 'waiting for the lead to be free',
    running: 'running',
    waiting_user: 'waiting for an answer',
    completed: 'done',
    failed: 'failed',
    aborted: 'stopped',
    skipped: 'skipped',
  } as Record<string, string>,
  statuses: { active: 'active', paused: 'paused', draft: 'draft' } as Record<string, string>,
  noAutomations: 'No automations.',
  automationLine: (schedule: string, lead: string, next: string, last: string | null) =>
    `  ${schedule} · lead: ${lead} · next: ${next}${last ? ` · last run: ${last}` : ''}`,
  runStarted: (runId: string) => `Run started (run ${runId}).`,
  leadBusy: 'The lead is working: the run starts as soon as it is free.',
};

const it: typeof en = {
  nothingToArchive: (day) =>
    `Niente da archiviare: nessun evento voluminoso più vecchio del ${day}.`,
  eventsOlder: (dry, n, size, day, dir) =>
    `${dry ? 'Da archiviare' : 'Archiviati'} ${n} eventi (${size} di dati) più vecchi del ${day}${
      dir ? ` in ${dir}` : ''
    }:`,
  monthLine: (month, n, size) => `  ${month}  ${n} eventi  ${size}`,
  byType: (types) => `Per tipo: ${types}`,
  vacuumDone: 'Database compattato (VACUUM): lo spazio libero è tornato al disco.',
  vacuumSkipped:
    'VACUUM non fatto: poco spazio da recuperare, un mostro sta lavorando, o Monsters è acceso (lo fa lui, a mostri fermi).',
  vacuumFailed:
    'Archivio fatto, ma il VACUUM non è riuscito (spazio su disco, database occupato): si riprova più avanti.',
  backup: (path) =>
    `Copia del database prima del primo archivio: ${path} (tolta al prossimo archivio riuscito).`,
  toolOk: 'ok',
  toolError: (error) => `errore ${error}`,
  autoArchiveOn: (days) =>
    `Archivio automatico: acceso, eventi voluminosi più vecchi di ${days} giorni (una volta al giorno).`,
  autoArchiveOff:
    'Archivio automatico: spento (settings.json → logArchive.enabled); "monsters log archive" lo fa a mano.',
  noArchives: (dir) => `Nessun archivio in ${dir}.`,
  archivesIn: (dir) => `Archivi in ${dir}:`,
  readOne: 'Per leggerne uno: monsters log read --month AAAA-MM',
  noDatabase: (home) => `Nessun database in ${home}: niente da archiviare.`,
  whichMonth: 'Quale mese? monsters log read --month AAAA-MM',
  noArchiveFor: (month, dir, have) =>
    `Nessun archivio per ${month} in ${dir}${have.length ? ` (ci sono: ${have.join(', ')})` : ''}.`,
  unknownLog: (sub) => `comando sconosciuto: log ${sub} (status, archive, read)`,
  runStates: {
    waiting_lead: 'aspetta che il capo si liberi',
    running: 'in corso',
    waiting_user: 'aspetta una risposta',
    completed: 'finito',
    failed: 'non riuscito',
    aborted: 'fermato',
    skipped: 'saltato',
  },
  statuses: { active: 'attiva', paused: 'in pausa', draft: 'bozza' },
  noAutomations: 'Nessuna automazione.',
  automationLine: (schedule, lead, next, last) =>
    `  ${schedule} · capo: ${lead} · prossimo: ${next}${last ? ` · ultimo giro: ${last}` : ''}`,
  runStarted: (runId) => `Giro avviato (run ${runId}).`,
  leadBusy: 'Il capo sta lavorando: il giro parte appena è libero.',
};

export const cliStrings = () => pick({ en, it });
