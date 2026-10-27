import { Tray, X } from '@phosphor-icons/react';
import { useMemo, useRef } from 'react';
import { useApp, setReviewOpen } from '../../store/app.ts';
import { useMediaQuery } from '../../store/hooks.ts';
import { setPrefs, usePrefs } from '../../store/prefs.ts';
import { useDrafts } from '../../store/projects.ts';
import { inboxCount, setInboxTab } from '../../store/inbox.ts';
import { hasNews, useNews } from '../../store/news.ts';
import { cn } from '../../lib/utils.ts';
import {
  hashParam,
  projectTabOf,
  routeOf,
  useHashParam,
  useRoute,
  type Route,
} from '../../lib/router.ts';
import { hideDock, usePreview } from '../../store/preview.ts';
import { pausedToolEvents } from '../log/activity.ts';
import { REVIEW_WITH_DOCK_FROM } from '../dock/layout.ts';
import { useChats } from '../chat/useChats.ts';
import { ActivityPanel } from '../log/ActivityPanel.tsx';
import { LabeledKey } from '../ui/button.tsx';
import { useLayer } from '../ui/layers.ts';
import { shellStrings } from './shell.strings.ts';

/*
 * The Inbox (docs/design.md, "The top rail"): "To review" (the drafts of the monsters to confirm,
 * D-100, the open questions, the paused tools and the notes touched lately, with their undo) and the
 * news of the updates, as two tabs of one panel. On windows of 1280 px and more the panel is a column
 * next to the chat (a preference); on narrower windows and on phones a sheet on the right, like
 * "Behind the scenes" (full screen on a phone). One key in the rail opens it and carries one number:
 * what waits for the user (`inboxCount`), the same everywhere.
 */

/** Wide enough for the column next to the chat. */
export const REVIEW_COLUMN_QUERY = '(min-width: 1280px)';
/** Wide enough for the column and the right-hand pane together (components/dock/layout.ts). */
const WITH_DOCK_QUERY = `(min-width: ${REVIEW_WITH_DOCK_FROM}px)`;

/**
 * Whether the page of this route has a place for the column: the chat of the home, or the chat
 * tab of a project (D-100). Anywhere else (Notes, Settings…) "To review" is a sheet.
 */
export function reviewColumnPage(
  route: Route,
  project: string | null,
  tab: string | null,
): boolean {
  if (route === 'home') return true;
  return route === 'project' && !!project && projectTabOf(tab) === 'chat';
}

/**
 * Whether the column is on screen: wide window and the preference on, and the
 * right-hand pane closed unless the window is wide enough for both (D-075).
 */
export function useReviewColumn(): boolean {
  const column = useMediaQuery(REVIEW_COLUMN_QUERY);
  const both = useMediaQuery(WITH_DOCK_QUERY);
  const on = usePrefs((p) => p.activityPanel);
  const dock = usePreview((s) => s.visible);
  return column && on && (!dock || both);
}

/**
 * What waits for the user: the drafts to confirm, the open questions of the chats and the paused
 * tools (`inboxCount`). It does not depend on what was seen, on the page or on the width.
 */
export function useInboxCount(): number {
  const drafts = useDrafts();
  const events = useApp((s) => s.events);
  const { waiting } = useChats();
  const paused = useMemo(() => pausedToolEvents(events).length, [events]);
  return inboxCount({ drafts: drafts?.length ?? 0, waiting, paused });
}

/** Whether the version in use has news that were not looked at. */
function useFreshNews(): boolean {
  const version = useApp((s) => s.version);
  const seen = useNews((s) => s.seen);
  return hasNews(version, seen);
}

/** Opens the Inbox the way this window can show it (the palette, the rail). */
export function showReview(): void {
  const hash = window.location.hash;
  if (
    window.matchMedia(REVIEW_COLUMN_QUERY).matches &&
    hash.startsWith('#/') &&
    reviewColumnPage(routeOf(hash), hashParam(hash, 'id'), hashParam(hash, 'section'))
  ) {
    // The column sits next to a chat: the home's, or a project's (D-100).
    setPrefs({ activityPanel: true });
    if (!window.matchMedia(WITH_DOCK_QUERY).matches) hideDock();
    return;
  }
  setReviewOpen(true);
}

/** Opens the Inbox on the news tab (the palette's "What's new"). */
export function showNews(): void {
  setInboxTab('news');
  showReview();
}

/** Opens the Inbox on "To review" (the palette). */
export function showToReview(): void {
  setInboxTab('review');
  showReview();
}

/**
 * Where the Inbox is on this page and whether it is on screen: `column` (this page has a place for
 * the column), `shown` (the column is on screen) and `on` (the column or the sheet is open).
 */
export function useInboxPlace(): { column: boolean; shown: boolean; on: boolean } {
  const route = useRoute();
  const project = useHashParam('id');
  const tab = useHashParam('section');
  // The key is in the rail of every page: the column is only there on the pages that have a place for it.
  const column = useMediaQuery(REVIEW_COLUMN_QUERY) && reviewColumnPage(route, project, tab);
  const shown = useReviewColumn() && column;
  const sheetOn = useApp((s) => s.reviewOpen);
  return { column, shown, on: column ? shown : sheetOn };
}

/**
 * The key of the rail: the column on wide windows, the sheet elsewhere. One number, what waits for
 * the user; the light of the news is beside it (or alone when nothing waits).
 */
export function InboxKey({ layout }: { layout: 'inline' | 'stacked' | 'icon' }) {
  const { column, shown, on } = useInboxPlace();
  const sheetOn = useApp((s) => s.reviewOpen);
  const count = useInboxCount();
  const fresh = useFreshNews();
  const s = shellStrings().inbox;
  // The column hidden by the right-hand pane comes back in its place.
  const toggleColumn = () => {
    if (shown) setPrefs({ activityPanel: false });
    else {
      setPrefs({ activityPanel: true });
      if (!window.matchMedia(WITH_DOCK_QUERY).matches) hideDock();
    }
  };
  const onClick = () => {
    // Opened by the key it starts where something waits: "To review", or the news when only they do.
    if (!on) setInboxTab(count === 0 && fresh ? 'news' : 'review');
    if (column) toggleColumn();
    else setReviewOpen(!sheetOn);
  };
  return (
    <LabeledKey
      label={s.label}
      layout={layout}
      pressed={on}
      data-testid="review-toggle"
      data-fresh={fresh ? '' : undefined}
      title={s.title(count, on)}
      aria-label={s.named(count, fresh)}
      onClick={onClick}
      badge={
        count > 0 || fresh ? (
          <span className="inline-flex items-center gap-1">
            {count > 0 && (
              <span
                aria-hidden
                data-testid="review-count"
                className="inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-signal px-1 font-mono text-micro leading-none font-medium text-on-signal tabular-nums"
              >
                {count > 9 ? '9+' : count}
              </span>
            )}
            {fresh && (
              <span aria-hidden data-testid="news-led" className="led" data-tone="signal" />
            )}
          </span>
        ) : undefined
      }
    >
      <Tray size={20} aria-hidden />
    </LabeledKey>
  );
}

/** The sheet: mounted by the shell, shown while `reviewOpen`. */
export function ReviewSheet() {
  const s = shellStrings().inbox;
  const open = useApp((s) => s.reviewOpen);
  const sheet = useRef<HTMLElement>(null);
  const closeKey = useRef<HTMLButtonElement>(null);
  // Not modal (the chat stays usable beside it): Escape closes it only when it is the top layer,
  // the focus goes to its close key and comes back to the key of the rail.
  useLayer({
    open,
    ref: sheet,
    initialFocus: closeKey,
    onEscape: () => setReviewOpen(false),
  });
  if (!open) return null;
  return (
    <aside
      ref={sheet}
      role="dialog"
      aria-modal="false"
      aria-label={s.label}
      data-testid="review-sheet"
      className={cn(
        'review-sheet slide-in raised fixed inset-x-0 top-[52px] bottom-0 z-30 flex flex-col overflow-hidden rounded-none',
        'sm:top-[60px] sm:right-3 sm:bottom-3 sm:left-auto sm:w-[380px] sm:rounded-[14px]',
      )}
    >
      <button
        ref={closeKey}
        type="button"
        onClick={() => setReviewOpen(false)}
        aria-label={s.close}
        title={s.closeTitle}
        className="key-ghost absolute top-3 right-3 z-[1] inline-flex size-9 items-center justify-center rounded-[9px] text-ink-muted hover:text-ink"
      >
        <X size={18} weight="bold" aria-hidden />
      </button>
      <ActivityPanel className="min-h-0 flex-1" />
    </aside>
  );
}
