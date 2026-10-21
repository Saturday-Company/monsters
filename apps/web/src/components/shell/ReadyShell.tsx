import { lazy, Suspense, useEffect } from 'react';
import { openChat, openPage, PATHS, useHashParam, type Route } from '../../lib/router.ts';
import { cn } from '../../lib/utils.ts';
import { useAgents, useMediaQuery, useOrchestrator } from '../../store/hooks.ts';
import { CommandPalette, openPalette } from './CommandPalette.tsx';
import { DockSlot } from '../dock/DockSlot.tsx';
import { chatAgentOf, useDockFollowsPage, usePreviewEvents } from '../dock/follow.ts';
import { usePreview } from '../../store/preview.ts';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { NewsSheet } from './NewsSheet.tsx';
import { ReviewSheet } from './ReviewSheet.tsx';
import { shellStrings } from './shell.strings.ts';
import { Sidebar } from './Sidebar.tsx';
import { HaltBanner, LinkBand, NoticeBar } from './StatusLayer.tsx';
import { Toolbar, ToolbarProvider, useToolbarSlot } from './Toolbar.tsx';

/*
 * The app once logged in (docs/design.md, "Struttura della finestra"): the
 * window is an instrument. The top rail (52 px of chassis, the title bar:
 * wordmark, view title and keys, status display, Ferma) runs across it; under
 * it the halt band when the monsters are stopped; then the sidebar, straight
 * on the chassis, and the content module set into it on the right (the page
 * of the route); the right-hand pane (Anteprima, Dietro le quinte, Consumi)
 * after it, a column of its own on wide windows (components/dock). On a phone (< 768 px) the sidebar
 * is the home screen and every page opens full screen with Indietro. Each
 * page has a chunk of its own (code splitting, M2.8).
 */
const ChatsView = lazy(() => import('../chat/ChatsView.tsx'));
const LogView = lazy(() => import('../log/LogView.tsx').then((m) => ({ default: m.LogView })));
const AutomationsView = lazy(() => import('../automations/AutomationsView.tsx'));
const ProjectsView = lazy(() => import('../projects/ProjectsView.tsx'));
const VaultView = lazy(() => import('../vault/VaultView.tsx'));
const FilesView = lazy(() => import('../files/FilesView.tsx'));
const SettingsView = lazy(() =>
  import('../settings/SettingsView.tsx').then((m) => ({ default: m.SettingsView })),
);
/** Placeholder of a page while its chunk loads (a few milliseconds from the local core). */
function PageLoading() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center" aria-busy="true">
      <span className="sr-only">{shellStrings().loading}</span>
    </div>
  );
}

/** The pages of the sidebar by their key with ⌘ / Ctrl (the labels of the sidebar). */
const PAGE_KEYS: Readonly<Record<string, string>> = {
  '2': PATHS.automations,
  '3': PATHS.vault,
  '4': PATHS.files,
  '5': PATHS.log,
  ',': PATHS.settings,
};

/** The name of the page, in the toolbar until the view puts its own title. */
function usePageTitle(route: Route): string {
  const agents = useAgents();
  const orch = useOrchestrator();
  const param = useHashParam('chat');
  if (route === 'home' || route === 'welcome') {
    return agents.find((a) => a.id === param)?.name ?? orch?.name ?? 'Monsters';
  }
  return shellStrings().titles[route];
}

export default function ReadyShell({ route }: { route: Route }) {
  const phone = useMediaQuery('(max-width: 767px)');
  const chat = useHashParam('chat');
  const atHome = route === 'home' && chat === null;
  const [slot, setSlot] = useToolbarSlot();
  const title = usePageTitle(route);
  const showSidebar = !phone || atHome;
  const showContent = !phone || !atHome;

  const orchId = useOrchestrator()?.id ?? null;
  const mock = new URLSearchParams(window.location.search).has('mock');
  // The right-hand pane follows the page and opens what a monster shows in the chat on screen.
  useDockFollowsPage(route, chat, orchId);
  usePreviewEvents(chatAgentOf(route, chat, orchId));

  // Keyboard of the instrument: Cmd/Ctrl+K opens the palette from anywhere
  // (monsters, notes, messages, commands); 1 the team leader, 2 Automazioni,
  // 3 Note, 4 File, 5 Attività, comma Impostazioni (the shortcut labels of the sidebar); J the
  // right-hand pane (Anteprima, Dietro le quinte, Consumi).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        openPalette();
        return;
      }
      if (key === 'j') {
        e.preventDefault();
        usePreview.getState().toggle();
        return;
      }
      const page = PAGE_KEYS[key] ?? null;
      if (page) {
        e.preventDefault();
        openPage(page);
      } else if (key === '1' && orchId) {
        e.preventDefault();
        openChat(orchId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [orchId]);

  return (
    <div data-shell data-window className="relative z-[1] flex h-full flex-col bg-chassis">
      <ToolbarProvider slot={slot}>
        <Toolbar
          title={title}
          onSlot={setSlot}
          phone={phone}
          atHome={atHome}
          titleHidden={route === 'home'}
          mock={mock}
        />
        <LinkBand />
        <HaltBanner />
        <div className="flex min-h-0 flex-1">
          {showSidebar && <Sidebar route={route} phone={phone} />}
          {showContent && (
            <div
              data-content-card
              className={cn(
                'flex min-w-0 flex-1 flex-col overflow-hidden',
                phone ? 'on-panel bg-panel seam-t' : 'module',
              )}
            >
              <main className="flex min-h-0 flex-1 flex-col">
                {/* Keyed by page: a page that failed is tried again when you come back to it. */}
                <ErrorBoundary key={route}>
                  <Suspense fallback={<PageLoading />}>
                    {route === 'home' && <ChatsView />}
                    {route === 'automations' && <AutomationsView />}
                    {route === 'project' && <ProjectsView />}
                    {route === 'log' && <LogView />}
                    {route === 'vault' && <VaultView />}
                    {route === 'files' && <FilesView />}
                    {route === 'settings' && <SettingsView />}
                  </Suspense>
                </ErrorBoundary>
              </main>
            </div>
          )}
          <DockSlot />
        </div>
        <NoticeBar />
      </ToolbarProvider>
      <ReviewSheet />
      <NewsSheet />
      <CommandPalette />
    </div>
  );
}
