import type { LogArchiveStatus } from '@monsters/shared';
import { useEffect, useState } from 'react';
import { getApi } from '../../store/app.ts';

/**
 * At the end of the Attività, once nothing older is left to load: the bulky old events
 * (usage, results of the tools, streamed text) moved to the monthly files of the archive
 * (log/archive.ts of the core). Nothing when there is no archive yet.
 */
export function ArchiveNote() {
  const [status, setStatus] = useState<LogArchiveStatus | null>(null);
  useEffect(() => {
    let live = true;
    getApi()
      .logArchive()
      .then((s) => {
        if (live) setStatus(s);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!status || status.months.length === 0) return null;
  const first = status.months[0]!.month;
  return (
    <p
      className="mx-auto max-w-prose pt-6 text-center text-caption text-ink-muted"
      data-testid="activity-archived"
    >
      Gli eventi più vecchi di {status.days} giorni che pesano di più (consumi, risultati degli
      strumenti, testo in arrivo) sono archiviati in{' '}
      <span className="font-mono break-all">{status.dir}</span>, un file al mese dal {first}. Dal
      terminale: <span className="font-mono">monsters log read --month AAAA-MM</span>.
    </p>
  );
}
