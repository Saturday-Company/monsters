import { Graph, NotePencil, SidebarSimple } from '@phosphor-icons/react';
import { dotPalette } from '@monsters/monster-kit';
import type { VaultNoteSummary, VaultOverview } from '@monsters/shared';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { SCREEN_INK } from '../../lib/brand-light.ts';
import { replaceHash, useHashParam, vaultPath, type VaultTab } from '../../lib/router.ts';
import { foldersOf, linkIndex } from '../../lib/vault-markdown.ts';
import { cn } from '../../lib/utils.ts';
import { useAgents, useMediaQuery, useNameOf, useReducedMotionPref } from '../../store/hooks.ts';
import { usePrefs } from '../../store/prefs.ts';
import { ErrorBoundary } from '../shell/ErrorBoundary.tsx';
import { ToolbarActions, ToolbarContent, ToolbarTitle, useToolbarBack } from '../shell/Toolbar.tsx';
import { Button, LabeledKey } from '../ui/button.tsx';
import { EmptyScreen } from '../ui/EmptyScreen.tsx';
import { vaultApi, vaultError } from './api.ts';
import { NewNote } from './NewNote.tsx';
import { filterNotes, NO_FILTERS, NoteList, useVaultSearch, type Filters } from './NoteList.tsx';
import { NoteReader } from './NoteReader.tsx';
import { GroupDot, isAgentNote, useLastVaultChange } from './shared.tsx';
import { TrashView } from './TrashView.tsx';
import { vaultStrings } from './vault.strings.ts';

/* The graph (canvas and force layout) has a chunk of its own: loaded on the first visit. */
const GraphView = lazy(() => import('./GraphView.tsx'));

function go(note: string | null, tab: VaultTab = 'note') {
  window.location.hash = vaultPath(note, tab);
}

function Empty({ overview }: { overview: VaultOverview | null }) {
  const s = vaultStrings().view;
  const none = overview !== null && overview.notes.length === 0;
  return (
    <EmptyScreen
      title={none ? s.emptyNone : s.emptyNoNote}
      text={none ? s.emptyNoneText : s.emptyNoNoteText}
    >
      {none && (
        <Button size="sm" onClick={() => go(null, 'nuova')}>
          {s.newNote}
        </Button>
      )}
    </EmptyScreen>
  );
}

/**
 * A key of the rail with its name (an icon alone is a guess): beside the icon
 * on wide windows, under it on a phone (`short`, a word that fits), only as
 * tooltip in between, where the rail is full. Pressed while its view is open.
 */
function ToolButton({
  label,
  short,
  layout,
  pressed,
  onClick,
  testId,
  children,
}: {
  label: string;
  short: string;
  layout: 'inline' | 'stacked' | 'icon';
  pressed?: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <LabeledKey
      label={layout === 'stacked' ? short : label}
      aria-label={label}
      title={label}
      layout={layout}
      pressed={pressed}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </LabeledKey>
  );
}

/** Notes page (`#/note`): the list and the search, the reader, the graph, the trash. */
export default function VaultView() {
  const param = useHashParam('nota');
  const vista = useHashParam('vista');
  const tab: VaultTab =
    vista === 'grafo' || vista === 'cestino' || vista === 'nuova' ? vista : 'note';
  const s = vaultStrings().view;
  const systemReduce = useReducedMotionPref();
  const appReduce = usePrefs((p) => p.reduceMotion);
  const reduceMotion = systemReduce || appReduce;
  const agents = useAgents();
  const nameOf = useNameOf();
  const wide = useMediaQuery('(min-width: 900px)');
  const change = useLastVaultChange();
  const [version, setVersion] = useState(0);
  const [overview, setOverview] = useState<VaultOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

  useEffect(() => {
    let alive = true;
    vaultApi
      .overview()
      .then((o) => {
        if (!alive) return;
        setOverview(o);
        setError(null);
      })
      .catch((err: unknown) => alive && setError(vaultError(err)));
    return () => {
      alive = false;
    };
  }, [version]);

  // A change in the activity (an agent wrote, an undo, Obsidian): reload, a moment later.
  const firstChange = useRef(change);
  useEffect(() => {
    if (change === firstChange.current) return;
    firstChange.current = change;
    const t = setTimeout(() => setVersion((v) => v + 1), 250);
    return () => clearTimeout(t);
  }, [change]);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const resolve = useMemo(() => linkIndex(overview?.notes.map((n) => n.path) ?? []), [overview]);
  /*
   * `?nota=` may name a note the way a link does ("Bozze dei post", from the
   * chat): once the list is there it becomes the path, in place.
   */
  const note = param ? (overview ? (resolve(param) ?? param) : param) : null;
  useEffect(() => {
    if (param && note && note !== param) replaceHash(vaultPath(note, tab));
  }, [param, note, tab]);

  const folders = useMemo(
    () => foldersOf(overview?.notes.map((n) => n.path).filter((p) => !isAgentNote(p)) ?? []),
    [overview],
  );
  const search = useVaultSearch(filters, overview, version);
  const onTag = useCallback(
    (tag: string) => {
      setFilters((f) => ({ ...f, query: '', tags: [tag] }));
      if (!wide) go(null);
    },
    [wide],
  );

  /*
   * The graph is a screen: a note lights in the LED colour of the monster
   * that wrote it (docs/design.md), the others in the ink of the screens.
   */
  const agentColors = useMemo(
    () => new Map(agents.map((a) => [a.id, dotPalette(a.genome).lit])),
    [agents],
  );
  const colorOf = useCallback(
    (n: Pick<VaultNoteSummary, 'author'>) => (n.author && agentColors.get(n.author)) || SCREEN_INK,
    [agentColors],
  );

  const graphNotes = useMemo(
    () => filterNotes(overview?.notes ?? [], filters),
    [overview, filters],
  );
  /** The search, in the graph too: the notes found stand out. */
  const highlight = useMemo(
    () => (search.hits ? new Set(search.hits.map((h) => h.path)) : null),
    [search.hits],
  );
  /** Who wrote the notes on the screen: one light per monster, then all the others. */
  const legend = useMemo(() => {
    const counts = new Map<string, { label: string; color: string; count: number }>();
    for (const n of graphNotes) {
      const agent = n.author && agentColors.has(n.author) ? n.author : null;
      const key = agent ?? '\u0000other';
      const entry = counts.get(key);
      if (entry) entry.count++;
      else
        counts.set(key, {
          label: agent ? nameOf(agent) : s.others,
          color: colorOf(n),
          count: 1,
        });
    }
    return [...counts.values()].sort(
      (a, b) =>
        Number(a.color === SCREEN_INK) - Number(b.color === SCREEN_INK) || b.count - a.count,
    );
  }, [graphNotes, colorOf, nameOf, agentColors, s]);
  const linkCount = useMemo(() => {
    if (!overview) return 0;
    const shown = new Set(graphNotes.map((n) => n.path));
    return overview.edges.filter((e) => shown.has(e.from) && shown.has(e.to) && e.from !== e.to)
      .length;
  }, [overview, graphNotes]);

  /*
   * Under 1200 px three columns are too narrow: with a note open the list leaves the page and
   * comes back as a drawer over it, from the "List" key of the rail (UX 17).
   */
  const roomy1200 = useMediaQuery('(min-width: 1200px)');
  const drawerMode = wide && !roomy1200 && tab === 'note' && !!note;
  // Open for one note: picking another (or leaving the page) closes it, nothing to reset.
  const [drawerFor, setDrawerFor] = useState<string | null>(null);
  const drawerKey = `${note}|${tab}`;
  const drawerOpen = drawerMode && drawerFor === drawerKey;
  const setDrawer = (open: boolean) => setDrawerFor(open ? drawerKey : null);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerFor(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);
  const showList = (wide && !drawerMode) || (tab === 'note' && !note);
  const showMain = wide || tab !== 'note' || !!note;
  /*
   * On a phone a note (or the graph, the trash, a new note) opens over the
   * list: the rail's back key says "Notes" and goes back to the list, the only
   * back on screen (audit UI-19). Between 768 and 900 px the rail has no back:
   * the sheet keeps its own.
   */
  const phone = useMediaQuery('(max-width: 767px)');
  const inside = !wide && showMain;
  useToolbarBack(phone && inside ? { label: vaultStrings().notes, run: () => go(null) } : null);
  const roomy = useMediaQuery('(min-width: 1280px)');
  const keyLayout = phone ? 'stacked' : roomy ? 'inline' : 'icon';
  const sheetBack = inside && !phone ? () => go(null) : undefined;

  return (
    <section
      aria-labelledby="vault-title"
      className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="vault-view"
    >
      <ToolbarContent>
        {/* On a phone inside a note the back key already says "Notes". */}
        <ToolbarTitle id="vault-title" className={cn(phone && inside && 'sr-only')}>
          {vaultStrings().notes}
        </ToolbarTitle>
        <ToolbarActions>
          {drawerMode && (
            <ToolButton
              label={s.list}
              short={s.list}
              layout={keyLayout}
              pressed={drawerOpen}
              onClick={() => setDrawer(!drawerOpen)}
              testId="vault-list-toggle"
            >
              <SidebarSimple size={20} aria-hidden />
            </ToolButton>
          )}
          <ToolButton
            label={s.graph}
            short={s.graph}
            layout={keyLayout}
            pressed={tab === 'grafo'}
            onClick={() => go(tab === 'grafo' ? note : null, tab === 'grafo' ? 'note' : 'grafo')}
            testId="vault-graph-toggle"
          >
            <Graph size={20} aria-hidden />
          </ToolButton>
          <ToolButton
            label={s.newNote}
            short={s.newShort}
            layout={keyLayout}
            pressed={tab === 'nuova'}
            onClick={() => go(null, 'nuova')}
            testId="vault-new"
          >
            <NotePencil size={20} aria-hidden />
          </ToolButton>
        </ToolbarActions>
      </ToolbarContent>
      <div className="relative flex min-h-0 flex-1">
        {drawerOpen && (
          <>
            <button
              type="button"
              aria-label={s.closeList}
              tabIndex={-1}
              onClick={() => setDrawerFor(null)}
              className="absolute inset-0 z-20 cursor-default bg-transparent"
            />
            <aside
              aria-label={s.listLabel}
              data-testid="vault-list-drawer"
              className="raised slide-in absolute inset-y-2 left-2 z-30 flex w-[min(360px,calc(100%-16px))] flex-col overflow-hidden rounded-[14px]"
            >
              <NoteList
                overview={overview}
                error={error}
                current={note}
                filters={filters}
                onFilters={setFilters}
                search={search}
                trashOpen={false}
              />
            </aside>
          </>
        )}
        {showList && (
          <aside
            aria-label={s.listLabel}
            className="flex min-h-0 w-full flex-col min-[900px]:w-[328px] min-[900px]:shrink-0"
          >
            <NoteList
              overview={overview}
              error={error}
              current={note}
              filters={filters}
              onFilters={setFilters}
              search={search}
              trashOpen={tab === 'cestino'}
            />
          </aside>
        )}
        {wide && !drawerMode && <div aria-hidden className="seam-v" />}
        {showMain && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col p-2 min-[900px]:p-3">
            {tab === 'cestino' && (
              <TrashView version={version} onChanged={refresh} onBack={sheetBack} />
            )}
            {tab === 'nuova' && (
              <NewNote
                folders={folders}
                onCancel={() => go(null)}
                onCreated={(path) => {
                  refresh();
                  go(path);
                }}
              />
            )}
            {tab === 'grafo' && (
              <div className="flex min-h-0 flex-1 flex-col gap-2.5">
                <div
                  className="screen screen-lines vault-graph-screen relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px]"
                  data-testid="vault-graph-screen"
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-4 pt-3.5">
                    <ul
                      className="flex flex-wrap gap-x-4 gap-y-1.5 text-screen-muted"
                      aria-label={s.legend}
                    >
                      {legend.map((l) => (
                        <li key={l.label} className="label inline-flex items-center gap-2">
                          <GroupDot color={l.color} className="size-[7px]" />
                          {l.label}
                          <span className="text-screen-muted/70">{l.count}</span>
                        </li>
                      ))}
                    </ul>
                    <p
                      className="label text-screen-muted max-sm:hidden"
                      data-testid="vault-graph-count"
                    >
                      {s.graphCount(graphNotes.length, linkCount)}
                    </p>
                  </div>
                  {overview ? (
                    <ErrorBoundary>
                      <Suspense
                        fallback={
                          <p className="label p-6 text-screen-muted" aria-busy="true">
                            {s.preparing}
                          </p>
                        }
                      >
                        <GraphView
                          notes={graphNotes}
                          edges={overview.edges}
                          colorOf={colorOf}
                          current={note}
                          highlight={highlight}
                          reduceMotion={reduceMotion}
                          onOpen={(path) => go(path)}
                        />
                      </Suspense>
                    </ErrorBoundary>
                  ) : (
                    <p className="label p-6 text-screen-muted" aria-busy="true">
                      {error ?? s.loading}
                    </p>
                  )}
                </div>
                <p className="px-1 text-footnote text-ink-muted">
                  {highlight ? s.hintFound(highlight.size) : s.hintDrag}
                  {s.hintClick}
                </p>
              </div>
            )}
            {tab === 'note' &&
              (note ? (
                <NoteReader
                  key={note}
                  path={note}
                  version={version}
                  resolve={resolve}
                  onTag={onTag}
                  updated={overview?.notes.find((n) => n.path === note)?.updated}
                  onBack={sheetBack}
                  onChanged={refresh}
                />
              ) : (
                <Empty overview={overview} />
              ))}
          </div>
        )}
      </div>
    </section>
  );
}
