import {
  CaretRight,
  FolderSimple,
  MagnifyingGlass,
  SlidersHorizontal,
  Trash,
  X,
} from '@phosphor-icons/react';
import type {
  VaultNoteSummary,
  VaultOverview,
  VaultSearchHit,
  VaultSearchMode,
} from '@monsters/shared';
import { compareText } from '@monsters/shared';
import { memo, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { vaultPath } from '../../lib/router.ts';
import { folderOf, foldersOf } from '../../lib/vault-markdown.ts';
import { cn, domId } from '../../lib/utils.ts';
import { KeyCap } from '../ui/button.tsx';
import { Chip, Switch } from '../ui/controls.tsx';
import { vaultApi, vaultError } from './api.ts';
import { cleanSnippet, isAgentNote, listDate, previewText, PrivateMark } from './shared.tsx';
import { vaultStrings } from './vault.strings.ts';

export interface Filters {
  query: string;
  mode: VaultSearchMode;
  tags: string[];
  folder: string;
  /** Also the notes the monsters keep for themselves (`Agenti/`, `Agents/`). */
  agents: boolean;
}

export const NO_FILTERS: Filters = {
  query: '',
  mode: 'hybrid',
  tags: [],
  folder: '',
  agents: false,
};

/** How many notes "Recent" shows above the folders. */
export const RECENT_COUNT = 5;

/** Notes matching the folder, tag and monsters' notes filters (no text query). */
export function filterNotes(
  notes: readonly VaultNoteSummary[],
  f: Pick<Filters, 'tags' | 'folder'> & { agents?: boolean },
): VaultNoteSummary[] {
  return notes.filter(
    (n) =>
      (f.agents === true || !isAgentNote(n.path) || isAgentNote(f.folder)) &&
      (!f.folder || n.path.startsWith(`${f.folder}/`)) &&
      f.tags.every((t) => n.tags.some((nt) => nt === t || nt.startsWith(`${t}/`))),
  );
}

/** Groups notes by folder: folders in name order (the main folder first), notes by title. */
export function groupByFolder(
  notes: readonly VaultNoteSummary[],
): { folder: string; notes: VaultNoteSummary[] }[] {
  const map = new Map<string, VaultNoteSummary[]>();
  for (const n of notes) {
    const f = folderOf(n.path);
    const list = map.get(f);
    if (list) list.push(n);
    else map.set(f, [n]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : compareText(a, b)))
    .map(([folder, list]) => ({
      folder,
      notes: list.sort((a, b) => compareText(a.title, b.title)),
    }));
}

/** A folder path for people: "Aree › Salute", the main folder by name. */
export function folderLabel(folder: string): string {
  return folder ? folder.split('/').join(' › ') : vaultStrings().mainFolder;
}

export interface SearchState {
  /** Hits of the current query; null while there is no query or no answer yet. */
  hits: VaultSearchHit[] | null;
  searching: boolean;
  error: string | null;
}

/**
 * The search of the notes, one for the list and the graph: a moment after the
 * typing stops, with the folder and tag filters. Older hits stay up while a
 * new search runs.
 */
export function useVaultSearch(
  filters: Filters,
  overview: VaultOverview | null,
  version: number,
): SearchState {
  const query = filters.query.trim();
  const semantic = overview?.semantic === 'ready' || overview?.semantic === 'indexing';
  const mode = semantic ? filters.mode : 'text';
  const key = JSON.stringify([query, mode, filters.tags, filters.folder, version]);
  const [result, setResult] = useState<{
    key: string;
    hits: VaultSearchHit[];
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!query) return;
    let alive = true;
    const timer = setTimeout(() => {
      vaultApi
        .search({
          q: query,
          mode,
          tags: filters.tags,
          folder: filters.folder || undefined,
          limit: 40,
        })
        .then((r) => alive && setResult({ key, hits: r.hits, error: null }))
        .catch((err: unknown) => alive && setResult({ key, hits: [], error: vaultError(err) }));
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, query, mode, filters.tags, filters.folder]);

  const raw = query ? (result?.hits ?? null) : null;
  const hits = useMemo(
    () => raw?.filter((h) => filters.agents || !isAgentNote(h.path)) ?? null,
    [raw, filters.agents],
  );
  return {
    hits,
    searching: !!query && result?.key !== key,
    error: result?.key === key ? result.error : null,
  };
}

/** Snippet of a search hit with the matched words (`**word**`) marked, as text. */
function Snippet({ text }: { text: string }) {
  const parts = cleanSnippet(text).split('**');
  return (
    <span className="vault-snippet">
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </span>
  );
}

/** One row of the list, as in Notes: title, then date and preview, then (optionally) the folder. */
const NoteRow = memo(function NoteRow({
  path,
  title,
  date,
  preview,
  isPrivate,
  current,
  showFolder,
  tags = [],
  snippet = false,
}: {
  path: string;
  title: string;
  date: string;
  preview: ReactNode;
  isPrivate: boolean;
  current: boolean;
  showFolder: boolean;
  /** Tags of the note: the first ones as small key caps under the text. */
  tags?: readonly string[];
  /** A search hit: the snippet on two lines (the match must show), the date by the folder. */
  snippet?: boolean;
}) {
  const shown = tags.slice(0, 3);
  return (
    <li>
      <a
        href={vaultPath(path)}
        aria-current={current ? 'page' : undefined}
        data-testid="vault-note-link"
        className={cn(
          'block rounded-[12px] px-3 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-signal-ink',
          current ? 'bg-raised shadow-[inset_0_0_0_1.5px_var(--ink)]' : 'row-key',
        )}
      >
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-body leading-snug font-semibold text-ink">
            {title}
          </span>
          {isPrivate && <PrivateMark compact />}
        </span>
        {snippet ? (
          <span className="mt-0.5 line-clamp-2 text-footnote leading-snug text-ink-muted">
            {preview}
          </span>
        ) : (
          <span className="mt-1 flex min-w-0 items-baseline gap-2 text-footnote leading-snug">
            {date && <span className="label shrink-0 font-normal text-ink-faint">{date}</span>}
            <span className="min-w-0 truncate text-ink-muted">
              {preview || vaultStrings().list.noText}
            </span>
          </span>
        )}
        {(showFolder || shown.length > 0) && (
          <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-footnote text-ink-muted">
            {showFolder && (
              <span className="flex min-w-0 shrink items-center gap-1">
                <FolderSimple size={14} aria-hidden className="shrink-0 text-ink-faint" />
                <span className="truncate">
                  {folderLabel(folderOf(path))}
                  {snippet && date ? ` · ${date}` : ''}
                </span>
              </span>
            )}
            {shown.map((t) => (
              <KeyCap key={t} className="vault-row-tag">
                #{t}
              </KeyCap>
            ))}
          </span>
        )}
      </a>
    </li>
  );
});

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="label px-3 pt-4 pb-1.5 text-ink-faint">
      {children}
    </h3>
  );
}

export interface NoteListProps {
  overview: VaultOverview | null;
  error: string | null;
  /** Path of the open note. */
  current: string | null;
  filters: Filters;
  onFilters: (f: Filters) => void;
  search: SearchState;
  /** The trash is on screen (its row in the list is the current one). */
  trashOpen?: boolean;
}

export function NoteList({
  overview,
  error,
  current,
  filters,
  onFilters,
  search,
  trashOpen = false,
}: NoteListProps) {
  const s = vaultStrings().list;
  const id = domId(useId());
  const [panel, setPanel] = useState(false);
  const query = filters.query.trim();
  const semantic = overview?.semantic === 'ready' || overview?.semantic === 'indexing';

  const notes = useMemo(() => overview?.notes ?? [], [overview]);
  const byPath = useMemo(() => new Map(notes.map((n) => [n.path, n])), [notes]);
  const visible = useMemo(
    () => (filters.agents ? notes : notes.filter((n) => !isAgentNote(n.path))),
    [notes, filters.agents],
  );
  const folders = useMemo(() => foldersOf(visible.map((n) => n.path)), [visible]);
  const filtered = useMemo(() => filterNotes(notes, filters), [notes, filters]);
  const groups = useMemo(() => groupByFolder(filtered), [filtered]);
  const recent = useMemo(() => visible.slice(0, RECENT_COUNT), [visible]);
  const filtering = filters.tags.length > 0 || filters.folder !== '';
  const tags = overview?.tags.slice(0, 14) ?? [];
  const currentFolder = current ? folderOf(current) : null;
  const active = filters.tags.length + (filters.folder ? 1 : 0) + (filters.agents ? 1 : 0);

  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });
  const toggleTag = (t: string) =>
    set({
      tags: filters.tags.includes(t) ? filters.tags.filter((x) => x !== t) : [...filters.tags, t],
    });
  const clear = () => onFilters({ ...NO_FILTERS, mode: filters.mode, query: filters.query });

  const rowOf = (n: VaultNoteSummary, showFolder: boolean) => (
    <NoteRow
      key={n.path}
      path={n.path}
      title={n.title}
      date={listDate(n.updated)}
      preview={previewText(n.summary)}
      isPrivate={n.private}
      current={n.path === current}
      showFolder={showFolder}
      tags={n.tags}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 px-3 pt-3 pb-2">
        <div className="flex items-center gap-1.5">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">{s.search}</span>
            <MagnifyingGlass
              size={15}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="search"
              value={filters.query}
              onChange={(e) => set({ query: e.target.value, mode: 'hybrid' })}
              placeholder={s.searchPlaceholder}
              title={overview?.semanticReason}
              data-testid="vault-search"
              className="well h-10 w-full rounded-[10px] pr-9 pl-9.5 text-body text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink [&::-webkit-search-cancel-button]:hidden"
            />
            {filters.query && (
              <button
                type="button"
                onClick={() => set({ query: '', mode: 'hybrid' })}
                aria-label={s.clearSearch}
                className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-[7px] text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-signal-ink"
              >
                <X size={12} weight="bold" aria-hidden />
              </button>
            )}
          </label>
          <button
            type="button"
            onClick={() => setPanel((v) => !v)}
            aria-expanded={panel}
            aria-controls={`${id}-filters`}
            title={s.filters}
            data-testid="vault-filters-toggle"
            data-pressed={panel ? 'true' : undefined}
            className={cn(
              'key relative inline-flex size-10 shrink-0 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink',
              panel ? 'text-ink [--cap:var(--panel)]' : 'text-ink-muted hover:text-ink',
            )}
          >
            <SlidersHorizontal size={19} aria-hidden />
            <span className="sr-only">{active > 0 ? s.filtersActive(active) : s.filters}</span>
            {active > 0 && (
              <span
                aria-hidden
                className="led absolute top-[5px] right-[5px] size-1.5"
                data-tone="signal"
              />
            )}
          </button>
        </div>

        {panel && (
          <div
            id={`${id}-filters`}
            className="card flex flex-col gap-3.5 rounded-[14px] p-3.5"
            data-testid="vault-filters"
          >
            <div className="flex items-center gap-2">
              <label htmlFor={`${id}-folder`} className="label w-[72px] shrink-0 text-ink-faint">
                {s.folder}
              </label>
              <select
                id={`${id}-folder`}
                value={filters.folder}
                onChange={(e) => set({ folder: e.target.value })}
                data-testid="vault-folder"
                className="well h-10 min-w-0 flex-1 rounded-[10px] px-2.5 text-body text-ink focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink"
              >
                <option value="">{s.all}</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {folderLabel(f)}
                  </option>
                ))}
              </select>
            </div>
            {tags.length > 0 && (
              <div role="group" aria-label={s.filterByTag} className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <Chip
                    key={t.tag}
                    pressed={filters.tags.includes(t.tag)}
                    onClick={() => toggleTag(t.tag)}
                    className="h-8 max-w-full min-w-0 px-2.5 font-mono text-micro tracking-[0.02em]"
                  >
                    <span className="min-w-0 truncate">#{t.tag}</span>
                    <span className="shrink-0 text-ink-faint tabular-nums">{t.count}</span>
                  </Chip>
                ))}
              </div>
            )}
            <div className="seam-t -mx-3.5 flex items-center justify-between gap-3 px-3.5 pt-3.5">
              <span id={`${id}-agents`} className="text-footnote text-ink">
                {s.showAgents}
              </span>
              <Switch
                checked={filters.agents}
                onCheckedChange={(v) => set({ agents: v })}
                label={s.showAgents}
              />
            </div>
          </div>
        )}

        {!panel && filtering && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-footnote text-ink-muted">
            <span className="min-w-0 truncate">
              {[filters.folder && folderLabel(filters.folder), ...filters.tags.map((t) => `#${t}`)]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </p>
        )}
        {(filtering || filters.agents) && (
          <button
            type="button"
            onClick={clear}
            className="self-start rounded px-1 text-footnote font-medium text-signal-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-signal-ink"
          >
            {s.clearFilters}
          </button>
        )}
      </div>

      <div
        className="scroll-soft min-h-0 flex-1 overflow-y-auto px-2 pb-4"
        data-testid="vault-list"
      >
        {error && <p className="px-3 py-6 text-body text-ink-muted">{error}</p>}
        {!overview && !error && (
          <p className="px-3 py-6 text-body text-ink-muted" aria-busy="true">
            {s.loading}
          </p>
        )}
        {overview && query && (
          <section aria-label={s.results}>
            <p className="label px-3 pt-3 pb-1.5 text-ink-faint" role="status">
              {search.searching && !search.hits
                ? s.searching
                : search.error
                  ? search.error
                  : search.hits?.length === 0
                    ? semantic && filters.mode === 'text'
                      ? s.noneExact
                      : s.none
                    : vaultStrings().noteCount(search.hits?.length ?? 0)}
            </p>
            {/* Search finds similar notes too; the exact words are the second try, not a setting (U2-15). */}
            {semantic &&
              filters.mode === 'hybrid' &&
              search.hits?.length === 0 &&
              !search.searching && (
                <button
                  type="button"
                  onClick={() => set({ mode: 'text' })}
                  data-testid="vault-try-exact"
                  className="mx-3 mb-1 rounded px-1 text-footnote font-medium text-signal-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-signal-ink"
                >
                  {s.tryExact}
                </button>
              )}
            <ul className="flex flex-col gap-px" data-testid="vault-results">
              {search.hits?.map((h) => {
                const n = byPath.get(h.path);
                return (
                  <NoteRow
                    key={h.path}
                    path={h.path}
                    title={h.title}
                    date={listDate(h.updated)}
                    preview={h.snippet ? <Snippet text={h.snippet} /> : previewText(n?.summary)}
                    isPrivate={n?.private ?? false}
                    current={h.path === current}
                    showFolder
                    snippet
                  />
                );
              })}
            </ul>
          </section>
        )}
        {overview && !query && (
          <>
            {!filtering && recent.length > 0 && (
              <section aria-labelledby={`${id}-recent`}>
                <SectionTitle id={`${id}-recent`}>{s.recent}</SectionTitle>
                <ul className="flex flex-col gap-px" data-testid="vault-recent">
                  {recent.map((n) => rowOf(n, true))}
                </ul>
              </section>
            )}
            {filtering ? (
              <p className="label px-3 pt-3 pb-1.5 text-ink-faint" role="status">
                {filtered.length === 0
                  ? s.noFilterMatch
                  : vaultStrings().noteCount(filtered.length)}
              </p>
            ) : (
              groups.length > 0 && <SectionTitle id={`${id}-folders`}>{s.folders}</SectionTitle>
            )}
            <div aria-labelledby={filtering ? undefined : `${id}-folders`} role="group">
              {groups.map((g) => (
                <details
                  key={g.folder}
                  open={filtering || g.folder === currentFolder}
                  className="group/folder"
                  data-testid="vault-folder-group"
                >
                  <summary className="row-key flex h-10 cursor-pointer list-none items-center gap-2 rounded-[10px] px-2 text-body text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-signal-ink [&::-webkit-details-marker]:hidden">
                    <CaretRight
                      size={11}
                      weight="bold"
                      aria-hidden
                      className="shrink-0 text-ink-faint turn group-open/folder:rotate-90"
                    />
                    <FolderSimple size={18} aria-hidden className="shrink-0 text-ink-muted" />
                    <span className="truncate">{folderLabel(g.folder)}</span>
                    <span className="label ml-auto pl-2 text-ink-faint">{g.notes.length}</span>
                  </summary>
                  <ul className="flex flex-col gap-px pb-1 pl-4">
                    {g.notes.map((n) => rowOf(n, false))}
                  </ul>
                </details>
              ))}
            </div>
            {!filtering && (
              <a
                href={vaultPath(null, 'cestino')}
                aria-current={trashOpen ? 'page' : undefined}
                data-testid="vault-trash-link"
                className={cn(
                  'mt-1 flex h-10 items-center gap-2 rounded-[10px] pr-2 pl-[27px] text-body text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-signal-ink',
                  trashOpen ? 'bg-raised shadow-[inset_0_0_0_1.5px_var(--ink)]' : 'row-key',
                )}
              >
                <Trash size={18} aria-hidden className="shrink-0 text-ink-muted" />
                {s.trash}
              </a>
            )}
            {overview.total > overview.notes.length && (
              <p className="px-3 pt-3 text-footnote text-ink-muted">
                {s.capped(overview.notes.length, overview.total)}
              </p>
            )}
          </>
        )}
      </div>
      {overview && (
        <p className="seam-t flex items-center justify-between gap-3 px-4 pt-3 pb-2.5 text-caption text-ink-muted">
          <span className="label text-ink-faint">{vaultStrings().noteCount(visible.length)}</span>
          <span>{s.footer}</span>
        </p>
      )}
    </div>
  );
}
