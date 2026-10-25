import { CheckCircle, Info, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { dismissNotice, retryLinkNow, useApp, type Notice } from '../../store/app.ts';
import { isSticky, noticeDuration } from '../../store/notice-queue.ts';
import { haltedResumeText, haltedWork, haltedWorkText } from '../../store/derive.ts';
import { useConnection, useNameOf } from '../../store/hooks.ts';
import { Button } from '../ui/button.tsx';
import { cn } from '../../lib/utils.ts';
import { ResumeButton } from './KillSwitch.tsx';
import { shellStrings } from './shell.strings.ts';

/**
 * The halt band under the top rail (docs/design.md, "Ferma"): while every
 * monster is stopped, a red light, the words, what the stop left halfway (a
 * question, a monster's work) and the keys: "Riprendi", and "Riprendi e
 * continua" when something can start again where it stopped.
 */
export function HaltBanner() {
  const halted = useApp((s) => s.halted);
  const reason = useApp((s) => s.haltedReason);
  const events = useApp((s) => s.events);
  const nameOf = useNameOf();
  const t = shellStrings().halt;
  const work = useMemo(() => (halted ? haltedWork(events) : null), [halted, events]);
  if (!halted) return null;
  const left = work ? haltedWorkText(work, nameOf) : null;
  const canContinue = (work?.requests.length ?? 0) > 0;
  const again = work ? haltedResumeText(work, nameOf) : null;
  return (
    <div
      role="status"
      data-testid="halt-banner"
      className="seam-b relative z-10 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 bg-stop-soft py-2 pr-3 pb-2.5 pl-5 text-ink"
    >
      <span aria-hidden className="led" data-tone="stop" />
      <span aria-hidden className="label shrink-0 text-stop-ink max-sm:hidden">
        {t.stopped}
      </span>
      <p className="min-w-0 flex-1 basis-[240px] text-body leading-snug">
        <strong className="font-semibold">{t.allStopped}</strong> {reason ? t.reason(reason) : ''}
        {left && <span data-testid="halt-left">{t.pending(left)}</span>}
        <span className="text-ink-muted">{t.canWrite}</span>
        {again && (
          <span className="text-ink-muted" data-testid="halt-again">
            {' '}
            {t.again(again, work?.requests.length ?? 0)}
          </span>
        )}
      </p>
      <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:justify-end">
        {canContinue ? (
          <>
            <ResumeButton testId="halt-resume" variant="secondary" />
            <ResumeButton testId="halt-continue" continueWork />
          </>
        ) : (
          <ResumeButton testId="halt-resume" />
        )}
      </div>
    </div>
  );
}

/**
 * The band under the rail while the core does not answer (after 3 attempts or 10 s): the
 * display and the bar of the capo already say "non collegato"; here it is said in words, with
 * the way to try again at once. It goes away by itself when the stream is back.
 */
export function LinkBand() {
  const lost = useConnection() === 'closed';
  const phase = useApp((s) => s.phase);
  const t = shellStrings().link;
  if (!lost || phase !== 'ready') return null;
  return (
    <div
      role="status"
      data-testid="link-band"
      className="seam-b relative z-10 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 bg-stop-soft py-2 pr-3 pb-2.5 pl-5 text-ink"
    >
      <span aria-hidden className="led" data-tone="stop" />
      <span aria-hidden className="label shrink-0 text-stop-ink max-sm:hidden">
        {t.notConnected}
      </span>
      <p className="min-w-0 flex-1 basis-[240px] text-body leading-snug">
        <strong className="font-semibold">{t.silent}</strong>{' '}
        <span className="text-ink-muted">{t.retrying}</span>
      </p>
      <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:justify-end">
        <Button variant="secondary" size="sm" data-testid="link-retry" onClick={retryLinkNow}>
          {t.retryNow}
        </Button>
      </div>
    </div>
  );
}

/**
 * One message at a time, the others in line behind it (store/notice-queue.ts). Once the shell is
 * up it sits in the flow under the page (`NoticeBar`, in ReadyShell): the page above it gets
 * shorter and nothing is covered, not the writing field, not the answers of a question, not
 * "Invia" (a failed send puts the text back there). Before that (login, boot) it floats at the
 * bottom (`NoticeToast`).
 *
 * A message goes away by itself, but the timer waits while the pointer is over it or the focus is
 * in it. One with a key ("Annulla", "Alza il tetto") stays a long while (30 s at least), and
 * news from the core with a key stays until it is used or dismissed. The keyboard reaches it: Ctrl/Cmd+Shift+. (or the palette) puts the focus on it,
 * Escape dismisses it, and either way the focus goes back to where it was (W-18).
 */

/** Where the focus was before it went to the message (null: nowhere to go back to). */
let returnTo: HTMLElement | null = null;

function rememberFocus() {
  const at = document.activeElement;
  returnTo = at instanceof HTMLElement && at !== document.body ? at : null;
}

function giveFocusBack() {
  const el = returnTo;
  returnTo = null;
  if (el?.isConnected) el.focus({ preventScroll: true });
}

/** Puts the focus on the message on screen (its key, or else its close key); false when there is none. */
export function focusNotice(): boolean {
  const card = document.querySelector<HTMLElement>('[data-testid="notice"]');
  if (!card) return false;
  if (!card.contains(document.activeElement)) rememberFocus();
  const key =
    card.querySelector<HTMLElement>('[data-testid="notice-action"]') ??
    card.querySelector<HTMLElement>('button');
  key?.focus({ preventScroll: true });
  return true;
}

/** The key that reaches the message from anywhere (it is in the palette's list too). */
function useNoticeShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Period' || !e.shiftKey || !(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (focusNotice()) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function NoticeCard({ notice }: { notice: Notice }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const sticky = isSticky(notice);
  const waiting = hovered || focused;
  const duration = noticeDuration(notice);
  useEffect(() => {
    // Waits while the pointer is over the message or the focus is in it.
    if (duration === null || waiting) return;
    const t = setTimeout(() => dismissNotice(notice.id), duration);
    return () => clearTimeout(t);
  }, [notice.id, duration, waiting]);
  const Icon =
    notice.tone === 'error' ? WarningCircle : notice.tone === 'success' ? CheckCircle : Info;
  const close = () => {
    giveFocusBack();
    dismissNotice(notice.id);
  };
  return (
    <div
      role={notice.tone === 'error' ? 'alert' : 'status'}
      data-testid="notice"
      data-sticky={sticky || undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        close();
      }}
      className={cn(
        'rise-in pointer-events-auto flex max-w-[460px] items-center gap-2.5 rounded-[12px] py-2 pr-2 pl-4 text-body font-medium shadow-[0_6px_0_-2px_rgba(var(--shadow-rgb),0.18),0_18px_40px_-16px_rgba(var(--shadow-rgb),0.45)]',
        notice.tone === 'error' ? 'bg-stop text-on-stop' : 'bg-ink text-panel',
      )}
    >
      <Icon size={20} weight="fill" aria-hidden className="shrink-0" />
      <span>{notice.text}</span>
      {notice.action && (
        <button
          type="button"
          onClick={() => {
            close();
            notice.action?.run();
          }}
          className="-mr-0.5 inline-flex h-7 shrink-0 items-center rounded-full px-2.5 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          data-testid="notice-action"
        >
          {notice.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={close}
        aria-label={shellStrings().close}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
      >
        <X size={14} weight="bold" aria-hidden />
      </button>
    </div>
  );
}

/** The message in the flow, at the foot of the shell: the page above it shrinks. */
export function NoticeBar() {
  const notice = useApp((s) => s.notice);
  return (
    <div
      className={cn(
        'pointer-events-none flex shrink-0 justify-center px-4',
        notice && 'pt-2 pb-2.5',
      )}
      aria-live="polite"
      data-layer-exempt
      data-testid="notice-bar"
    >
      {/* A new notice rises in three frames (styles.css `.rise-in`); it goes at once. */}
      {notice && <NoticeCard key={notice.id} notice={notice} />}
    </div>
  );
}

/** The floating message of the screens before the shell (login, boot, errors). */
export function NoticeToast() {
  const phase = useApp((s) => s.phase);
  const notice = useApp((s) => s.notice);
  // Mounted at every phase by NoticeRoot: the one place that listens for the key.
  useNoticeShortcut();
  // In the shell the bar shows it.
  if (phase === 'ready') return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
      aria-live="polite"
      data-layer-exempt
    >
      {notice && <NoticeCard key={notice.id} notice={notice} />}
    </div>
  );
}
