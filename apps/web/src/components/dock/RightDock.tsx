import { X } from '@phosphor-icons/react';
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useHashParam, useRoute } from '../../lib/router.ts';
import { cn } from '../../lib/utils.ts';
import { useApp } from '../../store/app.ts';
import { useOrchestrator } from '../../store/hooks.ts';
import { DOCK_WIDTH_DEFAULT, DOCK_WIDTH_MIN, setPrefs, usePrefs } from '../../store/prefs.ts';
import { hideDock, usePreview, type DockTab } from '../../store/preview.ts';
import { ErrorBoundary } from '../shell/ErrorBoundary.tsx';
import { useUsageSheet } from '../usage/state.ts';
import { closeByBack, useBackCloses } from './back.ts';
import { chatAgentOf } from './follow.ts';
import { clampDockWidth, DOCK_GUTTER, dockMaxWidth, dockMode, type DockMode } from './layout.ts';
import '../chat/chat.css';
import './dock.css';

/*
 * The right-hand pane (docs/design.md, "Pannello a destra"; D-075): one black
 * screen set in the chassis, with three tabs: Anteprima (files and notes),
 * Dietro le quinte (the monster's terminal) and Consumi. On a wide window it
 * is a column of its own and the content shrinks; on a narrower one a sheet
 * over the content; on a phone the whole screen under the top rail. Ferma and
 * the rail are never covered. Esc or ✕ close it (on a phone the browser's Back
 * too), ⌘J / Ctrl J toggles it, the
 * grip on its left edge sets its width (remembered by this browser).
 */

const PreviewPane = lazy(() => import('../preview/PreviewPane.tsx'));
const TerminalPanel = lazy(() =>
  import('../terminal/AgentTerminal.tsx').then((m) => ({ default: m.TerminalPanel })),
);
const UsagePanel = lazy(() =>
  import('../usage/UsagePanel.tsx').then((m) => ({ default: m.UsagePanel })),
);

const TABS: { value: DockTab; label: string }[] = [
  { value: 'preview', label: 'Anteprima' },
  { value: 'terminal', label: 'Dietro le quinte' },
  { value: 'usage', label: 'Consumi' },
];

function subscribeResize(cb: () => void) {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}

function useViewportWidth(): number {
  return useSyncExternalStore(subscribeResize, () => window.innerWidth);
}

/** Keyboard step of the grip, in px (Shift: four times). */
const STEP = 16;

function Grip({
  width,
  max,
  onDrag,
  onDone,
}: {
  width: number;
  max: number;
  onDrag: (w: number) => void;
  onDone: (w: number) => void;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const last = useRef(width);
  const [dragging, setDragging] = useState(false);
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    // The pane grows to the left: moving the grip left widens it.
    const w = Math.round(start.current.w + (start.current.x - e.clientX));
    last.current = Math.max(DOCK_WIDTH_MIN, Math.min(max, w));
    onDrag(last.current);
  };
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    onDone(last.current);
  };
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? STEP * 4 : STEP;
    let w: number | null = null;
    if (e.key === 'ArrowLeft') w = width + step;
    else if (e.key === 'ArrowRight') w = width - step;
    else if (e.key === 'Home') w = max;
    else if (e.key === 'End') w = DOCK_WIDTH_MIN;
    if (w === null) return;
    e.preventDefault();
    onDone(Math.max(DOCK_WIDTH_MIN, Math.min(max, w)));
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Larghezza del pannello"
      aria-valuemin={DOCK_WIDTH_MIN}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      title="Trascina per cambiare la larghezza (doppio clic: torna com’era)"
      data-testid="dock-grip"
      data-dragging={dragging ? '' : undefined}
      className="dock-grip"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        start.current = { x: e.clientX, w: width };
        last.current = width;
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onDone(DOCK_WIDTH_DEFAULT)}
      onKeyDown={key}
    >
      <span aria-hidden className="dock-grip-mark" />
    </div>
  );
}

function TabPanel({ tab, agentId }: { tab: DockTab; agentId: string | null }) {
  if (tab === 'preview') return <PreviewPane />;
  if (!agentId) {
    return (
      <p className="px-5 py-10 text-center text-screen-muted">
        Apri la chat di un mostro per vedere {tab === 'terminal' ? 'cosa fa' : 'i suoi consumi'}.
      </p>
    );
  }
  return tab === 'terminal' ? (
    <TerminalPanel agentId={agentId} />
  ) : (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="usage-sheet">
      <UsagePanel key={agentId} agentId={agentId} />
    </div>
  );
}

export default function RightDock({ leaving }: { leaving: boolean }) {
  const tab = usePreview((s) => s.tab);
  const focusNonce = usePreview((s) => s.focusNonce);
  const route = useRoute();
  const chat = useHashParam('chat');
  const orchId = useOrchestrator()?.id ?? null;
  const chatAgent = chatAgentOf(route, chat, orchId);
  const terminalAgent = useApp((s) => s.terminalAgent) ?? chatAgent;
  const usageAgent = useUsageSheet((s) => s.agentId) ?? chatAgent;
  const wanted = usePrefs((p) => p.dockWidth);
  const viewport = useViewportWidth();
  const mode: DockMode = dockMode(viewport);
  const [dragged, setDragged] = useState<number | null>(null);
  const width = clampDockWidth(dragged ?? wanted, viewport, mode);
  const max = dockMaxWidth(viewport, mode);
  const panel = useRef<HTMLElement>(null);
  const ids = useId();

  // One thing on the right: "Da rivedere" as a sheet makes room for the pane.
  useEffect(() => {
    if (!leaving) useApp.setState({ reviewOpen: false });
  }, [leaving]);

  // On a phone the pane is the whole screen: the browser's Back closes it (D-086).
  useBackCloses(mode === 'phone' && !leaving, hideDock);

  // Esc closes the pane (what is inside handles its own Esc first: a zoomed image, the palette).
  useEffect(() => {
    if (leaving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      closeByBack(hideDock);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leaving]);

  // The focus comes here only when the user asked for the pane (not when a monster shows something).
  const focused = useRef(0);
  useEffect(() => {
    if (leaving || focusNonce === focused.current) return;
    focused.current = focusNonce;
    panel.current?.focus({ preventScroll: true });
  }, [focusNonce, leaving]);

  const select = (value: DockTab) => {
    if (value === 'terminal' && !useApp.getState().terminalAgent && chatAgent)
      useApp.setState({ terminalAgent: chatAgent });
    if (value === 'usage' && !useUsageSheet.getState().agentId && chatAgent)
      useUsageSheet.setState({ agentId: chatAgent });
    usePreview.getState().showTab(value, { focus: false });
  };

  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = TABS.findIndex((t) => t.value === tab);
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = TABS[(at + d + TABS.length) % TABS.length]!;
    select(next.value);
    document.getElementById(`${ids}-tab-${next.value}`)?.focus();
  };

  const style: CSSProperties =
    mode === 'phone' ? {} : { width: mode === 'side' ? width + 2 * DOCK_GUTTER : width };

  return (
    <div
      className={cn('dock-frame', `dock-${mode}`, leaving && 'dock-leaving')}
      style={style}
      data-testid="dock-frame"
      data-mode={mode}
      inert={leaving}
    >
      {mode !== 'phone' && (
        <Grip
          width={width}
          max={max}
          onDrag={setDragged}
          onDone={(w) => {
            setDragged(null);
            setPrefs({ dockWidth: w });
          }}
        />
      )}
      <aside
        ref={panel}
        tabIndex={-1}
        aria-label="Pannello a destra"
        data-testid="right-dock"
        data-tab={tab}
        className="dock screen flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none"
      >
        <header className="dock-head flex shrink-0 items-center gap-2 pr-2 pl-3">
          <div
            role="tablist"
            aria-label="Cosa mostra il pannello"
            className="scroll-screen flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-2"
            onKeyDown={onTabKey}
          >
            {TABS.map((t) => (
              <button
                key={t.value}
                id={`${ids}-tab-${t.value}`}
                type="button"
                role="tab"
                aria-selected={tab === t.value}
                aria-controls={`${ids}-panel`}
                tabIndex={tab === t.value ? 0 : -1}
                onClick={() => select(t.value)}
                className="dock-tab label shrink-0"
                data-testid={`dock-tab-${t.value}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => closeByBack(hideDock)}
            aria-label="Chiudi il pannello"
            title="Chiudi (Esc)"
            data-testid="dock-close"
            className="screen-key size-9 shrink-0 px-0"
          >
            <X size={18} weight="bold" aria-hidden />
          </button>
        </header>
        <div
          key={tab}
          id={`${ids}-panel`}
          role="tabpanel"
          aria-labelledby={`${ids}-tab-${tab}`}
          className={cn(
            'dock-panel flex min-h-0 flex-1 flex-col',
            tab !== 'preview' && 'screen-lines',
          )}
        >
          {/* The tab's own boundary: a renderer that fails leaves the tabs and ✕ working. */}
          <ErrorBoundary key={tab}>
            <Suspense fallback={<p className="sr-only">Carico…</p>}>
              <TabPanel
                tab={tab}
                agentId={tab === 'terminal' ? terminalAgent : tab === 'usage' ? usageAgent : null}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      </aside>
    </div>
  );
}
