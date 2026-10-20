import type { FileListQuery, FileMeta } from '@monsters/shared';
import { DownloadSimple, MagnifyingGlass, Trash, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { describeError } from '../../lib/api.ts';
import { formatSize, kindLabel, sourceText } from '../../lib/files.ts';
import { cn, formatShortDay, formatTime } from '../../lib/utils.ts';
import { getApi, notify, useApp } from '../../store/app.ts';
import { useFiles } from '../../store/files.ts';
import { useAgent, useMediaQuery, useNameOf } from '../../store/hooks.ts';
import { openPreview } from '../../store/preview.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { downloadHref, downloadOnClick } from '../preview/files.ts';
import { ToolbarContent, ToolbarTitle } from '../shell/Toolbar.tsx';
import { Segmented } from '../ui/controls.tsx';
import { EmptyScreen } from '../ui/EmptyScreen.tsx';
import { FileThumb } from './FileChip.tsx';

/*
 * The File section (docs/design.md, "File"; D-075): every file of the user
 * and of the monsters, newest first, as a grid of tiles with the picture or the
 * small screen of the type, the name, size and date, and who made it. Filters
 * as joined keys, a search on the name and the text (with the piece of text
 * found, D-086), delete with "DI NUOVO" like Ferma.
 * A press opens the preview on the right.
 */

type Filter = 'all' | 'images' | 'documents' | 'monsters';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Tutti' },
  { value: 'images', label: 'Immagini' },
  { value: 'documents', label: 'Documenti' },
  { value: 'monsters', label: 'Dai mostri' },
];

function queryOf(filter: Filter, q: string): FileListQuery {
  return {
    ...(filter === 'images' ? { kind: 'image' as const } : {}),
    ...(filter === 'documents' ? { kind: 'documents' as const } : {}),
    ...(filter === 'monsters' ? { source: 'monsters' as const } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
    limit: 300,
  };
}

/** How long the delete key stays armed ("DI NUOVO"), as Ferma. */
const ARMED_MS = 5000;
const DOWNLOAD_KEY =
  'key inline-flex size-9 items-center justify-center rounded-[9px] text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink';

function FileTile({ meta, onDeleted }: { meta: FileMeta; onDeleted: (id: string) => void }) {
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
      notify(`Ho eliminato ${meta.name}.`);
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
        aria-label={`${meta.name}: apri nell’anteprima`}
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
            aria-label={`Scarica ${meta.name}`}
            title="Scarica"
            className={DOWNLOAD_KEY}
          >
            <DownloadSimple size={16} aria-hidden />
          </a>
        ) : (
          <button
            type="button"
            onClick={downloadOnClick(meta.id, meta.name)}
            aria-label={`Scarica ${meta.name}`}
            title="Scarica"
            className={DOWNLOAD_KEY}
          >
            <DownloadSimple size={16} aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => void del()}
          disabled={busy}
          aria-label={armed ? `Premi di nuovo per eliminare ${meta.name}` : `Elimina ${meta.name}`}
          title={armed ? 'Premi di nuovo per eliminare' : 'Elimina'}
          data-testid="file-delete"
          data-armed={armed ? 'true' : undefined}
          className={cn(
            'key inline-flex h-9 items-center justify-center gap-1.5 rounded-[9px] text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink',
            armed ? 'px-2.5 text-stop-ink shadow-[inset_0_0_0_1.5px_var(--stop)]' : 'w-9',
          )}
        >
          <Trash size={16} aria-hidden />
          {armed && <span className="label">Di nuovo</span>}
        </button>
      </div>
    </li>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <EmptyScreen
      testId="files-empty"
      title={filtered ? 'Nessun file così' : 'Ancora nessun file'}
      text={
        filtered
          ? 'Prova un altro filtro, o cerca un altro nome.'
          : 'Allega immagini e documenti dalla chat con la graffetta, incollali o trascinali. Qui finiscono anche gli screenshot e le pagine dei mostri.'
      }
    />
  );
}

export default function FilesView() {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [files, setFiles] = useState<FileMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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
            setFiles(list);
            setError(null);
          })
          .catch((err: unknown) => live && setError(describeError(err)));
      },
      query.q ? 150 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, fileEvents]);

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
        <ToolbarTitle id="files-title">File</ToolbarTitle>
      </ToolbarContent>
      {showBar && (
        <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3 sm:px-6">
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={FILTERS}
            label="Quali file"
            size="sm"
            className={cn(
              phone && 'grid w-full grid-cols-4 [&>button]:px-1 [&>button]:text-footnote',
            )}
          />
          <label className="relative block min-w-[200px] flex-1 sm:max-w-[360px]">
            <span className="sr-only">Cerca nei nomi e nel testo dei file</span>
            <MagnifyingGlass
              size={15}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cerca nei file"
              data-testid="files-search"
              className="well h-10 w-full rounded-[10px] pr-9 pl-9.5 text-body text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink [&::-webkit-search-cancel-button]:hidden"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                aria-label="Cancella la ricerca"
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
              {files.length === 1 ? '1 file' : `${files.length} file`}
            </p>
          )}
        </div>
      )}
      {showBar && <div aria-hidden className="seam-h" />}
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-8 sm:px-6">
        {error ? (
          <p className="text-body text-stop-ink" role="alert">
            {error}
          </p>
        ) : files === null ? (
          <p className="label text-ink-muted" aria-busy="true">
            Carico…
          </p>
        ) : files.length === 0 ? (
          <EmptyState filtered={filtered} />
        ) : (
          <ul
            aria-label="File"
            data-testid="files-grid"
            className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] sm:gap-4"
          >
            {files.map((f) => (
              <FileTile
                key={f.id}
                meta={f}
                onDeleted={(id) => setFiles((list) => list?.filter((x) => x.id !== id) ?? null)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
