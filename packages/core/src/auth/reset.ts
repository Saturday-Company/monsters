import { existsSync } from 'node:fs';
import { homePaths } from '../config.ts';
import { migrate } from '../db/migrations.ts';
import { coreMigrations } from '../db/schema.ts';
import { openDb } from '../db/sqlite.ts';
import { acquireHomeLock } from '../home-lock.ts';
import { EventLog } from '../log/event-log.ts';
import { AuthError, AuthService } from './auth-service.ts';

/*
 * `monsters password` while the core is stopped: the data folder is opened
 * directly (whoever can read it is the user), under the lock of the data
 * directory so no core starts meanwhile. With the core running the CLI asks it
 * instead (`POST /api/auth/password/reset` with the CLI token).
 */

/** Sets a new password in a stopped core's data directory. Returns how many sessions were closed. */
export async function resetPasswordOffline(home: string, password: string): Promise<number> {
  const paths = homePaths(home);
  if (!existsSync(paths.db)) throw new AuthError('no_account', 'no local user yet');
  const lock = acquireHomeLock(home);
  try {
    const db = openDb(paths.db);
    try {
      migrate(db, 'core', coreMigrations);
      const log = new EventLog(db);
      const auth = new AuthService(db, log, { sessionTtlMs: 0, cliTokenPath: paths.cliToken });
      return (await auth.resetPassword(password, 'cli')).length;
    } finally {
      db.close();
    }
  } finally {
    lock.release();
  }
}
