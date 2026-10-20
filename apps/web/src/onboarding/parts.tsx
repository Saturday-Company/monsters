import { MonsterGenomeSchema, type MonsterGenome } from '@monsters/monster-kit';
import type { ReactNode } from 'react';
import { useStill } from '../lib/motion.ts';
import { monsterFor } from '../lib/monsters.ts';
import { cn } from '../lib/utils.ts';

export { useStill };

/* Small pieces shared by the onboarding steps. */

/** The genome sent by the core, or the roster/generated one for the name. */
export function genomeFrom(raw: unknown, name: string): MonsterGenome {
  const parsed = MonsterGenomeSchema.safeParse(raw);
  return parsed.success ? parsed.data : monsterFor(name);
}

/**
 * The confirmation after a choice: a green lamp whose check draws itself, in
 * two frames (other colours through `style`).
 */
export function DoneCheck({
  size = 22,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const still = useStill();
  return (
    <span
      aria-hidden
      data-testid="done-check"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-ok text-panel shadow-[inset_0_-1px_1px_rgba(0,0,0,.25),inset_0_1px_1px_rgba(255,255,255,.4)]',
        !still && 'light-on',
        className,
      )}
      style={{ width: size, height: size, ...style }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none">
        <path
          d="M5 12.5l4.5 4.5L19 7.5"
          pathLength={1}
          className={cn(!still && 'check-draw')}
          stroke="currentColor"
          strokeWidth={3.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/**
 * Progress inside a step: a strip of segments sunk in a well, lit in the
 * signal colour as the screens are done (the current one half lit). Decoration
 * (`aria-hidden`): screen readers get a single "Domanda n di m" (audit 2.15).
 */
export function ScreenProgress({
  total,
  current,
  done,
  label = 'Domanda',
  flash = false,
}: {
  total: number;
  /** Index of the screen on show. */
  current: number;
  /** Screens completed (the current one counts once confirmed). */
  done: number;
  /** Word before "n di m". */
  label?: string;
  /** Just confirmed: a check next to the counter. */
  flash?: boolean;
}) {
  return (
    <div className="flex items-center gap-3" data-testid="screen-progress">
      <div className="well flex flex-1 items-center gap-[3px] rounded-[6px] p-[3px]" aria-hidden>
        {Array.from({ length: total }, (_, i) => {
          const complete = i < done;
          const active = i === current && !complete;
          return (
            <span
              key={i}
              className={cn(
                'h-1.5 flex-1 rounded-[2px]',
                complete
                  ? 'bg-signal'
                  : active
                    ? 'bg-[repeating-linear-gradient(90deg,var(--signal)_0_3px,transparent_3px_6px)]'
                    : 'bg-[color-mix(in_oklab,var(--ink),transparent_88%)]',
              )}
            />
          );
        })}
      </div>
      <span className="flex h-6 items-center justify-end gap-1.5">
        {flash && <DoneCheck size={18} />}
        <span className="label whitespace-nowrap text-ink-muted">
          {label} {Math.min(current + 1, total)} di {total}
        </span>
      </span>
    </div>
  );
}

/** A short tag ("web", "Capo squadra: Titan"): a label on a small cap. */
export function Badge({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'ok';
}) {
  return (
    <span
      className={cn(
        'label inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[6px] px-2 shadow-[inset_0_0_0_1px_var(--key-edge)]',
        tone === 'ok' ? 'text-ink' : 'text-ink-muted',
      )}
    >
      {tone === 'ok' && <span aria-hidden className="led size-1.5" data-tone="ok" />}
      {children}
    </span>
  );
}

/** Inline error under a block: a red lamp and the words. */
export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2.5 rounded-[10px] bg-stop-soft px-3.5 py-2.5 text-body text-stop-ink"
    >
      <span aria-hidden className="led mt-[7px]" data-tone="stop" />
      <span>{children}</span>
    </p>
  );
}
