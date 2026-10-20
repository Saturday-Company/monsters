import { CheckCircle, Info, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useMemo } from 'react';
import { dismissNotice, retryLinkNow, useApp, type Notice } from '../../store/app.ts';
import { haltedResumeText, haltedWork, haltedWorkText } from '../../store/derive.ts';
import { useConnection, useNameOf } from '../../store/hooks.ts';
import { Button } from '../ui/button.tsx';
import { cn } from '../../lib/utils.ts';
import { ResumeButton } from './KillSwitch.tsx';

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
        Fermi
      </span>
      <p className="min-w-0 flex-1 basis-[240px] text-body leading-snug">
        <strong className="font-semibold">I mostri sono fermi.</strong>{' '}
        {reason ? `Motivo: ${reason}. ` : ''}
        {left && <span data-testid="halt-left">In sospeso: {left}. </span>}
        <span className="text-ink-muted">Puoi scrivere: i messaggi partono quando riprendi.</span>
        {again && (
          <span className="text-ink-muted" data-testid="halt-again">
            {' '}
            Con «Riprendi e continua» ripartono {again}.
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
  if (!lost || phase !== 'ready') return null;
  return (
    <div
      role="status"
      data-testid="link-band"
      className="seam-b relative z-10 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 bg-stop-soft py-2 pr-3 pb-2.5 pl-5 text-ink"
    >
      <span aria-hidden className="led" data-tone="stop" />
      <span aria-hidden className="label shrink-0 text-stop-ink max-sm:hidden">
        Non collegato
      </span>
      <p className="min-w-0 flex-1 basis-[240px] text-body leading-snug">
        <strong className="font-semibold">Monsters sul computer non risponde.</strong>{' '}
        <span className="text-ink-muted">Riprovo da solo.</span>
      </p>
      <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:justify-end">
        <Button variant="secondary" size="sm" data-testid="link-retry" onClick={retryLinkNow}>
          Riprova adesso
        </Button>
      </div>
    </div>
  );
}

/**
 * One transient message at a time. Once the shell is up it sits in the flow under the page
 * (`NoticeBar`, in ReadyShell): the page above it gets shorter and nothing is covered, not
 * the writing field, not the answers of a question, not "Invia" (a failed send puts the text
 * back there). Before that (login, boot) it floats at the bottom (`NoticeToast`).
 */
function useNotice() {
  const notice = useApp((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(
      () => dismissNotice(notice.id),
      notice.ms ?? (notice.tone === 'error' ? 6000 : 3500),
    );
    return () => clearTimeout(t);
  }, [notice]);
  return notice;
}

function NoticeCard({ notice }: { notice: Notice }) {
  const Icon =
    notice.tone === 'error' ? WarningCircle : notice.tone === 'success' ? CheckCircle : Info;
  return (
    <div
      key={notice.id}
      role={notice.tone === 'error' ? 'alert' : 'status'}
      data-testid="notice"
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
            dismissNotice(notice.id);
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
        onClick={() => dismissNotice(notice.id)}
        aria-label="Chiudi"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full opacity-80 hover:opacity-100"
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
      data-testid="notice-bar"
    >
      {/* A new notice rises in three frames (styles.css `.rise-in`); it goes at once. */}
      {notice && <NoticeCard notice={notice} />}
    </div>
  );
}

/** The floating message of the screens before the shell (login, boot, errors). */
export function NoticeToast() {
  const phase = useApp((s) => s.phase);
  // The one place that times the message out, wherever it is shown.
  const notice = useNotice();
  // In the shell the bar shows it.
  if (phase === 'ready') return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
      aria-live="polite"
    >
      {notice && <NoticeCard notice={notice} />}
    </div>
  );
}
