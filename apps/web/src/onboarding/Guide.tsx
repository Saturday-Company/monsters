import { dotPalette, type Expression, type MonsterGenome } from '@monsters/monster-kit';
import type { ReactNode } from 'react';
import { Monster } from '../components/monster/Monster.tsx';
import { useMediaQuery } from '../store/hooks.ts';
import { onboardingStrings } from './onboarding.strings.ts';
import './boot.css';

/**
 * The starting agent speaks from its screen (docs/design.md, "Primo avvio"):
 * one black display with the monster in dots on the left and its line in
 * luminous Martian Mono, a caret at the end; the hint is the dimmer second line.
 * A new `sayKey` re-mounts the line, which switches on in two frames.
 */
export function Guide({
  genome,
  name,
  expression,
  say,
  sayKey,
  hint,
  named = true,
}: {
  genome: MonsterGenome;
  name: string;
  /**
   * The user already chose its name. Before that the monster introduces itself
   * as "your first monster" (audit 2.16).
   */
  named?: boolean;
  expression: Expression;
  say: ReactNode;
  /** Changes when the screen shows a new line. */
  sayKey: string;
  hint?: ReactNode;
}) {
  const small = useMediaQuery('(max-width: 639px)');
  const led = dotPalette(genome).lit;
  return (
    <div
      className="screen screen-lines flex items-center gap-4 rounded-[16px] px-4 py-4 sm:gap-6 sm:px-6 sm:py-5"
      data-testid="guide"
    >
      <div className="shrink-0 self-center">
        <Monster genome={genome} size={small ? 76 : 120} expression={expression} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="label mb-2" style={{ color: led }}>
          {named ? onboardingStrings().guide.lead(name) : onboardingStrings().guide.first}
        </p>
        <div role="status" aria-live="polite">
          <p
            key={sayKey}
            data-testid="guide-says"
            className="light-on font-mono text-footnote leading-[1.6] text-screen-ink sm:text-large [&_strong]:font-semibold [&_strong]:text-white"
          >
            {say}
            <span aria-hidden className="boot-caret" />
          </p>
        </div>
        {hint && (
          <p className="mt-2.5 font-mono text-micro leading-[1.6] text-screen-muted sm:text-micro">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
