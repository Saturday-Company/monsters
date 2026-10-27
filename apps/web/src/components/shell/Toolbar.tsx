import { CaretLeft } from '@phosphor-icons/react';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { goHome } from '../../lib/router.ts';
import { cn } from '../../lib/utils.ts';
import { setReviewOpen, useApp } from '../../store/app.ts';
import { hideDock, usePreview } from '../../store/preview.ts';
import { closeByBack } from '../dock/back.ts';
import { useMediaQuery } from '../../store/hooks.ts';
import { KillSwitch } from './KillSwitch.tsx';
import { InboxKey } from './ReviewSheet.tsx';
import { shellStrings } from './shell.strings.ts';
import { StatusDisplay } from './StatusDisplay.tsx';

/*
 * The top rail (docs/design.md, "Il binario superiore"): 52 px of chassis
 * across the whole window, and the window's title bar. On the left, as wide as
 * the sidebar, room for the traffic lights (macOS) and the monsters wordmark;
 * a seam; the title of the view and its keys; on the right the status display
 * and Stop, always there, and before them the Inbox key of every page; on Windows and Linux the room of the system
 * buttons. The shell owns the rail, so the stop stays even when a view is
 * loading or broken; each view puts its title and keys in it through
 * `<ToolbarContent>` (a portal). Until it does, the rail shows the page's name.
 */

/** The height of the rail. */
export const TOOLBAR_HEIGHT = 52;

/** The width of the sidebar, and of the rail's left zone above it. */
export const SIDEBAR_WIDTH = 300;

const Slot = createContext<HTMLElement | null>(null);

/** Puts a view's title and actions in the top rail. */
export function ToolbarContent({ children }: { children: ReactNode }) {
  const slot = useContext(Slot);
  return slot ? createPortal(children, slot) : null;
}

/** Title of a view in the rail (the page's heading): Instrument Sans 17 semibold. */
export function ToolbarTitle({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <h1
      id={id}
      className={cn('min-w-0 truncate text-large leading-6 font-semibold text-ink', className)}
    >
      {children}
    </h1>
  );
}

/** The keys of a view, on the right of its title: ghost keys with 20 px icons. */
export function ToolbarActions({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="toolbar-actions"
      className="ml-auto flex h-10 shrink-0 items-center gap-1 empty:hidden [&>button]:text-ink-muted [&>button:hover]:text-ink"
    >
      {children}
    </div>
  );
}

/*
 * Where "‹ Indietro" leads on a phone. By default back to the home (the
 * sidebar); a view inside a view (a note open over the list) says where its
 * own back goes with `useToolbarBack`, so the rail has the only back key.
 */
interface BackTarget {
  label: string;
  run: () => void;
}
let backTarget: BackTarget | null = null;
const backListeners = new Set<() => void>();
function setBackTarget(t: BackTarget | null) {
  backTarget = t;
  for (const l of backListeners) l();
}
function subscribeBack(cb: () => void) {
  backListeners.add(cb);
  return () => backListeners.delete(cb);
}

/**
 * Makes the rail's back key (phone) go one level up inside the view instead of
 * home: `useToolbarBack(open ? { label: 'Note', run: toList } : null)`.
 */
export function useToolbarBack(target: BackTarget | null): void {
  const run = useRef(target?.run);
  useEffect(() => {
    run.current = target?.run;
  });
  const label = target?.label ?? null;
  useEffect(() => {
    if (label === null) return;
    setBackTarget({ label, run: () => run.current?.() });
    return () => setBackTarget(null);
  }, [label]);
}

/** The back key of the rail: the pane or a sheet over the page closes first, then the view's own back. */
function BackKey() {
  const target = useSyncExternalStore(subscribeBack, () => backTarget);
  const review = useApp((s) => s.reviewOpen);
  const dock = usePreview((s) => s.visible);
  const sheet = review || dock;
  const onClick = () => {
    if (dock) closeByBack(hideDock);
    else if (review) setReviewOpen(false);
    else if (target) target.run();
    else goHome();
  };
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="toolbar-back"
      className="key-ghost flex h-10 items-center gap-0.5 pr-2.5 pl-1 text-body font-semibold text-signal-ink"
    >
      <CaretLeft size={20} weight="bold" aria-hidden />
      {/* On a small phone the arrow says it; the word is still its name. */}
      <span className="max-[439px]:sr-only">
        {sheet || !target ? shellStrings().toolbar.back : target.label}
      </span>
    </button>
  );
}

export function useToolbarSlot() {
  return useState<HTMLElement | null>(null);
}

export function ToolbarProvider({
  slot,
  children,
}: {
  slot: HTMLElement | null;
  children: ReactNode;
}) {
  return <Slot.Provider value={slot}>{children}</Slot.Provider>;
}

/** "monsters" in dots, with "PROVA" when the app runs on the mock core. */
function Wordmark({ mock }: { mock: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        className="dots truncate text-title3 leading-none text-ink"
        aria-label="Monsters"
        role="img"
      >
        {/* the wordmark is not translated */ 'monsters'}
      </span>
      {mock && (
        <span className="label rounded-[5px] px-1.5 text-signal-ink shadow-[inset_0_0_0_1px_currentColor] max-[479px]:hidden">
          {shellStrings().toolbar.demo}
        </span>
      )}
    </span>
  );
}

export function Toolbar({
  title,
  onSlot,
  phone,
  atHome,
  titleHidden = false,
  mock = false,
}: {
  /** The name of the page, shown until the view puts its own title. */
  title: string;
  onSlot: (el: HTMLElement | null) => void;
  /** Phone: the wordmark at home, "Indietro" inside a view; no left zone. */
  phone: boolean;
  /** Phone home (the sidebar is the page): no view title, no Back. */
  atHome: boolean;
  /** The chat: the name lives on the monster's monitor, the heading is for screen readers. */
  titleHidden?: boolean;
  mock?: boolean;
}) {
  const wide = useMediaQuery('(min-width: 1100px)');
  // The status display gives way before anything else: its words need 1440 px, its short form
  // 1000, below that a light with the number. The page's title and keys keep their room (R2).
  const ample = useMediaQuery('(min-width: 1440px)');
  const tablet = useMediaQuery('(max-width: 999px)');
  // A big phone, or one held sideways, has room for the words of the status; a small one, for its light and count.
  const roomy = useMediaQuery('(min-width: 540px)');
  // Above every layer of the shell (terminal z-30, menus z-40): Ferma is always
  // visible and clickable.
  return (
    <header
      data-titlebar
      data-testid="toolbar"
      className="titlebar-end relative z-50 flex h-[52px] shrink-0 items-center bg-chassis pr-3"
    >
      {!phone && (
        <>
          <div
            className="titlebar-start flex h-full shrink-0 items-center pr-4 pl-5"
            style={{ width: SIDEBAR_WIDTH }}
          >
            <Wordmark mock={mock} />
          </div>
          <span aria-hidden className="seam-v h-6" />
        </>
      )}
      {phone && (
        <div className="titlebar-start flex shrink-0 items-center pl-2">
          {atHome ? (
            <span className="pl-2">
              <Wordmark mock={mock} />
            </span>
          ) : (
            <BackKey />
          )}
        </div>
      )}
      <div
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3',
          phone ? 'px-2' : 'px-4',
          phone && atHome && 'invisible',
        )}
      >
        <div
          ref={onSlot}
          className={cn(
            'peer flex min-w-0 flex-1 items-center gap-3 empty:hidden',
            titleHidden && '[&_h1]:sr-only',
          )}
        />
        <p
          aria-hidden
          className={cn(
            'hidden min-w-0 flex-1 truncate text-large leading-6 font-semibold text-ink peer-empty:block',
            titleHidden && 'invisible',
          )}
        >
          {title}
        </p>
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-3">
        {/*
          The Inbox ("To review" and the news in one) is in the rail of every page: the drafts, the
          questions and the paused tools wait there whatever page is open. One number; a light for
          news that were not seen.
        */}
        <div className="flex shrink-0 items-center">
          {/*
            Without room for the word (a narrow window, or a phone inside a page) the tray with its
            count says how many things wait; on the phone's home, or a wide phone, the word goes under it.
          */}
          <InboxKey
            layout={phone ? (atHome || roomy ? 'stacked' : 'icon') : wide ? 'inline' : 'icon'}
          />
        </div>
        <StatusDisplay
          size={phone ? (roomy ? 'compact' : 'dot') : ample ? 'full' : tablet ? 'dot' : 'compact'}
        />
        <KillSwitch compact={phone || tablet} />
      </div>
    </header>
  );
}
