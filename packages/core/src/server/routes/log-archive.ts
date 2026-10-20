import { LogArchiveRequestSchema } from '@monsters/shared';
import type { Hono } from 'hono';
import { ArchivePostponed, ArchiveRefused, type LogArchiver } from '../../log/archive.ts';
import type { AppEnv, RouteHelpers } from '../app.ts';

/*
 * Archive of the event log (contract in shared/src/log-archive.ts): where the monthly files are
 * and a pass now (`monsters log archive`). The pass moves events, it never loses them: the
 * terminal's token may ask for it, at most once an hour (each pass may block the core for a
 * while), and without the VACUUM, which the automatic pass does with no monster at work
 * (review of 19/10, n. 9).
 */

export function registerLogArchiveRoutes(
  app: Hono<AppEnv>,
  h: RouteHelpers,
  deps: { archiver: LogArchiver },
): void {
  const { requireAuth, parseBody, channelOf } = h;
  const { archiver } = deps;

  app.get('/api/log/archive', requireAuth, (c) => c.json(archiver.status()));

  app.post('/api/log/archive', requireAuth, async (c) => {
    const body = await parseBody(c, LogArchiveRequestSchema);
    if (!body.ok) return body.res;
    const auth = c.get('auth');
    try {
      const result = await archiver.run({
        ...(body.data.dryRun ? { dryRun: true } : {}),
        ...(body.data.vacuum && auth.via !== 'token' ? { vacuum: true } : {}),
        by: channelOf(auth),
      });
      if (body.data.vacuum && !body.data.dryRun && result.vacuum === undefined) {
        result.vacuum = 'skipped';
      }
      return c.json(result);
    } catch (err) {
      if (err instanceof ArchiveRefused) {
        if (err.code === 'too_soon') {
          c.header('retry-after', String(Math.ceil(err.retryAfterMs / 1000)));
          return c.json(
            {
              error: 'archive_too_soon',
              message: `Un archivio a mano al massimo ogni ora: riprova tra ${Math.ceil(
                err.retryAfterMs / 60_000,
              )} minuti.`,
            },
            429,
          );
        }
        return c.json({ error: 'stopping', message: 'Monsters si sta fermando.' }, 503);
      }
      if (err instanceof ArchivePostponed) {
        return c.json(
          {
            error: 'archive_postponed',
            message: `Archivio rimandato, niente è cambiato: ${err.message}.`,
          },
          409,
        );
      }
      return c.json(
        {
          error: 'archive_failed',
          message: `Archivio non riuscito (nessun evento perso: quelli non scritti nel file restano nel registro): ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
        500,
      );
    }
  });
}
