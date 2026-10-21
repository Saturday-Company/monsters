import { Tray, X } from '@phosphor-icons/react';
import { useEffect, useMemo } from 'react';
import { useApp, setReviewOpen } from '../../store/app.ts';
import { useMediaQuery } from '../../store/hooks.ts';
import { setPrefs, usePrefs } from '../../store/prefs.ts';
import { useDrafts } from '../../store/projects.ts';
import { markSeen, seenOf, useReads } from '../../store/reads.ts';
import { cn } from '../../lib/utils.ts';
import { hideDock, usePreview } from '../../store/preview.ts';
import { pausedToolEvents } from '../log/activity.ts';
import { REVIEW_WITH_DOCK_FROM } from '../dock/layout.ts';
import { ActivityPanel, latestNoteChanges } from '../log/ActivityPanel.tsx';
import { LabeledKey } from '../ui/button.tsx';
import { shellStrings } from './shell.strings.ts';

/*
 * "Da rivedere" (docs/design.md, "La chat"): the drafts of the monsters to
 * confirm (D-100), the open questions and the notes touched lately, with their undo. On windows of 1280 px and more it is a
 * column next to the chat (a preference); on narrower windows and on phones a
 * sheet on the right, like "Dietro le quinte" (full screen on a phone). The
 * key in the rail says how many things wait there.
 */

/** The marker of what "Da rivedere" was last looked at (the reads of the chats, one more key). */
const REVIEW = '__review';

/** Wide enough for the column next to the chat. */
export const REVIEW_COLUMN_QUERY = '(min-width: 1280px)';
/** Wide enough for the column and the right-hand pane together (components/dock/layout.ts). */
const WITH_DOCK_QUERY = `(min-width: ${REVIEW_WITH_DOCK_FROM}px)`;

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

/** The drafts to confirm and the open questions, plus the notes touched since "Da rivedere" was last looked at. */
export function useReviewCount(): number {
  const drafts = useDrafts();
  const events = useApp((s) => s.events);
  const questions = useApp((s) => s.questions);
  const seen = useReads((r) => seenOf(r, REVIEW));
  const notes = useMemo(() => latestNoteChanges(events), [events]);
  const open = Object.values(questions).filter((q) => q.status === 'open').length;
  const paused = useMemo(() => pausedToolEvents(events).length, [events]);
  return (drafts?.length ?? 0) + open + paused + notes.filter((e) => e.id > seen).length;
}

/** While "Da rivedere" is on screen, what it shows counts as seen. */
function useMarkReviewed(on: boolean) {
  const last = useApp((s) => s.events.at(-1)?.id ?? '');
  useEffect(() => {
    if (on && last) markSeen(REVIEW, last);
  }, [on, last]);
}

/** Opens "Da rivedere" the way this window can show it (the palette, the rail). */
export function showReview(): void {
  if (window.matchMedia(REVIEW_COLUMN_QUERY).matches && window.location.hash.startsWith('#/')) {
    // The column sits next to a chat: the home's, or a project's (D-100).
    const hash = window.location.hash;
    const home =
      !/^#\/(log|note|file|automazioni|impostazioni|benvenuto|progetto)/.test(hash) ||
      (/^#\/progetto\?id=/.test(hash) && !/[?&]sezione=/.test(hash));
    if (home) {
      setPrefs({ activityPanel: true });
      if (!window.matchMedia(WITH_DOCK_QUERY).matches) hideDock();
      return;
    }
  }
  setReviewOpen(true);
}

/** The key of the rail: the column on wide windows, the sheet elsewhere; the number of what waits. */
export function ReviewKey({ layout }: { layout: 'inline' | 'stacked' | 'icon' }) {
  const column = useMediaQuery(REVIEW_COLUMN_QUERY);
  const shown = useReviewColumn();
  const sheetOn = useApp((s) => s.reviewOpen);
  const count = useReviewCount();
  const s = shellStrings().review;
  const on = column ? shown : sheetOn;
  useMarkReviewed(shown);
  // The column hidden by the right-hand pane comes back in its place.
  const toggleColumn = () => {
    if (shown) setPrefs({ activityPanel: false });
    else {
      setPrefs({ activityPanel: true });
      if (!window.matchMedia(WITH_DOCK_QUERY).matches) hideDock();
    }
  };
  return (
    <LabeledKey
      label={s.label}
      layout={layout}
      pressed={on}
      data-testid="review-toggle"
      title={count > 0 ? s.count(count) : on ? s.hide : s.show}
      aria-label={count > 0 ? s.withCount(count) : s.label}
      onClick={() => (column ? toggleColumn() : setReviewOpen(!sheetOn))}
      badge={
        count > 0 ? (
          <span
            aria-hidden
            data-testid="review-count"
            className="inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-signal px-1 font-mono text-micro leading-none font-medium text-on-signal tabular-nums"
          >
            {count > 9 ? '9+' : count}
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
  const s = shellStrings().review;
  const open = useApp((s) => s.reviewOpen);
  useMarkReviewed(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReviewOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <aside
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
