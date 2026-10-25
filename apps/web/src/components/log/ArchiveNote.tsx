import type { LogArchiveStatus } from '@monsters/shared';
import { useEffect, useState } from 'react';
import { getApi } from '../../store/app.ts';
import { usePrefs } from '../../store/prefs.ts';
import { logStrings } from './log.strings.ts';

/**
 * At the end of the Attività, once nothing older is left to load: the bulky old events
 * (usage, results of the tools, streamed text) moved to the monthly files of the archive
 * (log/archive.ts of the core). Nothing when there is no archive yet. The folder and the
 * command to read a month show only with the technical details on.
 */
export function ArchiveNote() {
  const [status, setStatus] = useState<LogArchiveStatus | null>(null);
  const details = usePrefs((p) => p.showDetails);
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
  const s = logStrings().archive;
  return (
    <p
      className="mx-auto max-w-prose pt-6 text-center text-caption text-ink-muted"
      data-testid="activity-archived"
    >
      {details ? (
        <>
          {s.intro(status.days)} <span className="font-mono break-all">{status.dir}</span>
          {s.outro(first)} <span className="font-mono">{s.command}</span>.
        </>
      ) : (
        s.short(status.days, first)
      )}
    </p>
  );
}
