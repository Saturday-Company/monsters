import { ArrowRight } from '@phosphor-icons/react';
import { Fragment } from 'react';
import { cn } from '../../lib/utils.ts';

/*
 * The hierarchy of Monsters in one line (U-5): the user's capo, above the
 * personal squad and the projects; each project has its own capo, who leads
 * its monsters. Shown where the first project is born and on the empty
 * squad of a project, so the words "capo" and "capo del progetto" are clear.
 */

const STEPS = [
  'Il tuo capo',
  'Squadra personale / Progetti',
  'Capo del progetto',
  'Mostri',
] as const;

export function SquadChart({ className }: { className?: string }) {
  return (
    <figure
      data-testid="squad-chart"
      className={cn('m-0', className)}
      aria-label="Come sono organizzati i mostri: il tuo capo, la squadra personale e i progetti, il capo del progetto, i mostri"
    >
      <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-2 p-0">
        {STEPS.map((label, i) => (
          <Fragment key={label}>
            {i > 0 && (
              <li aria-hidden className="text-ink-muted">
                <ArrowRight size={16} />
              </li>
            )}
            <li className="well rounded-[10px] px-3 py-1.5 text-footnote font-semibold text-ink">
              {label}
            </li>
          </Fragment>
        ))}
      </ol>
    </figure>
  );
}
