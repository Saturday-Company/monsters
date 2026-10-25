import { CaretRight } from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';
import { cn, domId } from '../../lib/utils.ts';
import { projectsStrings } from './projects.strings.ts';

/**
 * The long part of a description (what the first layer leaves out: file names, what runs where),
 * out of the way until asked for: the first layer stays at a line or two.
 */
export function Details({ children, className }: { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = domId(useId());
  return (
    <div className={cn('grid gap-1.5', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 justify-self-start rounded text-footnote font-medium text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink"
      >
        <CaretRight size={12} aria-hidden className={cn('turn', open && 'rotate-90')} />
        {projectsStrings().details}
      </button>
      {open && (
        <div id={id} className="max-w-[62ch] pl-4 text-footnote leading-snug text-ink-muted">
          {children}
        </div>
      )}
    </div>
  );
}
