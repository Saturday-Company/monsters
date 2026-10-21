import { ArrowClockwise } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { desktop } from '../../lib/desktop.ts';
import { domId } from '../../lib/utils.ts';
import { boot } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { authStrings } from './auth.strings.ts';
import { DeviceFrame, DeviceScreen } from './Device.tsx';

/*
 * "Non trovo Monsters": the page when the core does not answer at the start. The same device as
 * the Accesso (docs/design.md): the monster asleep on its screen, the words under it, one key.
 * The words differ between the browser (start Monsters on the computer) and the desktop app
 * (close it and open it again); the command line stays under "Dettagli".
 */

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
      <Button size="lg" className="mt-6 w-full" onClick={() => void boot()}>
        <ArrowClockwise size={18} weight="bold" aria-hidden /> {s.retry}
      </Button>
      <Details app={app} />
    </DeviceFrame>
  );
}
