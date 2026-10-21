import { ArrowRight } from '@phosphor-icons/react';
import type { TeamConfirmResponse } from '@monsters/shared';
import { useEffect, useMemo, useState } from 'react';
import { Monster } from '../components/monster/Monster.tsx';
import { Button } from '../components/ui/button.tsx';
import { Meter } from '../components/ui/Meter.tsx';
import { chatPath } from '../lib/router.ts';
import { playSound } from '../lib/sound.ts';
import { cn } from '../lib/utils.ts';
import { useMediaQuery, useResolvedTheme } from '../store/hooks.ts';
import { accentInk, bubbleColors } from '../theme/bubbles.ts';
import { DotReveal } from './DotReveal.tsx';
import { onboardingStrings } from './onboarding.strings.ts';
import { genomeFrom, useStill } from './parts.tsx';

/** How long one monster takes to switch on, and the pause before the next one. */
export const BOOT_MS = 700;
const GAP_MS = 160;

/**
 * The team is born (docs/design.md, "Primo avvio"): every monster switches on dot
 * by dot on its own screen, the capo squadra first, one after the other, with a
 * tick for each one and a short chord when the whole team is on (if the sounds
 * are on). With reduced motion they are simply there. Then the capo squadra
 * says hello and its chat is one key away.
 */
export function BirthStep({ result }: { result: TeamConfirmResponse }) {
  const s = onboardingStrings().birth;
  const still = useStill();
  const theme = useResolvedTheme();
  const small = useMediaQuery('(max-width: 639px)');
  // The capo squadra switches on first.
  const agents = useMemo(
    () => [...result.agents].sort((a, b) => Number(b.isOrchestrator) - Number(a.isOrchestrator)),
    [result.agents],
  );
  const genomes = useMemo(() => agents.map((a) => genomeFrom(a.genome, a.name)), [agents]);
  const orch = agents[0]!;
  const [lit, setLit] = useState(still ? agents.length : 0);
  const ready = lit >= agents.length;
  const c = bubbleColors(orch.color, theme);

  useEffect(() => {
    if (still) playSound('done');
  }, [still]);

  const onLit = (i: number) => {
    setLit((n) => Math.max(n, i + 1));
    // A tick for each monster, the chord for the last one (one sound at a time).
    playSound(i === agents.length - 1 ? 'done' : 'click');
  };

  const screen = (boss: boolean) =>
    small
      ? boss
        ? { width: 118, height: 104 }
        : { width: 96, height: 86 }
      : boss
        ? { width: 176, height: 156 }
        : { width: 140, height: 124 };

  return (
    <div className="grid gap-7" data-testid="birth" data-ready={ready ? 'yes' : 'no'}>
      <div className="text-center">
        <p className="label flex items-center justify-center gap-2 text-ink-muted" aria-hidden>
          {/* Switching on is work: the dashes run until the team is lit, then a green light. */}
          {ready ? (
            <span className="led" data-tone="ok" />
          ) : (
            <Meter active className="text-signal-ink" />
          )}
          {ready ? s.on : s.switching(lit + 1, agents.length)}
        </p>
        <h2 className="mt-3 text-title1 font-bold tracking-[-0.02em] text-ink sm:text-display">
          {s.title}
        </h2>
        <p className="mt-1 text-large text-ink-muted">{s.subtitle}</p>
      </div>

      <ul
        className="flex flex-wrap items-end justify-center gap-x-3 gap-y-5 sm:gap-x-5"
        aria-label={s.list}
      >
        {agents.map((a, i) => {
          const on = i < lit;
          return (
            <li key={a.id} className="flex flex-col items-center gap-2.5">
              <DotReveal
                genome={genomes[i]!}
                {...screen(a.isOrchestrator)}
                delay={i * (BOOT_MS + GAP_MS)}
                duration={BOOT_MS}
                still={still}
                title={a.name}
                onLit={() => onLit(i)}
              />
              <span className="grid justify-items-center gap-1">
                <span className="text-body leading-none font-semibold text-ink">{a.name}</span>
                <span
                  className={cn('label flex items-center gap-1.5', !on && 'text-ink-faint')}
                  style={on ? { color: accentInk(a.color, theme) } : undefined}
                >
                  {a.isOrchestrator ? s.lead : on ? s.awake : s.waiting}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <div
        className={cn(
          'mx-auto flex max-w-full items-start gap-2.5',
          ready ? (still ? '' : 'rise-in') : 'invisible',
        )}
        aria-hidden={!ready}
      >
        <span className="screen mt-5 flex h-[30px] w-[34px] shrink-0 items-center justify-center rounded-[7px]">
          <Monster
            genome={genomes[0]!}
            size={28}
            expression={ready ? 'talk' : 'idle'}
            animated={ready}
          />
        </span>
        <div className="min-w-0">
          <p className="label mb-1 pl-1 text-ink-muted">{orch.name}</p>
          <p
            data-testid="welcome"
            className="w-fit max-w-[62ch] rounded-[4px_14px_14px_14px] px-4 py-2.5 text-large leading-[1.5] shadow-[0_0_0_1px_var(--seam)]"
            style={{ background: c.bg, color: c.fg }}
          >
            {result.welcome}
          </p>
        </div>
      </div>

      <div className="flex justify-center">
        <Button
          size="lg"
          onClick={() => {
            playSound('click');
            window.location.hash = chatPath(orch.id);
          }}
        >
          {s.write(orch.name)} <ArrowRight size={18} aria-hidden />
        </Button>
      </div>
    </div>
  );
}
