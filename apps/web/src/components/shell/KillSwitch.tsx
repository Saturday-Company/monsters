import { Play } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { playSound } from '../../lib/sound.ts';
import { cn } from '../../lib/utils.ts';
import { killAll, resumeAll, resumeAndContinue, useApp } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { shellStrings } from './shell.strings.ts';

/*
 * Ferma (docs/design.md, "Il binario superiore"): a guarded switch, as in a
 * recording studio or a cockpit. At rest a cover with hazard stripes is
 * closed over a red lever. First press (click, Enter, or ⌘. / Ctrl+.) lifts
 * the cover and arms it for 5 s ("Di nuovo per fermare"); the second press
 * throws the lever and stops every monster. Stopped, the lever stays down
 * with a red light and the switch says "Riprendi": one press brings them back.
 * Two gestures, no dialog. Always visible and reachable from the keyboard.
 */

const ARMED_MS = 5000;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

/** Whether at least one monster is at work (or waiting on another one, inside a run). */
export function useAnyoneWorking(): boolean {
  return useApp(
    (s) =>
      !s.halted &&
      Object.values(s.live).some(
        (l) => l.mood === 'working' || l.mood === 'talking' || l.mood === 'waiting',
      ),
  );
}

/**
 * "Riprendi" as a key, in the halt band under the rail; `continueWork` also
 * starts again what the stop left halfway ("Riprendi e continua").
 */
export function ResumeButton({
  testId,
  variant = 'primary',
  continueWork = false,
}: {
  testId?: string;
  variant?: 'primary' | 'secondary';
  continueWork?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const s = shellStrings().halt;
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={busy}
      data-testid={testId}
      onClick={() => {
        setBusy(true);
        void (continueWork ? resumeAndContinue() : resumeAll()).finally(() => setBusy(false));
      }}
    >
      {(continueWork || variant === 'primary') && <Play size={16} weight="fill" aria-hidden />}
      {continueWork ? s.resumeAndContinue : s.resume}
    </Button>
  );
}

type SwitchState = 'idle' | 'armed' | 'halted';

const ARM = 'monsters:arm-kill';

/** Lifts the cover of Ferma and puts the focus on it, as ⌘. does (the palette's command). */
export function armKillSwitch(): void {
  window.dispatchEvent(new Event(ARM));
}

export function KillSwitch({ compact = false }: { compact?: boolean }) {
  const s = shellStrings().kill;
  const halted = useApp((s) => s.halted);
  const working = useAnyoneWorking();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const state: SwitchState = halted ? 'halted' : armed ? 'armed' : 'idle';

  // Armed for a few seconds; Escape closes the cover again.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARMED_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setArmed(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [armed]);

  // ⌘. / Ctrl+. (or the palette) lifts the cover from anywhere and puts the focus on the switch.
  useEffect(() => {
    const arm = () => {
      if (useApp.getState().halted) return;
      ref.current?.focus();
      setArmed((was) => {
        if (!was) playSound('click');
        return true;
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '.' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      arm();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(ARM, arm);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(ARM, arm);
    };
  }, []);

  const press = () => {
    if (busy) return;
    if (state === 'halted') {
      setBusy(true);
      playSound('lever');
      void resumeAll().finally(() => setBusy(false));
      return;
    }
    if (state === 'idle') {
      setArmed(true);
      playSound('click');
      return;
    }
    setArmed(false);
    playSound('lever');
    void killAll();
  };

  const word = state === 'halted' ? s.resume : s.stop;
  const led = state === 'halted' ? 'stop' : working || state === 'armed' ? 'signal' : undefined;

  return (
    <button
      ref={ref}
      type="button"
      onClick={press}
      onKeyDown={(e) => {
        // Escape on the switch only closes the cover: the sheet or dialog under it stays.
        if (e.key === 'Escape' && state === 'armed') {
          e.stopPropagation();
          setArmed(false);
        }
      }}
      disabled={busy}
      aria-label={state === 'halted' ? s.resume : s.stopAll}
      aria-keyshortcuts={state === 'halted' ? undefined : isMac ? 'Meta+.' : 'Control+.'}
      aria-describedby={state === 'armed' ? 'kill-armed-hint' : undefined}
      title={
        state === 'halted'
          ? s.resumeTitle
          : state === 'armed'
            ? s.armedTitle
            : s.idleTitle(isMac ? '⌘.' : 'Ctrl+.')
      }
      data-testid={state === 'halted' ? 'resume' : 'kill'}
      data-state={state}
      data-armed={state === 'armed' ? 'true' : undefined}
      data-working={working ? 'true' : undefined}
      className={cn(
        'kill group relative flex h-11 shrink-0 items-center rounded-[12px] select-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal-ink disabled:cursor-wait',
        compact ? 'gap-1.5 pr-1 pl-0.5' : 'gap-2.5 pr-1.5 pl-1',
      )}
    >
      <span aria-hidden className="kill-house">
        <span className="kill-lever" />
        <span className="kill-cover" />
      </span>
      <span
        aria-hidden
        // On a phone the word stays (the stripes alone say nothing); the light comes only when it matters.
        className={cn('flex items-center gap-2', !compact && 'w-[92px]')}
      >
        {(!compact || state !== 'idle') && (
          <span
            className="led"
            data-tone={led}
            data-blink={state === 'armed' ? '' : undefined}
            data-testid="kill-light"
          />
        )}
        {state === 'armed' ? (
          // The whole sentence is in the title and in the announcement below.
          <span className="label text-micro text-stop-ink">{s.again}</span>
        ) : (
          <span
            className={cn('label text-micro', state === 'halted' ? 'text-ink' : 'text-stop-ink')}
          >
            {word}
          </span>
        )}
      </span>
      <span id="kill-armed-hint" role="status" className="sr-only">
        {state === 'armed' ? s.armedHint : ''}
      </span>
    </button>
  );
}
