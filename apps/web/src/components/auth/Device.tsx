import type { Expression, MonsterGenome } from '@monsters/monster-kit';
import type { ReactNode } from 'react';
import { monsterFor } from '../../lib/monsters.ts';
import { cn } from '../../lib/utils.ts';
import { useMediaQuery } from '../../store/hooks.ts';
import { Monster } from '../monster/Monster.tsx';

/*
 * The device of the Accesso (docs/design.md): a faceplate with four screws on the chassis of
 * the window, a black screen with a monster on it. Shared by the sign-in and by "Non trovo
 * Monsters", which has to stay in the first bundle (the core that serves the chunks may be down).
 */

/** The screen of the device: a monster, and one line of light under it. */
export function DeviceScreen({
  expression,
  line,
  tone = 'muted',
  phase,
  testId = 'auth-screen',
  genome = monsterFor('titan'),
}: {
  expression: Expression;
  line: string;
  tone?: 'muted' | 'ink' | 'stop';
  phase?: string;
  testId?: string;
  genome?: MonsterGenome;
}) {
  const small = useMediaQuery('(max-width: 479px)');
  return (
    <div
      className="screen screen-lines flex h-[188px] flex-col items-center justify-center gap-3 rounded-[14px] sm:h-[212px]"
      data-testid={testId}
      data-phase={phase}
    >
      <Monster genome={genome} size={small ? 118 : 138} expression={expression} />
      <p
        key={line}
        className={cn(
          'light-on label',
          tone === 'stop'
            ? 'text-screen-stop'
            : tone === 'ink'
              ? 'text-screen-ink'
              : 'text-screen-muted',
        )}
        aria-hidden
      >
        {line}
      </p>
    </div>
  );
}

/** The device on the chassis of the window, with its rail and screws: Accesso, "Non trovo Monsters". */
export function DeviceFrame({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    // The device on the chassis of the window (docs/design.md, "Accesso").
    <main className="relative z-[1] flex h-full flex-col bg-chassis">
      {/* The 52 px rail: drags the window, leaves the system buttons free; no display here. */}
      <header
        data-titlebar
        className="titlebar-start titlebar-end flex h-[52px] shrink-0 items-center px-4 sm:px-5"
      >
        <span className="dots text-title3 leading-none text-ink" aria-hidden>
          monsters
        </span>
      </header>
      <div aria-hidden className="seam-h" />
      <div className="scroll-soft flex-1 overflow-y-auto">
        {/*
          Anchored at the top, not centred: an error or the "forgotten password"
          panel grows the device downwards, nothing above it moves (audit UI-17).
        */}
        <div className="mx-auto flex min-h-full w-full max-w-[452px] flex-col px-3 pt-4 pb-12 sm:px-4 sm:pt-[max(24px,6vh)]">
          <div className="device px-4 pt-6 pb-5 sm:px-7 sm:pt-7 sm:pb-6" data-testid={testId}>
            <Screws />
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}

/** The four screws of the faceplate. */
function Screws() {
  return (
    <>
      <span aria-hidden className="device-screw top-2.5 left-2.5" />
      <span aria-hidden className="device-screw top-2.5 right-2.5 rotate-90" />
      <span aria-hidden className="device-screw bottom-2.5 left-2.5 rotate-45" />
      <span aria-hidden className="device-screw right-2.5 bottom-2.5 -rotate-45" />
    </>
  );
}
