import { ArrowClockwise } from '@phosphor-icons/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { desktop } from '../../lib/desktop.ts';
import { domId } from '../../lib/utils.ts';
import { boot } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { Meter } from '../ui/Meter.tsx';
import { authStrings } from './auth.strings.ts';
import { DeviceFrame, DeviceScreen } from './Device.tsx';

/*
 * "Non trovo Monsters": the page when the core does not answer at the start. The same device as
 * the Accesso (docs/design.md): the monster asleep on its screen, the words under it, one key.
 * The words differ between the browser (start Monsters on the computer) and the desktop app
 * (close it and open it again); the command line stays under "Dettagli". While the page is in
 * view it tries again by itself, with growing pauses (the stream does the same once connected),
 * and says so; "Riprova" does it now and shows that it is trying.
 */

/** The pauses between automatic attempts; the last one repeats. */
const RETRY_PAUSES_MS = [2_000, 4_000, 8_000, 15_000, 30_000] as const;
/** An attempt that fails at once still shows "Trying again…" for this long, so the key visibly answers. */
const MIN_TRYING_MS = 700;

/** Starts again from the boot: now (`retry`), and by itself after each pause while the page is visible. */
function useRetry(): { trying: boolean; retry: () => void } {
  const [trying, setTrying] = useState(false);
  const [round, setRound] = useState(0);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const retry = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setTrying(true);
    const started = Date.now();
    void boot().then(async () => {
      const left = MIN_TRYING_MS - (Date.now() - started);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      busy.current = false;
      // A boot that worked has already replaced this page.
      if (!alive.current) return;
      setTrying(false);
      setRound((n) => n + 1);
    });
  }, []);
  useEffect(() => {
    if (trying) return;
    let due = false;
    const go = () => {
      if (document.visibilityState === 'visible') retry();
      else due = true;
    };
    const t = setTimeout(go, RETRY_PAUSES_MS[Math.min(round, RETRY_PAUSES_MS.length - 1)]);
    // Hidden tab: no attempts; the one that fell due goes as soon as it is seen again.
    const onVisible = () => {
      if (due && document.visibilityState === 'visible') {
        due = false;
        retry();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [trying, round, retry]);
  return { trying, retry };
}

function Details({ app }: { app: boolean }) {
  const s = authStrings().unreachable;
  const id = domId(useId());
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 grid gap-3">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="mx-auto text-footnote text-signal-ink hover:text-signal-ink"
      >
        {s.details}
      </Button>
      {open && (
        <div
          id={id}
          data-testid="unreachable-details"
          className="well rise-in grid gap-2 rounded-[12px] px-4 py-3.5 text-body leading-snug text-ink-muted"
        >
          <p className="label text-ink">{s.terminalTitle}</p>
          <p>
            {s.terminalBefore}
            {/* i18n-ignore: a command */}
            <code className="font-mono text-ink">monsters start</code>
            {app ? s.terminalApp : ''}
            {s.terminalAfter}
          </p>
        </div>
      )}
    </div>
  );
}

export function UnreachableScreen() {
  const s = authStrings().unreachable;
  const app = desktop() !== null;
  const { trying, retry } = useRetry();
  return (
    <DeviceFrame testId="unreachable-device">
      <div className="mb-3 flex items-center justify-between px-1">
        <span className="label text-ink-muted">Monsters</span>
        <span className="label flex items-center gap-2 text-ink-muted" role="status">
          <span aria-hidden className="led" data-tone="stop" />
          {s.notConnected}
        </span>
      </div>
      <DeviceScreen testId="unreachable-screen" expression="sleep" line={s.title} tone="stop" />
      <div className="mt-6 text-center">
        <h1 className="text-title1 leading-tight font-bold tracking-[-0.02em] text-ink">
          {s.title}
        </h1>
        <p className="mt-1.5 text-body text-balance text-ink-muted">{app ? s.app : s.browser}</p>
      </div>
      <Button
        size="lg"
        className="mt-6 w-full"
        onClick={retry}
        disabled={trying}
        aria-busy={trying || undefined}
        data-testid="unreachable-retry"
      >
        {trying ? <Meter active /> : <ArrowClockwise size={18} weight="bold" aria-hidden />}{' '}
        {trying ? s.trying : s.retry}
      </Button>
      <p className="mt-2.5 text-center text-footnote text-ink-muted" data-testid="unreachable-auto">
        {s.auto}
      </p>
      <Details app={app} />
    </DeviceFrame>
  );
}
