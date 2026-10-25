import { CaretDown, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { CHANGELOG } from '../../lib/changelog-data.ts';
import { unwrapMarkdown, type ChangelogVersion } from '../../lib/changelog.ts';
import { cn } from '../../lib/utils.ts';
import { setNewsOpen, useApp } from '../../store/app.ts';
import { hasNews, markNewsSeen, useNews } from '../../store/news.ts';
import { useLayer } from '../ui/layers.ts';
import { Markdown } from '../ui/Markdown.tsx';
import { shellStrings } from './shell.strings.ts';

/*
 * "Novità" (docs/design.md, "La chat"): what changed from one update to the
 * next, from CHANGELOG.md bundled into the app. A key beside "Da rivedere"
 * opens a sheet in the same place; the key shows a light while the version in
 * use is newer than the last one whose news were opened (per browser).
 */

/**
 * The key of the rail: opens the sheet. While the version in use has news that were not looked at it
 * is the TV news bug, "NEWS" on a block of signal orange with its light; otherwise it is a quiet key
 * with the same word, like its neighbours (never a greyed block that reads as disabled). With
 * `hideQuiet` (a narrow rail) the quiet key is not drawn: the palette still opens the sheet.
 */
export function NewsKey({
  layout,
  hideQuiet = false,
}: {
  layout: 'inline' | 'stacked' | 'icon';
  hideQuiet?: boolean;
}) {
  const open = useApp((s) => s.newsOpen);
  const version = useApp((s) => s.version);
  const seen = useNews((s) => s.seen);
  const fresh = hasNews(version, seen);
  const s = shellStrings().news;
  if (hideQuiet && !fresh && !open) return null;
  return (
    <button
      type="button"
      aria-label={fresh ? s.labelFresh : s.label}
      title={s.title}
      aria-pressed={open}
      data-testid="news-toggle"
      data-fresh={fresh ? '' : undefined}
      onClick={() => setNewsOpen(!open)}
      className={cn(
        'key-ghost relative inline-flex shrink-0 items-center justify-center rounded-[9px] select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink',
        layout === 'stacked' ? 'h-11 min-w-11 px-1.5' : 'h-9 px-2.5',
        open && 'well hover:bg-well',
      )}
    >
      {fresh ? (
        <span
          aria-hidden
          // Signal orange is the one action colour: the bug wears it only while there is something new.
          className="inline-flex h-[18px] items-center rounded-[3px] bg-signal px-1.5 font-sans text-micro leading-none font-extrabold tracking-[0.08em] text-on-signal italic"
        >
          NEWS
        </span>
      ) : (
        <span aria-hidden className="label text-ink-muted">
          NEWS
        </span>
      )}
      {fresh && (
        <span
          aria-hidden
          data-testid="news-led"
          className="led absolute top-1 right-0.5 block size-1.5"
          data-tone="signal"
        />
      )}
    </button>
  );
}

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

/** Opens "Novità" (the palette). */
export function showNews(): void {
  setNewsOpen(true);
}

/** The sheet: mounted by the shell, shown while `newsOpen`. */
export function NewsSheet() {
  const s = shellStrings().news;
  const open = useApp((s) => s.newsOpen);
  const version = useApp((s) => s.version);
  const sheet = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The version in use opens first; when the changelog does not list it, the newest does.
  const currentKey = CHANGELOG.some((v) => v.version === version) ? version : CHANGELOG[0]?.version;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) markNewsSeen(version);
  }, [open, version]);
  // Not modal: Escape closes it only when it is the top layer; the focus goes to its close key and
  // comes back to the key that opened it.
  useLayer({
    open,
    ref: sheet,
    initialFocus: closeRef,
    onEscape: () => setNewsOpen(false),
  });

  if (!open) return null;
  return (
    <aside
      ref={sheet}
      role="dialog"
      aria-modal="false"
      aria-label={s.label}
      data-testid="news-sheet"
      className={cn(
        'review-sheet slide-in raised fixed inset-x-0 top-[52px] bottom-0 z-30 flex flex-col overflow-hidden rounded-none',
        'sm:top-[60px] sm:right-3 sm:bottom-3 sm:left-auto sm:w-[380px] sm:rounded-[14px]',
      )}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={() => setNewsOpen(false)}
        aria-label={s.close}
        title={s.closeTitle}
        className="key-ghost absolute top-3 right-3 z-[1] inline-flex size-9 items-center justify-center rounded-[9px] text-ink-muted hover:text-ink"
      >
        <X size={18} weight="bold" aria-hidden />
      </button>
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <h2 className="px-1 pr-12 text-title3 font-semibold text-ink">{s.label}</h2>
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
    </aside>
  );
}
