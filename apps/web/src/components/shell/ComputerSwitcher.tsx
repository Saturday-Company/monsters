import { CaretDown } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { desktop, type DesktopTarget } from '../../lib/desktop.ts';
import { Meter } from '../ui/Meter.tsx';
import { shellStrings } from './shell.strings.ts';

/*
 * Which computer the monsters work on (D-059), at the foot of the sidebar,
 * only inside the desktop app: "Questo computer" or the name of the
 * connection, a dot for its state, and a click opens the app's "Connessioni"
 * window. In a browser, or in an app without the calls, nothing is shown.
 */

export type TargetTone = 'ready' | 'busy' | 'off';

/** The dot and the words of a target's state (the words also say it without colour). */
export function targetStatus(target: Pick<DesktopTarget, 'state'>): {
  tone: TargetTone;
  text: string;
} {
  const s = shellStrings().computer;
  switch (target.state) {
    case 'ready':
      return { tone: 'ready', text: s.ready };
    case 'starting':
      return { tone: 'busy', text: s.starting };
    case 'connecting':
      return { tone: 'busy', text: s.connecting };
    case 'reconnecting':
      return { tone: 'busy', text: s.reconnecting };
    case 'offline':
      return { tone: 'off', text: s.offline };
  }
}

/** The name shown: the connection's, "Questo computer" for the local one. */
export function targetName(target: Pick<DesktopTarget, 'kind' | 'name'>): string {
  const s = shellStrings().computer;
  const name = target.name.trim();
  if (target.kind === 'local') return name || s.thisComputer;
  return name || s.anotherComputer;
}

/** The indicator light of each tone (styles.css `.led`): green, orange, off. */
const LIGHT: Record<TargetTone, string | undefined> = {
  ready: 'ok',
  busy: 'signal',
  off: undefined,
};

/** The current target of the desktop window, kept up to date. Null in a browser. */
function useDesktopTarget(): DesktopTarget | null {
  const [target, setTarget] = useState<DesktopTarget | null>(null);
  useEffect(() => {
    const d = desktop();
    if (!d?.target || !d.openConnections) return;
    let live = true;
    d.target()
      .then((t) => {
        if (live && t) setTarget(t);
      })
      .catch(() => {
        // an app that refuses the call: no switcher
      });
    const stop = d.onTargetChange?.((t) => setTarget(t));
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  return target;
}

export function ComputerSwitcher() {
  const s = shellStrings().computer;
  const target = useDesktopTarget();
  const bridge = desktop();
  if (!target || !bridge?.openConnections) return null;
  const name = targetName(target);
  const status = targetStatus(target);
  return (
    <button
      type="button"
      onClick={() => bridge.openConnections?.()}
      data-testid="computer-switcher"
      data-state={target.state}
      aria-label={s.label(name, status.text)}
      title={s.switch}
      className="row-key flex h-10 w-full items-center gap-2.5 rounded-[12px] px-3 text-left text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink"
    >
      <span aria-hidden data-testid="computer-dot" data-tone={status.tone} className="flex">
        <span className="led" data-tone={LIGHT[status.tone]} />
      </span>
      <span className="label min-w-0 truncate">
        <span className="text-ink">{name}</span>
        {status.tone !== 'ready' && <span> · {status.text}</span>}
      </span>
      {/* Connecting is a wait, not a call: the dashes run (only what waits for you blinks). */}
      {status.tone === 'busy' && <Meter active className="shrink-0 text-signal-ink" />}
      <CaretDown size={14} weight="bold" aria-hidden className="ml-auto shrink-0" />
    </button>
  );
}
