import {
  DOT_GLINT,
  DOT_H,
  DOT_OFF,
  DOT_PITCH,
  DOT_W,
  createRng,
  dotGrid,
  dotPalette,
  hashString,
  type DotCell,
  type DotPalette,
  type Expression,
  type MonsterGenome,
} from '@monsters/monster-kit';
import { useEffect, useMemo, useState } from 'react';
import { Monster } from '../components/monster/Monster.tsx';
import { cn } from '../lib/utils.ts';
import './boot.css';

/*
 * A monster switching on dot by dot on its screen (docs/design.md, "Primo avvio"):
 * the first frame of the expression from the kit (`dotGrid` + `dotPalette`), every
 * light dot an SVG circle that turns on at its own moment, in a random order drawn
 * from the seed (the same monster always boots the same way). Opacity only, by
 * steps, no filters. Once lit, the still drawing is swapped for the living
 * `Monster` (same grid, same geometry: the swap is invisible).
 */

/** Dot radius and pitch of the kit (dots/render.ts): the swap must not move a dot. */
const R = 4.6;
const VB_W = DOT_W * DOT_PITCH;
const VB_H = DOT_H * DOT_PITCH;

function colorOf(cell: DotCell, p: DotPalette): string | null {
  switch (cell) {
    case 'lit':
    case 'tooth':
      return p.lit;
    case 'dim':
      return p.dim;
    case 'accent':
      return p.accent;
    case 'accentDim':
      return p.accentDim;
    case 'belly':
      return p.belly;
    case 'cheek':
      return p.cheek;
    case 'glint':
      return DOT_GLINT;
    default:
      return null;
  }
}

export interface LitDot {
  x: number;
  y: number;
  color: string;
  /** When it turns on, from the start of the monster's boot (ms). */
  at: number;
}

/**
 * The light dots of a monster with the moment each one turns on: a seeded
 * shuffle spread over `duration`. Pure (tested).
 */
export function bootOrder(
  genome: MonsterGenome,
  expression: Expression = 'happy',
  duration = 700,
): { dots: LitDot[]; light: number } {
  const grid = dotGrid(genome, expression, 0);
  const p = dotPalette(genome);
  const dots: Omit<LitDot, 'at'>[] = [];
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const color = colorOf(grid.cells[y * grid.width + x] ?? 'off', p);
      if (color) dots.push({ x, y, color });
    }
  const rng = createRng(hashString(`${genome.id}:${genome.seed}:boot`));
  // Fisher–Yates with the seed: the same monster always boots in the same order.
  for (let i = dots.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [dots[i], dots[j]] = [dots[j]!, dots[i]!];
  }
  const step = dots.length > 1 ? duration / (dots.length - 1) : 0;
  return {
    dots: dots.map((d, i) => ({ ...d, at: Math.round(i * step) })),
    light: grid.light,
  };
}

/**
 * The monster on its black screen, switching on dot by dot from `delay` (ms)
 * for `duration` ms. `still`: no reveal, the monster is simply there.
 * `onLit` fires once, when the last dot is on.
 */
export function DotReveal({
  genome,
  width,
  height,
  delay = 0,
  duration = 700,
  still = false,
  expression = 'happy',
  title,
  onLit,
  className,
}: {
  genome: MonsterGenome;
  /** Outer size of the screen, px. */
  width: number;
  height: number;
  delay?: number;
  duration?: number;
  still?: boolean;
  expression?: Expression;
  title?: string;
  onLit?: () => void;
  className?: string;
}) {
  // The same monster (id and seed) keeps its boot even if the genome object is rebuilt.
  const who = `${genome.id}:${genome.seed}`;
  const run = `${who}:${delay}:${duration}`;
  // Which boot has finished: a new monster or timing starts a new one.
  const [done, setDone] = useState<string | null>(null);
  const lit = still || done === run;
  const boot = useMemo(
    () => bootOrder(genome, expression, duration),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [who, expression, duration],
  );

  useEffect(() => {
    if (still) return;
    // A frame after the last dot, so the swap never cuts a dot short.
    const t = setTimeout(
      () => {
        setDone(run);
        onLit?.();
      },
      delay + duration + 40,
    );
    return () => clearTimeout(t);
    // onLit is an event: a new function must not restart the boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, run]);

  const size = Math.round(Math.min(width - 16, ((height - 12) * 17) / 15));
  return (
    <span
      className={cn(
        'screen screen-lines relative flex shrink-0 items-center justify-center overflow-hidden',
        className,
      )}
      style={{ width, height, borderRadius: Math.min(14, Math.round(height / 6)) }}
      data-testid="boot-screen"
      data-lit={lit ? 'yes' : 'no'}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      {lit ? (
        <Monster genome={genome} size={size} expression={expression} />
      ) : (
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          width={size}
          height={Math.round((size * VB_H) / VB_W)}
          aria-hidden
          className="block"
        >
          <defs>
            <pattern
              id={`boot-off-${genome.id}`}
              width={DOT_PITCH}
              height={DOT_PITCH}
              patternUnits="userSpaceOnUse"
            >
              <circle cx={DOT_PITCH / 2} cy={DOT_PITCH / 2} r={R} fill={DOT_OFF} />
            </pattern>
          </defs>
          <rect width={VB_W} height={VB_H} fill={`url(#boot-off-${genome.id})`} />
          <g opacity={boot.light < 1 ? boot.light : undefined}>
            {boot.dots.map((d) => (
              <circle
                key={`${d.x}-${d.y}`}
                className="boot-dot"
                cx={d.x * DOT_PITCH + DOT_PITCH / 2}
                cy={d.y * DOT_PITCH + DOT_PITCH / 2}
                r={R}
                fill={d.color}
                style={{ animationDelay: `${delay + d.at}ms` }}
              />
            ))}
          </g>
        </svg>
      )}
    </span>
  );
}
