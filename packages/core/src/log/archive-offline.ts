import { existsSync } from 'node:fs';
import type { LogArchiveResult } from '@monsters/shared';
import { homePaths } from '../config.ts';
import { migrate } from '../db/migrations.ts';
import { coreMigrations } from '../db/schema.ts';
import { openDb } from '../db/sqlite.ts';
import { StateStore } from '../db/state-store.ts';
import { acquireHomeLock } from '../home-lock.ts';
import { loadHubSettings } from '../team/settings.ts';
import { LogArchiver } from './archive.ts';
import { EventLog } from './event-log.ts';

/*
 * `monsters log archive` with the core stopped: the database is opened directly, under the lock
 * of the data directory (`HomeLockedError` when a core runs: the CLI asks it instead). Nothing
 * else works on it meanwhile, so the VACUUM never waits.
 */

/** One pass on a stopped core's data directory; null when there is no database yet. */
export async function archiveLogOffline(
  home: string,
  opts: { dryRun?: boolean; vacuum?: boolean } = {},
): Promise<LogArchiveResult | null> {
  const paths = homePaths(home);
  if (!existsSync(paths.db)) return null;
  const settings = loadHubSettings(home);
  const lock = acquireHomeLock(home);
  try {
    const db = openDb(paths.db);
    try {
      migrate(db, 'core', coreMigrations);
      const archiver = new LogArchiver({
        db,
        log: new EventLog(db),
        state: new StateStore(db),
        home,
        settings: () => settings.logArchive,
      });
      return await archiver.run({
        ...(opts.dryRun ? { dryRun: true } : {}),
        ...(opts.vacuum ? { vacuum: true } : {}),
        by: 'cli',
      });
    } finally {
      db.close();
    }
  } finally {
    lock.release();
  }
}
