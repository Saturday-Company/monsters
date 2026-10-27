import { CaretDown } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { CHANGELOG } from '../../lib/changelog-data.ts';
import { unwrapMarkdown, type ChangelogVersion } from '../../lib/changelog.ts';
import { cn } from '../../lib/utils.ts';
import { useApp } from '../../store/app.ts';
import { markNewsSeen } from '../../store/news.ts';
import { Markdown } from '../ui/Markdown.tsx';
import { shellStrings } from './shell.strings.ts';

/*
 * "News" (docs/design.md, "The top rail"): what changed from one update to the next, from
 * CHANGELOG.md bundled into the app. It is the second tab of the Inbox; the light on the Inbox key
 * (and on the tab) stays on while the version in use is newer than the last one whose news were
 * opened (per browser).
 */

function VersionRow({
  entry,
  current,
  open,
  onToggle,
}: {
  entry: ChangelogVersion;
  current: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const id = `news-${entry.version.replace(/[^\w-]/g, '-')}`;
  const s = shellStrings().news;
  return (
    <li data-testid="news-version" data-version={entry.version} data-current={current || undefined}>
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className="key-ghost flex min-h-11 w-full items-center gap-2 rounded-[9px] px-1.5 py-2 text-left hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink"
        >
          <CaretDown
            size={14}
            weight="bold"
            aria-hidden
            className={cn('shrink-0 text-ink-muted transition-transform', !open && '-rotate-90')}
          />
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-callout font-medium break-words text-ink">
              {entry.version}
            </span>
            {entry.date && <span className="block text-footnote text-ink-muted">{entry.date}</span>}
          </span>
          {current && (
            <span className="label inline-flex shrink-0 items-center gap-1.5 text-ink">
              <span aria-hidden className="led" data-tone="signal" />
              {s.inUse}
            </span>
          )}
        </button>
      </h3>
      {open && (
        <div id={id} className="px-1.5 pt-1 pb-4">
          {entry.intro && <Markdown text={unwrapMarkdown(entry.intro)} className="mb-3 text-ink" />}
          {entry.sections.map((section) => (
            <section key={section.title} className="mb-3 last:mb-0">
              <h4 className="label pb-1 text-ink-muted">{section.title}</h4>
              <Markdown text={unwrapMarkdown(section.markdown)} className="text-ink" />
            </section>
          ))}
        </div>
      )}
    </li>
  );
}

/** The news tab of the Inbox: the versions, the one in use open. */
export function NewsList() {
  const s = shellStrings().news;
  const version = useApp((s) => s.version);
  // The version in use opens first; when the changelog does not list it, the newest does.
  const currentKey = CHANGELOG.some((v) => v.version === version) ? version : CHANGELOG[0]?.version;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Looking at the tab is what turns the light off.
  useEffect(() => {
    markNewsSeen(version);
  }, [version]);

  return (
    <div data-testid="news-panel">
      {version && (
        <p className="px-1 pb-4 text-footnote text-ink-muted" data-testid="news-using">
          {s.using(version)}
        </p>
      )}
      {CHANGELOG.length === 0 ? (
        <p className="px-1 text-body text-ink-muted">{s.none}</p>
      ) : (
        <ul className="tape">
          {CHANGELOG.map((entry) => (
            <VersionRow
              key={entry.version}
              entry={entry}
              current={entry.version === version}
              open={expanded[entry.version] ?? entry.version === currentKey}
              onToggle={() =>
                setExpanded((m) => ({
                  ...m,
                  [entry.version]: !(m[entry.version] ?? entry.version === currentKey),
                }))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
