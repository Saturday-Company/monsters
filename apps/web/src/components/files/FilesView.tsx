import type { FileListQuery, FileMeta } from '@monsters/shared';
import { DownloadSimple, MagnifyingGlass, Paperclip, Trash, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { describeError } from '../../lib/api.ts';
import { formatSize, kindLabel, sourceText } from '../../lib/files.ts';
import { openChat } from '../../lib/router.ts';
import { cn, formatShortDay, formatTime } from '../../lib/utils.ts';
import { getApi, notify, useApp } from '../../store/app.ts';
import { useFiles } from '../../store/files.ts';
import { useAgent, useMediaQuery, useNameOf, useOrchestrator } from '../../store/hooks.ts';
import { openPreview } from '../../store/preview.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { downloadHref, downloadOnClick } from '../preview/files.ts';
import { ToolbarContent, ToolbarTitle } from '../shell/Toolbar.tsx';
import { LoadFailed, useRetry } from '../settings/parts.tsx';
import { Button } from '../ui/button.tsx';
import { Segmented } from '../ui/controls.tsx';
import { EmptyScreen } from '../ui/EmptyScreen.tsx';
import { FileThumb } from './FileChip.tsx';
import { afterRefresh, FILES_PAGE, nextPageQuery, withPage } from './file-pages.ts';
import { filesStrings } from './files.strings.ts';

/*
 * The File section (docs/design.md, "File"; D-075): every file of the user
 * and of the monsters, newest first, as a grid of tiles with the picture or the
 * small screen of the type, the name, size and date, and who made it. Filters
 * as joined keys, a search on the name and the text (with the piece of text
 * found, D-086), delete with "AGAIN" like Stop.
 * A press opens the preview on the right.
 */

type Filter = 'all' | 'images' | 'documents' | 'monsters';

const FILTER_VALUES: Filter[] = ['all', 'images', 'documents', 'monsters'];

function queryOf(filter: Filter, q: string): FileListQuery {
  return {
    ...(filter === 'images' ? { kind: 'image' as const } : {}),
    ...(filter === 'documents' ? { kind: 'documents' as const } : {}),
    ...(filter === 'monsters' ? { source: 'monsters' as const } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
    limit: FILES_PAGE,
  };
}

/** How long the delete key stays armed ("AGAIN"), as Stop. */
const ARMED_MS = 5000;
/** How long "Undo" stays on a deleted file (the core keeps it a little longer, U2-32). */
const UNDO_MS = 10_000;

/** "Undo" of a delete: the file comes back from the core's trash, in the list and in the chats. */
async function restoreFile(id: string, name: string): Promise<void> {
  try {
    const meta = await getApi().restoreFile(id);
    useFiles.getState().undrop(id);
    useFiles.getState().put([meta]);
    notify(filesStrings().restored(name), 'success');
  } catch (err) {
    notify(describeError(err), 'error');
  }
}
const DOWNLOAD_KEY =
  'key inline-flex size-9 items-center justify-center rounded-[9px] text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink';

function FileTile({ meta, onDeleted }: { meta: FileMeta; onDeleted: (id: string) => void }) {
  const s = filesStrings();
  const nameOf = useNameOf();
  const agent = useAgent(meta.source === 'user' ? '' : (meta.agent ?? ''));
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const download = downloadHref(meta.id);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const del = async () => {
    if (!armed) {
      setArmed(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), ARMED_MS);
      return;
    }
    clearTimeout(timer.current);
    setBusy(true);
    try {
      await getApi().deleteFile(meta.id);
      useFiles.getState().drop(meta.id);
      onDeleted(meta.id);
      notify(s.deleted(meta.name), 'info', {
        action: { label: s.undo, run: () => void restoreFile(meta.id, meta.name) },
        ms: UNDO_MS,
      });
    } catch (err) {
      notify(describeError(err), 'error');
      setBusy(false);
      setArmed(false);
    }
  };

  const who = sourceText(meta, nameOf);
  const when = `${formatShortDay(meta.createdAt)} · ${formatTime(meta.createdAt)}`;
  return (
    <li
      className="card group relative flex min-w-0 flex-col overflow-hidden rounded-[14px]"
      data-testid="file-tile"
      data-kind={meta.kind}
      data-source={meta.source}
    >
      <button
        type="button"
        onClick={() => openPreview({ kind: 'file', fileId: meta.id })}
        aria-label={s.openLabel(meta.name)}
        className="flex min-w-0 flex-1 flex-col text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink"
      >
        <span className="seam-b block aspect-[4/3] w-full overflow-hidden bg-well">
          <FileThumb meta={meta} fill />
        </span>
        <span className="flex min-w-0 flex-col gap-1 px-3 pt-2.5 pb-3 group-hover:bg-panel">
          <span className="line-clamp-2 text-body leading-snug font-semibold break-words text-ink">
            {meta.title ?? meta.name}
          </span>
          {meta.title && <span className="truncate text-footnote text-ink-muted">{meta.name}</span>}
          {meta.snippet && (
            <span
              className="line-clamp-3 text-footnote break-words text-ink-muted"
              data-testid="file-snippet"
            >
              {meta.snippet}
            </span>
          )}
          <span className="label truncate text-ink-muted">
            {kindLabel(meta.kind)} · {formatSize(meta.size)}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-footnote text-ink-muted">
            {agent && (
              <MonsterScreen genome={agent.genome} mood="idle" width={22} height={20} pad={1} />
            )}
            <span className="truncate">{who}</span>
          </span>
          <span className="label truncate text-ink-faint" title={when}>
            {when}
          </span>
        </span>
      </button>
      {/* The keys light up on the tile under the pointer; always there on a touch screen. */}
      <div
        className={cn(
          'absolute top-2 right-2 flex gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
          armed && 'opacity-100',
        )}
      >
        {download ? (
          <a
            href={download}
            download={meta.name}
            onClick={downloadOnClick(meta.id, meta.name)}
            aria-label={s.download(meta.name)}
            title={s.downloadTitle}
            className={DOWNLOAD_KEY}
          >
            <DownloadSimple size={16} aria-hidden />
          </a>
        ) : (
          <button
            type="button"
            onClick={downloadOnClick(meta.id, meta.name)}
            aria-label={s.download(meta.name)}
            title={s.downloadTitle}
            className={DOWNLOAD_KEY}
          >
            <DownloadSimple size={16} aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => void del()}
          disabled={busy}
          aria-label={armed ? s.deleteArmedLabel(meta.name) : s.deleteLabel(meta.name)}
          title={armed ? s.deleteArmedTitle : s.delete}
          data-testid="file-delete"
          data-armed={armed ? 'true' : undefined}
          className={cn(
            'key inline-flex h-9 items-center justify-center gap-1.5 rounded-[9px] text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink',
            armed ? 'px-2.5 text-stop-ink shadow-[inset_0_0_0_1.5px_var(--stop)]' : 'w-9',
          )}
        >
          <Trash size={16} aria-hidden />
          {armed && <span className="label">{s.again}</span>}
        </button>
      </div>
    </li>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  const s = filesStrings();
  const lead = useOrchestrator();
  return (
    <EmptyScreen testId="files-empty" title={s.emptyTitle(filtered)} text={s.emptyText(filtered)}>
      {/* The way in is the chat's paperclip: the button takes you to the lead's chat (U2-34). */}
      {!filtered && lead && (
        <Button onClick={() => openChat(lead.id)} data-testid="files-attach">
          <Paperclip size={18} weight="bold" aria-hidden /> {s.attach}
        </Button>
      )}
    </EmptyScreen>
  );
}

export default function FilesView() {
  const s = filesStrings();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  /** The files shown, for the query they answer, and whether older ones may be on the core (W-37). */
  const [shown, setShown] = useState<{
    query: FileListQuery;
    files: FileMeta[];
    more: boolean;
  } | null>(null);
  const files = shown?.files ?? null;
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, retry] = useRetry(() => setFailed(false));
  const phone = useMediaQuery('(max-width: 767px)');
  // A new file event (a monster saved one) or one deleted elsewhere: read the list again.
  const fileEvents = useApp((s) => s.events.filter((e) => e.type === 'file').length);
  const query = useMemo(() => queryOf(filter, q), [filter, q]);

  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () => {
        getApi()
          .files(query)
          .then((list) => {
            if (!live) return;
            useFiles.getState().put(list);
            // The list read again (a file event) keeps the older pages the user asked for.
            setShown((prev) => {
              const same = prev?.query === query ? prev : null;
              return {
                query,
                files: afterRefresh(list, same?.files ?? null),
                more:
                  list.length >= FILES_PAGE &&
                  (!same || same.files.length <= FILES_PAGE || same.more),
              };
            });
            setFailed(false);
          })
          .catch(() => live && setFailed(true));
      },
      query.q ? 150 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, fileEvents, attempt]);

  /** The next page, below the files shown. */
  const showMore = async () => {
    if (!shown || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getApi().files(nextPageQuery(shown.query, shown.files));
      useFiles.getState().put(page);
      setShown((p) =>
        p?.query === shown.query
          ? { ...p, files: withPage(p.files, page), more: page.length >= FILES_PAGE }
          : p,
      );
    } catch (err) {
      notify(describeError(err), 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const filtered = filter !== 'all' || q.trim() !== '';
  // Nothing to filter, nothing to search: the bar waits until there is a file (or a filter on).
  const showBar = filtered || (files?.length ?? 0) > 0;
  return (
    <section
      aria-labelledby="files-title"
      className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="files-view"
    >
      <ToolbarContent>
        <ToolbarTitle id="files-title">{s.title}</ToolbarTitle>
      </ToolbarContent>
      {showBar && (
        <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3 sm:px-6">
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={FILTER_VALUES.map((value) => ({ value, label: s.filters[value] }))}
            label={s.which}
            size="sm"
            className={cn(
              phone && 'grid w-full grid-cols-4 [&>button]:px-1 [&>button]:text-footnote',
            )}
          />
          <label className="relative block min-w-[200px] flex-1 sm:max-w-[360px]">
            <span className="sr-only">{s.searchLabel}</span>
            <MagnifyingGlass
              size={15}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={s.searchPlaceholder}
              data-testid="files-search"
              className="well h-10 w-full rounded-[10px] pr-9 pl-9.5 text-body text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink [&::-webkit-search-cancel-button]:hidden"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                aria-label={s.clearSearch}
                className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-[7px] text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-signal-ink"
              >
                <X size={13} weight="bold" aria-hidden />
              </button>
            )}
          </label>
          {files && files.length > 0 && (
            <p
              className="label text-ink-muted max-sm:hidden"
              data-testid="files-count"
              aria-live="polite"
            >
              {s.count(files.length)}
            </p>
          )}
        </div>
      )}
      {showBar && <div aria-hidden className="seam-h" />}
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-8 sm:px-6">
        {failed ? (
          <LoadFailed what={s.failed} onRetry={retry} />
        ) : files === null ? (
          <p className="label text-ink-muted" aria-busy="true">
            {s.loading}
          </p>
        ) : files.length === 0 ? (
          <EmptyState filtered={filtered} />
        ) : (
          <ul
            aria-label={s.list}
            data-testid="files-grid"
            className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] sm:gap-4"
          >
            {files.map((f) => (
              <FileTile
                key={f.id}
                meta={f}
                onDeleted={(id) =>
                  setShown((p) => p && { ...p, files: p.files.filter((x) => x.id !== id) })
                }
              />
            ))}
          </ul>
        )}
        {!failed && shown?.more && files && (
          <div className="mt-4 flex flex-wrap items-center gap-3" data-testid="files-capped">
            <p className="label text-ink-muted">{s.shown(files.length)}</p>
            <Button
              variant="secondary"
              size="sm"
              disabled={loadingMore}
              onClick={() => void showMore()}
              data-testid="files-more"
            >
              {s.showMore}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
