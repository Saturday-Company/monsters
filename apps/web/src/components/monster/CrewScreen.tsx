import type { MonsterGenome } from '@monsters/monster-kit';
import { cn } from '../../lib/utils.ts';
import { genomeFrom } from '../../onboarding/parts.tsx';
import { useAgents } from '../../store/hooks.ts';
import { Monster } from './Monster.tsx';
import { fitDots } from './MonsterScreen.tsx';

/** A monster to draw: one of the team (by id) or a look still to be born (a draft's genome). */
export type ScreenMonster = { id: string } | { genome: unknown; name: string };

/**
 * A few monsters on one small black screen, the lead first. Used by automations (the crew of
 * a job) and by projects (a squad, or a draft that has no monsters yet). Decorative: the names
 * are said in words beside it.
 */
export function CrewScreen({
  monsters,
  height = 44,
  max = 3,
  working = false,
  className,
}: {
  monsters: readonly ScreenMonster[];
  height?: number;
  max?: number;
  /** The lead works now: it thinks on its screen. */
  working?: boolean;
  className?: string;
}) {
  const agents = useAgents();
  const genomes = monsters
    .map((m): { key: string; genome: MonsterGenome } | null => {
      if ('id' in m) {
        const a = agents.find((x) => x.id === m.id);
        return a ? { key: a.id, genome: a.genome } : null;
      }
      return { key: `draft:${m.name}`, genome: genomeFrom(m.genome, m.name) };
    })
    .filter((g): g is { key: string; genome: MonsterGenome } => g !== null);
  const shown = genomes.slice(0, max);
  const more = genomes.length - shown.length;
  const cell = Math.round(height * 0.86);
  const size = fitDots(cell, height, 2);
  return (
    <span
      aria-hidden
      data-testid="crew-screen"
      className={cn(
        'screen inline-flex shrink-0 items-center gap-0.5 overflow-hidden rounded-[10px] px-1.5',
        className,
      )}
      style={{ height }}
    >
      {shown.map((g, i) => (
        <span key={g.key} className="flex items-center justify-center" style={{ width: cell }}>
          <Monster
            genome={g.genome}
            size={size}
            expression={working && i === 0 ? 'think' : 'idle'}
            animated={working && i === 0}
          />
        </span>
      ))}
      {more > 0 && (
        <span className="px-1 font-mono text-micro tracking-[0.06em] text-screen-muted">
          +{more}
        </span>
      )}
    </span>
  );
}
